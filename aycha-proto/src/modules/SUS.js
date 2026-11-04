/* =====================================================================
   SUS · Planes y suscripciones (Fase 4 · Aycha como producto SaaS de Intelectalab)
   Catálogo de productos, planes con versiones y complementos; suscripción
   por empresa con prueba, mora, solo lectura y suspensión; encendido de
   módulos según plan; uso medido contra límites con avisos al 80/100 %;
   comprobantes del SaaS con IGV y series de Intelectalab; cobro con
   pasarela simulada (FAKE), webhook firmado e idempotente, reintentos;
   cambio de plan con prorrateo y cancelación con conservación de datos.
   ===================================================================== */
(function () {
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, modal, form, toast, confirm, tabs, pills } = G.ui;
  const U = G.util, F = G.fmt;
  const R = (n, d = 2) => U.round(n, d);
  const S = G.sus = G.sus || {};
  const SPEC = G.SPEC.SUS || { screens: [] };
  const scName = c => (SPEC.screens.find(s => s[0] === c) || [c, c])[1];
  const P = k => G.param(k);
  const today = () => G.TODAY;
  const dOf = s => String(s || '').slice(0, 10);
  const igv = () => { const v = Number(P('sus_igv_rate') ?? 0.18); return v > 1 ? v / 100 : v; };

  /* ---------- catálogos y etiquetas ---------- */
  const LIMITS = [['USERS', 'Usuarios del personal', 'HARD'], ['COMPANIES', 'Empresas (RUC)', 'HARD'], ['ESTABLISHMENTS', 'Locales', 'HARD'], ['BRANDS', 'Marcas activas', 'HARD'], ['ORDERS_MONTH', 'Pedidos del mes', 'SOFT'], ['WHATSAPP_NUMBERS', 'Números de WhatsApp', 'HARD'], ['TEL_MINUTES_MONTH', 'Minutos de telefonía del mes', 'HARD'], ['API_CALLS_DAY', 'Llamadas de API del día', 'HARD'], ['STORAGE_GB', 'Almacenamiento (GB)', 'SOFT']];
  const limName = k => (LIMITS.find(x => x[0] === k) || [k, k])[1];
  const UNIT = { USERS: ['usuario', 'usuarios'], COMPANIES: ['empresa', 'empresas'], ESTABLISHMENTS: ['local', 'locales'], BRANDS: ['marca', 'marcas'], ORDERS_MONTH: ['pedido', 'pedidos'], WHATSAPP_NUMBERS: ['número', 'números'], TEL_MINUTES_MONTH: ['minuto', 'minutos'], API_CALLS_DAY: ['llamada', 'llamadas'], STORAGE_GB: ['GB', 'GB'] };
  const unit = (k, n) => (UNIT[k] || ['', ''])[Math.abs(n) === 1 ? 0 : 1];
  const SUB_ST = { TRIAL: ['Prueba', 'info'], ACTIVE: ['Activa', 'ok'], PAST_DUE: ['En mora', 'warn'], READ_ONLY: ['Solo lectura', 'bad'], SUSPENDED: ['Suspendida', 'bad'], CANCELLED: ['Cancelada', ''] };
  const INV_ST = { DRAFT: ['Borrador', ''], OPEN: ['Por cobrar', 'warn'], PAID: ['Pagado', 'ok'], VOIDED: ['Anulado', 'bad'], UNCOLLECTIBLE: ['Incobrable', 'bad'] };
  const ATT_ST = { PENDING: ['Esperando webhook', 'warn'], APPROVED: ['Aprobado', 'ok'], REJECTED: ['Rechazado', 'bad'], ERROR: ['Error', 'bad'], REFUNDED: ['Reembolsado', ''] };
  const PLAN_ST = { DRAFT: ['Borrador', ''], PUBLISHED: ['Publicado', 'ok'], RETIRED: ['Retirado', ''] };
  const EV = { CREATED: 'Alta', TRIAL_EXTENDED: 'Prueba extendida', PLAN_CHANGED: 'Cambio de plan', ADDON_ADDED: 'Complemento contratado', ADDON_ENDED: 'Complemento retirado', STATUS_CHANGED: 'Cambio de estado', PERIOD_RENEWED: 'Período renovado', PAYMENT_FAILED: 'Cobro rechazado', PAYMENT_CONFIRMED: 'Cobro confirmado', USAGE_THRESHOLD: 'Aviso de uso' };
  const ACTOR = { SYSTEM: 'Sistema', TENANT_USER: 'Usuario del cliente', PLATFORM_USER: 'Intelectalab' };
  const lbl = (m, k) => (m[k] || [k, ''])[0];
  const bdg = (m, k) => badge(lbl(m, k), (m[k] || [k, ''])[1]);
  const TRANS = { TRIAL: ['ACTIVE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED'], ACTIVE: ['PAST_DUE', 'SUSPENDED', 'CANCELLED'], PAST_DUE: ['ACTIVE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED'], READ_ONLY: ['ACTIVE', 'SUSPENDED', 'CANCELLED'], SUSPENDED: ['ACTIVE', 'READ_ONLY', 'CANCELLED'], CANCELLED: [] };
  S.TRANSITIONS = TRANS;
  const PLATFORM_MODS = ['SUS', 'ONB', 'OPS'];
  // dependencias de módulos (respaldo si PLT no publica platform_modules.depends_on)
  const DEPS = { TEL: ['CRM'], CMP: ['CRM', 'CLI'], B2B: ['PED', 'CLI', 'FAC'], CNT: ['FAC', 'CAJ', 'GAS'], CON: ['PED', 'ALM', 'FAC'], ADS: ['PED'], WEB: ['PED', 'CAT'], POS: ['CAJ', 'FAC', 'ALM'], PRO: ['ALM', 'CAT'], DES: ['PRO'], REC: ['PRO'], CAL: ['ALM'], ETQ: ['CAT', 'ALM'], COM: ['ALM', 'GAS'], GRJ: ['COM'], FLO: ['DEL'], PRS: ['GAS'], SEP: ['FAC'], API: ['PED'], PER: [], EQU: [], GAS: [] };
  S.deps = code => { const pm = G.db.raw('platform_modules').find(m => m.code === code && Array.isArray(m.depends_on)); return pm ? pm.depends_on : (DEPS[code] || []); };
  const modName = c => (G.SPEC[c] || {}).name || c;

  /* ---------- acceso a datos de plataforma y de cada empresa ---------- */
  const rawT = (t, ten) => G.db.raw(t).filter(r => r.tenant === ten);
  const glob = t => G.db.raw(t).filter(r => !r.tenant);
  const getRaw = (t, id) => G.db.raw(t).find(r => r.id === id) || null;
  const upd = (t, row, patch) => { const before = {}; for (const k of Object.keys(patch)) before[k] = row[k]; Object.assign(row, patch, { updated_at: G.date.now() }); G.db.touch(); if (!G._seeding) G.audit('EDITAR', t, row.id, Object.keys(patch).join(', '), before, patch); return row; };
  const insT = (t, row, ten) => G.db.insert(t, Object.assign({}, row, { tenant: ten }), { silent: true });
  const insG = (t, row) => G.db.insert(t, Object.assign({}, row), { global: true, silent: true });
  S.tenantRow = ten => G.db.raw('tenants').find(t => t.id === ten) || null;
  S.tenantName = ten => { const t = S.tenantRow(ten); return t ? (t.short || t.name) : ten; };
  S.product = code => glob('saas_products').find(p => p.code === code) || null;
  S.plan = id => getRaw('saas_plans', id);
  S.planByCode = (code, version) => glob('saas_plans').filter(p => p.code === code && (version ? p.version === version : p.status === 'PUBLISHED')).sort((a, b) => b.version - a.version)[0] || null;
  S.planName = id => { const p = S.plan(id); return p ? `${p.name} v${p.version}` : '—'; };
  S.planLimits = plan_id => glob('saas_plan_limits').filter(l => l.plan_id === plan_id);
  S.planModules = plan_id => glob('saas_plan_modules').filter(m => m.plan_id === plan_id).map(m => m.module_code);
  S.productModules = product_id => glob('saas_product_modules').filter(m => m.product_id === product_id);
  S.coreModules = product_id => S.productModules(product_id).filter(m => m.is_core).map(m => m.module_code);
  S.addon = id => getRaw('saas_addons', id);
  S.subsOf = ten => rawT('subscriptions', ten);
  S.liveSubs = ten => S.subsOf(ten).filter(s => s.status !== 'CANCELLED');
  S.subFor = (ten, productCode = 'COMERCIAL') => { const pr = S.product(productCode); const subs = S.subsOf(ten).filter(s => !pr || s.product_id === pr.id); return subs.find(s => s.status !== 'CANCELLED') || subs.sort(U.by('created_at', -1))[0] || null; };
  S.addonsOf = sub => rawT('subscription_addons', sub.tenant).filter(a => a.subscription_id === sub.id && a.status === 'ACTIVE');
  S.invoicesOf = ten => rawT('saas_invoices', ten);
  S.eventsOf = sub => rawT('subscription_events', sub.tenant).filter(e => e.subscription_id === sub.id).sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
  const linesOf = inv => rawT('saas_invoice_lines', inv.tenant).filter(l => l.invoice_id === inv.id);
  const attemptsOf = inv => rawT('saas_payment_attempts', inv.tenant).filter(a => a.invoice_id === inv.id).sort((a, b) => a.attempt_no - b.attempt_no);
  const monthlyPrice = (sub, plan) => { plan = plan || S.plan(sub.plan_id); const base = sub.agreed_price ?? (plan ? plan.price : 0) ?? 0; return R(base * (1 - (sub.discount_pct || 0) / 100)); };
  S.mrr = sub => (['ACTIVE', 'PAST_DUE'].includes(sub.status) ? R(monthlyPrice(sub) + U.sum(S.addonsOf(sub), a => (a.agreed_price ?? (S.addon(a.addon_id) || {}).price ?? 0) * a.qty)) : 0);
  const platformCan = () => ['SOPORTE_PLATAFORMA', 'GERENTE'].includes(G.ctx.role);
  const isPlatformRole = () => ['SOPORTE_PLATAFORMA', 'GERENTE', 'AUDITOR'].includes(G.ctx.role);

  /** historial de solo inserción (RN-SUS-10) */
  function event(sub, type, o = {}) {
    return insT('subscription_events', { subscription_id: sub.id, event_type: type, from_status: o.from || null, to_status: o.to || null, from_plan_id: o.from_plan || null, to_plan_id: o.to_plan || null, reason: o.reason || null, actor_type: o.actor || 'SYSTEM', actor_id: o.actor_id || (o.actor && o.actor !== 'SYSTEM' ? G.ctx.userId() : null), actor_name: o.actor && o.actor !== 'SYSTEM' ? G.ctx.userName() : 'Sistema', occurred_at: o.at || G.date.now(), detail: o.detail || {} }, sub.tenant);
  }
  const periodEnd = start => G.date.add(G.date.add(G.date.addMonths(start, 1), Number(start.slice(8, 10)) - 1), -1);

  /* ------------------------------------------------------------------
     Uso y límites (RN-SUS-06, RN-SUS-16, RN-SUS-21)
     ------------------------------------------------------------------ */
  const counter = (ten, key, period) => rawT('usage_counters', ten).find(c => c.limit_key === key && c.period === period) || null;
  const LIVE = {
    USERS: ten => rawT('users', ten).filter(u => u.status === 'ACTIVE' && !['CLIENTE_B2B', 'SOPORTE_PLATAFORMA'].includes(u.role) && !u.platform && !u.support).length,
    COMPANIES: ten => rawT('companies', ten).filter(c => c.status !== 'INACTIVE' && c.status !== 'SEPARATED').length,
    ESTABLISHMENTS: ten => rawT('establishments', ten).filter(e => e.status !== 'INACTIVE').length,
    BRANDS: ten => rawT('brands', ten).filter(b => b.status === 'ACTIVE').length,
    WHATSAPP_NUMBERS: ten => rawT('messaging_channels', ten).filter(c => c.kind === 'WHATSAPP' && c.status !== 'DISCONNECTED').length,
  };
  /** uso actual de un límite: conteo vivo de las tablas o contador del mes (pedidos, minutos, API, almacenamiento) */
  S.used = function (ten, key, period = G.date.month(today())) {
    if (LIVE[key]) { const n = LIVE[key](ten); if (n > 0 || G.db.raw('companies').some(c => c.tenant === ten)) return n; const c = counter(ten, key, period); return c ? c.used : 0; }
    const c = counter(ten, key, period); if (c) return c.used;
    if (key === 'ORDERS_MONTH') return G.db.raw('sales_orders').filter(o => o.tenant === ten && o.confirmed_at && G.date.month(dOf(o.confirmed_at)) === period && o.status !== 'DRAFT').length;
    return 0;
  };
  /** límite efectivo = suma de los planes vivos que lo definen + complementos activos (D-SUS-07: se suman) */
  S.limit = function (ten, key) {
    const subs = S.liveSubs(ten); const enfDef = (LIMITS.find(x => x[0] === key) || [])[2] || 'HARD';
    if (!subs.length) return { value: null, enforcement: enfDef, noSub: true, plan: 0, addons: 0 };
    let any = false, plan = 0, add = 0, enf = enfDef;
    for (const s of subs) {
      const l = S.planLimits(s.plan_id).find(x => x.limit_key === key);
      if (l) { if (l.limit_value == null) return { value: null, enforcement: l.enforcement, unlimited: true, plan: null, addons: 0 }; any = true; plan += l.limit_value; enf = l.enforcement; }
      for (const a of S.addonsOf(s)) { const ad = S.addon(a.addon_id); if (ad && ad.limit_key === key) { any = true; add += (ad.limit_increment || 0) * a.qty; } }
    }
    return { value: any ? plan + add : null, enforcement: enf, plan, addons: add };
  };
  S.usage = function (ten) {
    return LIMITS.map(([key, name]) => { const l = S.limit(ten, key); const used = S.used(ten, key); const c = counter(ten, key, G.date.month(today())); return { key, name, used, limit: l.value, plan: l.plan, addons: l.addons, enforcement: l.enforcement, pct: l.value ? R(used / l.value * 100, 2) : null, alerted: c ? c.alerted_pcts || [] : [], noSub: l.noSub }; });
  };
  /** sus_assert_limit: rechaza la acción que excede un límite duro */
  S.assertLimit = function (ten, key, current, inc = 1) {
    const l = S.limit(ten, key); if (l.noSub || l.value == null || l.enforcement !== 'HARD') return true;
    if (current + inc > l.value) { const sub = S.subFor(ten); G.fail('RN-SUS-06', `Tu plan ${sub ? S.planName(sub.plan_id) : ''} permite ${F.num(l.value)} ${unit(key, l.value)} (${limName(key).toLowerCase()}) y ya usas ${F.num(current)}. Contrata un complemento en SUS-03 o sube de plan en SUS-02.`, { key, used: current, limit: l.value }); }
    return true;
  };
  /** sus_assert_writable: solo lectura, suspendida o cancelada no registran operaciones (HTTP 402) */
  S.assertWritable = function (ten = G.ctx.tenant) {
    const subs = S.subsOf(ten); if (!subs.length) return true; // RN-SUS-21: piloto sin suscripción
    const live = subs.filter(s => s.status !== 'CANCELLED');
    const blocked = live.length ? live.find(s => ['READ_ONLY', 'SUSPENDED'].includes(s.status)) : subs[0];
    if (blocked) G.fail('RN-SUS-07', `La suscripción de ${S.tenantName(ten)} está ${lbl(SUB_ST, blocked.status).toLowerCase()} (HTTP 402): puedes consultar, exportar y pagar la deuda, pero no registrar pedidos, comprobantes, cobros ni movimientos de stock. Paga en SUS-05.`);
    return true;
  };
  S.isWritable = ten => { try { return S.assertWritable(ten); } catch (e) { return false; } };
  /** sus_record_usage: suma uso del mes, avisa al 80/100 % una vez por mes y límite y aplica la política de exceso */
  S.recordUsage = function (ten, key, inc = 1, opts = {}) {
    const period = G.date.month(opts.date || today());
    let c = counter(ten, key, period);
    if (!c) c = insT('usage_counters', { period, limit_key: key, used: key === 'ORDERS_MONTH' && !opts.fresh ? S.used(ten, key, period) : 0, limit_value: null, alerted_pcts: [], measured_at: G.date.now() }, ten);
    const l = S.limit(ten, key);
    c.used = R((c.used || 0) + inc, 2); c.limit_value = l.value; c.measured_at = G.date.now(); G.db.touch();
    const out = { used: c.used, limit: l.value, pct: l.value ? R(c.used / l.value * 100, 2) : null, alerts: [] };
    if (!l.value) return out;
    for (const th of (P('sus_usage_alert_pcts') || [80, 100])) {
      if (out.pct >= th && !(c.alerted_pcts || []).includes(th)) {
        c.alerted_pcts = (c.alerted_pcts || []).concat([th]); out.alerts.push(th);
        const sub = S.subFor(ten);
        if (sub) event(sub, 'USAGE_THRESHOLD', { reason: `${limName(key)}: ${F.num(c.used)} de ${F.num(l.value)} (${F.pct(out.pct, 0)})`, detail: { key, pct: th, used: c.used, limit: l.value } });
        const admins = rawT('users', ten).filter(u => ['ADMIN_SISTEMA', 'GERENTE'].includes(u.role) && u.status === 'ACTIVE');
        const n = { title: `Uso del plan al ${th} %: ${limName(key).toLowerCase()}`, body: `${F.num(c.used)} de ${F.num(l.value)}. ${l.enforcement === 'SOFT' ? 'No bloquea; ' : ''}revisa SUS-04 o cambia de plan en SUS-02.`, ref: 'SUS-04', tone: th >= 100 ? 'bad' : 'warn', module: 'SUS', read_at: null, at: G.date.now() };
        if (admins.length) for (const u of admins) insT('notifications', Object.assign({ user_id: u.id }, n), ten); else insT('notifications', Object.assign({ user_id: null, role: 'ADMIN_SISTEMA' }, n), ten);
        G.events.emit('usage.threshold_reached', { tenant: ten, key, pct: th, used: c.used, limit: l.value });
      }
    }
    // límites SOFT: más de sus_soft_limit_tolerance_pct sobre el límite → política de exceso (D-SUS-05)
    if (l.enforcement === 'SOFT' && key === 'ORDERS_MONTH' && c.used > l.value * (1 + (P('sus_soft_limit_tolerance_pct') || 20) / 100)) {
      const sub = S.subFor(ten);
      if (sub && !sub.scheduled_plan_id && (P('sus_orders_overage_policy') || 'UPGRADE_NEXT_CYCLE') === 'UPGRADE_NEXT_CYCLE') {
        const next = S.nextPlan(sub); if (next) { upd('subscriptions', sub, { scheduled_plan_id: next.id, scheduled_reason: 'Exceso de pedidos (D-SUS-05)' }); event(sub, 'PLAN_CHANGED', { from_plan: sub.plan_id, to_plan: next.id, reason: `Supera ${F.num(l.value)} pedidos en más de ${P('sus_soft_limit_tolerance_pct')} %: pasa a ${next.name} en el próximo ciclo (D-SUS-05)`, detail: { scheduled: true } }); out.overage = next.code; }
      }
    }
    return out;
  };
  S.nextPlan = sub => { const cur = S.plan(sub.plan_id); return glob('saas_plans').filter(p => p.product_id === sub.product_id && p.status === 'PUBLISHED' && p.is_public && (p.price || 0) > (cur.price || 0)).sort((a, b) => a.price - b.price)[0] || null; };

  /* ------------------------------------------------------------------
     Módulos según plan (RN-SUS-08, RN-SUS-09)
     ------------------------------------------------------------------ */
  /** módulos a los que da derecho la suscripción: código → origen (CORE, PLAN, ADDON) */
  S.entitled = function (sub) {
    const m = new Map();
    if (!sub || sub.status === 'CANCELLED') return m;
    for (const c of S.coreModules(sub.product_id)) m.set(c, 'CORE');
    for (const c of S.planModules(sub.plan_id)) if (!m.has(c)) m.set(c, 'PLAN');
    for (const a of S.addonsOf(sub)) { const ad = S.addon(a.addon_id); if (ad && ad.module_code && !m.has(ad.module_code)) m.set(ad.module_code, 'ADDON'); }
    return m;
  };
  S.applyModules = function (ten, opts = {}) {
    const sub = S.subFor(ten); if (!sub) return [];
    const ent = S.entitled(sub);
    const order = S.productModules(sub.product_id).map(m => m.module_code).sort((a, b) => S.deps(a).length - S.deps(b).length);
    const rows = rawT('tenant_modules', ten); const changed = [];
    for (const code of order) {
      const row = rows.find(r => r.module_code === code);
      const on = ent.has(code);
      if (row && row.sus_source === 'MANUAL' && !row.enabled && on) continue; // el cliente lo apagó a mano: sigue apagado
      const src = on ? ent.get(code) : (row && row.sus_source) || 'PLAN';
      if (!row) { insT('tenant_modules', { id: 'tm-' + ten + '-' + code, module_code: code, phase: (G.SPEC[code] || {}).phase, enabled: on, sus_source: src, sus_subscription_id: sub.id, changed_at: G.date.now(), changed_by: opts.actor || 'Suscripción', reason: on ? `Incluido en ${S.planName(sub.plan_id)} (${src})` : 'No incluido en el plan', enabled_at: on ? G.date.now() : null }, ten); changed.push(code); }
      else if (row.enabled !== on || row.sus_source !== src) { Object.assign(row, { enabled: on, sus_source: src, sus_subscription_id: sub.id, changed_at: G.date.now(), changed_by: opts.actor || 'Suscripción', reason: on ? `Incluido en ${S.planName(sub.plan_id)} (${src})` : (sub.status === 'CANCELLED' ? 'Suscripción cancelada' : 'No incluido en el plan'), [on ? 'enabled_at' : 'disabled_at']: G.date.now() }); changed.push(code); }
    }
    G.db.touch();
    return changed;
  };
  const tenantModOn = (ten, code) => { const r = rawT('tenant_modules', ten).find(m => m.module_code === code); return !!(r && r.enabled); };
  S.tenantModOn = tenantModOn;

  /* ------------------------------------------------------------------
     Estados (RN-SUS-04) y alta (RN-SUS-03/05/15)
     ------------------------------------------------------------------ */
  S.canTransition = (sub, to) => (TRANS[sub.status] || []).includes(to);
  S.transition = function (sub, to, o = {}) {
    if (!S.canTransition(sub, to)) G.fail('RN-SUS-04', `No se puede pasar la suscripción de «${lbl(SUB_ST, sub.status)}» a «${lbl(SUB_ST, to)}».`);
    if (to === 'SUSPENDED' && !o.reason) G.fail('RN-SUS-04', 'Suspender exige motivo.');
    const from = sub.status; const at = o.at || G.date.now();
    upd('subscriptions', sub, { status: to, status_reason: o.reason || null, status_changed_at: at });
    event(sub, 'STATUS_CHANGED', { from, to, reason: o.reason, actor: o.actor || 'SYSTEM', at });
    if (to === 'CANCELLED') upd('subscriptions', sub, { cancelled_at: at, data_retention_until: G.date.add(dOf(at), P('sus_data_retention_days') || 90) });
    const t = S.tenantRow(sub.tenant); if (t) upd('tenants', t, { status: to });
    S.applyModules(sub.tenant);
    G.events.emit('subscription.status_changed', { subscription_id: sub.id, tenant: sub.tenant, from, to });
    return sub;
  };
  S.subscribe = function (d) {
    const plan = S.plan(d.plan_id);
    if (!plan || plan.status !== 'PUBLISHED') G.fail('RN-SUS-05', `El plan ${plan ? plan.name + ' v' + plan.version : ''} no está publicado: no se puede contratar (D-SUS-01).`);
    if (d.product_id && d.product_id !== plan.product_id) G.fail('RN-SUS-05', 'El plan no pertenece al producto elegido.');
    const ten = d.tenant;
    if (S.liveSubs(ten).some(s => s.product_id === plan.product_id)) G.fail('RN-SUS-03', `${S.tenantName(ten)} ya tiene una suscripción viva de ${(getRaw('saas_products', plan.product_id) || {}).name}.`);
    const docType = d.billing_doc_type || 'RUC';
    if (docType === 'RUC' && !U.rucOk(d.billing_doc_number)) G.fail('RN-SUS-19', `El RUC ${d.billing_doc_number || ''} no es válido.`);
    if (docType === 'DNI' && !/^\d{8}$/.test(String(d.billing_doc_number || ''))) G.fail('RN-SUS-19', 'El DNI debe tener 8 dígitos.');
    const date = d.date || today(); const trial = d.trial !== false && (plan.trial_days || P('sus_trial_days_default')) > 0;
    if (trial && docType === 'RUC') {
      if (glob('trial_registry').some(t => t.ruc === d.billing_doc_number && t.product_id === plan.product_id)) G.fail('RN-SUS-15', `El RUC ${d.billing_doc_number} ya usó su prueba gratuita de este producto: contrata sin prueba.`);
      insG('trial_registry', { ruc: d.billing_doc_number, product_id: plan.product_id, first_tenant_id: ten, started_at: date + 'T09:00' });
    }
    if (!S.tenantRow(ten)) insG('tenants', { id: ten, name: d.billing_name, short: d.short || d.billing_name, plan: plan.code, status: trial ? 'TRIAL' : 'ACTIVE', hostname: (d.short || ten).toLowerCase().replace(/[^a-z0-9]/g, '') + '.aycha.pe' });
    const days = plan.trial_days || P('sus_trial_days_default') || 14;
    const sub = insT('subscriptions', { product_id: plan.product_id, plan_id: plan.id, billing_company_id: null, billing_doc_type: docType, billing_doc_number: d.billing_doc_number, billing_name: d.billing_name, billing_email: d.billing_email || 'facturacion@' + ten.toLowerCase() + '.pe', status: trial ? 'TRIAL' : 'ACTIVE', status_changed_at: date + 'T09:00', trial_ends_at: trial ? G.date.add(date, days) : null, trial_days_total: trial ? days : 0, current_period_start: trial ? null : date, current_period_end: trial ? null : periodEnd(date), billing_period: plan.billing_period, agreed_price: plan.price, discount_pct: 0, gateway: P('sus_gateway') || 'FAKE', gateway_customer_ref: null, payment_token_ref: null, auto_pay: P('sus_auto_pay') !== false, cancel_at_period_end: false, created_at: date + 'T09:00' }, ten);
    event(sub, 'CREATED', { to: sub.status, to_plan: plan.id, actor: d.actor || 'TENANT_USER', reason: trial ? `Prueba gratuita de ${days} días` : 'Alta con cobro', at: date + 'T09:00' });
    const t = S.tenantRow(ten); if (t) upd('tenants', t, { status: sub.status, plan: plan.code });
    S.applyModules(ten);
    if (!trial) S.issueInvoice(sub, { period_start: date, period_end: sub.current_period_end, date, lines: S.periodLines(sub) });
    G.events.emit('subscription.created', { subscription_id: sub.id, tenant: ten, plan: plan.code, status: sub.status });
    return sub;
  };
  S.extendTrial = function (sub, days, reason) {
    if (sub.status !== 'TRIAL') G.fail('RN-SUS-15', 'Solo se extiende una suscripción en prueba.');
    if (!reason) G.fail('RN-SUS-15', 'Extender la prueba exige motivo.');
    const total = (sub.trial_days_total || P('sus_trial_days_default')) + Number(days);
    if (total > (P('sus_trial_max_days') || 30)) G.fail('RN-SUS-15', `La prueba llegaría a ${total} días y el máximo es ${P('sus_trial_max_days')} contando extensiones.`);
    upd('subscriptions', sub, { trial_ends_at: G.date.add(dOf(sub.trial_ends_at), Number(days)), trial_days_total: total });
    event(sub, 'TRIAL_EXTENDED', { reason, actor: 'PLATFORM_USER', detail: { days: Number(days) } });
    return sub;
  };

  /* ------------------------------------------------------------------
     Comprobantes del SaaS (RN-SUS-11, 12, 19)
     ------------------------------------------------------------------ */
  S.periodLines = function (sub, planId) {
    const plan = S.plan(planId || sub.plan_id); const out = [];
    if (!plan) return out; // suscripción sin plan de SUS (respaldo de otro módulo): no se factura hasta enlazarla
    out.push({ concept: 'PLAN', plan_id: plan.id, description: `Plan ${plan.name} v${plan.version} · mensual`, qty: 1, unit_price: sub.agreed_price ?? plan.price ?? 0 });
    if (sub.discount_pct) out.push({ concept: 'DISCOUNT', description: `Descuento pactado ${sub.discount_pct} %`, qty: 1, unit_price: -R((sub.agreed_price ?? plan.price) * sub.discount_pct / 100) });
    for (const a of S.addonsOf(sub)) { const ad = S.addon(a.addon_id); if (ad) out.push({ concept: 'ADDON', addon_id: ad.id, description: ad.name, qty: a.qty, unit_price: a.agreed_price ?? ad.price ?? 0 }); }
    return out;
  };
  S.issueInvoice = function (sub, o) {
    const issuer = P('sus_issuer_ruc');
    if (!issuer) G.fail('RN-SUS-19', 'Falta el RUC emisor de Intelectalab (sus_issuer_ruc, D-SUS-06): la corrida de cobro no emite comprobantes.');
    const type = o.doc_type || (sub.billing_doc_type === 'RUC' ? 'INVOICE' : 'RECEIPT');
    const ser = glob('platform_document_series').find(x => x.doc_type === type && x.status === 'ACTIVE' && x.issuer_ruc === issuer);
    if (!ser) G.fail('RN-SUS-12', `No hay serie de plataforma activa de ${type === 'INVOICE' ? 'factura' : type === 'RECEIPT' ? 'boleta' : 'nota de crédito'} para el RUC ${issuer}.`);
    const rate = igv(); const date = o.date || today();
    const ls = o.lines.map(l => { const sb = R(Number(l.qty) * Number(l.unit_price)); const ig = R(sb * rate); return Object.assign({}, l, { subtotal: sb, igv: ig, total: R(sb + ig) }); });
    if (ls.some(l => !(Number(l.qty) > 0))) G.fail('RN-SUS-11', 'Cada línea debe tener cantidad mayor que cero.');
    const tot = { subtotal: R(U.sum(ls, l => l.subtotal)), igv: R(U.sum(ls, l => l.igv)), total: R(U.sum(ls, l => l.total)) };
    if (Math.abs(tot.subtotal + tot.igv - tot.total) > 0.011) G.fail('RN-SUS-11', 'Las líneas no cuadran con la cabecera.');
    const number = ser.next_number; ser.next_number += 1;
    const inv = insT('saas_invoices', { subscription_id: sub.id, period_start: o.period_start || date, period_end: o.period_end || date, issuer_ruc: issuer, doc_type: type, platform_series_id: ser.id, series: ser.series, number, full_number: `${ser.series}-${U.pad(number, 8)}`, related_invoice_id: o.related_invoice_id || null, customer_doc_number: sub.billing_doc_number, customer_name: sub.billing_name, currency: 'PEN', subtotal: tot.subtotal, igv: tot.igv, total: tot.total, due_date: G.date.add(date, P('sus_invoice_due_days') || 5), status: type === 'CREDIT_NOTE' ? 'PAID' : 'OPEN', einvoice_status: 'ACCEPTED', issued_at: date + 'T08:00', paid_at: null, note: o.note || null, created_at: date + 'T08:00' }, sub.tenant);
    for (const l of ls) insT('saas_invoice_lines', { invoice_id: inv.id, concept: l.concept, plan_id: l.plan_id || null, addon_id: l.addon_id || null, description: l.description, qty: l.qty, unit_price: l.unit_price, subtotal: l.subtotal, igv: l.igv, total: l.total }, sub.tenant);
    G.events.emit('saas_invoice.issued', { invoice_id: inv.id, tenant: sub.tenant, full_number: inv.full_number, total: inv.total });
    return inv;
  };
  /** emitido no cambia importes, cliente, período ni número (RN-SUS-11) */
  S.updateInvoice = function (inv, patch) {
    const locked = ['subtotal', 'igv', 'total', 'customer_doc_number', 'customer_name', 'period_start', 'period_end', 'number', 'series'];
    if (inv.status !== 'DRAFT' && Object.keys(patch).some(k => locked.includes(k))) G.fail('RN-SUS-11', `El comprobante ${inv.full_number} ya fue emitido: no cambia importes, cliente, período ni número. Corrígelo con una nota de crédito.`);
    return upd('saas_invoices', inv, patch);
  };
  S.creditNote = function (inv, reason) {
    if (!reason) G.fail('RN-SUS-11', 'La nota de crédito exige motivo.');
    if (inv.doc_type === 'CREDIT_NOTE' || inv.status === 'VOIDED') G.fail('RN-SUS-11', 'Ese comprobante no admite nota de crédito.');
    const sub = getRaw('subscriptions', inv.subscription_id);
    const nc = S.issueInvoice(sub, { doc_type: 'CREDIT_NOTE', related_invoice_id: inv.id, period_start: inv.period_start, period_end: inv.period_end, lines: linesOf(inv).map(l => ({ concept: l.concept, plan_id: l.plan_id, addon_id: l.addon_id, description: 'Anula: ' + l.description, qty: l.qty, unit_price: l.unit_price })), note: reason });
    if (inv.status === 'OPEN') upd('saas_invoices', inv, { status: 'VOIDED', void_reason: reason });
    return nc;
  };

  /* ------------------------------------------------------------------
     Pasarela (adaptador PaymentGateway · FAKE) y webhook firmado (RN-SUS-13/14/20)
     ------------------------------------------------------------------ */
  let gwSeq = 0;
  const sign = ref => 'sha256=' + (function (s) { let x = 2166136261; for (const ch of 'intelectalab-webhook:' + s) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; } return x.toString(16); })(ref);
  S.gateway = {
    name: () => P('sus_gateway') || 'FAKE',
    /** tokeniza la tarjeta en la pasarela: devuelve solo token, marca y 4 últimos dígitos; el número nunca se guarda (RN-SUS-20) */
    tokenize(cardNumber, exp) {
      const n = String(cardNumber || '').replace(/\D/g, '');
      if (n.length < 13 || n.length > 19) G.fail('RN-SUS-20', 'Número de tarjeta incompleto.');
      let s = 0; for (let i = 0; i < n.length; i++) { let d = Number(n[n.length - 1 - i]); if (i % 2) { d *= 2; if (d > 9) d -= 9; } s += d; } if (s % 10) G.fail('RN-SUS-20', 'La tarjeta no es válida (dígito de control).');
      if (!/^\d{2}\/\d{2}$/.test(exp || '')) G.fail('RN-SUS-20', 'Vencimiento en formato MM/AA.');
      const brand = n[0] === '4' ? 'VISA' : /^5[1-5]/.test(n) ? 'MASTERCARD' : /^3[47]/.test(n) ? 'AMEX' : 'TARJETA';
      return { token: 'tok_fake_' + (n.endsWith('0002') ? 'fail_' : '') + U.token(10), brand, last4: n.slice(-4), exp };
    },
    charge({ token, amount, force }) {
      gwSeq++; const ref = 'fake_ch_' + Date.now().toString(36).slice(-5) + gwSeq;
      const ok = force ? force === 'APPROVED' : !/fail/.test(token || '');
      return { gateway_ref: ref, result: ok ? 'APPROVED' : 'REJECTED', failure_code: ok ? null : (/0119|fail/.test(token || '') ? 'insufficient_funds' : 'card_declined'), amount };
    },
  };
  S.sign = sign;
  /** intento de cobro: queda PENDING hasta que llega el webhook (nunca por la redirección del navegador) */
  S.charge = function (inv, o = {}) {
    if (inv.status !== 'OPEN') G.fail('RN-SUS-14', `El comprobante ${inv.full_number} está ${lbl(INV_ST, inv.status).toLowerCase()}: no se cobra.`);
    const sub = getRaw('subscriptions', inv.subscription_id);
    if (!sub.payment_token_ref && !o.manual) G.fail('RN-SUS-20', 'No hay tarjeta registrada: registra el medio de pago en SUS-06.');
    const prev = attemptsOf(inv);
    const paid = U.sum(prev.filter(a => a.status === 'APPROVED'), a => a.amount);
    const amount = R(inv.total - paid);
    const g = S.gateway.charge({ token: sub.payment_token_ref, amount, force: o.force });
    const att = insT('saas_payment_attempts', { invoice_id: inv.id, gateway: o.manual ? 'MANUAL' : (sub.gateway || 'FAKE'), attempt_no: (prev.length ? Math.max(...prev.map(a => a.attempt_no)) : 0) + 1, amount, status: 'PENDING', gateway_ref: g.gateway_ref, failure_code: null, attempted_at: (o.date ? o.date + 'T09:00' : G.date.now()), confirmed_at: null, raw_event_id: null, reconciled: false, trigger: o.trigger || 'MANUAL' }, inv.tenant);
    const webhook = { id: 'evt_' + g.gateway_ref, type: g.result === 'APPROVED' ? 'payment.approved' : 'payment.rejected', gateway_ref: g.gateway_ref, status: g.result, amount, failure_code: g.failure_code, invoice_ref: inv.full_number, created: att.attempted_at };
    webhook.signature = sign(webhook.gateway_ref + ':' + webhook.status);
    return { attempt: att, webhook };
  };
  /** webhook de la pasarela (INT): firma, idempotencia por referencia y efecto en comprobante y suscripción */
  S.webhook = function (evt, o = {}) {
    if (!evt || evt.signature !== sign(evt.gateway_ref + ':' + evt.status)) G.fail('RN-SUS-20', 'Webhook con firma inválida: se descarta.');
    const log = insG('webhook_events', { source: 'PAYMENT_GATEWAY', provider: S.gateway.name(), event_type: evt.type, external_id: evt.gateway_ref, payload: evt, signature_ok: true, received_at: o.at || G.date.now(), status: 'PROCESSED' });
    const att = G.db.raw('saas_payment_attempts').find(a => a.gateway_ref === evt.gateway_ref);
    if (!att) { log.status = 'IGNORED'; return { ignored: true }; }
    if (att.status !== 'PENDING') { log.status = 'DUPLICATE'; G.db.touch(); return { duplicate: true, attempt: att }; } // RN-SUS-13
    const inv = getRaw('saas_invoices', att.invoice_id); const sub = getRaw('subscriptions', inv.subscription_id);
    const at = o.at || G.date.now();
    Object.assign(att, { status: evt.status, confirmed_at: at, failure_code: evt.failure_code || null, raw_event_id: log.id }); G.db.touch();
    if (evt.status === 'APPROVED') {
      const paid = U.sum(attemptsOf(inv).filter(a => a.status === 'APPROVED'), a => a.amount);
      if (paid >= inv.total - 0.005) { upd('saas_invoices', inv, { status: 'PAID', paid_at: at }); G.events.emit('saas_invoice.paid', { invoice_id: inv.id, tenant: inv.tenant }); }
      event(sub, 'PAYMENT_CONFIRMED', { reason: `${inv.full_number} · ${F.money(att.amount)} · ${att.gateway_ref}`, at });
      const pending = S.invoicesOf(sub.tenant).filter(x => x.subscription_id === sub.id && x.status === 'OPEN' && x.due_date < dOf(at));
      if (['PAST_DUE', 'READ_ONLY', 'SUSPENDED'].includes(sub.status) && !pending.length) S.transition(sub, 'ACTIVE', { reason: 'Pago confirmado por webhook de la pasarela', at });
      if (sub.status === 'TRIAL' && inv.status === 'PAID') S.transition(sub, 'ACTIVE', { reason: 'Primer cobro aprobado', at });
    } else {
      event(sub, 'PAYMENT_FAILED', { reason: `${inv.full_number} · intento ${att.attempt_no} · ${att.failure_code || 'rechazado'}`, at });
      G.events.emit('saas_payment.failed', { invoice_id: inv.id, tenant: inv.tenant, code: att.failure_code });
      if (sub.status === 'ACTIVE' && inv.due_date <= dOf(at)) S.transition(sub, 'PAST_DUE', { reason: `Cobro rechazado (${att.failure_code || 'tarjeta'})`, at });
    }
    return { attempt: att, invoice: inv, subscription: sub };
  };
  S.pay = function (inv, o = {}) { const r = S.charge(inv, o); return Object.assign(S.webhook(r.webhook, o.date ? { at: o.date + 'T09:05' } : {}), { webhook: r.webhook }); };

  /* ------------------------------------------------------------------
     Mora y reintentos (RN-SUS-10, RN-SUS-15) · corrida mensual
     ------------------------------------------------------------------ */
  S.dunningInfo = function (sub, date = today()) {
    const open = S.invoicesOf(sub.tenant).filter(x => x.subscription_id === sub.id && x.status === 'OPEN' && x.doc_type !== 'CREDIT_NOTE').sort(U.by('due_date'));
    const oldest = open[0]; if (!oldest) return null;
    const days = Math.max(0, G.date.diff(date, oldest.due_date));
    const grace = P('sus_grace_days') || 7, ro = P('sus_read_only_days') || 15;
    const retries = (P('sus_payment_retry_days') || [1, 3, 5]).map(n => G.date.add(oldest.due_date, n));
    return { invoice: oldest, open, debt: R(U.sum(open, x => x.total - U.sum(attemptsOf(x).filter(a => a.status === 'APPROVED'), a => a.amount))), days, readOnlyOn: G.date.add(oldest.due_date, grace), suspendOn: G.date.add(oldest.due_date, grace + ro), nextRetry: retries.find(d => d > date) || null, retries };
  };
  S.runDunning = function (date = today()) {
    const log = [];
    const grace = P('sus_grace_days') || 7, ro = P('sus_read_only_days') || 15;
    for (const sub of G.db.raw('subscriptions').filter(s => s.status !== 'CANCELLED')) {
      const at = date + 'T06:00';
      if (sub.status === 'TRIAL' && sub.trial_ends_at && sub.trial_ends_at < date) {
        if (sub.payment_token_ref) { S.transition(sub, 'ACTIVE', { reason: 'Fin de la prueba con medio de pago', at }); upd('subscriptions', sub, { current_period_start: date, current_period_end: periodEnd(date) }); try { const inv = S.issueInvoice(sub, { date, period_start: date, period_end: sub.current_period_end, lines: S.periodLines(sub) }); if (sub.auto_pay !== false) S.pay(inv, { date, trigger: 'AUTO' }); } catch (e) { log.push(`${S.tenantName(sub.tenant)}: ${e.message}`); } log.push(`${S.tenantName(sub.tenant)}: fin de la prueba → activa`); }
        else { S.transition(sub, 'READ_ONLY', { reason: 'Fin de la prueba sin medio de pago (RN-SUS-15)', at }); log.push(`${S.tenantName(sub.tenant)}: fin de la prueba sin tarjeta → solo lectura`); }
        continue;
      }
      if (sub.grace_until && sub.grace_until >= date) { log.push(`${S.tenantName(sub.tenant)}: prórroga hasta ${F.date(sub.grace_until)}`); continue; }
      const info = S.dunningInfo(sub, date); if (!info || G.date.diff(date, info.invoice.due_date) < 0) continue;
      const days = info.days;
      if (info.retries.includes(date) && sub.payment_token_ref && !attemptsOf(info.invoice).some(a => dOf(a.attempted_at) === date)) { const r = S.pay(info.invoice, { date, trigger: 'RETRY' }); log.push(`${S.tenantName(sub.tenant)}: reintento ${info.invoice.full_number} → ${lbl(ATT_ST, r.attempt.status)}`); if (r.attempt.status === 'APPROVED') continue; }
      if (sub.status === 'ACTIVE' && days >= 1) { S.transition(sub, 'PAST_DUE', { reason: `${info.invoice.full_number} vencido hace ${days} días`, at }); log.push(`${S.tenantName(sub.tenant)}: en mora`); }
      if (sub.status === 'PAST_DUE' && days >= grace) { S.transition(sub, 'READ_ONLY', { reason: `${days} días de mora (gracia de ${grace} días)`, at }); log.push(`${S.tenantName(sub.tenant)}: solo lectura`); }
      if (sub.status === 'READ_ONLY' && days >= grace + ro) { S.transition(sub, 'SUSPENDED', { reason: `${days} días de mora (${ro} días en solo lectura)`, at }); log.push(`${S.tenantName(sub.tenant)}: suspendida`); }
    }
    return log;
  };
  S.grantExtension = function (sub, until, reason) {
    if (!reason) G.fail('RN-SUS-10', 'La prórroga exige motivo.');
    if (!until || until <= today()) G.fail('RN-SUS-10', 'La prórroga debe terminar después de hoy.');
    upd('subscriptions', sub, { grace_until: until, grace_reason: reason });
    event(sub, 'STATUS_CHANGED', { from: sub.status, to: sub.status, reason: `Prórroga hasta ${F.date(until)}: ${reason}`, actor: 'PLATFORM_USER' });
  };
  /** corrida mensual: renueva períodos vencidos, aplica cambios programados y emite (borradores = vista previa) */
  S.billingPreview = function (date) {
    const out = [];
    for (const sub of G.db.raw('subscriptions').filter(s => ['ACTIVE', 'PAST_DUE'].includes(s.status) && s.current_period_end && s.current_period_end < date)) {
      const start = G.date.add(sub.current_period_end, 1); const end = periodEnd(start);
      const planId = sub.scheduled_plan_id || sub.plan_id;
      if (!S.plan(planId)) continue;
      const lines = S.periodLines(Object.assign({}, sub, sub.scheduled_plan_id ? { agreed_price: S.plan(planId).price } : {}), planId);
      const sb = R(U.sum(lines, l => l.qty * l.unit_price));
      out.push({ sub, start, end, planId, lines, subtotal: sb, igv: R(sb * igv()), total: R(sb + R(sb * igv())) });
    }
    return out;
  };
  S.runBilling = function (date) {
    const prev = S.billingPreview(date); const res = [];
    for (const p of prev) {
      const sub = p.sub;
      if (sub.scheduled_plan_id) { const np = S.plan(sub.scheduled_plan_id); event(sub, 'PLAN_CHANGED', { from_plan: sub.plan_id, to_plan: np.id, reason: 'Cambio programado aplicado al inicio del período', at: date + 'T00:05' }); upd('subscriptions', sub, { plan_id: np.id, agreed_price: np.price, scheduled_plan_id: null }); S.applyModules(sub.tenant); }
      upd('subscriptions', sub, { current_period_start: p.start, current_period_end: p.end });
      event(sub, 'PERIOD_RENEWED', { reason: `${F.date(p.start)} al ${F.date(p.end)}`, at: date + 'T00:10' });
      const inv = S.issueInvoice(sub, { date, period_start: p.start, period_end: p.end, lines: S.periodLines(sub) });
      let pay = null; if (sub.auto_pay !== false && sub.payment_token_ref) pay = S.pay(inv, { date, trigger: 'AUTO' });
      res.push({ sub, inv, pay });
    }
    return res;
  };

  /* ------------------------------------------------------------------
     Cambio de plan (RN-SUS-18), complementos y cancelación (RN-SUS-17)
     ------------------------------------------------------------------ */
  /** límites duros del plan nuevo que el uso actual excede */
  S.fitCheck = function (sub, plan) {
    const out = [];
    for (const l of S.planLimits(plan.id)) {
      if (l.enforcement !== 'HARD' || l.limit_value == null) continue;
      const add = U.sum(S.addonsOf(sub).filter(a => (S.addon(a.addon_id) || {}).limit_key === l.limit_key), a => a.qty * S.addon(a.addon_id).limit_increment);
      const used = S.used(sub.tenant, l.limit_key); const lim = l.limit_value + add;
      if (used > lim) out.push({ key: l.limit_key, used, limit: lim, excess: used - lim });
    }
    return out;
  };
  S.proration = function (sub, plan, date) {
    const start = sub.current_period_start, end = sub.current_period_end; if (!start || !end) return { amount: 0, remaining: 0, days: 0 };
    const days = G.date.diff(end, start) + 1; const remaining = Math.max(0, G.date.diff(end, date) + 1);
    const oldP = sub.agreed_price ?? (S.plan(sub.plan_id) || {}).price ?? 0;
    return { amount: R(((plan.price || 0) - oldP) * remaining / days), remaining, days, oldP, newP: plan.price };
  };
  S.changePlan = function (sub, plan_id, o = {}) {
    const np = S.plan(plan_id); const op = S.plan(sub.plan_id); const date = o.date || today();
    if (!np || np.status !== 'PUBLISHED') G.fail('RN-SUS-05', 'El plan elegido no está publicado.');
    if (np.product_id !== sub.product_id) G.fail('RN-SUS-05', 'Una suscripción no cambia de producto.');
    if (np.id === sub.plan_id) G.fail('RN-SUS-18', 'Ya estás en ese plan.');
    if (['READ_ONLY', 'SUSPENDED', 'CANCELLED'].includes(sub.status)) G.fail('RN-SUS-07', 'Paga la deuda antes de cambiar de plan.');
    const up = (np.price || 0) > ((sub.agreed_price ?? op.price) || 0);
    const fit = S.fitCheck(sub, np);
    if (fit.length) G.fail('RN-SUS-18', `El plan ${np.name} no alcanza para tu uso actual: ` + fit.map(f => `permite ${F.num(f.limit)} ${unit(f.key, f.limit)} y tienes ${F.num(f.used)}, excede en ${F.num(f.excess)} ${unit(f.key, f.excess)}`).join('; ') + '. Reduce el uso o contrata complementos (SUS-03).', { fit });
    if (sub.status === 'TRIAL' || up) {
      const pr = sub.status === 'TRIAL' ? { amount: 0 } : S.proration(sub, np, date);
      event(sub, 'PLAN_CHANGED', { from_plan: op.id, to_plan: np.id, reason: up ? `Sube de plan · prorrateo ${F.money(pr.amount)} (${pr.remaining} de ${pr.days} días)` : 'Cambio durante la prueba', actor: o.actor || 'TENANT_USER', at: date + 'T10:00', detail: pr });
      upd('subscriptions', sub, { plan_id: np.id, agreed_price: np.price, scheduled_plan_id: null });
      const t = S.tenantRow(sub.tenant); if (t) upd('tenants', t, { plan: np.code });
      S.applyModules(sub.tenant);
      let inv = null; if (pr.amount > 0) inv = S.issueInvoice(sub, { date, period_start: date, period_end: sub.current_period_end, lines: [{ concept: 'PRORATION', plan_id: np.id, description: `Prorrateo ${op.name} → ${np.name}: (${F.money(np.price)} − ${F.money(pr.oldP)}) × ${pr.remaining}/${pr.days} días`, qty: 1, unit_price: pr.amount }] });
      G.events.emit('subscription.plan_changed', { subscription_id: sub.id, tenant: sub.tenant, from: op.code, to: np.code, immediate: true });
      return { immediate: true, proration: pr, invoice: inv };
    }
    upd('subscriptions', sub, { scheduled_plan_id: np.id, scheduled_reason: 'Baja de plan al fin del período' });
    event(sub, 'PLAN_CHANGED', { from_plan: op.id, to_plan: np.id, reason: `Baja de plan programada para el ${F.date(G.date.add(sub.current_period_end, 1))}`, actor: o.actor || 'TENANT_USER', detail: { scheduled: true } });
    G.events.emit('subscription.plan_changed', { subscription_id: sub.id, tenant: sub.tenant, from: op.code, to: np.code, immediate: false });
    return { immediate: false, effective: G.date.add(sub.current_period_end, 1) };
  };
  S.addAddon = function (sub, addon_id, qty = 1, o = {}) {
    const ad = S.addon(addon_id); qty = Math.floor(Number(qty));
    if (!ad || ad.status !== 'PUBLISHED' || ad.price == null) G.fail('RN-SUS-01', 'El complemento no está publicado con precio.');
    if (ad.product_id && ad.product_id !== sub.product_id) G.fail('RN-SUS-05', 'El complemento es de otro producto.');
    if (!(qty > 0)) G.fail('RN-SUS-06', 'La cantidad debe ser mayor que cero.');
    if (['READ_ONLY', 'SUSPENDED', 'CANCELLED'].includes(sub.status)) G.fail('RN-SUS-07', 'Paga la deuda antes de contratar complementos.');
    if (ad.module_code) {
      if (S.entitled(sub).has(ad.module_code)) G.fail('RN-SUS-09', `${modName(ad.module_code)} ya está incluido en tu plan.`);
      const miss = S.deps(ad.module_code).filter(d => !S.entitled(sub).has(d)); if (miss.length) G.fail('RN-SUS-01', `${ad.module_code} exige ${miss.join(', ')}, que no está en tu plan.`);
    }
    const ex = S.addonsOf(sub).find(a => a.addon_id === ad.id);
    let row;
    if (ex && !ad.module_code) row = upd('subscription_addons', ex, { qty: ex.qty + qty });
    else if (ex) G.fail('RN-SUS-09', 'Ese complemento ya está contratado.');
    else row = insT('subscription_addons', { subscription_id: sub.id, addon_id: ad.id, qty, agreed_price: ad.price, starts_on: o.date || today(), ends_on: null, status: 'ACTIVE' }, sub.tenant);
    event(sub, 'ADDON_ADDED', { reason: `${ad.name} × ${qty}`, actor: o.actor || 'TENANT_USER', detail: { addon: ad.code, qty } });
    S.applyModules(sub.tenant);
    G.events.emit('subscription.addon_changed', { subscription_id: sub.id, tenant: sub.tenant, addon: ad.code, qty });
    return row;
  };
  S.removeAddon = function (sa, o = {}) {
    const sub = getRaw('subscriptions', sa.subscription_id); const ad = S.addon(sa.addon_id);
    if (ad.limit_key && LIMITS.find(x => x[0] === ad.limit_key)[2] === 'HARD') { const l = S.limit(sub.tenant, ad.limit_key); const used = S.used(sub.tenant, ad.limit_key); const after = l.value - ad.limit_increment * sa.qty; if (used > after) G.fail('RN-SUS-06', `Sin el complemento el límite baja a ${F.num(after)} ${unit(ad.limit_key, after)} y usas ${F.num(used)}: reduce el uso antes de quitarlo.`); }
    upd('subscription_addons', sa, { status: 'ENDED', ends_on: o.date || today() });
    event(sub, 'ADDON_ENDED', { reason: `${ad.name} × ${sa.qty}`, actor: o.actor || 'TENANT_USER' });
    S.applyModules(sub.tenant);
    G.events.emit('subscription.addon_changed', { subscription_id: sub.id, tenant: sub.tenant, addon: ad.code, qty: 0 });
  };
  S.cancel = function (sub, o = {}) {
    if (!o.reason) G.fail('RN-SUS-17', 'Indica el motivo de la cancelación.');
    if (sub.status === 'CANCELLED') G.fail('RN-SUS-04', 'La suscripción ya está cancelada.');
    if (o.immediate || sub.status === 'TRIAL' || !sub.current_period_end) { S.transition(sub, 'CANCELLED', { reason: o.reason, actor: o.actor || 'TENANT_USER' }); upd('subscriptions', sub, { cancel_survey: o.survey || null }); return { effective: today() }; }
    upd('subscriptions', sub, { cancel_at_period_end: true, cancel_reason: o.reason, cancel_survey: o.survey || null });
    event(sub, 'STATUS_CHANGED', { from: sub.status, to: sub.status, reason: `Cancelación programada al ${F.date(sub.current_period_end)}: ${o.reason}`, actor: o.actor || 'TENANT_USER' });
    return { effective: sub.current_period_end, retention: G.date.add(sub.current_period_end, P('sus_data_retention_days') || 90) };
  };
  S.setPaymentMethod = function (sub, card, o = {}) {
    const tok = card.token ? card : S.gateway.tokenize(card.number, card.exp);
    upd('subscriptions', sub, { payment_token_ref: tok.token, gateway_customer_ref: sub.gateway_customer_ref || 'cus_fake_' + sub.tenant.toLowerCase(), card_brand: tok.brand, card_last4: tok.last4, card_exp: tok.exp, billing_email: o.billing_email || sub.billing_email, auto_pay: o.auto_pay ?? sub.auto_pay });
    return sub;
  };

  /* ------------------------------------------------------------------
     Guardas sobre operaciones de otros módulos (disparadores de la spec)
     ------------------------------------------------------------------ */
  const GUARD_LIMIT = { brands: 'BRANDS', establishments: 'ESTABLISHMENTS', companies: 'COMPANIES', users: 'USERS', messaging_channels: 'WHATSAPP_NUMBERS' };
  const GUARD_WRITE = new Set(['sales_orders', 'brands', 'establishments', 'companies', 'messaging_channels']);
  const countsFor = (t, row) => t === 'users' ? (row.status || 'ACTIVE') === 'ACTIVE' && !['CLIENTE_B2B', 'SOPORTE_PLATAFORMA'].includes(row.role) && !row.platform && !row.support : t === 'messaging_channels' ? row.kind === 'WHATSAPP' : t === 'brands' ? (row.status || 'ACTIVE') === 'ACTIVE' : true;
  const origInsert = G.db.insert;
  G.db.insert = function (name, row, opts = {}) {
    if (!G._seeding && (GUARD_WRITE.has(name) || GUARD_LIMIT[name])) {
      const ten = row && row.tenant !== undefined ? row.tenant : (opts.global ? null : G.ctx.tenant);
      if (ten && S.subsOf(ten).length) {
        if (GUARD_WRITE.has(name)) S.assertWritable(ten);
        const key = GUARD_LIMIT[name]; if (key && countsFor(name, row)) S.assertLimit(ten, key, S.used(ten, key), 1);
      }
    }
    return origInsert.call(this, name, row, opts);
  };
  const wrap = (obj, fn) => { const o = obj[fn]; obj[fn] = function () { if (!G._seeding) S.assertWritable(G.ctx.tenant); return o.apply(this, arguments); }; };
  wrap(G.orders, 'create'); wrap(G.docs, 'issue'); wrap(G.pay, 'register'); wrap(G.inv, 'move');
  const origSetModule = G.setModule;
  G.setModule = function (code, enabled, reason) {
    const ten = G.ctx.tenant; const sub = S.subFor(ten);
    if (sub && sub.status !== 'CANCELLED' && enabled && S.productModules(sub.product_id).some(m => m.module_code === code) && !S.entitled(sub).has(code)) G.fail('RN-SUS-09', `${code} · ${modName(code)} no está en tu plan ${S.planName(sub.plan_id)} ni en un complemento contratado. Contrátalo en SUS-03 o sube de plan en SUS-02.`);
    const r = origSetModule.apply(this, arguments);
    if (sub) { const row = rawT('tenant_modules', ten).find(m => m.module_code === code); if (row) Object.assign(row, { sus_source: enabled ? (S.entitled(sub).get(code) || 'MANUAL') : 'MANUAL', sus_subscription_id: sub.id }); }
    return r;
  };
  // el pedido cuenta al salir de borrador (RN-SUS-16)
  G.events.on('order.confirmed', p => { if (p && p.from === 'DRAFT' && S.liveSubs(G.ctx.tenant).length) S.recordUsage(G.ctx.tenant, 'ORDERS_MONTH', 1); });

  /* ------------------------------------------------------------------
     Indicadores del tenant (KPI-SUS-01 a 03)
     ------------------------------------------------------------------ */
  G.kpiCalc['KPI-SUS-01'] = () => { const u = S.usage(G.ctx.tenant).filter(x => x.pct != null).sort((a, b) => b.pct - a.pct)[0]; return u ? { value: u.pct, numerator: u.used, denominator: u.limit, detail: u.name } : { value: 0, numerator: 0, denominator: null, detail: 'Piloto sin límites (RN-SUS-21)' }; };
  G.kpiCalc['KPI-SUS-02'] = p => { const inv = S.invoicesOf(G.ctx.tenant).filter(x => x.doc_type !== 'CREDIT_NOTE' && x.status !== 'VOIDED' && dOf(x.issued_at) >= (p.from || '0000') && dOf(x.issued_at) <= (p.to || '9999')); const sb = U.sum(inv, x => x.subtotal); const n = G.sales.orders({ from: p.from, to: p.to }).length; return { value: n ? R(sb / n, 4) : 0, numerator: R(sb), denominator: n }; };
  G.kpiCalc['KPI-SUS-03'] = () => { const sub = S.subFor(G.ctx.tenant); const d = sub && S.dunningInfo(sub); return d ? d.days : 0; };

  /* ------------------------------------------------------------------
     Semilla (orden 80): catálogo global, suscripciones y facturación
     ------------------------------------------------------------------ */
  /* Suscripciones que otro módulo creó de respaldo (OPS: plan_id nulo y solo plan_code): se enlazan al plan publicado de SUS.
     Códigos de OPS → SUS: INICIAL→INICIA, MULTIMARCA→ESCALA (los demás coinciden). */
  const PLAN_ALIAS = { INICIAL: 'INICIA', MULTIMARCA: 'ESCALA' };
  S.linkOrphanSubs = function () {
    let n = 0;
    for (const sub of G.db.raw('subscriptions')) {
      if (sub.plan_id && S.plan(sub.plan_id)) continue;
      const pl = S.planByCode(PLAN_ALIAS[sub.plan_code] || sub.plan_code); if (!pl) continue;
      Object.assign(sub, { plan_id: pl.id, product_id: pl.product_id, agreed_price: sub.agreed_price ?? pl.price, discount_pct: sub.discount_pct || 0 });
      n++;
    }
    return n;
  };
  G.seed(89, function seedSUSlink() { S.linkOrphanSubs(); }, 'SUS enlaza suscripciones de respaldo');
  G.seed(80, function seedSUS() {
    const prodC = insG('saas_products', { id: 'sp-COMERCIAL', code: 'COMERCIAL', name: 'Aycha Comercial', description: 'Ventas multicanal, WhatsApp, reparto, almacén, facturación y producción para comercializadoras de cárnicos', status: 'ACTIVE' });
    const prodG = insG('saas_products', { id: 'sp-GRANJA', code: 'GRANJA', name: 'Aycha Granja', description: 'Gestión de granjas de cuyes, conejos y aves (se une al catálogo con el kit de la granja, D-SUS-10)', status: 'ACTIVE' });
    insG('saas_products', { id: 'sp-GOURMET', code: 'GOURMET', name: 'Aycha Marcas gourmet', description: 'Producto para marcas de café, mermeladas y frutos secos', status: 'PLANNED' });
    const CORE = ['PLT', 'SEG', 'MAE', 'INT', 'AUD', 'CAT', 'CLI', 'PED', 'CRM', 'ALM', 'PRE', 'DEL', 'FAC', 'CAJ', 'TAB'];
    const prodMods = Object.keys(G.SPEC).filter(c => !PLATFORM_MODS.includes(c));
    for (const c of prodMods) insG('saas_product_modules', { id: 'spm-C-' + c, product_id: prodC.id, module_code: c, is_core: CORE.includes(c) });
    for (const c of ['PLT', 'SEG', 'MAE', 'INT', 'AUD']) insG('saas_product_modules', { id: 'spm-G-' + c, product_id: prodG.id, module_code: c, is_core: true });
    const ALL_EXTRA = prodMods.filter(c => !CORE.includes(c));
    const PLANS = [
      ['PILOTO', 'Piloto', 0, 0, false, ALL_EXTRA, null, 'Empresas piloto de Intelectalab: sin cobro ni límites (RN-SUS-21, D-SUS-08)'],
      ['INICIA', 'Inicia', 290, 14, true, ['POS', 'GAS'], [5, 1, 1, 1, 300, 1, 0, 0, 5], 'Una marca y un local: pedidos por WhatsApp, reparto y facturación'],
      ['CRECER', 'Crecer', 690, 14, true, ['POS', 'WEB', 'ADS', 'GAS', 'CMP', 'PRO', 'DES', 'REC', 'CAL', 'EQU', 'ETQ', 'COM'], [15, 1, 2, 3, 1500, 3, 0, 1000, 20], 'Hasta 3 marcas y 2 locales con web, anuncios, campañas y producción'],
      ['ESCALA', 'Escala', 1490, 14, true, ALL_EXTRA.filter(c => !['TEL', 'CNT', 'CON'].includes(c)), [40, 2, 5, 10, 5000, 8, 0, 10000, 50], 'Multimarca: hasta 10 marcas, 5 locales, B2B, flota, personal y API'],
    ];
    const KEYS = LIMITS.map(x => x[0]);
    for (const [code, name, price, trial, pub, mods, lims, desc] of PLANS) {
      const p = insG('saas_plans', { id: 'pl-' + code + '-1', product_id: prodC.id, code, version: 1, name, description: desc, billing_period: 'MONTHLY', price, currency: 'PEN', price_includes_igv: false, trial_days: trial, is_public: pub, status: 'PUBLISHED', published_at: '2026-05-02T10:00', price_note: code === 'PILOTO' ? null : 'Precio propuesto para la demo (D-SUS-01 por decidir)' });
      for (const m of mods) insG('saas_plan_modules', { id: `spl-${code}-1-${m}`, plan_id: p.id, module_code: m });
      if (lims) KEYS.forEach((k, i) => insG('saas_plan_limits', { id: `sll-${code}-1-${k}`, plan_id: p.id, limit_key: k, limit_value: lims[i], enforcement: (LIMITS[i] || [])[2] }));
    }
    // nueva versión en borrador de Crecer (RN-SUS-02) y un plan de Granja sin precio (D-SUS-01, D-SUS-10)
    const v2 = insG('saas_plans', { id: 'pl-CRECER-2', product_id: prodC.id, code: 'CRECER', version: 2, name: 'Crecer', description: 'Propuesta: 1 800 pedidos y TEL incluido', billing_period: 'MONTHLY', price: 790, currency: 'PEN', price_includes_igv: false, trial_days: 14, is_public: true, status: 'DRAFT' });
    for (const m of ['POS', 'WEB', 'ADS', 'GAS', 'CMP', 'PRO', 'DES', 'REC', 'CAL', 'EQU', 'ETQ', 'COM', 'TEL']) insG('saas_plan_modules', { id: `spl-CRECER-2-${m}`, plan_id: v2.id, module_code: m });
    KEYS.forEach((k, i) => insG('saas_plan_limits', { id: `sll-CRECER-2-${k}`, plan_id: v2.id, limit_key: k, limit_value: [15, 1, 2, 3, 1800, 3, 1000, 1000, 20][i], enforcement: LIMITS[i][2] }));
    insG('saas_plans', { id: 'pl-GRANJA_BASE-1', product_id: prodG.id, code: 'GRANJA_BASE', version: 1, name: 'Granja Base', description: 'Plan de la granja: precio por decidir (D-SUS-01)', billing_period: 'MONTHLY', price: null, currency: 'PEN', trial_days: 14, is_public: true, status: 'DRAFT' });
    insG('saas_plans', { id: 'pl-INICIA-0', product_id: prodC.id, code: 'INICIA', version: 0, name: 'Inicia', description: 'Versión de lanzamiento (retirada)', billing_period: 'MONTHLY', price: 250, currency: 'PEN', trial_days: 30, is_public: true, status: 'RETIRED', published_at: '2026-03-01T10:00', retired_at: '2026-05-02T10:00' });
    const ADDONS = [['TEL', 'Telefonía en la nube (TEL)', 'TEL', null, null, 'FLAT', 190], ['CNT', 'Contabilidad (CNT)', 'CNT', null, null, 'FLAT', 240], ['CON', 'Consignación (CON)', 'CON', null, null, 'FLAT', 120], ['WA_NUMBER', 'Número de WhatsApp adicional', null, 'WHATSAPP_NUMBERS', 1, 'PER_UNIT', 60], ['EXTRA_BRAND', 'Marca adicional', null, 'BRANDS', 1, 'PER_UNIT', 90], ['EXTRA_USERS', 'Paquete de 5 usuarios', null, 'USERS', 5, 'PER_UNIT', 75], ['EXTRA_SITE', 'Local adicional', null, 'ESTABLISHMENTS', 1, 'PER_UNIT', 80], ['ORDERS_500', 'Paquete de 500 pedidos al mes', null, 'ORDERS_MONTH', 500, 'PER_UNIT', 120], ['TEL_MIN_1000', 'Paquete de 1 000 minutos', null, 'TEL_MINUTES_MONTH', 1000, 'PER_UNIT', 150], ['API_10K', 'Paquete de 10 000 llamadas de API al día', null, 'API_CALLS_DAY', 10000, 'PER_UNIT', 90], ['STORAGE_20', '20 GB de almacenamiento', null, 'STORAGE_GB', 20, 'PER_UNIT', 35]];
    for (const [code, name, mod, key, inc, pricing, price] of ADDONS) insG('saas_addons', { id: 'ad-' + code, code, name, product_id: prodC.id, module_code: mod, limit_key: key, limit_increment: inc, pricing, price, currency: 'PEN', status: 'PUBLISHED' });
    insG('saas_addons', { id: 'ad-IA_ASSIST', code: 'IA_ASSIST', name: 'Asistente de respuestas con IA', product_id: prodC.id, module_code: null, limit_key: null, limit_increment: null, pricing: 'USAGE', price: null, currency: 'PEN', status: 'DRAFT' });
    // RUC emisor de Intelectalab (D-SUS-06) y series de plataforma
    const issuer = U.rucCheck('2060874411');
    if (!G.db.raw('parameters').some(p => p.key === 'sus_issuer_ruc')) insG('parameters', { key: 'sus_issuer_ruc', scope: 'TENANT', scope_id: null, value: issuer, reason: 'D-SUS-06: RUC de demostración mientras Intelectalab confirma su RUC y su OSE', description: (G.PARAM_DEFS.sus_issuer_ruc || {}).desc, platform: true });
    for (const [t, s] of [['INVOICE', 'F001'], ['RECEIPT', 'B001'], ['CREDIT_NOTE', 'FC01']]) insG('platform_document_series', { id: 'pds-' + s, issuer_ruc: issuer, doc_type: t, series: s, next_number: 1, status: 'ACTIVE' });
    // empresas clientes del SaaS (además de Don Guando piloto y Carnes Selectas)
    const TEN = [['DCC', 'DISTRIBUIDORA CÁRNICA DEL CENTRO SAC', 'Cárnica del Centro', '2060338871', 'Huancayo'], ['CSS', 'CUYERÍA SABOR SERRANO EIRL', 'Sabor Serrano', '2060651204', 'Cusco'], ['EVS', 'EMBUTIDOS VALLE SUR SAC', 'Valle Sur', '2060497718', 'Tacna']];
    for (const [id, name, short] of TEN) if (!S.tenantRow(id)) insG('tenants', { id, name, short, plan: null, status: 'ACTIVE', hostname: short.toLowerCase().replace(/[^a-z]/g, '') + '.aycha.pe' });
    const mk = (ten, planCode, o) => {
      const pl = S.planByCode(planCode);
      const sub = insT('subscriptions', Object.assign({ id: 'sub-' + ten, product_id: prodC.id, plan_id: pl.id, billing_company_id: null, billing_doc_type: 'RUC', billing_period: 'MONTHLY', agreed_price: pl.price, discount_pct: 0, gateway: 'FAKE', auto_pay: true, cancel_at_period_end: false, trial_days_total: 14 }, o), ten);
      const t = S.tenantRow(ten); if (t) Object.assign(t, { plan: pl.code, status: sub.status });
      return sub;
    };
    const ev = (sub, type, at, o = {}) => insT('subscription_events', { subscription_id: sub.id, event_type: type, from_status: o.from || null, to_status: o.to || null, from_plan_id: o.fp || null, to_plan_id: o.tp || null, reason: o.reason || null, actor_type: o.actor || 'SYSTEM', actor_id: null, actor_name: o.actor === 'TENANT_USER' ? o.who || 'Administrador del cliente' : o.actor === 'PLATFORM_USER' ? 'Soporte Intelectalab' : 'Sistema', occurred_at: at, detail: o.detail || {} }, sub.tenant);
    const inv = (sub, start, end, lines, payResults, issueAt) => {
      const date = issueAt || start;
      const ser = glob('platform_document_series').find(x => x.doc_type === 'INVOICE');
      const ls = lines.map(l => { const sb = R(l.qty * l.unit_price); const ig = R(sb * 0.18); return Object.assign({}, l, { subtotal: sb, igv: ig, total: R(sb + ig) }); });
      const tot = { subtotal: R(U.sum(ls, l => l.subtotal)), igv: R(U.sum(ls, l => l.igv)), total: R(U.sum(ls, l => l.total)) };
      const n = ser.next_number++;
      const iv = insT('saas_invoices', { id: `si-${sub.tenant}-${start}`, subscription_id: sub.id, period_start: start, period_end: end, issuer_ruc: issuer, doc_type: 'INVOICE', platform_series_id: ser.id, series: ser.series, number: n, full_number: `${ser.series}-${U.pad(n, 8)}`, customer_doc_number: sub.billing_doc_number, customer_name: sub.billing_name, currency: 'PEN', subtotal: tot.subtotal, igv: tot.igv, total: tot.total, due_date: G.date.add(date, 5), status: 'OPEN', einvoice_status: 'ACCEPTED', issued_at: date + 'T08:00', created_at: date + 'T08:00' }, sub.tenant);
      for (const l of ls) insT('saas_invoice_lines', { invoice_id: iv.id, concept: l.concept, plan_id: l.plan_id || null, addon_id: l.addon_id || null, description: l.description, qty: l.qty, unit_price: l.unit_price, subtotal: l.subtotal, igv: l.igv, total: l.total }, sub.tenant);
      (payResults || []).forEach(([d, res, code], i) => {
        const ref = `fake_ch_${sub.tenant.toLowerCase()}${start.replace(/-/g, '')}${i + 1}`;
        const wh = insG('webhook_events', { source: 'PAYMENT_GATEWAY', provider: 'FAKE', event_type: res === 'APPROVED' ? 'payment.approved' : 'payment.rejected', external_id: ref, payload: { id: 'evt_' + ref, type: res === 'APPROVED' ? 'payment.approved' : 'payment.rejected', gateway_ref: ref, status: res, amount: tot.total, failure_code: code || null, invoice_ref: iv.full_number, signature: sign(ref + ':' + res) }, signature_ok: true, received_at: d + 'T09:01', status: 'PROCESSED' });
        insT('saas_payment_attempts', { invoice_id: iv.id, gateway: 'FAKE', attempt_no: i + 1, amount: tot.total, status: res, gateway_ref: ref, failure_code: code || null, attempted_at: d + 'T09:00', confirmed_at: d + 'T09:01', raw_event_id: wh.id, reconciled: res === 'APPROVED' && d < '2026-10-06', trigger: i ? 'RETRY' : 'AUTO' }, sub.tenant);
        if (res === 'APPROVED') { iv.status = 'PAID'; iv.paid_at = d + 'T09:01'; ev(sub, 'PAYMENT_CONFIRMED', d + 'T09:01', { reason: `${iv.full_number} · ${F.money(tot.total)} · ${ref}` }); }
        else ev(sub, 'PAYMENT_FAILED', d + 'T09:01', { reason: `${iv.full_number} · intento ${i + 1} · ${code}` });
      });
      return iv;
    };
    const planLines = (sub, pl, addons) => [{ concept: 'PLAN', plan_id: pl.id, description: `Plan ${pl.name} v${pl.version} · mensual`, qty: 1, unit_price: pl.price }].concat(sub.discount_pct ? [{ concept: 'DISCOUNT', description: `Descuento pactado ${sub.discount_pct} %`, qty: 1, unit_price: -R(pl.price * sub.discount_pct / 100) }] : []).concat((addons || []).map(([code, q]) => ({ concept: 'ADDON', addon_id: 'ad-' + code, description: S.addon('ad-' + code).name, qty: q, unit_price: S.addon('ad-' + code).price })));
    // Carnes Selectas del Sur: Crecer activo desde el 20/09 tras 14 días de prueba
    const cs = mk('CS', 'CRECER', { billing_doc_number: (G.db.raw('companies').find(c => c.id === 'co-cs') || {}).ruc || U.rucCheck('2061023344'), billing_name: 'CARNES SELECTAS DEL SUR SAC', billing_email: 'administracion@carnesselectas.pe', status: 'ACTIVE', status_changed_at: '2026-09-20T09:00', trial_ends_at: '2026-09-20', current_period_start: '2026-09-20', current_period_end: '2026-10-19', gateway_customer_ref: 'cus_fake_cs', payment_token_ref: 'tok_fake_cs7781', card_brand: 'VISA', card_last4: '7781', card_exp: '08/28', created_at: '2026-09-06T10:00' });
    insG('trial_registry', { ruc: cs.billing_doc_number, product_id: prodC.id, first_tenant_id: 'CS', started_at: '2026-09-06T10:00' });
    ev(cs, 'CREATED', '2026-09-06T10:00', { to: 'TRIAL', tp: cs.plan_id, actor: 'TENANT_USER', who: 'Hernán Salas Pino', reason: 'Prueba gratuita de 14 días' });
    ev(cs, 'STATUS_CHANGED', '2026-09-20T09:00', { from: 'TRIAL', to: 'ACTIVE', reason: 'Fin de la prueba con medio de pago' });
    inv(cs, '2026-09-20', '2026-10-19', planLines(cs, S.plan(cs.plan_id)), [['2026-09-20', 'APPROVED']]);
    insT('subscription_addons', { subscription_id: cs.id, addon_id: 'ad-CON', qty: 1, agreed_price: 120, starts_on: '2026-10-01', status: 'ACTIVE' }, 'CS');
    ev(cs, 'ADDON_ADDED', '2026-10-01T11:30', { reason: 'Consignación (CON) × 1', actor: 'TENANT_USER', who: 'Hernán Salas Pino' });
    // Cárnica del Centro: Escala con 10 % pactado, TEL, minutos y 2 números extra
    const dcc = mk('DCC', 'ESCALA', { billing_doc_number: U.rucCheck('2060338871'), billing_name: 'DISTRIBUIDORA CÁRNICA DEL CENTRO SAC', billing_email: 'pagos@carnicadelcentro.pe', status: 'ACTIVE', status_changed_at: '2026-06-01T09:00', trial_ends_at: '2026-06-01', current_period_start: '2026-10-01', current_period_end: '2026-10-31', discount_pct: 10, gateway_customer_ref: 'cus_fake_dcc', payment_token_ref: 'tok_fake_dcc4410', card_brand: 'MASTERCARD', card_last4: '4410', card_exp: '11/27', created_at: '2026-05-18T15:00' });
    insG('trial_registry', { ruc: dcc.billing_doc_number, product_id: prodC.id, first_tenant_id: 'DCC', started_at: '2026-05-18T15:00' });
    ev(dcc, 'CREATED', '2026-05-18T15:00', { to: 'TRIAL', tp: dcc.plan_id, actor: 'TENANT_USER', reason: 'Prueba gratuita de 14 días' });
    ev(dcc, 'STATUS_CHANGED', '2026-06-01T09:00', { from: 'TRIAL', to: 'ACTIVE', reason: 'Fin de la prueba con medio de pago' });
    ev(dcc, 'STATUS_CHANGED', '2026-06-03T12:00', { from: 'ACTIVE', to: 'ACTIVE', reason: 'Descuento pactado de 10 % por contrato anual de permanencia', actor: 'PLATFORM_USER' });
    for (const [code, q, from] of [['TEL', 1, '2026-07-01'], ['TEL_MIN_1000', 1, '2026-07-01'], ['WA_NUMBER', 2, '2026-06-01']]) { insT('subscription_addons', { subscription_id: dcc.id, addon_id: 'ad-' + code, qty: q, agreed_price: S.addon('ad-' + code).price, starts_on: from, status: 'ACTIVE' }, 'DCC'); ev(dcc, 'ADDON_ADDED', from + 'T10:00', { reason: `${S.addon('ad-' + code).name} × ${q}`, actor: 'TENANT_USER' }); }
    for (const m of ['06', '07', '08', '09', '10']) { const st = `2026-${m}-01`; const adds = m === '06' ? [['WA_NUMBER', 2]] : [['TEL', 1], ['TEL_MIN_1000', 1], ['WA_NUMBER', 2]]; inv(dcc, st, periodEnd(st), planLines(dcc, S.plan(dcc.plan_id), adds), [[st, 'APPROVED']]); if (m !== '06') ev(dcc, 'PERIOD_RENEWED', st + 'T00:10', { reason: `${F.date(st)} al ${F.date(periodEnd(st))}` }); }
    // Sabor Serrano: Inicia en mora (cobros rechazados del 01/10)
    const css = mk('CSS', 'INICIA', { billing_doc_number: U.rucCheck('2060651204'), billing_name: 'CUYERÍA SABOR SERRANO EIRL', billing_email: 'saborserrano@correo.pe', status: 'PAST_DUE', status_changed_at: '2026-10-07T06:00', status_reason: 'F001 vencido: cobro rechazado', trial_ends_at: '2026-08-01', current_period_start: '2026-10-01', current_period_end: '2026-10-31', gateway_customer_ref: 'cus_fake_css', payment_token_ref: 'tok_fake_fail_0119', card_brand: 'VISA', card_last4: '0119', card_exp: '09/26', created_at: '2026-07-18T11:00' });
    insG('trial_registry', { ruc: css.billing_doc_number, product_id: prodC.id, first_tenant_id: 'CSS', started_at: '2026-07-18T11:00' });
    ev(css, 'CREATED', '2026-07-18T11:00', { to: 'TRIAL', tp: css.plan_id, actor: 'TENANT_USER', reason: 'Prueba gratuita de 14 días' });
    ev(css, 'STATUS_CHANGED', '2026-08-01T09:00', { from: 'TRIAL', to: 'ACTIVE', reason: 'Fin de la prueba con medio de pago' });
    inv(css, '2026-08-01', '2026-08-31', planLines(css, S.plan(css.plan_id)), [['2026-08-01', 'APPROVED']]);
    inv(css, '2026-09-01', '2026-09-30', planLines(css, S.plan(css.plan_id)), [['2026-09-01', 'APPROVED']]);
    inv(css, '2026-10-01', '2026-10-31', planLines(css, S.plan(css.plan_id)), [['2026-10-01', 'REJECTED', 'insufficient_funds'], ['2026-10-07', 'REJECTED', 'insufficient_funds'], ['2026-10-09', 'REJECTED', 'expired_card']]);
    ev(css, 'STATUS_CHANGED', '2026-10-07T06:00', { from: 'ACTIVE', to: 'PAST_DUE', reason: 'F001 vencido hace 1 día: cobro rechazado' });
    // Valle Sur: Crecer en solo lectura por 20 días de mora
    const evs = mk('EVS', 'CRECER', { billing_doc_number: U.rucCheck('2060497718'), billing_name: 'EMBUTIDOS VALLE SUR SAC', billing_email: 'gerencia@vallesur.pe', status: 'READ_ONLY', status_changed_at: '2026-09-27T06:00', status_reason: '7 días de mora (gracia de 7 días)', trial_ends_at: '2026-07-15', current_period_start: '2026-09-15', current_period_end: '2026-10-14', gateway_customer_ref: 'cus_fake_evs', payment_token_ref: 'tok_fake_fail_8823', card_brand: 'VISA', card_last4: '8823', card_exp: '07/26', created_at: '2026-07-01T16:00' });
    insG('trial_registry', { ruc: evs.billing_doc_number, product_id: prodC.id, first_tenant_id: 'EVS', started_at: '2026-07-01T16:00' });
    ev(evs, 'CREATED', '2026-07-01T16:00', { to: 'TRIAL', tp: evs.plan_id, actor: 'TENANT_USER', reason: 'Prueba gratuita de 14 días' });
    ev(evs, 'STATUS_CHANGED', '2026-07-15T09:00', { from: 'TRIAL', to: 'ACTIVE', reason: 'Fin de la prueba con medio de pago' });
    inv(evs, '2026-07-15', '2026-08-14', planLines(evs, S.plan(evs.plan_id)), [['2026-07-15', 'APPROVED']]);
    inv(evs, '2026-08-15', '2026-09-14', planLines(evs, S.plan(evs.plan_id)), [['2026-08-15', 'APPROVED']]);
    inv(evs, '2026-09-15', '2026-10-14', planLines(evs, S.plan(evs.plan_id)), [['2026-09-15', 'REJECTED', 'expired_card'], ['2026-09-21', 'REJECTED', 'expired_card'], ['2026-09-23', 'REJECTED', 'expired_card'], ['2026-09-25', 'REJECTED', 'expired_card']]);
    ev(evs, 'STATUS_CHANGED', '2026-09-21T06:00', { from: 'ACTIVE', to: 'PAST_DUE', reason: 'F001 vencido hace 1 día: tarjeta vencida' });
    ev(evs, 'STATUS_CHANGED', '2026-09-27T06:00', { from: 'PAST_DUE', to: 'READ_ONLY', reason: '7 días de mora (gracia de 7 días)' });
    insT('notifications', { user_id: null, role: 'ADMIN_SISTEMA', title: 'Tu cuenta Aycha está en solo lectura', body: 'Paga F001 para volver a registrar pedidos.', ref: 'SUS-08', tone: 'bad', module: 'SUS', read_at: null, at: '2026-09-27T06:00' }, 'EVS');
    // uso medido (12 meses de pedidos; estructura y contadores del mes)
    const months = []; for (let i = 11; i >= 0; i--) months.push(G.date.addMonths(G.TODAY, -i));
    const USE = { CS: { from: '2026-09-01', orders: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 640, 1218], USERS: 9, COMPANIES: 1, ESTABLISHMENTS: 1, BRANDS: 1, WHATSAPP_NUMBERS: 2, API_CALLS_DAY: 0, STORAGE_GB: 4.1, alert: [80] }, DCC: { from: '2026-05-01', orders: [0, 0, 0, 0, 0, 0, 0, 1880, 2650, 2980, 3410, 1320], USERS: 31, COMPANIES: 1, ESTABLISHMENTS: 3, BRANDS: 6, WHATSAPP_NUMBERS: 9, TEL_MINUTES_MONTH: 640, API_CALLS_DAY: 2300, STORAGE_GB: 18.4, alert: [] }, CSS: { from: '2026-07-01', orders: [0, 0, 0, 0, 0, 0, 0, 0, 0, 212, 286, 96], USERS: 4, COMPANIES: 1, ESTABLISHMENTS: 1, BRANDS: 1, WHATSAPP_NUMBERS: 1, STORAGE_GB: 1.2, alert: [] }, EVS: { from: '2026-07-01', orders: [0, 0, 0, 0, 0, 0, 0, 0, 380, 520, 610, 0], USERS: 11, COMPANIES: 1, ESTABLISHMENTS: 2, BRANDS: 2, WHATSAPP_NUMBERS: 2, API_CALLS_DAY: 0, STORAGE_GB: 6.3, alert: [] } };
    for (const [ten, u] of Object.entries(USE)) {
      months.forEach((m, i) => { if (u.orders[i] || m === G.date.month(G.TODAY)) insT('usage_counters', { period: m, limit_key: 'ORDERS_MONTH', used: u.orders[i], limit_value: S.limit(ten, 'ORDERS_MONTH').value, alerted_pcts: m === G.date.month(G.TODAY) ? u.alert : (u.orders[i] >= 0.8 * (S.limit(ten, 'ORDERS_MONTH').value || Infinity) ? [80] : []), measured_at: G.date.add(G.date.addMonths(m, 1), -1) + 'T23:59' }, ten); });
      for (const k of ['USERS', 'COMPANIES', 'ESTABLISHMENTS', 'BRANDS', 'WHATSAPP_NUMBERS', 'TEL_MINUTES_MONTH', 'API_CALLS_DAY', 'STORAGE_GB']) if (u[k] != null) insT('usage_counters', { period: G.date.month(G.TODAY), limit_key: k, used: u[k], limit_value: S.limit(ten, k).value, alerted_pcts: [], measured_at: G.TODAY + 'T06:00' }, ten);
      S.applyModules(ten, { actor: 'Alta del plan' });
    }
    const csSub = cs; ev(csSub, 'USAGE_THRESHOLD', '2026-10-09T18:40', { reason: 'Pedidos del mes: 1 200 de 1 500 (80 %)', detail: { key: 'ORDERS_MONTH', pct: 80 } });
    insT('notifications', { user_id: 'us-cs-gerente', title: 'Uso del plan al 80 %: pedidos del mes', body: '1 200 de 1 500. No bloquea; revisa SUS-04 o cambia de plan en SUS-02.', ref: 'SUS-04', tone: 'warn', module: 'SUS', read_at: null, at: '2026-10-09T18:40' }, 'CS');
    // Don Guando (piloto, sin suscripción): almacenamiento y API medidos para dimensionar planes
    insT('usage_counters', { period: G.date.month(G.TODAY), limit_key: 'STORAGE_GB', used: 7.8, limit_value: null, alerted_pcts: [], measured_at: G.TODAY + 'T06:00' }, 'DG');
    insT('usage_counters', { period: G.date.month(G.TODAY), limit_key: 'API_CALLS_DAY', used: 1450, limit_value: null, alerted_pcts: [], measured_at: G.TODAY + 'T06:00' }, 'DG');
  }, 'planes y suscripciones');

  /* ------------------------------------------------------------------
     Franja de mora y solo lectura en toda la aplicación (SUS-08)
     ------------------------------------------------------------------ */
  S.banner = function (ten = G.ctx.tenant, forceStatus) {
    const sub = S.subFor(ten); if (!sub && !forceStatus) return null;
    const st = forceStatus || sub.status;
    const info = sub ? S.dunningInfo(sub) : null;
    const days = info ? info.days : 9;
    const payBtn = btn('Pagar ahora', () => G.go('SUS-05', { tenant: ten }), { sm: true, kind: 'primary' });
    if (st === 'PAST_DUE') return notice([h('b', null, `Pago pendiente: ${days} ${days === 1 ? 'día' : 'días'} de mora. `), `Sigues operando con normalidad. Si no pagas, el ${F.date(info ? info.readOnlyOn : G.date.add(today(), 3))} la cuenta pasa a solo lectura (RN-SUS-10). `, payBtn], 'warn');
    if (st === 'READ_ONLY') return notice([h('b', null, `Cuenta en solo lectura por ${days} días de mora. `), 'Puedes consultar, exportar y pagar; no se registran pedidos, comprobantes, cobros ni movimientos de stock (RN-SUS-07). ', info ? `Se suspende el ${F.date(info.suspendOn)}. ` : '', payBtn], 'bad');
    if (st === 'SUSPENDED') return notice([h('b', null, 'Cuenta suspendida. '), 'Tus datos se conservan. Paga la deuda para reactivarla al instante. ', payBtn], 'bad');
    if (st === 'TRIAL' && sub && G.date.diff(sub.trial_ends_at, today()) <= 3) return notice([h('b', null, `Tu prueba termina el ${F.date(sub.trial_ends_at)}. `), sub.payment_token_ref ? 'Se cobrará con tu tarjeta registrada.' : 'Registra un medio de pago para no pasar a solo lectura (RN-SUS-15). ', btn('Registrar tarjeta', () => G.go('SUS-06'), { sm: true })], 'info');
    return null;
  };
  const origRenderMain = G.renderMain;
  G.renderMain = function () {
    origRenderMain.apply(this, arguments);
    try {
      if (G.nav.current === 'SUS-08') return;
      const b = S.banner(G.ctx.tenant); if (!b) return;
      const pg = document.querySelector('#main .page'); if (!pg) return;
      b.classList.add('sus-banner'); pg.insertBefore(b, pg.children[1] || null);
    } catch (e) { console.error(e); }
  };

  /* ------------------------------------------------------------------
     Interfaz
     ------------------------------------------------------------------ */
  const tryDo = (fn, ok) => { try { const r = fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 'ok'); G.refresh(); return r; } catch (e) { toast(e.message, 'bad'); return null; } };
  const tenantsWithSubs = () => { const ids = new Set(G.db.raw('subscriptions').map(s => s.tenant)); return ['DG'].concat([...ids].filter(x => x !== 'DG')); };
  let viewTen = null;
  /** empresa que se muestra en las pantallas del cliente: la propia; en la demo, gerencia y soporte pueden ver otras */
  function tenantView(body, params) {
    if (params && params.tenant) viewTen = params.tenant;
    if (!viewTen || !isPlatformRole()) viewTen = G.ctx.tenant;
    if (isPlatformRole()) body.appendChild(h('div', { class: 'stack', style: 'gap:6px' }, h('span', { class: 'small muted' }, 'Ver la suscripción de (demo: en producción cada administrador ve solo la de su empresa):'), pills(tenantsWithSubs().map(t => [t, S.tenantName(t) + (t === G.ctx.tenant ? ' (tu empresa)' : '')]), viewTen, v => { viewTen = v; G.refresh(); })));
    return viewTen;
  }
  const subOf = ten => S.subFor(ten);
  const pilotNotice = ten => notice([h('b', null, `${S.tenantName(ten)} opera como piloto sin suscripción: sin límites, sin bloqueos y sin cobro (RN-SUS-21, D-SUS-08). `), 'El uso se mide igual para dimensionar los planes.'], 'info');
  const usageBar = u => {
    const tone = u.pct == null ? '' : u.pct >= 100 ? 'bad' : u.pct >= 80 ? 'warn' : 'ok';
    return h('div', { class: 'stack', style: 'gap:4px' },
      h('div', { class: 'row between' }, h('span', null, u.name), h('span', { class: 'small num' }, u.limit == null ? `${F.num(u.used, u.key === 'STORAGE_GB' ? 1 : 0)} · sin límite` : `${F.num(u.used, u.key === 'STORAGE_GB' ? 1 : 0)} de ${F.num(u.limit)} · ${F.pct(u.pct, 0)}`)),
      G.ui.progress(u.pct == null ? 0 : u.pct, tone),
      h('span', { class: 'small muted' }, u.limit == null ? '' : `${u.enforcement === 'HARD' ? 'Bloquea al llegar al límite' : 'Solo avisa'}${u.addons ? ` · incluye +${F.num(u.addons)} de complementos` : ''}${u.alerted.length ? ` · avisos enviados: ${u.alerted.join(' %, ')} %` : ''}`));
  };
  const subStatus = s => bdg(SUB_ST, s.status);
  const fitPlans = ten => glob('saas_plans').filter(p => p.status === 'PUBLISHED' && p.is_public && p.product_id === 'sp-COMERCIAL').sort((a, b) => a.price - b.price).map(p => ({ p, over: S.planLimits(p.id).filter(l => l.enforcement === 'HARD' && l.limit_value != null && S.used(ten, l.limit_key) > l.limit_value).map(l => ({ key: l.limit_key, used: S.used(ten, l.limit_key), limit: l.limit_value })) }));

  /* ---------- SUS-01 Mi suscripción ---------- */
  function scr01(el, params) {
    const body = page(el, { code: 'SUS-01', title: scName('SUS-01'), sub: 'Producto, plan, estado, próximo cobro, complementos y uso de cada límite del plan.' });
    const ten = tenantView(body, params); const sub = subOf(ten);
    if (!sub) {
      body.appendChild(pilotNotice(ten));
      body.appendChild(kpis([{ label: 'Producto', value: 'Aycha Comercial' }, { label: 'Plan', value: 'Piloto', sub: 'sin cobro · D-SUS-08' }, { label: 'Estado', value: 'Activo' }, { label: 'Módulos encendidos', value: rawT('tenant_modules', ten).filter(m => m.enabled).length }]));
      const fits = fitPlans(ten);
      body.appendChild(h('div', { class: 'grid c2' }, card('Uso medido', h('div', { class: 'stack' }, S.usage(ten).map(usageBar))), card('Si dejara de ser piloto', h('div', { class: 'stack' }, fits.map(f => h('div', { class: 'row between' }, h('span', null, h('b', null, f.p.name), ` · ${F.money(f.p.price)} + IGV al mes`), f.over.length ? Object.assign(badge('Excede: ' + f.over.map(o => `${limName(o.key).toLowerCase()} ${o.used}/${o.limit}`).join(', '), 'warn'), { style: 'white-space:normal' }) : badge('Le alcanza', 'ok'))), h('p', { class: 'small muted' }, 'Con 5 marcas, 6 números de WhatsApp y ~1 000 pedidos al mes, Don Guando sirve para dimensionar los planes.')))));
      return;
    }
    const plan = S.plan(sub.plan_id); const info = S.dunningInfo(sub);
    const next = sub.status === 'TRIAL' ? `Fin de la prueba: ${F.date(sub.trial_ends_at)}` : sub.current_period_end ? `Próximo cobro: ${F.date(G.date.add(sub.current_period_end, 1))}` : '—';
    body.appendChild(kpis([
      { label: 'Producto', value: (getRaw('saas_products', sub.product_id) || {}).name },
      { label: 'Plan', value: `${plan.name} v${plan.version}`, sub: `${F.money(monthlyPrice(sub))} + IGV al mes${sub.discount_pct ? ` (−${sub.discount_pct} % pactado)` : ''}` },
      { label: 'Estado', value: lbl(SUB_ST, sub.status), sub: `desde ${F.date(sub.status_changed_at)}`, tone: ['READ_ONLY', 'SUSPENDED'].includes(sub.status) ? 'bad' : sub.status === 'PAST_DUE' ? 'warn' : 'ok' },
      { label: sub.status === 'TRIAL' ? 'Prueba' : 'Período', value: sub.status === 'TRIAL' ? F.days(G.date.diff(sub.trial_ends_at, today())) : `${F.date(sub.current_period_start)} – ${F.date(sub.current_period_end)}`, sub: next },
      { label: 'Deuda vencida', value: F.money(info ? info.debt : 0), sub: info ? `${info.days} días de mora` : 'al día', tone: info && info.days > 0 ? 'bad' : 'ok', onClick: info ? () => G.go('SUS-05', { tenant: ten }) : null },
    ]));
    if (sub.scheduled_plan_id) body.appendChild(notice(`Cambio programado a ${S.planName(sub.scheduled_plan_id)} el ${F.date(G.date.add(sub.current_period_end, 1))}${sub.scheduled_reason ? ' · ' + sub.scheduled_reason : ''}.`, 'info'));
    if (sub.cancel_at_period_end) body.appendChild(notice(`Cancelación programada al ${F.date(sub.current_period_end)}. Los datos se conservan ${P('sus_data_retention_days')} días en solo lectura.`, 'warn'));
    const can = G.can('sus.subscription.change_plan');
    body.appendChild(h('div', { class: 'row' }, btn('Cambiar de plan', () => G.go('SUS-02', { tenant: ten }), { disabled: !can }), btn('Complementos', () => G.go('SUS-03', { tenant: ten }), { disabled: !can }), btn('Uso del plan', () => G.go('SUS-04', { tenant: ten })), btn('Comprobantes', () => G.go('SUS-05', { tenant: ten }))));
    const adds = S.addonsOf(sub);
    body.appendChild(h('div', { class: 'grid c2' },
      card('Uso por límite', h('div', { class: 'stack' }, S.usage(ten).filter(u => u.limit != null || u.used).map(usageBar))),
      h('div', { class: 'stack' },
        card('Complementos contratados', adds.length ? h('div', { class: 'stack' }, adds.map(a => { const ad = S.addon(a.addon_id); return h('div', { class: 'row between' }, h('span', null, h('b', null, ad.name), ` × ${a.qty}`), h('span', { class: 'small' }, `${F.money((a.agreed_price ?? ad.price) * a.qty)} al mes`)); })) : G.ui.empty('Sin complementos.')),
        card('Módulos', h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' }, [...S.entitled(sub).entries()].map(([c, src]) => badge(`${c} · ${src === 'CORE' ? 'núcleo' : src === 'PLAN' ? 'plan' : 'complemento'}`, src === 'ADDON' ? 'info' : tenantModOn(ten, c) ? 'ok' : '')))))));
  }

  /* ---------- SUS-02 Cambiar de plan ---------- */
  function scr02(el, params) {
    const body = page(el, { code: 'SUS-02', title: scName('SUS-02'), sub: 'Compara los planes publicados. Subir es inmediato con prorrateo; bajar se aplica al fin del período y solo si tu uso cabe en el plan nuevo (RN-SUS-18).' });
    const ten = tenantView(body, params); const sub = subOf(ten);
    if (!sub) body.appendChild(pilotNotice(ten));
    const plans = glob('saas_plans').filter(p => p.status === 'PUBLISHED' && p.is_public && p.product_id === (sub ? sub.product_id : 'sp-COMERCIAL')).sort((a, b) => a.price - b.price);
    const date = today();
    const g = h('div', { class: 'grid c3' }); body.appendChild(g);
    for (const p of plans) {
      const cur = sub && sub.plan_id === p.id;
      const lims = S.planLimits(p.id);
      const mods = S.planModules(p.id);
      let status = null, action = null;
      if (sub && !cur) {
        const fit = S.fitCheck(sub, p);
        const up = (p.price || 0) > ((sub.agreed_price ?? S.plan(sub.plan_id).price) || 0);
        if (fit.length) status = notice('No alcanza: ' + fit.map(f => `excede en ${F.num(f.excess)} ${unit(f.key, f.excess)} (${limName(f.key).toLowerCase()})`).join('; ') + ' (RN-SUS-18).', 'bad');
        else if (up) { const pr = sub.status === 'TRIAL' ? null : S.proration(sub, p, date); status = notice(pr ? `Sube hoy. Prorrateo: (${F.money(p.price)} − ${F.money(pr.oldP)}) × ${pr.remaining}/${pr.days} días = ${F.money(pr.amount)} + IGV en un comprobante aparte.` : 'Cambio inmediato durante la prueba, sin cobro.', 'info'); }
        else status = notice(`Baja el ${F.date(G.date.add(sub.current_period_end || date, 1))}, al fin del período pagado.`, 'info');
        action = btn(up ? 'Subir a ' + p.name : 'Programar baja a ' + p.name, () => G.require('sus.subscription.change_plan', () => confirm({ title: 'Cambiar de plan', message: `${S.planName(sub.plan_id)} → ${p.name} v${p.version}.`, confirmLabel: 'Confirmar', onConfirm: () => tryDo(() => S.changePlan(sub, p.id), r => r.immediate ? `Plan cambiado${r.invoice ? `; prorrateo ${r.invoice.full_number} por ${F.money(r.invoice.total)}` : ''}` : `Baja programada para el ${F.date(r.effective)}`) })), { kind: up ? 'primary' : '', disabled: !!fit.length || !G.can('sus.subscription.change_plan') });
      }
      g.appendChild(card(h('span', null, p.name, ' ', h('span', { class: 'muted small' }, 'v' + p.version)), h('div', { class: 'stack' },
        h('div', null, h('b', { style: 'font-size:1.5rem' }, F.money(p.price, 0)), h('span', { class: 'muted' }, ' + IGV al mes')), h('p', { class: 'small muted', style: 'margin:0' }, p.description),
        cur ? badge('Tu plan actual', 'ok') : null,
        dl(lims.map(l => [limName(l.limit_key), l.limit_value == null ? 'Sin límite' : `${F.num(l.limit_value)}${l.enforcement === 'SOFT' ? ' (avisa)' : ''}`])),
        h('div', { class: 'small' }, h('b', null, 'Módulos además del núcleo: '), mods.join(', ')),
        status, action)));
    }
    if (plans.some(p => p.price_note)) body.appendChild(h('p', { class: 'small muted' }, 'D-SUS-01: precios propuestos para la demo; Intelectalab aún no aprueba los precios definitivos.'));
  }

  /* ---------- SUS-03 Complementos ---------- */
  function scr03(el, params) {
    const body = page(el, { code: 'SUS-03', title: scName('SUS-03'), sub: 'Contrata o quita telefonía, contabilidad, consignación, números de WhatsApp, usuarios, marcas, locales, pedidos y llamadas de API.' });
    const ten = tenantView(body, params); const sub = subOf(ten);
    if (!sub) body.appendChild(pilotNotice(ten));
    const adds = glob('saas_addons').filter(a => a.status === 'PUBLISHED');
    const mine = sub ? S.addonsOf(sub) : [];
    const can = sub && G.can('sus.subscription.change_plan');
    body.appendChild(table({
      id: 'sus03', rows: adds, search: false,
      columns: [
        { key: 'name', label: 'Complemento' },
        { key: 'effect', label: 'Qué hace', sort: false, render: a => a.module_code ? `Enciende ${a.module_code} · ${modName(a.module_code)}` : `+${F.num(a.limit_increment)} ${limName(a.limit_key).toLowerCase()}` },
        { key: 'price', label: 'Precio', align: 'r', render: a => `${F.money(a.price)}${a.pricing === 'PER_UNIT' ? ' c/u' : ''} al mes` },
        { key: 'mine', label: 'Contratado', align: 'r', value: a => (mine.find(m => m.addon_id === a.id) || {}).qty || 0 },
        { key: 'state', label: 'Efecto actual', sort: false, render: a => { if (!sub) return '—'; if (a.module_code) return tenantModOn(ten, a.module_code) ? badge(a.module_code + ' encendido', 'ok') : S.entitled(sub).has(a.module_code) ? badge('Incluido en el plan', 'info') : badge('Apagado', ''); const l = S.limit(ten, a.limit_key); return l.value == null ? 'Sin límite' : `Límite ${F.num(l.value)} · uso ${F.num(S.used(ten, a.limit_key))}`; } },
      ],
      actions: a => { if (!sub) return []; const m = mine.find(x => x.addon_id === a.id); const inPlan = a.module_code && S.entitled(sub).get(a.module_code) && S.entitled(sub).get(a.module_code) !== 'ADDON'; return [inPlan ? null : btn('Contratar', () => { if (!a.module_code) { modal('Contratar ' + a.name, b2 => { b2.appendChild(h('label', { class: 'small' }, 'Cantidad')); b2.appendChild(h('input', { class: 'input', type: 'number', value: 1, min: 1, attrs: { id: 'sus03-qty' } })); }, [{ label: 'Cancelar' }, { label: 'Contratar', kind: 'primary', onClick: () => tryDo(() => S.addAddon(sub, a.id, document.getElementById('sus03-qty').value), `${a.name} contratado`) !== null }]); } else tryDo(() => S.addAddon(sub, a.id, 1), `${a.name} contratado: ${a.module_code} encendido`); }, { sm: true, disabled: !can || (a.module_code && m) }), m ? btn('Quitar', () => confirm({ title: 'Quitar complemento', message: `${a.name} × ${m.qty}. ${a.module_code ? 'El módulo se apaga.' : 'El límite baja.'}`, danger: true, confirmLabel: 'Quitar', onConfirm: () => tryDo(() => S.removeAddon(m), 'Complemento retirado') }), { sm: true, kind: 'ghost', disabled: !can }) : null]; },
    }));
    body.appendChild(h('p', { class: 'small muted' }, 'Los complementos se cobran desde el siguiente comprobante mensual. RN-SUS-09: un módulo que no está en el plan ni en un complemento no se puede encender.'));
  }

  /* ---------- SUS-04 Uso del plan ---------- */
  function scr04(el, params) {
    const body = page(el, { code: 'SUS-04', title: scName('SUS-04'), sub: 'Detalle por límite: usado, límite efectivo (plan + complementos), si bloquea o solo avisa, y el historial de 12 meses.' });
    const ten = tenantView(body, params); const sub = subOf(ten);
    if (!sub) body.appendChild(pilotNotice(ten));
    const us = S.usage(ten);
    const k1 = (() => { const c = G.ctx.tenant; G.ctx.tenant = ten; try { return G.kpi('KPI-SUS-01') || {}; } finally { G.ctx.tenant = c; } })();
    body.appendChild(kpis([{ label: 'Límite más usado (KPI-SUS-01)', value: k1.value != null ? F.pct(k1.value, 0) : '—', sub: k1.detail || '', tone: (k1.value || 0) >= 100 ? 'bad' : (k1.value || 0) >= 80 ? 'warn' : 'ok' }, { label: 'Avisos', value: (P('sus_usage_alert_pcts') || []).join(' % y ') + ' %', sub: 'una vez por mes y límite' }, { label: 'Exceso de pedidos', value: P('sus_orders_overage_policy') === 'UPGRADE_NEXT_CYCLE' ? 'Plan siguiente' : 'Cobro del excedente', sub: `más de ${P('sus_soft_limit_tolerance_pct')} % sobre el límite (D-SUS-05)` }]));
    body.appendChild(table({ id: 'sus04', search: false, rows: us, columns: [{ key: 'name', label: 'Límite' }, { key: 'used', label: 'Usado', align: 'r', render: u => F.num(u.used, u.key === 'STORAGE_GB' ? 1 : 0) }, { key: 'plan', label: 'Del plan', align: 'r', render: u => u.limit == null ? '—' : F.num(u.plan) }, { key: 'addons', label: 'Complementos', align: 'r', render: u => u.addons ? '+' + F.num(u.addons) : '—' }, { key: 'limit', label: 'Límite efectivo', align: 'r', render: u => u.limit == null ? 'Sin límite' : F.num(u.limit) }, { key: 'enforcement', label: 'Tipo', render: u => u.limit == null ? '—' : u.enforcement === 'HARD' ? badge('Bloquea', 'bad') : badge('Solo avisa', 'info') }, { key: 'pct', label: 'Uso', align: 'r', render: u => u.pct == null ? '—' : h('span', { style: 'display:inline-flex;gap:8px;align-items:center;min-width:120px' }, h('span', { style: 'flex:1' }, G.ui.progress(u.pct, u.pct >= 100 ? 'bad' : u.pct >= 80 ? 'warn' : 'ok')), F.pct(u.pct, 0)) }, { key: 'alerted', label: 'Avisos del mes', render: u => u.alerted.length ? u.alerted.map(x => x + ' %').join(', ') : '—', sort: false }] }));
    let key = 'ORDERS_MONTH';
    const box = h('div');
    const draw = () => {
      G.ui.clear(box);
      const months = []; for (let i = 11; i >= 0; i--) months.push(G.date.addMonths(today(), -i));
      const vals = months.map(m => { const c = counter(ten, key, m); if (c) return c.used; if (key === 'ORDERS_MONTH') return G.db.raw('sales_orders').filter(o => o.tenant === ten && o.confirmed_at && G.date.month(dOf(o.confirmed_at)) === m && o.status !== 'DRAFT').length; return m === G.date.month(today()) ? S.used(ten, key) : 0; });
      const lim = S.limit(ten, key).value;
      box.appendChild(G.ui.chart.bar({ labels: months.map(G.date.monthName), series: [{ name: limName(key), values: vals }], format: v => F.num(v) }));
      if (lim) box.appendChild(h('p', { class: 'small muted' }, `Límite efectivo actual: ${F.num(lim)} · aviso al ${(P('sus_usage_alert_pcts') || []).map(p => F.num(lim * p / 100)).join(' y ')}`));
    };
    body.appendChild(card('Historial de 12 meses', h('div', { class: 'stack' }, G.ui.pills([['ORDERS_MONTH', 'Pedidos'], ['USERS', 'Usuarios'], ['TEL_MINUTES_MONTH', 'Minutos'], ['STORAGE_GB', 'Almacenamiento']], key, v => { key = v; draw(); }), box)));
    draw();
  }

  /* ---------- SUS-05 Comprobantes del SaaS ---------- */
  function invDrawer(inv) {
    drawer(`${inv.doc_type === 'INVOICE' ? 'Factura' : inv.doc_type === 'RECEIPT' ? 'Boleta' : 'Nota de crédito'} ${inv.full_number}`, (bd, close) => {
      const sub = getRaw('subscriptions', inv.subscription_id);
      const canPay = inv.status === 'OPEN' && (G.can('sus.payment_method.manage') || G.can('sus.subscription.change_plan') || platformCan());
      bd.appendChild(h('div', { class: 'row' },
        btn('Descargar PDF', () => { G.print(); }, { sm: true }), btn('Ver XML', () => modal('XML ' + inv.full_number, b2 => { b2.appendChild(h('pre', { class: 'mono small', style: 'white-space:pre-wrap;max-height:50vh;overflow:auto' }, `<Invoice>\n  <cbc:ID>${inv.full_number}</cbc:ID>\n  <cbc:IssueDate>${dOf(inv.issued_at)}</cbc:IssueDate>\n  <cac:AccountingSupplierParty><cbc:ID schemeID="6">${inv.issuer_ruc}</cbc:ID><cbc:Name>INTELECTALAB</cbc:Name></cac:AccountingSupplierParty>\n  <cac:AccountingCustomerParty><cbc:ID schemeID="${sub.billing_doc_type === 'RUC' ? 6 : 1}">${inv.customer_doc_number}</cbc:ID><cbc:Name>${U.esc(inv.customer_name)}</cbc:Name></cac:AccountingCustomerParty>\n  <cac:TaxTotal><cbc:TaxAmount currencyID="PEN">${inv.igv.toFixed(2)}</cbc:TaxAmount></cac:TaxTotal>\n  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount>${inv.subtotal.toFixed(2)}</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="PEN">${inv.total.toFixed(2)}</cbc:PayableAmount></cac:LegalMonetaryTotal>\n</Invoice>`)); }), { sm: true }),
        canPay ? btn('Pagar ahora', () => { const r = tryDo(() => S.pay(inv, { manual: !sub.payment_token_ref })); if (r) { toast(r.attempt.status === 'APPROVED' ? `Pago aprobado por webhook: ${inv.full_number} pagado` : `Cobro rechazado (${r.attempt.failure_code}): actualiza tu tarjeta en SUS-06`, r.attempt.status === 'APPROVED' ? 'ok' : 'bad'); close(); invDrawer(inv); } }, { sm: true, kind: 'primary' }) : null,
        platformCan() && inv.doc_type !== 'CREDIT_NOTE' && inv.status !== 'VOIDED' ? btn('Nota de crédito', () => modal('Nota de crédito de ' + inv.full_number, b2 => { b2.appendChild(h('input', { class: 'input', placeholder: 'Motivo', attrs: { id: 'sus05-nc' } })); }, [{ label: 'Cancelar' }, { label: 'Emitir', kind: 'danger', onClick: () => { const r = tryDo(() => S.creditNote(inv, document.getElementById('sus05-nc').value), x => `Nota de crédito ${x.full_number} emitida`); if (r) close(); return !!r; } }]), { sm: true, kind: 'danger' }) : null));
      bd.appendChild(dl([['Empresa', `${inv.customer_name} · ${inv.customer_doc_number}`], ['Emisor', `INTELECTALAB · RUC ${inv.issuer_ruc}`], ['Período', `${F.date(inv.period_start)} al ${F.date(inv.period_end)}`], ['Emitido', F.datetime(inv.issued_at)], ['Vence', F.date(inv.due_date)], ['Estado', bdg(INV_ST, inv.status)], ['SUNAT (OSE de Intelectalab)', G.ui.status(inv.einvoice_status)], ['Pagado', F.datetime(inv.paid_at)], inv.related_invoice_id ? ['Referencia', (getRaw('saas_invoices', inv.related_invoice_id) || {}).full_number] : null, inv.void_reason ? ['Motivo de anulación', inv.void_reason] : null]));
      const ls = linesOf(inv);
      bd.appendChild(table({ id: 'sus05-l-' + inv.id, search: false, rows: ls, columns: [{ key: 'description', label: 'Concepto' }, { key: 'qty', label: 'Cant.', align: 'r' }, { key: 'unit_price', label: 'Valor unit.', align: 'r', render: l => F.money(l.unit_price) }, { key: 'subtotal', label: 'Subtotal', align: 'r', render: l => F.money(l.subtotal) }, { key: 'igv', label: 'IGV', align: 'r', render: l => F.money(l.igv) }, { key: 'total', label: 'Total', align: 'r', render: l => F.money(l.total) }], footer: ['Total', '', '', F.money(inv.subtotal), F.money(inv.igv), h('b', null, F.money(inv.total))] }));
      const att = attemptsOf(inv);
      if (att.length) { bd.appendChild(h('h3', null, 'Intentos de cobro')); bd.appendChild(table({ id: 'sus05-a-' + inv.id, search: false, rows: att, columns: [{ key: 'attempt_no', label: '#', align: 'r' }, { key: 'attempted_at', label: 'Fecha', render: a => F.datetime(a.attempted_at) }, { key: 'amount', label: 'Monto', align: 'r', render: a => F.money(a.amount) }, { key: 'status', label: 'Resultado', render: a => bdg(ATT_ST, a.status) }, { key: 'failure_code', label: 'Motivo' }, { key: 'gateway_ref', label: 'Referencia', mono: true }] })); }
    }, { code: 'SUS-05', wide: true });
  }
  function scr05(el, params) {
    const body = page(el, { code: 'SUS-05', title: scName('SUS-05'), sub: 'Comprobantes que Intelectalab emite por el SaaS con sus propias series: período, importe, estado de pago y de SUNAT; descarga y pago de uno vencido.' });
    const ten = tenantView(body, params); const sub = subOf(ten);
    if (!sub) { body.appendChild(pilotNotice(ten)); body.appendChild(G.ui.empty('El piloto no se factura.')); return; }
    const invs = S.invoicesOf(ten).sort(U.by('issued_at', -1));
    const info = S.dunningInfo(sub);
    const k2 = (() => { const c = G.ctx.tenant; G.ctx.tenant = ten; try { return G.kpi('KPI-SUS-02', { from: G.date.month(today()), to: today() }) || {}; } finally { G.ctx.tenant = c; } })();
    body.appendChild(kpis([{ label: 'Por cobrar', value: F.money(U.sum(invs.filter(i => i.status === 'OPEN'), i => i.total)), tone: info ? 'bad' : 'ok' }, { label: 'Días de mora (KPI-SUS-03)', value: info ? info.days : 0, tone: info && info.days ? 'bad' : 'ok' }, { label: 'Pagado en el año', value: F.money(U.sum(invs.filter(i => i.status === 'PAID' && i.doc_type !== 'CREDIT_NOTE'), i => i.total)) }, { label: 'Costo del SaaS por pedido (KPI-SUS-02)', value: k2.denominator ? F.money(k2.value) : '—', sub: `${F.money(k2.numerator || 0)} sin IGV / ${F.num(k2.denominator || 0)} pedidos entregados` }]));
    body.appendChild(table({ id: 'sus05', rows: invs, onRow: invDrawer, filters: [{ key: 'status', label: 'Estado', options: Object.entries(INV_ST).map(([k, v]) => [k, v[0]]) }], columns: [{ key: 'full_number', label: 'Comprobante', mono: true }, { key: 'doc_type', label: 'Tipo', render: i => i.doc_type === 'INVOICE' ? 'Factura' : i.doc_type === 'RECEIPT' ? 'Boleta' : 'Nota de crédito' }, { key: 'period_start', label: 'Período', render: i => `${F.date(i.period_start)} – ${F.date(i.period_end)}` }, { key: 'total', label: 'Importe', align: 'r', render: i => F.money(i.total) }, { key: 'due_date', label: 'Vence', render: i => F.date(i.due_date) }, { key: 'status', label: 'Pago', render: i => bdg(INV_ST, i.status) }, { key: 'einvoice_status', label: 'SUNAT', render: i => G.ui.status(i.einvoice_status) }], actions: i => i.status === 'OPEN' ? [btn('Pagar', () => invDrawer(i), { sm: true, kind: 'primary' })] : [] }));
    if (params.invoice) setTimeout(() => { const i = getRaw('saas_invoices', params.invoice); if (i) invDrawer(i); }, 0);
  }

  /* ---------- SUS-06 Medio de pago ---------- */
  function scr06(el, params) {
    const body = page(el, { code: 'SUS-06', title: scName('SUS-06'), sub: 'La tarjeta se tokeniza en la pasarela: Aycha solo guarda el token, la marca y los 4 últimos dígitos (RN-SUS-20).' });
    const ten = tenantView(body, params); const sub = subOf(ten);
    if (!sub) { body.appendChild(pilotNotice(ten)); return; }
    const can = G.can('sus.payment_method.manage');
    const g = h('div', { class: 'grid c2' }); body.appendChild(g);
    g.appendChild(card('Tarjeta registrada', sub.payment_token_ref ? h('div', { class: 'stack' }, h('div', { style: 'border:1px solid var(--line);border-radius:12px;padding:16px;background:var(--surface-2)' }, h('div', { class: 'small muted' }, sub.card_brand), h('div', { class: 'mono', style: 'font-size:1.3rem;letter-spacing:2px' }, '•••• •••• •••• ' + sub.card_last4), h('div', { class: 'small muted' }, 'Vence ' + (sub.card_exp || '—'))), dl([['Pasarela', `${sub.gateway} · adaptador PaymentGateway (D-SUS-02)`], ['Cliente en la pasarela', sub.gateway_customer_ref], ['Token', sub.payment_token_ref.slice(0, 12) + '…'], ['Cobro automático', sub.auto_pay !== false ? 'Sí' : 'No']])) : G.ui.empty('Sin tarjeta registrada.')));
    g.appendChild(card('Datos del comprobante', form({ id: 'sus06-b', values: { billing_doc_type: sub.billing_doc_type, billing_doc_number: sub.billing_doc_number, billing_name: sub.billing_name, billing_email: sub.billing_email, auto_pay: sub.auto_pay !== false }, submitLabel: can ? 'Guardar' : false, fields: [{ key: 'billing_doc_type', label: 'Documento', type: 'select', required: true, options: [['RUC', 'RUC (factura)'], ['DNI', 'DNI (boleta)']] }, { key: 'billing_doc_number', label: 'Número', required: true }, { key: 'billing_name', label: 'Razón social o nombre', required: true, span: 2 }, { key: 'billing_email', label: 'Correo de facturación', required: true, span: 2 }, { key: 'auto_pay', label: 'Cobro automático con la tarjeta guardada (sus_auto_pay)', type: 'checkbox', span: 2 }], onSubmit: v => { if (v.billing_doc_type === 'RUC' && !U.rucOk(v.billing_doc_number)) return { billing_doc_number: 'RN-SUS-19: RUC no válido.' }; if (v.billing_doc_type === 'DNI' && !/^\d{8}$/.test(v.billing_doc_number)) return { billing_doc_number: 'El DNI tiene 8 dígitos.' }; if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.billing_email)) return { billing_email: 'Correo no válido.' }; upd('subscriptions', sub, { billing_doc_type: v.billing_doc_type, billing_doc_number: v.billing_doc_number, billing_name: v.billing_name, billing_email: v.billing_email, auto_pay: !!v.auto_pay }); toast('Datos de facturación guardados', 'ok'); G.refresh(); return true; } })));
    if (can) body.appendChild(card('Registrar o cambiar tarjeta', h('div', { class: 'stack' }, notice('Formulario incrustado de la pasarela (simulado): el número no pasa por los servidores de Aycha. Prueba con 4111 1111 1111 1111 (aprobada) o 4000 0000 0000 0002 (rechazada).', 'info'), form({ id: 'sus06-c', values: {}, submitLabel: 'Tokenizar y guardar', fields: [{ key: 'number', label: 'Número de tarjeta', required: true, placeholder: '4111 1111 1111 1111' }, { key: 'exp', label: 'Vencimiento (MM/AA)', required: true, placeholder: '12/28' }, { key: 'cvv', label: 'CVV', required: true, placeholder: '123' }], onSubmit: v => { S.setPaymentMethod(sub, { number: v.number, exp: v.exp }); toast(`Tarjeta ${sub.card_brand} •••• ${sub.card_last4} guardada. El número no se almacena.`, 'ok'); G.refresh(); return true; } }))));
  }

  /* ---------- SUS-07 Cancelar suscripción ---------- */
  function scr07(el, params) {
    const body = page(el, { code: 'SUS-07', title: scName('SUS-07'), sub: `Se cancela al fin del período pagado. Los datos se conservan ${P('sus_data_retention_days')} días en solo lectura con exportación completa (RN-SUS-17).` });
    const ten = tenantView(body, params); const sub = subOf(ten);
    if (!sub) { body.appendChild(pilotNotice(ten)); return; }
    if (sub.status === 'CANCELLED') { body.appendChild(notice(`Suscripción cancelada el ${F.date(sub.cancelled_at)}. Datos disponibles en solo lectura hasta el ${F.date(sub.data_retention_until)}.`, 'warn')); return; }
    const end = sub.current_period_end || today();
    body.appendChild(dl([['Plan', S.planName(sub.plan_id)], ['Fecha efectiva', sub.status === 'TRIAL' ? 'Inmediata (en prueba)' : F.date(end)], ['Datos en solo lectura hasta', F.date(G.date.add(end, P('sus_data_retention_days') || 90))], ['Después', 'Se purgan y queda constancia en la bitácora de la consola']]));
    if (sub.cancel_at_period_end) { body.appendChild(notice(`Cancelación programada: ${sub.cancel_reason}.`, 'warn')); body.appendChild(btn('Mantener mi suscripción', () => { upd('subscriptions', sub, { cancel_at_period_end: false }); event(sub, 'STATUS_CHANGED', { from: sub.status, to: sub.status, reason: 'El cliente revirtió la cancelación programada', actor: 'TENANT_USER' }); toast('Se mantiene la suscripción', 'ok'); G.refresh(); }, { kind: 'primary' })); return; }
    body.appendChild(notice([h('b', null, 'Antes de cancelar, exporta tus datos. '), 'La exportación completa (pedidos, clientes, comprobantes, kardex) queda disponible durante el plazo de conservación. ', G.screens['SEP-10'] ? btn('Ir a la exportación (SEP-10)', () => G.go('SEP-10'), { sm: true }) : h('span', { class: 'small muted' }, 'SEP-10')], 'info'));
    const can = G.can('sus.subscription.cancel');
    body.appendChild(card('Cancelar', form({ id: 'sus07', values: { reason: 'PRICE', score: '3' }, submitLabel: can ? 'Programar cancelación' : false, fields: [{ key: 'reason', label: 'Motivo', type: 'select', required: true, options: [['PRICE', 'Precio'], ['FEATURES', 'Falta una función'], ['CLOSING', 'Cierre del negocio'], ['COMPETITOR', 'Otro sistema'], ['SUPPORT', 'Soporte'], ['OTHER', 'Otro']] }, { key: 'score', label: '¿Qué tan probable es que vuelvas? (1 a 5)', type: 'select', required: true, options: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']] }, { key: 'comment', label: 'Comentario', type: 'textarea' }], onSubmit: v => { const names = { PRICE: 'Precio', FEATURES: 'Falta una función', CLOSING: 'Cierre del negocio', COMPETITOR: 'Otro sistema', SUPPORT: 'Soporte', OTHER: 'Otro' }; const r = S.cancel(sub, { reason: names[v.reason], survey: { score: Number(v.score), comment: v.comment } }); toast(`Cancelación ${r.effective === today() ? 'inmediata' : 'programada al ' + F.date(r.effective)}`, 'warn'); G.refresh(); return true; } })));
  }

  /* ---------- SUS-08 Aviso de mora y solo lectura ---------- */
  function scr08(el, params) {
    const body = page(el, { code: 'SUS-08', title: scName('SUS-08'), sub: 'Franja visible en toda la aplicación con los días de mora y el botón de pago; en solo lectura explica qué se puede hacer.' });
    const ten = tenantView(body, params); const sub = subOf(ten);
    if (!sub) { body.appendChild(pilotNotice(ten)); }
    const cur = sub ? S.banner(ten) : null;
    body.appendChild(card('Lo que ve hoy ' + S.tenantName(ten), cur || notice(sub ? `Suscripción ${lbl(SUB_ST, sub.status).toLowerCase()}: no se muestra ninguna franja.` : 'Sin suscripción: no se muestra ninguna franja.', 'ok')));
    const info = sub && S.dunningInfo(sub);
    if (info) {
      const steps = [['Vencimiento', info.invoice.due_date], ...info.retries.map((d, i) => [`Reintento ${i + 1}`, d]), ['Solo lectura', info.readOnlyOn], ['Suspensión', info.suspendOn]].sort((a, b) => a[1].localeCompare(b[1]));
      body.appendChild(card(`Mora de ${info.invoice.full_number} · ${F.money(info.debt)}`, h('div', { class: 'stack' }, h('div', { class: 'steps' }, steps.map(([l, d]) => h('div', { class: 'step' + (d < today() ? ' done' : d === today() ? ' cur' : '') }, h('b', null, l), h('div', { class: 'small muted' }, F.date(d))))), h('div', { class: 'row' }, btn('Pagar ahora', () => G.go('SUS-05', { tenant: ten, invoice: info.invoice.id }), { kind: 'primary' }), btn('Actualizar tarjeta', () => G.go('SUS-06', { tenant: ten }))))));
    }
    body.appendChild(card('Qué se puede hacer en cada estado (RN-SUS-07)', table({ id: 'sus08', search: false, rows: [{ s: 'PAST_DUE', op: 'Sí, con normalidad', q: 'Sí', p: 'Sí' }, { s: 'READ_ONLY', op: 'No (HTTP 402)', q: 'Sí: consultar y exportar', p: 'Sí' }, { s: 'SUSPENDED', op: 'No (HTTP 402)', q: 'Solo exportar', p: 'Sí: reactiva al instante' }, { s: 'CANCELLED', op: 'No', q: `Solo lectura ${P('sus_data_retention_days')} días`, p: '—' }], columns: [{ key: 's', label: 'Estado', render: r => bdg(SUB_ST, r.s) }, { key: 'op', label: 'Pedidos, comprobantes, cobros y stock' }, { key: 'q', label: 'Consultar y exportar' }, { key: 'p', label: 'Pagar la deuda' }] }), { flush: true }));
    body.appendChild(card('Vista previa de la franja', h('div', { class: 'stack' }, ['PAST_DUE', 'READ_ONLY', 'SUSPENDED'].map(s => h('div', { class: 'stack', style: 'gap:4px' }, h('span', { class: 'small muted' }, lbl(SUB_ST, s)), S.banner(ten, s))))));
  }

  /* ---------- SUS-09 Catálogo de planes (consola) ---------- */
  S.publishPlan = function (p) {
    if (p.status === 'PUBLISHED') G.fail('RN-SUS-02', 'El plan ya está publicado.');
    if (p.status === 'RETIRED') G.fail('RN-SUS-02', 'Un plan retirado no se vuelve a publicar: crea una nueva versión.');
    if (p.price == null) G.fail('RN-SUS-01', 'D-SUS-01: el plan no tiene precio aprobado; queda en borrador.');
    const mods = S.planModules(p.id); if (!mods.length && p.code !== 'PILOTO') G.fail('RN-SUS-01', 'El plan necesita al menos un módulo.');
    const core = S.coreModules(p.product_id); const all = new Set(core.concat(mods));
    const miss = []; for (const m of mods) for (const d of S.deps(m)) if (!all.has(d)) miss.push(`${m} exige ${d}`);
    if (miss.length) G.fail('RN-SUS-01', 'Faltan dependencias: ' + miss.join('; ') + '.');
    const prev = glob('saas_plans').filter(x => x.code === p.code && x.status === 'PUBLISHED' && x.id !== p.id);
    for (const x of prev) upd('saas_plans', x, { status: 'RETIRED', retired_at: G.date.now() });
    return upd('saas_plans', p, { status: 'PUBLISHED', published_at: G.date.now() });
  };
  S.newVersion = function (p) {
    const v = Math.max(...glob('saas_plans').filter(x => x.code === p.code).map(x => x.version)) + 1;
    const np = insG('saas_plans', Object.assign({}, p, { id: `pl-${p.code}-${v}`, version: v, status: 'DRAFT', published_at: null, retired_at: null, created_at: G.date.now() }));
    for (const m of S.planModules(p.id)) insG('saas_plan_modules', { plan_id: np.id, module_code: m });
    for (const l of S.planLimits(p.id)) insG('saas_plan_limits', { plan_id: np.id, limit_key: l.limit_key, limit_value: l.limit_value, enforcement: l.enforcement });
    return np;
  };
  S.editPlan = function (p, patch) { if (p.status !== 'DRAFT') G.fail('RN-SUS-02', 'Un plan publicado no cambia precio, período, prueba, módulos ni límites: crea una nueva versión.'); return upd('saas_plans', p, patch); };
  function planDrawer(p) {
    drawer(`${p.name} v${p.version}`, (bd, close) => {
      const can = platformCan();
      const subs = G.db.raw('subscriptions').filter(s => s.plan_id === p.id && s.status !== 'CANCELLED');
      bd.appendChild(h('div', { class: 'row' },
        p.status === 'DRAFT' && can ? btn('Publicar', () => { if (tryDo(() => S.publishPlan(p), 'Plan publicado') !== null) { close(); planDrawer(p); } }, { sm: true, kind: 'primary' }) : null,
        p.status === 'PUBLISHED' && can ? btn('Retirar', () => confirm({ title: 'Retirar plan', message: `Las ${subs.length} suscripciones conservan su versión hasta que cambien de plan (RN-SUS-02).`, confirmLabel: 'Retirar', danger: true, onConfirm: () => { upd('saas_plans', p, { status: 'RETIRED', retired_at: G.date.now() }); close(); G.refresh(); } }), { sm: true }) : null,
        p.status !== 'DRAFT' && can ? btn('Crear nueva versión', () => { const np = tryDo(() => S.newVersion(p), 'Nueva versión en borrador'); if (np) { close(); planDrawer(np); } }, { sm: true }) : null));
      bd.appendChild(dl([['Producto', (getRaw('saas_products', p.product_id) || {}).name], ['Código', p.code + ' · v' + p.version], ['Estado', bdg(PLAN_ST, p.status)], ['Precio', p.price == null ? 'Sin precio (D-SUS-01)' : `${F.money(p.price)} ${p.price_includes_igv ? 'con' : '+'} IGV · ${p.billing_period === 'MONTHLY' ? 'mensual' : 'anual'}`], ['Prueba', F.days(p.trial_days)], ['Público', p.is_public ? 'Sí' : 'No (interno)'], ['Suscripciones vivas', subs.length], ['Publicado', F.datetime(p.published_at)]]));
      if (p.status === 'DRAFT' && can) bd.appendChild(card('Editar borrador', form({ id: 'sus09-e', values: { price: p.price, trial_days: p.trial_days, description: p.description }, fields: [{ key: 'price', label: 'Precio mensual sin IGV', type: 'money', min: 0 }, { key: 'trial_days', label: 'Días de prueba', type: 'number', min: 0, max: P('sus_trial_max_days') }, { key: 'description', label: 'Descripción', span: 2 }], onSubmit: v => { S.editPlan(p, { price: v.price === '' ? null : Number(v.price), trial_days: Number(v.trial_days) || 0, description: v.description }); toast('Borrador guardado', 'ok'); close(); planDrawer(p); return true; } })));
      const core = new Set(S.coreModules(p.product_id)); const mods = S.planModules(p.id); const all = new Set([...core, ...mods]);
      bd.appendChild(h('h3', null, 'Módulos'));
      bd.appendChild(table({ id: 'sus09-m-' + p.id, search: false, pageSize: 40, rows: S.productModules(p.product_id).map(m => ({ code: m.module_code, core: m.is_core, inPlan: mods.includes(m.module_code), deps: S.deps(m.module_code) })), columns: [{ key: 'code', label: 'Módulo', render: r => `${r.code} · ${modName(r.code)}` }, { key: 'core', label: 'Incluido', render: r => r.core ? badge('Núcleo', '') : r.inPlan ? badge('Plan', 'ok') : '—' }, { key: 'deps', label: 'Depende de', render: r => r.deps.length ? r.deps.map(d => all.has(d) || !(r.core || r.inPlan) ? d : d + ' (falta)').join(', ') : '—', sort: false }], actions: r => p.status === 'DRAFT' && can && !r.core ? [btn(r.inPlan ? 'Quitar' : 'Agregar', () => { if (r.inPlan) { const row = glob('saas_plan_modules').find(x => x.plan_id === p.id && x.module_code === r.code); G.db.remove('saas_plan_modules', row.id); } else insG('saas_plan_modules', { plan_id: p.id, module_code: r.code }); close(); planDrawer(p); }, { sm: true, kind: 'ghost' })] : [] }));
      bd.appendChild(h('h3', null, 'Límites'));
      bd.appendChild(table({ id: 'sus09-l-' + p.id, search: false, rows: S.planLimits(p.id), columns: [{ key: 'limit_key', label: 'Límite', render: l => limName(l.limit_key) }, { key: 'limit_value', label: 'Valor', align: 'r', render: l => l.limit_value == null ? 'Sin límite' : F.num(l.limit_value) }, { key: 'enforcement', label: 'Tipo', render: l => l.enforcement === 'HARD' ? badge('Bloquea', 'bad') : badge('Solo avisa', 'info') }], actions: l => p.status === 'DRAFT' && can ? [btn('Cambiar', () => modal('Límite · ' + limName(l.limit_key), b2 => { b2.appendChild(h('input', { class: 'input', type: 'number', value: l.limit_value ?? '', attrs: { id: 'sus09-lim' } })); }, [{ label: 'Cancelar' }, { label: 'Guardar', kind: 'primary', onClick: () => { const v = document.getElementById('sus09-lim').value; upd('saas_plan_limits', l, { limit_value: v === '' ? null : Number(v) }); close(); planDrawer(p); } }]), { sm: true, kind: 'ghost' })] : [] }));
    }, { code: 'SUS-09', wide: true });
  }
  function scr09(el) {
    const body = page(el, { code: 'SUS-09', title: scName('SUS-09'), sub: 'Productos, planes con versiones, módulos incluidos con sus dependencias y límites. Publicado = inmutable: un cambio es una nueva versión (RN-SUS-02).' });
    if (!platformCan()) body.appendChild(notice('Solo los roles de plataforma (PLATFORM_ADMIN y BILLING de Intelectalab) publican y retiran planes (RN-OPS-10). En la demo: Soporte de plataforma o Gerencia.', 'info'));
    const prods = glob('saas_products');
    body.appendChild(kpis(prods.map(p => ({ label: p.name, value: glob('saas_plans').filter(x => x.product_id === p.id && x.status === 'PUBLISHED').length + ' planes publicados', sub: `${S.productModules(p.id).length} módulos · ${lbl({ ACTIVE: ['Activo'], PLANNED: ['Planificado'], RETIRED: ['Retirado'] }, p.status)}` }))));
    const plans = glob('saas_plans').sort((a, b) => (a.product_id + a.code + a.version).localeCompare(b.product_id + b.code + b.version));
    body.appendChild(table({ id: 'sus09', rows: plans, onRow: planDrawer, filters: [{ key: 'product_id', label: 'Producto', options: prods.map(p => [p.id, p.name]) }, { key: 'status', label: 'Estado', options: Object.entries(PLAN_ST).map(([k, v]) => [k, v[0]]) }], columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'version', label: 'Versión', align: 'r' }, { key: 'name', label: 'Plan' }, { key: 'product_id', label: 'Producto', render: p => (getRaw('saas_products', p.product_id) || {}).name }, { key: 'price', label: 'Precio + IGV', align: 'r', render: p => p.price == null ? 'Por decidir' : F.money(p.price) }, { key: 'trial_days', label: 'Prueba', align: 'r', render: p => F.days(p.trial_days) }, { key: 'mods', label: 'Módulos', align: 'r', value: p => S.planModules(p.id).length }, { key: 'subs', label: 'Suscripciones', align: 'r', value: p => G.db.raw('subscriptions').filter(s => s.plan_id === p.id && s.status !== 'CANCELLED').length }, { key: 'status', label: 'Estado', render: p => bdg(PLAN_ST, p.status) }] }));
    body.appendChild(h('p', { class: 'small muted' }, 'D-SUS-01: precios propuestos para la demo. D-SUS-03: límites propuestos (Inicia 1 marca, 1 local, 5 usuarios, 300 pedidos, 1 número; Crecer 3, 2, 15, 1 500, 3; Escala 10, 5, 40, 5 000, 8). D-SUS-10: la Granja solo con módulos núcleo hasta unir los kits.'));
  }

  /* ---------- SUS-10 Complementos (consola) ---------- */
  function scr10(el) {
    const body = page(el, { code: 'SUS-10', title: scName('SUS-10'), sub: 'Complementos por producto con el módulo que encienden o el límite que suben, forma de cobro y precio. Un complemento publicado tiene precio (RN-SUS-01).' });
    const adds = glob('saas_addons');
    const used = U.groupBy(G.db.raw('subscription_addons').filter(a => a.status === 'ACTIVE'), 'addon_id');
    body.appendChild(table({ id: 'sus10', rows: adds, filters: [{ key: 'status', label: 'Estado', options: Object.entries(PLAN_ST).map(([k, v]) => [k, v[0]]) }], columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Complemento' }, { key: 'effect', label: 'Efecto', sort: false, render: a => a.module_code ? `Enciende ${a.module_code}` : a.limit_key ? `+${F.num(a.limit_increment)} ${limName(a.limit_key).toLowerCase()}` : '—' }, { key: 'pricing', label: 'Cobro', render: a => ({ FLAT: 'Fijo', PER_UNIT: 'Por unidad', USAGE: 'Por uso' })[a.pricing] }, { key: 'price', label: 'Precio + IGV', align: 'r', render: a => a.price == null ? 'Por decidir' : F.money(a.price) }, { key: 'subs', label: 'Contratados', align: 'r', value: a => U.sum(used[a.id] || [], x => x.qty) }, { key: 'status', label: 'Estado', render: a => bdg(PLAN_ST, a.status) }], actions: a => platformCan() ? [a.status === 'DRAFT' ? btn('Publicar', () => tryDo(() => { if (a.price == null) G.fail('RN-SUS-01', 'Un complemento publicado tiene precio (D-SUS-01).'); upd('saas_addons', a, { status: 'PUBLISHED' }); }, 'Complemento publicado'), { sm: true }) : null, a.status === 'PUBLISHED' ? btn('Retirar', () => tryDo(() => upd('saas_addons', a, { status: 'RETIRED' }), 'Complemento retirado; los contratados siguen hasta que se quiten'), { sm: true, kind: 'ghost' }) : null, a.status === 'DRAFT' ? btn('Precio', () => modal('Precio de ' + a.name, b2 => { b2.appendChild(h('input', { class: 'input', type: 'number', attrs: { id: 'sus10-p' } })); }, [{ label: 'Cancelar' }, { label: 'Guardar', kind: 'primary', onClick: () => { const v = Number(document.getElementById('sus10-p').value); if (!(v >= 0)) return false; upd('saas_addons', a, { price: v }); G.refresh(); } }]), { sm: true, kind: 'ghost' }) : null] : [] }));
  }

  /* ---------- SUS-11 Suscripciones de clientes (consola) ---------- */
  function subDrawer(sub) {
    drawer(S.tenantName(sub.tenant) + ' · ' + S.planName(sub.plan_id), (bd, close) => {
      const can = platformCan(); const info = S.dunningInfo(sub);
      const reopen = () => { close(); subDrawer(sub); };
      bd.appendChild(dl([['Empresa', `${sub.billing_name} · ${sub.billing_doc_type} ${sub.billing_doc_number}`], ['Estado', h('span', null, subStatus(sub), ` desde ${F.date(sub.status_changed_at)}`)], ['Plan', `${S.planName(sub.plan_id)} · ${F.money(monthlyPrice(sub))} + IGV`], ['Descuento pactado', sub.discount_pct ? sub.discount_pct + ' %' : '—'], ['Período', sub.current_period_start ? `${F.date(sub.current_period_start)} – ${F.date(sub.current_period_end)}` : '—'], ['Prueba', sub.trial_ends_at ? `hasta ${F.date(sub.trial_ends_at)} (${sub.trial_days_total || 14} días)` : '—'], ['MRR', F.money(S.mrr(sub))], ['Deuda', info ? `${F.money(info.debt)} · ${info.days} días` : 'Al día'], ['Tarjeta', sub.card_last4 ? `${sub.card_brand} •••• ${sub.card_last4}` : 'Sin tarjeta']]));
      if (can) {
        const acts = h('div', { class: 'row', style: 'flex-wrap:wrap' });
        for (const to of TRANS[sub.status] || []) acts.appendChild(btn('Pasar a ' + lbl(SUB_ST, to).toLowerCase(), () => modal(`Cambiar a ${lbl(SUB_ST, to)}`, b2 => { b2.appendChild(h('input', { class: 'input', placeholder: 'Motivo (obligatorio)', attrs: { id: 'sus11-why' } })); }, [{ label: 'Cancelar' }, { label: 'Cambiar estado', kind: to === 'SUSPENDED' || to === 'CANCELLED' ? 'danger' : 'primary', onClick: () => { const why = document.getElementById('sus11-why').value; if (!why) { toast('El cambio de estado exige motivo.', 'warn'); return false; } const r = tryDo(() => S.transition(sub, to, { reason: why, actor: 'PLATFORM_USER', at: G.date.now() }), 'Estado actualizado'); if (r) reopen(); return !!r; } }]), { sm: true }));
        if (sub.status === 'TRIAL') acts.appendChild(btn('Extender prueba', () => modal('Extender prueba', b2 => { b2.append(h('input', { class: 'input', type: 'number', value: 7, attrs: { id: 'sus11-d' } }), h('input', { class: 'input', placeholder: 'Motivo', attrs: { id: 'sus11-r' } })); }, [{ label: 'Cancelar' }, { label: 'Extender', kind: 'primary', onClick: () => { const r = tryDo(() => S.extendTrial(sub, document.getElementById('sus11-d').value, document.getElementById('sus11-r').value), 'Prueba extendida'); if (r) reopen(); return !!r; } }]), { sm: true }));
        acts.appendChild(btn('Descuento pactado', () => modal('Descuento pactado', b2 => { b2.append(h('input', { class: 'input', type: 'number', value: sub.discount_pct || 0, attrs: { id: 'sus11-pct' } }), h('input', { class: 'input', placeholder: 'Motivo', attrs: { id: 'sus11-pr' } })); }, [{ label: 'Cancelar' }, { label: 'Guardar', kind: 'primary', onClick: () => { const v = Number(document.getElementById('sus11-pct').value), why = document.getElementById('sus11-pr').value; if (!(v >= 0 && v <= 100) || !why) { toast('Descuento de 0 a 100 % y con motivo.', 'warn'); return false; } upd('subscriptions', sub, { discount_pct: v }); event(sub, 'STATUS_CHANGED', { from: sub.status, to: sub.status, reason: `Descuento pactado ${v} %: ${why}`, actor: 'PLATFORM_USER' }); reopen(); } }]), { sm: true, kind: 'ghost' }));
        bd.appendChild(acts);
      }
      bd.appendChild(h('h3', null, 'Uso'));
      bd.appendChild(h('div', { class: 'stack' }, S.usage(sub.tenant).filter(u => u.limit != null).map(usageBar)));
      bd.appendChild(h('h3', null, 'Historial (solo inserción)'));
      bd.appendChild(h('div', { class: 'timeline' }, S.eventsOf(sub).slice().reverse().map(e => h('div', { class: 'tl-item' }, h('b', null, EV[e.event_type] || e.event_type, e.to_status && e.from_status !== e.to_status ? ` · ${e.from_status ? lbl(SUB_ST, e.from_status) + ' → ' : ''}${lbl(SUB_ST, e.to_status)}` : '', e.to_plan_id && e.event_type === 'PLAN_CHANGED' ? ` · ${S.planName(e.from_plan_id)} → ${S.planName(e.to_plan_id)}` : ''), h('div', { class: 'small muted' }, `${F.datetime(e.occurred_at)} · ${ACTOR[e.actor_type] || e.actor_type}${e.actor_name && e.actor_type !== 'SYSTEM' ? ' (' + e.actor_name + ')' : ''}${e.reason ? ' · ' + e.reason : ''}`)))));
    }, { code: 'SUS-11', wide: true });
  }
  function scr11(el) {
    const subs = G.db.raw('subscriptions');
    const body = page(el, { code: 'SUS-11', title: scName('SUS-11'), sub: 'Suscripciones de todas las empresas clientes: estado, días en el estado, MRR y uso; historial, prueba, descuento y cambio de estado con motivo.', actions: platformCan() ? [{ label: 'Nueva suscripción', kind: 'primary', icon: '+', onClick: newSub }] : [] });
    const mrr = U.sum(subs, S.mrr);
    body.appendChild(kpis([{ label: 'MRR', value: F.money(mrr), sub: 'activas y en mora, sin IGV' }, { label: 'Empresas', value: subs.filter(s => s.status !== 'CANCELLED').length + 1, sub: '+ Don Guando piloto sin suscripción' }, ...['TRIAL', 'ACTIVE', 'PAST_DUE', 'READ_ONLY', 'SUSPENDED'].map(s => ({ label: lbl(SUB_ST, s), value: subs.filter(x => x.status === s).length, tone: ['PAST_DUE'].includes(s) ? 'warn' : ['READ_ONLY', 'SUSPENDED'].includes(s) ? 'bad' : '' }))]));
    const rows = subs.map(s => { const u = S.usage(s.tenant).filter(x => x.pct != null).sort((a, b) => b.pct - a.pct)[0]; return Object.assign({ name: S.tenantName(s.tenant), prod: (getRaw('saas_products', s.product_id) || {}).name, plan: S.planName(s.plan_id), days: G.date.diff(today(), dOf(s.status_changed_at)), mrr: S.mrr(s), top: u }, s); });
    rows.push({ id: 'pilot-DG', tenant: 'DG', name: S.tenantName('DG'), prod: 'Aycha Comercial', plan: 'Piloto (sin suscripción)', status: 'PILOT', days: null, mrr: 0, top: null });
    body.appendChild(table({ id: 'sus11', rows, onRow: r => r.status === 'PILOT' ? toast('Don Guando opera como piloto sin suscripción (D-SUS-08).', 'info') : subDrawer(getRaw('subscriptions', r.id)), filters: [{ key: 'status', label: 'Estado', options: Object.entries(SUB_ST).map(([k, v]) => [k, v[0]]) }], columns: [{ key: 'name', label: 'Empresa' }, { key: 'prod', label: 'Producto' }, { key: 'plan', label: 'Plan' }, { key: 'status', label: 'Estado', render: r => r.status === 'PILOT' ? badge('Piloto', 'info') : subStatus(r) }, { key: 'days', label: 'Días en el estado', align: 'r', render: r => r.days == null ? '—' : r.days }, { key: 'mrr', label: 'MRR', align: 'r', render: r => F.money(r.mrr) }, { key: 'top', label: 'Uso más alto', value: r => r.top ? r.top.pct : -1, render: r => r.top ? `${F.pct(r.top.pct, 0)} ${r.top.name.toLowerCase()}` : '—' }] }));
    function newSub() {
      drawer('Nueva suscripción', (bd, close) => {
        bd.appendChild(notice('Normalmente el alta la hace el cliente en el asistente (ONB). Aquí la registra Intelectalab.', 'info'));
        bd.appendChild(form({ id: 'sus11-n', values: { tenant: 'APE', plan_id: 'pl-CRECER-1', trial: true, billing_doc_type: 'RUC', billing_doc_number: U.rucCheck('2060712290'), billing_name: 'AVÍCOLA EL PORVENIR SAC', short: 'El Porvenir', billing_email: 'admin@elporvenir.pe' }, fields: [{ key: 'tenant', label: 'Código de empresa', required: true }, { key: 'short', label: 'Nombre corto', required: true }, { key: 'billing_name', label: 'Razón social', required: true, span: 2 }, { key: 'billing_doc_type', label: 'Documento', type: 'select', required: true, options: [['RUC', 'RUC'], ['DNI', 'DNI']] }, { key: 'billing_doc_number', label: 'Número', required: true }, { key: 'billing_email', label: 'Correo de facturación', required: true, span: 2 }, { key: 'plan_id', label: 'Plan', type: 'select', required: true, options: glob('saas_plans').filter(p => p.status === 'PUBLISHED' && p.is_public).map(p => [p.id, `${p.name} v${p.version} · ${F.money(p.price)}`]) }, { key: 'trial', label: `Con prueba gratuita (${P('sus_trial_days_default')} días)`, type: 'checkbox' }], onCancel: close, onSubmit: v => { const s = S.subscribe(Object.assign({}, v, { tenant: String(v.tenant).toUpperCase(), actor: 'PLATFORM_USER' })); close(); toast(`Suscripción de ${s.billing_name} creada en ${lbl(SUB_ST, s.status).toLowerCase()}`, 'ok'); G.refresh(); return true; } }));
      }, { code: 'SUS-11' });
    }
  }

  /* ---------- SUS-12 Facturación del SaaS (consola) ---------- */
  let runDate = null;
  function scr12(el) {
    runDate = runDate || G.date.addMonths(today(), 1);
    const body = page(el, { code: 'SUS-12', title: scName('SUS-12'), sub: 'Corrida mensual de cobro, comprobantes en borrador y emitidos, envío al OSE de Intelectalab, notas de crédito y series de plataforma.' });
    const issuer = P('sus_issuer_ruc');
    body.appendChild(issuer ? notice(`RUC emisor de Intelectalab: ${issuer} (D-SUS-06: valor de demostración). IGV ${F.pct(igv() * 100, 0)} (sus_igv_rate).`, 'info') : notice('RN-SUS-19: falta sus_issuer_ruc (D-SUS-06). La corrida de cobro no emite.', 'bad'));
    const prev = S.billingPreview(runDate);
    const dIn = h('input', { class: 'input', type: 'date', value: runDate, attrs: { id: 'sus12-date', 'aria-label': 'Fecha de la corrida' } }); dIn.addEventListener('change', () => { runDate = dIn.value; G.refresh(); });
    body.appendChild(card('Corrida de cobro', h('div', { class: 'stack' }, h('div', { class: 'row' }, h('label', { class: 'small muted' }, 'Fecha de la corrida'), dIn, platformCan() ? btn(`Emitir ${prev.length} comprobantes y cobrar`, () => confirm({ title: 'Ejecutar corrida', message: `Se renuevan ${prev.length} períodos, se emiten los comprobantes con la serie de plataforma y se cobra con la tarjeta guardada.`, confirmLabel: 'Ejecutar', onConfirm: () => tryDo(() => S.runBilling(runDate), r => `${r.length} comprobantes emitidos; ${r.filter(x => x.pay && x.pay.attempt.status === 'APPROVED').length} cobrados`) }), { kind: 'primary', disabled: !prev.length || !issuer }) : null),
      table({ id: 'sus12-prev', search: false, rows: prev.map(p => ({ id: p.sub.id, name: S.tenantName(p.sub.tenant), plan: S.planName(p.planId), period: `${F.date(p.start)} – ${F.date(p.end)}`, lines: p.lines.map(l => `${l.description}${l.qty > 1 ? ' × ' + l.qty : ''}`).join(' · '), subtotal: p.subtotal, igv: p.igv, total: p.total, type: p.sub.billing_doc_type === 'RUC' ? 'Factura' : 'Boleta' })), empty: 'No hay períodos por renovar en esa fecha.', columns: [{ key: 'name', label: 'Empresa' }, { key: 'type', label: 'Tipo' }, { key: 'plan', label: 'Plan' }, { key: 'period', label: 'Período' }, { key: 'lines', label: 'Líneas (borrador)' }, { key: 'subtotal', label: 'Subtotal', align: 'r', render: r => F.money(r.subtotal) }, { key: 'igv', label: 'IGV', align: 'r', render: r => F.money(r.igv) }, { key: 'total', label: 'Total', align: 'r', render: r => F.money(r.total) }] }))));
    const invs = G.db.raw('saas_invoices').slice().sort((a, b) => String(b.issued_at).localeCompare(String(a.issued_at)) || b.number - a.number);
    body.appendChild(card('Comprobantes emitidos', table({ id: 'sus12-inv', rows: invs, onRow: invDrawer, filters: [{ key: 'status', label: 'Pago', options: Object.entries(INV_ST).map(([k, v]) => [k, v[0]]) }, { key: 'doc_type', label: 'Tipo', options: [['INVOICE', 'Factura'], ['RECEIPT', 'Boleta'], ['CREDIT_NOTE', 'Nota de crédito']] }, { key: 'tenant', label: 'Empresa', options: tenantsWithSubs().filter(t => t !== 'DG').map(t => [t, S.tenantName(t)]) }], columns: [{ key: 'full_number', label: 'Número', mono: true }, { key: 'tenant', label: 'Empresa', render: i => S.tenantName(i.tenant) }, { key: 'issued_at', label: 'Emitido', render: i => F.date(i.issued_at) }, { key: 'period_start', label: 'Período', render: i => `${F.date(i.period_start)} – ${F.date(i.period_end)}` }, { key: 'subtotal', label: 'Subtotal', align: 'r', render: i => F.money(i.subtotal) }, { key: 'igv', label: 'IGV', align: 'r', render: i => F.money(i.igv) }, { key: 'total', label: 'Total', align: 'r', render: i => F.money(i.total) }, { key: 'status', label: 'Pago', render: i => bdg(INV_ST, i.status) }, { key: 'einvoice_status', label: 'OSE', render: i => G.ui.status(i.einvoice_status) }] }), { flush: true }));
    body.appendChild(card('Series de plataforma (RN-SUS-12)', table({ id: 'sus12-ser', search: false, rows: glob('platform_document_series'), columns: [{ key: 'issuer_ruc', label: 'RUC emisor', mono: true }, { key: 'doc_type', label: 'Tipo', render: s => ({ INVOICE: 'Factura', RECEIPT: 'Boleta', CREDIT_NOTE: 'Nota de crédito' })[s.doc_type] }, { key: 'series', label: 'Serie', mono: true }, { key: 'next_number', label: 'Siguiente número', align: 'r' }, { key: 'status', label: 'Estado', render: s => G.ui.status(s.status) }] }), { flush: true }));
  }

  /* ---------- SUS-13 Cobros y conciliación (consola) ---------- */
  function scr13(el) {
    const body = page(el, { code: 'SUS-13', title: scName('SUS-13'), sub: 'Intentos de cobro con su resultado, referencia de la pasarela y evento crudo del webhook; conciliación con el abono de la pasarela.' });
    const atts = G.db.raw('saas_payment_attempts').slice().sort((a, b) => String(b.attempted_at).localeCompare(String(a.attempted_at)));
    const ok = atts.filter(a => a.status === 'APPROVED');
    const fee = 0.0399;
    body.appendChild(kpis([{ label: 'Cobros aprobados', value: ok.length, sub: F.money(U.sum(ok, a => a.amount)) }, { label: 'Rechazados', value: atts.filter(a => a.status === 'REJECTED').length, tone: 'warn' }, { label: 'Por conciliar', value: ok.filter(a => !a.reconciled).length, sub: F.money(U.sum(ok.filter(a => !a.reconciled), a => a.amount)), tone: ok.some(a => !a.reconciled) ? 'warn' : 'ok' }, { label: 'Webhooks duplicados descartados', value: G.db.raw('webhook_events').filter(w => w.status === 'DUPLICATE').length, sub: 'RN-SUS-13' }]));
    body.appendChild(card('Intentos de cobro', table({ id: 'sus13', rows: atts, filters: [{ key: 'status', label: 'Resultado', options: Object.entries(ATT_ST).map(([k, v]) => [k, v[0]]) }, { key: 'tenant', label: 'Empresa', options: tenantsWithSubs().filter(t => t !== 'DG').map(t => [t, S.tenantName(t)]) }], onRow: a => attDrawer(a), columns: [{ key: 'attempted_at', label: 'Fecha', render: a => F.datetime(a.attempted_at) }, { key: 'tenant', label: 'Empresa', render: a => S.tenantName(a.tenant) }, { key: 'invoice_id', label: 'Comprobante', mono: true, render: a => (getRaw('saas_invoices', a.invoice_id) || {}).full_number }, { key: 'attempt_no', label: 'Intento', align: 'r' }, { key: 'trigger', label: 'Origen', render: a => ({ AUTO: 'Automático', RETRY: 'Reintento', MANUAL: 'Manual' })[a.trigger] || '—' }, { key: 'amount', label: 'Monto', align: 'r', render: a => F.money(a.amount) }, { key: 'status', label: 'Resultado', render: a => bdg(ATT_ST, a.status) }, { key: 'failure_code', label: 'Motivo' }, { key: 'gateway_ref', label: 'Referencia', mono: true }, { key: 'reconciled', label: 'Conciliado', render: a => a.status !== 'APPROVED' ? '—' : a.reconciled ? badge('Sí', 'ok') : badge('Pendiente', 'warn') }] }), { flush: true }));
    const byDay = Object.entries(U.groupBy(ok, a => dOf(a.confirmed_at || a.attempted_at))).sort((a, b) => b[0].localeCompare(a[0])).map(([d, xs]) => ({ id: d, d, n: xs.length, gross: R(U.sum(xs, a => a.amount)), fee: R(U.sum(xs, a => a.amount) * fee), net: R(U.sum(xs, a => a.amount) * (1 - fee)), deposit: G.date.add(d, 2), ok: xs.every(a => a.reconciled), xs }));
    body.appendChild(card('Conciliación con el abono de la pasarela', table({ id: 'sus13-dep', search: false, rows: byDay, columns: [{ key: 'd', label: 'Cobrado el', render: r => F.date(r.d) }, { key: 'n', label: 'Cobros', align: 'r' }, { key: 'gross', label: 'Bruto', align: 'r', render: r => F.money(r.gross) }, { key: 'fee', label: 'Comisión 3,99 %', align: 'r', render: r => F.money(r.fee) }, { key: 'net', label: 'Abono esperado', align: 'r', render: r => F.money(r.net) }, { key: 'deposit', label: 'Fecha de abono', render: r => F.date(r.deposit) }, { key: 'ok', label: 'Estado', render: r => r.ok ? badge('Conciliado', 'ok') : badge('Pendiente', 'warn') }], actions: r => !r.ok && platformCan() ? [btn('Conciliar abono', () => { for (const a of r.xs) a.reconciled = true; G.db.touch(); G.audit('CONCILIAR', 'saas_payment_attempts', r.d, `Abono de ${F.money(r.net)} del ${F.date(r.deposit)}`); toast('Abono conciliado', 'ok'); G.refresh(); }, { sm: true })] : [] }), { flush: true }));
    function attDrawer(a) {
      drawer('Cobro ' + a.gateway_ref, (bd, close) => {
        const w = getRaw('webhook_events', a.raw_event_id);
        bd.appendChild(dl([['Empresa', S.tenantName(a.tenant)], ['Comprobante', (getRaw('saas_invoices', a.invoice_id) || {}).full_number], ['Resultado', bdg(ATT_ST, a.status)], ['Monto', F.money(a.amount)], ['Pasarela', a.gateway], ['Confirmado por webhook', F.datetime(a.confirmed_at)]]));
        if (w) { bd.appendChild(h('h3', null, 'Evento crudo del webhook')); bd.appendChild(h('pre', { class: 'mono small', style: 'white-space:pre-wrap;background:var(--surface-2);padding:10px;border-radius:8px;overflow:auto' }, JSON.stringify(w.payload, null, 2))); }
        if (w && platformCan()) bd.appendChild(btn('Reenviar el mismo webhook (prueba de idempotencia)', () => { const r = tryDo(() => S.webhook(w.payload)); if (r) toast(r.duplicate ? 'RN-SUS-13: el cobro ya estaba registrado; el webhook repetido no tiene efecto.' : 'Webhook procesado', r.duplicate ? 'info' : 'ok'); close(); }, { sm: true }));
      }, { code: 'SUS-13' });
    }
  }

  /* ---------- SUS-14 Mora (consola) ---------- */
  let dunDate = null;
  function scr14(el) {
    dunDate = dunDate || today();
    const body = page(el, { code: 'SUS-14', title: scName('SUS-14'), sub: `Clientes en mora por días, próximo reintento (días ${(P('sus_payment_retry_days') || []).join(', ')}), paso previsto a solo lectura (${P('sus_grace_days')} días) o suspensión (+${P('sus_read_only_days')} días) y acciones.` });
    const subs = G.db.raw('subscriptions').filter(s => s.status !== 'CANCELLED').map(s => ({ s, info: S.dunningInfo(s, dunDate) })).filter(x => x.info && x.info.days > 0 || ['PAST_DUE', 'READ_ONLY', 'SUSPENDED'].includes(x.s.status));
    body.appendChild(kpis([{ label: 'En mora', value: subs.length, tone: subs.length ? 'warn' : 'ok' }, { label: 'Deuda vencida', value: F.money(U.sum(subs, x => x.info ? x.info.debt : 0)) }, { label: 'En solo lectura', value: subs.filter(x => x.s.status === 'READ_ONLY').length, tone: 'bad' }, { label: 'Suspendidas', value: subs.filter(x => x.s.status === 'SUSPENDED').length }]));
    const dIn = h('input', { class: 'input', type: 'date', value: dunDate, attrs: { id: 'sus14-date', 'aria-label': 'Fecha del proceso' } }); dIn.addEventListener('change', () => { dunDate = dIn.value; G.refresh(); });
    const logBox = h('div');
    body.appendChild(card('Proceso diario de mora (RN-SUS-10)', h('div', { class: 'stack' }, h('div', { class: 'row' }, h('label', { class: 'small muted' }, 'Fecha'), dIn, platformCan() ? btn('Ejecutar reintentos y cambios de estado', () => { const log = tryDo(() => S.runDunning(dunDate)); if (log) { G.ui.clear(logBox).appendChild(log.length ? h('ul', { class: 'small' }, log.map(x => h('li', null, x))) : notice('Sin cambios para esa fecha.', 'info')); } }, { kind: 'primary' }) : null), logBox)));
    body.appendChild(table({ id: 'sus14', search: false, rows: subs.map(x => ({ id: x.s.id, sub: x.s, name: S.tenantName(x.s.tenant), plan: S.planName(x.s.plan_id), status: x.s.status, days: x.info ? x.info.days : 0, debt: x.info ? x.info.debt : 0, inv: x.info ? x.info.invoice.full_number : '—', retry: x.info ? x.info.nextRetry : null, ro: x.info ? x.info.readOnlyOn : null, susp: x.info ? x.info.suspendOn : null, grace: x.s.grace_until })), onRow: r => subDrawer(r.sub), sort: 'days', dir: -1, columns: [{ key: 'name', label: 'Empresa' }, { key: 'plan', label: 'Plan' }, { key: 'status', label: 'Estado', render: r => bdg(SUB_ST, r.status) }, { key: 'inv', label: 'Comprobante', mono: true }, { key: 'debt', label: 'Deuda', align: 'r', render: r => F.money(r.debt) }, { key: 'days', label: 'Días de mora', align: 'r' }, { key: 'retry', label: 'Próximo reintento', render: r => r.retry ? F.date(r.retry) : 'Sin reintentos' }, { key: 'next', label: 'Paso previsto', sort: false, render: r => r.grace && r.grace >= dunDate ? `Prórroga hasta ${F.date(r.grace)}` : r.status === 'READ_ONLY' ? `Suspensión el ${F.date(r.susp)}` : r.status === 'SUSPENDED' ? 'Suspendida' : `Solo lectura el ${F.date(r.ro)}` }], actions: r => platformCan() ? [btn('Recordatorio', () => { insT('notifications', { user_id: null, role: 'ADMIN_SISTEMA', title: `Recordatorio de pago ${r.inv}`, body: `Deuda de ${F.money(r.debt)} con ${r.days} días de mora.`, ref: 'SUS-05', tone: 'warn', module: 'SUS', read_at: null, at: G.date.now() }, r.sub.tenant); G.audit('RECORDATORIO', 'subscriptions', r.id, r.inv); toast(`Recordatorio enviado a ${r.sub.billing_email}`, 'ok'); }, { sm: true }), btn('Prórroga', () => modal('Prórroga de ' + r.name, b2 => { b2.append(h('input', { class: 'input', type: 'date', value: G.date.add(today(), 7), attrs: { id: 'sus14-until' } }), h('input', { class: 'input', placeholder: 'Motivo (obligatorio)', attrs: { id: 'sus14-why' } })); }, [{ label: 'Cancelar' }, { label: 'Otorgar', kind: 'primary', onClick: () => tryDo(() => S.grantExtension(r.sub, document.getElementById('sus14-until').value, document.getElementById('sus14-why').value), 'Prórroga registrada') !== null }]), { sm: true, kind: 'ghost' })] : [] }));
  }

  /* ------------------------------------------------------------------
     Registro, búsqueda y alertas
     ------------------------------------------------------------------ */
  const TENANT_ROLES = ['ADMIN_SISTEMA', 'ADMINISTRACION', 'SOPORTE_PLATAFORMA'];
  const CONSOLE_ROLES = ['SOPORTE_PLATAFORMA'];
  G.register({
    code: 'SUS', name: 'Planes y suscripciones', phase: 4, group: 'Producto SaaS',
    screens: [
      { code: 'SUS-01', name: scName('SUS-01'), render: scr01, roles: TENANT_ROLES }, { code: 'SUS-02', name: scName('SUS-02'), render: scr02, roles: TENANT_ROLES }, { code: 'SUS-03', name: scName('SUS-03'), render: scr03, roles: TENANT_ROLES },
      { code: 'SUS-04', name: scName('SUS-04'), render: scr04, roles: TENANT_ROLES }, { code: 'SUS-05', name: scName('SUS-05'), render: scr05, roles: TENANT_ROLES }, { code: 'SUS-06', name: scName('SUS-06'), render: scr06, roles: TENANT_ROLES },
      { code: 'SUS-07', name: scName('SUS-07'), render: scr07, roles: TENANT_ROLES }, { code: 'SUS-08', name: scName('SUS-08'), render: scr08, roles: TENANT_ROLES },
      { code: 'SUS-09', name: scName('SUS-09'), render: scr09, roles: CONSOLE_ROLES }, { code: 'SUS-10', name: scName('SUS-10'), render: scr10, roles: CONSOLE_ROLES }, { code: 'SUS-11', name: scName('SUS-11'), render: scr11, roles: CONSOLE_ROLES },
      { code: 'SUS-12', name: scName('SUS-12'), render: scr12, roles: CONSOLE_ROLES }, { code: 'SUS-13', name: scName('SUS-13'), render: scr13, roles: CONSOLE_ROLES }, { code: 'SUS-14', name: scName('SUS-14'), render: scr14, roles: CONSOLE_ROLES },
    ],
  });
  G.searchProviders.push(q => {
    if (!G.canSee('SUS') || !isPlatformRole()) return [];
    const out = [];
    for (const s of G.db.raw('subscriptions')) if ((S.tenantName(s.tenant) + ' ' + s.billing_name + ' ' + s.billing_doc_number).toLowerCase().includes(q)) out.push({ label: S.tenantName(s.tenant), sub: `Suscripción · ${S.planName(s.plan_id)} · ${lbl(SUB_ST, s.status)}`, go: () => { G.go('SUS-11'); setTimeout(() => subDrawer(s), 0); } });
    for (const i of G.db.raw('saas_invoices')) if (String(i.full_number).toLowerCase().includes(q)) out.push({ label: i.full_number, sub: 'Comprobante del SaaS · ' + S.tenantName(i.tenant), go: () => { G.go('SUS-12'); setTimeout(() => invDrawer(i), 0); } });
    return out.slice(0, 6);
  });
  G.alertProviders.push(() => {
    const out = [];
    const sub = S.subFor(G.ctx.tenant);
    if (sub && ['PAST_DUE', 'READ_ONLY', 'SUSPENDED'].includes(sub.status)) { const i = S.dunningInfo(sub); out.push({ module: 'SUS', title: `Suscripción ${lbl(SUB_ST, sub.status).toLowerCase()}`, detail: i ? `${i.invoice.full_number} · ${F.money(i.debt)} · ${i.days} días de mora` : '', tone: sub.status === 'PAST_DUE' ? 'warn' : 'bad', go: () => G.go('SUS-08') }); }
    if (sub) for (const u of S.usage(G.ctx.tenant)) if (u.pct != null && u.pct >= 80) out.push({ module: 'SUS', title: `Uso del plan al ${F.pct(u.pct, 0)}: ${u.name.toLowerCase()}`, detail: `${F.num(u.used)} de ${F.num(u.limit)}`, tone: u.pct >= 100 ? 'bad' : 'warn', go: () => G.go('SUS-04') });
    if (G.ctx.role === 'SOPORTE_PLATAFORMA') { const n = G.db.raw('subscriptions').filter(s => ['PAST_DUE', 'READ_ONLY'].includes(s.status)).length; if (n) out.push({ module: 'SUS', title: `${n} clientes del SaaS en mora`, detail: 'Revisa la cola de mora', tone: 'warn', go: () => G.go('SUS-14') }); }
    return out;
  });

  /* ------------------------------------------------------------------
     Pruebas de aceptación (CA-SUS-01 a 08)
     ------------------------------------------------------------------ */
  const eq = (a, b, msg) => { if (Math.abs(Number(a) - Number(b)) > 0.005) throw new Error(`${msg}: se esperaba ${b} y salió ${a}`); };
  const expectFail = (fn, code, txt) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code) && (!txt || e.message.includes(txt))) return e; throw new Error(`Se esperaba ${code}${txt ? ' con «' + txt + '»' : ''} y salió: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code}`); };
  const newTenant = (id, planCode, o = {}) => S.subscribe(Object.assign({ tenant: id, plan_id: S.planByCode(planCode).id, trial: false, billing_doc_type: 'RUC', billing_doc_number: U.rucCheck(o.ruc || '2061' + String(Math.abs(hashT(id))).slice(0, 6).padEnd(6, '7')), billing_name: 'DISTRIBUIDORA DE PRUEBA ' + id + ' SAC', short: 'Prueba ' + id, actor: 'TENANT_USER' }, o));
  function hashT(s) { let x = 7; for (const c of s) x = (x * 31 + c.charCodeAt(0)) % 1000003; return x; }
  const withTenant = async (ten, fn) => { const prev = G.ctx.tenant; G.ctx.tenant = ten; try { return await fn(); } finally { G.ctx.tenant = prev; } };
  G.tests.push({ module: 'SUS', name: 'CA-SUS-01: prueba del plan Crecer: TRIAL 14 días, ADS encendido, B2B y TEL apagados, alta por TENANT_USER', fn: async () => {
    const sub = newTenant('TA1', 'CRECER', { trial: true });
    if (sub.status !== 'TRIAL') throw new Error('No quedó en TRIAL'); eq(G.date.diff(sub.trial_ends_at, G.TODAY), 14, 'Días de prueba');
    if (S.tenantRow('TA1').status !== 'TRIAL') throw new Error('El tenant no quedó en TRIAL');
    if (!tenantModOn('TA1', 'ADS')) throw new Error('ADS debía encenderse'); if (tenantModOn('TA1', 'B2B') || tenantModOn('TA1', 'TEL')) throw new Error('B2B y TEL debían quedar apagados');
    const ev = S.eventsOf(sub).find(e => e.event_type === 'CREATED'); if (!ev || ev.actor_type !== 'TENANT_USER') throw new Error('El historial no registra el alta con TENANT_USER');
    expectFail(() => newTenant('TA1B', 'CRECER', { trial: true, billing_doc_number: sub.billing_doc_number }), 'RN-SUS-15');
  } });
  G.tests.push({ module: 'SUS', name: 'CA-SUS-02: Crecer (3 marcas, 3 números): la 4.ª marca se rechaza; con 2 marcas y 3 números extra entran 5 y 6, y el 7.º número se rechaza', fn: async () => {
    const sub = newTenant('TA2', 'CRECER');
    for (let i = 1; i <= 3; i++) G.db.insert('brands', { tenant: 'TA2', code: 'B' + i, name: 'Marca ' + i, status: 'ACTIVE' });
    expectFail(() => G.db.insert('brands', { tenant: 'TA2', code: 'B4', name: 'Marca 4', status: 'ACTIVE' }), 'RN-SUS-06');
    S.addAddon(sub, 'ad-EXTRA_BRAND', 2); S.addAddon(sub, 'ad-WA_NUMBER', 3);
    for (let i = 4; i <= 5; i++) G.db.insert('brands', { tenant: 'TA2', code: 'B' + i, name: 'Marca ' + i, status: 'ACTIVE' });
    eq(S.used('TA2', 'BRANDS'), 5, 'Marcas activas');
    for (let i = 1; i <= 6; i++) G.db.insert('messaging_channels', { tenant: 'TA2', kind: 'WHATSAPP', number: '+5190000000' + i, brand_id: 'B' + Math.min(i, 5) });
    eq(S.used('TA2', 'WHATSAPP_NUMBERS'), 6, 'Números de WhatsApp');
    expectFail(() => G.db.insert('messaging_channels', { tenant: 'TA2', kind: 'WHATSAPP', number: '+51900000007' }), 'RN-SUS-06');
  } });
  G.tests.push({ module: 'SUS', name: 'CA-SUS-03: en PAST_DUE se crean pedidos; a los 7 días de mora pasa a READ_ONLY y crear un pedido o un local se rechaza con RN-SUS-07', fn: async () => {
    const sub = S.subFor('CS');
    const inv = S.issueInvoice(sub, { date: G.date.add(G.TODAY, -12), lines: [{ concept: 'OTHER', description: 'Servicio de prueba', qty: 1, unit_price: 100 }] });
    S.transition(sub, 'PAST_DUE', { reason: 'Cobro rechazado' });
    await withTenant('CS', async () => {
      const o = G.orders.create({ customer_id: 'cu-CS1', brand_id: 'br-CS', fulfillment: 'PICKUP', establishment_id: 'es-CS1' });
      if (!o) throw new Error('No se creó el pedido en mora');
      S.runDunning(G.date.add(inv.due_date, 7));
      if (sub.status !== 'READ_ONLY') throw new Error('No pasó a READ_ONLY: ' + sub.status);
      expectFail(() => G.orders.create({ customer_id: 'cu-CS1', brand_id: 'br-CS', fulfillment: 'PICKUP', establishment_id: 'es-CS1' }), 'RN-SUS-07');
      expectFail(() => G.db.insert('establishments', { code: 'AQ2', name: 'Tienda 2', status: 'ACTIVE' }), 'RN-SUS-07');
      if (!G.db.get('sales_orders', o.id)) throw new Error('El pedido existente no se consulta');
    });
  } });
  G.tests.push({ module: 'SUS', name: 'CA-SUS-04: en READ_ONLY el pago confirmado la pasa a ACTIVE al instante y el historial guarda los 4 cambios de estado', fn: async () => {
    const sub = newTenant('TA4', 'INICIA', { trial: true });
    S.setPaymentMethod(sub, { number: '4111111111111111', exp: '12/28' });
    S.transition(sub, 'ACTIVE', { reason: 'Fin de la prueba' });
    upd('subscriptions', sub, { current_period_start: G.date.add(G.TODAY, -12), current_period_end: G.date.add(G.TODAY, 17) });
    const inv = S.issueInvoice(sub, { date: G.date.add(G.TODAY, -12), lines: S.periodLines(sub) });
    S.transition(sub, 'PAST_DUE', { reason: 'Cobro rechazado' }); S.transition(sub, 'READ_ONLY', { reason: '7 días de mora' });
    await withTenant('TA4', async () => {
      expectFail(() => G.orders.create({ fulfillment: 'PICKUP' }), 'RN-SUS-07');
      const r = S.pay(inv); if (r.attempt.status !== 'APPROVED') throw new Error('El cobro no se aprobó');
      if (sub.status !== 'ACTIVE') throw new Error('No volvió a ACTIVE: ' + sub.status);
      G.orders.create({ fulfillment: 'PICKUP' });
    });
    eq(S.eventsOf(sub).filter(e => e.event_type === 'STATUS_CHANGED' && e.from_status !== e.to_status).length, 4, 'Cambios de estado');
  } });
  G.tests.push({ module: 'SUS', name: 'CA-SUS-05: 1 500 pedidos al mes: el 1 000 es 66,67 % sin aviso; el 1 200 (80 %) avisa una sola vez; el 1 600 no se bloquea', fn: async () => {
    newTenant('TA5', 'CRECER');
    const period = G.date.month(G.TODAY);
    const c = () => rawT('usage_counters', 'TA5').find(x => x.limit_key === 'ORDERS_MONTH' && x.period === period);
    S.recordUsage('TA5', 'ORDERS_MONTH', 0, { fresh: true }); c().used = 999;
    let r = S.recordUsage('TA5', 'ORDERS_MONTH', 1); eq(r.pct, 66.67, 'Uso al pedido 1 000'); if (r.alerts.length) throw new Error('No debía avisar');
    c().used = 1199; r = S.recordUsage('TA5', 'ORDERS_MONTH', 1); if (r.alerts.join() !== '80') throw new Error('Debía avisar al 80 %');
    await withTenant('TA5', async () => { G.events.emit('order.confirmed', { order_id: 'x', from: 'DRAFT' }); });
    eq(c().used, 1201, 'Conteo por pedido confirmado');
    const sub = S.subFor('TA5'); eq(S.eventsOf(sub).filter(e => e.event_type === 'USAGE_THRESHOLD' && e.detail.pct === 80).length, 1, 'Avisos del 80 %');
    c().used = 1599; await withTenant('TA5', async () => { r = S.recordUsage('TA5', 'ORDERS_MONTH', 1); G.orders.create({ fulfillment: 'PICKUP' }); });
    eq(r.used, 1600, 'Pedido 1 600');
  } });
  G.tests.push({ module: 'SUS', name: 'CA-SUS-06: período del 1 al 30/11, sube el 16: prorrateo (nuevo − anterior) × 15/30 en comprobante aparte y módulos encendidos', fn: async () => {
    const sub = newTenant('TA6', 'CRECER', { date: '2026-11-01' });
    eq(G.date.diff(sub.current_period_end, sub.current_period_start) + 1, 30, 'Días del período');
    if (tenantModOn('TA6', 'B2B')) throw new Error('B2B no debía estar encendido en Crecer');
    const r = S.changePlan(sub, S.planByCode('ESCALA').id, { date: '2026-11-16' });
    eq(r.proration.amount, R((1490 - 690) * 15 / 30), 'Prorrateo');
    if (!r.invoice || linesOf(r.invoice)[0].concept !== 'PRORATION') throw new Error('El prorrateo no salió en un comprobante aparte');
    eq(r.invoice.subtotal, 400, 'Subtotal del prorrateo');
    if (!tenantModOn('TA6', 'B2B')) throw new Error('Los módulos del plan nuevo no se encendieron');
  } });
  G.tests.push({ module: 'SUS', name: 'CA-SUS-07: Escala (multimarca) con 5 marcas no baja a Crecer: excede en 2 marcas', fn: async () => {
    const sub = newTenant('TA7', 'ESCALA');
    for (let i = 1; i <= 5; i++) G.db.insert('brands', { tenant: 'TA7', code: 'M' + i, name: 'Marca ' + i, status: 'ACTIVE' });
    expectFail(() => S.changePlan(sub, S.planByCode('CRECER').id), 'RN-SUS-18', 'excede en 2 marcas');
    if (sub.plan_id !== S.planByCode('ESCALA').id || sub.scheduled_plan_id) throw new Error('El plan cambió');
  } });
  G.tests.push({ module: 'SUS', name: 'CA-SUS-08: comprobante de S/ 118 (dos líneas de S/ 59): primer cobro rechazado, segundo aprobado → pagado; el webhook repetido se registra una vez', fn: async () => {
    const sub = newTenant('TA8', 'INICIA', { trial: true });
    S.setPaymentMethod(sub, { number: '4111111111111111', exp: '12/28' });
    const inv = S.issueInvoice(sub, { lines: [{ concept: 'PLAN', description: 'Línea 1', qty: 1, unit_price: 50 }, { concept: 'ADDON', description: 'Línea 2', qty: 1, unit_price: 50 }] });
    eq(inv.subtotal, 100, 'Subtotal'); eq(inv.igv, 18, 'IGV'); eq(inv.total, 118, 'Total'); linesOf(inv).forEach(l => eq(l.total, 59, 'Total de línea'));
    const r1 = S.pay(inv, { force: 'REJECTED' }); if (r1.attempt.status !== 'REJECTED' || inv.status !== 'OPEN') throw new Error('El primer cobro debía rechazarse');
    const r2 = S.pay(inv, { force: 'APPROVED' }); if (inv.status !== 'PAID') throw new Error('No quedó pagado');
    const dup = S.webhook(r2.webhook); if (!dup.duplicate) throw new Error('El webhook repetido tuvo efecto');
    eq(attemptsOf(inv).filter(a => a.status === 'APPROVED').length, 1, 'Cobros aprobados');
    expectFail(() => S.updateInvoice(inv, { total: 200 }), 'RN-SUS-11');
  } });
})();
