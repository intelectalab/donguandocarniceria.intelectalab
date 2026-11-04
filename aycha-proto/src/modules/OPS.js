/* =====================================================================
   OPS · Consola de plataforma y soporte (Fase 4)
   Consola de Intelectalab con todas las empresas cliente: plan, MRR, uso,
   salud ponderada (RN-OPS-13), integraciones, suspensión con motivo,
   tickets con plazo de primera respuesta, acceso temporal de soporte
   aprobado por el cliente y auditado en los dos lados (RN-OPS-02/03/04/09),
   salud de componentes, incidentes, anuncios, métricas del negocio SaaS,
   usuarios de plataforma con segundo factor, bitácora y parámetros.
   Tablas globales (sin tenant): platform_*, tenant_health_snapshots.
   Tablas del tenant: support_tickets, support_access_grants,
   support_access_log (solo inserción), announcement_reads.
   ===================================================================== */
(function () {
  const U = G.util, ui = G.ui, h = ui.h;
  const R = (n, d = 2) => U.round(n, d);
  const O = G.ops = G.ops || {};
  const CONSOLE = ['SOPORTE_PLATAFORMA'];
  const CLIENT = ['ADMIN_SISTEMA'];

  /* ------------------------------------------------------------------
     Tiempo (cadenas ISO sin zona: hora de Lima)
     ------------------------------------------------------------------ */
  const ms = s => { const [d, t = '00:00:00'] = String(s).split('T'); const [y, m, dd] = d.split('-').map(Number); const [hh = 0, mi = 0, ss = 0] = t.split(':').map(Number); return Date.UTC(y, m - 1, dd, hh, mi, Math.floor(ss || 0)); };
  const iso = v => new Date(v).toISOString().slice(0, 19);
  const addH = (s, hrs) => iso(ms(s) + hrs * 3600000);
  const addMin = (s, m) => iso(ms(s) + m * 60000);
  const hoursBetween = (a, b) => (ms(b) - ms(a)) / 3600000;
  const now = () => G.date.now();
  O.time = { ms, iso, addH, addMin, hoursBetween };
  const fmtH = v => v === null || v === undefined || !isFinite(v) ? '—' : (Math.abs(v) < 1 ? G.fmt.num(v * 60, 0) + ' min' : G.fmt.num(v, 1) + ' h');
  const left = (to, from = now()) => { const m = (ms(to) - ms(from)) / 60000; if (m <= 0) return 'vencido'; const hh = Math.floor(m / 60), mm = Math.round(m % 60); return hh ? `${hh} h ${mm} min` : `${mm} min`; };

  /* horario hábil de soporte (D-OPS-04): lunes a sábado 09:00–18:00; URGENT 24×7 */
  const isBizDay = d => G.date.parse(d).getUTCDay() !== 0;
  O.bizHours = function (a, b) {
    if (!a || !b || ms(b) <= ms(a)) return 0;
    let total = 0, d = a.slice(0, 10); const end = b.slice(0, 10);
    while (d <= end) {
      if (isBizDay(d)) { const s = Math.max(ms(a), ms(d + 'T09:00:00')), e = Math.min(ms(b), ms(d + 'T18:00:00')); if (e > s) total += (e - s) / 3600000; }
      d = G.date.add(d, 1);
    }
    return total;
  };
  O.addBizHours = function (a, hrs) {
    let rest = hrs * 3600000, cur = ms(a);
    for (let i = 0; i < 400 && rest > 0; i++) {
      const d = iso(cur).slice(0, 10);
      if (isBizDay(d)) { const s = Math.max(cur, ms(d + 'T09:00:00')), e = ms(d + 'T18:00:00'); if (e > s) { if (e - s >= rest) return iso(s + rest); rest -= e - s; } }
      cur = ms(G.date.add(d, 1) + 'T00:00:00');
    }
    return iso(cur);
  };

  /* ------------------------------------------------------------------
     Acceso a tablas de todas las empresas (la consola) y globales
     ------------------------------------------------------------------ */
  const raw = t => G.db.raw(t);
  const rget = (t, id) => raw(t).find(r => r.id === id) || null;
  const rupd = (row, patch) => { Object.assign(row, patch, { updated_at: now() }); G.db.touch(); return row; };
  const gins = (t, row) => G.db.insert(t, Object.assign({ tenant: null }, row), { silent: true });
  const tins = (t, tenant, row) => G.db.insert(t, Object.assign({}, row, { tenant }), { silent: true });
  O.raw = { get: rget, update: rupd };

  /* ------------------------------------------------------------------
     Catálogos y etiquetas
     ------------------------------------------------------------------ */
  const COMPONENTS = [['APP', 'Aplicación'], ['DATABASE', 'Base de datos'], ['QUEUES', 'Colas y tareas'], ['OSE', 'OSE (facturación electrónica)'], ['WHATSAPP', 'WhatsApp Cloud API'], ['PAYMENT_GATEWAY', 'Pasarelas (Mercado Pago)'], ['MAPS', 'Mapas'], ['EMAIL', 'Correo'], ['STORAGE', 'Almacenamiento'], ['TELEPHONY', 'Telefonía'], ['ADS', 'Anuncios'], ['WOOCOMMERCE', 'WooCommerce'], ['API', 'API pública']];
  const compName = c => (COMPONENTS.find(x => x[0] === c) || [c, c])[1];
  const PROLES = [['PLATFORM_ADMIN', 'Administrador de plataforma'], ['SUPPORT_L1', 'Soporte nivel 1'], ['SUPPORT_L2', 'Soporte nivel 2'], ['BILLING', 'Facturación y cobranza'], ['ENGINEER', 'Ingeniería'], ['READ_ONLY', 'Solo consulta']];
  const proleName = r => (PROLES.find(x => x[0] === r) || [r, r])[1];
  const CATS = [['BILLING', 'Facturación del SaaS'], ['ONBOARDING', 'Alta e implementación'], ['EINVOICE', 'Comprobantes y OSE'], ['WHATSAPP', 'WhatsApp'], ['ORDERS', 'Pedidos'], ['INVENTORY', 'Inventario'], ['ACCOUNTING', 'Contabilidad'], ['API', 'API e integraciones'], ['BUG', 'Error del sistema'], ['FEATURE_REQUEST', 'Pedido de mejora'], ['OTHER', 'Otro']];
  const catName = c => (CATS.find(x => x[0] === c) || [c, c])[1];
  const PRIOS = [['URGENT', 'Urgente'], ['HIGH', 'Alta'], ['NORMAL', 'Normal'], ['LOW', 'Baja']];
  const prioName = c => (PRIOS.find(x => x[0] === c) || [c, c])[1];
  const prioTone = { URGENT: 'bad', HIGH: 'warn', NORMAL: 'info', LOW: '' };
  const TSTAT = [['OPEN', 'Abierto'], ['IN_PROGRESS', 'En proceso'], ['WAITING_CUSTOMER', 'Espera al cliente'], ['RESOLVED', 'Resuelto'], ['CLOSED', 'Cerrado']];
  const SEVS = [['SEV1', 'SEV1 · caída total'], ['SEV2', 'SEV2 · función crítica caída'], ['SEV3', 'SEV3 · degradación'], ['SEV4', 'SEV4 · menor']];
  const INC_ST = [['INVESTIGATING', 'Investigando'], ['IDENTIFIED', 'Causa identificada'], ['MONITORING', 'En monitoreo'], ['RESOLVED', 'Resuelto']];
  const ANN_KINDS = [['INFO', 'Información'], ['NEW_FEATURE', 'Novedad'], ['MAINTENANCE', 'Mantenimiento'], ['INCIDENT', 'Incidente'], ['BILLING', 'Facturación']];
  const annKind = c => (ANN_KINDS.find(x => x[0] === c) || [c, c])[1];
  const AUDIENCES = [['ALL', 'Todas las empresas'], ['PRODUCT', 'Producto Aycha Comercial'], ['PLAN', 'Un plan'], ['TENANTS', 'Lista de empresas']];
  const GRANT_MODULES = [['FAC', 'Comprobantes (FAC)', 'sales_documents'], ['PED', 'Pedidos (PED)', 'sales_orders'], ['CLI', 'Clientes (CLI)', 'customers'], ['CAJ', 'Cobros (CAJ)', 'payments'], ['ALM', 'Inventario (ALM)', 'stock_balances'], ['CAT', 'Catálogo (CAT)', 'product_variants']];
  const ENTITY_MOD = Object.fromEntries(GRANT_MODULES.map(m => [m[2], m[0]]));
  const SL = {
    REQUESTED: ['Por aprobar', 'warn'], APPROVED: ['Vigente', 'ok'], REJECTED: ['Rechazado', 'bad'], REVOKED: ['Revocado', 'bad'], EXPIRED: ['Vencido', ''],
    OPEN: ['Abierto', 'info'], IN_PROGRESS: ['En proceso', 'info'], WAITING_CUSTOMER: ['Espera al cliente', 'warn'], RESOLVED: ['Resuelto', 'ok'], CLOSED: ['Cerrado', ''],
    INVESTIGATING: ['Investigando', 'bad'], IDENTIFIED: ['Causa identificada', 'warn'], MONITORING: ['En monitoreo', 'info'],
    UP: ['Operativo', 'ok'], DEGRADED: ['Degradado', 'warn'], DOWN: ['Caído', 'bad'], NA: ['Sin conector', ''],
    HEALTHY: ['Saludable', 'ok'], AT_RISK: ['En riesgo', 'warn'], CRITICAL: ['Crítica', 'bad'],
    ACTIVE: ['Activo', 'ok'], PAST_DUE: ['En mora', 'bad'], READ_ONLY: ['Solo lectura', 'warn'], SUSPENDED: ['Suspendido', 'bad'], CANCELLED: ['Cancelado', ''], TRIAL: ['En prueba', 'info'],
    DRAFT: ['Borrador', ''], PUBLISHED: ['Publicado', 'ok'], ARCHIVED: ['Archivado', ''], INVITED: ['Invitado', 'info'], LOCKED: ['Bloqueado', 'bad'], DISABLED: ['De baja', ''], INACTIVE: ['Inactivo', ''],
    PAID: ['Pagado', 'ok'], VOIDED: ['Anulado', 'bad'], UNCOLLECTIBLE: ['Incobrable', 'bad'],
    SEV1: ['SEV1', 'bad'], SEV2: ['SEV2', 'bad'], SEV3: ['SEV3', 'warn'], SEV4: ['SEV4', 'info'],
    READ_ONLY_ACCESS: ['Solo lectura', 'info'], READ_WRITE: ['Lectura y escritura', 'warn'],
  };
  const st = s => SL[s] ? ui.badge(SL[s][0], SL[s][1]) : ui.status(s);
  O.badge = st;
  const lvl = s => s === 'READ_ONLY' ? st('READ_ONLY_ACCESS') : st(s);
  const codeBlock = txt => h('pre', { class: 'mono', style: 'margin:0;padding:10px 12px;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;overflow:auto;max-height:320px;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere' }, txt);
  const tl = (items) => h('div', { class: 'timeline' }, items.map(i => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, i.when), h('span', { class: 'dot', style: i.tone ? `background:var(--${i.tone})` : null }), h('div', { style: 'min-width:0' }, i.body))));

  /* ------------------------------------------------------------------
     Parámetros de plataforma (RN-OPS-05: historial de solo inserción)
     ------------------------------------------------------------------ */
  O.pparam = function (key) { const p = raw('platform_parameters').find(x => x.key === key); return p ? U.clone(p.value) : G.param(key); };
  O.platformParamKeys = () => Object.values(G.PARAM_DEFS).filter(d => d.scope === 'PLATFORM').map(d => d.key);
  O.setPParam = function (key, value, reason, opts = {}) {
    const a = opts.system ? null : O.passert('params.manage');
    if (!G.PARAM_DEFS[key] || G.PARAM_DEFS[key].scope !== 'PLATFORM') G.fail('RN-OPS-05', `${key} no es un parámetro de plataforma.`);
    if (!reason || String(reason).trim().length < 5) G.fail('RN-OPS-05', 'Cambiar un parámetro de plataforma exige un motivo (queda en el historial de solo inserción).');
    const before = O.pparam(key);
    let p = raw('platform_parameters').find(x => x.key === key);
    if (p) rupd(p, { value, updated_by: a ? a.id : null });
    else p = gins('platform_parameters', { key, value, description: G.PARAM_DEFS[key].desc, updated_at: now(), updated_by: a ? a.id : null });
    gins('platform_parameter_history', { parameter_id: p.id, key, old_value: before, new_value: value, reason, changed_by: a ? a.id : null, changed_by_name: a ? a.full_name : 'Sistema', changed_at: opts.at || now() });
    if (a) O.paudit('PARAMETER_CHANGED', { entity: 'platform_parameters', entity_id: p.id, reason, detail: { key, from: before, to: value } });
    return value;
  };
  const WK = { uso: 'usage', cobro: 'billing', ose: 'ose', whatsapp: 'whatsapp', tickets: 'tickets' };
  O.weights = function () {
    const v = O.pparam('ops_health_weights'); const out = { usage: 25, billing: 25, ose: 20, whatsapp: 15, tickets: 15 };
    if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) { const kk = WK[k.toLowerCase()] || k; if (kk in out) out[kk] = Number(x); } }
    else if (typeof v === 'string') { const re = /(uso|cobro|ose|whatsapp|tickets)\s*:?\s*(\d+(?:[.,]\d+)?)/gi; let m; while ((m = re.exec(v))) out[WK[m[1].toLowerCase()]] = Number(m[2].replace(',', '.')); }
    return out;
  };
  O.frHours = function () {
    const v = O.pparam('ops_ticket_first_response_hours'); const out = { URGENT: 1, HIGH: 4, NORMAL: 8, LOW: 24 };
    if (v && typeof v === 'object') Object.assign(out, v);
    else if (typeof v === 'string') { const re = /(URGENT|HIGH|NORMAL|LOW)\s*:?\s*(\d+(?:[.,]\d+)?)/gi; let m; while ((m = re.exec(v))) out[m[1].toUpperCase()] = Number(m[2].replace(',', '.')); }
    return out;
  };
  const thresholds = () => ({ risk: Number(O.pparam('ops_health_at_risk_below') ?? 70), critical: Number(O.pparam('ops_health_critical_below') ?? 40) });

  /* ------------------------------------------------------------------
     Usuarios de plataforma, roles (RN-OPS-10) y sesión de consola
     ------------------------------------------------------------------ */
  const CAPS = {
    PLATFORM_ADMIN: ['*'],
    BILLING: ['tenant.status', 'metrics.freeze'],
    SUPPORT_L1: ['ticket.manage', 'access.request_ro'],
    SUPPORT_L2: ['ticket.manage', 'access.request_ro', 'access.request_rw', 'reprocess'],
    ENGINEER: ['health.record', 'incident.manage', 'access.request_ro', 'access.request_rw', 'announce.manage', 'ticket.manage'],
    READ_ONLY: [],
  };
  const CAP_TEXT = { 'tenant.status': 'suspender ni reactivar empresas', 'metrics.freeze': 'congelar métricas', 'ticket.manage': 'atender tickets', 'access.request_ro': 'solicitar accesos de solo lectura', 'access.request_rw': 'solicitar accesos de lectura y escritura', 'reprocess': 'reprocesar', 'health.record': 'registrar lecturas de salud', 'incident.manage': 'gestionar incidentes', 'announce.manage': 'publicar anuncios', 'users.manage': 'administrar usuarios de plataforma', 'params.manage': 'cambiar parámetros de plataforma' };
  const SYSTEM = { id: null, full_name: 'Sistema (tarea programada)', role: 'SYSTEM', status: 'ACTIVE' };
  O.actor = function () {
    const c = G.ctx.opsConsole;
    if (c && c.platform_user_id) { const pu = rget('platform_users', c.platform_user_id); if (pu && pu.status === 'ACTIVE') return pu; }
    const s = G.ctx.session; const u = s ? rget('users', s.user_id) : null;
    if (u && u.platform_user_id) return rget('platform_users', u.platform_user_id);
    if (G.ctx.role === 'SOPORTE_PLATAFORMA') { const x = raw('users').find(y => y.role === 'SOPORTE_PLATAFORMA' && y.platform_user_id); if (x) return rget('platform_users', x.platform_user_id); }
    return rget('platform_users', 'pu-admin');
  };
  O.actorIp = () => (G.ctx.opsConsole && G.ctx.opsConsole.ip) || '190.237.14.22';
  O.pcan = (cap, pu = O.actor()) => !!pu && pu.status === 'ACTIVE' && (CAPS[pu.role] || []).some(c => c === '*' || c === cap);
  O.passert = function (cap, pu) {
    const a = pu || O.actor();
    if (!O.pcan(cap, a)) G.fail('RN-OPS-10', `${a ? a.full_name + ' (' + proleName(a.role) + ')' : 'Sin usuario de consola'} no puede ${CAP_TEXT[cap] || cap}. Pueden: ${PROLES.filter(r => (CAPS[r[0]] || []).some(c => c === '*' || c === cap)).map(r => r[1]).join(', ')}.`);
    return a;
  };
  /** ¿la IP está en la lista? Acepta IP exacta o CIDR /8, /16, /24, /32 */
  O.ipIn = function (ip, list) {
    if (!list || !list.length) return true;
    const toN = s => String(s).split('.').reduce((a, x) => (a * 256) + Number(x), 0);
    return list.some(e => { const [base, bits] = String(e).split('/'); const b = bits === undefined ? 32 : Number(bits); const mask = b === 0 ? 0 : Math.pow(2, 32) - Math.pow(2, 32 - b); return Math.floor(toN(ip) / Math.pow(2, 32 - b)) === Math.floor(toN(base) / Math.pow(2, 32 - b)) && mask >= 0; });
  };
  O.consoleLogin = function ({ email, password, code, ip }) {
    const pu = raw('platform_users').find(x => (x.email || '').toLowerCase() === String(email || '').trim().toLowerCase());
    if (!pu) G.fail('RN-OPS-01', 'Correo o contraseña incorrectos.');
    if (pu.status === 'INVITED') G.fail('RN-OPS-01', `${pu.full_name} aún no activa su segundo factor: sin él la cuenta no se activa.`);
    if (pu.status === 'LOCKED') G.fail('RN-OPS-01', 'La cuenta está bloqueada. Un administrador de plataforma la reactiva en OPS-12.');
    if (pu.status === 'DISABLED') G.fail('RN-OPS-01', 'La cuenta está dada de baja.');
    if (pu.password_hash !== G.auth.hash(password || '')) {
      pu.failed_logins = (pu.failed_logins || 0) + 1;
      if (pu.failed_logins >= 5) { rupd(pu, { status: 'LOCKED', disabled_reason: 'Intentos fallidos' }); O.paudit('CONSOLE_LOCKED', { pu, reason: '5 intentos fallidos', detail: { ip } }); G.fail('RN-OPS-01', 'Cuenta bloqueada tras 5 intentos fallidos.'); }
      G.db.touch(); G.fail('RN-OPS-01', `Correo o contraseña incorrectos. Te quedan ${5 - pu.failed_logins} intento(s).`);
    }
    if (!pu.twofa_enabled) G.fail('RN-OPS-01', 'El segundo factor es obligatorio para la consola.');
    if (!G.auth.verify2fa(pu, code)) { O.paudit('CONSOLE_LOGIN_FAILED', { pu, reason: 'Código de segundo factor incorrecto', detail: { ip } }); G.fail('RN-OPS-01', 'El código de segundo factor no es válido o ya venció.'); }
    const allow = O.pparam('ops_console_ip_allowlist') || [];
    if (!O.ipIn(ip, allow)) { O.paudit('CONSOLE_LOGIN_BLOCKED', { pu, reason: `IP ${ip} fuera de la lista permitida`, detail: { ip, allow } }); G.fail('RN-OPS-16', `La consola solo acepta conexiones desde ${allow.join(', ')}; tu IP ${ip} no está en la lista.`); }
    rupd(pu, { failed_logins: 0, last_login_at: now() });
    G.ctx.opsConsole = { platform_user_id: pu.id, at: now(), ip, last: now() };
    O.paudit('CONSOLE_LOGIN', { pu, reason: 'Inicio de sesión en la consola', detail: { ip } });
    G.db.save();
    return pu;
  };
  O.consoleLogout = function (reason = 'Cierre manual') { const c = G.ctx.opsConsole; if (c) { O.paudit('CONSOLE_LOGOUT', { pu: rget('platform_users', c.platform_user_id), reason }); } G.ctx.opsConsole = null; G.db.save(); };
  /** tareas de cada minuto: vencer accesos, cerrar tickets resueltos y cerrar la consola por inactividad (RN-OPS-09/15/16) */
  O.tick = function (at = now()) {
    O.expireDue(at);
    O.autoCloseTickets(at);
    const c = G.ctx.opsConsole;
    if (c) {
      const lim = Number(O.pparam('ops_console_session_minutes') || 30);
      if (c.last && (ms(at) - ms(c.last)) / 60000 > lim) { O.consoleLogout(`Inactividad de más de ${lim} minutos (RN-OPS-16)`); ui.toast(`RN-OPS-16: la sesión de consola se cerró tras ${lim} minutos de inactividad.`, 'warn'); }
      else c.last = at;
    }
  };

  /* ------------------------------------------------------------------
     Bitácora de la consola (solo inserción, RN-OPS-05 y RN-OPS-11)
     ------------------------------------------------------------------ */
  O.paudit = function (action, { tenant = null, entity = null, entity_id = null, reason = null, detail = {}, pu, at } = {}) {
    const a = pu === undefined ? O.actor() : pu;
    if (tenant && !reason) G.fail('RN-OPS-11', 'Toda acción de la consola sobre una empresa guarda un motivo.');
    return gins('platform_audit_log', { platform_user_id: a ? a.id : null, actor_name: a ? a.full_name : 'Sistema', action, target_tenant_id: tenant, entity, entity_id, reason, ip: a && a.id ? O.actorIp() : null, user_agent: 'Aycha Console/1.0', detail, occurred_at: at || now() });
  };

  /* ------------------------------------------------------------------
     Empresas (tenants), planes y suscripciones
     ------------------------------------------------------------------ */
  O.tenants = () => raw('tenants').filter(t => !t.sandbox_of);
  O.tenantName = id => { const t = rget('tenants', id); return t ? (t.short || t.name) : (id || '—'); };
  /** catálogo de respaldo (precios de ejemplo, D-SUS-01) si SUS no está cargado */
  const PLANS = {
    INICIAL: { name: 'Inicial', price: 290, limits: { USERS: 5, BRANDS: 1, ESTABLISHMENTS: 1, ORDERS_MONTH: 500, WHATSAPP_NUMBERS: 1, API_CALLS_DAY: 0 } },
    CRECER: { name: 'Crecer', price: 590, limits: { USERS: 15, BRANDS: 3, ESTABLISHMENTS: 2, ORDERS_MONTH: 2000, WHATSAPP_NUMBERS: 3, API_CALLS_DAY: 5000 } },
    MULTIMARCA: { name: 'Multimarca', price: 1190, limits: { USERS: 40, BRANDS: 8, ESTABLISHMENTS: 5, ORDERS_MONTH: 6000, WHATSAPP_NUMBERS: 8, API_CALLS_DAY: 20000 } },
    PILOTO: { name: 'Piloto (Multimarca)', price: 1190, limits: { USERS: 40, BRANDS: 8, ESTABLISHMENTS: 5, ORDERS_MONTH: 6000, WHATSAPP_NUMBERS: 8, API_CALLS_DAY: 5000 } },
  };
  O.PLANS = PLANS;
  const LIMIT_NAMES = { USERS: 'Usuarios', BRANDS: 'Marcas', ESTABLISHMENTS: 'Locales', ORDERS_MONTH: 'Pedidos del mes', WHATSAPP_NUMBERS: 'Números de WhatsApp', API_CALLS_DAY: 'Llamadas a la API por día', COMPANIES: 'Empresas (RUC)', STORAGE_GB: 'Almacenamiento (GB)', TEL_MINUTES_MONTH: 'Minutos de telefonía' };
  O.plan = function (code) {
    const sp = raw('saas_plans').filter(p => p.code === code).sort(U.by('version', -1))[0];
    const fb = PLANS[code] || PLANS.CRECER;
    if (!sp) return Object.assign({ code }, fb);
    const lim = {}; for (const l of raw('saas_plan_limits').filter(x => x.plan_id === sp.id)) lim[l.limit_key] = l.limit_value;
    return { code, name: sp.name || fb.name, price: sp.price ?? fb.price, limits: Object.keys(lim).length ? lim : fb.limits };
  };
  O.planLimit = (code, key) => { const v = (O.plan(code).limits || {})[key]; return v === undefined ? null : v; };
  /** suscripción normalizada del tenant (de SUS si existe; si no, la de respaldo) */
  O.sub = function (tid) {
    const t = rget('tenants', tid); if (!t) return null;
    const rows = raw('subscriptions').filter(s => s.tenant === tid).sort((a, b) => (a.status === 'CANCELLED') - (b.status === 'CANCELLED') || String(b.created_at).localeCompare(a.created_at));
    const s = rows[0] || { id: null, status: t.status === 'ACTIVE' ? 'ACTIVE' : t.status, created_at: '2026-06-01T09:00', plan_code: t.plan, billing_period: 'MONTHLY' };
    const sp = s.plan_id ? rget('saas_plans', s.plan_id) : null;
    const code = s.plan_code || (sp && sp.code) || t.plan || 'CRECER';
    const fb = PLANS[code] || PLANS.CRECER;
    const period = s.billing_period || (sp && sp.billing_period) || 'MONTHLY';
    const price = s.agreed_price ?? (sp && sp.price) ?? (period === 'ANNUAL' ? fb.price * 10 : fb.price);
    const disc = Number(s.discount_pct || 0);
    const monthly = R((period === 'ANNUAL' ? price / 12 : price) * (1 - disc / 100));
    return {
      id: s.id, tenant: tid, tenantRow: t, plan_code: code, plan_name: s.plan_name || (sp && sp.name) || fb.name, period, price, discount_pct: disc, monthly_fee: monthly,
      status: s.status, prev_status: s.prev_status || 'ACTIVE', status_changed_at: s.status_changed_at || s.created_at, status_reason: s.status_reason || null,
      created_at: s.started_at || s.created_at, trial_started_at: s.trial_started_at || (s.trial_ends_at ? s.created_at : null), trial_ends_at: s.trial_ends_at || null,
      activated_at: s.activated_at || (s.status !== 'TRIAL' ? (s.current_period_start || s.created_at) : null), cancelled_at: s.cancelled_at || null, suspended_at: s.suspended_at || null,
      past_due_since: s.past_due_since || null, first_doc_at: s.first_doc_at || null, changes: s.fee_changes || [], row: s.id ? s : null,
    };
  };
  O.subs = () => O.tenants().map(t => O.sub(t.id)).filter(Boolean);
  O.daysInStatus = s => s.status_changed_at ? G.date.diff(G.TODAY, s.status_changed_at.slice(0, 10)) : null;

  /* ------------------------------------------------------------------
     Señales de cada empresa y salud ponderada (RN-OPS-13)
     ------------------------------------------------------------------ */
  const LIVE = tid => raw('sales_orders').some(o => o.tenant === tid) || tid === 'CS';
  function liveSignals(tid) {
    const d7 = G.date.add(G.TODAY, -6), d37 = G.date.add(G.TODAY, -36), d30 = G.date.add(G.TODAY, -29), mon = G.date.month(G.TODAY);
    let last7 = 0, prev30 = 0, orders_month = 0;
    for (const o of raw('sales_orders')) { if (o.tenant !== tid) continue; const d = String(o.created_at).slice(0, 10); if (d >= d7) last7++; else if (d >= d37) prev30++; if (d >= mon) orders_month++; }
    let sent = 0, rejected = 0;
    for (const d of raw('sales_documents')) { if (d.tenant !== tid || d.issue_date < d30) continue; if (d.sunat_status !== 'PENDING') sent++; if (d.sunat_status === 'REJECTED') rejected++; }
    let wsent = 0, wfail = 0, messages_month = 0;
    for (const m of raw('messages')) { if (m.tenant !== tid || m.direction !== 'OUT') continue; const d = String(m.sent_at || m.created_at).slice(0, 10); if (d >= mon) messages_month++; if (d >= d7) { wsent++; if (m.status === 'FAILED') wfail++; } }
    const chans = raw('messaging_channels').filter(c => c.tenant === tid && c.kind === 'WHATSAPP');
    const conn = raw('integration_connectors').filter(c => c.tenant === tid);
    const connState = (kind, provider) => { const c = conn.find(x => x.kind === kind && (!provider || x.provider === provider)); if (!c) return null; return c.status === 'ERROR' ? 'DOWN' : (c.consecutive_failures || 0) > 0 ? 'DEGRADED' : c.status === 'ACTIVE' ? 'UP' : 'NA'; };
    const lastOse = raw('platform_component_checks').filter(c => c.component === 'OSE').sort(U.by('checked_at', -1))[0];
    const users = raw('users').filter(u => u.tenant === tid && u.status === 'ACTIVE' && !u.support && u.role !== 'SOPORTE_PLATAFORMA').length;
    return {
      live: true,
      usage: { last7, prev30 }, ose: { sent, rejected }, whatsapp: { sent: wsent, failed: wfail },
      integrations: {
        OSE: connState('EINVOICE') || (rejected > 0 && sent && rejected / sent > 0.05 ? 'DEGRADED' : lastOse ? lastOse.status : 'UP'),
        WHATSAPP: connState('MESSAGING', 'WHATSAPP_CLOUD') || (!chans.length ? 'NA' : chans.some(c => ['LOW', 'RED'].includes(c.quality_rating)) ? 'DOWN' : chans.some(c => c.quality_rating === 'MEDIUM') ? 'DEGRADED' : 'UP'),
        MERCADOPAGO: connState('PAYMENT', 'MERCADOPAGO') || (raw('cash_accounts').some(c => c.tenant === tid && c.account_type === 'GATEWAY') ? 'UP' : 'NA'),
      },
      volume: { orders_month, messages_month, users },
      limits_used: { USERS: users, BRANDS: raw('brands').filter(b => b.tenant === tid && b.status === 'ACTIVE').length, ESTABLISHMENTS: raw('establishments').filter(e => e.tenant === tid).length, ORDERS_MONTH: orders_month, WHATSAPP_NUMBERS: chans.length, API_CALLS_DAY: U.sum(raw('api_usage_daily').filter(x => x.tenant === tid && x.day === G.TODAY), x => x.requests) },
    };
  }
  O.signals = function (tid) {
    const sub = O.sub(tid);
    let sg;
    if (LIVE(tid)) sg = liveSignals(tid);
    else { const snap = raw('tenant_health_snapshots').filter(s => s.target_tenant_id === tid).sort(U.by('computed_at', -1))[0]; sg = U.clone((snap && snap.components && snap.components.inputs) || {}); sg.live = false; }
    sg.usage = sg.usage || { last7: 0, prev30: 0 }; sg.ose = sg.ose || { sent: 0, rejected: 0 }; sg.whatsapp = sg.whatsapp || { sent: 0, failed: 0 };
    sg.integrations = sg.integrations || { OSE: 'NA', WHATSAPP: 'NA', MERCADOPAGO: 'NA' }; sg.volume = sg.volume || {}; sg.limits_used = sg.limits_used || {};
    // cobro: días de mora del comprobante del SaaS impago más antiguo (o desde que pasó a mora)
    const inv = raw('saas_invoices').filter(i => i.tenant === tid && ['OPEN', 'UNCOLLECTIBLE'].includes(i.status) && i.due_date < G.TODAY).sort(U.by('due_date'))[0];
    const since = (sub && sub.past_due_since) || (inv && inv.due_date);
    sg.billing = { days_past_due: since && sub && ['PAST_DUE', 'READ_ONLY', 'SUSPENDED'].includes(sub.status) ? Math.max(0, G.date.diff(G.TODAY, since.slice(0, 10))) : (inv ? Math.max(0, G.date.diff(G.TODAY, inv.due_date)) : 0) };
    const tks = raw('support_tickets').filter(t => t.tenant === tid && !['RESOLVED', 'CLOSED'].includes(t.status));
    sg.tickets = { open: tks.length, urgent: tks.filter(t => t.priority === 'URGENT').length, high: tks.filter(t => t.priority === 'HIGH').length };
    return sg;
  };
  /** puntaje 0–100 por componente y total ponderado */
  O.healthScore = function (sg, weights = O.weights()) {
    const clamp = v => Math.max(0, Math.min(100, Math.round(v)));
    const u = sg.usage; const ratio = u.prev30 > 0 ? (u.last7 / 7) / (u.prev30 / 30) : (u.last7 > 0 ? 1 : 0);
    const oseRate = sg.ose.sent ? sg.ose.rejected / sg.ose.sent * 100 : 0;
    const waRate = sg.whatsapp.sent ? sg.whatsapp.failed / sg.whatsapp.sent * 100 : 0;
    const tw = (sg.tickets.open - sg.tickets.urgent - sg.tickets.high) + sg.tickets.urgent * 2 + sg.tickets.high * 1.5;
    const parts = {
      usage: { label: 'Uso', score: clamp(ratio * 100), detail: `${u.last7} pedidos en 7 días frente a ${u.prev30} en los 30 anteriores (ritmo ${G.fmt.pct(ratio * 100, 0)})` },
      billing: { label: 'Cobro', score: clamp(100 - sg.billing.days_past_due * 100 / 30), detail: sg.billing.days_past_due ? `${sg.billing.days_past_due} días de mora` : 'Al día' },
      ose: { label: 'OSE', score: clamp(100 - oseRate * 10), detail: sg.ose.sent ? `${sg.ose.rejected} rechazos de ${sg.ose.sent} comprobantes (${G.fmt.pct(oseRate)})` : 'Sin comprobantes en 30 días' },
      whatsapp: { label: 'WhatsApp', score: clamp(100 - waRate * 10), detail: sg.whatsapp.sent ? `${sg.whatsapp.failed} errores de ${sg.whatsapp.sent} envíos en 7 días (${G.fmt.pct(waRate)})` : 'Sin envíos registrados' },
      tickets: { label: 'Tickets', score: clamp(100 - tw * 20), detail: `${sg.tickets.open} abiertos (${sg.tickets.urgent} urgentes, ${sg.tickets.high} de prioridad alta)` },
    };
    const tot = U.sum(Object.keys(parts), k => weights[k] || 0) || 1;
    const score = Math.round(U.sum(Object.keys(parts), k => parts[k].score * (weights[k] || 0)) / tot);
    for (const k of Object.keys(parts)) parts[k].weight = weights[k] || 0;
    const th = thresholds();
    return { score, level: score < th.critical ? 'CRITICAL' : score < th.risk ? 'AT_RISK' : 'HEALTHY', parts };
  };
  O.health = tid => { const sg = O.signals(tid); return Object.assign(O.healthScore(sg), { inputs: sg }); };
  O.snapshotHealth = function (tid, at = now()) {
    const hs = O.health(tid);
    return gins('tenant_health_snapshots', { target_tenant_id: tid, computed_at: at, score: hs.score, level: hs.level, components: { parts: hs.parts, inputs: hs.inputs, weights: O.weights() } });
  };
  /** uso por límite del plan (de usage_counters de SUS si existe) */
  O.usage = function (tid, sg = O.signals(tid)) {
    const sub = O.sub(tid); const lim = O.plan(sub.plan_code).limits || {};
    const counters = raw('usage_counters').filter(c => c.tenant === tid && c.period === G.date.month(G.TODAY));
    return Object.keys(LIMIT_NAMES).filter(k => lim[k] !== undefined).map(k => {
      const c = counters.find(x => x.limit_key === k);
      const used = c ? Number(c.used) : Number(sg.limits_used[k] || 0); const limit = c && c.limit_value != null ? Number(c.limit_value) : lim[k];
      return { key: k, name: LIMIT_NAMES[k], used, limit, pct: limit ? R(used / limit * 100, 1) : (used ? 100 : 0) };
    });
  };
  O.tenantRow = function (t) {
    const sub = O.sub(t.id); const sg = O.signals(t.id); const hs = O.healthScore(sg); const us = O.usage(t.id, sg);
    const grants = raw('support_access_grants').filter(g => g.tenant === t.id && g.status === 'APPROVED').length;
    return { id: t.id, name: t.name, short: t.short || t.name, product: 'Aycha Comercial', plan: sub.plan_name, plan_code: sub.plan_code, period: sub.period, status: sub.status, days: O.daysInStatus(sub), mrr: M.activeAt(sub, G.TODAY) ? sub.monthly_fee : 0, usageMax: us.length ? Math.max(...us.map(x => x.pct)) : 0, usage: us, score: hs.score, level: hs.level, health: hs, tickets: sg.tickets.open, integrations: sg.integrations, grants, signals: sg };
  };

  /* ------------------------------------------------------------------
     Métricas del negocio SaaS (KPI-OPS-01 a 13) · funciones puras
     ------------------------------------------------------------------ */
  const M = O.metrics = {};
  M.statusAt = (s, d) => (s.status_changed_at && s.status_changed_at.slice(0, 10) <= d) ? s.status : (s.prev_status || 'ACTIVE');
  M.activeAt = (s, d, statuses = ['ACTIVE', 'PAST_DUE']) => !!s.activated_at && s.activated_at.slice(0, 10) <= d && (!s.cancelled_at || s.cancelled_at.slice(0, 10) > d) && statuses.includes(M.statusAt(s, d));
  M.feeAt = (s, d) => { const later = (s.changes || []).filter(c => c.at.slice(0, 10) > d).sort((a, b) => a.at < b.at ? -1 : 1); return later.length ? later[0].from_fee : s.monthly_fee; };
  /** suscripción de ejemplo para pruebas: {period, price, discount_pct, activated_at, status} */
  M.fromPlan = o => Object.assign({ status: 'ACTIVE', activated_at: '2026-01-01', changes: [], discount_pct: 0 }, o, { monthly_fee: R((o.period === 'ANNUAL' ? o.price / 12 : o.price) * (1 - (o.discount_pct || 0) / 100)) });
  M.mrr = (subs, d = G.TODAY, statuses) => R(U.sum(subs.filter(s => M.activeAt(s, d, statuses)), s => M.feeAt(s, d)));
  M.active = (subs, d = G.TODAY) => new Set(subs.filter(s => M.activeAt(s, d)).map(s => s.tenant || s.id || Math.random())).size;
  M.arpa = (subs, d = G.TODAY) => { const n = subs.filter(s => M.activeAt(s, d)).length; return n ? R(M.mrr(subs, d) / n) : 0; };
  M.monthEnd = m => { const e = G.date.add(G.date.addMonths(m, 1), -1); return e > G.TODAY ? G.TODAY : e; };
  M.churn = (subs, m) => {
    const d0 = G.date.add(m, -1), d1 = M.monthEnd(m);
    const base = subs.filter(s => M.activeAt(s, d0));
    const lost = base.filter(s => s.cancelled_at && s.cancelled_at.slice(0, 10) > d0 && s.cancelled_at.slice(0, 10) <= d1);
    return { value: base.length ? R(lost.length / base.length * 100, 2) : 0, numerator: lost.length, denominator: base.length };
  };
  M.moves = (subs, m) => {
    const d0 = G.date.add(m, -1), d1 = M.monthEnd(m);
    let start = 0, exp = 0, contr = 0, cancel = 0;
    for (const s of subs.filter(x => M.activeAt(x, d0))) {
      const f0 = M.feeAt(s, d0); start += f0;
      if (s.cancelled_at && s.cancelled_at.slice(0, 10) <= d1) { cancel += f0; continue; }
      const f1 = M.feeAt(s, d1); if (f1 > f0) exp += f1 - f0; else contr += f0 - f1;
    }
    return { start: R(start), exp: R(exp), contr: R(contr), cancel: R(cancel) };
  };
  M.grossMrrChurn = (subs, m) => { const x = M.moves(subs, m); return { value: x.start ? R((x.cancel + x.contr) / x.start * 100, 2) : 0, numerator: R(x.cancel + x.contr), denominator: x.start }; };
  M.nrr = (subs, m) => { const x = M.moves(subs, m); return { value: x.start ? R((x.start + x.exp - x.contr - x.cancel) / x.start * 100, 2) : 0, numerator: R(x.start + x.exp - x.contr - x.cancel), denominator: x.start }; };
  M.trialConversion = (subs, m) => {
    const d1 = M.monthEnd(m);
    const trials = subs.filter(s => s.trial_started_at || s.trial_ends_at);
    const conv = trials.filter(s => s.activated_at && s.activated_at.slice(0, 10) >= m && s.activated_at.slice(0, 10) <= d1);
    const ended = trials.filter(s => conv.includes(s) || (!s.activated_at && s.trial_ends_at && s.trial_ends_at.slice(0, 10) >= m && s.trial_ends_at.slice(0, 10) <= d1 && s.trial_ends_at.slice(0, 10) <= G.TODAY));
    return { value: ended.length ? R(conv.length / ended.length * 100, 1) : 0, numerator: conv.length, denominator: ended.length };
  };
  M.arrears = (subs, d = G.TODAY) => { const tot = M.mrr(subs, d, ['ACTIVE', 'PAST_DUE', 'READ_ONLY']); const late = M.mrr(subs, d, ['PAST_DUE', 'READ_ONLY']); return { value: tot ? R(late / tot * 100, 2) : 0, numerator: late, denominator: tot }; };
  const median = arr => { const a = arr.filter(x => x !== null && x !== undefined && isFinite(x)).sort((x, y) => x - y); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  O.median = median;
  M.usageByPlan = (d = G.TODAY) => {
    const out = {};
    for (const t of O.tenants()) { const s = O.sub(t.id); if (!M.activeAt(s, d)) continue; for (const u of O.usage(t.id)) { if (!u.limit) continue; const k = s.plan_name + '|' + u.key; (out[k] = out[k] || { plan: s.plan_name, key: u.key, name: u.name, vals: [] }).vals.push(u.pct); } }
    return Object.values(out).map(x => Object.assign(x, { avg: R(U.sum(x.vals) / x.vals.length, 1), n: x.vals.length }));
  };
  M.onboardingDays = () => median(O.subs().map(s => { let first = s.first_doc_at; if (!first && LIVE(s.tenant)) { const d = raw('sales_documents').filter(x => x.tenant === s.tenant && x.sunat_status === 'ACCEPTED').sort(U.by('issue_date'))[0]; first = d && d.issue_date; } return first && s.created_at ? Math.max(0, G.date.diff(first.slice(0, 10), s.created_at.slice(0, 10))) : null; }));
  O.firstResponseH = t => t.first_response_at ? (t.priority === 'URGENT' ? hoursBetween(t.opened_at, t.first_response_at) : O.bizHours(t.opened_at, t.first_response_at)) : null;
  M.firstResponseMedian = (m, prio) => { const d1 = M.monthEnd(m); return median(raw('support_tickets').filter(t => t.opened_at.slice(0, 10) >= m && t.opened_at.slice(0, 10) <= d1 && (!prio || t.priority === prio)).map(O.firstResponseH)); };
  M.availability = (component, from, to) => {
    let up = 0, tot = 0;
    for (const c of raw('platform_component_checks')) {
      if (component && c.component !== component) continue; const d = c.checked_at.slice(0, 10); if (d < from || d > to) continue;
      const dt = c.detail || {}; const n = dt.samples || 1;
      const u = dt.up !== undefined ? dt.up : (c.status === 'UP' ? n : 0); const dg = dt.degraded !== undefined ? dt.degraded : (c.status === 'DEGRADED' ? n : 0);
      up += u + dg * 0.5; tot += n;
    }
    return { value: tot ? R(up / tot * 100, 3) : null, numerator: up, denominator: tot };
  };
  O.computeMonth = function (m) {
    const subs = O.subs(); const d1 = M.monthEnd(m); const mrr = M.mrr(subs, d1); const act = subs.filter(s => M.activeAt(s, d1)).length;
    const opened = raw('support_tickets').filter(t => t.opened_at.slice(0, 10) >= m && t.opened_at.slice(0, 10) <= d1).length;
    const up = M.usageByPlan(d1);
    return {
      'KPI-OPS-01': { value: mrr }, 'KPI-OPS-02': { value: act }, 'KPI-OPS-03': M.churn(subs, m), 'KPI-OPS-04': M.grossMrrChurn(subs, m), 'KPI-OPS-05': M.nrr(subs, m),
      'KPI-OPS-06': { value: act ? R(mrr / act) : 0, numerator: mrr, denominator: act }, 'KPI-OPS-07': M.trialConversion(subs, m),
      'KPI-OPS-08': { value: up.length ? R(U.sum(up, x => x.avg) / up.length, 1) : null }, 'KPI-OPS-09': { value: M.onboardingDays() },
      'KPI-OPS-10': { value: act ? R(opened / act, 2) : 0, numerator: opened, denominator: act }, 'KPI-OPS-11': { value: M.firstResponseMedian(m) === null ? null : R(M.firstResponseMedian(m), 2) },
      'KPI-OPS-12': M.availability(null, m, d1), 'KPI-OPS-13': M.arrears(subs, d1),
    };
  };
  /** congela las métricas del mes (RN-OPS-17): otra corrida no borra la anterior */
  O.freezeMonth = function (m, opts = {}) {
    if (!opts.system) O.passert('metrics.freeze');
    const vals = O.computeMonth(m);
    const runs = raw('platform_metric_snapshots').filter(x => x.period === m).map(x => x.run_no);
    const run_no = (runs.length ? Math.max(...runs) : 0) + 1;
    for (const [code, v] of Object.entries(vals)) { const def = raw('platform_kpi_definitions').find(k => k.code === code); gins('platform_metric_snapshots', { kpi_id: def ? def.id : code, kpi_code: code, period: m, dimension_key: 'ALL', value: v.value ?? null, numerator: v.numerator ?? null, denominator: v.denominator ?? null, run_no, computed_at: opts.at || now() }); }
    if (!opts.system) O.paudit('METRICS_FROZEN', { reason: `Cierre de ${G.date.monthName(m)} · corrida ${run_no}`, detail: { period: m, run_no } });
    return run_no;
  };

  /* ------------------------------------------------------------------
     Notificaciones a los administradores del cliente
     ------------------------------------------------------------------ */
  O.notifyAdmins = function (tid, title, body, ref, tone = 'info') {
    const admins = raw('users').filter(u => u.tenant === tid && ['ADMIN_SISTEMA', 'GERENTE'].includes(u.role) && u.status === 'ACTIVE' && !u.support);
    for (const u of admins) G.db.insert('notifications', { user_id: u.id, title, body, ref, tone, module: 'OPS', read_at: null, at: now(), tenant: tid }, { silent: true });
    return admins.length;
  };

  /* ------------------------------------------------------------------
     Suspender o reactivar (RN-OPS-07)
     ------------------------------------------------------------------ */
  O.STATUS_EFFECT = {
    READ_ONLY: 'Solo lectura: los usuarios entran, consultan y exportan, pero no registran pedidos, comprobantes ni cobros. WhatsApp sigue recibiendo mensajes.',
    SUSPENDED: 'Suspensión total: nadie entra a la aplicación; ven la página de suspensión con el motivo y el contacto de Intelectalab. Los datos se conservan y la API responde 403.',
    ACTIVE: 'Activa: se restablece el acceso completo de todos los usuarios y de la API.',
  };
  O.setTenantStatus = function (tid, to, reason, opts = {}) {
    const a = O.passert('tenant.status');
    if (!reason || String(reason).trim().length < 5) G.fail('RN-OPS-07', 'Suspender, pasar a solo lectura o reactivar una empresa exige un motivo.');
    if (!['READ_ONLY', 'SUSPENDED', 'ACTIVE'].includes(to)) G.fail('RN-OPS-07', 'Estado no permitido.');
    const t = rget('tenants', tid); if (!t) G.fail('RN-OPS-07', 'Empresa no encontrada.');
    const s = O.sub(tid); const from = s.status;
    if (from === to) G.fail('RN-OPS-07', `La empresa ya está en «${SL[to][0]}».`);
    if (from === 'CANCELLED') G.fail('RN-OPS-07', 'Una suscripción cancelada no se reactiva desde la consola: se crea una nueva en SUS.');
    const at = opts.at || now();
    let row = s.row;
    if (!row) row = tins('subscriptions', tid, { product_id: 'AYCHA_COMERCIAL', plan_code: s.plan_code, plan_name: s.plan_name, billing_period: s.period, status: from, created_at: s.created_at, activated_at: s.activated_at, ops_fallback: true });
    rupd(row, { prev_status: from, status: to, status_reason: reason, status_changed_at: at, suspended_at: to === 'SUSPENDED' ? at : null, past_due_since: to === 'ACTIVE' ? null : row.past_due_since });
    rupd(t, { status: to === 'ACTIVE' ? 'ACTIVE' : to, status_reason: reason });
    tins('subscription_events', tid, { subscription_id: row.id, event_type: 'STATUS_CHANGED', from_status: from, to_status: to, reason, actor_type: 'PLATFORM_USER', actor_id: a.id, actor_name: a.full_name, occurred_at: at, detail: { category: opts.category || null } });
    O.paudit(to === 'ACTIVE' ? 'TENANT_REACTIVATED' : to === 'SUSPENDED' ? 'TENANT_SUSPENDED' : 'TENANT_READ_ONLY', { tenant: tid, entity: 'subscriptions', entity_id: row.id, reason, detail: { from, to, category: opts.category || null } });
    O.notifyAdmins(tid, to === 'ACTIVE' ? 'Tu cuenta Aycha fue reactivada' : to === 'SUSPENDED' ? 'Tu cuenta Aycha fue suspendida' : 'Tu cuenta Aycha está en solo lectura', `${reason}. ${O.STATUS_EFFECT[to]}`, 'OPS-15', to === 'ACTIVE' ? 'ok' : 'bad');
    G.events.emit(to === 'ACTIVE' ? 'tenant.reactivated' : 'tenant.suspended', { tenant: tid, from, to, reason });
    return row;
  };
  O.suspensionPage = function (tid) {
    const t = rget('tenants', tid) || {}; const s = O.sub(tid) || {};
    return h('div', { style: 'border:1px solid var(--line);border-radius:12px;padding:24px;background:var(--surface);text-align:center;display:grid;gap:10px;justify-items:center' },
      h('div', { class: 'mono muted small' }, (t.hostname || '') + ' · Aycha'),
      h('h2', { style: 'margin:0' }, s.status === 'READ_ONLY' ? 'Tu cuenta está en modo solo lectura' : 'Tu cuenta está suspendida'),
      h('p', { class: 'muted', style: 'max-width:520px;margin:0' }, `${t.name || ''}: ${s.status_reason || 'sin motivo registrado'}.`),
      h('p', { class: 'small', style: 'max-width:520px;margin:0' }, O.STATUS_EFFECT[s.status] || ''),
      h('p', { class: 'small muted', style: 'margin:0' }, 'Escríbenos a soporte@intelectalab.com o al +51 1 640 2200 para regularizarla. Tus datos se conservan.'));
  };

  /* ------------------------------------------------------------------
     Tickets de soporte (RN-OPS-15)
     ------------------------------------------------------------------ */
  const nextTicketNo = () => { const n = Math.max(100, ...raw('support_tickets').map(t => Number(String(t.number).replace(/\D/g, '')) || 0)) + 1; return 'TK-' + U.pad(n, 4); };
  O.slaHours = prio => O.frHours()[prio] ?? 8;
  O.slaDeadline = t => t.priority === 'URGENT' ? addH(t.opened_at, O.slaHours('URGENT')) : O.addBizHours(t.opened_at, O.slaHours(t.priority));
  /** estado del plazo de primera respuesta: {target, deadline, elapsed, met (true/false/null), breached} */
  O.sla = function (t, at = now()) {
    const target = O.slaHours(t.priority); const deadline = O.slaDeadline(t);
    if (t.first_response_at) { const e = O.firstResponseH(t); return { target, deadline, elapsed: e, met: e <= target + 1e-9, breached: e > target + 1e-9 }; }
    const e = t.priority === 'URGENT' ? hoursBetween(t.opened_at, at) : O.bizHours(t.opened_at, at);
    return { target, deadline, elapsed: e, met: null, breached: ms(at) > ms(deadline) && !['RESOLVED', 'CLOSED'].includes(t.status) };
  };
  const slaBadge = t => { const s = O.sla(t); if (s.met === true) return ui.badge(`Cumplido · ${fmtH(s.elapsed)}`, 'ok'); if (s.met === false) return ui.badge(`Fuera de plazo · ${fmtH(s.elapsed)}`, 'bad'); if (['RESOLVED', 'CLOSED'].includes(t.status)) return ui.badge('Sin respuesta', ''); return s.breached ? ui.badge('Vencido ' + G.fmt.datetime(s.deadline), 'bad') : ui.badge('Vence ' + G.fmt.datetime(s.deadline).slice(-5) + (s.deadline.slice(0, 10) !== G.TODAY ? ' ' + G.fmt.date(s.deadline).slice(0, 5) : ''), 'warn'); };
  O.openTicket = function (v, opts = {}) {
    const tid = opts.tenant || G.ctx.tenant;
    if (!opts.system && !G.can('ops.ticket.create')) G.fail('RN-OPS-06', `Tu rol (${G.roleName()}) no tiene el permiso ops.ticket.create para abrir tickets.`);
    if (!v.subject || String(v.subject).trim().length < 6) G.fail('RN-OPS-15', 'Escribe un asunto claro (mínimo 6 caracteres).');
    if (!v.description || String(v.description).trim().length < 10) G.fail('RN-OPS-15', 'Describe el problema (mínimo 10 caracteres): qué pasó, dónde y cuándo.');
    const at = opts.at || now();
    const t = tins('support_tickets', tid, { number: nextTicketNo(), subject: v.subject.trim(), description: v.description.trim(), category: v.category || 'OTHER', priority: v.priority || 'NORMAL', status: 'OPEN', opened_by: opts.user_id || G.ctx.userId(), opened_by_name: opts.user_name || G.ctx.userName(), assigned_platform_user: null, incident_id: v.incident_id || null, opened_at: at, first_response_at: null, resolved_at: null, closed_at: null, satisfaction: null, attachments: v.attachments || [], replies: [], history: [{ at, to: 'OPEN', by: opts.user_name || G.ctx.userName() }] });
    if (!opts.system) G.events.emit('ticket.opened', { ticket_id: t.id, number: t.number, tenant: tid, priority: t.priority });
    return t;
  };
  O.replyTicket = function (id, text, opts = {}) {
    const t = rget('support_tickets', id); if (!t) G.fail('RN-OPS-15', 'Ticket no encontrado.');
    if (!text || String(text).trim().length < 2) G.fail('RN-OPS-15', 'Escribe la respuesta.');
    if (t.status === 'CLOSED') G.fail('RN-OPS-15', 'El ticket está cerrado: abre uno nuevo.');
    const at = opts.at || now(); const platform = opts.by === 'PLATFORM';
    let a = null; if (platform) a = opts.system ? SYSTEM : O.passert('ticket.manage', opts.pu);
    t.replies = t.replies || [];
    t.replies.push({ at, by_type: platform ? 'PLATFORM' : 'CUSTOMER', by: platform ? a.full_name : (opts.user_name || G.ctx.userName()), text: String(text).trim() });
    const patch = {};
    if (platform && !t.first_response_at) patch.first_response_at = at;
    if (platform && !t.assigned_platform_user && a.id) patch.assigned_platform_user = a.id;
    const to = opts.status || (platform ? 'WAITING_CUSTOMER' : 'IN_PROGRESS');
    if (to !== t.status) { (t.history = t.history || []).push({ at, from: t.status, to, by: platform ? a.full_name : G.ctx.userName() }); patch.status = to; if (to === 'RESOLVED') patch.resolved_at = at; }
    rupd(t, patch);
    if (platform && !opts.system) { O.paudit('TICKET_ANSWERED', { tenant: t.tenant, entity: 'support_tickets', entity_id: t.id, reason: `Respuesta al ticket ${t.number}`, detail: { status: to } }); G.events.emit('ticket.answered', { ticket_id: t.id, number: t.number }); }
    return t;
  };
  O.assignTicket = function (id, puid) { const a = O.passert('ticket.manage'); const t = rget('support_tickets', id); rupd(t, { assigned_platform_user: puid || a.id }); O.paudit('TICKET_ASSIGNED', { tenant: t.tenant, entity: 'support_tickets', entity_id: id, reason: `Asignado a ${(rget('platform_users', puid || a.id) || {}).full_name}` }); return t; };
  O.setTicketStatus = function (id, to, opts = {}) {
    const t = rget('support_tickets', id); const at = opts.at || now();
    if (t.status === 'CLOSED') G.fail('RN-OPS-15', 'El ticket ya está cerrado.');
    if (to === 'RESOLVED' && !opts.system) O.passert('ticket.manage');
    (t.history = t.history || []).push({ at, from: t.status, to, by: opts.by || (opts.system ? 'Sistema' : G.ctx.userName()), reason: opts.reason || null });
    rupd(t, { status: to, resolved_at: to === 'RESOLVED' ? at : t.resolved_at, closed_at: to === 'CLOSED' ? at : null });
    return t;
  };
  O.rateTicket = function (id, stars, comment) {
    const t = rget('support_tickets', id);
    if (!['RESOLVED', 'CLOSED'].includes(t.status)) G.fail('RN-OPS-15', 'Solo se califica un ticket resuelto.');
    if (!(stars >= 1 && stars <= 5)) G.fail('RN-OPS-15', 'La calificación va de 1 a 5.');
    if (comment) (t.replies = t.replies || []).push({ at: now(), by_type: 'CUSTOMER', by: G.ctx.userName(), text: comment });
    rupd(t, { satisfaction: Number(stars) });
    if (t.status === 'RESOLVED') O.setTicketStatus(id, 'CLOSED', { reason: 'Calificado por el cliente', by: G.ctx.userName() });
    return t;
  };
  /** RN-OPS-15: un ticket RESOLVED sin respuesta del cliente se cierra a los N días */
  O.autoCloseTickets = function (at = now()) {
    let n = 0;
    for (const t of raw('support_tickets').filter(x => x.status === 'RESOLVED' && x.resolved_at)) {
      const days = Number(G.param('ops_ticket_auto_close_days') ?? 7);
      const lastCust = (t.replies || []).filter(r => r.by_type === 'CUSTOMER' && r.at > t.resolved_at).length;
      if (!lastCust && hoursBetween(t.resolved_at, at) >= days * 24) { (t.history = t.history || []).push({ at, from: 'RESOLVED', to: 'CLOSED', by: 'Sistema', reason: `Sin respuesta del cliente en ${days} días (RN-OPS-15)` }); rupd(t, { status: 'CLOSED', closed_at: at }); n++; }
    }
    return n;
  };

  /* ------------------------------------------------------------------
     Acceso temporal de soporte (RN-OPS-02, 03, 04, 09, 12)
     ------------------------------------------------------------------ */
  const maxHours = () => Number(O.pparam('ops_support_max_hours') ?? 72);
  O.requestAccess = function (v, opts = {}) {
    const a = opts.pu || O.actor();
    const level = v.access_level || 'READ_ONLY';
    O.passert(level === 'READ_WRITE' ? 'access.request_rw' : 'access.request_ro', a);
    const tid = v.tenant; const t = rget('tenants', tid); if (!t) G.fail('RN-OPS-03', 'Elige la empresa.');
    if (!v.reason || String(v.reason).trim().length < 10) G.fail('RN-OPS-03', 'Explica el motivo del acceso (mínimo 10 caracteres): el cliente lo lee antes de aprobar.');
    const hrs = v.hours === undefined || v.hours === '' || v.hours === null ? Number(G.param('ops_support_default_hours') ?? 8) : Number(v.hours);
    if (!(hrs > 0)) G.fail('RN-OPS-02', 'La duración debe ser mayor que cero.');
    if (hrs > maxHours()) G.fail('RN-OPS-02', `Un acceso de soporte dura como máximo ${maxHours()} horas: pediste ${hrs}. Pide uno más corto y, si hace falta, otro después.`);
    const at = opts.at || now();
    const g = tins('support_access_grants', tid, { platform_user_id: a.id, platform_user_name: a.full_name, ticket_id: v.ticket_id || null, reason: String(v.reason).trim(), access_level: level, modules: v.modules || [], allow_export: !!v.allow_export, requested_hours: hrs, requested_at: at, status: 'REQUESTED', approved_by: null, approved_at: null, starts_at: null, expires_at: null, revoked_by: null, revoked_at: null, revoke_reason: null, support_user_id: null, session_open: false, first_used_at: null });
    O.paudit('ACCESS_REQUESTED', { pu: a, tenant: tid, entity: 'support_access_grants', entity_id: g.id, reason: g.reason, detail: { level, hours: hrs, modules: g.modules, export: g.allow_export }, at });
    O.notifyAdmins(tid, 'Intelectalab pide acceso de soporte', `${a.full_name} pide acceso de ${level === 'READ_ONLY' ? 'solo lectura' : 'lectura y escritura'} por ${hrs} h: ${g.reason}. Apruébalo o recházalo en OPS-14.`, 'OPS-14', 'warn');
    G.events.emit('support_access.requested', { grant_id: g.id, tenant: tid });
    return g;
  };
  function supportUser(g, pu) {
    return tins('users', g.tenant, { id: 'us-sup-' + g.id.replace(/[^a-z0-9]/gi, '').slice(-10), name: `Soporte Intelectalab · ${pu ? pu.full_name : ''}`.trim(), email: `soporte+${g.id.replace(/[^a-z0-9]/gi, '').slice(-6)}@intelectalab.com`, role: 'SOPORTE_PLATAFORMA', brands: [], sites: [], status: 'ACTIVE', support: true, twofa_enabled: true, platform_user_id: g.platform_user_id, support_grant_id: g.id, last_login: null });
  }
  O.approveAccess = function (id, opts = {}) {
    const g = rget('support_access_grants', id); if (!g) G.fail('RN-OPS-03', 'Solicitud no encontrada.');
    const role = opts.role || G.ctx.role;
    if (role === 'SOPORTE_PLATAFORMA') G.fail('RN-OPS-03', 'El acceso no nace aprobado: lo aprueba un usuario de la empresa, nunca el soporte.');
    if (!G.can('ops.support_access.approve', role)) G.fail('RN-OPS-03', `El rol ${G.roleName(role)} no tiene el permiso ops.support_access.approve: solo lo aprueban el administrador del sistema o la gerencia.`);
    if (g.tenant !== (opts.tenant || G.ctx.tenant)) G.fail('RN-OPS-06', 'Solo apruebas accesos a tu propia empresa.');
    if (g.status !== 'REQUESTED') G.fail('RN-OPS-03', `La solicitud está «${SL[g.status][0]}»: solo se aprueba una pendiente y una cerrada no se reabre. Si hace falta más tiempo, el soporte pide otro acceso.`);
    const hrs = opts.hours === undefined || opts.hours === null || opts.hours === '' ? Number(G.param('ops_support_default_hours') ?? 8) : Number(opts.hours);
    if (!(hrs > 0)) G.fail('RN-OPS-02', 'La duración debe ser mayor que cero.');
    if (hrs > maxHours()) G.fail('RN-OPS-02', `Un acceso de soporte dura como máximo ${maxHours()} horas.`);
    const at = opts.at || now();
    const pu = rget('platform_users', g.platform_user_id);
    const su = supportUser(g, pu);
    rupd(g, { status: 'APPROVED', approved_by: opts.user_id || G.ctx.userId(), approved_by_name: opts.user_name || G.ctx.userName(), approved_at: at, starts_at: at, expires_at: addH(at, hrs), approved_hours: hrs, support_user_id: su.id });
    O.paudit('ACCESS_APPROVED', { pu: SYSTEM, tenant: g.tenant, entity: 'support_access_grants', entity_id: g.id, reason: `Aprobado por ${g.approved_by_name} (${G.roleName(role)}) por ${hrs} h · ${g.reason}`, at });
    if (G.param('ops_support_notify_admins') !== false) O.notifyAdmins(g.tenant, 'Acceso de soporte aprobado', `${g.approved_by_name} aprobó el acceso de ${g.platform_user_name} (${g.access_level === 'READ_ONLY' ? 'solo lectura' : 'lectura y escritura'}) hasta el ${G.fmt.datetime(g.expires_at)}.`, 'OPS-14', 'info');
    G.events.emit('support_access.approved', { grant_id: g.id, tenant: g.tenant, expires_at: g.expires_at });
    return g;
  };
  O.rejectAccess = function (id, reason, opts = {}) {
    const g = rget('support_access_grants', id); const role = opts.role || G.ctx.role;
    if (!G.can('ops.support_access.approve', role) || role === 'SOPORTE_PLATAFORMA') G.fail('RN-OPS-03', `El rol ${G.roleName(role)} no puede rechazar accesos de soporte (permiso ops.support_access.approve).`);
    if (g.status !== 'REQUESTED') G.fail('RN-OPS-03', 'Solo se rechaza una solicitud pendiente.');
    if (!reason) G.fail('RN-OPS-03', 'Indica el motivo del rechazo.');
    rupd(g, { status: 'REJECTED', revoked_by: G.ctx.userId(), revoked_at: opts.at || now(), revoke_reason: reason });
    O.paudit('ACCESS_REJECTED', { pu: SYSTEM, tenant: g.tenant, entity: 'support_access_grants', entity_id: g.id, reason: `Rechazado por ${G.ctx.userName()}: ${reason}` });
    return g;
  };
  function closeGrant(g, status, at, reason, by) {
    const su = g.support_user_id && rget('users', g.support_user_id);
    if (su) rupd(su, { status: 'INACTIVE', support_closed_at: at });
    if (g.session_open) { tins('support_access_log', g.tenant, { grant_id: g.id, platform_user_id: g.platform_user_id, action: 'SESSION_END', entity: null, entity_id: null, detail: { reason }, ip: g.session_ip || null, occurred_at: at }); g.session_open = false; }
    if (G.ctx.opsSupportSession && G.ctx.opsSupportSession.grant_id === g.id) G.ctx.opsSupportSession = null;
    rupd(g, { status, revoked_at: status === 'REVOKED' ? at : g.revoked_at, revoke_reason: status === 'REVOKED' ? reason : g.revoke_reason, revoked_by: status === 'REVOKED' ? by : g.revoked_by, ended_at: at });
    if (G.param('ops_support_notify_admins') !== false) O.notifyAdmins(g.tenant, status === 'REVOKED' ? 'Acceso de soporte revocado' : 'Acceso de soporte vencido', `El acceso de ${g.platform_user_name} terminó (${status === 'REVOKED' ? 'revocado: ' + reason : 'venció a las ' + G.fmt.datetime(g.expires_at).slice(-5)}). El usuario técnico quedó inactivo.`, 'OPS-14', 'info');
  }
  O.revokeAccess = function (id, reason, opts = {}) {
    const g = rget('support_access_grants', id); const role = opts.role || G.ctx.role;
    if (!G.can('ops.support_access.revoke', role) || role === 'SOPORTE_PLATAFORMA') G.fail('RN-OPS-03', `El rol ${G.roleName(role)} no tiene el permiso ops.support_access.revoke.`);
    if (g.status !== 'APPROVED') G.fail('RN-OPS-03', 'Solo se revoca un acceso vigente.');
    if (!reason) G.fail('RN-OPS-09', 'Indica el motivo de la revocación.');
    const at = opts.at || now();
    closeGrant(g, 'REVOKED', at, reason, opts.user_id || G.ctx.userId());
    O.paudit('ACCESS_REVOKED', { pu: SYSTEM, tenant: g.tenant, entity: 'support_access_grants', entity_id: g.id, reason: `Revocado por ${G.ctx.userName()}: ${reason}`, at });
    G.events.emit('support_access.revoked', { grant_id: g.id, tenant: g.tenant });
    return g;
  };
  /** RN-OPS-09: los accesos vencen solos (tarea cada minuto) */
  O.expireDue = function (at = now()) {
    const due = raw('support_access_grants').filter(g => g.status === 'APPROVED' && g.expires_at && ms(g.expires_at) <= ms(at));
    for (const g of due) { closeGrant(g, 'EXPIRED', g.expires_at, 'Vencimiento', null); O.paudit('ACCESS_EXPIRED', { pu: SYSTEM, tenant: g.tenant, entity: 'support_access_grants', entity_id: g.id, reason: 'Venció el plazo aprobado', at: g.expires_at }); G.events.emit('support_access.expired', { grant_id: g.id, tenant: g.tenant }); }
    return due.length;
  };
  O.grantVigente = (g, at = now()) => !!g && g.status === 'APPROVED' && ms(g.expires_at) > ms(at);
  /** RN-OPS-04: toda acción del soporte va dentro de un acceso vigente, personal, con su nivel; queda en la bitácora del cliente */
  O.supportAct = function (grantId, { action = 'VIEW', entity = null, entity_id = null, detail = {}, pu, at } = {}) {
    const when = at || now(); O.expireDue(when);
    const g = rget('support_access_grants', grantId); const a = pu || O.actor();
    const deny = msg => { if (g) O.paudit('SUPPORT_DENIED', { pu: a, tenant: g.tenant, entity, entity_id, reason: msg, detail: { action }, at: when }); G.fail('RN-OPS-04', msg); };
    if (!g) G.fail('RN-OPS-04', 'Acceso no encontrado.');
    if (!O.grantVigente(g, when)) deny(`El acceso ${g.id} no está vigente (${SL[g.status][0].toLowerCase()}): el soporte no puede actuar en ${O.tenantName(g.tenant)}.`);
    const su = rget('users', g.support_user_id); if (!su || su.status !== 'ACTIVE') deny('El usuario técnico de soporte está inactivo.');
    if (!a || a.id !== g.platform_user_id) deny(`El acceso es personal: se otorgó a ${g.platform_user_name}, no a ${a ? a.full_name : 'otro usuario'}.`);
    if (['UPDATE', 'CREATE'].includes(action) && g.access_level === 'READ_ONLY') deny('El acceso es de solo lectura: no se puede modificar nada.');
    if (action === 'EXPORT' && !g.allow_export) deny('El cliente no permitió exportar en este acceso.');
    const mod = entity && ENTITY_MOD[entity];
    if (mod && (g.modules || []).length && !g.modules.includes(mod)) deny(`El acceso no incluye el módulo ${mod}.`);
    const first = !raw('support_access_log').some(l => l.grant_id === g.id);
    const log = tins('support_access_log', g.tenant, { grant_id: g.id, platform_user_id: a.id, platform_user_name: a.full_name, action, entity, entity_id, detail, ip: O.actorIp(), occurred_at: when });
    O.paudit('SUPPORT_' + action, { pu: a, tenant: g.tenant, entity, entity_id, reason: g.reason, detail: Object.assign({ grant_id: g.id }, detail), at: when });
    if (first) { rupd(g, { first_used_at: when }); if (G.param('ops_support_notify_admins') !== false) O.notifyAdmins(g.tenant, 'El soporte empezó a usar su acceso', `${a.full_name} entró a tu empresa con el acceso aprobado (${g.access_level === 'READ_ONLY' ? 'solo lectura' : 'lectura y escritura'}). Ves cada consulta en OPS-14.`, 'OPS-14', 'info'); }
    return log;
  };
  /** RN-OPS-06: la consola no lee datos de negocio sin un acceso aprobado */
  O.readTenantData = function (grantId, table, opts = {}) {
    const g = rget('support_access_grants', grantId);
    if (!g) G.fail('RN-OPS-06', 'La consola no lee pedidos, clientes ni comprobantes de una empresa sin un acceso de soporte aprobado.');
    O.supportAct(grantId, { action: 'VIEW', entity: table, detail: Object.assign({ query: opts.query || 'listado' }, opts.detail || {}), pu: opts.pu, at: opts.at });
    return raw(table).filter(r => r.tenant === g.tenant);
  };
  O.startSession = function (grantId, { ip } = {}) {
    const g = rget('support_access_grants', grantId);
    const allow = O.pparam('ops_console_ip_allowlist') || []; const ipx = ip || O.actorIp();
    if (!O.ipIn(ipx, allow)) G.fail('RN-OPS-16', `La sesión de soporte solo se abre desde ${allow.join(', ')}; tu IP ${ipx} no está en la lista.`);
    O.supportAct(grantId, { action: 'SESSION_START', detail: { ip: ipx } });
    rupd(g, { session_open: true, session_ip: ipx, session_started_at: now() });
    G.ctx.opsSupportSession = { grant_id: grantId, at: now() }; G.db.save();
    return g;
  };
  O.endSession = function (grantId) {
    const g = rget('support_access_grants', grantId);
    if (g && g.session_open && O.grantVigente(g)) { tins('support_access_log', g.tenant, { grant_id: g.id, platform_user_id: g.platform_user_id, platform_user_name: g.platform_user_name, action: 'SESSION_END', detail: { reason: 'Cierre manual' }, ip: O.actorIp(), occurred_at: now() }); O.paudit('SUPPORT_SESSION_END', { tenant: g.tenant, entity: 'support_access_grants', entity_id: g.id, reason: g.reason }); rupd(g, { session_open: false }); }
    G.ctx.opsSupportSession = null; G.db.save();
  };
  O.grantHours = (g, at = now()) => { if (!g.starts_at) return 0; const end = g.ended_at || (g.status === 'APPROVED' ? (ms(at) < ms(g.expires_at) ? at : g.expires_at) : g.expires_at); return Math.max(0, hoursBetween(g.starts_at, end)); };

  /* ------------------------------------------------------------------
     Salud de componentes e incidentes (RN-OPS-08, RN-OPS-14)
     ------------------------------------------------------------------ */
  O.lastCheck = c => { let best = null; for (const x of raw('platform_component_checks')) if (x.component === c && (!best || x.checked_at > best.checked_at)) best = x; return best; };
  O.recordCheck = function (v, opts = {}) {
    if (!COMPONENTS.some(c => c[0] === v.component)) G.fail('RN-OPS-05', 'Componente no válido.');
    if (!['UP', 'DEGRADED', 'DOWN'].includes(v.status)) G.fail('RN-OPS-05', 'Estado no válido.');
    if (opts.manual) O.passert('health.record');
    const at = v.at || now(); const prev = O.lastCheck(v.component);
    const row = gins('platform_component_checks', { component: v.component, provider: v.provider || null, status: v.status, latency_ms: v.latency_ms ?? null, error_rate_pct: v.error_rate_pct ?? null, queue_depth: v.queue_depth ?? null, checked_at: at, detail: Object.assign({ samples: 1 }, v.detail || {}) });
    const open = raw('platform_incidents').find(i => i.component === v.component && i.status !== 'RESOLVED');
    if (v.status === 'DOWN' && !open) {
      const inc = O.openIncident({ title: `${compName(v.component)} no responde`, severity: 'SEV2', component: v.component, affects_all: true, public_message: `Detectamos una falla en ${compName(v.component)}. Los ${v.component === 'OSE' ? 'comprobantes quedan en cola y se envían solos al recuperarse' : 'procesos afectados se reintentan solos'}. Te avisaremos al resolverse.`, started_at: at, auto: true }, { system: true });
      O.notifyIncident(inc.id, { at: addMin(at, 2), system: true });
    } else if (v.status === 'UP' && open && open.auto && prev && prev.status !== 'UP') {
      O.updateIncident(open.id, { status: 'MONITORING', message: `${compName(v.component)} responde de nuevo; seguimos en monitoreo.`, at }, { system: true });
    }
    return row;
  };
  const nextIncCode = () => { const n = Math.max(0, ...raw('platform_incidents').map(i => Number(String(i.code).split('-').pop()) || 0)) + 1; return 'INC-2026-' + U.pad(n, 3); };
  O.incidentTenants = id => raw('platform_incident_tenants').filter(x => x.incident_id === id);
  O.openIncident = function (v, opts = {}) {
    const a = opts.system ? SYSTEM : O.passert('incident.manage');
    if (!v.title || v.title.length < 5) G.fail('RN-OPS-08', 'Escribe un título del incidente.');
    if (!SEVS.some(s => s[0] === v.severity)) G.fail('RN-OPS-08', 'Elige la severidad.');
    const at = v.started_at || now();
    const inc = gins('platform_incidents', { code: nextIncCode(), title: v.title, severity: v.severity, component: v.component, status: 'INVESTIGATING', affects_all: !!v.affects_all, started_at: at, resolved_at: null, public_message: v.public_message || null, root_cause: null, postmortem_url: null, owner_id: a.id, auto: !!v.auto, updates: [{ at, status: 'INVESTIGATING', message: v.public_message || v.title, by: a.full_name }] });
    const tids = v.affects_all ? O.tenants().filter(t => !['CANCELLED'].includes(O.sub(t.id).status)).map(t => t.id) : (v.tenants || []);
    for (const tid of tids) gins('platform_incident_tenants', { incident_id: inc.id, target_tenant_id: tid, notified_at: null });
    O.paudit('INCIDENT_OPENED', { pu: a, entity: 'platform_incidents', entity_id: inc.id, reason: v.title, detail: { severity: v.severity, component: v.component, tenants: tids.length }, at });
    G.events.emit('incident.opened', { incident_id: inc.id, severity: v.severity, component: v.component });
    return inc;
  };
  O.updateIncident = function (id, { status, message, at }, opts = {}) {
    const a = opts.system ? SYSTEM : O.passert('incident.manage');
    const inc = rget('platform_incidents', id); if (inc.status === 'RESOLVED') G.fail('RN-OPS-08', 'El incidente ya está resuelto.');
    if (status === 'RESOLVED') G.fail('RN-OPS-08', 'Para resolver usa «Resolver» con la hora de cierre y la causa raíz.');
    inc.updates = inc.updates || []; inc.updates.push({ at: at || now(), status: status || inc.status, message, by: a.full_name });
    rupd(inc, { status: status || inc.status, public_message: message || inc.public_message });
    return inc;
  };
  /** RN-OPS-14: SEV1/SEV2 se anuncia a los afectados en menos de N minutos */
  O.notifyIncident = function (id, opts = {}) {
    const a = opts.system ? SYSTEM : O.passert('incident.manage');
    const inc = rget('platform_incidents', id); const at = opts.at || now();
    const rows = O.incidentTenants(id).filter(r => !r.notified_at);
    for (const r of rows) { rupd(r, { notified_at: at }); O.notifyAdmins(r.target_tenant_id, `Incidente ${inc.severity}: ${inc.title}`, inc.public_message || inc.title, 'OPS-15', 'bad'); }
    const ann = gins('platform_announcements', { title: `${inc.code} · ${inc.title}`, body: inc.public_message || inc.title, kind: 'INCIDENT', audience: inc.affects_all ? 'ALL' : 'TENANTS', target_tenant_ids: inc.affects_all ? null : O.incidentTenants(id).map(x => x.target_tenant_id), starts_at: at, ends_at: null, status: 'PUBLISHED', published_at: at, incident_id: id, created_by_platform_user: a.id });
    O.paudit('INCIDENT_NOTIFIED', { pu: a, entity: 'platform_incidents', entity_id: id, reason: `Aviso a ${rows.length} empresas`, at, detail: { minutes: R((ms(at) - ms(inc.started_at)) / 60000, 0) } });
    return { notified: rows.length, minutes: (ms(at) - ms(inc.started_at)) / 60000, announcement: ann };
  };
  O.notifyMinutes = inc => { const ts = O.incidentTenants(inc.id).map(x => x.notified_at).filter(Boolean).sort(); return ts.length ? (ms(ts[0]) - ms(inc.started_at)) / 60000 : null; };
  O.resolveIncident = function (id, { resolved_at, root_cause, postmortem_url } = {}, opts = {}) {
    const a = opts.system ? SYSTEM : O.passert('incident.manage');
    const inc = rget('platform_incidents', id);
    if (inc.status === 'RESOLVED') G.fail('RN-OPS-08', 'El incidente ya está resuelto.');
    if (!resolved_at) G.fail('RN-OPS-08', 'Indica la hora de cierre.');
    if (ms(resolved_at) <= ms(inc.started_at)) G.fail('RN-OPS-08', `La hora de cierre (${G.fmt.datetime(resolved_at)}) debe ser posterior al inicio (${G.fmt.datetime(inc.started_at)}).`);
    if (!root_cause || String(root_cause).trim().length < 10) G.fail('RN-OPS-08', 'Un incidente se resuelve con su causa raíz (mínimo 10 caracteres).');
    inc.updates = inc.updates || []; inc.updates.push({ at: resolved_at, status: 'RESOLVED', message: 'Resuelto. ' + root_cause, by: a.full_name });
    rupd(inc, { status: 'RESOLVED', resolved_at, root_cause, postmortem_url: postmortem_url || null });
    O.paudit('INCIDENT_RESOLVED', { pu: a, entity: 'platform_incidents', entity_id: id, reason: root_cause, at: resolved_at });
    G.events.emit('incident.resolved', { incident_id: id });
    return inc;
  };
  O.linkTicketIncident = function (ticketId, incId) { O.passert('ticket.manage'); const t = rget('support_tickets', ticketId); rupd(t, { incident_id: incId }); O.paudit('TICKET_LINKED', { tenant: t.tenant, entity: 'support_tickets', entity_id: ticketId, reason: `Vinculado a ${(rget('platform_incidents', incId) || {}).code}` }); return t; };

  /* ------------------------------------------------------------------
     Anuncios (RN-OPS-06, RN-OPS-18)
     ------------------------------------------------------------------ */
  O.annTargets = a => { const ts = O.tenants().filter(t => O.sub(t.id).status !== 'CANCELLED'); if (a.audience === 'TENANTS') return (a.target_tenant_ids || []).slice(); if (a.audience === 'PLAN') return ts.filter(t => O.sub(t.id).plan_code === a.plan_code).map(t => t.id); return ts.map(t => t.id); };
  O.saveAnnouncement = function (v, row) {
    const a = O.passert('announce.manage');
    if (!v.title || !v.body) G.fail('RN-OPS-18', 'Escribe el título y el mensaje.');
    if (v.audience === 'TENANTS' && !(v.target_tenant_ids || []).length) G.fail('RN-OPS-06', 'Elige al menos una empresa.');
    if (v.ends_at && v.starts_at && v.ends_at < v.starts_at) G.fail('RN-OPS-18', 'El fin debe ser posterior al inicio.');
    const data = { title: v.title, body: v.body, kind: v.kind, audience: v.audience, plan_code: v.audience === 'PLAN' ? v.plan_code : null, target_tenant_ids: v.audience === 'TENANTS' ? v.target_tenant_ids : null, starts_at: v.starts_at, ends_at: v.ends_at || null };
    if (row) { if (row.status !== 'DRAFT') G.fail('RN-OPS-18', 'Un anuncio publicado no se edita: archívalo y crea otro.'); return rupd(row, data); }
    return gins('platform_announcements', Object.assign(data, { status: 'DRAFT', created_by_platform_user: a.id }));
  };
  O.publishAnnouncement = function (id, opts = {}) {
    const a = O.passert('announce.manage'); const an = rget('platform_announcements', id); const at = opts.at || now();
    if (an.status !== 'DRAFT') G.fail('RN-OPS-18', 'Solo se publica un borrador.');
    const need = Number(O.pparam('ops_maintenance_notice_hours') ?? 48);
    if (an.kind === 'MAINTENANCE' && hoursBetween(at, an.starts_at) < need) G.fail('RN-OPS-18', `Un mantenimiento se anuncia con al menos ${need} horas: empieza el ${G.fmt.datetime(an.starts_at)} y faltan ${G.fmt.num(Math.max(0, hoursBetween(at, an.starts_at)), 1)} h. Mueve el inicio o publica antes.`);
    rupd(an, { status: 'PUBLISHED', published_at: at });
    for (const tid of O.annTargets(an)) O.notifyAdmins(tid, `${annKind(an.kind)}: ${an.title}`, an.body, 'OPS-15', an.kind === 'MAINTENANCE' ? 'warn' : 'info');
    O.paudit('ANNOUNCEMENT_PUBLISHED', { pu: a, entity: 'platform_announcements', entity_id: id, reason: an.title, detail: { audience: an.audience, targets: O.annTargets(an).length } });
    G.events.emit('announcement.published', { announcement_id: id });
    return an;
  };
  O.archiveAnnouncement = id => { O.passert('announce.manage'); const an = rget('platform_announcements', id); rupd(an, { status: 'ARCHIVED' }); O.paudit('ANNOUNCEMENT_ARCHIVED', { entity: 'platform_announcements', entity_id: id, reason: an.title }); };
  /** RN-OPS-06: la empresa solo ve los anuncios dirigidos a ella */
  O.announcementsFor = (tid, at = now()) => raw('platform_announcements').filter(a => a.status === 'PUBLISHED' && O.annTargets(a).includes(tid) && (!a.ends_at || ms(a.ends_at) >= ms(at))).sort(U.by('starts_at', -1));
  O.markRead = function (aid, uid = G.ctx.userId()) { if (!raw('announcement_reads').some(r => r.announcement_id === aid && r.user_id === uid)) G.db.insert('announcement_reads', { announcement_id: aid, user_id: uid, read_at: now() }, { silent: true }); };

  /* ------------------------------------------------------------------
     Usuarios de plataforma (RN-OPS-01)
     ------------------------------------------------------------------ */
  O.savePlatformUser = function (v, row) {
    const a = O.passert('users.manage');
    if (!/^[^@\s]+@intelectalab\.com$/i.test(v.email || '')) G.fail('RN-OPS-01', 'El correo debe ser del dominio intelectalab.com.');
    if (raw('platform_users').some(u => u.email.toLowerCase() === v.email.toLowerCase() && (!row || u.id !== row.id))) G.fail('RN-OPS-01', 'Ya existe un usuario de plataforma con ese correo.');
    if (v.status === 'ACTIVE' && !v.twofa_enabled) G.fail('RN-OPS-01', 'Un usuario de plataforma activo tiene segundo factor: actívalo primero o déjalo como invitado.');
    const data = { email: v.email.trim().toLowerCase(), full_name: v.full_name, role: v.role, twofa_enabled: !!v.twofa_enabled, status: v.status };
    let r;
    if (row) { r = rupd(row, data); O.paudit('PLATFORM_USER_UPDATED', { pu: a, entity: 'platform_users', entity_id: r.id, reason: v.reason || 'Edición', detail: data }); }
    else { r = gins('platform_users', Object.assign(data, { password_hash: G.auth.hash('DonGuando2026'), failed_logins: 0 })); O.paudit('PLATFORM_USER_CREATED', { pu: a, entity: 'platform_users', entity_id: r.id, reason: 'Alta de usuario de plataforma', detail: data }); }
    return r;
  };
  O.enroll2fa = function (id) { const a = O.passert('users.manage'); const u = rget('platform_users', id); rupd(u, { twofa_enabled: true, status: u.status === 'INVITED' ? 'ACTIVE' : u.status }); O.paudit('PLATFORM_USER_2FA', { pu: a, entity: 'platform_users', entity_id: id, reason: 'Segundo factor configurado' }); return u; };
  O.setPlatformUserStatus = function (id, status, reason) {
    const a = O.passert('users.manage'); const u = rget('platform_users', id);
    if (!reason) G.fail('RN-OPS-01', 'Indica el motivo.');
    if (status === 'ACTIVE' && !u.twofa_enabled) G.fail('RN-OPS-01', 'Sin segundo factor la cuenta no se activa.');
    if (u.id === a.id && status !== 'ACTIVE') G.fail('RN-OPS-10', 'No puedes bloquearte ni darte de baja a ti mismo.');
    rupd(u, { status, disabled_reason: status === 'ACTIVE' ? null : reason, failed_logins: 0 });
    O.paudit('PLATFORM_USER_' + status, { pu: a, entity: 'platform_users', entity_id: id, reason });
    return u;
  };

  /* ------------------------------------------------------------------
     Semilla (orden 84): consola con varias empresas cliente
     ------------------------------------------------------------------ */
  G.seed(84, function seedOPS() {
    const r = U.rng(8484);
    const pwd = G.auth ? G.auth.hash('DonGuando2026') : 'x';
    // usuarios de plataforma
    const PU = [['pu-admin', 'ana.rios@intelectalab.com', 'Ana Ríos Paredes', 'PLATFORM_ADMIN', true, 'ACTIVE'], ['pu-soporte', 'soporte@intelectalab.com', 'Soporte Intelectalab', 'SUPPORT_L2', true, 'ACTIVE'], ['pu-l1', 'karen.vilchez@intelectalab.com', 'Karen Vílchez Soto', 'SUPPORT_L1', true, 'ACTIVE'], ['pu-billing', 'oscar.delgado@intelectalab.com', 'Óscar Delgado Rey', 'BILLING', true, 'ACTIVE'], ['pu-eng', 'renato.gil@intelectalab.com', 'Renato Gil Cornejo', 'ENGINEER', true, 'ACTIVE'], ['pu-ro', 'pamela.soto@intelectalab.com', 'Pamela Soto Ugaz', 'READ_ONLY', true, 'ACTIVE'], ['pu-new', 'diego.paz@intelectalab.com', 'Diego Paz Aliaga', 'SUPPORT_L1', false, 'INVITED']];
    for (const [id, email, full_name, role, tf, status] of PU) gins('platform_users', { id, email, full_name, role, password_hash: pwd, twofa_enabled: tf, status, failed_logins: 0, last_login_at: status === 'ACTIVE' ? '2026-10-10T08:0' + (id.length % 9) : null, created_at: '2026-05-02T10:00' });
    const sup = raw('users').find(u => u.id === 'us-soporte'); if (sup) { sup.platform_user_id = 'pu-soporte'; sup.support_grant_id = null; }
    // definiciones de métricas de plataforma (no van en kpi_definitions)
    const unit = { 'KPI-OPS-01': 'PEN', 'KPI-OPS-02': 'COUNT', 'KPI-OPS-06': 'PEN', 'KPI-OPS-09': 'DAYS', 'KPI-OPS-10': 'RATIO', 'KPI-OPS-11': 'HOURS' };
    for (const [code, name, formula, dir] of (G.SPEC.OPS || { kpis: [] }).kpis) if (Number(code.slice(-2)) <= 13) gins('platform_kpi_definitions', { id: 'pkd-' + code, code, name, formula, unit: unit[code] || 'PCT', direction: /más bajo/i.test(dir) ? 'LOWER_BETTER' : /meta/i.test(dir) ? 'TARGET' : 'HIGHER_BETTER', frequency: 'MONTHLY', dimensions: code === 'KPI-OPS-08' ? ['plan', 'limit'] : code === 'KPI-OPS-11' ? ['priority'] : code === 'KPI-OPS-12' ? ['component'] : [], status: 'ACTIVE' });
    // empresas cliente de la consola (ficticias) + DG y CS del núcleo
    const T = [
      // id, razón social, corto, plan, periodo, estado, alta, activación, extra
      ['T-LPR', 'EMBUTIDOS LA PRADERA SAC', 'La Pradera', 'CRECER', 'MONTHLY', 'ACTIVE', '2026-03-02', '2026-03-16', {}],
      ['T-AND', 'AVÍCOLA ANDINA DEL CENTRO SAC', 'Avícola Andina', 'MULTIMARCA', 'ANNUAL', 'ACTIVE', '2026-01-08', '2026-01-22', {}],
      ['T-CMI', 'CUYERÍA EL MIRADOR EIRL', 'Cuyería El Mirador', 'INICIAL', 'MONTHLY', 'ACTIVE', '2026-05-04', '2026-05-18', {}],
      ['T-PNO', 'PORCINOS DEL NORTE SAC', 'Porcinos del Norte', 'CRECER', 'MONTHLY', 'PAST_DUE', '2026-04-01', '2026-04-15', { past_due_since: '2026-09-28', status_changed_at: '2026-09-29T08:00' }],
      ['T-CHA', 'CHARCUTERÍA SANTA ANA SAC', 'Charcutería Santa Ana', 'CRECER', 'ANNUAL', 'ACTIVE', '2026-02-02', '2026-02-12', {}],
      ['T-GRS', 'GRANJA RÍO SECO SAC', 'Granja Río Seco', 'INICIAL', 'MONTHLY', 'READ_ONLY', '2026-04-20', '2026-05-04', { past_due_since: '2026-09-05', status_changed_at: '2026-09-25T08:00', status_reason: 'Mora mayor a 20 días (paso automático a solo lectura)' }],
      ['T-MDL', 'MERCADO DE LA CARNE DELICIAS EIRL', 'Carnes Delicias', 'INICIAL', 'MONTHLY', 'TRIAL', '2026-10-06', null, { trial_ends_at: '2026-10-20T23:59' }],
      ['T-PAQ', 'POLLOS Y AVES AREQUIPA SAC', 'Pollos Arequipa', 'CRECER', 'MONTHLY', 'CANCELLED', '2026-03-10', '2026-03-24', { cancelled_at: '2026-09-18T12:00', status_changed_at: '2026-09-18T12:00', status_reason: 'Cambió a un sistema propio' }],
      ['T-CJL', 'CARNES JULIACA SAC', 'Carnes Juliaca', 'INICIAL', 'MONTHLY', 'SUSPENDED', '2026-05-12', '2026-05-26', { past_due_since: '2026-08-05', suspended_at: '2026-09-15T10:00', status_changed_at: '2026-09-15T10:00', prev_status: 'READ_ONLY', status_reason: 'Mora de 40 días sin respuesta a los avisos' }],
      ['T-AHU', 'AHUMADOS DEL VALLE SAC', 'Ahumados del Valle', 'MULTIMARCA', 'MONTHLY', 'ACTIVE', '2026-07-01', '2026-07-15', { fee_changes: [{ at: '2026-09-10T10:00', from_fee: 590, to_fee: 1190, reason: 'Subió de Crecer a Multimarca' }] }],
      ['T-CSP', 'CONSERVAS SAN PABLO SAC', 'Conservas San Pablo', 'CRECER', 'MONTHLY', 'ACTIVE', '2026-08-29', '2026-09-12', { trial_ends_at: '2026-09-12T23:59' }],
      ['T-LTR', 'LÁCTEOS Y CARNES TRUJILLO SAC', 'Lácteos Trujillo', 'INICIAL', 'MONTHLY', 'CANCELLED', '2026-09-11', null, { trial_ends_at: '2026-09-25T23:59', cancelled_at: '2026-09-25T23:59', status_changed_at: '2026-09-25T23:59', status_reason: 'La prueba terminó sin contratar' }],
      ['T-VQS', 'VALLE QUESOS Y CARNES SAC', 'Valle Quesos', 'CRECER', 'MONTHLY', 'ACTIVE', '2026-06-03', '2026-06-17', { fee_changes: [{ at: '2026-10-02T10:00', from_fee: 1190, to_fee: 590, reason: 'Bajó de Multimarca a Crecer' }] }],
    ];
    const RUC_IL = U.rucCheck('2060743111');
    const addSub = (tid, d) => {
      if (raw('subscriptions').some(s => s.tenant === tid)) return;
      const fb = PLANS[d.plan] || PLANS.CRECER;
      const price = d.period === 'ANNUAL' ? fb.price * 10 : fb.price;
      const s = tins('subscriptions', tid, { product_id: 'AYCHA_COMERCIAL', plan_id: null, plan_code: d.plan, plan_name: fb.name, billing_doc_type: 'RUC', billing_doc_number: d.ruc, billing_name: d.name, billing_email: 'administracion@' + tid.toLowerCase().replace(/[^a-z]/g, '') + '.pe', status: d.status, prev_status: d.prev_status || 'ACTIVE', status_reason: d.status_reason || null, status_changed_at: d.status_changed_at || (d.activated ? d.activated + 'T09:00' : d.created + 'T09:00'), trial_started_at: d.trial_ends_at ? d.created + 'T09:00' : null, trial_ends_at: d.trial_ends_at || null, current_period_start: G.date.month(G.TODAY), current_period_end: G.date.add(G.date.addMonths(G.TODAY, 1), -1), billing_period: d.period, agreed_price: d.agreed_price ?? price, discount_pct: d.discount_pct || 0, gateway: 'MERCADOPAGO', cancel_at_period_end: false, cancelled_at: d.cancelled_at || null, suspended_at: d.suspended_at || null, past_due_since: d.past_due_since || null, activated_at: d.activated ? d.activated + 'T09:00' : null, first_doc_at: d.activated ? G.date.add(d.activated, 3 + Math.floor(r() * 9)) : null, fee_changes: d.fee_changes || [], created_at: d.created + 'T09:00', ops_fallback: true });
      tins('subscription_events', tid, { subscription_id: s.id, event_type: 'CREATED', from_status: null, to_status: d.trial_ends_at ? 'TRIAL' : 'ACTIVE', reason: 'Alta desde ONB', actor_type: 'SYSTEM', occurred_at: d.created + 'T09:00', detail: {} });
      if (d.activated && d.trial_ends_at) tins('subscription_events', tid, { subscription_id: s.id, event_type: 'STATUS_CHANGED', from_status: 'TRIAL', to_status: 'ACTIVE', reason: 'Primer pago confirmado', actor_type: 'SYSTEM', occurred_at: d.activated + 'T09:00', detail: {} });
      for (const c of d.fee_changes || []) tins('subscription_events', tid, { subscription_id: s.id, event_type: 'PLAN_CHANGED', reason: c.reason, actor_type: 'TENANT_USER', occurred_at: c.at, detail: { from_fee: c.from_fee, to_fee: c.to_fee } });
      if (!['ACTIVE', 'TRIAL'].includes(d.status)) tins('subscription_events', tid, { subscription_id: s.id, event_type: 'STATUS_CHANGED', from_status: d.prev_status || 'ACTIVE', to_status: d.status, reason: d.status_reason || 'Mora', actor_type: d.status === 'SUSPENDED' ? 'PLATFORM_USER' : 'SYSTEM', actor_id: d.status === 'SUSPENDED' ? 'pu-billing' : null, occurred_at: d.status_changed_at, detail: {} });
      // comprobantes del SaaS de los últimos 3 meses (si SUS no los emitió)
      if (!raw('saas_invoices').some(i => i.tenant === tid) && d.activated) {
        const months = d.period === 'ANNUAL' ? [G.date.month(d.activated)] : [2, 1, 0].map(k => G.date.addMonths(G.TODAY, -k)).filter(ps => ps >= G.date.month(d.activated) && !(d.cancelled_at && ps > d.cancelled_at.slice(0, 10)));
        for (const ps of months) {
          const fee = d.period === 'ANNUAL' ? price : (d.fee_changes && d.fee_changes.length && ps < G.date.month(d.fee_changes[0].at) ? d.fee_changes[0].from_fee : (d.agreed_price ?? price) * (1 - (d.discount_pct || 0) / 100));
          const total = R(fee * 1.18); const due = G.date.add(ps, 7);
          const unpaid = !!(d.past_due_since && due >= d.past_due_since.slice(0, 10));
          const tx = G.tax.split(total, true);
          tins('saas_invoices', tid, { subscription_id: s.id, period_start: ps, period_end: G.date.add(G.date.addMonths(ps, d.period === 'ANNUAL' ? 12 : 1), -1), issuer_ruc: RUC_IL, doc_type: 'INVOICE', series: 'FS01', number: 300 + Math.floor(r() * 600), customer_doc_number: d.ruc, customer_name: d.name, currency: 'PEN', subtotal: tx.base, igv: tx.igv, total, due_date: due, status: unpaid ? 'OPEN' : 'PAID', einvoice_status: 'ACCEPTED', issued_at: ps + 'T08:00', paid_at: unpaid ? null : G.date.add(ps, 2 + Math.floor(r() * 4)) + 'T11:00' });
        }
      }
    };
    for (const [id, name, short, plan, period, status, created, activated, x] of T) {
      if (!raw('tenants').some(t => t.id === id)) G.db.insert('tenants', { id, tenant: null, name, short, plan, status: ['ACTIVE', 'TRIAL', 'PAST_DUE'].includes(status) ? 'ACTIVE' : status, hostname: short.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '') + '.aycha.pe', console_demo: true }, { silent: true });
      addSub(id, Object.assign({ plan, period, status, created, activated, name, ruc: U.rucCheck('20' + U.pad(48000000 + id.charCodeAt(2) * 9137 + id.charCodeAt(4) * 311, 8)) }, x));
    }
    addSub('DG', { plan: 'PILOTO', period: 'MONTHLY', status: 'ACTIVE', created: '2026-06-01', activated: '2026-06-01', name: 'AGROPECUARIA DON GUANDO SAC', ruc: (G.db.get('companies', 'co-dg') || {}).ruc || '20609147251', discount_pct: 50 });
    addSub('CS', { plan: 'CRECER', period: 'MONTHLY', status: 'ACTIVE', created: '2026-09-06', activated: '2026-09-20', name: 'CARNES SELECTAS DEL SUR SAC', ruc: U.rucCheck('2061023344'), trial_ends_at: '2026-09-20T23:59' });
    // señales de salud de las empresas sin datos en esta demo (lecturas de los adaptadores)
    const SIG = {
      'T-LPR': [[210, 820], [640, 3], [2100, 12], ['UP', 'UP', 'UP'], [290, 3100, 11], { BRANDS: 2, ESTABLISHMENTS: 1, WHATSAPP_NUMBERS: 2, API_CALLS_DAY: 850 }],
      'T-AND': [[690, 2800], [2300, 9], [6100, 25], ['UP', 'UP', 'UP'], [1010, 9800, 31], { BRANDS: 4, ESTABLISHMENTS: 3, WHATSAPP_NUMBERS: 6, API_CALLS_DAY: 9400 }],
      'T-CMI': [[38, 410], [120, 1], [520, 47], ['UP', 'DEGRADED', 'NA'], [70, 600, 4], { BRANDS: 1, ESTABLISHMENTS: 1, WHATSAPP_NUMBERS: 1, API_CALLS_DAY: 0 }],
      'T-PNO': [[160, 700], [480, 29], [1500, 9], ['DEGRADED', 'UP', 'UP'], [240, 1700, 12], { BRANDS: 2, ESTABLISHMENTS: 2, WHATSAPP_NUMBERS: 3, API_CALLS_DAY: 0 }],
      'T-CHA': [[120, 520], [400, 2], [1300, 61], ['UP', 'DEGRADED', 'UP'], [190, 1500, 9], { BRANDS: 3, ESTABLISHMENTS: 1, WHATSAPP_NUMBERS: 3, API_CALLS_DAY: 120 }],
      'T-GRS': [[9, 190], [60, 4], [180, 2], ['UP', 'UP', 'NA'], [12, 110, 4], { BRANDS: 1, ESTABLISHMENTS: 1, WHATSAPP_NUMBERS: 1, API_CALLS_DAY: 0 }],
      'T-MDL': [[44, 0], [30, 0], [210, 1], ['UP', 'UP', 'NA'], [44, 260, 3], { BRANDS: 1, ESTABLISHMENTS: 1, WHATSAPP_NUMBERS: 1, API_CALLS_DAY: 0 }],
      'T-PAQ': [[0, 40], [0, 0], [0, 0], ['NA', 'NA', 'NA'], [0, 0, 0], { BRANDS: 0, ESTABLISHMENTS: 1, WHATSAPP_NUMBERS: 0, API_CALLS_DAY: 0 }],
      'T-CJL': [[0, 60], [0, 0], [0, 0], ['UP', 'DOWN', 'NA'], [0, 0, 3], { BRANDS: 1, ESTABLISHMENTS: 1, WHATSAPP_NUMBERS: 1, API_CALLS_DAY: 0 }],
      'T-AHU': [[350, 1200], [900, 4], [3300, 18], ['UP', 'UP', 'UP'], [480, 4100, 22], { BRANDS: 5, ESTABLISHMENTS: 2, WHATSAPP_NUMBERS: 5, API_CALLS_DAY: 3100 }],
      'T-CSP': [[130, 260], [300, 1], [700, 3], ['UP', 'UP', 'UP'], [150, 820, 7], { BRANDS: 2, ESTABLISHMENTS: 1, WHATSAPP_NUMBERS: 2, API_CALLS_DAY: 0 }],
      'T-LTR': [[0, 12], [0, 0], [0, 0], ['NA', 'NA', 'NA'], [0, 0, 0], { BRANDS: 1, ESTABLISHMENTS: 1, WHATSAPP_NUMBERS: 0, API_CALLS_DAY: 0 }],
      'T-VQS': [[180, 760], [520, 2], [1600, 7], ['UP', 'UP', 'UP'], [260, 1900, 13], { BRANDS: 3, ESTABLISHMENTS: 2, WHATSAPP_NUMBERS: 3, API_CALLS_DAY: 0 }],
    };
    const W = { usage: 25, billing: 25, ose: 20, whatsapp: 15, tickets: 15 };
    for (const [tid, [us, os, wa, it, vol, lim]] of Object.entries(SIG)) {
      for (let k = 3; k >= 0; k--) {
        const f = 1 + (k * 0.04) * (r() - 0.3);
        const inputs = { usage: { last7: Math.round(us[0] * (k ? f : 1)), prev30: us[1] }, ose: { sent: os[0], rejected: Math.round(os[1] * (k ? 0.6 : 1)) }, whatsapp: { sent: wa[0], failed: Math.round(wa[1] * (k ? 0.7 : 1)) }, integrations: { OSE: it[0], WHATSAPP: it[1], MERCADOPAGO: it[2] }, volume: { orders_month: vol[0], messages_month: vol[1], users: vol[2] }, limits_used: Object.assign({ USERS: vol[2], ORDERS_MONTH: vol[0] }, lim) };
        const sg = Object.assign({}, inputs, { billing: { days_past_due: 0 }, tickets: { open: 0, urgent: 0, high: 0 } });
        const hs = O.healthScore(sg, W);
        gins('tenant_health_snapshots', { target_tenant_id: tid, computed_at: G.date.add(G.TODAY, -7 * k) + 'T06:00:00', score: hs.score, level: hs.level, components: { parts: hs.parts, inputs, weights: W } });
      }
    }
    // tickets de soporte
    const TK = [
      // tenant, n.º, asunto, categoría, prioridad, estado, abierto, 1.ª respuesta, resuelto, asignado, calificación, abierto por
      ['DG', 101, 'Boleta B001-00000412 rechazada por el OSE (código 2800)', 'EINVOICE', 'HIGH', 'IN_PROGRESS', '2026-10-10T09:12', '2026-10-10T09:40', null, 'pu-soporte', null, 'us-lccahuana', 'La boleta de un pedido de ayer salió rechazada con el código 2800 (documento del receptor). El cliente pagó con Yape y necesita su comprobante hoy.'],
      ['DG', 98, 'Diferencia de stock del cuy entero en la cámara del Local 1 después de una transferencia', 'INVENTORY', 'NORMAL', 'IN_PROGRESS', '2026-10-09T16:20', '2026-10-09T17:05', null, 'pu-soporte', null, 'us-rquispe', 'Transferimos 20 cuyes del Local 2 al Local 1 y en el kardex aparecen 18. Queremos saber si es un error del sistema o del registro.'],
      ['DG', 90, 'No salen las plantillas de confirmación por el número Ventas 2', 'WHATSAPP', 'URGENT', 'RESOLVED', '2026-10-08T10:00', '2026-10-08T10:40', '2026-10-08T15:30', 'pu-l1', null, 'us-rquispe', 'Desde las 9:30 las confirmaciones del número +51 987 650 102 quedan en cola.'],
      ['DG', 77, 'Cómo exportar el registro de ventas para la contadora', 'ACCOUNTING', 'LOW', 'CLOSED', '2026-09-25T11:30', '2026-09-26T10:15', '2026-09-26T16:00', 'pu-l1', 4, 'us-chuaman', 'Necesitamos el registro de ventas de agosto en Excel.'],
      ['DG', 71, 'Error al importar clientes desde Excel (columnas de dirección)', 'ONBOARDING', 'NORMAL', 'CLOSED', '2026-09-18T10:05', '2026-09-18T12:20', '2026-09-19T17:40', 'pu-soporte', 5, 'us-lccahuana', 'La importación marca error en 37 filas por la referencia de la dirección.'],
      ['CS', 99, 'Configurar la serie de boletas de la tienda Arequipa', 'ONBOARDING', 'HIGH', 'OPEN', '2026-10-10T08:05', null, null, null, null, 'us-cs-gerente', 'Necesitamos emitir boletas desde la tienda de Yanahuara con una serie propia.'],
      ['CS', 85, 'Los precios de la lista de mostrador no se actualizan', 'ORDERS', 'NORMAL', 'RESOLVED', '2026-09-30T15:10', '2026-09-30T16:30', '2026-10-01T12:00', 'pu-l1', null, 'us-cs-gerente', 'Cambiamos el precio del lomo y el mostrador sigue cobrando el anterior.'],
      ['T-PNO', 96, 'Rechazos masivos del OSE por el domicilio fiscal', 'EINVOICE', 'HIGH', 'OPEN', '2026-10-09T09:30', '2026-10-09T13:50', null, 'pu-l1', null, null, '29 facturas rechazadas desde el lunes.'],
      ['T-PNO', 97, 'No podemos pagar la suscripción con tarjeta', 'BILLING', 'NORMAL', 'WAITING_CUSTOMER', '2026-10-09T11:00', '2026-10-09T12:10', null, 'pu-billing', null, null, 'La pasarela rechaza la tarjeta corporativa.'],
      ['T-GRS', 94, 'Pasamos a solo lectura: ¿cómo regularizamos?', 'BILLING', 'HIGH', 'IN_PROGRESS', '2026-10-07T10:20', '2026-10-07T11:00', null, 'pu-billing', null, null, 'No podemos registrar pedidos.'],
      ['T-CMI', 95, 'Los mensajes de WhatsApp fallan a algunos clientes', 'WHATSAPP', 'NORMAL', 'OPEN', '2026-10-08T17:40', '2026-10-09T09:55', null, 'pu-l1', null, null, 'Error 131026 en varios envíos.'],
      ['T-CHA', 93, 'Plantilla de recompra rechazada por Meta', 'WHATSAPP', 'LOW', 'WAITING_CUSTOMER', '2026-10-06T12:00', '2026-10-07T10:30', null, 'pu-l1', null, null, 'Meta rechazó la plantilla de marketing.'],
      ['T-AHU', 92, 'Pedido de mejora: etiquetas con QR por marca', 'FEATURE_REQUEST', 'LOW', 'OPEN', '2026-10-05T16:00', '2026-10-06T09:40', null, 'pu-admin', null, null, 'Queremos que cada marca tenga su diseño de etiqueta.'],
      ['T-AND', 88, 'Cuadre de caja del repartidor con diferencia de S/ 0,10', 'BUG', 'NORMAL', 'CLOSED', '2026-09-28T10:00', '2026-09-28T11:30', '2026-09-29T10:00', 'pu-soporte', 4, null, 'Redondeo en la liquidación.'],
      ['T-LPR', 83, 'Alta de la segunda marca', 'ONBOARDING', 'NORMAL', 'CLOSED', '2026-09-15T09:00', '2026-09-15T10:10', '2026-09-16T12:00', 'pu-l1', 5, null, 'Queremos agregar la marca Pradera Gourmet.'],
      ['T-LPR', 80, 'El OSE no responde', 'EINVOICE', 'URGENT', 'CLOSED', '2026-09-14T08:10', '2026-09-14T08:35', '2026-09-14T10:30', 'pu-eng', 5, null, 'Ningún comprobante se envía desde las 8:00.'],
      ['T-VQS', 82, 'Bajar de plan a Crecer', 'BILLING', 'LOW', 'CLOSED', '2026-09-29T14:00', '2026-09-30T10:00', '2026-10-02T10:00', 'pu-billing', 4, null, 'Queremos bajar de plan desde octubre.'],
      ['T-AND', 76, 'Lentitud al cargar el tablero', 'BUG', 'HIGH', 'CLOSED', '2026-09-14T09:00', '2026-09-14T11:20', '2026-09-14T15:00', 'pu-eng', 3, null, 'El tablero de gerencia tarda más de 20 segundos.'],
    ];
    const usersOf = id => raw('users').find(u => u.id === id);
    const tkId = {};
    for (const [tid, n, subject, cat, prio, status, opened, fr, res, asg, sat, by, desc] of TK) {
      const opener = by ? usersOf(by) : null;
      const replies = [];
      if (fr) replies.push({ at: fr, by_type: 'PLATFORM', by: (PU.find(p => p[0] === asg) || [])[2] || 'Soporte Intelectalab', text: cat === 'EINVOICE' ? 'Recibido. Revisamos el XML y la respuesta del OSE; si hace falta pediremos un acceso de solo lectura.' : 'Recibido, ya lo estamos revisando.' });
      if (status === 'WAITING_CUSTOMER') replies.push({ at: G.date.add(fr.slice(0, 10), 0) + 'T' + fr.slice(11), by_type: 'PLATFORM', by: 'Soporte', text: 'Necesitamos una captura del error para continuar.' });
      if (res) replies.push({ at: res, by_type: 'PLATFORM', by: 'Soporte Intelectalab', text: 'Quedó resuelto. Confírmanos si todo funciona bien.' });
      const t = tins('support_tickets', tid, { id: 'tk-' + n, number: 'TK-' + U.pad(n, 4), subject, description: desc, category: cat, priority: prio, status, opened_by: opener ? opener.id : null, opened_by_name: opener ? opener.name : 'Administrador de ' + O.tenantName(tid), assigned_platform_user: asg, incident_id: null, opened_at: opened, first_response_at: fr, resolved_at: res, closed_at: status === 'CLOSED' ? G.date.add(res.slice(0, 10), 1) + 'T09:00' : null, satisfaction: sat, attachments: cat === 'EINVOICE' && tid === 'DG' ? ['B001-00000412-respuesta-OSE.xml', 'captura-error-2800.png'] : [], replies, history: [{ at: opened, to: 'OPEN', by: opener ? opener.name : 'Cliente' }].concat(status !== 'OPEN' ? [{ at: fr || opened, from: 'OPEN', to: status === 'CLOSED' ? 'RESOLVED' : status, by: 'Soporte' }] : []), created_at: opened });
      tkId[n] = t.id;
    }
    // accesos de soporte en Don Guando
    const GR = [
      ['ga-412', 'pu-soporte', 101, 'Revisar el XML de la boleta B001-00000412 y la respuesta del OSE para encontrar por qué se rechazó con el código 2800.', 'READ_ONLY', ['FAC', 'PED', 'CLI'], false, 8, 'REQUESTED', '2026-10-10T09:45', null, null],
      ['ga-098', 'pu-soporte', 98, 'Revisar el kardex y la transferencia del cuy entero entre el Local 2 y el Local 1.', 'READ_ONLY', ['ALM', 'CAT'], true, 48, 'APPROVED', '2026-10-09T17:10', '2026-10-10T07:30', '2026-10-12T07:30'],
      ['ga-090', 'pu-l1', 90, 'Revisar la cola de mensajes del número Ventas 2.', 'READ_ONLY', ['PED'], false, 8, 'EXPIRED', '2026-10-08T10:45', '2026-10-08T11:00', '2026-10-08T19:00'],
      ['ga-071', 'pu-soporte', 71, 'Corregir las 37 direcciones mal importadas de la carga de clientes.', 'READ_WRITE', ['CLI'], false, 24, 'REVOKED', '2026-09-18T12:30', '2026-09-18T13:00', '2026-09-19T13:00'],
      ['ga-077', 'pu-l1', 77, 'Exportar el registro de ventas de agosto.', 'READ_ONLY', ['FAC'], true, 4, 'REJECTED', '2026-09-26T10:20', null, null],
    ];
    const ger = raw('users').find(u => u.tenant === 'DG' && u.role === 'GERENTE'); const adm = raw('users').find(u => u.tenant === 'DG' && u.role === 'ADMIN_SISTEMA');
    for (const [id, puid, tk, reason, level, mods, exp, hrs, status, req, start, end] of GR) {
      const pu = raw('platform_users').find(p => p.id === puid);
      const g = tins('support_access_grants', 'DG', { id, platform_user_id: puid, platform_user_name: pu.full_name, ticket_id: tkId[tk], reason, access_level: level, modules: mods, allow_export: exp, requested_hours: hrs, requested_at: req, status, approved_by: start ? (id === 'ga-098' ? ger.id : adm.id) : null, approved_by_name: start ? (id === 'ga-098' ? ger.name : adm.name) : null, approved_at: start, starts_at: start, expires_at: end, approved_hours: start ? hrs : null, revoked_by: status === 'REVOKED' || status === 'REJECTED' ? adm.id : null, revoked_at: status === 'REVOKED' ? '2026-09-18T18:20' : status === 'REJECTED' ? '2026-09-26T10:40' : null, revoke_reason: status === 'REVOKED' ? 'Ya se corrigieron las direcciones; el resto lo hacemos nosotros.' : status === 'REJECTED' ? 'La contadora lo exporta ella misma.' : null, ended_at: status === 'REVOKED' ? '2026-09-18T18:20' : status === 'EXPIRED' ? end : null, support_user_id: null, session_open: false, first_used_at: null, created_at: req });
      if (start) {
        const su = tins('users', 'DG', { id: 'us-sup-' + id.slice(3), name: 'Soporte Intelectalab · ' + pu.full_name, email: `soporte+${id.slice(3)}@intelectalab.com`, role: 'SOPORTE_PLATAFORMA', brands: [], sites: [], status: status === 'APPROVED' ? 'ACTIVE' : 'INACTIVE', support: true, twofa_enabled: true, platform_user_id: puid, support_grant_id: id, last_login: start });
        g.support_user_id = su.id; g.first_used_at = addMin(start, 6);
        const L = id === 'ga-098' ? [['SESSION_START', null, null, 0], ['VIEW', 'stock_balances', 'Saldos del cuy entero en cámaras', 4], ['VIEW', 'product_variants', 'Ficha de va-DG-CUY-ENT', 9], ['VIEW', 'stock_balances', 'Kardex de la transferencia del 09/10', 15], ['EXPORT', 'stock_balances', 'Kardex del cuy entero (CSV)', 22], ['SESSION_END', null, null, 41]]
          : id === 'ga-090' ? [['SESSION_START', null, null, 0], ['VIEW', 'sales_orders', 'Pedidos con confirmación pendiente', 5], ['SESSION_END', null, null, 30]]
            : [['SESSION_START', null, null, 0], ['VIEW', 'customers', 'Clientes importados el 18/09', 6], ['UPDATE', 'customers', 'Referencia de 12 direcciones', 40], ['SESSION_END', null, null, 95]];
        for (const [action, entity, what, mins] of L) {
          const at = addMin(start, 6 + mins);
          tins('support_access_log', 'DG', { grant_id: id, platform_user_id: puid, platform_user_name: pu.full_name, action, entity, entity_id: null, detail: what ? { query: what } : {}, ip: '181.176.90.14', occurred_at: at });
          gins('platform_audit_log', { platform_user_id: puid, actor_name: pu.full_name, action: 'SUPPORT_' + action, target_tenant_id: 'DG', entity, entity_id: null, reason, ip: '181.176.90.14', user_agent: 'Aycha Console/1.0', detail: Object.assign({ grant_id: id }, what ? { query: what } : {}), occurred_at: at });
        }
      }
      gins('platform_audit_log', { platform_user_id: puid, actor_name: pu.full_name, action: 'ACCESS_REQUESTED', target_tenant_id: 'DG', entity: 'support_access_grants', entity_id: id, reason, ip: '190.237.14.22', user_agent: 'Aycha Console/1.0', detail: { level, hours: hrs }, occurred_at: req });
    }
    // salud de componentes: lecturas resumidas por hora de los últimos 7 días (60 lecturas por hora)
    const today = G.TODAY; const comps = COMPONENTS.map(c => c[0]);
    const lat = { APP: 180, DATABASE: 12, QUEUES: 40, OSE: 900, WHATSAPP: 350, PAYMENT_GATEWAY: 420, MAPS: 160, EMAIL: 300, STORAGE: 90, TELEPHONY: 210, ADS: 650, WOOCOMMERCE: 520, API: 140 };
    const events = { 'OSE|2026-10-06|19': { down: 20, degraded: 5 }, 'WHATSAPP|2026-10-08|11': { degraded: 60 }, 'WHATSAPP|2026-10-08|12': { degraded: 40 }, 'PAYMENT_GATEWAY|2026-10-10|8': { degraded: 30 }, 'QUEUES|2026-10-07|3': { degraded: 15 }, 'APP|2026-10-07|2': { down: 6 }, 'API|2026-10-07|2': { down: 6 } };
    for (let k = 6; k >= 0; k--) {
      const d = G.date.add(today, -k); const lastHour = k === 0 ? 8 : 23;
      for (let hr = 0; hr <= lastHour; hr++) for (const c of comps) {
        const ev = events[`${c}|${d}|${hr}`] || {}; const down = ev.down || 0, deg = ev.degraded || 0, up = 60 - down - deg;
        const status = down ? 'DOWN' : deg ? 'DEGRADED' : 'UP';
        const det = { samples: 60, up, degraded: deg, down };
        if (c === 'APP' || c === 'API') det.version = d < '2026-10-07' || (d === '2026-10-07' && hr < 2) ? (c === 'APP' ? '2026.09.4' : 'v1.3.2') : (c === 'APP' ? '2026.10.1' : 'v1.4.0');
        if (c === 'OSE') det.provider_detail = 'OSE homologado (adaptador INT)';
        G.db.t.platform_component_checks = G.db.t.platform_component_checks || [];
        G.db.t.platform_component_checks.push({ id: `pcc-${c}-${d}-${hr}`, tenant: null, component: c, provider: c === 'OSE' ? 'OSE_PRINCIPAL' : c === 'WHATSAPP' ? 'META_CLOUD_API' : c === 'PAYMENT_GATEWAY' ? 'MERCADOPAGO' : null, status, latency_ms: Math.round(lat[c] * (0.8 + r() * 0.5) * (deg ? 2.4 : 1)), error_rate_pct: R(down ? 30 + r() * 20 : deg ? 4 + r() * 5 : r() * 0.6, 2), queue_depth: c === 'QUEUES' ? Math.round(20 + r() * 80 + deg * 30) : c === 'OSE' ? Math.round(r() * 6 + down * 9) : null, checked_at: `${d}T${U.pad(hr, 2)}:59:00`, detail: det, created_at: `${d}T${U.pad(hr, 2)}:59:00` });
      }
    }
    // incidentes
    const INC = [
      ['pi-011', 'INC-2026-011', 'Caída general de la aplicación', 'SEV1', 'APP', 'RESOLVED', true, '2026-09-14T07:52', '2026-09-14T09:05', 'Disco lleno en el servidor de base de datos por registros de depuración; se amplió y se activó la rotación de registros.', 'https://wiki.intelectalab.com/postmortem/INC-2026-011', '2026-09-14T08:05'],
      ['pi-014', 'INC-2026-014', 'Rechazos y demora del OSE', 'SEV2', 'OSE', 'RESOLVED', true, '2026-10-06T19:40', '2026-10-06T20:05', 'Certificado digital del OSE vencido en el proveedor; lo renovó y los 212 comprobantes en cola se enviaron solos.', null, '2026-10-06T19:52'],
      ['pi-015', 'INC-2026-015', 'Plantillas de WhatsApp con demora', 'SEV3', 'WHATSAPP', 'RESOLVED', false, '2026-10-08T11:00', '2026-10-08T13:10', 'Degradación de la Cloud API de Meta en la región; sin acción de nuestra parte.', null, '2026-10-08T11:25'],
      ['pi-016', 'INC-2026-016', 'Notificaciones de Mercado Pago con retraso', 'SEV3', 'PAYMENT_GATEWAY', 'MONITORING', true, '2026-10-10T07:50', null, null, null, '2026-10-10T08:10'],
    ];
    for (const [id, code, title, sev, comp, stt, all, start, end, cause, pm, notif] of INC) {
      const pub = { 'pi-011': 'La aplicación no carga. Estamos trabajando en ello.', 'pi-014': 'Los comprobantes quedan en cola y se enviarán solos al OSE.', 'pi-015': 'Los mensajes de plantilla salen con algunos minutos de demora.', 'pi-016': 'Los pagos web se confirman con demora; no se pierden.' }[id];
      gins('platform_incidents', { id, code, title, severity: sev, component: comp, status: stt, affects_all: all, started_at: start, resolved_at: end, public_message: pub, root_cause: cause, postmortem_url: pm, owner_id: 'pu-eng', auto: false, updates: [{ at: start, status: 'INVESTIGATING', message: pub, by: 'Renato Gil Cornejo' }].concat(stt === 'MONITORING' ? [{ at: '2026-10-10T08:40', status: 'MONITORING', message: 'Mercado Pago normalizó el envío de notificaciones; seguimos en monitoreo.', by: 'Renato Gil Cornejo' }] : []).concat(end ? [{ at: end, status: 'RESOLVED', message: 'Resuelto. ' + cause, by: 'Renato Gil Cornejo' }] : []) });
      const tids = all ? O.tenants().filter(t => !['T-PAQ', 'T-LTR'].includes(t.id) && t.id !== 'T-MDL' || id === 'pi-016').map(t => t.id) : ['DG', 'T-CMI', 'T-CHA'];
      for (const tid of tids) gins('platform_incident_tenants', { incident_id: id, target_tenant_id: tid, notified_at: notif });
      if (['SEV1', 'SEV2'].includes(sev) || id === 'pi-016') gins('platform_announcements', { title: `${code} · ${title}`, body: pub, kind: 'INCIDENT', audience: 'ALL', target_tenant_ids: null, starts_at: notif, ends_at: end ? G.date.add(end.slice(0, 10), 2) + 'T23:59' : null, status: 'PUBLISHED', published_at: notif, incident_id: id, created_by_platform_user: 'pu-eng' });
    }
    raw('support_tickets').find(t => t.id === 'tk-90').incident_id = 'pi-015';
    // anuncios
    gins('platform_announcements', { id: 'pa-mant', title: 'Mantenimiento programado de la base de datos', body: 'El martes 13/10 de 23:00 a 01:00 la aplicación estará en solo lectura por la actualización de la base de datos. Los pedidos de WhatsApp siguen llegando y se registran al terminar.', kind: 'MAINTENANCE', audience: 'ALL', target_tenant_ids: null, starts_at: '2026-10-13T23:00', ends_at: '2026-10-14T01:00', status: 'PUBLISHED', published_at: '2026-10-09T10:00', created_by_platform_user: 'pu-eng' });
    gins('platform_announcements', { id: 'pa-api', title: 'Nuevo: API pública con webhooks firmados', body: 'Conecta tu ERP, tu tienda o tu BI con claves de API por alcance y webhooks con firma HMAC. Revisa la documentación en API-08.', kind: 'NEW_FEATURE', audience: 'TENANTS', target_tenant_ids: ['DG', 'T-AND', 'T-AHU', 'T-LPR'], starts_at: '2026-10-01T09:00', ends_at: null, status: 'PUBLISHED', published_at: '2026-10-01T09:00', created_by_platform_user: 'pu-admin' });
    gins('platform_announcements', { id: 'pa-bill', title: 'Tu comprobante de octubre está pendiente', body: 'Regulariza el pago para evitar el paso a solo lectura. Puedes pagar con tarjeta o transferencia desde Facturación.', kind: 'BILLING', audience: 'TENANTS', target_tenant_ids: ['T-PNO', 'T-GRS'], starts_at: '2026-10-08T09:00', ends_at: null, status: 'PUBLISHED', published_at: '2026-10-08T09:00', created_by_platform_user: 'pu-billing' });
    gins('platform_announcements', { id: 'pa-draft', title: 'Nueva plantilla de etiquetas por marca', body: 'Cada marca puede tener su diseño de etiqueta con QR de trazabilidad.', kind: 'NEW_FEATURE', audience: 'PLAN', plan_code: 'MULTIMARCA', target_tenant_ids: null, starts_at: '2026-10-15T09:00', ends_at: null, status: 'DRAFT', created_by_platform_user: 'pu-admin' });
    const gerCs = raw('users').find(u => u.id === 'us-cs-gerente');
    G.db.insert('announcement_reads', { announcement_id: 'pa-mant', user_id: ger.id, read_at: '2026-10-09T12:10', tenant: 'DG' }, { silent: true });
    if (gerCs) G.db.insert('announcement_reads', { announcement_id: 'pa-mant', user_id: gerCs.id, read_at: '2026-10-09T15:00', tenant: 'CS' }, { silent: true });
    // bitácora de la consola
    const PA = [['pu-billing', 'TENANT_SUSPENDED', 'T-CJL', 'Mora de 40 días sin respuesta a los avisos', '2026-09-15T10:00'], ['pu-admin', 'CONSOLE_LOGIN', null, 'Inicio de sesión en la consola', '2026-10-10T08:02'], ['pu-billing', 'CONSOLE_LOGIN', null, 'Inicio de sesión en la consola', '2026-10-10T08:31'], ['pu-eng', 'INCIDENT_OPENED', null, 'Notificaciones de Mercado Pago con retraso', '2026-10-10T07:50'], ['pu-admin', 'PARAMETER_CHANGED', null, 'Ajuste de pesos de salud tras revisión trimestral', '2026-09-01T10:00'], ['pu-l1', 'TICKET_ANSWERED', 'T-PNO', 'Respuesta al ticket TK-0096', '2026-10-09T13:50'], ['pu-billing', 'TENANT_READ_ONLY', 'T-GRS', 'Mora mayor a 20 días', '2026-09-25T08:00']];
    for (const [pu, action, tid, reason, at] of PA) gins('platform_audit_log', { platform_user_id: pu, actor_name: (PU.find(p => p[0] === pu) || [])[2], action, target_tenant_id: tid, entity: tid ? 'subscriptions' : null, entity_id: null, reason, ip: '190.237.14.22', user_agent: 'Aycha Console/1.0', detail: {}, occurred_at: at });
    // métricas congeladas (corrida 1) de junio a setiembre
    for (const m of ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']) O.freezeMonth(m, { system: true, at: G.date.add(G.date.addMonths(m, 1), 1) + 'T06:00:00' });
  }, 'ops');

  /* ------------------------------------------------------------------
     Indicadores (KPI-OPS-01 a 13 de consola; 14 y 15 del tenant)
     ------------------------------------------------------------------ */
  const kmonth = p => G.date.month(p.from || G.TODAY);
  for (let i = 1; i <= 13; i++) { const code = 'KPI-OPS-' + U.pad(i, 2); G.kpiCalc[code] = p => O.computeMonth(kmonth(p))[code]; }
  G.kpiCalc['KPI-OPS-08'] = p => { const rows = M.usageByPlan(M.monthEnd(kmonth(p))); return { value: rows.length ? R(U.sum(rows, x => x.avg) / rows.length, 1) : null, rows }; };
  G.kpiCalc['KPI-OPS-11'] = p => { const v = M.firstResponseMedian(kmonth(p), p.priority); return { value: v === null ? null : R(v, 2) }; };
  G.kpiCalc['KPI-OPS-12'] = p => M.availability(p.component || null, p.from || kmonth(p), p.to || M.monthEnd(kmonth(p)));
  G.kpiCalc['KPI-OPS-14'] = p => { const m = kmonth(p), d1 = M.monthEnd(m); const v = median(G.db.all('support_tickets').filter(t => t.resolved_at && t.resolved_at.slice(0, 10) >= m && t.resolved_at.slice(0, 10) <= d1).map(t => hoursBetween(t.opened_at, t.resolved_at))); return { value: v === null ? null : R(v, 2) }; };
  G.kpiCalc['KPI-OPS-15'] = p => { const m = kmonth(p), d1 = M.monthEnd(m); const gs = G.db.all('support_access_grants').filter(g => g.approved_at && g.approved_at.slice(0, 10) >= m && g.approved_at.slice(0, 10) <= d1); return { value: R(U.sum(gs, g => O.grantHours(g)), 2), denominator: gs.length }; };

  /* ------------------------------------------------------------------
     Ganchos: alertas, búsqueda y escaneo
     ------------------------------------------------------------------ */
  G.alertProviders.push(() => {
    const out = []; const role = G.ctx.role;
    if (['ADMIN_SISTEMA', 'GERENTE'].includes(role)) {
      const p = raw('support_access_grants').filter(g => g.tenant === G.ctx.tenant && g.status === 'REQUESTED');
      if (p.length) out.push({ module: 'OPS', title: `${p.length} solicitud(es) de acceso de soporte por aprobar`, detail: p.map(g => `${g.platform_user_name}: ${g.reason.slice(0, 70)}`).join(' · '), tone: 'warn', go: () => G.go('OPS-14') });
    }
    if (role === 'SOPORTE_PLATAFORMA') {
      const br = raw('support_tickets').filter(t => !t.first_response_at && !['RESOLVED', 'CLOSED'].includes(t.status) && O.sla(t).breached);
      if (br.length) out.push({ module: 'OPS', title: `${br.length} ticket(s) sin primera respuesta fuera de plazo`, detail: br.map(t => `${t.number} · ${O.tenantName(t.tenant)}`).join(', '), tone: 'bad', go: () => G.go('OPS-09') });
      const down = COMPONENTS.filter(c => { const l = O.lastCheck(c[0]); return l && l.status === 'DOWN'; });
      if (down.length) out.push({ module: 'OPS', title: 'Componentes caídos: ' + down.map(c => c[1]).join(', '), tone: 'bad', go: () => G.go('OPS-07') });
    }
    const t = rget('tenants', G.ctx.tenant);
    if (t && ['SUSPENDED', 'READ_ONLY'].includes(t.status) && role !== 'SOPORTE_PLATAFORMA') out.push({ module: 'OPS', title: t.status === 'SUSPENDED' ? 'La cuenta está suspendida' : 'La cuenta está en solo lectura', detail: t.status_reason || '', tone: 'bad', go: () => G.screens['OPS-15'] && G.go('OPS-15') });
    return out;
  });
  G.searchProviders.push(q => {
    const out = []; const ql = q.toLowerCase(); const console = G.ctx.role === 'SOPORTE_PLATAFORMA';
    for (const t of raw('support_tickets').filter(x => (console || x.tenant === G.ctx.tenant) && (x.number.toLowerCase().includes(ql) || x.subject.toLowerCase().includes(ql))).slice(0, 5)) out.push({ label: `${t.number} · ${t.subject}`, sub: `Ticket · ${O.tenantName(t.tenant)} · ${SL[t.status][0]}`, go: () => G.go(console ? 'OPS-09' : 'OPS-15', { id: t.id }) });
    if (console) for (const t of O.tenants().filter(x => x.name.toLowerCase().includes(ql) || (x.short || '').toLowerCase().includes(ql)).slice(0, 4)) out.push({ label: t.short || t.name, sub: 'Empresa cliente · OPS-03', go: () => G.go('OPS-03', { id: t.id }) });
    return out;
  });
  G.scanHandlers.push(code => { const t = raw('support_tickets').find(x => x.number === code && (G.ctx.role === 'SOPORTE_PLATAFORMA' || x.tenant === G.ctx.tenant)); return t ? () => G.go(G.ctx.role === 'SOPORTE_PLATAFORMA' ? 'OPS-09' : 'OPS-15', { id: t.id }) : null; });

  /* ------------------------------------------------------------------
     Interfaz: piezas comunes
     ------------------------------------------------------------------ */
  const tryDo = (fn, okMsg) => { try { const r = fn(); if (okMsg) ui.toast(okMsg, 'ok'); G.refresh(); return r; } catch (e) { ui.toast(e.message, 'bad'); return false; } };
  const tenantOpts = (pred = () => true) => O.tenants().filter(pred).map(t => [t.id, `${t.short || t.name}`]);
  function consoleBar(body) {
    O.tick();
    const a = O.actor(); const c = G.ctx.opsConsole;
    const sel = h('select', { class: 'input', style: 'width:auto;min-width:220px', attrs: { 'aria-label': 'Usuario de consola (demo)', id: 'ops-actor' } }, raw('platform_users').filter(u => u.status === 'ACTIVE').map(u => h('option', { value: u.id, selected: a && u.id === a.id }, `${u.full_name} · ${proleName(u.role)}`)));
    sel.addEventListener('change', () => { G.ctx.opsConsole = { platform_user_id: sel.value, at: now(), ip: O.actorIp(), last: now(), demo: true }; O.paudit('CONSOLE_LOGIN', { reason: 'Cambio rápido de usuario de consola (demo)', pu: rget('platform_users', sel.value) }); G.db.save(); G.refresh(); });
    body.appendChild(h('div', { class: 'notice ' + (G.ctx.role === 'SOPORTE_PLATAFORMA' ? 'info' : 'warn') },
      h('div', { class: 'row between', style: 'gap:10px;flex-wrap:wrap;width:100%' },
        h('div', { style: 'min-width:0' }, h('b', null, 'Consola Intelectalab'), ` · ${a ? a.full_name : '—'} (${a ? proleName(a.role) : '—'}) · IP ${O.actorIp()}${c && !c.demo ? ' · sesión desde ' + G.fmt.datetime(c.at).slice(-5) : ''}`,
          G.ctx.role !== 'SOPORTE_PLATAFORMA' ? h('div', { class: 'small' }, 'Vista de demostración: en el sistema real la empresa no ve la consola (RN-OPS-06). Acción con el rol de plataforma elegido.') : null),
        h('div', { class: 'row', style: 'gap:6px' }, sel, ui.btn(c && !c.demo ? 'Cerrar consola' : 'Ingresar (OPS-01)', () => { if (c && !c.demo) { O.consoleLogout(); G.go('OPS-01'); } else G.go('OPS-01'); }, { sm: true })))));
  }
  const integ = ints => h('div', { class: 'row', style: 'gap:4px;flex-wrap:wrap' }, [['OSE', 'OSE'], ['WHATSAPP', 'WA'], ['MERCADOPAGO', 'MP']].map(([k, l]) => { const s = (ints || {})[k] || 'NA'; return ui.badge(l, SL[s] ? SL[s][1] : ''); }));
  const scoreBadge = (score, level) => h('span', { class: 'row', style: 'gap:6px;align-items:center' }, h('b', { class: 'num' }, score), st(level));
  function checkGroup(options, selected = [], name = 'chk') {
    const box = h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px 14px' });
    const inputs = options.map(([v, l]) => { const i = h('input', { type: 'checkbox', checked: selected.includes(v), attrs: { id: `${name}-${v}`, value: v } }); box.appendChild(h('label', { class: 'check', attrs: { for: `${name}-${v}` } }, i, h('span', null, l))); return i; });
    box.value = () => inputs.filter(i => i.checked).map(i => i.value);
    return box;
  }
  const field = (label, node, help) => h('div', { class: 'field span2' }, h('label', null, label), node, help ? h('div', { class: 'help' }, help) : null);
  const insertBeforeActions = (form, node) => { const act = form.querySelector('.form-actions'); form.insertBefore(node, act); };
  function chatView(t) {
    const items = [{ at: t.opened_at, by_type: 'CUSTOMER', by: t.opened_by_name, text: t.description }].concat(t.replies || []);
    return h('div', { class: 'chat', style: 'display:grid;gap:8px' }, items.map(m => h('div', { class: 'msg' + (m.by_type === 'PLATFORM' ? ' out' : ''), style: m.by_type === 'PLATFORM' ? 'justify-self:end' : 'justify-self:start' }, m.text, h('div', { class: 'meta small muted' }, `${m.by} · ${G.fmt.datetime(m.at)}`))));
  }

  /* ---------- OPS-01 Ingreso a la consola ---------- */
  function scrLogin(el) {
    O.tick();
    const body = ui.page(el, { code: 'OPS-01', title: 'Ingreso a la consola', sub: 'Personal de Intelectalab: correo, contraseña y segundo factor obligatorio (RN-OPS-01); solo desde redes permitidas si la lista no está vacía (RN-OPS-16).' });
    const c = G.ctx.opsConsole; const allow = O.pparam('ops_console_ip_allowlist') || [];
    const lim = Number(O.pparam('ops_console_session_minutes') || 30);
    if (c && !c.demo) { const pu = rget('platform_users', c.platform_user_id); body.appendChild(ui.card('Sesión de consola abierta', h('div', { class: 'stack' }, ui.dl([['Usuario', pu ? pu.full_name : '—'], ['Rol de plataforma', pu ? proleName(pu.role) : '—'], ['IP', c.ip], ['Inicio', G.fmt.datetime(c.at)], ['Cierre por inactividad', `${lim} minutos sin actividad (RN-OPS-16)`]]), h('div', { class: 'row' }, ui.btn('Ir a empresas (OPS-02)', () => G.go('OPS-02'), { kind: 'primary' }), ui.btn('Cerrar sesión de consola', () => { O.consoleLogout(); G.refresh(); }, { kind: 'danger' }))))); }
    const IPS = [['190.237.14.22', '190.237.14.22 · Oficina Intelectalab (Miraflores)'], ['181.176.90.14', '181.176.90.14 · VPN de soporte'], ['200.48.33.7', '200.48.33.7 · Red pública (cafetería)']];
    const codeBox = h('div', { class: 'small muted' });
    const f = ui.form({
      id: 'ops01', submitLabel: 'Ingresar a la consola', values: { email: 'soporte@intelectalab.com', password: '', ip: IPS[0][0] },
      fields: [
        { key: 'email', label: 'Correo', required: true, onChange: v => showCode(v) },
        { key: 'password', label: 'Contraseña', type: 'password', required: true, placeholder: 'DonGuando2026 en la demo' },
        { key: 'code', label: 'Código de segundo factor', required: true, placeholder: '000000' },
        { key: 'ip', label: 'Conexión desde (simulada)', type: 'select', options: IPS, required: true },
      ],
      onSubmit: v => { try { O.consoleLogin(v); ui.toast('Sesión de consola iniciada', 'ok'); G.go('OPS-02'); return true; } catch (e) { return e.message; } },
    });
    function showCode(email) { ui.clear(codeBox); const pu = raw('platform_users').find(x => x.email === String(email || '').trim().toLowerCase()); if (pu && pu.twofa_enabled) codeBox.append('App autenticadora (simulada): ', h('b', { class: 'mono' }, G.auth.totp(pu)), ` · ${pu.full_name}`); else if (pu) codeBox.append(`${pu.full_name} no tiene segundo factor: la cuenta no se puede activar (RN-OPS-01).`); }
    showCode('soporte@intelectalab.com');
    insertBeforeActions(f, codeBox);
    body.appendChild(h('div', { class: 'grid side-r' },
      ui.card('Credenciales', f),
      h('div', { class: 'stack' },
        ui.card('Redes permitidas', h('div', { class: 'stack' }, allow.length ? h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, allow.map(x => ui.badge(x, 'info'))) : ui.notice('Lista vacía: se acepta cualquier red. Configúrala en OPS-16 (ops_console_ip_allowlist).', 'warn'), h('div', { class: 'small muted' }, `Inactividad máxima: ${lim} min · lecturas de salud cada ${O.pparam('ops_component_check_seconds')} s`))),
        ui.card('Usuarios de plataforma (demo)', h('div', { class: 'stack' }, raw('platform_users').map(u => h('button', { class: 'btn', style: 'justify-content:space-between', on: { click: () => { f.api.set('email', u.email); f.api.set('password', 'DonGuando2026'); showCode(u.email); } } }, h('span', null, u.full_name, h('span', { class: 'muted small' }, ' · ' + proleName(u.role))), st(u.status))))))));
  }

  /* ---------- OPS-02 Empresas ---------- */
  function scrTenants(el) {
    const body = ui.page(el, { code: 'OPS-02', title: 'Empresas', sub: 'Todas las empresas cliente con plan, estado, MRR, uso de límites, salud ponderada (RN-OPS-13) y tickets. Ordenadas por riesgo.', actions: [{ label: 'Recalcular salud', onClick: () => tryDo(() => { O.tenants().forEach(t => O.snapshotHealth(t.id)); O.paudit('HEALTH_RECOMPUTED', { reason: 'Recalculo manual de la salud de todas las empresas' }); }, 'Salud recalculada y guardada (tenant_health_snapshots)') }] });
    consoleBar(body);
    const rows = O.tenants().map(O.tenantRow);
    const subs = O.subs(); const act = rows.filter(r => ['ACTIVE', 'PAST_DUE'].includes(r.status));
    body.appendChild(ui.kpis([
      { label: 'Clientes activos', value: act.length, sub: `${rows.length} empresas en la plataforma` },
      { label: 'MRR', value: G.fmt.money(M.mrr(subs), 0), sub: `ingreso promedio ${G.fmt.money(M.arpa(subs), 0)}`, onClick: () => G.go('OPS-10') },
      { label: 'En riesgo', value: rows.filter(r => r.level === 'AT_RISK').length, sub: `salud bajo ${thresholds().risk}`, tone: 'warn' },
      { label: 'Críticas', value: rows.filter(r => r.level === 'CRITICAL').length, sub: `salud bajo ${thresholds().critical}`, tone: 'bad' },
      { label: 'Tickets abiertos', value: U.sum(rows, r => r.tickets), onClick: () => G.go('OPS-09') },
      { label: 'Accesos de soporte vigentes', value: U.sum(rows, r => r.grants), onClick: () => G.go('OPS-06') },
    ]));
    body.appendChild(ui.table({
      id: 'ops02', rows, sort: 'score', dir: 1, onRow: r => G.go('OPS-03', { id: r.id }),
      filters: [{ key: 'status', label: 'Estado', options: ['ACTIVE', 'TRIAL', 'PAST_DUE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED'].map(s => [s, SL[s][0]]) }, { key: 'plan_code', label: 'Plan', options: Object.entries(PLANS).map(([k, v]) => [k, v.name]) }, { key: 'level', label: 'Salud', options: [['HEALTHY', 'Saludable'], ['AT_RISK', 'En riesgo'], ['CRITICAL', 'Crítica']] }],
      columns: [
        { key: 'short', label: 'Empresa', render: r => h('div', null, h('b', null, r.short), h('div', { class: 'small muted' }, r.id + ' · ' + r.product)) },
        { key: 'plan', label: 'Plan', render: r => h('span', null, r.plan, h('div', { class: 'small muted' }, r.period === 'ANNUAL' ? 'anual' : 'mensual')) },
        { key: 'status', label: 'Estado', render: r => st(r.status) },
        { key: 'days', label: 'Días en el estado', align: 'r' },
        { key: 'mrr', label: 'MRR', align: 'r', render: r => G.fmt.money(r.mrr, 0) },
        { key: 'usageMax', label: 'Uso máx. de límites', render: r => h('div', { style: 'min-width:110px' }, ui.progress(r.usageMax, r.usageMax >= 90 ? 'bad' : r.usageMax >= 75 ? 'warn' : ''), h('span', { class: 'small muted' }, G.fmt.pct(r.usageMax, 0))) },
        { key: 'score', label: 'Salud', render: r => scoreBadge(r.score, r.level) },
        { key: 'tickets', label: 'Tickets', align: 'r' },
        { key: 'integ', label: 'Integraciones', sort: false, value: r => Object.values(r.integrations).join(' '), render: r => integ(r.integrations) },
      ],
    }));
    body.appendChild(ui.notice(`Salud = uso ${O.weights().usage} % + cobro ${O.weights().billing} % + OSE ${O.weights().ose} % + WhatsApp ${O.weights().whatsapp} % + tickets ${O.weights().tickets} % (ops_health_weights). La consola ve suscripciones, uso, tickets y accesos de todas las empresas, pero no sus pedidos, clientes ni comprobantes sin un acceso aprobado (RN-OPS-06).`, 'info'));
  }

  /* ---------- OPS-03 Ficha de la empresa ---------- */
  function scrTenant(el, params) {
    const tid = params.id || 'DG'; const t = rget('tenants', tid);
    const body = ui.page(el, { code: 'OPS-03', title: 'Ficha de la empresa', sub: 'Suscripción e historial, uso por límite, salud y sus componentes, comprobantes del SaaS, tickets, incidentes, accesos de soporte y acciones de la consola.', actions: [{ label: 'Suspender o reactivar', onClick: () => G.go('OPS-04', { id: tid }) }, { label: 'Solicitar acceso de soporte', kind: 'primary', onClick: () => G.go('OPS-05', { tenant: tid }) }] });
    consoleBar(body);
    const sel = h('select', { class: 'input', style: 'max-width:360px', attrs: { 'aria-label': 'Empresa', id: 'ops03-t' } }, O.tenants().map(x => h('option', { value: x.id, selected: x.id === tid }, `${x.short || x.name} (${x.id})`)));
    sel.addEventListener('change', () => G.go('OPS-03', { id: sel.value }));
    body.appendChild(sel);
    if (!t) { body.appendChild(ui.empty('Empresa no encontrada.')); return; }
    const row = O.tenantRow(t); const s = O.sub(tid);
    body.appendChild(ui.kpis([
      { label: 'Empresa', value: row.short, sub: t.name },
      { label: 'Plan', value: s.plan_name, sub: `${s.period === 'ANNUAL' ? 'anual' : 'mensual'} · ${G.fmt.money(s.price)}${s.discount_pct ? ' · −' + s.discount_pct + ' %' : ''}` },
      { label: 'Estado', value: SL[s.status][0], sub: `${G.fmt.days(O.daysInStatus(s))} en el estado`, tone: SL[s.status][1] },
      { label: 'MRR', value: G.fmt.money(row.mrr), sub: 'sin IGV, después de descuentos' },
      { label: 'Salud', value: row.score + ' / 100', sub: SL[row.level][0], tone: SL[row.level][1] },
      { label: 'Tickets abiertos', value: row.tickets },
    ]));
    if (['SUSPENDED', 'READ_ONLY'].includes(s.status)) body.appendChild(ui.notice(['Lo que ve el cliente: ', O.suspensionPage(tid)], 'warn'));
    const tabs = [
      { key: 'sub', label: 'Suscripción', render: p => {
        const ev = raw('subscription_events').filter(e => e.tenant === tid).sort(U.by('occurred_at', -1));
        p.appendChild(h('div', { class: 'grid c2' }, ui.card('Datos', ui.dl([['Producto', 'Aycha Comercial'], ['Plan', s.plan_name + ' (' + s.plan_code + ')'], ['Periodo', s.period === 'ANNUAL' ? 'Anual (MRR = precio / 12)' : 'Mensual'], ['Precio', G.fmt.money(s.price)], ['Descuento', s.discount_pct ? s.discount_pct + ' %' : '—'], ['Alta', G.fmt.date(s.created_at)], ['Activación', G.fmt.date(s.activated_at)], ['Prueba hasta', G.fmt.datetime(s.trial_ends_at)], ['Motivo del estado', s.status_reason], ['Dominio', t.hostname]])),
          ui.card('Historial de la suscripción', ev.length ? tl(ev.map(e => ({ when: G.fmt.date(e.occurred_at), tone: e.to_status && SL[e.to_status] ? SL[e.to_status][1] : null, body: h('div', null, h('b', null, { CREATED: 'Alta', STATUS_CHANGED: 'Cambio de estado', PLAN_CHANGED: 'Cambio de plan', PAYMENT_FAILED: 'Pago fallido', PAYMENT_CONFIRMED: 'Pago confirmado' }[e.event_type] || e.event_type), e.from_status || e.to_status ? h('span', null, ' ', e.from_status ? SL[e.from_status] ? SL[e.from_status][0] : e.from_status : '', ' → ', e.to_status && SL[e.to_status] ? SL[e.to_status][0] : e.to_status || '') : null, h('div', { class: 'small muted' }, (e.reason || '') + (e.actor_name ? ' · ' + e.actor_name : '') + (e.detail && e.detail.to_fee ? ` · ${G.fmt.money(e.detail.from_fee, 0)} → ${G.fmt.money(e.detail.to_fee, 0)}` : ''))) }))) : ui.empty())));
      } },
      { key: 'use', label: 'Uso', render: p => p.appendChild(ui.card('Uso por límite del plan', h('div', { class: 'stack' }, row.usage.map(u => h('div', { style: 'display:grid;grid-template-columns:minmax(120px,30%) minmax(0,1fr) auto;gap:10px;align-items:center' }, h('span', { class: 'small' }, u.name), ui.progress(u.pct, u.pct >= 90 ? 'bad' : u.pct >= 75 ? 'warn' : ''), h('span', { class: 'small num' }, `${G.fmt.num(u.used)} / ${u.limit === null || u.limit === undefined ? 'sin límite' : G.fmt.num(u.limit)}`))), h('div', { class: 'small muted' }, `Volumen del mes: ${G.fmt.num(row.signals.volume.orders_month || 0)} pedidos procesados · ${G.fmt.num(row.signals.volume.messages_month || 0)} mensajes enviados · ${row.signals.live ? 'medido en vivo' : 'última lectura de los adaptadores'}`)))) },
      { key: 'health', label: 'Salud', render: p => {
        const hs = row.health; const snaps = raw('tenant_health_snapshots').filter(x => x.target_tenant_id === tid).sort(U.by('computed_at'));
        p.appendChild(h('div', { class: 'grid c2' },
          ui.card(`Puntaje ${hs.score} · ${SL[hs.level][0]}`, h('div', { class: 'stack' }, Object.values(hs.parts).map(x => h('div', null, h('div', { class: 'row between' }, h('b', null, `${x.label} (peso ${x.weight})`), h('span', { class: 'num' }, x.score)), ui.progress(x.score, x.score < 40 ? 'bad' : x.score < 70 ? 'warn' : 'ok'), h('div', { class: 'small muted' }, x.detail))), h('div', { class: 'row', style: 'gap:6px' }, h('span', { class: 'small' }, 'Integraciones:'), integ(row.integrations)), ui.btn('Guardar lectura de salud', () => tryDo(() => O.snapshotHealth(tid), 'Lectura guardada'), { sm: true }))),
          ui.card('Evolución', snaps.length > 1 ? ui.chart.line({ labels: snaps.map(x => G.fmt.date(x.computed_at).slice(0, 5)), series: [{ name: 'Salud', values: snaps.map(x => x.score) }], min: 0, max: 100, ref: thresholds().risk }) : ui.empty('Aún sin lecturas guardadas.'))));
      } },
      { key: 'inv', label: 'Comprobantes del SaaS', render: p => {
        const inv = raw('saas_invoices').filter(i => i.tenant === tid).sort(U.by('period_start', -1));
        p.appendChild(ui.table({ id: 'ops03-inv', rows: inv, search: false, columns: [{ key: 'num', label: 'Comprobante', value: i => `${i.series}-${U.pad(i.number || 0, 8)}`, mono: true }, { key: 'period_start', label: 'Periodo', render: i => G.date.monthName(i.period_start) }, { key: 'total', label: 'Total', align: 'r', render: i => G.fmt.money(i.total) }, { key: 'due_date', label: 'Vence', render: i => G.fmt.date(i.due_date) }, { key: 'status', label: 'Estado', render: i => h('span', null, st(i.status), i.status === 'OPEN' && i.due_date < G.TODAY ? ui.badge(`${G.date.diff(G.TODAY, i.due_date)} días de mora`, 'bad') : null) }, { key: 'einvoice_status', label: 'SUNAT', render: i => ui.status(i.einvoice_status) }], empty: 'Sin comprobantes del SaaS.' }));
      } },
      { key: 'tk', label: 'Tickets', count: raw('support_tickets').filter(x => x.tenant === tid).length, render: p => p.appendChild(ticketTable(raw('support_tickets').filter(x => x.tenant === tid), 'ops03-tk', true)) },
      { key: 'inc', label: 'Incidentes', render: p => { const ids = new Set(raw('platform_incident_tenants').filter(x => x.target_tenant_id === tid).map(x => x.incident_id)); p.appendChild(ui.table({ id: 'ops03-inc', search: false, rows: raw('platform_incidents').filter(i => ids.has(i.id)).sort(U.by('started_at', -1)), onRow: i => incidentDrawer(i), columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'title', label: 'Incidente' }, { key: 'severity', label: 'Sev.', render: i => st(i.severity) }, { key: 'started_at', label: 'Inicio', render: i => G.fmt.datetime(i.started_at) }, { key: 'status', label: 'Estado', render: i => st(i.status) }], empty: 'No la afectó ningún incidente.' })); } },
      { key: 'acc', label: 'Accesos de soporte', render: p => { p.appendChild(grantTable(raw('support_access_grants').filter(g => g.tenant === tid), 'ops03-gr')); p.appendChild(ui.card('Lo que hizo el soporte (bitácora del cliente)', accessLogTable(raw('support_access_log').filter(l => l.tenant === tid), 'ops03-log'), { flush: true })); } },
      { key: 'aud', label: 'Acciones de la consola', render: p => p.appendChild(auditTable(raw('platform_audit_log').filter(a => a.target_tenant_id === tid), 'ops03-aud')) },
    ];
    body.appendChild(ui.tabs(tabs, { key: 'ops03:' + tid }));
    body.appendChild(ui.notice('RN-OPS-06: los pedidos, clientes y comprobantes de la empresa no se muestran aquí. Para revisarlos, solicita un acceso de soporte (OPS-05) y entra con OPS-06 cuando el cliente lo apruebe.', 'info'));
  }
  function ticketTable(rows, id, console) {
    return ui.table({
      id, rows: rows.slice().sort(U.by('opened_at', -1)), onRow: t => ticketDrawer(t, console),
      filters: [{ key: 'status', label: 'Estado', options: TSTAT }, { key: 'priority', label: 'Prioridad', options: PRIOS }],
      columns: [
        { key: 'number', label: 'Ticket', mono: true },
        console ? { key: 'tenant', label: 'Empresa', value: t => O.tenantName(t.tenant) } : null,
        { key: 'subject', label: 'Asunto', render: t => h('div', { style: 'max-width:360px' }, t.subject, h('div', { class: 'small muted' }, catName(t.category))) },
        { key: 'priority', label: 'Prioridad', render: t => ui.badge(prioName(t.priority), prioTone[t.priority]) },
        { key: 'status', label: 'Estado', render: t => st(t.status) },
        { key: 'opened_at', label: 'Abierto', render: t => G.fmt.datetime(t.opened_at) },
        { key: 'sla', label: '1.ª respuesta', sort: false, render: t => slaBadge(t) },
        console ? { key: 'assigned_platform_user', label: 'Asignado', value: t => (rget('platform_users', t.assigned_platform_user) || {}).full_name || 'Sin asignar' } : { key: 'satisfaction', label: 'Calificación', render: t => t.satisfaction ? '★'.repeat(t.satisfaction) : '—' },
      ].filter(Boolean),
    });
  }
  function grantTable(rows, id, actions) {
    return ui.table({
      id, rows: rows.slice().sort(U.by('requested_at', -1)), onRow: g => grantDrawer(g), actions, search: rows.length > 6,
      columns: [
        { key: 'tenant', label: 'Empresa', value: g => O.tenantName(g.tenant) },
        { key: 'platform_user_name', label: 'Soporte' },
        { key: 'reason', label: 'Motivo', render: g => h('div', { style: 'max-width:300px' }, g.reason, g.ticket_id ? h('div', { class: 'small muted' }, (rget('support_tickets', g.ticket_id) || {}).number) : null) },
        { key: 'access_level', label: 'Nivel', render: g => lvl(g.access_level) },
        { key: 'modules', label: 'Módulos', value: g => (g.modules || []).join(', ') || 'Todos' },
        { key: 'allow_export', label: 'Exportar', value: g => g.allow_export ? 'Sí' : 'No' },
        { key: 'status', label: 'Estado', render: g => h('span', null, st(g.status), g.status === 'APPROVED' ? h('div', { class: 'small muted' }, 'quedan ' + left(g.expires_at)) : null) },
        { key: 'expires_at', label: 'Vence', render: g => g.expires_at ? G.fmt.datetime(g.expires_at) : `${g.requested_hours} h sugeridas` },
      ],
    });
  }
  function accessLogTable(rows, id) {
    const A = { SESSION_START: 'Inicio de sesión', VIEW: 'Consulta', CREATE: 'Alta', UPDATE: 'Cambio', EXPORT: 'Exportación', SESSION_END: 'Fin de sesión' };
    return ui.table({ id, rows: rows.slice().sort(U.by('occurred_at', -1)), pageSize: 15, filters: [{ key: 'action', label: 'Acción', options: Object.entries(A) }], columns: [{ key: 'occurred_at', label: 'Fecha y hora', render: l => G.fmt.datetime(l.occurred_at) }, { key: 'platform_user_name', label: 'Soporte' }, { key: 'action', label: 'Acción', render: l => ui.badge(A[l.action] || l.action, l.action === 'UPDATE' || l.action === 'EXPORT' ? 'warn' : l.action === 'VIEW' ? 'info' : '') }, { key: 'entity', label: 'Qué', value: l => (l.detail && l.detail.query) || l.entity || '—' }, { key: 'ip', label: 'IP', mono: true }, { key: 'grant_id', label: 'Acceso', mono: true }], empty: 'El soporte no hizo nada todavía.' });
  }
  function auditTable(rows, id) {
    return ui.table({ id, onRow: a => ui.drawer(a.action, codeBlock(JSON.stringify(a, null, 2)), { code: 'OPS-13' }), rows: rows.slice().sort(U.by('occurred_at', -1)), pageSize: 20, filters: [{ key: 'action', label: 'Acción', options: [...new Set(rows.map(r => r.action))].sort().map(a => [a, a]) }], columns: [{ key: 'occurred_at', label: 'Fecha y hora', render: a => G.fmt.datetime(a.occurred_at) }, { key: 'actor_name', label: 'Usuario' }, { key: 'action', label: 'Acción', mono: true }, { key: 'target_tenant_id', label: 'Empresa', value: a => a.target_tenant_id ? O.tenantName(a.target_tenant_id) : '—' }, { key: 'reason', label: 'Motivo', render: a => h('div', { style: 'max-width:340px' }, a.reason || '—') }, { key: 'ip', label: 'IP', mono: true }], empty: 'Sin acciones registradas.' });
  }
  function grantDrawer(g) {
    ui.drawer(`Acceso de soporte · ${O.tenantName(g.tenant)}`, bd => {
      bd.appendChild(ui.dl([['Estado', st(g.status)], ['Soporte', g.platform_user_name], ['Motivo', g.reason], ['Ticket', (rget('support_tickets', g.ticket_id) || {}).number], ['Nivel', lvl(g.access_level)], ['Módulos', (g.modules || []).join(', ') || 'Todos'], ['Exportar', g.allow_export ? 'Permitido' : 'No permitido'], ['Solicitado', G.fmt.datetime(g.requested_at) + ` · ${g.requested_hours} h sugeridas`], ['Aprobado por', g.approved_by_name ? `${g.approved_by_name} · ${G.fmt.datetime(g.approved_at)}` : '—'], ['Vigencia', g.starts_at ? `${G.fmt.datetime(g.starts_at)} → ${G.fmt.datetime(g.expires_at)}` : '—'], ['Usuario técnico', g.support_user_id ? `${g.support_user_id} (${(rget('users', g.support_user_id) || {}).status || '—'})` : '—'], ['Cierre', g.revoke_reason ? `${G.fmt.datetime(g.revoked_at)} · ${g.revoke_reason}` : g.ended_at ? G.fmt.datetime(g.ended_at) : '—'], ['Horas usadas', fmtH(O.grantHours(g))]]));
      bd.appendChild(h('h3', null, 'Bitácora del acceso'));
      bd.appendChild(accessLogTable(raw('support_access_log').filter(l => l.grant_id === g.id), 'grantlog-' + g.id));
    }, { code: 'OPS', wide: true });
  }
  function ticketDrawer(t, console) {
    ui.drawer(`${t.number} · ${t.subject}`, (bd, close) => {
      const act = h('div', { class: 'row', style: 'flex-wrap:wrap' });
      if (console) {
        if (!t.assigned_platform_user || t.assigned_platform_user !== (O.actor() || {}).id) act.appendChild(ui.btn('Asignarme', () => { tryDo(() => O.assignTicket(t.id), 'Ticket asignado'); close(); ticketDrawer(rget('support_tickets', t.id), console); }, { sm: true }));
        if (!['RESOLVED', 'CLOSED'].includes(t.status)) act.appendChild(ui.btn('Marcar resuelto', () => { tryDo(() => O.setTicketStatus(t.id, 'RESOLVED', { by: (O.actor() || {}).full_name }), 'Ticket resuelto'); close(); }, { sm: true }));
        act.appendChild(ui.btn('Solicitar acceso de soporte', () => { close(); G.go('OPS-05', { tenant: t.tenant, ticket: t.id }); }, { sm: true }));
        const openInc = raw('platform_incidents').filter(i => i.status !== 'RESOLVED');
        if (openInc.length) { const s2 = h('select', { class: 'input', style: 'width:auto', attrs: { 'aria-label': 'Incidente' } }, h('option', { value: '' }, 'Vincular a incidente…'), openInc.map(i => h('option', { value: i.id, selected: t.incident_id === i.id }, `${i.code} · ${i.title}`))); s2.addEventListener('change', () => { if (s2.value) tryDo(() => O.linkTicketIncident(t.id, s2.value), 'Ticket vinculado al incidente (RN-OPS-14)'); }); act.appendChild(s2); }
      } else if (['RESOLVED'].includes(t.status) || (t.status === 'CLOSED' && !t.satisfaction)) {
        act.appendChild(h('span', { class: 'small muted' }, 'Califica la atención:'));
        for (let k = 1; k <= 5; k++) act.appendChild(ui.btn('★'.repeat(k), () => { tryDo(() => O.rateTicket(t.id, k), 'Gracias por calificar'); close(); }, { sm: true, kind: 'ghost' }));
      }
      bd.appendChild(act);
      const sla = O.sla(t);
      bd.appendChild(ui.dl([['Empresa', O.tenantName(t.tenant)], ['Estado', st(t.status)], ['Categoría', catName(t.category)], ['Prioridad', ui.badge(prioName(t.priority), prioTone[t.priority])], ['Abierto por', `${t.opened_by_name || '—'} · ${G.fmt.datetime(t.opened_at)}`], ['Plazo de 1.ª respuesta', `${sla.target} h ${t.priority === 'URGENT' ? '(24×7)' : '(horario hábil lun–sáb 09:00–18:00, D-OPS-04)'} · vence ${G.fmt.datetime(sla.deadline)}`], ['1.ª respuesta', t.first_response_at ? `${G.fmt.datetime(t.first_response_at)} · ${fmtH(sla.elapsed)} ${sla.met ? '(cumplió)' : '(fuera de plazo)'}` : 'Pendiente'], ['Asignado', (rget('platform_users', t.assigned_platform_user) || {}).full_name || 'Sin asignar'], ['Incidente', (rget('platform_incidents', t.incident_id) || {}).code], ['Adjuntos', (t.attachments || []).join(', ') || '—'], ['Calificación', t.satisfaction ? '★'.repeat(t.satisfaction) + ` (${t.satisfaction}/5)` : '—']]));
      bd.appendChild(h('h3', null, 'Conversación'));
      bd.appendChild(chatView(t));
      if (t.status !== 'CLOSED' && (console || G.can('ops.ticket.create'))) {
        bd.appendChild(ui.form({ id: 'tkreply', submitLabel: console ? 'Responder al cliente' : 'Enviar respuesta', values: { status: console ? 'WAITING_CUSTOMER' : 'IN_PROGRESS' }, fields: [{ key: 'text', label: 'Respuesta', type: 'textarea', required: true }].concat(console ? [{ key: 'status', label: 'Dejar el ticket en', type: 'select', options: TSTAT.filter(x => x[0] !== 'OPEN' && x[0] !== 'CLOSED'), required: true }] : []), onSubmit: v => { try { O.replyTicket(t.id, v.text, { by: console ? 'PLATFORM' : 'CUSTOMER', status: v.status }); close(); ui.toast('Respuesta enviada', 'ok'); G.refresh(); ticketDrawer(rget('support_tickets', t.id), console); return true; } catch (e) { return e.message; } } }));
      }
      bd.appendChild(h('h3', null, 'Historial'));
      bd.appendChild(tl((t.history || []).map(x => ({ when: G.fmt.datetime(x.at), body: h('div', null, (x.from ? (SL[x.from] || [x.from])[0] + ' → ' : '') + (SL[x.to] || [x.to])[0], h('div', { class: 'small muted' }, (x.by || '') + (x.reason ? ' · ' + x.reason : ''))) }))));
    }, { code: console ? 'OPS-09' : 'OPS-15', wide: true });
  }

  /* ---------- OPS-04 Suspender o reactivar ---------- */
  function scrStatus(el, params) {
    const body = ui.page(el, { code: 'OPS-04', title: 'Suspender o reactivar', sub: 'Cambio de estado con motivo obligatorio y aviso al cliente (RN-OPS-07). Lo hacen BILLING y PLATFORM_ADMIN (RN-OPS-10).' });
    consoleBar(body);
    const st0 = { tenant: params.id || 'T-PNO' };
    const preview = h('div', { class: 'stack' });
    const drawPreview = v => {
      ui.clear(preview); const s = O.sub(v.tenant); if (!s) return;
      preview.append(ui.dl([['Estado actual', st(s.status)], ['Días en el estado', G.fmt.days(O.daysInStatus(s))], ['MRR', G.fmt.money(s.monthly_fee)], ['Mora', `${O.signals(v.tenant).billing.days_past_due} días`]]));
      preview.append(ui.notice([h('b', null, `Efecto de pasar a «${SL[v.to][0]}»: `), O.STATUS_EFFECT[v.to]], v.to === 'ACTIVE' ? 'ok' : v.to === 'SUSPENDED' ? 'bad' : 'warn'));
      if (v.to !== 'ACTIVE') { const fake = Object.assign({}, s, { status: v.to, status_reason: v.reason || '(motivo)' }); const t = rget('tenants', v.tenant); preview.append(h('div', { class: 'small muted' }, 'Página que verá el cliente:'), (() => { const box = h('div', { style: 'border:1px solid var(--line);border-radius:12px;padding:18px;text-align:center;display:grid;gap:6px' }, h('b', null, v.to === 'READ_ONLY' ? 'Tu cuenta está en modo solo lectura' : 'Tu cuenta está suspendida'), h('span', { class: 'small' }, `${t.name}: ${fake.status_reason}`), h('span', { class: 'small muted' }, 'soporte@intelectalab.com · +51 1 640 2200')); return box; })()); }
      preview.append(h('div', { class: 'small muted' }, `Se avisará a ${raw('users').filter(u => u.tenant === v.tenant && ['ADMIN_SISTEMA', 'GERENTE'].includes(u.role) && u.status === 'ACTIVE' && !u.support).length} administrador(es) del cliente y quedará en el historial de la suscripción y en la bitácora de la consola.`));
    };
    const f = ui.form({
      id: 'ops04', submitLabel: 'Aplicar cambio', values: { tenant: st0.tenant, to: 'SUSPENDED', category: 'PAYMENT' },
      fields: [
        { key: 'tenant', label: 'Empresa', type: 'select', options: tenantOpts(t => O.sub(t.id).status !== 'CANCELLED'), required: true, onChange: (v, vals) => drawPreview(vals) },
        { key: 'to', label: 'Nuevo estado', type: 'select', options: [['READ_ONLY', 'Solo lectura'], ['SUSPENDED', 'Suspensión total'], ['ACTIVE', 'Reactivar']], required: true, onChange: (v, vals) => drawPreview(vals) },
        { key: 'category', label: 'Tipo de motivo', type: 'select', options: [['PAYMENT', 'Pago / mora'], ['PROHIBITED_USE', 'Uso prohibido'], ['CUSTOMER_REQUEST', 'Pedido del cliente'], ['OTHER', 'Otro']], required: true },
        { key: 'reason', label: 'Motivo (lo ve el cliente)', type: 'textarea', required: true, onChange: (v, vals) => drawPreview(vals) },
      ],
      onSubmit: v => { try { O.setTenantStatus(v.tenant, v.to, v.reason, { category: v.category }); ui.toast(`Estado cambiado a «${SL[v.to][0]}» y cliente avisado`, 'ok'); G.go('OPS-03', { id: v.tenant }); return true; } catch (e) { return e.message; } },
    });
    drawPreview(f.api.values);
    body.appendChild(h('div', { class: 'grid c2' }, ui.card('Cambio de estado', f), ui.card('Efecto', preview)));
    const ev = raw('subscription_events').filter(e => e.event_type === 'STATUS_CHANGED').sort(U.by('occurred_at', -1));
    body.appendChild(ui.card('Cambios de estado de todas las empresas', ui.table({ id: 'ops04-ev', rows: ev, columns: [{ key: 'occurred_at', label: 'Fecha', render: e => G.fmt.datetime(e.occurred_at) }, { key: 'tenant', label: 'Empresa', value: e => O.tenantName(e.tenant) }, { key: 'from_status', label: 'De', render: e => e.from_status ? st(e.from_status) : '—' }, { key: 'to_status', label: 'A', render: e => st(e.to_status) }, { key: 'reason', label: 'Motivo' }, { key: 'actor', label: 'Por', value: e => e.actor_name || (e.actor_type === 'SYSTEM' ? 'Sistema' : (rget('platform_users', e.actor_id) || {}).full_name || e.actor_type) }] }), { flush: true }));
  }

  /* ---------- OPS-05 Solicitar acceso de soporte ---------- */
  function scrRequest(el, params) {
    const body = ui.page(el, { code: 'OPS-05', title: 'Solicitar acceso de soporte', sub: 'Ticket, motivo, nivel, módulos, exportación y duración sugerida. Queda pendiente hasta que el cliente lo apruebe (RN-OPS-03); nunca más de 72 horas (RN-OPS-02).' });
    consoleBar(body);
    const a = O.actor();
    const tid = params.tenant || 'DG';
    const tks = raw('support_tickets').filter(t => t.tenant === tid && t.status !== 'CLOSED');
    const tsel = h('select', { class: 'input', style: 'max-width:360px', attrs: { 'aria-label': 'Empresa', id: 'ops05-t' } }, tenantOpts(t => !['CANCELLED'].includes(O.sub(t.id).status)).map(([v, l]) => h('option', { value: v, selected: v === tid }, l)));
    tsel.addEventListener('change', () => G.go('OPS-05', { tenant: tsel.value }));
    const mods = checkGroup(GRANT_MODULES.map(m => [m[0], m[1]]), params.ticket && (rget('support_tickets', params.ticket) || {}).category === 'INVENTORY' ? ['ALM', 'CAT'] : ['FAC', 'PED', 'CLI'], 'ops05m');
    const def = Number(G.param('ops_support_default_hours') ?? 8);
    const f = ui.form({
      id: 'ops05', submitLabel: 'Enviar solicitud al cliente', values: { ticket_id: params.ticket || (tks[0] || {}).id || '', access_level: 'READ_ONLY', hours: def, allow_export: false },
      fields: [
        { key: 'ticket_id', label: 'Ticket', type: 'select', options: tks.map(t => [t.id, `${t.number} · ${t.subject.slice(0, 60)}`]) },
        { key: 'access_level', label: 'Nivel', type: 'select', options: [['READ_ONLY', 'Solo lectura'], ['READ_WRITE', 'Lectura y escritura (solo SUPPORT_L2, ENGINEER o PLATFORM_ADMIN)']], required: true },
        { key: 'hours', label: 'Duración sugerida (horas)', type: 'number', min: 1, required: true, help: `Por defecto ${def} h; tope ${maxHours()} h. Un acceso aprobado no se amplía: se pide otro.` },
        { key: 'allow_export', label: 'Pedir permiso para exportar', type: 'checkbox' },
        { key: 'reason', label: 'Motivo (lo lee el cliente antes de aprobar)', type: 'textarea', required: true },
      ],
      onSubmit: v => { try { const g = O.requestAccess(Object.assign({}, v, { tenant: tid, modules: mods.value() })); ui.toast(`Solicitud enviada a ${O.tenantName(tid)}: queda por aprobar (OPS-14 del cliente)`, 'ok'); G.refresh(); return true; } catch (e) { return e.message; } },
    });
    insertBeforeActions(f, field('Módulos que necesitas ver', mods, 'Sin módulos marcados el acceso cubre todo.'));
    body.appendChild(h('div', { class: 'grid side-r' }, ui.card('Nueva solicitud', h('div', { class: 'stack' }, field('Empresa', tsel), f)),
      ui.card('Cómo funciona', h('ol', { class: 'stack small', style: 'padding-left:18px;margin:0' }, h('li', null, 'La solicitud llega a los administradores del cliente (ADMIN_SISTEMA y GERENTE).'), h('li', null, 'El cliente aprueba con su duración o la de por defecto; si no la indica, vence a las ' + def + ' h.'), h('li', null, 'Con el acceso vigente entras por OPS-06 con un usuario técnico personal.'), h('li', null, 'Cada consulta, cambio y exportación queda en la bitácora del cliente (OPS-14) y en la de la consola (OPS-13).'), h('li', null, 'Al revocarse, rechazarse o vencer, el usuario técnico se desactiva (RN-OPS-09).')))));
    body.appendChild(ui.card(`Solicitudes de ${a ? a.full_name : 'la consola'}`, grantTable(raw('support_access_grants').filter(g => !a || g.platform_user_id === a.id), 'ops05-mine'), { flush: true }));
  }

  /* ---------- OPS-06 Sesión de soporte ---------- */
  function scrSession(el, params) {
    const body = ui.page(el, { code: 'OPS-06', title: 'Sesión de soporte', sub: 'Entrada a la empresa con el usuario técnico del acceso, franja fija con el tiempo restante y el nivel; cada consulta queda registrada (RN-OPS-04).' });
    consoleBar(body);
    const a = O.actor();
    const mine = raw('support_access_grants').filter(g => a && g.platform_user_id === a.id);
    const vig = mine.filter(g => O.grantVigente(g));
    const sess = G.ctx.opsSupportSession && rget('support_access_grants', G.ctx.opsSupportSession.grant_id);
    if (!sess || !O.grantVigente(sess)) {
      if (sess && !O.grantVigente(sess)) G.ctx.opsSupportSession = null;
      body.appendChild(vig.length ? ui.card('Accesos vigentes para entrar', h('div', { class: 'stack' }, vig.map(g => h('div', { class: 'row between', style: 'gap:10px;flex-wrap:wrap;border:1px solid var(--line);border-radius:10px;padding:10px 12px' }, h('div', { style: 'min-width:0' }, h('b', null, O.tenantName(g.tenant)), ' · ', lvl(g.access_level), h('div', { class: 'small muted' }, `${g.reason} · quedan ${left(g.expires_at)} · módulos ${(g.modules || []).join(', ') || 'todos'}`)), ui.btn('Entrar a la empresa', () => tryDo(() => O.startSession(g.id, {}), 'Sesión de soporte iniciada'), { kind: 'primary' })))))
        : ui.notice(`${a ? a.full_name : 'Este usuario'} no tiene accesos vigentes. Pide uno en OPS-05 y espera la aprobación del cliente.`, 'warn'));
      body.appendChild(ui.card('Mis accesos', grantTable(mine, 'ops06-mine'), { flush: true }));
      return;
    }
    const g = sess;
    body.appendChild(h('div', { class: 'notice ' + (g.access_level === 'READ_ONLY' ? 'info' : 'warn'), style: 'position:sticky;top:0;z-index:2' }, h('div', { class: 'row between', style: 'width:100%;gap:10px;flex-wrap:wrap' },
      h('div', null, h('b', null, `Dentro de ${O.tenantName(g.tenant)} como ${(rget('users', g.support_user_id) || {}).name}`), ` · ${g.access_level === 'READ_ONLY' ? 'SOLO LECTURA' : 'LECTURA Y ESCRITURA'} · exportar: ${g.allow_export ? 'sí' : 'no'} · quedan ${left(g.expires_at)} (vence ${G.fmt.datetime(g.expires_at)})`),
      ui.btn('Cerrar sesión de soporte', () => { O.endSession(g.id); ui.toast('Sesión cerrada y registrada', 'ok'); G.refresh(); }, { kind: 'danger', sm: true }))));
    const allowed = GRANT_MODULES.filter(m => !(g.modules || []).length || g.modules.includes(m[0]));
    const res = h('div', { class: 'stack' });
    const VIEWS = {
      sales_documents: { cols: [{ key: 'full_number', label: 'Comprobante', mono: true }, { key: 'issue_date', label: 'Fecha', render: d => G.fmt.date(d.issue_date) }, { key: 'customer_name', label: 'Cliente' }, { key: 'total', label: 'Total', align: 'r', render: d => G.fmt.money(d.total) }, { key: 'sunat_status', label: 'SUNAT', render: d => ui.status(d.sunat_status) }], upd: ['Reenviar al OSE', (d) => ({ sunat_status: 'SENT', send_attempts: (d.send_attempts || 0) + 1 })] },
      sales_orders: { cols: [{ key: 'number', label: 'Pedido', mono: true }, { key: 'created_at', label: 'Fecha', render: o => G.fmt.datetime(o.created_at) }, { key: 'customer_id', label: 'Cliente', value: o => G.custName(o.customer_id) }, { key: 'status', label: 'Estado', render: o => ui.status(o.status) }, { key: 'estimated_total', label: 'Total', align: 'r', render: o => G.fmt.money(o.final_total ?? o.estimated_total) }], upd: ['Agregar nota interna', o => ({ notes: (o.notes || '') + ' [Soporte: revisado]' })] },
      customers: { cols: [{ key: 'full_name', label: 'Cliente' }, { key: 'doc_number', label: 'Documento', mono: true }, { key: 'phone', label: 'Celular', mono: true }, { key: 'status', label: 'Estado', render: c => ui.status(c.status) }], upd: ['Normalizar celular', c => ({ phone: c.phone })] },
      payments: { cols: [{ key: 'number', label: 'Cobro', mono: true }, { key: 'paid_at', label: 'Fecha', render: p => G.fmt.datetime(p.paid_at) }, { key: 'amount', label: 'Monto', align: 'r', render: p => G.fmt.money(p.amount) }, { key: 'reconciliation_status', label: 'Conciliación', render: p => ui.status(p.reconciliation_status) }] },
      stock_balances: { cols: [{ key: 'variant_id', label: 'Producto', value: b => G.variantName(b.variant_id) }, { key: 'warehouse_id', label: 'Almacén', value: b => G.whName(b.warehouse_id) }, { key: 'qty', label: 'Saldo', align: 'r', render: b => G.fmt.num(b.qty, 3) }, { key: 'reserved_qty', label: 'Reservado', align: 'r', render: b => G.fmt.num(b.reserved_qty || 0, 3) }] },
      product_variants: { cols: [{ key: 'sku', label: 'SKU', mono: true }, { key: 'name', label: 'Presentación' }, { key: 'sale_mode', label: 'Modo', value: v => G.saleModeName(v.sale_mode) }, { key: 'status', label: 'Estado', render: v => ui.status(v.status) }] },
    };
    function consult(table, label) {
      ui.clear(res);
      let rows; try { rows = O.readTenantData(g.id, table, { query: label }); } catch (e) { ui.toast(e.message, 'bad'); G.refresh(); return; }
      const V = VIEWS[table];
      rows = rows.slice().sort((x, y) => String(y.created_at || '').localeCompare(String(x.created_at || '')));
      if (table === 'sales_documents') rows.sort((x, y) => (y.sunat_status !== 'ACCEPTED') - (x.sunat_status !== 'ACCEPTED'));
      res.appendChild(ui.card(`${label} · ${G.fmt.num(rows.length)} registros (consulta registrada)`, ui.table({
        id: 'ops06-' + table, rows, pageSize: 12, columns: V.cols,
        onRow: r => tryDo(() => { O.supportAct(g.id, { action: 'VIEW', entity: table, entity_id: r.id, detail: { query: 'Ficha ' + (r.full_number || r.number || r.sku || r.full_name || r.id) } }); ui.drawer('Ficha (solo lectura del soporte)', codeBlock(JSON.stringify(r, (k, v) => k === 'pwd_hash' ? undefined : v, 2).slice(0, 4000)), { code: 'OPS-06' }); }),
        actions: r => [V.upd ? ui.btn(V.upd[0], () => tryDo(() => { O.supportAct(g.id, { action: 'UPDATE', entity: table, entity_id: r.id, detail: { query: V.upd[0] + ' ' + (r.full_number || r.number || r.id) } }); Object.assign(r, V.upd[1](r)); G.db.touch(); }, 'Cambio aplicado y registrado'), { sm: true }) : null],
        toolbar: [ui.btn('Exportar CSV', () => tryDo(() => { O.supportAct(g.id, { action: 'EXPORT', entity: table, detail: { query: `${label} (${rows.length} filas, CSV)` } }); }, 'Exportación registrada en la bitácora del cliente'), { sm: true })],
      }), { flush: true }));
    }
    body.appendChild(ui.card('Consultar datos de la empresa', h('div', { class: 'row', style: 'flex-wrap:wrap' }, allowed.map(m => ui.btn('Consultar ' + m[1].replace(/ \(.*\)/, '').toLowerCase(), () => consult(m[2], m[1]), { sm: true })))));
    body.appendChild(res);
    body.appendChild(ui.card('Bitácora de este acceso (la ve el cliente en OPS-14)', accessLogTable(raw('support_access_log').filter(l => l.grant_id === g.id), 'ops06-log'), { flush: true }));
  }

  /* ---------- OPS-07 Salud de componentes ---------- */
  function scrHealth(el) {
    const body = ui.page(el, { code: 'OPS-07', title: 'Salud de componentes', sub: 'Estado por componente con latencia, errores y profundidad de cola; disponibilidad del día y de 7 días (KPI-OPS-12). D-OPS-01: lecturas propias cada 60 s desde los adaptadores.', actions: [{ label: 'Registrar lectura', onClick: () => checkForm() }, { label: 'Simular caída del OSE (10 min)', kind: 'danger', onClick: () => tryDo(() => { const base = G.TODAY + 'T' + now().slice(11, 16); for (let i = 0; i < 10; i++) O.recordCheck({ component: 'OSE', status: 'DOWN', latency_ms: 10000, error_rate_pct: 100, queue_depth: 30 + i * 6, at: addMin(base + ':00', i) }); O.recordCheck({ component: 'OSE', status: 'UP', latency_ms: 950, error_rate_pct: 0.3, queue_depth: 4, at: addMin(base + ':00', 10) }); }, 'OSE caído 10 minutos: incidente SEV2 abierto y clientes avisados') }] });
    consoleBar(body);
    const d7 = G.date.add(G.TODAY, -6);
    const rows = COMPONENTS.map(([c, name]) => { const l = O.lastCheck(c) || {}; const inc = raw('platform_incidents').find(i => i.component === c && i.status !== 'RESOLVED'); return { c, name, status: l.status || 'UP', latency: l.latency_ms, err: l.error_rate_pct, queue: l.queue_depth, at: l.checked_at, day: M.availability(c, G.TODAY, G.TODAY).value, week: M.availability(c, d7, G.TODAY).value, inc, version: l.detail && l.detail.version }; });
    body.appendChild(ui.kpis([{ label: 'Operativos', value: rows.filter(r => r.status === 'UP').length, tone: 'ok' }, { label: 'Degradados', value: rows.filter(r => r.status === 'DEGRADED').length, tone: 'warn' }, { label: 'Caídos', value: rows.filter(r => r.status === 'DOWN').length, tone: rows.some(r => r.status === 'DOWN') ? 'bad' : '' }, { label: 'Disponibilidad 7 días', value: G.fmt.pct(M.availability(null, d7, G.TODAY).value, 2), sub: 'todos los componentes' }, { label: 'Incidentes abiertos', value: raw('platform_incidents').filter(i => i.status !== 'RESOLVED').length, onClick: () => G.go('OPS-08') }]));
    body.appendChild(ui.table({ id: 'ops07', rows, search: false, onRow: r => compDrawer(r), columns: [{ key: 'name', label: 'Componente', render: r => h('div', null, h('b', null, r.name), h('div', { class: 'small muted mono' }, r.c + (r.version ? ' · ' + r.version : ''))) }, { key: 'status', label: 'Estado', render: r => st(r.status) }, { key: 'latency', label: 'Latencia', align: 'r', render: r => r.latency != null ? G.fmt.num(r.latency) + ' ms' : '—' }, { key: 'err', label: 'Errores', align: 'r', render: r => r.err != null ? G.fmt.pct(r.err, 2) : '—' }, { key: 'queue', label: 'Cola', align: 'r', render: r => r.queue != null ? G.fmt.num(r.queue) : '—' }, { key: 'day', label: 'Disp. hoy', align: 'r', render: r => G.fmt.pct(r.day, 2) }, { key: 'week', label: 'Disp. 7 días', align: 'r', render: r => G.fmt.pct(r.week, 2) }, { key: 'at', label: 'Última lectura', render: r => G.fmt.datetime(r.at) }, { key: 'inc', label: 'Incidente', value: r => r.inc ? r.inc.code : '', render: r => r.inc ? ui.badge(r.inc.code, 'bad') : '—' }] }));
    // versiones desplegadas (de las lecturas de APP y API)
    const vers = []; for (const c of ['APP', 'API']) { const seen = {}; for (const x of raw('platform_component_checks').filter(y => y.component === c && y.detail && y.detail.version).sort(U.by('checked_at'))) if (!seen[x.detail.version]) { seen[x.detail.version] = 1; vers.push({ c, v: x.detail.version, at: x.checked_at }); } }
    body.appendChild(ui.card('Versiones desplegadas', ui.table({ id: 'ops07-v', rows: vers.sort(U.by('at', -1)), search: false, columns: [{ key: 'c', label: 'Componente', value: v => compName(v.c) }, { key: 'v', label: 'Versión', mono: true }, { key: 'at', label: 'En producción desde', render: v => G.fmt.datetime(v.at) }, { key: 'cur', label: 'Estado', render: v => (vers.filter(x => x.c === v.c).sort(U.by('at', -1))[0] === v) ? ui.badge('Vigente', 'ok') : ui.badge('Reemplazada', '') }] }), { flush: true }));
    function compDrawer(r) {
      ui.drawer(r.name, bd => {
        const days = []; for (let k = 6; k >= 0; k--) days.push(G.date.add(G.TODAY, -k));
        bd.appendChild(ui.chart.bar({ labels: days.map(d => G.fmt.date(d).slice(0, 5)), series: [{ name: 'Disponibilidad %', values: days.map(d => M.availability(r.c, d, d).value || 0) }], format: v => G.fmt.pct(v, 2) }));
        bd.appendChild(ui.table({ id: 'ops07-d-' + r.c, rows: raw('platform_component_checks').filter(x => x.component === r.c).sort(U.by('checked_at', -1)).slice(0, 60), search: false, pageSize: 12, columns: [{ key: 'checked_at', label: 'Lectura', render: x => G.fmt.datetime(x.checked_at) }, { key: 'status', label: 'Estado', render: x => st(x.status) }, { key: 'samples', label: 'Lecturas', align: 'r', value: x => (x.detail || {}).samples || 1 }, { key: 'latency_ms', label: 'Latencia', align: 'r' }, { key: 'error_rate_pct', label: 'Errores %', align: 'r' }, { key: 'queue_depth', label: 'Cola', align: 'r' }] }));
      }, { code: 'OPS-07', wide: true });
    }
    function checkForm() {
      ui.drawer('Registrar lectura de salud', (bd, close) => bd.appendChild(ui.form({ id: 'ops07f', values: { component: 'OSE', status: 'DOWN', minutes: 1, latency_ms: 8000, error_rate_pct: 100 }, fields: [{ key: 'component', label: 'Componente', type: 'select', options: COMPONENTS, required: true }, { key: 'status', label: 'Estado', type: 'select', options: [['UP', 'Operativo'], ['DEGRADED', 'Degradado'], ['DOWN', 'Caído']], required: true }, { key: 'minutes', label: 'Lecturas (una por minuto)', type: 'number', min: 1, max: 120, required: true }, { key: 'latency_ms', label: 'Latencia (ms)', type: 'number', min: 0 }, { key: 'error_rate_pct', label: 'Errores (%)', type: 'number', min: 0, max: 100 }, { key: 'queue_depth', label: 'Profundidad de cola', type: 'number', min: 0 }], onCancel: close, onSubmit: v => { try { O.passert('health.record'); const base = now(); for (let i = 0; i < v.minutes; i++) O.recordCheck({ component: v.component, status: v.status, latency_ms: v.latency_ms, error_rate_pct: v.error_rate_pct, queue_depth: v.queue_depth, at: addMin(base, i) }); close(); ui.toast('Lecturas registradas', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })), { code: 'OPS-07' });
    }
  }

  /* ---------- OPS-08 Incidentes ---------- */
  function incidentDrawer(i) {
    ui.drawer(`${i.code} · ${i.title}`, (bd, close) => {
      const ts = O.incidentTenants(i.id); const mins = O.notifyMinutes(i); const lim = Number(O.pparam('ops_incident_notify_minutes') || 30);
      const act = h('div', { class: 'row', style: 'flex-wrap:wrap' });
      if (i.status !== 'RESOLVED') {
        act.appendChild(ui.btn('Avisar a los clientes afectados', () => { tryDo(() => O.notifyIncident(i.id), 'Aviso publicado a las empresas afectadas'); close(); }, { sm: true, kind: 'primary', disabled: !ts.some(x => !x.notified_at) }));
        act.appendChild(ui.btn('Agregar actualización', () => ui.modal('Actualización pública', bd2 => bd2.appendChild(ui.form({ id: 'incupd', values: { status: i.status }, fields: [{ key: 'status', label: 'Estado', type: 'select', options: INC_ST.filter(x => x[0] !== 'RESOLVED'), required: true }, { key: 'message', label: 'Mensaje público', type: 'textarea', required: true }], onSubmit: v => { try { O.updateIncident(i.id, v); ui.closeAll(); ui.toast('Actualización publicada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))), { sm: true }));
        act.appendChild(ui.btn('Resolver', () => ui.modal('Resolver incidente (RN-OPS-08)', bd2 => bd2.appendChild(ui.form({ id: 'incres', values: { resolved_at: now().slice(0, 16) }, fields: [{ key: 'resolved_at', label: 'Hora de cierre', type: 'datetime', required: true }, { key: 'root_cause', label: 'Causa raíz', type: 'textarea', required: true }, { key: 'postmortem_url', label: 'Post mortem (enlace)' }], onSubmit: v => { try { O.resolveIncident(i.id, v); ui.closeAll(); ui.toast('Incidente resuelto', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })), [], { wide: true }), { sm: true, kind: 'accent' }));
      }
      bd.appendChild(act);
      bd.appendChild(ui.dl([['Severidad', st(i.severity)], ['Componente', compName(i.component)], ['Estado', st(i.status)], ['Inicio', G.fmt.datetime(i.started_at)], ['Cierre', G.fmt.datetime(i.resolved_at)], ['Duración', i.resolved_at ? fmtH(hoursBetween(i.started_at, i.resolved_at)) : 'en curso'], ['Mensaje público', i.public_message], ['Causa raíz', i.root_cause], ['Post mortem', i.postmortem_url], ['Aviso a clientes', mins === null ? (['SEV1', 'SEV2'].includes(i.severity) ? ui.badge(`Pendiente · plazo ${lim} min (RN-OPS-14)`, 'bad') : 'Sin aviso') : h('span', null, `${G.fmt.num(mins, 0)} min después del inicio `, ui.badge(mins <= lim ? 'a tiempo' : 'fuera de plazo', mins <= lim ? 'ok' : 'bad'))], ['Tickets vinculados', raw('support_tickets').filter(t => t.incident_id === i.id).map(t => t.number).join(', ') || '—']]));
      bd.appendChild(h('h3', null, 'Línea de tiempo'));
      bd.appendChild(tl((i.updates || []).map(u => ({ when: G.fmt.datetime(u.at), tone: SL[u.status] ? SL[u.status][1] : null, body: h('div', null, h('b', null, (SL[u.status] || [u.status])[0]), ' · ', u.message, h('div', { class: 'small muted' }, u.by)) }))));
      bd.appendChild(h('h3', null, `Empresas afectadas (${ts.length})`));
      bd.appendChild(ui.table({ id: 'inc-t-' + i.id, rows: ts, search: false, pageSize: 8, columns: [{ key: 'target_tenant_id', label: 'Empresa', value: x => O.tenantName(x.target_tenant_id) }, { key: 'notified_at', label: 'Avisada', render: x => x.notified_at ? G.fmt.datetime(x.notified_at) : ui.badge('Pendiente', 'warn') }] }));
    }, { code: 'OPS-08', wide: true });
  }
  function scrIncidents(el) {
    const body = ui.page(el, { code: 'OPS-08', title: 'Incidentes', sub: 'Alta, severidad, componente, empresas afectadas, línea de tiempo, mensaje público, causa raíz y post mortem. SEV1 y SEV2 se avisan en menos de 30 minutos (RN-OPS-14).', actions: [{ label: 'Nuevo incidente', kind: 'primary', onClick: () => newInc() }] });
    consoleBar(body);
    const rows = raw('platform_incidents').slice().sort(U.by('started_at', -1));
    const lim = Number(O.pparam('ops_incident_notify_minutes') || 30);
    const late = rows.filter(i => ['SEV1', 'SEV2'].includes(i.severity) && (O.notifyMinutes(i) === null ? hoursBetween(i.started_at, now()) * 60 > lim && i.status !== 'RESOLVED' : O.notifyMinutes(i) > lim));
    body.appendChild(ui.kpis([{ label: 'Abiertos', value: rows.filter(i => i.status !== 'RESOLVED').length, tone: rows.some(i => i.status !== 'RESOLVED') ? 'warn' : 'ok' }, { label: 'SEV1/SEV2 del mes', value: rows.filter(i => ['SEV1', 'SEV2'].includes(i.severity) && i.started_at >= G.date.month(G.TODAY)).length }, { label: 'Avisos fuera de plazo', value: late.length, tone: late.length ? 'bad' : 'ok', sub: `plazo ${lim} min` }, { label: 'Tiempo medio de resolución', value: fmtH(median(rows.filter(i => i.resolved_at).map(i => hoursBetween(i.started_at, i.resolved_at)))), sub: 'mediana' }]));
    body.appendChild(ui.table({ id: 'ops08', rows, onRow: incidentDrawer, filters: [{ key: 'status', label: 'Estado', options: INC_ST }, { key: 'severity', label: 'Severidad', options: SEVS }], columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'title', label: 'Incidente' }, { key: 'severity', label: 'Sev.', render: i => st(i.severity) }, { key: 'component', label: 'Componente', value: i => compName(i.component) }, { key: 'status', label: 'Estado', render: i => st(i.status) }, { key: 'started_at', label: 'Inicio', render: i => G.fmt.datetime(i.started_at) }, { key: 'dur', label: 'Duración', value: i => i.resolved_at ? fmtH(hoursBetween(i.started_at, i.resolved_at)) : 'en curso' }, { key: 'tenants', label: 'Empresas', align: 'r', value: i => O.incidentTenants(i.id).length }, { key: 'aviso', label: 'Aviso', value: i => { const m = O.notifyMinutes(i); return m === null ? '—' : G.fmt.num(m, 0) + ' min'; } }] }));
    function newInc() {
      ui.drawer('Nuevo incidente', (bd, close) => {
        const ts = checkGroup(tenantOpts(t => O.sub(t.id).status !== 'CANCELLED'), [], 'incT');
        const f = ui.form({ id: 'ops08f', values: { severity: 'SEV3', component: 'WHATSAPP', affects_all: false }, fields: [{ key: 'title', label: 'Título', required: true }, { key: 'severity', label: 'Severidad', type: 'select', options: SEVS, required: true }, { key: 'component', label: 'Componente', type: 'select', options: COMPONENTS, required: true }, { key: 'affects_all', label: 'Afecta a todas las empresas', type: 'checkbox' }, { key: 'public_message', label: 'Mensaje público', type: 'textarea', required: true }], onCancel: close, onSubmit: v => { try { const inc = O.openIncident(Object.assign({}, v, { tenants: ts.value() })); close(); ui.toast(`${inc.code} abierto${['SEV1', 'SEV2'].includes(inc.severity) ? ': avisa a los clientes antes de 30 minutos' : ''}`, 'ok'); G.refresh(); incidentDrawer(inc); return true; } catch (e) { return e.message; } } });
        insertBeforeActions(f, field('Empresas afectadas (si no afecta a todas)', ts));
        bd.appendChild(f);
      }, { code: 'OPS-08', wide: true });
    }
  }

  /* ---------- OPS-09 Bandeja de tickets ---------- */
  function scrInbox(el, params) {
    const body = ui.page(el, { code: 'OPS-09', title: 'Bandeja de tickets', sub: 'Tickets de todos los clientes por prioridad, plazo de primera respuesta y estado; asignación y respuesta (RN-OPS-15). D-OPS-02: plazos iguales para todos los planes.' });
    consoleBar(body);
    const rows = raw('support_tickets');
    const open = rows.filter(t => !['RESOLVED', 'CLOSED'].includes(t.status));
    const fr = O.frHours();
    const med = M.firstResponseMedian(G.date.month(G.TODAY));
    body.appendChild(ui.kpis([{ label: 'Abiertos', value: open.length }, { label: 'Sin primera respuesta', value: open.filter(t => !t.first_response_at).length, tone: open.some(t => !t.first_response_at) ? 'warn' : 'ok' }, { label: 'Fuera de plazo', value: open.filter(t => O.sla(t).breached || O.sla(t).met === false).length, tone: 'bad' }, { label: 'Sin asignar', value: open.filter(t => !t.assigned_platform_user).length }, { label: 'Mediana 1.ª respuesta (mes)', value: fmtH(med), sub: 'KPI-OPS-11' }]));
    body.appendChild(h('div', { class: 'small muted' }, `Plazos de primera respuesta: urgente ${fr.URGENT} h (24×7) · alta ${fr.HIGH} h · normal ${fr.NORMAL} h · baja ${fr.LOW} h en horario hábil lun–sáb 09:00–18:00 (D-OPS-04). Un ticket resuelto sin respuesta del cliente se cierra a los ${G.param('ops_ticket_auto_close_days')} días.`));
    const prioOrder = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
    body.appendChild(ticketTable(rows.slice().sort((a, b) => (['RESOLVED', 'CLOSED'].includes(a.status) - ['RESOLVED', 'CLOSED'].includes(b.status)) || prioOrder[a.priority] - prioOrder[b.priority] || a.opened_at.localeCompare(b.opened_at)), 'ops09', true));
    if (params.id) setTimeout(() => { const t = rget('support_tickets', params.id); if (t) ticketDrawer(t, true); }, 0);
  }

  /* ---------- OPS-10 Métricas del negocio ---------- */
  function scrMetrics(el, params) {
    const m = params.month || G.date.month(G.TODAY);
    const body = ui.page(el, { code: 'OPS-10', title: 'Métricas del negocio', sub: 'MRR, clientes activos, churn, retención neta, ingreso promedio, conversión de prueba, uso por plan, tiempo de alta, tickets, disponibilidad y mora, por mes. Al cierre se congelan (RN-OPS-17).', actions: [{ label: `Congelar ${G.date.monthName(m)}`, onClick: () => tryDo(() => { const n = O.freezeMonth(m); ui.toast(`Corrida ${n} guardada`, 'ok'); }) }] });
    consoleBar(body);
    const months = []; for (let k = 5; k >= 0; k--) months.push(G.date.addMonths(G.TODAY, -k));
    body.appendChild(ui.pills(months.map(x => [x, G.date.monthName(x)]), m, v => G.go('OPS-10', { month: v })));
    const v = O.computeMonth(m);
    const f = (code, fmt) => { const x = v[code]; return x && x.value !== null && x.value !== undefined ? fmt(x.value) : '—'; };
    const defs = Object.fromEntries((G.SPEC.OPS.kpis || []).map(k => [k[0], k]));
    const tile = (code, fmt, sub, tone) => ({ label: `${defs[code] ? defs[code][1] : code}`, value: f(code, fmt), sub: sub || code, tone, title: defs[code] ? defs[code][2] : '' });
    body.appendChild(ui.kpis([
      tile('KPI-OPS-01', x => G.fmt.money(x, 0), 'KPI-OPS-01 · sin IGV'), tile('KPI-OPS-02', x => G.fmt.num(x)), tile('KPI-OPS-03', x => G.fmt.pct(x), `KPI-OPS-03 · ${v['KPI-OPS-03'].numerator} de ${v['KPI-OPS-03'].denominator}`), tile('KPI-OPS-04', x => G.fmt.pct(x)), tile('KPI-OPS-05', x => G.fmt.pct(x)), tile('KPI-OPS-06', x => G.fmt.money(x, 0)), tile('KPI-OPS-07', x => G.fmt.pct(x), `KPI-OPS-07 · ${v['KPI-OPS-07'].numerator} de ${v['KPI-OPS-07'].denominator}`),
      tile('KPI-OPS-08', x => G.fmt.pct(x)), tile('KPI-OPS-09', x => G.fmt.days(Math.round(x))), tile('KPI-OPS-10', x => G.fmt.num(x, 2)), tile('KPI-OPS-11', x => fmtH(x)), tile('KPI-OPS-12', x => G.fmt.pct(x, 2)), tile('KPI-OPS-13', x => G.fmt.pct(x), null, v['KPI-OPS-13'].value > 10 ? 'warn' : ''),
    ]));
    const subs = O.subs();
    const series = months.map(x => { const d = M.monthEnd(x); return { mrr: M.mrr(subs, d), act: subs.filter(s => M.activeAt(s, d)).length }; });
    body.appendChild(h('div', { class: 'grid c2' },
      ui.card('MRR por mes', ui.chart.bar({ labels: months.map(G.date.monthName), series: [{ name: 'MRR', values: series.map(x => x.mrr) }], format: x => G.fmt.money(x, 0) })),
      ui.card('Clientes activos por mes', ui.chart.line({ labels: months.map(G.date.monthName), series: [{ name: 'Clientes activos', values: series.map(x => x.act) }] }))));
    const mv = M.moves(subs, m);
    body.appendChild(h('div', { class: 'grid c2' },
      ui.card(`Movimiento del MRR · ${G.date.monthName(m)}`, ui.dl([['MRR al inicio (clientes activos al inicio)', G.fmt.money(mv.start)], ['Expansión (subidas de plan)', G.fmt.money(mv.exp)], ['Contracción (bajadas de plan)', G.fmt.money(-mv.contr)], ['Cancelaciones', G.fmt.money(-mv.cancel)], ['Retención neta', G.fmt.pct(v['KPI-OPS-05'].value)]])),
      ui.card('Uso por plan (KPI-OPS-08)', ui.table({ id: 'ops10-use', search: false, rows: M.usageByPlan(M.monthEnd(m)), columns: [{ key: 'plan', label: 'Plan' }, { key: 'name', label: 'Límite' }, { key: 'n', label: 'Clientes', align: 'r' }, { key: 'avg', label: 'Uso promedio', render: x => h('div', { style: 'min-width:100px' }, ui.progress(x.avg, x.avg > 85 ? 'bad' : x.avg < 20 ? 'warn' : ''), h('span', { class: 'small' }, G.fmt.pct(x.avg))) }] }), { flush: true })));
    const vol = O.tenants().map(t => { const sg = O.signals(t.id); return { t: t.short || t.name, orders: sg.volume.orders_month || 0, msgs: sg.volume.messages_month || 0, users: sg.volume.users || 0, live: sg.live }; });
    body.appendChild(ui.card('Volumen de la plataforma (mes en curso)', ui.table({ id: 'ops10-vol', search: false, rows: vol, footer: ['Total', { v: G.fmt.num(U.sum(vol, x => x.orders)), align: 'r' }, { v: G.fmt.num(U.sum(vol, x => x.msgs)), align: 'r' }, { v: G.fmt.num(U.sum(vol, x => x.users)), align: 'r' }, ''], sort: 'orders', dir: -1, columns: [{ key: 't', label: 'Empresa' }, { key: 'orders', label: 'Pedidos procesados', align: 'r', render: x => G.fmt.num(x.orders) }, { key: 'msgs', label: 'Mensajes enviados', align: 'r', render: x => G.fmt.num(x.msgs) }, { key: 'users', label: 'Usuarios activos', align: 'r' }, { key: 'live', label: 'Fuente', value: x => x.live ? 'medido en vivo' : 'lectura de adaptadores' }] }), { flush: true }));
    const snaps = raw('platform_metric_snapshots').filter(s => s.period === m).sort((a, b) => b.run_no - a.run_no || String(a.kpi_code).localeCompare(b.kpi_code));
    body.appendChild(ui.card(`Métricas congeladas de ${G.date.monthName(m)} (solo inserción)`, snaps.length ? ui.table({ id: 'ops10-snap', rows: snaps, pageSize: 13, filters: [{ key: 'run_no', label: 'Corrida', options: [...new Set(snaps.map(s => s.run_no))].map(n => [String(n), 'Corrida ' + n]) }], columns: [{ key: 'kpi_code', label: 'Indicador', mono: true }, { key: 'name', label: 'Nombre', value: s => defs[s.kpi_code] ? defs[s.kpi_code][1] : '' }, { key: 'value', label: 'Valor', align: 'r', render: s => s.value === null ? '—' : G.fmt.num(s.value, 2) }, { key: 'run_no', label: 'Corrida', align: 'r' }, { key: 'computed_at', label: 'Calculado', render: s => G.fmt.datetime(s.computed_at) }] }) : ui.empty('Aún no se congela este mes.'), { flush: true }));
  }

  /* ---------- OPS-11 Anuncios ---------- */
  function scrAnnouncements(el) {
    const body = ui.page(el, { code: 'OPS-11', title: 'Anuncios', sub: 'Redacta y programa anuncios por producto, plan o lista de empresas; los mantenimientos se publican con al menos 48 horas (RN-OPS-18). Cada empresa ve solo los suyos (RN-OPS-06).', actions: [{ label: 'Nuevo anuncio', kind: 'primary', onClick: () => edit(null) }] });
    consoleBar(body);
    const rows = raw('platform_announcements').slice().sort((a, b) => String(b.published_at || b.created_at).localeCompare(String(a.published_at || a.created_at)));
    body.appendChild(ui.table({ id: 'ops11', rows, onRow: a => detail(a), filters: [{ key: 'status', label: 'Estado', options: [['DRAFT', 'Borrador'], ['PUBLISHED', 'Publicado'], ['ARCHIVED', 'Archivado']] }, { key: 'kind', label: 'Tipo', options: ANN_KINDS }], columns: [{ key: 'title', label: 'Anuncio', render: a => h('div', { style: 'max-width:380px' }, h('b', null, a.title), h('div', { class: 'small muted' }, a.body.slice(0, 90) + (a.body.length > 90 ? '…' : ''))) }, { key: 'kind', label: 'Tipo', value: a => annKind(a.kind) }, { key: 'audience', label: 'Para', value: a => a.audience === 'TENANTS' ? (a.target_tenant_ids || []).map(O.tenantName).join(', ') : a.audience === 'PLAN' ? 'Plan ' + ((PLANS[a.plan_code] || {}).name || a.plan_code) : 'Todas' }, { key: 'starts_at', label: 'Desde', render: a => G.fmt.datetime(a.starts_at) }, { key: 'status', label: 'Estado', render: a => st(a.status) }, { key: 'reads', label: 'Lecturas', align: 'r', value: a => raw('announcement_reads').filter(r => r.announcement_id === a.id).length }] }));
    function detail(a) {
      ui.drawer(a.title, (bd, close) => {
        const act = h('div', { class: 'row' });
        if (a.status === 'DRAFT') { act.appendChild(ui.btn('Publicar', () => { tryDo(() => O.publishAnnouncement(a.id), 'Anuncio publicado'); close(); }, { kind: 'primary', sm: true })); act.appendChild(ui.btn('Editar', () => { close(); edit(a); }, { sm: true })); }
        if (a.status === 'PUBLISHED') act.appendChild(ui.btn('Archivar', () => { tryDo(() => O.archiveAnnouncement(a.id), 'Anuncio archivado'); close(); }, { sm: true }));
        bd.appendChild(act);
        bd.appendChild(ui.dl([['Tipo', annKind(a.kind)], ['Estado', st(a.status)], ['Inicio', G.fmt.datetime(a.starts_at)], ['Fin', G.fmt.datetime(a.ends_at)], ['Publicado', G.fmt.datetime(a.published_at)], ['Empresas destino', O.annTargets(a).map(O.tenantName).join(', ')], ['Leído por', raw('announcement_reads').filter(r => r.announcement_id === a.id).map(r => (raw('users').find(u => u.id === r.user_id) || {}).name || r.user_id).join(', ') || 'nadie aún']]));
        bd.appendChild(h('h3', null, 'Vista del cliente'));
        bd.appendChild(ui.notice([h('b', null, a.title), h('div', null, a.body)], a.kind === 'MAINTENANCE' ? 'warn' : a.kind === 'INCIDENT' ? 'bad' : 'info'));
      }, { code: 'OPS-11' });
    }
    function edit(row) {
      ui.drawer(row ? 'Editar anuncio' : 'Nuevo anuncio', (bd, close) => {
        const ts = checkGroup(tenantOpts(t => O.sub(t.id).status !== 'CANCELLED'), row ? row.target_tenant_ids || [] : [], 'annT');
        const need = Number(O.pparam('ops_maintenance_notice_hours') ?? 48);
        const f = ui.form({ id: 'ops11f', values: row ? Object.assign({}, row, { starts_at: row.starts_at.slice(0, 16), ends_at: (row.ends_at || '').slice(0, 16) }) : { kind: 'MAINTENANCE', audience: 'ALL', plan_code: 'CRECER', starts_at: addH(now(), need + 24).slice(0, 16) }, fields: [{ key: 'title', label: 'Título', required: true }, { key: 'kind', label: 'Tipo', type: 'select', options: ANN_KINDS, required: true }, { key: 'audience', label: 'Para', type: 'select', options: AUDIENCES, required: true }, { key: 'plan_code', label: 'Plan (si es por plan)', type: 'select', options: Object.entries(PLANS).map(([k, v]) => [k, v.name]) }, { key: 'starts_at', label: 'Inicio', type: 'datetime', required: true, help: `Un mantenimiento empieza al menos ${need} h después de publicarse (RN-OPS-18).` }, { key: 'ends_at', label: 'Fin', type: 'datetime' }, { key: 'body', label: 'Mensaje', type: 'textarea', required: true }], onCancel: close, onSubmit: v => { try { const x = O.saveAnnouncement(Object.assign({}, v, { starts_at: v.starts_at.length === 16 ? v.starts_at + ':00' : v.starts_at, ends_at: v.ends_at ? (v.ends_at.length === 16 ? v.ends_at + ':00' : v.ends_at) : null, target_tenant_ids: ts.value() }), row); close(); ui.toast('Anuncio guardado como borrador', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } });
        insertBeforeActions(f, field('Empresas (si es por lista)', ts));
        bd.appendChild(f);
      }, { code: 'OPS-11', wide: true });
    }
  }

  /* ---------- OPS-12 Usuarios de plataforma ---------- */
  function scrPUsers(el) {
    const body = ui.page(el, { code: 'OPS-12', title: 'Usuarios de plataforma', sub: 'Personal de Intelectalab: alta, rol, segundo factor obligatorio (RN-OPS-01), bloqueo y baja. Los roles definen lo que cada uno hace en la consola (RN-OPS-10).', actions: [{ label: 'Nuevo usuario', kind: 'primary', onClick: () => edit(null) }] });
    consoleBar(body);
    const rows = raw('platform_users');
    body.appendChild(ui.table({ id: 'ops12', rows, onRow: u => edit(u), columns: [{ key: 'full_name', label: 'Nombre', render: u => h('div', null, h('b', null, u.full_name), h('div', { class: 'small muted mono' }, u.email)) }, { key: 'role', label: 'Rol', value: u => proleName(u.role) }, { key: 'twofa_enabled', label: 'Segundo factor', render: u => u.twofa_enabled ? ui.badge('Configurado', 'ok') : ui.badge('Falta', 'bad') }, { key: 'status', label: 'Estado', render: u => st(u.status) }, { key: 'last_login_at', label: 'Último ingreso', render: u => G.fmt.datetime(u.last_login_at) }],
      actions: u => [!u.twofa_enabled ? ui.btn('Configurar 2FA', () => tryDo(() => O.enroll2fa(u.id), 'Segundo factor configurado: la cuenta queda activa'), { sm: true }) : null, u.status === 'ACTIVE' ? ui.btn('Bloquear', () => ask(u, 'LOCKED'), { sm: true }) : null, u.status === 'LOCKED' ? ui.btn('Desbloquear', () => ask(u, 'ACTIVE'), { sm: true }) : null, u.status !== 'DISABLED' ? ui.btn('Dar de baja', () => ask(u, 'DISABLED'), { sm: true, kind: 'danger' }) : null] }));
    body.appendChild(ui.card('Qué hace cada rol (RN-OPS-10)', ui.table({ id: 'ops12-r', search: false, rows: PROLES.map(([r, n]) => ({ r, n })), columns: [{ key: 'n', label: 'Rol' }, { key: 'caps', label: 'Puede', value: x => (CAPS[x.r] || []).includes('*') ? 'Todo' : (CAPS[x.r] || []).map(c => CAP_TEXT[c].replace(/^suspender ni/, 'suspender y')).join(' · ') || 'Solo consulta' }] }), { flush: true }));
    function ask(u, to) { ui.modal(`${to === 'ACTIVE' ? 'Desbloquear' : to === 'LOCKED' ? 'Bloquear' : 'Dar de baja'} a ${u.full_name}`, bd => bd.appendChild(ui.form({ id: 'ops12s', fields: [{ key: 'reason', label: 'Motivo', type: 'textarea', required: true }], onSubmit: v => { try { O.setPlatformUserStatus(u.id, to, v.reason); ui.closeAll(); ui.toast('Usuario actualizado', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))); }
    function edit(u) {
      ui.drawer(u ? u.full_name : 'Nuevo usuario de plataforma', (bd, close) => bd.appendChild(ui.form({ id: 'ops12f', values: u ? Object.assign({}, u) : { role: 'SUPPORT_L1', status: 'INVITED', twofa_enabled: false }, fields: [{ key: 'full_name', label: 'Nombre completo', required: true }, { key: 'email', label: 'Correo (@intelectalab.com)', required: true }, { key: 'role', label: 'Rol', type: 'select', options: PROLES, required: true }, { key: 'status', label: 'Estado', type: 'select', options: [['INVITED', 'Invitado'], ['ACTIVE', 'Activo'], ['LOCKED', 'Bloqueado'], ['DISABLED', 'De baja']], required: true }, { key: 'twofa_enabled', label: 'Segundo factor configurado', type: 'checkbox' }], onCancel: close, onSubmit: v => { try { O.savePlatformUser(v, u); close(); ui.toast('Usuario guardado', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })), { code: 'OPS-12' });
    }
  }

  /* ---------- OPS-13 Bitácora de la consola ---------- */
  function scrAudit(el) {
    const body = ui.page(el, { code: 'OPS-13', title: 'Bitácora de la consola', sub: 'Toda acción de la consola con usuario, empresa, motivo, IP y detalle. Solo lectura y solo inserción (RN-OPS-05, RN-OPS-11).' });
    consoleBar(body);
    const rows = raw('platform_audit_log');
    body.appendChild(ui.kpis([{ label: 'Acciones registradas', value: G.fmt.num(rows.length) }, { label: 'Hoy', value: rows.filter(a => a.occurred_at.slice(0, 10) === G.TODAY).length }, { label: 'Acciones del soporte dentro de empresas', value: rows.filter(a => /^SUPPORT_/.test(a.action)).length }, { label: 'Intentos rechazados', value: rows.filter(a => /DENIED|BLOCKED|FAILED/.test(a.action)).length, tone: 'warn' }]));
    body.appendChild(auditTable(rows, 'ops13'));
  }

  /* ---------- OPS-14 Accesos de soporte (cliente) ---------- */
  function scrClientAccess(el) {
    O.expireDue();
    const body = ui.page(el, { code: 'OPS-14', title: 'Accesos de soporte', sub: 'Solicitudes de Intelectalab para entrar a tu empresa: apruébalas o recházalas, mira el tiempo restante de las vigentes, revócalas cuando quieras y revisa todo lo que hizo el soporte.' });
    const gs = G.db.all('support_access_grants');
    const pend = gs.filter(g => g.status === 'REQUESTED'), vig = gs.filter(g => g.status === 'APPROVED');
    const canA = G.can('ops.support_access.approve') && G.ctx.role !== 'SOPORTE_PLATAFORMA', canR = G.can('ops.support_access.revoke') && G.ctx.role !== 'SOPORTE_PLATAFORMA';
    const k15 = G.kpi('KPI-OPS-15') || {};
    body.appendChild(ui.kpis([{ label: 'Por aprobar', value: pend.length, tone: pend.length ? 'warn' : 'ok' }, { label: 'Vigentes', value: vig.length, sub: vig.length ? 'quedan ' + left(vig.sort(U.by('expires_at'))[0].expires_at) : 'ninguno' }, { label: 'Horas de soporte del mes', value: fmtH(k15.value), sub: 'KPI-OPS-15' }, { label: 'Acciones del soporte', value: G.db.all('support_access_log').length, sub: 'bitácora de solo inserción' }]));
    if (!canA) body.appendChild(ui.notice(`Tu rol (${G.roleName()}) puede ver los accesos, pero solo el administrador del sistema o la gerencia los aprueban (ops.support_access.approve).`, 'info'));
    const def = Number(G.param('ops_support_default_hours') ?? 8);
    body.appendChild(ui.card('Solicitudes por aprobar', pend.length ? h('div', { class: 'stack' }, pend.map(g => h('div', { style: 'border:1px solid var(--line);border-radius:10px;padding:12px;display:grid;gap:8px' },
      h('div', { class: 'row between', style: 'flex-wrap:wrap;gap:8px' }, h('b', null, `${g.platform_user_name} (Intelectalab)`), h('span', null, lvl(g.access_level), ' ', g.allow_export ? ui.badge('Pide exportar', 'warn') : ui.badge('Sin exportar', ''))),
      h('div', null, g.reason), h('div', { class: 'small muted' }, `Ticket ${(rget('support_tickets', g.ticket_id) || {}).number || '—'} · módulos ${(g.modules || []).join(', ') || 'todos'} · sugiere ${g.requested_hours} h · pedido ${G.fmt.datetime(g.requested_at)}`),
      h('div', { class: 'row' }, ui.btn('Aprobar', () => approve(g), { kind: 'primary', sm: true, disabled: !canA }), ui.btn('Rechazar', () => reject(g), { sm: true, disabled: !canA }))))) : ui.empty('No hay solicitudes pendientes.')));
    body.appendChild(ui.card('Accesos vigentes', vig.length ? grantTable(vig, 'ops14-v', g => [ui.btn('Revocar', () => revoke(g), { sm: true, kind: 'danger', disabled: !canR })]) : ui.empty('Ningún acceso vigente: Intelectalab no puede entrar a tu empresa.'), { flush: !!vig.length }));
    if (G.can('ops.support_access.view_log')) body.appendChild(ui.card('Lo que hizo el soporte', accessLogTable(G.db.all('support_access_log'), 'ops14-log'), { flush: true }));
    body.appendChild(ui.card('Historial de accesos', grantTable(gs.filter(g => !['REQUESTED', 'APPROVED'].includes(g.status)), 'ops14-h'), { flush: true }));
    function approve(g) {
      ui.modal('Aprobar acceso de soporte', bd => {
        bd.appendChild(ui.dl([['Soporte', g.platform_user_name], ['Motivo', g.reason], ['Nivel', lvl(g.access_level)], ['Exportar', g.allow_export ? 'Sí' : 'No'], ['Sugiere', g.requested_hours + ' h']]));
        bd.appendChild(ui.form({ id: 'ops14a', values: { hours: '' }, submitLabel: 'Aprobar', fields: [{ key: 'hours', label: 'Duración (horas)', type: 'number', min: 1, max: maxHours(), help: `Déjalo vacío para usar ${def} h (ops_support_default_hours). Máximo ${maxHours()} h. Puedes revocarlo cuando quieras.` }], onSubmit: v => { try { const x = O.approveAccess(g.id, { hours: v.hours === '' ? undefined : v.hours }); ui.closeAll(); ui.toast(`Acceso aprobado hasta el ${G.fmt.datetime(x.expires_at)}`, 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }));
      });
    }
    function reject(g) { ui.modal('Rechazar acceso', bd => bd.appendChild(ui.form({ id: 'ops14r', submitLabel: 'Rechazar', fields: [{ key: 'reason', label: 'Motivo', type: 'textarea', required: true }], onSubmit: v => { try { O.rejectAccess(g.id, v.reason); ui.closeAll(); ui.toast('Solicitud rechazada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))); }
    function revoke(g) { ui.modal('Revocar acceso', bd => bd.appendChild(ui.form({ id: 'ops14v', submitLabel: 'Revocar ahora', fields: [{ key: 'reason', label: 'Motivo', type: 'textarea', required: true }], onSubmit: v => { try { O.revokeAccess(g.id, v.reason); ui.closeAll(); ui.toast('Acceso revocado: el usuario técnico quedó inactivo', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))); }
  }

  /* ---------- OPS-15 Mis tickets (cliente) ---------- */
  function scrClientTickets(el, params) {
    O.autoCloseTickets();
    const tid = G.ctx.tenant; const t = rget('tenants', tid);
    const canC = G.can('ops.ticket.create');
    const body = ui.page(el, { code: 'OPS-15', title: 'Mis tickets', sub: 'Abre un ticket a Intelectalab con categoría, prioridad y adjuntos; sigue la respuesta y califica la atención.', actions: canC ? [{ label: 'Nuevo ticket', kind: 'primary', onClick: () => newTicket() }] : [] });
    if (t && ['SUSPENDED', 'READ_ONLY'].includes(t.status)) body.appendChild(O.suspensionPage(tid));
    const anns = O.announcementsFor(tid); const uid = G.ctx.userId();
    const unread = anns.filter(a => !raw('announcement_reads').some(r => r.announcement_id === a.id && r.user_id === uid));
    if (anns.length) body.appendChild(ui.card(`Avisos de Intelectalab${unread.length ? ` (${unread.length} sin leer)` : ''}`, h('div', { class: 'stack' }, anns.slice(0, 5).map(a => h('div', { class: 'notice ' + (a.kind === 'MAINTENANCE' ? 'warn' : a.kind === 'INCIDENT' ? 'bad' : 'info') }, h('div', { style: 'width:100%' }, h('div', { class: 'row between', style: 'gap:8px;flex-wrap:wrap' }, h('b', null, `${annKind(a.kind)} · ${a.title}`), unread.includes(a) ? ui.btn('Marcar leído', () => { O.markRead(a.id); G.refresh(); }, { sm: true, kind: 'ghost' }) : h('span', { class: 'small muted' }, 'Leído')), h('div', { class: 'small' }, a.body), h('div', { class: 'small muted' }, `${G.fmt.datetime(a.starts_at)}${a.ends_at ? ' → ' + G.fmt.datetime(a.ends_at) : ''}`)))))));
    const all = G.db.all('support_tickets');
    const rows = G.can('ops.ticket.view_all') ? all : all.filter(x => x.opened_by === uid);
    const k14 = G.kpi('KPI-OPS-14') || {};
    body.appendChild(ui.kpis([{ label: 'Abiertos', value: rows.filter(x => !['RESOLVED', 'CLOSED'].includes(x.status)).length }, { label: 'Esperan tu respuesta', value: rows.filter(x => x.status === 'WAITING_CUSTOMER').length, tone: rows.some(x => x.status === 'WAITING_CUSTOMER') ? 'warn' : '' }, { label: 'Por calificar', value: rows.filter(x => x.status === 'RESOLVED' && !x.satisfaction).length }, { label: 'Tiempo de resolución (mes)', value: fmtH(k14.value), sub: 'KPI-OPS-14 · mediana' }]));
    body.appendChild(ticketTable(rows, 'ops15', false));
    if (!G.can('ops.ticket.view_all')) body.appendChild(h('div', { class: 'small muted' }, 'Ves solo tus tickets; los de toda la empresa requieren ops.ticket.view_all.'));
    if (params.id) setTimeout(() => { const x = rget('support_tickets', params.id); if (x && x.tenant === tid) ticketDrawer(x, false); }, 0);
    function newTicket() {
      ui.drawer('Nuevo ticket a Intelectalab', (bd, close) => {
        const files = h('input', { type: 'file', multiple: true, class: 'input', attrs: { id: 'ops15-files', 'aria-label': 'Adjuntos' } });
        const fr = O.frHours();
        const f = ui.form({ id: 'ops15f', values: { category: 'EINVOICE', priority: 'NORMAL' }, fields: [{ key: 'subject', label: 'Asunto', required: true }, { key: 'category', label: 'Categoría', type: 'select', options: CATS, required: true }, { key: 'priority', label: 'Prioridad', type: 'select', options: PRIOS.map(([k, l]) => [k, `${l} · primera respuesta en ${fr[k]} h${k === 'URGENT' ? ' (24×7)' : ' hábiles'}`]), required: true }, { key: 'description', label: 'Qué pasó (pasos, pantalla, número de pedido o comprobante)', type: 'textarea', required: true }], onCancel: close, onSubmit: v => { try { const tk = O.openTicket(Object.assign({}, v, { attachments: Array.from(files.files || []).map(x => x.name) })); close(); ui.toast(`Ticket ${tk.number} enviado a Intelectalab`, 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } });
        insertBeforeActions(f, field('Adjuntos', files, 'Capturas, XML o archivos del error.'));
        bd.appendChild(f);
      }, { code: 'OPS-15' });
    }
  }

  /* ---------- OPS-16 Parámetros de plataforma ---------- */
  function scrParams(el) {
    const body = ui.page(el, { code: 'OPS-16', title: 'Parámetros de plataforma', sub: 'Parámetros que valen para todas las empresas, con historial de solo inserción y motivo del cambio (RN-OPS-05). Los de cada empresa se cambian en PLT.' });
    consoleBar(body);
    const keys = O.platformParamKeys();
    const rows = keys.map(k => { const d = G.PARAM_DEFS[k]; const p = raw('platform_parameters').find(x => x.key === k); return { key: k, module: d.module, desc: d.desc, value: O.pparam(k), def: d.default, changed: !!p, updated_at: p && p.updated_at }; });
    body.appendChild(ui.table({ id: 'ops16', rows, onRow: r => edit(r), filters: [{ key: 'module', label: 'Módulo', options: [...new Set(rows.map(r => r.module))].sort().map(m => [m, m]) }], columns: [{ key: 'key', label: 'Clave', mono: true }, { key: 'module', label: 'Módulo' }, { key: 'desc', label: 'Para qué' }, { key: 'value', label: 'Valor vigente', value: r => JSON.stringify(r.value), render: r => h('span', { class: 'mono' }, typeof r.value === 'string' ? r.value : JSON.stringify(r.value)) }, { key: 'changed', label: 'Origen', render: r => r.changed ? ui.badge('Modificado', 'warn') : ui.badge('Por defecto', '') }] }));
    const hist = raw('platform_parameter_history').slice().sort(U.by('changed_at', -1));
    body.appendChild(ui.card('Historial de cambios', ui.table({ id: 'ops16-h', rows: hist, columns: [{ key: 'changed_at', label: 'Fecha', render: x => G.fmt.datetime(x.changed_at) }, { key: 'key', label: 'Clave', mono: true }, { key: 'old_value', label: 'Antes', value: x => JSON.stringify(x.old_value) }, { key: 'new_value', label: 'Después', value: x => JSON.stringify(x.new_value) }, { key: 'reason', label: 'Motivo' }, { key: 'changed_by_name', label: 'Por' }], empty: 'Sin cambios: todos los parámetros tienen su valor por defecto.' }), { flush: true }));
    function edit(r) {
      ui.drawer(r.key, (bd, close) => {
        bd.appendChild(ui.dl([['Módulo', r.module], ['Para qué', r.desc], ['Valor por defecto', JSON.stringify(r.def)], ['Valor vigente', JSON.stringify(r.value)]]));
        bd.appendChild(ui.form({ id: 'ops16f', values: { value: typeof r.value === 'string' ? r.value : JSON.stringify(r.value) }, fields: [{ key: 'value', label: 'Nuevo valor (número, texto o JSON)', required: true, help: r.key === 'ops_console_ip_allowlist' ? 'Ejemplo: ["190.237.14.0/24", "181.176.90.14"]' : r.key === 'ops_health_weights' ? 'Ejemplo: {"uso":25,"cobro":25,"OSE":20,"WhatsApp":15,"tickets":15}' : null }, { key: 'reason', label: 'Motivo del cambio', type: 'textarea', required: true }], onCancel: close, onSubmit: v => { let val = v.value; try { val = JSON.parse(v.value); } catch (e) { val = v.value; } try { O.setPParam(r.key, val, v.reason); close(); ui.toast('Parámetro actualizado para toda la plataforma', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }));
      }, { code: 'OPS-16' });
    }
  }

  /* ------------------------------------------------------------------
     Registro del módulo
     ------------------------------------------------------------------ */
  G.register({
    code: 'OPS', name: 'Consola de plataforma y soporte', phase: 4, group: 'Producto SaaS',
    screens: [
      { code: 'OPS-01', name: 'Ingreso a la consola', roles: CONSOLE, render: scrLogin },
      { code: 'OPS-02', name: 'Empresas', roles: CONSOLE, render: scrTenants },
      { code: 'OPS-03', name: 'Ficha de la empresa', roles: CONSOLE, render: scrTenant },
      { code: 'OPS-04', name: 'Suspender o reactivar', roles: CONSOLE, render: scrStatus },
      { code: 'OPS-05', name: 'Solicitar acceso de soporte', roles: CONSOLE, render: scrRequest },
      { code: 'OPS-06', name: 'Sesión de soporte', roles: CONSOLE, render: scrSession },
      { code: 'OPS-07', name: 'Salud de componentes', roles: CONSOLE, render: scrHealth },
      { code: 'OPS-08', name: 'Incidentes', roles: CONSOLE, render: scrIncidents },
      { code: 'OPS-09', name: 'Bandeja de tickets', roles: CONSOLE, render: scrInbox },
      { code: 'OPS-10', name: 'Métricas del negocio', roles: CONSOLE, render: scrMetrics },
      { code: 'OPS-11', name: 'Anuncios', roles: CONSOLE, render: scrAnnouncements },
      { code: 'OPS-12', name: 'Usuarios de plataforma', roles: CONSOLE, render: scrPUsers },
      { code: 'OPS-13', name: 'Bitácora de la consola', roles: CONSOLE, render: scrAudit },
      { code: 'OPS-14', name: 'Accesos de soporte (cliente)', roles: CLIENT, render: scrClientAccess },
      { code: 'OPS-15', name: 'Mis tickets (cliente)', roles: CLIENT, render: scrClientTickets },
      { code: 'OPS-16', name: 'Parámetros de plataforma', roles: CONSOLE, render: scrParams },
    ],
  });

  /* ------------------------------------------------------------------
     Pruebas de aceptación (CA-OPS-01 a 08)
     ------------------------------------------------------------------ */
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const expectRule = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e; throw new Error(`Se esperaba ${code} y salió: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code}`); };
  const T = (name, fn) => G.tests.push({ module: 'OPS', name, fn: async () => { const role = G.ctx.role, ten = G.ctx.tenant, oc = G.ctx.opsConsole; try { await fn(); } finally { G.ctx.role = role; G.ctx.tenant = ten; G.ctx.opsConsole = oc; G.ctx.opsSupportSession = null; } } });
  const asSupport = () => { G.ctx.opsConsole = { platform_user_id: 'pu-soporte', at: '2026-10-10T09:00:00', ip: '181.176.90.14', last: now(), demo: true }; };

  T('CA-OPS-01: acceso de solo lectura por una boleta rechazada vence a las 8 h; sin permiso → RN-OPS-03; 100 h → RN-OPS-02', async () => {
    asSupport();
    const tk = O.openTicket({ subject: 'Boleta B001-00000999 rechazada por el OSE', description: 'El OSE devolvió el código 2800 al enviar la boleta.', category: 'EINVOICE', priority: 'HIGH' }, { tenant: 'DG', system: true, at: '2026-10-10T10:00:00' });
    expectRule(() => O.requestAccess({ tenant: 'DG', ticket_id: tk.id, reason: 'Revisar la boleta rechazada por el OSE', access_level: 'READ_ONLY', hours: 100 }), 'RN-OPS-02');
    const g = O.requestAccess({ tenant: 'DG', ticket_id: tk.id, reason: 'Revisar la boleta rechazada por el OSE', access_level: 'READ_ONLY', modules: ['FAC'] }, { at: '2026-10-10T10:05:00' });
    assert(g.status === 'REQUESTED', 'La solicitud no nace aprobada');
    G.ctx.tenant = 'DG';
    expectRule(() => O.approveAccess(g.id, { role: 'VENDEDORA', at: '2026-10-10T10:10:00' }), 'RN-OPS-03');
    expectRule(() => O.approveAccess(g.id, { role: 'SOPORTE_PLATAFORMA', at: '2026-10-10T10:10:00' }), 'RN-OPS-03');
    G.ctx.role = 'GERENTE';
    O.approveAccess(g.id, { at: '2026-10-10T10:10:00' });
    assert(g.status === 'APPROVED' && g.expires_at === '2026-10-10T18:10:00', 'Debe vencer a las 8 h: ' + g.expires_at);
    assert(rget('users', g.support_user_id).status === 'ACTIVE', 'Debe crearse el usuario técnico activo');
    expectRule(() => O.approveAccess(g.id, { at: '2026-10-10T10:12:00' }), 'RN-OPS-03');
    O.expireDue('2026-10-10T18:11:00');
    assert(g.status === 'EXPIRED' && rget('users', g.support_user_id).status === 'INACTIVE', 'Al vencer, el usuario técnico queda inactivo (RN-OPS-09)');
  });
  T('CA-OPS-02: con acceso vigente consulta comprobantes y queda registrado; modificar o exportar se rechaza; tras revocar → RN-OPS-04', async () => {
    asSupport(); G.ctx.tenant = 'DG';
    const g = O.requestAccess({ tenant: 'DG', reason: 'Revisar los comprobantes rechazados de octubre', access_level: 'READ_ONLY', modules: ['FAC'], allow_export: false });
    O.approveAccess(g.id, { hours: 4 });
    const before = raw('support_access_log').filter(l => l.grant_id === g.id).length;
    const docs = O.readTenantData(g.id, 'sales_documents', { query: 'Comprobantes de octubre' });
    assert(docs.length > 0 && docs.every(d => d.tenant === 'DG'), 'Debe leer los comprobantes de Don Guando');
    assert(raw('support_access_log').filter(l => l.grant_id === g.id && l.action === 'VIEW' && l.entity === 'sales_documents').length === 1 && raw('support_access_log').filter(l => l.grant_id === g.id).length === before + 1, 'La consulta debe quedar en la bitácora');
    expectRule(() => O.supportAct(g.id, { action: 'UPDATE', entity: 'sales_documents', entity_id: docs[0].id }), 'RN-OPS-04');
    expectRule(() => O.supportAct(g.id, { action: 'EXPORT', entity: 'sales_documents' }), 'RN-OPS-04');
    expectRule(() => O.supportAct(g.id, { action: 'VIEW', entity: 'customers' }), 'RN-OPS-04');
    expectRule(() => O.supportAct(g.id, { action: 'VIEW', entity: 'sales_documents', pu: rget('platform_users', 'pu-l1') }), 'RN-OPS-04');
    G.ctx.role = 'GERENTE';
    O.revokeAccess(g.id, 'Ya no es necesario');
    assert(g.status === 'REVOKED' && rget('users', g.support_user_id).status === 'INACTIVE', 'El usuario técnico debe quedar inactivo');
    expectRule(() => O.readTenantData(g.id, 'sales_documents'), 'RN-OPS-04');
    expectRule(() => O.approveAccess(g.id), 'RN-OPS-03');
  });
  T('CA-OPS-03: el cliente ve en OPS-14 cada consulta y la consola ve los mismos registros en OPS-03 y su bitácora con el motivo', async () => {
    asSupport(); G.ctx.tenant = 'DG';
    const g = O.requestAccess({ tenant: 'DG', reason: 'Revisar la transferencia de stock del 09/10', access_level: 'READ_ONLY', modules: ['ALM'] });
    O.approveAccess(g.id, {});
    O.startSession(g.id, { ip: '181.176.90.14' });
    O.readTenantData(g.id, 'stock_balances', { query: 'Saldos del cuy entero' });
    O.supportAct(g.id, { action: 'VIEW', entity: 'stock_balances', entity_id: 'x', detail: { query: 'Kardex del 09/10' } });
    O.endSession(g.id);
    const client = G.db.all('support_access_log').filter(l => l.grant_id === g.id);
    const consoleSide = raw('support_access_log').filter(l => l.tenant === 'DG' && l.grant_id === g.id);
    assert(client.length === 4 && consoleSide.length === client.length && client.every(l => consoleSide.includes(l)), 'Ambos lados deben ver los mismos 4 registros');
    const aud = raw('platform_audit_log').filter(a => a.target_tenant_id === 'DG' && a.detail && a.detail.grant_id === g.id && /^SUPPORT_VIEW$/.test(a.action));
    assert(aud.length === 2 && aud.every(a => a.reason === g.reason && a.ip), 'La bitácora de la consola debe tener las consultas con el motivo y la IP');
    G.ctx.tenant = 'CS'; assert(!G.db.all('support_access_log').some(l => l.grant_id === g.id), 'Otra empresa no ve la bitácora de Don Guando');
    G.ctx.tenant = 'DG'; assert(G.db.all('notifications').some(n => n.module === 'OPS' && /empezó a usar/.test(n.title)), 'Debe avisar el primer uso a los administradores (RN-OPS-12)');
  });
  T('CA-OPS-04: BILLING o PLATFORM_ADMIN suspende solo con motivo; el cliente ve la página de suspensión y queda en historial y bitácora', async () => {
    G.ctx.opsConsole = { platform_user_id: 'pu-l1', demo: true, last: now() };
    expectRule(() => O.setTenantStatus('T-LPR', 'SUSPENDED', 'Uso para envío de spam'), 'RN-OPS-10');
    G.ctx.opsConsole = { platform_user_id: 'pu-billing', demo: true, last: now() };
    expectRule(() => O.setTenantStatus('T-LPR', 'SUSPENDED', ''), 'RN-OPS-07');
    O.setTenantStatus('T-LPR', 'SUSPENDED', 'Uso de la plataforma para envíos masivos no solicitados (fines prohibidos)', { category: 'PROHIBITED_USE' });
    assert(O.sub('T-LPR').status === 'SUSPENDED' && rget('tenants', 'T-LPR').status === 'SUSPENDED', 'Debe quedar suspendida');
    assert(raw('subscription_events').some(e => e.tenant === 'T-LPR' && e.to_status === 'SUSPENDED' && /prohibidos/.test(e.reason)), 'Falta el historial de la suscripción');
    assert(raw('platform_audit_log').some(a => a.action === 'TENANT_SUSPENDED' && a.target_tenant_id === 'T-LPR' && a.reason), 'Falta la bitácora');
    const page = O.suspensionPage('T-LPR'); assert(/suspendida/.test(page.textContent) && /prohibidos/.test(page.textContent), 'La página de suspensión debe mostrar el motivo');
    G.ctx.opsConsole = { platform_user_id: 'pu-admin', demo: true, last: now() };
    O.setTenantStatus('T-LPR', 'ACTIVE', 'Cliente regularizó y firmó compromiso de uso');
    assert(O.sub('T-LPR').status === 'ACTIVE', 'PLATFORM_ADMIN debe poder reactivar');
  });
  T('CA-OPS-05: 10 clientes mensuales de S/ 100 y 2 anuales de S/ 1200 → MRR S/ 1200 e ingreso promedio S/ 100', async () => {
    const subs = [];
    for (let i = 0; i < 10; i++) subs.push(M.fromPlan({ id: 'm' + i, period: 'MONTHLY', price: 100 }));
    for (let i = 0; i < 2; i++) subs.push(M.fromPlan({ id: 'a' + i, period: 'ANNUAL', price: 1200 }));
    assert(M.mrr(subs) === 1200, 'MRR esperado 1200: ' + M.mrr(subs));
    assert(M.arpa(subs) === 100, 'Ingreso promedio esperado 100: ' + M.arpa(subs));
    const v = G.kpi('KPI-OPS-01'); assert(v && v.value > 0, 'KPI-OPS-01 debe calcularse con los datos de la consola');
  });
  T('CA-OPS-06: 40 clientes activos al inicio del mes y 2 cancelaciones → churn 5 %', async () => {
    const subs = [];
    for (let i = 0; i < 40; i++) subs.push(M.fromPlan({ id: 'c' + i, period: 'MONTHLY', price: 590, activated_at: '2026-05-01', cancelled_at: i < 2 ? '2026-09-1' + (i + 4) + 'T10:00' : null }));
    subs.push(M.fromPlan({ id: 'nuevo', period: 'MONTHLY', price: 590, activated_at: '2026-09-20' }));
    const c = M.churn(subs, '2026-09-01');
    assert(c.value === 5 && c.numerator === 2 && c.denominator === 40, `Churn esperado 5 % (2/40): ${JSON.stringify(c)}`);
    const real = G.kpi('KPI-OPS-03', { from: '2026-09-01', to: '2026-09-30' }); assert(real && real.denominator > 0 && real.numerator >= 1, 'El churn de setiembre de la demo debe contar la cancelación de Pollos Arequipa');
  });
  T('CA-OPS-07: OSE caído 10 minutos → DOWN, incidente SEV2, aviso antes de 30 min y la disponibilidad del día baja en proporción', async () => {
    const d = G.TODAY; const before = M.availability('OSE', d, d);
    const base = d + 'T10:00:00';
    for (let i = 0; i < 10; i++) O.recordCheck({ component: 'OSE', status: 'DOWN', latency_ms: 10000, error_rate_pct: 100, at: addMin(base, i) });
    assert(O.lastCheck('OSE').status === 'DOWN', 'La salud del OSE debe pasar a DOWN');
    const inc = raw('platform_incidents').find(i => i.component === 'OSE' && i.status !== 'RESOLVED');
    assert(inc && inc.severity === 'SEV2', 'Debe abrirse un incidente SEV2');
    const mins = O.notifyMinutes(inc); assert(mins !== null && mins < 30, 'El aviso debe salir antes de 30 minutos: ' + mins);
    assert(O.incidentTenants(inc.id).every(x => x.notified_at) && raw('platform_announcements').some(a => a.incident_id === inc.id), 'Todas las empresas afectadas deben quedar avisadas');
    const after = M.availability('OSE', d, d);
    const expected = R(before.numerator / (before.denominator + 10) * 100, 3);
    assert(after.denominator === before.denominator + 10 && after.value === expected && after.value < before.value, `Disponibilidad esperada ${expected}: ${after.value}`);
    O.recordCheck({ component: 'OSE', status: 'UP', at: addMin(base, 10) });
    assert(rget('platform_incidents', inc.id).status === 'MONITORING', 'Al recuperarse pasa a monitoreo');
    expectRule(() => O.resolveIncident(inc.id, { resolved_at: '2026-10-10T09:00:00', root_cause: 'Certificado vencido del OSE' }, { system: true }), 'RN-OPS-08');
    O.resolveIncident(inc.id, { resolved_at: addMin(base, 12), root_cause: 'Certificado vencido del OSE en el proveedor' }, { system: true });
  });
  T('CA-OPS-08: ticket URGENT abierto 10:00 y respondido 10:40 cumple el plazo de 1 h y entra en la mediana del mes', async () => {
    const t = O.openTicket({ subject: 'No se puede confirmar ningún pedido', description: 'Desde las 9:55 la confirmación muestra un error.', category: 'ORDERS', priority: 'URGENT' }, { tenant: 'DG', system: true, at: '2026-10-10T10:00:00' });
    O.replyTicket(t.id, 'Estamos revisando, ya identificamos el problema.', { by: 'PLATFORM', pu: rget('platform_users', 'pu-soporte'), at: '2026-10-10T10:40:00' });
    const s = O.sla(t);
    assert(s.target === 1 && Math.abs(s.elapsed - 2 / 3) < 1e-6 && s.met === true, 'Debe cumplir el plazo de 1 h: ' + JSON.stringify(s));
    const sample = raw('support_tickets').filter(x => x.opened_at >= '2026-10-01' && x.priority === 'URGENT').map(O.firstResponseH);
    assert(sample.some(v => Math.abs(v - 2 / 3) < 1e-6), 'La primera respuesta debe entrar en la muestra del mes');
    const k = G.kpi('KPI-OPS-11', { from: '2026-10-01', to: G.TODAY, priority: 'URGENT' });
    assert(k && Math.abs(k.value - R(median(sample), 2)) < 1e-9, 'KPI-OPS-11 debe ser la mediana del mes: ' + JSON.stringify(k));
    expectRule(() => O.rateTicket(t.id, 5), 'RN-OPS-15');
  });
})();
