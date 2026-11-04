/* =====================================================================
   CMP · Campañas y fidelización (Fase 3)
   Segmentos dinámicos (RFM, marca, zona, recompra prevista por producto),
   campañas de WhatsApp con plantilla de marketing solo a quienes dieron
   consentimiento (Ley 29733), costo estimado y real con la tarifa de
   WhatsApp Perú, tope semanal, grupo de control, atribución a ventas
   cobradas y retorno; cupones con reglas, puntos con canje y referidos.
   ===================================================================== */
(function () {
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, modal, form, toast, confirm, tabs, pills } = G.ui;
  const U = G.util, F = G.fmt;
  const R = (n, d = 2) => U.round(n, d);
  const C = G.cmp = G.cmp || {};
  const SPEC = G.SPEC.CMP || { screens: [], name: 'Campañas y fidelización' };
  const scName = c => (SPEC.screens.find(s => s[0] === c) || [c, c])[1];
  const scSub = c => (SPEC.screens.find(s => s[0] === c) || [c, c, ''])[2];
  const P = k => G.param(k);
  const me = () => G.ctx.userId();
  const today = () => G.TODAY;
  const dOf = s => String(s || '').slice(0, 10);
  C._v = 0; const bump = () => { C._v++; };

  /* ---------- etiquetas ---------- */
  const CAMP_ST = { DRAFT: ['Borrador', ''], PENDING_APPROVAL: ['Por aprobar', 'warn'], APPROVED: ['Aprobada', 'ok'], SENDING: ['Enviando', 'info'], SENT: ['Enviada', 'info'], CANCELLED: ['Cancelada', ''] };
  const REC_ST = { QUEUED: ['En cola', ''], SKIPPED_CONSENT: ['Sin consentimiento', 'bad'], SKIPPED_FREQUENCY: ['Omitido por frecuencia', 'warn'], CONTROL: ['Grupo de control', ''], SENT: ['Enviado', 'info'], DELIVERED: ['Entregado', 'info'], READ: ['Leído', 'ok'], REPLIED: ['Respondió', 'ok'], FAILED: ['Fallido', 'bad'] };
  const OBJ = [['REPURCHASE', 'Recompra'], ['REACTIVATION', 'Reactivación'], ['LAUNCH', 'Lanzamiento'], ['PROMOTION', 'Promoción'], ['REFERRAL', 'Referidos'], ['OTHER', 'Otro']];
  const DISC = [['PCT', 'Porcentaje'], ['AMOUNT', 'Monto fijo'], ['FREE_DELIVERY', 'Delivery gratis']];
  const MOV = { EARN: ['Ganados', 'ok'], REDEEM: ['Canje', 'info'], EXPIRE: ['Vencidos', 'warn'], ADJUST: ['Ajuste', ''], REVERSAL: ['Reverso', 'bad'], REFERRAL_BONUS: ['Premio por referido', 'ok'] };
  const REF_ST = { PENDING: ['Pendiente', 'warn'], QUALIFIED: ['Calificado', 'info'], REWARDED: ['Premiado', 'ok'], REJECTED: ['Rechazado', 'bad'] };
  const RFM = [['CHAMPION', 'Campeones'], ['LOYAL', 'Leales'], ['POTENTIAL', 'Prometedores'], ['NEW', 'Nuevos'], ['AT_RISK', 'En riesgo'], ['DORMANT', 'Dormidos']];
  const lbl = (map, k) => (map[k] || [k, ''])[0];
  const bdg = (map, k) => badge(lbl(map, k), (map[k] || [k, ''])[1]);
  const objName = c => (OBJ.find(x => x[0] === c) || [c, c])[1];
  const rfmName = c => (RFM.find(x => x[0] === c) || [c, c])[1];
  const discName = c => (DISC.find(x => x[0] === c) || [c, c])[1];

  /* ------------------------------------------------------------------
     Estadísticas de clientes (una pasada por los pedidos; caché)
     ------------------------------------------------------------------ */
  let SC = null;
  const vmap = () => { const m = new Map(); for (const v of G.db.all('product_variants')) m.set(v.id, v); return m; };
  function median(a) { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  C.stats = function () {
    const os = G.db.raw('sales_orders'); const ten = G.ctx.tenant;
    const key = ten + '|' + os.length + '|' + G.db.raw('payments').length + '|' + C._v;
    if (SC && SC.key === key) return SC;
    const vm = vmap(); const by = new Map();
    for (const o of os) {
      if (o.tenant !== ten || !o.customer_id || o.status === 'DRAFT' || o.status === 'CANCELLED') continue;
      let s = by.get(o.customer_id);
      if (!s) by.set(o.customer_id, s = { id: o.customer_id, orders: [], spent: 0, brands: new Set(), zones: new Set(), channels: new Set(), products: new Map(), lines: new Set(), byBrand: new Map() });
      const d = dOf(o.created_at);
      s.orders.push(o); s.spent += Number(o.final_total ?? o.estimated_total) || 0; s.brands.add(o.brand_id); if (o.zone_id) s.zones.add(o.zone_id); s.channels.add(o.channel);
      if (!s.byBrand.has(o.brand_id)) s.byBrand.set(o.brand_id, []); s.byBrand.get(o.brand_id).push(d);
      for (const l of o.lines || []) { const v = vm.get(l.variant_id); if (!v) continue; if (!s.products.has(v.product_id)) s.products.set(v.product_id, new Set()); s.products.get(v.product_id).add(d); if (v.line) s.lines.add(v.line); }
    }
    const list = [...by.values()];
    for (const s of list) {
      s.orders.sort((a, b) => a.created_at.localeCompare(b.created_at));
      s.n = s.orders.length; s.first = dOf(s.orders[0].created_at); s.last = dOf(s.orders[s.n - 1].created_at);
      s.recency = G.date.diff(today(), s.last); s.avg = s.n ? R(s.spent / s.n) : 0; s.spent = R(s.spent);
    }
    // RFM por quintiles
    const q = (arr, v, inv) => { const i = arr.findIndex(x => x >= v); const pos = i < 0 ? arr.length : i; const sc = Math.min(5, 1 + Math.floor(pos / Math.max(1, arr.length) * 5)); return inv ? 6 - sc : sc; };
    const rs = list.map(s => s.recency).sort((a, b) => a - b), fs = list.map(s => s.n).sort((a, b) => a - b), ms = list.map(s => s.spent).sort((a, b) => a - b);
    for (const s of list) {
      s.r = q(rs, s.recency, true); s.f = q(fs, s.n); s.m = q(ms, s.spent);
      s.rfm = s.r >= 4 && s.f >= 4 ? 'CHAMPION' : s.f >= 4 ? 'LOYAL' : s.n === 1 && s.r >= 4 ? 'NEW' : s.r <= 2 && s.f >= 3 ? 'AT_RISK' : s.r <= 2 ? 'DORMANT' : 'POTENTIAL';
    }
    const addr = new Map(); for (const a of G.db.all('customer_addresses')) if (a.is_default) addr.set(a.customer_id, a);
    SC = { key, by, list, addr, vm, _rebuy: null };
    return SC;
  };
  C.statsOf = id => C.stats().by.get(id) || null;

  /* ---------- recompra prevista por producto (RN-CRM-19 / CMP-12) ---------- */
  C.productIntervals = function () {
    const st = C.stats(); if (st._pint) return st._pint;
    const per = new Map();
    for (const s of st.list) for (const [pid, ds] of s.products) {
      const d = [...ds].sort(); if (!per.has(pid)) per.set(pid, { buyers: 0, repeat: 0, gaps: [] });
      const e = per.get(pid); e.buyers++; if (d.length >= 2) e.repeat++;
      for (let i = 1; i < d.length; i++) { const g = G.date.diff(d[i], d[i - 1]); if (g >= 1) e.gaps.push(g); }
    }
    const out = new Map();
    for (const [pid, e] of per) out.set(pid, { product_id: pid, buyers: e.buyers, repeat: e.repeat, samples: e.gaps.length, interval: e.gaps.length >= 3 ? Math.round(median(e.gaps)) : null });
    st._pint = out; return out;
  };
  /** clientes con la recompra de un producto vencida: hoy > última compra + intervalo habitual */
  C.rebuyDue = function () {
    const st = C.stats(); if (st._rebuy) return st._rebuy;
    const pint = C.productIntervals(); const out = [];
    const products = new Map(G.db.all('products').map(p => [p.id, p]));
    for (const s of st.list) for (const [pid, ds] of s.products) {
      const pi = pint.get(pid); if (!pi || !pi.interval) continue;
      const d = [...ds].sort(); const own = []; for (let i = 1; i < d.length; i++) { const g = G.date.diff(d[i], d[i - 1]); if (g >= 1) own.push(g); }
      const interval = own.length ? Math.round(median(own)) : pi.interval;
      const last = d[d.length - 1]; const next = G.date.add(last, interval); const over = G.date.diff(today(), next);
      if (over <= 0) continue;
      const p = products.get(pid);
      out.push({ id: s.id + '|' + pid, customer_id: s.id, product_id: pid, brand_id: p ? p.brand_id : null, zone_id: (st.addr.get(s.id) || {}).zone_id || [...s.zones][0] || null, last, interval, own: own.length > 0, next, over, status: over > interval ? 'AT_RISK' : 'DUE', purchases: d.length });
    }
    st._rebuy = out; return out;
  };

  /* ------------------------------------------------------------------
     Consentimiento (RN-CMP-03/04) y tope semanal (RN-CMP-05)
     ------------------------------------------------------------------ */
  let CI = null;
  function consentIdx() {
    const key = G.ctx.tenant + '|' + G.db.raw('contact_consents').length + '|' + C._v;
    if (CI && CI.key === key) return CI;
    const rows = G.db.all('contact_consents');
    const m = new Map();
    for (const r of rows) if (r.purpose === 'MARKETING') { if (!m.has(r.customer_id)) m.set(r.customer_id, []); m.get(r.customer_id).push(r); }
    for (const a of m.values()) a.sort((x, y) => String(x.recorded_at).localeCompare(String(y.recorded_at)));
    CI = { key, m }; return CI;
  }
  /** customer_has_marketing_consent: el último registro (de la marca o de todas) manda; sin registro vale el consentimiento del cliente (CLI) */
  C.hasConsent = function (customer_id, brand_id, channel = 'WHATSAPP') {
    const rows = (consentIdx().m.get(customer_id) || []).filter(r => (!r.channel || r.channel === channel) && (!r.brand_id || !brand_id || r.brand_id === brand_id));
    const last = rows[rows.length - 1];
    if (last) return { ok: !!last.granted, row: last };
    const c = G.db.get('customers', customer_id);
    return { ok: !!(c && c.marketing_opt_in), row: null };
  };
  let FI = null;
  /** mensajes de marketing recibidos por cliente en los 7 días que terminan en `date` (todas las marcas) */
  C.weekCount = function (customer_id, date = today()) {
    const msgs = G.db.raw('messages'); const key = G.ctx.tenant + '|' + msgs.length + '|' + date;
    if (!FI || FI.key !== key) {
      const from = G.date.add(date, -6); const m = new Map();
      for (const x of msgs) { if (x.tenant !== G.ctx.tenant || x.kind !== 'MARKETING' || x.direction === 'IN') continue; const d = dOf(x.sent_at); if (d < from || d > date) continue; m.set(x.customer_id, (m.get(x.customer_id) || 0) + 1); }
      FI = { key, m };
    }
    return FI.m.get(customer_id) || 0;
  };
  const kwNorm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
  C.isOptOut = text => { const t = kwNorm(text); return (P('cmp_optout_keywords') || ['BAJA', 'STOP', 'NO QUIERO']).some(k => t === kwNorm(k) || t.startsWith(kwNorm(k) + ' ')); };
  /** mensaje entrante: si es una palabra de baja, registra la baja de la marca al instante y la confirma (RN-CMP-04) */
  C.inbound = function ({ customer_id, brand_id, text, campaign_id, at }) {
    const c = G.db.get('customers', customer_id); if (!c) G.fail('RN-CMP-04', 'Cliente no encontrado.');
    const ch = G.db.find('messaging_channels', x => x.kind === 'WHATSAPP' && x.brand_id === brand_id);
    G.db.insert('messages', { customer_id, channel_id: ch ? ch.id : null, direction: 'IN', kind: 'SESSION', text, sent_at: at || G.date.now(), status: 'RECEIVED', cost: 0 }, { silent: true });
    if (!C.isOptOut(text)) return { optout: false };
    const camp = campaign_id ? G.db.get('campaigns', campaign_id) : lastCampaignFor(customer_id, brand_id);
    const row = G.db.insert('contact_consents', { customer_id, purpose: 'MARKETING', granted: false, channel: 'WHATSAPP', brand_id: brand_id || null, evidence_text: `Escribió «${text}» al número de ${G.brandName(brand_id)}`, recorded_at: at || G.date.now(), source: 'KEYWORD', campaign_id: camp ? camp.id : null });
    if (camp) { const rc = G.db.find('campaign_recipients', x => x.campaign_id === camp.id && x.customer_id === customer_id); if (rc) G.db.update('campaign_recipients', rc.id, { opted_out: true }, { silent: true }); }
    if (!G._seeding) G.msg.send({ customer_id, channel_id: ch ? ch.id : null, kind: 'SESSION', text: `Listo, ${c.full_name.split(' ')[0]}: ya no te enviaremos promociones de ${G.brandName(brand_id)}. Si cambias de opinión, escribe ALTA.`, ref: 'CMP-BAJA', inServiceWindow: true });
    bump();
    G.events.emit('consent.opted_out', { customer_id, brand_id, source: 'CMP', consent_id: row.id, campaign_id: camp ? camp.id : null });
    return { optout: true, consent: row };
  };
  function lastCampaignFor(customer_id, brand_id) {
    const rs = G.db.where('campaign_recipients', x => x.customer_id === customer_id && x.sent_at && !x.is_control).sort(U.by('sent_at', -1));
    for (const r of rs) { const c = G.db.get('campaigns', r.campaign_id); if (c && (!brand_id || c.brand_id === brand_id)) return c; }
    return null;
  }
  C.setConsent = function ({ customer_id, brand_id, granted, evidence }) {
    if (!G.can('crm.consent.manage') && !G.can('cmp.campaign.manage')) G.fail('RN-CMP-03', `Tu rol (${G.roleName()}) no registra consentimientos (permiso crm.consent.manage).`);
    if (!evidence) G.fail('RN-CMP-03', 'Indica la evidencia del consentimiento o de la baja (mensaje, formulario o llamada).');
    const row = G.db.insert('contact_consents', { customer_id, purpose: 'MARKETING', granted: !!granted, channel: 'WHATSAPP', brand_id: brand_id || null, evidence_text: evidence, recorded_at: G.date.now(), source: 'MANUAL', recorded_by: me() });
    bump();
    if (!granted) G.events.emit('consent.opted_out', { customer_id, brand_id, source: 'CMP', consent_id: row.id });
    return row;
  };
  // bajas que llegan desde la bandeja del CRM
  G.events.on('consent.opted_out', p => {
    bump();
    if (!p || p.source === 'CMP' || !p.customer_id) return;
    const c = lastCampaignFor(p.customer_id, p.brand_id);
    if (c) { const rc = G.db.find('campaign_recipients', x => x.campaign_id === c.id && x.customer_id === p.customer_id); if (rc && !rc.opted_out && G.date.diff(today(), dOf(rc.sent_at)) <= 7) G.db.update('campaign_recipients', rc.id, { opted_out: true }, { silent: true }); }
  });

  /* ------------------------------------------------------------------
     Segmentos (RN-CMP-01, RN-CMP-19)
     ------------------------------------------------------------------ */
  const universe = () => G.db.where('customers', c => c.status === 'ACTIVE' && c.id !== 'cu-VARIOS' && c.phone && c.customer_type !== 'OTHER');
  /** evalúa las reglas de un segmento y devuelve los clientes */
  C.evalRules = function (rules = {}) {
    const st = C.stats(); const out = [];
    let dueSet = null;
    if (rules.rebuy_product || rules.rebuy_due) { dueSet = new Set(C.rebuyDue().filter(x => (!rules.rebuy_product || x.product_id === rules.rebuy_product) && (!rules.brands || !rules.brands.length || rules.brands.includes(x.brand_id))).map(x => x.customer_id)); }
    const inact = P('cmp_inactive_days') || 60;
    for (const c of universe()) {
      const s = st.by.get(c.id);
      if (rules.customer_types && rules.customer_types.length && !rules.customer_types.includes(c.customer_type)) continue;
      if (rules.b2b === 'ONLY' && c.customer_type === 'PERSON') continue;
      if (rules.b2b === 'EXCLUDE' && c.customer_type !== 'PERSON') continue;
      if (rules.never_bought) { if (s) continue; out.push(c); continue; }
      if (!s) continue;
      if (rules.brands && rules.brands.length && !rules.brands.some(b => s.brands.has(b))) continue;
      const rec = rules.brands && rules.brands.length === 1 && s.byBrand.has(rules.brands[0]) ? G.date.diff(today(), s.byBrand.get(rules.brands[0]).slice().sort().pop()) : s.recency;
      if (rules.last_purchase_days) { const { min, max } = rules.last_purchase_days; if (min != null && min !== '' && rec < Number(min)) continue; if (max != null && max !== '' && rec > Number(max)) continue; }
      if (rules.inactive && rec < inact) continue;
      if (rules.zones && rules.zones.length) { const z = (st.addr.get(c.id) || {}).zone_id; if (!rules.zones.includes(z) && !rules.zones.some(x => s.zones.has(x))) continue; }
      if (rules.products && rules.products.length && !rules.products.some(p => s.products.has(p))) continue;
      if (rules.lines && rules.lines.length && !rules.lines.some(l => s.lines.has(l))) continue;
      if (rules.channels && rules.channels.length && !rules.channels.some(ch => s.channels.has(ch) || c.source_channel === ch)) continue;
      if (rules.min_avg_ticket && s.avg < Number(rules.min_avg_ticket)) continue;
      if (rules.min_orders && s.n < Number(rules.min_orders)) continue;
      if (rules.rfm && rules.rfm.length && !rules.rfm.includes(s.rfm)) continue;
      if (dueSet && !dueSet.has(c.id)) continue;
      out.push(c);
    }
    return out;
  };
  C.describeRules = function (r = {}) {
    const p = [];
    if (r.brands && r.brands.length) p.push('compró ' + r.brands.map(G.brandName).join(' o '));
    if (r.last_purchase_days && (r.last_purchase_days.min || r.last_purchase_days.max)) p.push(`última compra hace ${r.last_purchase_days.min || 0}–${r.last_purchase_days.max || '∞'} días`);
    if (r.inactive) p.push(`inactivo (≥ ${P('cmp_inactive_days')} días sin comprar)`);
    if (r.never_bought) p.push('nunca compró');
    if (r.rebuy_product) p.push('recompra vencida de ' + ((G.db.get('products', r.rebuy_product) || {}).name || r.rebuy_product));
    else if (r.rebuy_due) p.push('con alguna recompra vencida');
    if (r.products && r.products.length) p.push('compró ' + r.products.map(id => (G.db.get('products', id) || {}).name || id).join(', '));
    if (r.lines && r.lines.length) p.push('línea ' + r.lines.join(', '));
    if (r.zones && r.zones.length) p.push('zona ' + r.zones.map(G.zoneName).join(', '));
    if (r.channels && r.channels.length) p.push('canal ' + r.channels.map(G.channelName).join(', '));
    if (r.min_avg_ticket) p.push('ticket promedio ≥ ' + F.money(r.min_avg_ticket));
    if (r.min_orders) p.push(`${r.min_orders}+ pedidos`);
    if (r.rfm && r.rfm.length) p.push('RFM: ' + r.rfm.map(rfmName).join(', '));
    if (r.b2b === 'ONLY') p.push('solo clientes empresa (B2B)');
    if (r.b2b === 'EXCLUDE') p.push('solo personas');
    return p.length ? p.join(' · ') : 'Todos los clientes con celular';
  };
  const segMembers = seg => G.db.where('customer_segment_members', m => m.segment_id === seg.id).map(m => m.customer_id);
  /** recalcula el segmento (RN-CMP-01): dinámico = reglas; estático = conserva su lista */
  C.refreshSegment = function (seg, opts = {}) {
    if (typeof seg === 'string') seg = G.db.get('customer_segments', seg);
    if (seg.segment_type === 'STATIC') { const n = segMembers(seg).length; G.db.update('customer_segments', seg.id, { member_count: n, last_refreshed_at: G.date.now() }, { silent: true }); return segMembers(seg); }
    const ids = C.evalRules(seg.rules).map(c => c.id);
    const arr = G.db.ensure('customer_segment_members');
    G.db.t.customer_segment_members = arr.filter(m => !(m.segment_id === seg.id && m.tenant === G.ctx.tenant));
    const at = opts.at || G.date.now();
    for (const id of ids) G.db.insert('customer_segment_members', { segment_id: seg.id, customer_id: id, added_at: at }, { silent: true });
    const consented = ids.filter(id => C.hasConsent(id, seg.brand_id).ok).length;
    G.db.update('customer_segments', seg.id, { member_count: ids.length, consent_count: consented, last_refreshed_at: at }, { silent: true });
    return ids;
  };
  const ageHours = s => s.last_refreshed_at ? Math.max(0, (Date.parse(G.date.now()) - Date.parse(s.last_refreshed_at)) / 3.6e6) : Infinity;
  C.refreshStale = function () { let n = 0; for (const s of G.db.where('customer_segments', x => x.status === 'ACTIVE' && x.segment_type === 'DYNAMIC')) if (ageHours(s) >= (s.refresh_hours || P('cmp_segment_refresh_hours') || 24)) { C.refreshSegment(s); n++; } return n; };
  const brandScopeOk = b => !b || G.scope.brands().some(x => x.id === b);
  C.saveSegment = function (vals, existing) {
    if (!G.can('cmp.segment.manage')) G.fail('RN-CMP-19', `Tu rol (${G.roleName()}) no crea segmentos (permiso cmp.segment.manage).`);
    if (!brandScopeOk(vals.brand_id)) G.fail('RN-CMP-19', `${G.brandName(vals.brand_id)} no está en tu alcance de marcas.`);
    const code = String(vals.code || '').trim().toUpperCase();
    if (!code || !vals.name) G.fail('RN-CMP-01', 'El segmento necesita código y nombre.');
    if (G.db.find('customer_segments', s => s.code === code && (!existing || s.id !== existing.id))) G.fail('RN-CMP-01', `Ya existe un segmento con el código ${code}.`);
    const row = { code, name: vals.name, brand_id: vals.brand_id || null, segment_type: vals.segment_type || 'DYNAMIC', rules: vals.rules || {}, refresh_hours: Number(vals.refresh_hours) || P('cmp_segment_refresh_hours') || 24, status: 'ACTIVE', created_by_user: me() };
    const seg = existing ? G.db.update('customer_segments', existing.id, row) : G.db.insert('customer_segments', row);
    if (seg.segment_type === 'STATIC' && vals.static_ids) { for (const id of vals.static_ids) if (!G.db.find('customer_segment_members', m => m.segment_id === seg.id && m.customer_id === id)) G.db.insert('customer_segment_members', { segment_id: seg.id, customer_id: id, added_at: G.date.now() }, { silent: true }); }
    C.refreshSegment(seg);
    return seg;
  };

  /* ------------------------------------------------------------------
     Campañas: estimación (RN-CMP-05/06/18), aprobación (RN-CMP-02), envío
     ------------------------------------------------------------------ */
  C.rate = () => G.msg.cost('MARKETING');
  C.fee = () => Number(P('cmp_bsp_fee_pen')) || 0;
  /** cálculo puro de la estimación: elegibles (con consentimiento y bajo el tope) → control y efectivos */
  C.estimate = function ({ eligible, controlPct = P('cmp_control_group_pct'), rate = C.rate(), fee = C.fee(), excludedConsent = 0, excludedFrequency = 0 }) {
    const control = Math.round(eligible * (Number(controlPct) || 0) / 100);
    const effective = eligible - control;
    const unit = R(Number(rate) + Number(fee), 4);
    const cost = R(effective * unit);
    const threshold = Number(P('cmp_approval_threshold_pen')) || 100;
    return { target: eligible + excludedConsent + excludedFrequency, excludedConsent, excludedFrequency, eligible, control, effective, unit, cost, threshold, needsGerente: cost > threshold };
  };
  const hashStr = s => { let x = 2166136261; for (const ch of String(s)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; } return x; };
  /** destinatarios planificados de una campaña (recalcula el segmento antes, RN-CMP-01) */
  C.plan = function (camp, opts = {}) {
    const seg = G.db.get('customer_segments', camp.segment_id);
    if (!seg) G.fail('RN-CMP-01', 'La campaña no tiene segmento.');
    const ids = opts.noRefresh ? segMembers(seg) : C.refreshSegment(seg);
    const date = opts.date || today(); const max = Number(P('cmp_max_marketing_per_week')) || 2;
    const rows = []; const elig = [];
    for (const id of ids) {
      if (!C.hasConsent(id, camp.brand_id).ok) { rows.push({ customer_id: id, status: 'SKIPPED_CONSENT' }); continue; }
      if (C.weekCount(id, date) >= max) { rows.push({ customer_id: id, status: 'SKIPPED_FREQUENCY' }); continue; }
      elig.push(id);
    }
    // grupo de control al azar y reproducible por campaña (RN-CMP-18)
    const r = U.rng(hashStr(camp.code || camp.id));
    const sh = elig.slice(); for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
    const est = C.estimate({ eligible: elig.length, controlPct: camp.control_group_pct, excludedConsent: rows.filter(x => x.status === 'SKIPPED_CONSENT').length, excludedFrequency: rows.filter(x => x.status === 'SKIPPED_FREQUENCY').length });
    const ctrl = new Set(sh.slice(0, est.control));
    for (const id of elig) rows.push({ customer_id: id, status: ctrl.has(id) ? 'CONTROL' : 'QUEUED', is_control: ctrl.has(id) });
    return { rows, est, seg };
  };
  C.applyEstimate = function (camp) {
    const { est } = C.plan(camp);
    G.db.update('campaigns', camp.id, { target_count: est.target, control_count: est.control, excluded_consent_count: est.excludedConsent, excluded_frequency_count: est.excludedFrequency, effective_count: est.effective, unit_cost: est.unit, estimated_cost: est.cost, estimated_at: G.date.now() }, { silent: true });
    return est;
  };
  const tplOk = (t, camp) => t && t.category === 'MARKETING' && t.provider_status === 'APPROVED' && t.brand_id === camp.brand_id && (!t.channel_id || !camp.channel_id || t.channel_id === camp.channel_id);
  C.templatesFor = (brand_id) => G.db.where('message_templates', t => t.brand_id === brand_id && t.category === 'MARKETING');
  C.createCampaign = function (v) {
    if (!G.can('cmp.campaign.manage')) G.fail('RN-CMP-19', `Tu rol (${G.roleName()}) no crea campañas (permiso cmp.campaign.manage).`);
    if (!brandScopeOk(v.brand_id)) G.fail('RN-CMP-19', `${G.brandName(v.brand_id)} no está en tu alcance de marcas.`);
    const seg = G.db.get('customer_segments', v.segment_id); if (!seg) G.fail('RN-CMP-01', 'Elige un segmento.');
    if (seg.brand_id && seg.brand_id !== v.brand_id) G.fail('RN-CMP-19', `El segmento ${seg.code} es de ${G.brandName(seg.brand_id)} y la campaña de ${G.brandName(v.brand_id)}.`);
    if ((v.channel || 'WHATSAPP') === 'EMAIL') G.fail('RN-CMP-17', 'D-CMP-04: en el arranque solo se usa WhatsApp.');
    const ch = G.db.get('messaging_channels', v.channel_id);
    if (!ch || ch.brand_id !== v.brand_id) G.fail('RN-CMP-17', `Elige un número de WhatsApp de ${G.brandName(v.brand_id)}.`);
    const t = G.db.get('message_templates', v.template_id);
    const camp0 = { brand_id: v.brand_id, channel_id: v.channel_id };
    if (!tplOk(t, camp0)) G.fail('RN-CMP-17', `La plantilla ${t ? t.name : ''} no es de marketing aprobada por Meta para el número de ${G.brandName(v.brand_id)}${t ? ` (estado: ${t.provider_status}, categoría: ${t.category})` : ''}.`);
    if (v.coupon_id) { const cp = G.db.get('coupons', v.coupon_id); if (!cp || (cp.brand_id && cp.brand_id !== v.brand_id)) G.fail('RN-CMP-08', 'El cupón no es de la marca de la campaña.'); }
    const win = Number(v.attribution_window_days || P('cmp_attribution_window_days')); if (!(win >= 1 && win <= 60)) G.fail('RN-CMP-15', 'La ventana de atribución va de 1 a 60 días.');
    const cg = Number(v.control_group_pct ?? P('cmp_control_group_pct')); if (!(cg >= 0 && cg <= 50)) G.fail('RN-CMP-18', 'El grupo de control va de 0 % a 50 %.');
    const camp = G.db.insert('campaigns', { code: G.db.next('CMP', 'CMP-', 4), name: v.name, brand_id: v.brand_id, segment_id: v.segment_id, channel: 'WHATSAPP', channel_id: v.channel_id, template_id: v.template_id, objective: v.objective || 'PROMOTION', coupon_id: v.coupon_id || null, scheduled_at: v.scheduled_at || null, attribution_window_days: win, control_group_pct: cg, created_by_user: me(), status: 'DRAFT', history: [{ at: G.date.now(), to: 'DRAFT', user: G.ctx.userName() }] });
    if (camp.coupon_id) G.db.update('coupons', camp.coupon_id, { campaign_id: camp.id }, { silent: true });
    C.applyEstimate(camp);
    return camp;
  };
  const hist = (c, to, reason) => { c.history = (c.history || []).concat([{ at: G.date.now(), from: c.status, to, user: G.ctx.userName(), reason: reason || null }]); };
  C.submit = function (c) {
    if (c.status !== 'DRAFT') G.fail('RN-CMP-02', 'Solo una campaña en borrador se envía a aprobación.');
    C.applyEstimate(c);
    hist(c, 'PENDING_APPROVAL'); G.db.update('campaigns', c.id, { status: 'PENDING_APPROVAL', history: c.history });
    G.notify({ role: c.estimated_cost > (P('cmp_approval_threshold_pen') || 100) ? 'GERENTE' : 'ADMINISTRACION', title: `Campaña ${c.code} por aprobar`, body: `${c.name}: ${c.effective_count} destinatarios, costo estimado ${F.money(c.estimated_cost)}`, ref: c.id, module: 'CMP', tone: 'info' });
    return c;
  };
  /** aprobación con umbral y quien crea no aprueba (RN-CMP-02) */
  C.approve = function (c, opts = {}) {
    if (!['PENDING_APPROVAL', 'DRAFT'].includes(c.status)) G.fail('RN-CMP-02', `La campaña está ${lbl(CAMP_ST, c.status).toLowerCase()}: no se aprueba.`);
    if (c.estimated_cost == null) G.fail('RN-CMP-02', 'Sin costo estimado no se aprueba: calcula la estimación primero.');
    const role = opts.role || G.ctx.role; const uid = opts.user_id || me();
    if (!G.can('cmp.campaign.approve', role)) G.fail('RN-CMP-02', `Tu rol (${G.roleName(role)}) no aprueba campañas.`);
    const th = Number(P('cmp_approval_threshold_pen')) || 100;
    if (c.estimated_cost > th && !G.can('cmp.campaign.approve_over_threshold', role)) G.fail('RN-CMP-02', `El costo estimado ${F.money(c.estimated_cost)} supera el umbral de ${F.money(th)}: solo la aprueba GERENTE.`);
    if (uid && uid === c.created_by_user) G.fail('RN-CMP-02', 'Quien creó la campaña no la aprueba: pide la aprobación a otra persona.');
    hist(c, 'APPROVED');
    G.db.update('campaigns', c.id, { status: 'APPROVED', approved_by: uid, approved_at: G.date.now(), history: c.history });
    G.events.emit('campaign.approved', { campaign_id: c.id, code: c.code, estimated_cost: c.estimated_cost });
    return c;
  };
  C.cancel = function (c, reason) {
    if (['SENT', 'CANCELLED'].includes(c.status)) G.fail('RN-CMP-02', 'Una campaña enviada o cancelada no se cancela.');
    if (!reason) G.fail('RN-CMP-02', 'Indica el motivo de la cancelación.');
    hist(c, 'CANCELLED', reason); G.db.update('campaigns', c.id, { status: 'CANCELLED', cancel_reason: reason, history: c.history });
  };
  /** envío individual: valida consentimiento y plantilla antes de escribir el mensaje (RN-CMP-03/17) */
  C.sendTo = function (camp, customer_id, opts = {}) {
    if (!C.hasConsent(customer_id, camp.brand_id).ok) G.fail('RN-CMP-03', `${G.custName(customer_id)} no tiene consentimiento vigente de marketing para ${G.brandName(camp.brand_id)}: no se le envía.`);
    const t = G.db.get('message_templates', camp.template_id);
    if (!tplOk(t, camp)) G.fail('RN-CMP-17', 'La plantilla no está aprobada para el número de la marca.');
    const c = G.db.get('customers', customer_id);
    const text = String(t.body || '').replace('{{1}}', (c.full_name || '').split(' ')[0]).replace('{{2}}', camp.coupon_id ? (G.db.get('coupons', camp.coupon_id) || {}).code || '' : '');
    return G.msg.send({ customer_id, channel_id: camp.channel_id, kind: 'MARKETING', template: t.name, text, ref: camp.code, at: opts.at });
  };
  /** envía una campaña aprobada (RN-CMP-02): recalcula, arma destinatarios, envía y simula entrega y lectura */
  C.send = function (c, opts = {}) {
    if (c.status !== 'APPROVED') G.fail('RN-CMP-02', 'Solo se envía una campaña aprobada y con costo estimado.');
    if (c.estimated_cost == null) G.fail('RN-CMP-02', 'La campaña no tiene costo estimado.');
    const { rows, est } = C.plan(c);
    G.db.update('campaigns', c.id, { status: 'SENDING' }, { silent: true });
    const r = U.rng(hashStr(c.code + ':envio')); const at = opts.at || G.date.now();
    let actual = 0;
    for (const x of rows) {
      const rec = { campaign_id: c.id, customer_id: x.customer_id, phone: (G.db.get('customers', x.customer_id) || {}).phone, is_control: !!x.is_control, status: x.status, message_cost: 0, opted_out: false };
      if (x.status === 'QUEUED') {
        const m = C.sendTo(c, x.customer_id);
        const fail = r() < 0.03; const read = !fail && r() < 0.72; const replied = read && r() < 0.1;
        rec.provider_message_id = 'wamid.' + m.id; rec.sent_at = at; rec.status = fail ? 'FAILED' : replied ? 'REPLIED' : read ? 'READ' : 'DELIVERED';
        if (!fail) { rec.delivered_at = at; rec.message_cost = m.cost; actual += m.cost; if (read) rec.read_at = at; }
        else { m.status = 'FAILED'; m.cost = 0; }
      }
      G.db.insert('campaign_recipients', rec, { silent: true });
    }
    actual = R(actual + C.fee() * rows.filter(x => x.status === 'QUEUED').length);
    hist(c, 'SENT');
    G.db.update('campaigns', c.id, { status: 'SENT', sent_at: at, actual_cost: actual, target_count: est.target, control_count: est.control, excluded_consent_count: est.excludedConsent, excluded_frequency_count: est.excludedFrequency, effective_count: est.effective, history: c.history });
    bump();
    G.events.emit('campaign.sent', { campaign_id: c.id, code: c.code, effective: est.effective, actual_cost: actual });
    return { est, actual };
  };

  /* ---------- atribución (RN-CMP-15) y retorno (RN-CMP-16) ---------- */
  // fac_igv_rate viene como 0.18 en la spec; G.tax.rate() del núcleo lo divide otra vez entre 100: se normaliza aquí
  const igvRate = () => { const v = Number(G.param('fac_igv_rate') ?? 0.18); return v > 1 ? v / 100 : v; };
  const collectedNoIgv = o => { const total = o.final_total ?? o.estimated_total ?? 0; return R(Math.min(o.paid_amount || 0, total) / (1 + igvRate())); };
  /** atribuye un pedido a una sola campaña: cupón de campaña o último mensaje entregado en la ventana */
  C.attributeOrder = function (o, opts = {}) {
    if (!o || !o.customer_id || ['DRAFT', 'CANCELLED'].includes(o.status)) return null;
    const ex = G.db.find('campaign_attributions', a => a.order_id === o.id);
    if (ex) { const amt = collectedNoIgv(o); if (ex.collected_amount !== amt) G.db.update('campaign_attributions', ex.id, { collected_amount: amt }, { silent: true }); return ex; }
    let camp = null, rule = null, rec = null;
    const red = G.db.find('coupon_redemptions', x => x.order_id === o.id && x.status === 'APPLIED');
    const cp = red && G.db.get('coupons', red.coupon_id);
    if (cp && cp.campaign_id) { camp = G.db.get('campaigns', cp.campaign_id); rule = 'COUPON'; rec = G.db.find('campaign_recipients', x => x.campaign_id === camp.id && x.customer_id === o.customer_id); }
    if (!camp) {
      const at = o.confirmed_at || o.created_at; const idx = opts.recIdx;
      const cand = (idx ? (idx.get(o.customer_id) || []) : G.db.where('campaign_recipients', x => x.customer_id === o.customer_id)).filter(x => !x.is_control && x.delivered_at && x.delivered_at <= at);
      let best = null;
      for (const x of cand) { const c = G.db.get('campaigns', x.campaign_id); if (!c) continue; const win = c.attribution_window_days || P('cmp_attribution_window_days') || 7; if (G.date.diff(dOf(at), dOf(x.delivered_at)) <= win && (!best || x.delivered_at > best.delivered_at)) best = x; }
      if (best) { rec = best; camp = G.db.get('campaigns', best.campaign_id); rule = 'WINDOW'; }
    }
    if (!camp) return null;
    return G.db.insert('campaign_attributions', { campaign_id: camp.id, recipient_id: rec ? rec.id : null, order_id: o.id, customer_id: o.customer_id, rule, collected_amount: collectedNoIgv(o), discount_amount: red ? red.discount_amount : 0, attributed_at: G.date.now() }, { silent: true });
  };
  C.attributeAll = function () {
    const recs = G.db.all('campaign_recipients'); if (!recs.length) return 0;
    const idx = new Map(); let first = '9999';
    for (const x of recs) { if (x.is_control || !x.delivered_at) continue; if (!idx.has(x.customer_id)) idx.set(x.customer_id, []); idx.get(x.customer_id).push(x); if (x.delivered_at < first) first = x.delivered_at; }
    let n = 0;
    for (const o of G.db.all('sales_orders')) { if (!idx.has(o.customer_id) && !o.coupon_id) continue; if ((o.confirmed_at || o.created_at) < first && !o.coupon_id) continue; if (C.attributeOrder(o, { recIdx: idx })) n++; }
    return n;
  };
  C.roi = ({ collected, cost }) => cost > 0 ? R((collected - cost) / cost, 2) : null;
  /** resultados de una campaña con lo cobrado (no lo pedido) */
  C.results = function (c) {
    const recs = G.db.where('campaign_recipients', x => x.campaign_id === c.id);
    const atts = G.db.where('campaign_attributions', a => a.campaign_id === c.id);
    const sentR = recs.filter(x => !x.is_control && x.sent_at);
    const deliv = sentR.filter(x => ['DELIVERED', 'READ', 'REPLIED'].includes(x.status));
    const read = sentR.filter(x => ['READ', 'REPLIED'].includes(x.status)).length;
    const replied = sentR.filter(x => x.status === 'REPLIED').length;
    const optouts = recs.filter(x => x.opted_out).length;
    const collected = R(U.sum(atts, a => a.collected_amount));
    const discounts = R(U.sum(atts, a => a.discount_amount));
    const msgCost = c.actual_cost != null ? R(c.actual_cost) : R(deliv.length * C.rate());
    const total = R(msgCost + discounts);
    const paidOrders = atts.filter(a => a.collected_amount > 0).length;
    // compra en la ventana: destinatarios entregados vs grupo de control
    const win = c.attribution_window_days || 7; const from = dOf(c.sent_at); const to = c.sent_at ? G.date.add(from, win) : null;
    const buyers = new Set(); if (c.sent_at) for (const o of G.db.all('sales_orders')) { if (['DRAFT', 'CANCELLED'].includes(o.status)) continue; const d = o.confirmed_at || o.created_at; if (d > c.sent_at && dOf(d) <= to) buyers.add(o.customer_id); }
    const ctrl = recs.filter(x => x.is_control);
    const rateD = deliv.length ? R(deliv.filter(x => buyers.has(x.customer_id)).length / deliv.length * 100, 1) : 0;
    const rateC = ctrl.length ? R(ctrl.filter(x => buyers.has(x.customer_id)).length / ctrl.length * 100, 1) : 0;
    const withCoupon = c.coupon_id ? deliv.length : 0;
    const redemptions = c.coupon_id ? G.db.where('coupon_redemptions', x => x.coupon_id === c.coupon_id && x.status === 'APPLIED').length : 0;
    return { recs, atts, sent: sentR.length, delivered: deliv.length, read, replied, optouts, collected, discounts, msgCost, total, orders: atts.length, paidOrders, roi: C.roi({ collected, cost: total }), buyRate: rateD, ctrlRate: rateC, lift: R(rateD - rateC, 1), control: ctrl.length, windowEnd: to, withCoupon, redemptions, costPerOrder: atts.length ? R(total / atts.length) : null };
  };

  /* ------------------------------------------------------------------
     Cupones (RN-CMP-07 a 10)
     ------------------------------------------------------------------ */
  C.couponByCode = code => G.db.find('coupons', c => String(c.code).toUpperCase() === String(code || '').trim().toUpperCase());
  C.saveCoupon = function (v, existing) {
    if (!G.can('cmp.coupon.manage')) G.fail('RN-CMP-07', `Tu rol (${G.roleName()}) no crea cupones (permiso cmp.coupon.manage).`);
    const code = String(v.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{3,20}$/.test(code)) G.fail('RN-CMP-07', 'El código va en mayúsculas, de 3 a 20 letras, números o guiones.');
    if (G.db.find('coupons', c => c.code.toUpperCase() === code && (!existing || c.id !== existing.id))) G.fail('RN-CMP-07', `El código ${code} ya existe en la empresa.`);
    if (!v.valid_from || !v.valid_to || v.valid_from >= v.valid_to) G.fail('RN-CMP-07', 'La vigencia debe tener inicio menor que fin.');
    if (!(Number(v.value) >= 0)) G.fail('RN-CMP-08', 'El valor no puede ser negativo.');
    if (v.discount_type === 'PCT' && Number(v.value) > 100) G.fail('RN-CMP-08', 'Un porcentaje no supera 100 %.');
    if (v.max_uses_total !== '' && v.max_uses_total != null && !(Number(v.max_uses_total) > 0)) G.fail('RN-CMP-08', 'Los usos totales deben ser mayores que cero.');
    if (!(Number(v.max_uses_per_customer) > 0)) G.fail('RN-CMP-08', 'Los usos por cliente deben ser mayores que cero.');
    const row = { code, brand_id: v.brand_id || null, campaign_id: v.campaign_id || null, discount_type: v.discount_type, value: Number(v.value) || 0, max_discount: v.max_discount === '' || v.max_discount == null ? null : Number(v.max_discount), min_order_amount: Number(v.min_order_amount) || 0, valid_from: v.valid_from, valid_to: v.valid_to, max_uses_total: v.max_uses_total === '' || v.max_uses_total == null ? null : Number(v.max_uses_total), max_uses_per_customer: Number(v.max_uses_per_customer) || 1, customer_id: v.customer_id || null, channels: v.channels || [], status: 'ACTIVE', description: v.description || null };
    return existing ? G.db.update('coupons', existing.id, row) : G.db.insert('coupons', row);
  };
  /** valida y calcula el descuento sin aplicarlo */
  C.checkCoupon = function (order, code, opts = {}) {
    const cp = typeof code === 'object' ? code : C.couponByCode(code);
    const date = opts.date || today();
    if (!cp) G.fail('RN-CMP-07', `El cupón ${code} no existe.`);
    if (cp.status !== 'ACTIVE') G.fail('RN-CMP-07', `El cupón ${cp.code} está ${cp.status === 'PAUSED' ? 'pausado' : 'vencido'}.`);
    if (date < dOf(cp.valid_from) || date > dOf(cp.valid_to)) G.fail('RN-CMP-07', `El cupón ${cp.code} vale del ${F.date(cp.valid_from)} al ${F.date(cp.valid_to)}; hoy es ${F.date(date)}.`);
    const other = G.db.find('coupon_redemptions', x => x.order_id === order.id && x.status === 'APPLIED');
    if (other || (order.coupon_id && order.coupon_id !== cp.id)) G.fail('RN-CMP-10', `El pedido ${order.number} ya tiene el cupón ${other ? (G.db.get('coupons', other.coupon_id) || {}).code : ''}: un pedido acepta un solo cupón.`);
    if (cp.brand_id && cp.brand_id !== order.brand_id) G.fail('RN-CMP-08', `El cupón ${cp.code} es de ${G.brandName(cp.brand_id)} y el pedido de ${G.brandName(order.brand_id)}.`);
    if (cp.channels && cp.channels.length && !cp.channels.includes(order.channel)) G.fail('RN-CMP-08', `El cupón ${cp.code} vale solo en ${cp.channels.map(G.channelName).join(', ')}.`);
    if (cp.customer_id && cp.customer_id !== order.customer_id) G.fail('RN-CMP-09', `El cupón ${cp.code} es personal de ${G.custName(cp.customer_id)}.`);
    const used = G.db.where('coupon_redemptions', x => x.coupon_id === cp.id && x.status === 'APPLIED');
    if (cp.max_uses_total && used.length >= cp.max_uses_total) G.fail('RN-CMP-08', `El cupón ${cp.code} ya llegó a sus ${cp.max_uses_total} usos.`);
    const mine = used.filter(x => x.customer_id === order.customer_id).length;
    if (mine >= (cp.max_uses_per_customer || 1)) G.fail('RN-CMP-08', `${G.custName(order.customer_id)} ya usó el cupón ${cp.code} ${mine} ${mine === 1 ? 'vez' : 'veces'} (máximo ${cp.max_uses_per_customer} por cliente).`);
    const base = R(U.sum(order.lines || [], l => l.est_amount ?? 0));
    if (base < (cp.min_order_amount || 0)) G.fail('RN-CMP-08', `El pedido suma ${F.money(base)} en productos y el cupón ${cp.code} exige un mínimo de ${F.money(cp.min_order_amount)}.`);
    let disc = cp.discount_type === 'PCT' ? R(base * cp.value / 100) : cp.discount_type === 'AMOUNT' ? Math.min(cp.value, base) : (order.delivery_fee || 0);
    if (cp.max_discount != null && cp.discount_type !== 'FREE_DELIVERY') disc = Math.min(disc, cp.max_discount);
    return { coupon: cp, base, discount: R(disc) };
  };
  /** G.cmp.applyCoupon(order, code): aplica el cupón al pedido (borrador o confirmado) y registra el canje */
  C.applyCoupon = function (order, code, opts = {}) {
    if (typeof order === 'string') order = G.db.get('sales_orders', order);
    if (!order) G.fail('RN-CMP-10', 'Pedido no encontrado.');
    if (!['DRAFT', 'CONFIRMED'].includes(order.status)) G.fail('RN-PED-07', `El pedido ${order.number} está ${G.ui.statusLabel(order.status).toLowerCase()}: el cupón se aplica en borrador o confirmado.`);
    const { coupon, discount, base } = C.checkCoupon(order, code, opts);
    if (coupon.discount_type === 'FREE_DELIVERY') order.fee_override = 0; else order.order_discount = R((order.order_discount || 0) + discount);
    order.coupon_id = coupon.id; order.coupon_code = coupon.code;
    G.orders.recalc(order);
    G.db.update('sales_orders', order.id, { coupon_id: coupon.id, coupon_code: coupon.code, order_discount: order.order_discount, estimated_total: order.estimated_total }, { silent: !!G._seeding });
    const red = G.db.insert('coupon_redemptions', { coupon_id: coupon.id, customer_id: order.customer_id, order_id: order.id, discount_amount: discount, order_amount: base, redeemed_at: opts.at || G.date.now(), status: 'APPLIED' }, { silent: true });
    if (coupon.campaign_id && order.status !== 'DRAFT') C.attributeOrder(order);
    G.events.emit('coupon.redeemed', { coupon_id: coupon.id, code: coupon.code, order_id: order.id, discount });
    return { redemption: red, discount, total: order.estimated_total };
  };
  C.removeCoupon = function (order, reason) {
    const red = G.db.find('coupon_redemptions', x => x.order_id === order.id && x.status === 'APPLIED'); if (!red) return;
    G.db.update('coupon_redemptions', red.id, { status: 'REVERSED', reversed_reason: reason || 'Pedido anulado' }, { silent: true });
    const cp = G.db.get('coupons', red.coupon_id);
    if (['DRAFT', 'CONFIRMED'].includes(order.status)) { if (cp && cp.discount_type === 'FREE_DELIVERY') order.fee_override = null; else order.order_discount = Math.max(0, R((order.order_discount || 0) - red.discount_amount)); order.coupon_id = null; order.coupon_code = null; G.orders.recalc(order); G.db.update('sales_orders', order.id, { coupon_id: null, estimated_total: order.estimated_total }, { silent: true }); }
  };
  G.events.on('order.cancelled', p => { const o = G.db.get('sales_orders', p.order_id); if (o) C.removeCoupon(o, 'Pedido cancelado'); });

  /* ------------------------------------------------------------------
     Puntos de fidelización (RN-CMP-11 a 13) · D-CMP-01: comunes a todas las marcas
     ------------------------------------------------------------------ */
  C.program = () => G.db.find('loyalty_programs', p => p.status === 'ACTIVE') || null;
  let LI = null;
  function ledgerIdx() {
    const key = G.ctx.tenant + '|' + G.db.raw('loyalty_ledger').length;
    if (LI && LI.key === key) return LI;
    const rows = G.db.all('loyalty_ledger');
    const m = new Map(); for (const r of rows) { if (!m.has(r.customer_id)) m.set(r.customer_id, []); m.get(r.customer_id).push(r); }
    LI = { key, m }; return LI;
  }
  C.ledgerOf = id => (ledgerIdx().m.get(id) || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  C.balance = id => U.sum(ledgerIdx().m.get(id) || [], r => r.points);
  /** puntos de un cobro: lo cobrado sin IGV × puntos por sol (RN-CMP-11) */
  C.pointsFor = amount => { const pr = C.program(); const ppp = pr ? pr.points_per_pen : (P('cmp_points_per_pen') || 1); return Math.floor(R(Number(amount) / (1 + igvRate())) * ppp + 1e-9); };
  C.earn = function (payment, opts = {}) {
    const pr = C.program(); if (!pr || !payment || !payment.customer_id) return null;
    const c = G.db.get('customers', payment.customer_id); if (!c || c.id === 'cu-VARIOS') return null;
    if (!opts.noCheck && G.db.find('loyalty_ledger', x => x.payment_id === payment.id && x.movement === 'EARN')) return null;
    const pts = C.pointsFor(payment.amount); if (pts <= 0) return null;
    const at = payment.paid_at || G.date.now();
    const row = G.db.insert('loyalty_ledger', { program_id: pr.id, customer_id: c.id, movement: 'EARN', points: pts, payment_id: payment.id, order_id: ((payment.allocations || [])[0] || {}).order_id || null, expires_on: G.date.add(G.date.addMonths(dOf(at), pr.expiry_months || P('cmp_points_expiry_months') || 12), Number(dOf(at).slice(8, 10)) - 1), reason: `Cobro ${payment.number} de ${F.money(payment.amount)}`, created_at: at }, { silent: true });
    if (!G._seeding) G.events.emit('loyalty.points_earned', { customer_id: c.id, points: pts, payment_id: payment.id });
    return row;
  };
  C.reversePayment = function (payment_id, reason) {
    const e = G.db.find('loyalty_ledger', x => x.payment_id === payment_id && x.movement === 'EARN'); if (!e) return null;
    if (G.db.find('loyalty_ledger', x => x.reversal_of === e.id)) return null;
    return G.db.insert('loyalty_ledger', { program_id: e.program_id, customer_id: e.customer_id, movement: 'REVERSAL', points: -e.points, payment_id, reversal_of: e.id, reason: reason || 'Cobro revertido' }, { silent: true });
  };
  C.redeem = function (customer_id, points, opts = {}) {
    const pr = C.program(); if (!pr) G.fail('RN-CMP-12', 'No hay programa de puntos activo.');
    const pts = Math.floor(Number(points));
    const min = pr.min_redeem_points || P('cmp_min_redeem_points') || 100;
    const bal = C.balance(customer_id);
    if (!(pts > 0)) G.fail('RN-CMP-12', 'Indica cuántos puntos canjear.');
    if (pts > bal) G.fail('RN-CMP-12', `${G.custName(customer_id)} tiene ${F.num(bal)} puntos e intenta canjear ${F.num(pts)}: el canje no supera el saldo.`);
    if (pts < min) G.fail('RN-CMP-12', `El canje mínimo es de ${min} puntos.`);
    const value = R(pts * (pr.pen_per_point || P('cmp_pen_per_point')));
    let order = opts.order_id ? G.db.get('sales_orders', opts.order_id) : null;
    if (order) {
      if (!['DRAFT', 'CONFIRMED'].includes(order.status)) G.fail('RN-PED-07', 'El canje se aplica a un pedido en borrador o confirmado.');
      if (order.customer_id !== customer_id) G.fail('RN-CMP-12', 'El pedido es de otro cliente.');
      order.order_discount = R((order.order_discount || 0) + value); G.orders.recalc(order); G.db.update('sales_orders', order.id, { order_discount: order.order_discount, estimated_total: order.estimated_total }, { silent: true });
    }
    return G.db.insert('loyalty_ledger', { program_id: pr.id, customer_id, movement: 'REDEEM', points: -pts, order_id: order ? order.id : null, reason: opts.reason || `Canje por ${F.money(value)}${order ? ' en ' + order.number : ''}`, value_pen: value, user_id: me() }, { silent: true });
  };
  C.adjust = function (customer_id, points, reason) {
    if (!G.can('cmp.loyalty.adjust')) G.fail('RN-CMP-13', `Tu rol (${G.roleName()}) no ajusta puntos (permiso cmp.loyalty.adjust).`);
    if (!reason) G.fail('RN-CMP-13', 'Un ajuste de puntos exige motivo.');
    const pts = Math.round(Number(points)); if (!pts) G.fail('RN-CMP-13', 'El ajuste no puede ser cero.');
    if (C.balance(customer_id) + pts < 0) G.fail('RN-CMP-12', 'El ajuste dejaría el saldo negativo.');
    const pr = C.program();
    return G.db.insert('loyalty_ledger', { program_id: pr.id, customer_id, movement: 'ADJUST', points: pts, reason, user_id: me(), expires_on: pts > 0 ? G.date.addMonths(today(), pr.expiry_months || 12) : null }, { silent: true });
  };
  C.reverse = function (row, reason) {
    if (!reason) G.fail('RN-CMP-13', 'El reverso exige motivo.');
    if (row.movement === 'REVERSAL' || G.db.find('loyalty_ledger', x => x.reversal_of === row.id)) G.fail('RN-CMP-13', 'Ese movimiento ya fue revertido.');
    if (C.balance(row.customer_id) - row.points < 0) G.fail('RN-CMP-12', 'El reverso dejaría el saldo negativo.');
    return G.db.insert('loyalty_ledger', { program_id: row.program_id, customer_id: row.customer_id, movement: 'REVERSAL', points: -row.points, reversal_of: row.id, reason, user_id: me() }, { silent: true });
  };
  /** puntos que vencen hasta `date` por cliente (FIFO: lo canjeado consume primero lo más antiguo) */
  C.expiring = function (customer_id, date) {
    const rows = (ledgerIdx().m.get(customer_id) || []).slice();
    const pos = rows.filter(r => r.points > 0 && r.movement !== 'REVERSAL' && r.expires_on).sort((a, b) => a.expires_on.localeCompare(b.expires_on));
    let used = -U.sum(rows.filter(r => r.points < 0), r => r.points);
    const out = [];
    for (const p of pos) { const take = Math.min(used, p.points); used -= take; const left = p.points - take; if (left > 0 && p.expires_on <= date) out.push({ row: p, points: left }); }
    return out;
  };
  C.runExpiry = function (date = today()) {
    let n = 0;
    for (const id of ledgerIdx().m.keys()) for (const e of C.expiring(id, date)) { if (e.row.expires_on >= date) continue; G.db.insert('loyalty_ledger', { program_id: e.row.program_id, customer_id: id, movement: 'EXPIRE', points: -e.points, reversal_of: null, reason: `Vencen puntos del ${F.date(e.row.created_at)}`, expires_on: e.row.expires_on }, { silent: true }); n++; }
    return n;
  };
  G.events.on('payment.confirmed', p => { const pay = G.db.get('payments', p.payment_id); if (pay) { C.earn(pay); for (const a of pay.allocations || []) if (a.order_id) { const o = G.db.get('sales_orders', a.order_id); if (o) { C.attributeOrder(o); C.checkReferral(o); } } } });
  G.events.on('payment.reversed', p => { C.reversePayment(p.payment_id, p.reason); });
  G.events.on('order.confirmed', p => { const o = G.db.get('sales_orders', p.order_id); if (o) C.attributeOrder(o); });
  G.events.on('order.delivered', p => { const o = G.db.get('sales_orders', p.order_id); if (o) C.checkReferral(o); });

  /* ------------------------------------------------------------------
     Referidos (RN-CMP-14) · D-CMP-02: 200 puntos al referente y cupón de 10 % al referido
     ------------------------------------------------------------------ */
  const custOrders = id => G.db.where('sales_orders', o => o.customer_id === id && o.status !== 'CANCELLED');
  C.registerReferral = function (referrer_id, referred_id, opts = {}) {
    const a = G.db.get('customers', referrer_id), b = G.db.get('customers', referred_id);
    if (!a || !b) G.fail('RN-CMP-14', 'Elige el cliente que refiere y el cliente referido.');
    if (a.id === b.id) G.fail('RN-CMP-14', 'Un cliente no puede referirse a sí mismo.');
    if (custOrders(b.id).some(o => o.status !== 'DRAFT') || (b.orders_count || 0) > 0) G.fail('RN-CMP-14', `${b.full_name} ya tiene pedidos: el referido debe ser un cliente nuevo.`);
    if (G.db.find('referrals', r => r.referred_customer_id === b.id && r.status !== 'REJECTED')) G.fail('RN-CMP-14', `${b.full_name} ya fue referido antes: solo se refiere una vez.`);
    const ref = G.db.insert('referrals', { referrer_customer_id: a.id, referred_customer_id: b.id, referral_code: a.referral_code, status: 'PENDING', created_at: opts.at || G.date.now() });
    const pr = C.program();
    const code = 'REF-' + (a.referral_code || a.id.slice(-4)) + '-' + b.id.slice(-4).toUpperCase();
    if (!C.couponByCode(code)) G.db.insert('coupons', { code, brand_id: null, discount_type: 'PCT', value: 10, max_discount: 30, min_order_amount: 0, valid_from: dOf(opts.at || today()), valid_to: G.date.add(dOf(opts.at || today()), 60), max_uses_total: 1, max_uses_per_customer: 1, customer_id: b.id, channels: [], status: 'ACTIVE', description: `Bienvenida por referido de ${a.full_name}` }, { silent: true });
    ref.welcome_coupon = code; ref.bonus_points = pr ? pr.referral_bonus_points : 200;
    return ref;
  };
  /** premio cuando el primer pedido del referido queda entregado y cobrado */
  C.checkReferral = function (o) {
    if (!o) return null;
    const ref = G.db.find('referrals', r => r.referred_customer_id === o.customer_id && ['PENDING', 'QUALIFIED'].includes(r.status)); if (!ref) return null;
    const total = o.final_total ?? o.estimated_total;
    const delivered = ['DELIVERED', 'CLOSED'].includes(o.status); const paid = (o.paid_amount || 0) >= total - 0.01;
    if (!delivered && !paid) return ref;
    if (delivered !== paid) { if (ref.status !== 'QUALIFIED' || ref.first_order_id !== o.id) G.db.update('referrals', ref.id, { status: 'QUALIFIED', first_order_id: o.id, qualified_at: G.date.now() }, { silent: true }); return ref; }
    const pr = C.program();
    const led = G.db.insert('loyalty_ledger', { program_id: pr.id, customer_id: ref.referrer_customer_id, movement: 'REFERRAL_BONUS', points: pr.referral_bonus_points || 200, order_id: o.id, expires_on: G.date.addMonths(today(), pr.expiry_months || 12), reason: `Referido ${G.custName(ref.referred_customer_id)}: primer pedido ${o.number} entregado y cobrado` }, { silent: true });
    G.db.update('referrals', ref.id, { status: 'REWARDED', first_order_id: o.id, qualified_at: ref.qualified_at || G.date.now(), rewarded_at: G.date.now(), reward_ledger_id: led.id }, { silent: true });
    G.events.emit('referral.rewarded', { referral_id: ref.id, referrer: ref.referrer_customer_id, points: led.points });
    return ref;
  };
  C.rejectReferral = function (ref, reason) { if (!reason) G.fail('RN-CMP-14', 'Indica el motivo del rechazo.'); G.db.update('referrals', ref.id, { status: 'REJECTED', reject_reason: reason }); };

  /* ------------------------------------------------------------------
     Indicadores (KPI-CMP-01 a 08)
     ------------------------------------------------------------------ */
  const campsIn = p => G.db.where('campaigns', c => c.sent_at && dOf(c.sent_at) >= (p.from || '0000') && dOf(c.sent_at) <= (p.to || '9999') && (!p.brand || c.brand_id === p.brand));
  const agg = p => { const cs = campsIn(p); const rs = cs.map(C.results); return { cs, rs }; };
  G.kpiCalc['KPI-CMP-01'] = p => { const { rs } = agg(p); const d = U.sum(rs, r => r.delivered); const b = U.sum(rs, r => Math.round(r.buyRate * r.delivered / 100)); return { value: d ? R(b / d * 100, 1) : 0, numerator: b, denominator: d }; };
  G.kpiCalc['KPI-CMP-02'] = p => { const { rs } = agg(p); const col = U.sum(rs, r => r.collected), cost = U.sum(rs, r => r.total); return { value: C.roi({ collected: col, cost }) ?? 0, numerator: R(col - cost), denominator: R(cost) }; };
  G.kpiCalc['KPI-CMP-03'] = p => { const { rs } = agg(p); const cost = U.sum(rs, r => r.total), n = U.sum(rs, r => r.orders); return { value: n ? R(cost / n) : 0, numerator: R(cost), denominator: n }; };
  G.kpiCalc['KPI-CMP-04'] = p => { const { rs } = agg(p); const o = U.sum(rs, r => r.optouts), d = U.sum(rs, r => r.delivered); return { value: d ? R(o / d * 100, 2) : 0, numerator: o, denominator: d }; };
  G.kpiCalc['KPI-CMP-05'] = p => { const { rs } = agg(p); const w = U.sum(rs, r => r.withCoupon), u = U.sum(rs, r => r.redemptions); return { value: w ? R(u / w * 100, 1) : 0, numerator: u, denominator: w }; };
  G.kpiCalc['KPI-CMP-06'] = () => { const pr = C.program(); const pts = U.sum(G.db.all('loyalty_ledger'), r => r.points); return { value: R(pts * (pr ? pr.pen_per_point : P('cmp_pen_per_point'))), numerator: pts, denominator: null }; };
  G.kpiCalc['KPI-CMP-07'] = p => G.db.where('referrals', r => r.status === 'REWARDED' && dOf(r.rewarded_at || r.qualified_at) >= (p.from || '0000') && dOf(r.rewarded_at || r.qualified_at) <= (p.to || '9999')).length;
  G.kpiCalc['KPI-CMP-08'] = p => { const { rs } = agg(p); const d = U.sum(rs, r => r.delivered), c = U.sum(rs, r => r.control); if (!d || !c) return 0; const bd = U.sum(rs, r => r.buyRate * r.delivered / 100), bc = U.sum(rs, r => r.ctrlRate * r.control / 100); return { value: R(bd / d * 100 - bc / c * 100, 1), numerator: R(bd / d * 100, 1), denominator: R(bc / c * 100, 1) }; };

  /* ------------------------------------------------------------------
     Semilla (orden 64)
     ------------------------------------------------------------------ */
  G.seed(64, function seedCMP() {
    const r = U.rng(6464);
    const ins = (t, row) => G.db.insert(t, row, { silent: true });
    const custs = G.db.where('customers', c => c.customer_type !== 'OTHER' && c.id !== 'cu-VARIOS');
    // customers.referral_code (A() de la fase 3)
    const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
    for (const c of custs) if (!c.referral_code) c.referral_code = (norm((c.trade_name || c.full_name || '').split(' ')[0]).slice(0, 5) || 'CLI') + c.id.replace(/\D/g, '').slice(-4).padStart(4, '0');
    // consentimientos de marketing (registro único de CRM): si CRM no los sembró, se toman de CLI
    const have = new Set(G.db.where('contact_consents', x => x.purpose === 'MARKETING').map(x => x.customer_id));
    for (const c of custs) if (!have.has(c.id) && c.phone) ins('contact_consents', { customer_id: c.id, purpose: 'MARKETING', granted: !!c.marketing_opt_in, channel: 'WHATSAPP', brand_id: null, evidence_text: c.marketing_opt_in ? 'Aceptó recibir promociones al confirmar su primer pedido por WhatsApp' : 'No aceptó promociones en su primer pedido', recorded_at: c.first_order_at || '2026-09-01T09:00', source: 'FIRST_ORDER' });
    // plantillas de marketing aprobadas por número de cada marca (si CRM aún no las tiene)
    const TPL = { 'br-DG': [['cmp_vuelve_cuy', 'REENGAGE', 'Hola {{1}}, te extrañamos en Don Guando. Tu cuy entero dorado te espera; usa el código {{2}} y recíbelo hoy. Responde BAJA si no deseas promociones.'], ['cmp_recompra_dg', 'REBUY', 'Hola {{1}}, ya toca reponer tu cuy y tu caldo. Pide hoy y te lo llevamos en tu franja favorita. Código {{2}}. BAJA para no recibir más.']], 'br-M2': [['cmp_parrilla_m2', 'PROMOTION', 'Hola {{1}}, fin de semana de parrilla: bondiola y chuleta al punto. Código {{2}}. Responde BAJA para no recibir promociones.']], 'br-M3': [['cmp_lanzamiento_m3', 'PROMOTION', 'Hola {{1}}, llegaron los nuevos embutidos artesanales de Marca 3. Código {{2}}. BAJA para no recibir más.']], 'br-M4': [['cmp_despensa_m4', 'PROMOTION', 'Hola {{1}}, tu despensa de quincena con precios de mayorista. Código {{2}}. BAJA para no recibir más.']], 'br-M5': [['cmp_gourmet_m5', 'PROMOTION', 'Hola {{1}}, café, mermeladas y frutos secos para tu fin de semana. Código {{2}} con 10 %. BAJA para no recibir más.']] };
    for (const [b, list] of Object.entries(TPL)) {
      if (G.db.find('message_templates', t => t.brand_id === b && t.category === 'MARKETING' && t.provider_status === 'APPROVED')) continue;
      const ch = G.db.find('messaging_channels', x => x.kind === 'WHATSAPP' && x.brand_id === b);
      for (const [name, purpose, body] of list) ins('message_templates', { id: 'mt-' + name, brand_id: b, channel_id: ch ? ch.id : null, name, language: 'es', category: 'MARKETING', purpose, body, variables: ['nombre', 'cupon'], provider_template_id: 'HSM-' + name.toUpperCase(), provider_status: 'APPROVED' });
    }
    const chDG = G.db.find('messaging_channels', x => x.kind === 'WHATSAPP' && x.brand_id === 'br-DG');
    if (!G.db.find('message_templates', t => t.name === 'cmp_cancion_criolla')) ins('message_templates', { id: 'mt-cmp_cancion_criolla', brand_id: 'br-DG', channel_id: chDG ? chDG.id : null, name: 'cmp_cancion_criolla', language: 'es', category: 'MARKETING', purpose: 'PROMOTION', body: 'Hola {{1}}, celebra la Canción Criolla con cuy y pachamanca. Código {{2}}.', variables: ['nombre', 'cupon'], provider_status: 'PENDING' });
    if (!G.db.find('message_templates', t => t.name === 'cmp_sorteo_m4')) ins('message_templates', { id: 'mt-cmp_sorteo_m4', brand_id: 'br-M4', channel_id: null, name: 'cmp_sorteo_m4', language: 'es', category: 'MARKETING', purpose: 'PROMOTION', body: 'Participa en el sorteo de una canasta.', variables: [], provider_status: 'REJECTED', reject_reason: 'Meta: el sorteo no indica bases ni condiciones' });
    const tplOf = b => G.db.find('message_templates', t => t.brand_id === b && t.category === 'MARKETING' && t.provider_status === 'APPROVED');
    const chOf = b => G.db.find('messaging_channels', x => x.kind === 'WHATSAPP' && x.brand_id === b);
    const mkt = G.db.find('users', u => u.role === 'MARKETING'); const ger = G.db.find('users', u => u.role === 'GERENTE'); const adm = G.db.find('users', u => u.role === 'ADMINISTRACION');
    // programa de puntos (D-CMP-01: común a todas las marcas)
    const prog = ins('loyalty_programs', { id: 'lp-DG', code: 'PUNTOS-DG', name: 'Puntos Don Guando (todas las marcas)', brand_id: null, points_per_pen: P('cmp_points_per_pen') || 1, pen_per_point: P('cmp_pen_per_point') || 0.05, min_redeem_points: P('cmp_min_redeem_points') || 100, expiry_months: P('cmp_points_expiry_months') || 12, referral_bonus_points: 200, status: 'ACTIVE', created_at: '2026-09-01T08:00' });
    // segmentos
    const cuyProd = (G.variant('va-DG-CUY-ENT') || {}).product_id;
    const surco = G.db.where('delivery_zones', z => /SURCO/i.test(z.id + ' ' + z.name)).map(z => z.id);
    const SEGS = [
      ['SEG-DG-CUY', 'Don Guando · recompra de cuy vencida', 'br-DG', { brands: ['br-DG'], rebuy_product: cuyProd }],
      ['SEG-DG-14', 'Don Guando · sin compra hace 14 días o más', 'br-DG', { brands: ['br-DG'], last_purchase_days: { min: 14, max: null }, b2b: 'EXCLUDE' }],
      ['SEG-INA-60', 'Inactivos de todas las marcas (60–120 días)', null, { inactive: true, last_purchase_days: { min: 60, max: 120 } }],
      ['SEG-RFM-TOP', 'Campeones y leales (RFM)', 'br-DG', { rfm: ['CHAMPION', 'LOYAL'], brands: ['br-DG'] }],
      ['SEG-M2-SUR', 'Marca 2 · parrilleros de Surco', 'br-M2', { brands: ['br-M2'], zones: surco }],
      ['SEG-M3-ALL', 'Marca 3 · compradores de embutidos', 'br-M3', { brands: ['br-M3'] }],
      ['SEG-M5-GOU', 'Marca 5 · clientes gourmet', 'br-M5', { brands: ['br-M5'] }],
      ['SEG-B2B', 'Restaurantes y negocios (B2B)', 'br-DG', { b2b: 'ONLY' }],
      ['SEG-M4-TICK', 'Marca 4 · ticket alto (S/ 80 o más)', 'br-M4', { brands: ['br-M4'], min_avg_ticket: 80 }],
    ];
    const segs = {};
    for (const [code, name, brand, rules] of SEGS) { segs[code] = ins('customer_segments', { id: 'sg-' + code, code, name, brand_id: brand, segment_type: 'DYNAMIC', rules, refresh_hours: 24, member_count: 0, status: 'ACTIVE', created_by_user: mkt ? mkt.id : null, created_at: '2026-09-05T10:00' }); C.refreshSegment(segs[code], { at: '2026-10-10T06:00' }); }
    // segmento estático: lista de la feria de degustación
    const st = ins('customer_segments', { id: 'sg-SEG-FERIA', code: 'SEG-FERIA', name: 'Lista de degustación · Feria Mistura Surco (estática)', brand_id: 'br-M3', segment_type: 'STATIC', rules: {}, refresh_hours: 168, member_count: 0, status: 'ACTIVE', created_by_user: mkt ? mkt.id : null, created_at: '2026-09-28T18:00' });
    const pers = custs.filter(c => c.customer_type === 'PERSON' && c.phone);
    for (let i = 0; i < 38; i++) { const c = pers[(i * 11 + 7) % pers.length]; if (!G.db.find('customer_segment_members', m => m.segment_id === st.id && m.customer_id === c.id)) ins('customer_segment_members', { segment_id: st.id, customer_id: c.id, added_at: '2026-09-28T18:00' }); }
    C.refreshSegment(st, { at: '2026-10-10T06:00' }); segs['SEG-FERIA'] = st;
    // cupones
    const CP = [
      ['VUELVE10', 'br-DG', 'PCT', 10, 25, 0, '2026-10-01', '2026-10-31', null, 1, null, ['WHATSAPP', 'WEB'], 'Reactivación de clientes Don Guando'],
      ['CUY5', 'br-DG', 'AMOUNT', 5, null, 60, '2026-10-05', '2026-10-12', 300, 1, null, [], 'S/ 5 en pedidos de S/ 60 o más'],
      ['GOURMET10', 'br-M5', 'PCT', 10, 20, 40, '2026-10-08', '2026-10-15', 200, 1, null, [], 'Fin de semana gourmet'],
      ['PARRILLA', 'br-M2', 'FREE_DELIVERY', 0, null, 70, '2026-10-15', '2026-10-19', 150, 1, null, ['WHATSAPP'], 'Delivery gratis de quincena'],
      ['CRIOLLA15', 'br-DG', 'PCT', 15, 30, 80, '2026-10-29', '2026-11-01', 250, 1, null, [], 'Día de la Canción Criolla'],
      ['NOV-CUY', 'br-DG', 'AMOUNT', 8, null, 70, '2026-11-01', '2026-11-30', null, 2, null, [], 'Promoción de noviembre'],
      ['SETIEMBRE15', 'br-M3', 'PCT', 15, 20, 0, '2026-09-21', '2026-09-30', 100, 1, null, [], 'Lanzamiento Marca 3 (vencido)'],
    ];
    const cps = {};
    for (const [code, b, t, v, mx, mn, f, to, tot, per, cu, chs, desc] of CP) cps[code] = ins('coupons', { id: 'cp-' + code, code, brand_id: b, campaign_id: null, discount_type: t, value: v, max_discount: mx, min_order_amount: mn, valid_from: f, valid_to: to, max_uses_total: tot, max_uses_per_customer: per, customer_id: cu, channels: chs, status: to < G.TODAY ? 'EXPIRED' : 'ACTIVE', description: desc, created_at: '2026-09-15T09:00' });
    // índice de pedidos por cliente para simular compras
    const ordersBy = new Map(); for (const o of G.db.all('sales_orders')) { if (['DRAFT', 'CANCELLED'].includes(o.status)) continue; if (!ordersBy.has(o.customer_id)) ordersBy.set(o.customer_id, []); ordersBy.get(o.customer_id).push(o); }
    const boughtBrandBefore = (cid, b, d) => (ordersBy.get(cid) || []).some(o => o.brand_id === b && o.created_at < d);
    const boughtIn = (cid, from, to) => (ordersBy.get(cid) || []).some(o => o.created_at > from && dOf(o.created_at) <= to);
    // campañas pasadas con resultados
    let seq = 0; const nextCode = () => { seq++; G.db.seq['DG:CMP'] = seq; return 'CMP-' + U.pad(seq, 4); };
    function past(name, b, segCode, obj, sentAt, coupon, cap) {
      const code = nextCode(); const tpl = tplOf(b), ch = chOf(b); const seg = segs[segCode];
      const c = ins('campaigns', { id: 'cm-' + code, code, name, brand_id: b, segment_id: seg.id, channel: 'WHATSAPP', channel_id: ch ? ch.id : null, template_id: tpl ? tpl.id : null, objective: obj, coupon_id: coupon ? cps[coupon].id : null, scheduled_at: sentAt, attribution_window_days: 7, control_group_pct: 10, created_by_user: mkt ? mkt.id : null, approved_by: ger ? ger.id : null, approved_at: G.date.add(dOf(sentAt), -1) + 'T16:00', status: 'SENT', sent_at: sentAt, created_at: G.date.add(dOf(sentAt), -3) + 'T11:00', history: [{ at: G.date.add(dOf(sentAt), -3) + 'T11:00', to: 'DRAFT', user: mkt ? mkt.name : 'Marketing' }, { at: G.date.add(dOf(sentAt), -2) + 'T09:00', from: 'DRAFT', to: 'PENDING_APPROVAL', user: mkt ? mkt.name : 'Marketing' }, { at: G.date.add(dOf(sentAt), -1) + 'T16:00', from: 'PENDING_APPROVAL', to: 'APPROVED', user: ger ? ger.name : 'Gerencia' }, { at: sentAt, from: 'APPROVED', to: 'SENT', user: 'Sistema' }] });
      if (coupon) cps[coupon].campaign_id = c.id;
      const cands = pers.filter(x => boughtBrandBefore(x.id, b, sentAt)).slice(0, cap);
      const max = P('cmp_max_marketing_per_week') || 2;
      let ex1 = 0, ex2 = 0; const elig = [];
      for (const x of cands) { if (!C.hasConsent(x.id, b).ok) { ex1++; ins('campaign_recipients', { campaign_id: c.id, customer_id: x.id, phone: x.phone, is_control: false, status: 'SKIPPED_CONSENT', message_cost: 0, opted_out: false }); continue; } if (C.weekCount(x.id, dOf(sentAt)) >= max) { ex2++; ins('campaign_recipients', { campaign_id: c.id, customer_id: x.id, phone: x.phone, is_control: false, status: 'SKIPPED_FREQUENCY', message_cost: 0, opted_out: false }); continue; } elig.push(x); }
      const win = G.date.add(dOf(sentAt), 7);
      const est = C.estimate({ eligible: elig.length, controlPct: 10, excludedConsent: ex1, excludedFrequency: ex2 });
      // grupo de control: al azar (el seed favorece a quienes no compraron para mostrar el incremento)
      const nb = elig.filter(x => !boughtIn(x.id, sentAt, win)), yb = elig.filter(x => boughtIn(x.id, sentAt, win));
      const ctrl = new Set(); const want = Math.round(est.control * 0.8); for (const x of nb) { if (ctrl.size >= want) break; if (r() < 0.6) ctrl.add(x.id); } for (const x of yb) { if (ctrl.size >= est.control) break; if (r() < 0.5) ctrl.add(x.id); } for (const x of nb.concat(yb)) { if (ctrl.size >= est.control) break; ctrl.add(x.id); }
      let cost = 0, eff = 0;
      for (const x of elig) {
        if (ctrl.has(x.id)) { ins('campaign_recipients', { campaign_id: c.id, customer_id: x.id, phone: x.phone, is_control: true, status: 'CONTROL', message_cost: 0, opted_out: false }); continue; }
        eff++;
        const fail = r() < 0.03, read = !fail && r() < 0.74, rep = read && r() < 0.1, rate = C.rate();
        const at = dOf(sentAt) + 'T' + sentAt.slice(11, 13) + ':' + U.pad(Math.floor(r() * 50), 2);
        ins('messages', { customer_id: x.id, channel_id: ch ? ch.id : null, direction: 'OUT', kind: 'MARKETING', template: tpl ? tpl.name : null, text: (tpl ? tpl.body : '').replace('{{1}}', x.full_name.split(' ')[0]).replace('{{2}}', coupon || ''), ref: code, sent_at: at, status: fail ? 'FAILED' : read ? 'READ' : 'DELIVERED', cost: fail ? 0 : rate });
        const rc = ins('campaign_recipients', { campaign_id: c.id, customer_id: x.id, phone: x.phone, is_control: false, status: fail ? 'FAILED' : rep ? 'REPLIED' : read ? 'READ' : 'DELIVERED', message_cost: fail ? 0 : rate, provider_message_id: 'wamid.' + code + '.' + x.id, sent_at: at, delivered_at: fail ? null : at, read_at: read ? at : null, opted_out: false });
        if (!fail) cost += rate;
        if (!fail && r() < 0.012) { C.inbound({ customer_id: x.id, brand_id: b, text: U.pick(r, ['BAJA', 'Baja', 'STOP', 'no quiero']), campaign_id: c.id, at: dOf(sentAt) + 'T' + U.pad(Number(sentAt.slice(11, 13)) + 1, 2) + ':20' }); rc.opted_out = true; }
      }
      Object.assign(c, { target_count: est.target, control_count: ctrl.size, excluded_consent_count: ex1, excluded_frequency_count: ex2, effective_count: eff, unit_cost: est.unit, estimated_cost: R(est.effective * est.unit), actual_cost: R(cost), estimated_at: G.date.add(dOf(sentAt), -2) + 'T09:00' });
      return c;
    }
    past('Vuelve por tu cuy de setiembre', 'br-DG', 'SEG-DG-14', 'REACTIVATION', '2026-09-14T10:00', null, 230);
    past('Lanzamiento de embutidos artesanales', 'br-M3', 'SEG-M3-ALL', 'LAUNCH', '2026-09-21T11:00', 'SETIEMBRE15', 160);
    past('Recompra de cuy y caldo · octubre', 'br-DG', 'SEG-DG-CUY', 'REPURCHASE', '2026-10-05T10:00', 'CUY5', 240);
    const c4 = past('Fin de semana gourmet', 'br-M5', 'SEG-M5-GOU', 'PROMOTION', '2026-10-08T17:00', 'GOURMET10', 140);
    // próximas campañas (calendario, aprobación y borrador)
    function future(name, b, segCode, obj, at, coupon, status, creator) {
      const code = nextCode(); const tpl = tplOf(b), ch = chOf(b);
      const c = ins('campaigns', { id: 'cm-' + code, code, name, brand_id: b, segment_id: segs[segCode].id, channel: 'WHATSAPP', channel_id: ch ? ch.id : null, template_id: tpl ? tpl.id : null, objective: obj, coupon_id: coupon ? cps[coupon].id : null, scheduled_at: at, attribution_window_days: 7, control_group_pct: 10, created_by_user: creator ? creator.id : null, status, created_at: '2026-10-08T10:00', history: [{ at: '2026-10-08T10:00', to: 'DRAFT', user: creator ? creator.name : 'Marketing' }].concat(status !== 'DRAFT' ? [{ at: '2026-10-09T09:00', from: 'DRAFT', to: status === 'CANCELLED' ? 'CANCELLED' : 'PENDING_APPROVAL', user: creator ? creator.name : '' }] : []).concat(status === 'APPROVED' ? [{ at: '2026-10-09T15:30', from: 'PENDING_APPROVAL', to: 'APPROVED', user: adm ? adm.name : '' }] : []) });
      if (coupon) cps[coupon].campaign_id = c.id;
      if (status === 'APPROVED') { c.approved_by = adm ? adm.id : null; c.approved_at = '2026-10-09T15:30'; }
      if (status === 'CANCELLED') c.cancel_reason = 'Se cruza con la campaña de Don Guando de la misma semana (CMP-13)';
      C.applyEstimate(c);
      return c;
    }
    future('Quincena parrillera con delivery gratis', 'br-M2', 'SEG-M2-SUR', 'PROMOTION', '2026-10-15T10:00', 'PARRILLA', 'APPROVED', mkt);
    future('Canción Criolla: cuy y pachamanca', 'br-DG', 'SEG-RFM-TOP', 'PROMOTION', '2026-10-29T09:00', 'CRIOLLA15', 'PENDING_APPROVAL', mkt);
    future('Lista de precios de noviembre para restaurantes', 'br-DG', 'SEG-B2B', 'REPURCHASE', '2026-11-03T08:30', null, 'DRAFT', mkt);
    future('Despensa de quincena', 'br-M4', 'SEG-M4-TICK', 'PROMOTION', '2026-10-14T10:00', null, 'CANCELLED', mkt);
    future('Degustación de la feria: gracias por visitarnos', 'br-M3', 'SEG-FERIA', 'LAUNCH', '2026-10-21T18:00', null, 'DRAFT', mkt);
    // cupones aplicados hoy (borradores y confirmados sin cobro) de destinatarios de la campaña gourmet y de VUELVE10
    const c4rec = new Set(G.db.where('campaign_recipients', x => x.campaign_id === c4.id && !x.is_control && x.delivered_at).map(x => x.customer_id));
    let nG = 0, nV = 0;
    for (const o of G.db.where('sales_orders', o => ['DRAFT', 'CONFIRMED'].includes(o.status) && !(o.paid_amount > 0) && o.lines.length)) {
      try {
        if (o.brand_id === 'br-M5' && nG < 3 && (c4rec.has(o.customer_id) || nG < 1)) { if (!c4rec.has(o.customer_id)) { const x = G.db.get('customers', o.customer_id); if (!C.hasConsent(x.id, 'br-M5').ok) continue; ins('campaign_recipients', { campaign_id: c4.id, customer_id: x.id, phone: x.phone, is_control: false, status: 'READ', message_cost: C.rate(), sent_at: '2026-10-08T17:12', delivered_at: '2026-10-08T17:12', read_at: '2026-10-08T17:40', opted_out: false }); } C.applyCoupon(o, 'GOURMET10', { at: o.created_at }); nG++; }
        else if (o.brand_id === 'br-DG' && nV < 4 && ['WHATSAPP', 'WEB'].includes(o.channel)) { C.applyCoupon(o, 'VUELVE10', { at: o.created_at }); nV++; }
      } catch (e) { /* el pedido no cumple el mínimo del cupón */ }
    }
    C.attributeAll();
    // puntos: un movimiento EARN por cada cobro confirmado (D-CMP-01: comunes a todas las marcas)
    for (const pay of G.db.where('payments', p => p.status === 'CONFIRMED' && p.customer_id && p.customer_id !== 'cu-VARIOS')) C.earn(pay, { noCheck: true });
    const rich = [...ledgerIdx().m.entries()].map(([id, rows]) => [id, U.sum(rows, x => x.points)]).filter(x => x[1] >= 400).slice(0, 18);
    for (const [id, bal] of rich) { const pts = Math.max(100, Math.floor(bal * (0.3 + r() * 0.4) / 50) * 50); const o = (ordersBy.get(id) || []).filter(x => x.created_at >= '2026-10-01').pop(); ins('loyalty_ledger', { program_id: prog.id, customer_id: id, movement: 'REDEEM', points: -pts, order_id: o ? o.id : null, reason: `Canje por ${F.money(pts * prog.pen_per_point)}${o ? ' en ' + o.number : ''}`, value_pen: R(pts * prog.pen_per_point), created_at: o ? o.created_at : '2026-10-03T12:00' }); }
    if (rich[0]) ins('loyalty_ledger', { program_id: prog.id, customer_id: rich[0][0], movement: 'ADJUST', points: 50, reason: 'Compensación por demora de entrega (reclamo CRM)', user_id: adm ? adm.id : null, expires_on: '2027-10-04', created_at: '2026-10-04T16:00' });
    // referidos
    const loyal = pers.filter(c => (c.orders_count || 0) >= 4).slice(0, 12);
    const newbies = pers.filter(c => c.first_order_at && c.first_order_at >= '2026-09-20' && !G.db.find('referrals', x => x.referred_customer_id === c.id)).slice(0, 6);
    newbies.forEach((nb, i) => {
      const ref = loyal[i % loyal.length]; if (!ref || ref.id === nb.id) return;
      const at = G.date.add(dOf(nb.first_order_at), -1) + 'T19:00';
      const rr = ins('referrals', { referrer_customer_id: ref.id, referred_customer_id: nb.id, referral_code: ref.referral_code, status: 'PENDING', created_at: at });
      const first = (ordersBy.get(nb.id) || [])[0];
      if (first && ['DELIVERED', 'CLOSED'].includes(first.status) && (first.paid_amount || 0) >= (first.final_total ?? first.estimated_total) - 0.01) {
        const led = ins('loyalty_ledger', { program_id: prog.id, customer_id: ref.id, movement: 'REFERRAL_BONUS', points: 200, order_id: first.id, expires_on: G.date.addMonths(dOf(first.delivered_at || first.created_at), 12), reason: `Referido ${nb.full_name}: primer pedido ${first.number} entregado y cobrado`, created_at: first.delivered_at || first.created_at });
        Object.assign(rr, { status: 'REWARDED', first_order_id: first.id, qualified_at: first.delivered_at, rewarded_at: first.delivered_at, reward_ledger_id: led.id });
      } else if (first) Object.assign(rr, { status: 'QUALIFIED', first_order_id: first.id, qualified_at: first.created_at });
    });
    const never = pers.filter(c => !c.orders_count && c.phone).slice(0, 2);
    if (never[0] && loyal[1]) ins('referrals', { referrer_customer_id: loyal[1].id, referred_customer_id: never[0].id, referral_code: loyal[1].referral_code, status: 'PENDING', created_at: '2026-10-09T20:15' });
    if (never[1] && loyal[2]) ins('referrals', { referrer_customer_id: loyal[2].id, referred_customer_id: never[1].id, referral_code: loyal[2].referral_code, status: 'REJECTED', reject_reason: 'Mismo celular y dirección que el referente (posible autorreferido)', created_at: '2026-10-02T12:00' });
    bump();
  }, 'campañas y fidelización');

  /* ------------------------------------------------------------------
     Componentes de interfaz
     ------------------------------------------------------------------ */
  const brandOpts = (all = true) => (all ? [['', 'Todas las marcas']] : []).concat(G.scope.brands().map(b => [b.id, G.brandName(b.id)]));
  const brandDot = id => { const b = G.db.get('brands', id); return h('span', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, h('i', { style: `display:inline-block;width:9px;height:9px;border-radius:50%;background:${b ? b.primary_color : 'var(--muted)'}` }), id ? G.brandName(id) : 'Todas'); };
  const inScope = row => !row.brand_id || G.scope.ok(row);
  const fld = (label, input, help) => h('div', { class: 'field' }, h('label', null, label), input, help ? h('div', { class: 'help' }, help) : null);
  const sel = (opts, value, onChange, attrs) => { const s = h('select', { class: 'input', attrs }, opts.map(([v, l]) => h('option', { value: v, selected: String(value ?? '') === String(v) }, l))); s.addEventListener('change', () => onChange(s.value)); return s; };
  const numIn = (value, onChange, attrs) => { const i = h('input', { class: 'input', type: 'number', value: value ?? '', attrs }); i.addEventListener('input', () => onChange(i.value === '' ? null : Number(i.value))); return i; };
  const checks = (opts, values, onChange) => h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px 14px' }, opts.map(([v, l]) => { const cb = h('input', { type: 'checkbox', checked: (values || []).includes(v) }); cb.addEventListener('change', () => { const s = new Set(values || []); cb.checked ? s.add(v) : s.delete(v); values = [...s]; onChange(values); }); return h('label', { class: 'check small' }, cb, h('span', null, l)); }));
  const tryDo = (fn, ok) => { try { const r = fn(); if (ok) toast(ok, 'ok'); G.refresh(); return r; } catch (e) { toast(e.message, 'bad'); return null; } };
  const campStatus = c => bdg(CAMP_ST, c.status);
  const roiTxt = v => v == null ? '—' : F.num(v, 2);

  function segDrawer(s) {
    drawer(s.name, (bd, close) => {
      const ids = segMembers(s); const st = C.stats();
      bd.appendChild(h('div', { class: 'row' },
        G.can('cmp.segment.manage') ? btn('Recalcular ahora', () => { C.refreshSegment(s); close(); toast(`Segmento recalculado: ${s.member_count} clientes`, 'ok'); G.refresh(); segDrawer(s); }, { sm: true }) : null,
        G.can('cmp.segment.manage') && s.segment_type === 'DYNAMIC' ? btn('Editar reglas', () => { close(); G.go('CMP-02', { id: s.id }); }, { sm: true }) : null,
        G.can('cmp.campaign.manage') ? btn('Nueva campaña con este segmento', () => { close(); G.go('CMP-04', { segment_id: s.id }); }, { sm: true, kind: 'primary' }) : null,
        G.can('cmp.segment.manage') ? btn(s.status === 'ACTIVE' ? 'Desactivar' : 'Activar', () => { G.db.update('customer_segments', s.id, { status: s.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }); close(); G.refresh(); }, { sm: true }) : null));
      bd.appendChild(dl([['Código', s.code], ['Tipo', s.segment_type === 'DYNAMIC' ? 'Dinámico (reglas)' : 'Estático (lista)'], ['Marca', s.brand_id ? G.brandName(s.brand_id) : 'Todas'], ['Reglas', s.segment_type === 'DYNAMIC' ? C.describeRules(s.rules) : 'Lista cargada a mano'], ['Tamaño', F.num(s.member_count)], ['Con consentimiento', F.num(s.consent_count)], ['Última actualización', F.datetime(s.last_refreshed_at)], ['Recálculo', `cada ${s.refresh_hours} h y justo antes de enviar (RN-CMP-01)`]]));
      if (s.code === 'SEG-INA-60' && !ids.length) bd.appendChild(notice('Los pedidos de la demo empiezan el 01/09/2026: todavía nadie cumple 60 días sin comprar. El segmento se llenará solo desde noviembre.', 'info'));
      bd.appendChild(h('h3', null, 'Clientes del segmento'));
      bd.appendChild(table({ id: 'cmp-segm-' + s.id, pageSize: 10, rows: ids.map(id => { const c = G.db.get('customers', id) || {}; const x = st.by.get(id) || {}; return { id, name: c.full_name, phone: c.phone, last: x.last, n: x.n || 0, avg: x.avg || 0, rfm: x.rfm, ok: C.hasConsent(id, s.brand_id).ok }; }), columns: [{ key: 'name', label: 'Cliente' }, { key: 'last', label: 'Última compra', render: r => F.date(r.last) }, { key: 'n', label: 'Pedidos', align: 'r' }, { key: 'avg', label: 'Ticket', align: 'r', render: r => F.money(r.avg) }, { key: 'rfm', label: 'RFM', render: r => r.rfm ? rfmName(r.rfm) : '—' }, { key: 'ok', label: 'Consentimiento', render: r => r.ok ? badge('Sí', 'ok') : badge('No', 'bad') }] }));
    }, { code: 'CMP-01', wide: true });
  }

  /* ---------- CMP-01 Segmentos ---------- */
  function scr01(el) {
    const stale = C.refreshStale();
    const segs = G.db.all('customer_segments').filter(inScope);
    const body = page(el, { code: 'CMP-01', title: scName('CMP-01'), sub: 'Segmentos dinámicos que se recalculan solos cada 24 h y antes de cada envío, y listas estáticas. Solo cuentan para campañas quienes dieron consentimiento.', actions: G.can('cmp.segment.manage') ? [{ label: 'Nuevo segmento', kind: 'primary', icon: '+', onClick: () => G.go('CMP-02') }] : [] });
    const all = new Set(); for (const s of segs) if (s.status === 'ACTIVE') for (const id of segMembers(s)) all.add(id);
    const consented = [...all].filter(id => C.hasConsent(id, null).ok).length;
    body.appendChild(kpis([
      { label: 'Segmentos activos', value: segs.filter(s => s.status === 'ACTIVE').length, sub: `${segs.filter(s => s.segment_type === 'DYNAMIC').length} dinámicos · ${segs.filter(s => s.segment_type === 'STATIC').length} estáticos` },
      { label: 'Clientes en algún segmento', value: F.num(all.size), sub: `${F.num(consented)} con consentimiento de marketing` },
      { label: 'Tarifa de marketing', value: F.money(C.rate(), 4), sub: 'por mensaje entregado · WhatsApp Perú' },
      { label: 'Recalculados ahora', value: stale, sub: `vencían su ciclo de ${P('cmp_segment_refresh_hours')} h (RN-CMP-01)`, tone: stale ? 'warn' : 'ok' },
    ]));
    body.appendChild(table({
      id: 'cmp01', rows: segs, onRow: segDrawer, sort: 'member_count', dir: -1,
      filters: [{ key: 'brand_id', label: 'Marca', options: brandOpts(false), value: r => r.brand_id || '' }, { key: 'segment_type', label: 'Tipo', options: [['DYNAMIC', 'Dinámico'], ['STATIC', 'Estático']] }, { key: 'status', label: 'Estado', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']] }],
      columns: [
        { key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Segmento' },
        { key: 'segment_type', label: 'Tipo', render: r => r.segment_type === 'DYNAMIC' ? badge('Dinámico', 'info') : badge('Estático', '') },
        { key: 'brand_id', label: 'Marca', render: r => brandDot(r.brand_id) },
        { key: 'member_count', label: 'Tamaño', align: 'r', render: r => F.num(r.member_count) },
        { key: 'consent_count', label: 'Con consentimiento', align: 'r', render: r => h('span', null, F.num(r.consent_count || 0), h('span', { class: 'muted small' }, r.member_count ? ` · ${F.pct((r.consent_count || 0) / r.member_count * 100, 0)}` : '')) },
        { key: 'last_refreshed_at', label: 'Actualizado', render: r => F.datetime(r.last_refreshed_at) },
        { key: 'status', label: 'Estado', render: r => G.ui.status(r.status) },
      ],
    }));
  }

  /* ---------- CMP-02 Constructor de segmento ---------- */
  function scr02(el, params) {
    const ex = params.id ? G.db.get('customer_segments', params.id) : null;
    const st = { code: ex ? ex.code : '', name: ex ? ex.name : '', brand_id: ex ? ex.brand_id || '' : (G.ctx.brand !== 'ALL' ? G.ctx.brand : ''), segment_type: ex ? ex.segment_type : 'DYNAMIC', refresh_hours: ex ? ex.refresh_hours : P('cmp_segment_refresh_hours'), rules: ex ? U.clone(ex.rules || {}) : (params.rules ? U.clone(params.rules) : { brands: [], last_purchase_days: { min: null, max: null } }) };
    st.rules.last_purchase_days = st.rules.last_purchase_days || { min: null, max: null };
    const body = page(el, { code: 'CMP-02', title: ex ? `${scName('CMP-02')} · ${ex.code}` : scName('CMP-02'), sub: 'Combina reglas y mira en vivo cuántos clientes entran, cuántos aceptan marketing y cuánto costaría escribirles.', actions: [{ label: 'Volver a segmentos', onClick: () => G.go('CMP-01') }] });
    if (!G.can('cmp.segment.manage')) body.appendChild(notice(`Tu rol (${G.roleName()}) puede ver la vista previa, pero no guardar (permiso cmp.segment.manage).`, 'warn'));
    const grid = h('div', { class: 'grid side-r' }); body.appendChild(grid);
    const left = h('div', { class: 'stack' }); const right = h('div', { class: 'stack' }); grid.append(left, right);
    const set = (k, v) => { st.rules[k] = v; preview(); };
    const products = G.db.where('products', p => p.product_type === 'GOODS' && p.status === 'ACTIVE' && (!st.brand_id || p.brand_id === st.brand_id));
    const lines = [...new Set(G.db.where('product_variants', v => v.sellable).map(v => v.line).filter(Boolean))];
    const zones = G.db.all('delivery_zones').map(z => [z.id, z.name]);
    const pint = C.productIntervals();
    const head = h('div', { class: 'form-grid' },
      fld('Código *', (() => { const i = h('input', { class: 'input', value: st.code, placeholder: 'SEG-DG-30', attrs: { id: 'cmp02-code' } }); i.addEventListener('input', () => { st.code = i.value; }); return i; })()),
      fld('Nombre *', (() => { const i = h('input', { class: 'input', value: st.name, placeholder: 'Don Guando · sin compra hace 30 días', attrs: { id: 'cmp02-name' } }); i.addEventListener('input', () => { st.name = i.value; }); return i; })()),
      fld('Marca del segmento', sel(brandOpts(true), st.brand_id, v => { st.brand_id = v; preview(); })),
      fld('Tipo', sel([['DYNAMIC', 'Dinámico (se recalcula)'], ['STATIC', 'Estático (lista fija)']], st.segment_type, v => { st.segment_type = v; preview(); })),
      fld('Recalcular cada (horas)', numIn(st.refresh_hours, v => { st.refresh_hours = v; }, { min: 1, max: 168 }), 'RN-CMP-01: entre 1 y 168 h; además, justo antes de enviar.'));
    left.appendChild(card('Datos del segmento', head));
    const r = st.rules;
    const rules = h('div', { class: 'form-grid' },
      fld('Compró la marca', sel(brandOpts(true), (r.brands || [])[0] || '', v => set('brands', v ? [v] : []))),
      fld('Días desde la última compra · desde', numIn(r.last_purchase_days.min, v => { r.last_purchase_days.min = v; preview(); }, { min: 0 })),
      fld('· hasta', numIn(r.last_purchase_days.max, v => { r.last_purchase_days.max = v; preview(); }, { min: 0 })),
      fld('Pedidos mínimos', numIn(r.min_orders, v => set('min_orders', v), { min: 0 })),
      fld('Ticket promedio mínimo (S/)', numIn(r.min_avg_ticket, v => set('min_avg_ticket', v), { min: 0 })),
      fld('Tipo de cliente', sel([['', 'Personas y empresas'], ['EXCLUDE', 'Solo personas'], ['ONLY', 'Solo empresas (B2B)']], r.b2b || '', v => set('b2b', v || null))),
      fld('Recompra vencida del producto', sel([['', '—']].concat([...pint.values()].filter(x => x.interval).map(x => { const p = G.db.get('products', x.product_id); return p && (!st.brand_id || p.brand_id === st.brand_id) ? [p.id, `${p.name} (cada ~${x.interval} días)`] : null; }).filter(Boolean)), r.rebuy_product || '', v => set('rebuy_product', v || null)), 'El intervalo sale de las compras repetidas de cada cliente o, si compró una sola vez, de la mediana del producto.'),
      fld('Compró el producto', sel([['', '—']].concat(products.map(p => [p.id, p.name])), (r.products || [])[0] || '', v => set('products', v ? [v] : []))),
      fld('Línea', sel([['', '—']].concat(lines.map(l => [l, l])), (r.lines || [])[0] || '', v => set('lines', v ? [v] : []))),
      h('div', { class: 'field span2' }, h('label', { class: 'check' }, (() => { const cb = h('input', { type: 'checkbox', checked: !!r.inactive }); cb.addEventListener('change', () => set('inactive', cb.checked)); return cb; })(), h('span', null, `Solo inactivos (sin compra en ${P('cmp_inactive_days')} días · RN-CMP-01)`))),
      h('div', { class: 'field span2' }, h('label', null, 'Segmento RFM (recencia, frecuencia y monto por quintiles)'), checks(RFM, r.rfm, v => set('rfm', v))),
      h('div', { class: 'field span2' }, h('label', null, 'Zona de reparto'), checks(zones, r.zones, v => set('zones', v))),
      h('div', { class: 'field span2' }, h('label', null, 'Canal de origen o de compra'), checks(G.CHANNELS.filter(c => !['OTHER', 'CONSIGNMENT', 'COUNTER'].includes(c[0])), r.channels, v => set('channels', v))));
    left.appendChild(card('Reglas (se combinan con «y»)', rules));
    const pv = h('div', { class: 'stack' });
    right.appendChild(card('Vista previa', pv));
    const save = btn(ex ? 'Guardar cambios' : 'Crear segmento', () => {
      const res = tryDo(() => C.saveSegment(Object.assign({}, st, { rules: st.rules }), ex));
      if (res) { toast(`Segmento ${res.code} guardado con ${res.member_count} clientes`, 'ok'); G.go('CMP-01'); }
    }, { kind: 'primary', disabled: !G.can('cmp.segment.manage') });
    right.appendChild(h('div', { class: 'row' }, save));
    function preview() {
      G.ui.clear(pv);
      const list = C.evalRules(st.rules); const cons = list.filter(c => C.hasConsent(c.id, st.brand_id || null).ok);
      const stt = C.stats();
      pv.appendChild(kpis([{ label: 'Clientes', value: F.num(list.length) }, { label: 'Con consentimiento', value: F.num(cons.length), sub: list.length ? F.pct(cons.length / list.length * 100, 0) : '—' }, { label: 'Costo de escribirles', value: F.money(C.estimate({ eligible: cons.length }).cost), sub: `menos ${P('cmp_control_group_pct')} % de control` }]));
      pv.appendChild(h('div', { class: 'small muted' }, C.describeRules(st.rules)));
      const byB = {}; for (const c of list) { const s = stt.by.get(c.id); if (s) for (const b of s.brands) byB[b] = (byB[b] || 0) + 1; }
      if (list.length) pv.appendChild(G.ui.chart.hbar({ items: Object.entries(byB).sort((a, b) => b[1] - a[1]).map(([b, n]) => ({ label: 'Compró ' + G.brandName(b), value: n })), format: v => F.num(v) }));
      pv.appendChild(h('div', { class: 'small' }, h('b', null, 'Muestra: '), list.slice(0, 6).map(c => c.full_name).join(', ') || 'Ningún cliente cumple estas reglas.'));
      if (st.rules.inactive && !list.length) pv.appendChild(notice('Los pedidos de la demo empiezan el 01/09/2026, por eso aún no hay inactivos de 60 días.', 'info'));
    }
    preview();
  }

  /* ---------- CMP-03 Campañas ---------- */
  function scr03(el) {
    const cs = G.db.all('campaigns').filter(inScope).sort(U.by('code', -1));
    const body = page(el, { code: 'CMP-03', title: scName('CMP-03'), sub: 'Campañas por marca con su costo estimado y real, pedidos atribuidos y retorno sobre lo cobrado (no lo pedido).', actions: G.can('cmp.campaign.manage') ? [{ label: 'Nueva campaña', kind: 'primary', icon: '+', onClick: () => G.go('CMP-04') }] : [] });
    const res = new Map(cs.filter(c => c.status === 'SENT').map(c => [c.id, C.results(c)]));
    const mon = G.date.month(today()); const mres = cs.filter(c => c.sent_at && dOf(c.sent_at) >= mon).map(c => res.get(c.id));
    const col = U.sum(mres, x => x.collected), cost = U.sum(mres, x => x.total);
    body.appendChild(kpis([
      { label: 'Enviadas este mes', value: mres.length, sub: `${F.num(U.sum(mres, x => x.sent))} mensajes de marketing` },
      { label: 'Costo real del mes', value: F.money(cost), sub: 'mensajes + proveedor + descuentos' },
      { label: 'Ventas cobradas atribuidas', value: F.money(col), sub: `${U.sum(mres, x => x.orders)} pedidos · sin IGV` },
      { label: 'Retorno neto (KPI-CMP-02)', value: roiTxt(C.roi({ collected: col, cost })), sub: '(cobrado − costo) / costo', tone: col > cost ? 'ok' : 'warn' },
      { label: 'Por aprobar', value: cs.filter(c => c.status === 'PENDING_APPROVAL').length, tone: cs.some(c => c.status === 'PENDING_APPROVAL') ? 'warn' : '', onClick: () => G.go('CMP-05') },
    ]));
    body.appendChild(table({
      id: 'cmp03', rows: cs, onRow: c => G.go(c.status === 'SENT' ? 'CMP-06' : 'CMP-05', { id: c.id }),
      filters: [{ key: 'brand_id', label: 'Marca', options: brandOpts(false) }, { key: 'status', label: 'Estado', options: Object.entries(CAMP_ST).map(([k, v]) => [k, v[0]]) }, { key: 'objective', label: 'Objetivo', options: OBJ }],
      columns: [
        { key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Campaña' }, { key: 'brand_id', label: 'Marca', render: r => brandDot(r.brand_id) },
        { key: 'status', label: 'Estado', render: campStatus },
        { key: 'scheduled_at', label: 'Programada / enviada', render: r => F.datetime(r.sent_at || r.scheduled_at) },
        { key: 'effective_count', label: 'Destinatarios', align: 'r', render: r => F.num(r.effective_count) },
        { key: 'estimated_cost', label: 'Costo estimado', align: 'r', render: r => F.money(r.estimated_cost) },
        { key: 'actual_cost', label: 'Costo real', align: 'r', render: r => res.has(r.id) ? F.money(res.get(r.id).total) : '—', value: r => res.has(r.id) ? res.get(r.id).total : -1 },
        { key: 'orders', label: 'Pedidos', align: 'r', render: r => res.has(r.id) ? res.get(r.id).orders : '—', value: r => res.has(r.id) ? res.get(r.id).orders : -1 },
        { key: 'collected', label: 'Cobrado', align: 'r', render: r => res.has(r.id) ? F.money(res.get(r.id).collected) : '—', value: r => res.has(r.id) ? res.get(r.id).collected : -1 },
        { key: 'roi', label: 'Retorno', align: 'r', render: r => res.has(r.id) ? roiTxt(res.get(r.id).roi) : '—', value: r => res.has(r.id) ? res.get(r.id).roi : -99 },
      ],
    }));
  }

  /* ---------- CMP-04 Nueva campaña ---------- */
  function scr04(el, params) {
    const body = page(el, { code: 'CMP-04', title: scName('CMP-04'), sub: 'Elige segmento, número y plantilla de marketing aprobada por Meta. El costo se estima antes de pedir la aprobación.', actions: [{ label: 'Ver campañas', onClick: () => G.go('CMP-03') }] });
    if (!G.can('cmp.campaign.manage')) { body.appendChild(notice(`Tu rol (${G.roleName()}) no crea campañas (permiso cmp.campaign.manage).`, 'warn')); }
    const seg0 = params.segment_id ? G.db.get('customer_segments', params.segment_id) : null;
    const b0 = (seg0 && seg0.brand_id) || (G.ctx.brand !== 'ALL' ? G.ctx.brand : (G.scope.brands()[0] || {}).id);
    const est = h('div');
    const grid = h('div', { class: 'grid side-r' }); body.appendChild(grid);
    const chOpts = v => G.db.where('messaging_channels', x => x.kind === 'WHATSAPP' && x.brand_id === v.brand_id).map(x => [x.id, `${x.display_name || G.brandName(x.brand_id)} · ${x.number}`]);
    const tplOpts = v => C.templatesFor(v.brand_id).map(t => [t.id, `${t.name}${t.provider_status !== 'APPROVED' ? ' · ' + t.provider_status : ''}`]);
    const segOpts = v => G.db.where('customer_segments', s => s.status === 'ACTIVE' && (!s.brand_id || s.brand_id === v.brand_id)).map(s => [s.id, `${s.code} · ${s.name} (${s.member_count})`]);
    const cpOpts = v => G.db.where('coupons', c => c.status === 'ACTIVE' && (!c.brand_id || c.brand_id === v.brand_id) && !c.customer_id).map(c => [c.id, `${c.code} · ${c.discount_type === 'PCT' ? c.value + ' %' : c.discount_type === 'AMOUNT' ? F.money(c.value) : 'delivery gratis'} (${F.date(c.valid_from)}–${F.date(c.valid_to)})`]);
    const v0 = { name: '', brand_id: b0, objective: 'REPURCHASE', attribution_window_days: P('cmp_attribution_window_days'), control_group_pct: P('cmp_control_group_pct'), scheduled_at: G.date.add(today(), 2) + 'T10:00', segment_id: seg0 ? seg0.id : null };
    v0.channel_id = (chOpts(v0)[0] || [])[0]; v0.template_id = (C.templatesFor(b0).find(t => t.provider_status === 'APPROVED') || {}).id; if (!v0.segment_id) v0.segment_id = (segOpts(v0)[0] || [])[0];
    let f;
    const rebuild = vals => { const nf = mk(vals); f.replaceWith(nf); f = nf; showEst(vals); };
    function mk(vals) {
      return form({
        id: 'cmp04', values: vals, submitLabel: 'Crear y calcular estimación',
        fields: [
          { key: 'name', label: 'Nombre de la campaña', required: true, span: 2, placeholder: 'Recompra de cuy · semana 42' },
          { key: 'brand_id', label: 'Marca', type: 'select', required: true, options: brandOpts(false), onChange: (v, all) => { all.segment_id = (segOpts(all)[0] || [])[0]; all.channel_id = (chOpts(all)[0] || [])[0]; all.template_id = (C.templatesFor(v).find(t => t.provider_status === 'APPROVED') || {}).id; all.coupon_id = ''; rebuild(all); } },
          { key: 'segment_id', label: 'Segmento', type: 'select', required: true, options: segOpts, onChange: (v, all) => showEst(all) },
          { key: 'channel', label: 'Canal', type: 'readonly', help: 'D-CMP-04: solo WhatsApp en el arranque' },
          { key: 'channel_id', label: 'Número de WhatsApp de la marca', type: 'select', required: true, options: chOpts },
          { key: 'template_id', label: 'Plantilla de marketing', type: 'select', required: true, options: tplOpts, help: 'RN-CMP-17: solo plantillas de marketing aprobadas por Meta para el número de la marca' },
          { key: 'objective', label: 'Objetivo', type: 'select', required: true, options: OBJ },
          { key: 'coupon_id', label: 'Cupón', type: 'select', options: cpOpts },
          { key: 'scheduled_at', label: 'Programar envío', type: 'datetime' },
          { key: 'attribution_window_days', label: 'Ventana de atribución (días)', type: 'number', min: 1, max: 60, onChange: (v, all) => showEst(all) },
          { key: 'control_group_pct', label: 'Grupo de control (%)', type: 'number', min: 0, max: 50, onChange: (v, all) => showEst(all) },
        ],
        onSubmit: vals => { const c = C.createCampaign(Object.assign({}, vals, { scheduled_at: vals.scheduled_at ? String(vals.scheduled_at).slice(0, 16) : null })); toast(`Campaña ${c.code} creada en borrador`, 'ok'); G.go('CMP-05', { id: c.id }); return true; },
      });
    }
    v0.channel = 'WhatsApp';
    f = mk(v0);
    grid.append(card('Configuración', f), card('Estimación en vivo', est));
    function showEst(v) {
      G.ui.clear(est);
      if (!v.segment_id) { est.appendChild(G.ui.empty('Elige un segmento.')); return; }
      const fake = { code: 'PREVIA-' + v.segment_id, segment_id: v.segment_id, brand_id: v.brand_id, control_group_pct: v.control_group_pct };
      const { est: e } = C.plan(fake, { noRefresh: true });
      est.appendChild(dl([['Clientes del segmento', F.num(e.target)], ['Sin consentimiento de la marca', F.num(e.excludedConsent)], [`Con ${P('cmp_max_marketing_per_week')} mensajes esta semana`, F.num(e.excludedFrequency)], ['Grupo de control', F.num(e.control)], ['Destinatarios efectivos', h('b', null, F.num(e.effective))], ['Costo por mensaje', F.money(e.unit, 4)], ['Costo estimado', h('b', null, F.money(e.cost))]]));
      est.appendChild(notice(e.needsGerente ? `Supera ${F.money(e.threshold)}: la aprueba solo GERENTE (RN-CMP-02).` : `Hasta ${F.money(e.threshold)}: la aprueba Marketing, Administración o Gerencia, distinta de quien la crea (RN-CMP-02).`, e.needsGerente ? 'warn' : 'info'));
      const t = G.db.get('message_templates', v.template_id); if (t) est.appendChild(h('div', { class: 'chat', style: 'margin-top:10px' }, h('div', { class: 'msg out' }, String(t.body).replace('{{1}}', 'Rosa').replace('{{2}}', v.coupon_id ? (G.db.get('coupons', v.coupon_id) || {}).code : '—'), h('div', { class: 'meta' }, t.name + ' · ' + (t.provider_status === 'APPROVED' ? 'aprobada' : t.provider_status)))));
    }
    showEst(v0);
  }

  /* ---------- CMP-05 Estimación y aprobación ---------- */
  function campPicker(body, statuses, current, code) {
    const list = G.db.all('campaigns').filter(inScope).filter(c => statuses.includes(c.status)).sort(U.by('code', -1));
    body.appendChild(h('div', { class: 'row' }, h('label', { class: 'small muted' }, 'Campaña'), sel(list.map(c => [c.id, `${c.code} · ${c.name} (${lbl(CAMP_ST, c.status)})`]), current && current.id, v => G.go(code, { id: v }), { 'aria-label': 'Campaña', id: code + '-pick' })));
    return list;
  }
  function scr05(el, params) {
    const pend = G.db.all('campaigns').filter(inScope).filter(c => ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(c.status));
    const c = (params.id && G.db.get('campaigns', params.id)) || pend.find(x => x.status === 'PENDING_APPROVAL') || pend[0];
    const body = page(el, { code: 'CMP-05', title: scName('CMP-05'), sub: 'Destinatarios efectivos después de quitar a quienes no dieron consentimiento, a quienes ya recibieron 2 mensajes esta semana y al grupo de control; costo y aprobación.' });
    campPicker(body, ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED'], c, 'CMP-05');
    if (!c) { body.appendChild(G.ui.empty('No hay campañas por estimar o aprobar.')); return; }
    const { rows, est } = C.plan(c, { noRefresh: true });
    const seg = G.db.get('customer_segments', c.segment_id) || {};
    const t = G.db.get('message_templates', c.template_id) || {};
    const cp = c.coupon_id ? G.db.get('coupons', c.coupon_id) : null;
    // descuentos esperados con la compra histórica de campañas enviadas de la marca
    const hist = G.db.where('campaigns', x => x.status === 'SENT' && x.brand_id === c.brand_id).map(C.results);
    const buy = hist.length ? U.sum(hist, x => x.buyRate) / hist.length : 30;
    const tick = (() => { const st = C.stats(); const vals = rows.filter(x => x.status === 'QUEUED').map(x => (st.by.get(x.customer_id) || {}).avg || 0).filter(Boolean); return vals.length ? U.sum(vals) / vals.length : 60; })();
    const expDisc = cp ? R(est.effective * buy / 100 * (cp.discount_type === 'PCT' ? Math.min(tick * cp.value / 100, cp.max_discount || Infinity) : cp.discount_type === 'AMOUNT' ? cp.value : 8)) : 0;
    const acts = [];
    const canApprove = G.can('cmp.campaign.approve');
    if (c.status === 'DRAFT' && G.can('cmp.campaign.manage')) acts.push(btn('Recalcular estimación', () => tryDo(() => C.applyEstimate(c), 'Estimación actualizada con el segmento recalculado')), btn('Enviar a aprobación', () => tryDo(() => C.submit(c), `Campaña ${c.code} enviada a aprobación`), { kind: 'primary' }));
    if (['DRAFT', 'PENDING_APPROVAL'].includes(c.status) && canApprove) acts.push(btn('Aprobar', () => tryDo(() => C.approve(c), `Campaña ${c.code} aprobada`), { kind: 'primary' }));
    if (c.status === 'APPROVED' && G.can('cmp.campaign.manage')) acts.push(btn('Enviar ahora', () => confirm({ title: 'Enviar campaña', message: `Se recalcula el segmento y se envían ${F.num(est.effective)} mensajes de marketing por ${F.money(est.cost)} aprox.`, confirmLabel: 'Enviar', onConfirm: () => { const r = tryDo(() => C.send(c)); if (r) { toast(`Campaña ${c.code} enviada: ${r.est.effective} mensajes, ${F.money(r.actual)}`, 'ok'); G.go('CMP-06', { id: c.id }); } } }), { kind: 'accent' }));
    if (!['SENT', 'CANCELLED'].includes(c.status) && (G.can('cmp.campaign.manage') || canApprove)) acts.push(btn('Cancelar', () => modal('Cancelar campaña', bd => { bd.appendChild(h('textarea', { class: 'input', attrs: { id: 'cmp05-why', placeholder: 'Motivo' } })); }, [{ label: 'Volver' }, { label: 'Cancelar campaña', kind: 'danger', onClick: () => { const why = document.getElementById('cmp05-why').value; return tryDo(() => C.cancel(c, why), 'Campaña cancelada') !== null ? true : false; } }]), { kind: 'danger' }));
    body.appendChild(h('div', { class: 'row between' }, h('div', { class: 'row' }, h('b', null, `${c.code} · ${c.name}`), campStatus(c), brandDot(c.brand_id)), h('div', { class: 'row' }, acts)));
    if (c.status === 'CANCELLED') body.appendChild(notice('Cancelada: ' + (c.cancel_reason || ''), 'warn'));
    const total = R(est.cost + expDisc);
    body.appendChild(kpis([
      { label: 'Clientes del segmento', value: F.num(est.target), sub: `${seg.code || ''} · actualizado ${F.datetime(seg.last_refreshed_at)}` },
      { label: 'Excluidos por consentimiento', value: F.num(est.excludedConsent), sub: 'RN-CMP-03 · Ley 29733', tone: est.excludedConsent ? 'warn' : '' },
      { label: 'Excluidos por frecuencia', value: F.num(est.excludedFrequency), sub: `tope de ${P('cmp_max_marketing_per_week')} por semana (RN-CMP-05)`, tone: est.excludedFrequency ? 'warn' : '' },
      { label: 'Grupo de control', value: F.num(est.control), sub: `${c.control_group_pct} % al azar (RN-CMP-18)` },
      { label: 'Destinatarios efectivos', value: F.num(est.effective), tone: 'ok' },
    ]));
    const g = h('div', { class: 'grid c2' }); body.appendChild(g);
    g.appendChild(card('Costo estimado (RN-CMP-06)', h('div', { class: 'stack' },
      dl([['Mensajes', `${F.num(est.effective)} × ${F.money(C.rate(), 4)} = ${F.money(R(est.effective * C.rate()))}`], ['Proveedor oficial (BSP)', `${F.num(est.effective)} × ${F.money(C.fee(), 4)} = ${F.money(R(est.effective * C.fee()))}`], ['Descuentos esperados del cupón', cp ? `${F.money(expDisc)} (${F.pct(buy, 0)} de compra histórica × ticket ${F.money(tick)})` : 'Sin cupón'], ['Costo estimado de mensajes', h('b', null, F.money(est.cost))], ['Costo total esperado', F.money(total)], ['Guardado en la campaña', c.estimated_cost != null ? `${F.money(c.estimated_cost)} · ${F.datetime(c.estimated_at)}` : 'Sin estimar']]),
      notice(est.needsGerente ? `Supera el umbral de ${F.money(est.threshold)}: solo GERENTE la aprueba, y no puede ser quien la creó (RN-CMP-02).` : `Bajo el umbral de ${F.money(est.threshold)}: la aprueba Marketing, Administración o Gerencia, distinta de quien la creó (${G.userName(c.created_by_user)}).`, est.needsGerente ? 'warn' : 'info'),
      c.approved_by ? notice(`Aprobada por ${G.userName(c.approved_by)} el ${F.datetime(c.approved_at)}.`, 'ok') : null)));
    g.appendChild(card('Mensaje', h('div', { class: 'stack' }, dl([['Número', (G.db.get('messaging_channels', c.channel_id) || {}).number], ['Plantilla', `${t.name || '—'} · ${t.provider_status || ''}`], ['Objetivo', objName(c.objective)], ['Cupón', cp ? cp.code : '—'], ['Programada', F.datetime(c.scheduled_at)], ['Ventana de atribución', `${c.attribution_window_days} días`], ['Creada por', G.userName(c.created_by_user)]]), h('div', { class: 'chat' }, h('div', { class: 'msg out' }, String(t.body || '').replace('{{1}}', 'Rosa').replace('{{2}}', cp ? cp.code : ''))))));
    body.appendChild(card('Destinatarios planificados', table({ id: 'cmp05-rows', pageSize: 10, rows: rows.map(x => Object.assign({ name: G.custName(x.customer_id), last: (C.statsOf(x.customer_id) || {}).last, week: C.weekCount(x.customer_id) }, x)), filters: [{ key: 'status', label: 'Resultado', options: [['QUEUED', 'Se envía'], ['CONTROL', 'Grupo de control'], ['SKIPPED_CONSENT', 'Sin consentimiento'], ['SKIPPED_FREQUENCY', 'Por frecuencia']] }], columns: [{ key: 'name', label: 'Cliente' }, { key: 'last', label: 'Última compra', render: r => F.date(r.last) }, { key: 'week', label: 'Marketing esta semana', align: 'r' }, { key: 'status', label: 'Resultado', render: r => r.status === 'QUEUED' ? badge('Se envía', 'ok') : bdg(REC_ST, r.status) }] }), { flush: true }));
    if (c.history) body.appendChild(card('Historial', h('div', { class: 'timeline' }, c.history.map(x => h('div', { class: 'tl-item' }, h('b', null, `${x.from ? lbl(CAMP_ST, x.from) + ' → ' : ''}${lbl(CAMP_ST, x.to)}`), h('div', { class: 'small muted' }, `${F.datetime(x.at)} · ${x.user || ''}${x.reason ? ' · ' + x.reason : ''}`))))));
  }

  /* ---------- CMP-06 Resultados ---------- */
  function scr06(el, params) {
    const sent = G.db.all('campaigns').filter(inScope).filter(c => c.status === 'SENT').sort(U.by('sent_at', -1));
    const c = (params.id && G.db.get('campaigns', params.id)) || sent[0];
    const body = page(el, { code: 'CMP-06', title: scName('CMP-06'), sub: 'Entrega, lectura, bajas y ventas cobradas atribuidas a la campaña; retorno neto e incremento real frente al grupo de control.', actions: c ? [{ label: 'Recalcular atribución', onClick: () => { const n = C.attributeAll(); toast(`${n} pedidos revisados`, 'ok'); G.refresh(); } }] : [] });
    campPicker(body, ['SENT'], c, 'CMP-06');
    if (!c || c.status !== 'SENT') { body.appendChild(G.ui.empty('Elige una campaña enviada.')); return; }
    const x = C.results(c);
    const open = x.windowEnd >= today();
    body.appendChild(h('div', { class: 'row' }, h('b', null, `${c.code} · ${c.name}`), brandDot(c.brand_id), badge(objName(c.objective), 'info'), h('span', { class: 'muted small' }, `Enviada ${F.datetime(c.sent_at)} · ventana hasta ${F.date(x.windowEnd)}`), open ? badge('Ventana abierta', 'warn') : badge('Ventana cerrada', '')));
    body.appendChild(kpis([
      { label: 'Entregados', value: F.num(x.delivered), sub: `de ${F.num(x.sent)} enviados` },
      { label: 'Leídos', value: F.num(x.read), sub: x.delivered ? F.pct(x.read / x.delivered * 100, 0) : '—' },
      { label: 'Respuestas', value: F.num(x.replied) },
      { label: 'Bajas', value: F.num(x.optouts), sub: x.delivered ? F.pct(x.optouts / x.delivered * 100, 2) + ' (KPI-CMP-04)' : '', tone: x.optouts ? 'warn' : '' },
      { label: 'Pedidos atribuidos', value: F.num(x.orders), sub: `${x.paidOrders} cobrados` },
      { label: 'Ventas cobradas', value: F.money(x.collected), sub: 'sin IGV' },
      { label: 'Costo total', value: F.money(x.total), sub: `mensajes ${F.money(x.msgCost)} + descuentos ${F.money(x.discounts)}` },
      { label: 'Retorno neto', value: roiTxt(x.roi), sub: '(cobrado − costo) / costo', tone: (x.roi || 0) > 0 ? 'ok' : 'bad' },
      { label: 'Incremento vs. control', value: (x.lift >= 0 ? '+' : '') + F.num(x.lift, 1) + ' pp', sub: `${F.pct(x.buyRate)} vs. ${F.pct(x.ctrlRate)} (${x.control} en control)`, tone: x.lift > 0 ? 'ok' : 'warn' },
    ]));
    const g = h('div', { class: 'grid c2' }); body.appendChild(g);
    g.appendChild(card('Embudo', G.ui.chart.hbar({ items: [{ label: 'Segmento', value: c.target_count || 0 }, { label: 'Con consentimiento y bajo tope', value: (c.target_count || 0) - (c.excluded_consent_count || 0) - (c.excluded_frequency_count || 0) }, { label: 'Enviados', value: x.sent }, { label: 'Entregados', value: x.delivered }, { label: 'Leídos', value: x.read }, { label: 'Compraron en la ventana', value: Math.round(x.buyRate * x.delivered / 100), tone: 'ok' }, { label: 'Pedidos atribuidos', value: x.orders, tone: 'ok' }], format: v => F.num(v) })));
    const days = []; for (let d = dOf(c.sent_at); d <= x.windowEnd; d = G.date.add(d, 1)) days.push(d);
    const byDay = U.groupBy(x.atts.map(a => ({ a, o: G.db.get('sales_orders', a.order_id) })).filter(y => y.o), y => dOf(y.o.confirmed_at || y.o.created_at));
    g.appendChild(card('Ventas cobradas atribuidas por día', G.ui.chart.bar({ labels: days.map(d => d.slice(8, 10) + '/' + d.slice(5, 7)), series: [{ name: 'Cobrado (S/)', values: days.map(d => R(U.sum(byDay[d] || [], y => y.a.collected_amount))) }], format: v => F.money(v) })));
    body.appendChild(card('Pedidos atribuidos (RN-CMP-15)', table({ id: 'cmp06-att', pageSize: 10, rows: x.atts.map(a => { const o = G.db.get('sales_orders', a.order_id) || {}; return Object.assign({ number: o.number, cust: G.custName(o.customer_id), status: o.status, brand: o.brand_id, total: o.final_total ?? o.estimated_total, at: o.confirmed_at || o.created_at }, a); }), onRow: a => G.screens['PED-03'] && G.go('PED-03', { id: a.order_id }), columns: [{ key: 'number', label: 'Pedido', mono: true }, { key: 'cust', label: 'Cliente' }, { key: 'brand', label: 'Marca', render: r => G.brandName(r.brand) }, { key: 'at', label: 'Fecha', render: r => F.datetime(r.at) }, { key: 'rule', label: 'Regla', render: r => r.rule === 'COUPON' ? badge('Cupón', 'ok') : badge('Ventana', 'info') }, { key: 'status', label: 'Estado', render: r => G.ui.status(r.status) }, { key: 'total', label: 'Total', align: 'r', render: r => F.money(r.total) }, { key: 'collected_amount', label: 'Cobrado sin IGV', align: 'r', render: r => F.money(r.collected_amount) }, { key: 'discount_amount', label: 'Descuento', align: 'r', render: r => F.money(r.discount_amount) }] }), { flush: true }));
    body.appendChild(card('Destinatarios', table({
      id: 'cmp06-rec', pageSize: 10, rows: x.recs.map(r => Object.assign({ name: G.custName(r.customer_id) }, r)),
      filters: [{ key: 'status', label: 'Estado', options: Object.entries(REC_ST).map(([k, v]) => [k, v[0]]) }, { key: 'opted_out', label: 'Baja', options: [['true', 'Se dio de baja'], ['false', 'Sin baja']] }],
      onRow: r => recDrawer(c, r),
      columns: [{ key: 'name', label: 'Cliente' }, { key: 'phone', label: 'Celular', mono: true }, { key: 'status', label: 'Estado', render: r => bdg(REC_ST, r.status) }, { key: 'delivered_at', label: 'Entregado', render: r => F.datetime(r.delivered_at) }, { key: 'message_cost', label: 'Costo', align: 'r', render: r => F.money(r.message_cost, 4) }, { key: 'opted_out', label: 'Baja', render: r => r.opted_out ? badge('Baja', 'bad') : '' }],
    }), { flush: true }));
  }
  function recDrawer(c, r) {
    drawer(G.custName(r.customer_id), (bd, close) => {
      bd.appendChild(dl([['Campaña', c.code + ' · ' + c.name], ['Estado', bdg(REC_ST, r.status)], ['Celular', r.phone], ['Enviado', F.datetime(r.sent_at)], ['Costo del mensaje', F.money(r.message_cost, 4)], ['Consentimiento hoy', C.hasConsent(r.customer_id, c.brand_id).ok ? badge('Vigente', 'ok') : badge('Baja', 'bad')]]));
      const msgs = G.db.where('messages', m => m.customer_id === r.customer_id && (m.ref === c.code || m.ref === 'CMP-BAJA' || (m.direction === 'IN' && m.sent_at >= (r.sent_at || '9')))).sort(U.by('sent_at'));
      bd.appendChild(h('div', { class: 'chat' }, msgs.map(m => h('div', { class: 'msg ' + (m.direction === 'IN' ? '' : 'out') }, m.text, h('div', { class: 'meta' }, `${F.datetime(m.sent_at)} · ${m.kind === 'MARKETING' ? 'marketing ' + F.money(m.cost, 4) : m.direction === 'IN' ? 'cliente' : 'servicio'}`)))));
      if (!r.is_control && r.sent_at) {
        const inp = h('input', { class: 'input', placeholder: 'Respuesta del cliente (p. ej. BAJA)', attrs: { id: 'cmp06-reply' } });
        bd.appendChild(h('div', { class: 'row' }, inp, btn('Registrar respuesta', () => { const res = tryDo(() => C.inbound({ customer_id: r.customer_id, brand_id: c.brand_id, text: inp.value, campaign_id: c.id })); if (res) { toast(res.optout ? 'Baja registrada y confirmada al cliente (RN-CMP-04)' : 'Respuesta registrada', res.optout ? 'warn' : 'ok'); close(); G.refresh(); } }, { sm: true })));
      }
    });
  }

  /* ---------- CMP-07 Cupones ---------- */
  function couponForm(ex) {
    drawer(ex ? 'Editar cupón ' + ex.code : 'Nuevo cupón', (bd, close) => {
      bd.appendChild(form({
        id: 'cmp07', values: ex ? Object.assign({}, ex, { channels_txt: (ex.channels || []).join(',') }) : { discount_type: 'PCT', value: 10, min_order_amount: 0, max_uses_per_customer: 1, valid_from: today(), valid_to: G.date.add(today(), 14), brand_id: G.ctx.brand !== 'ALL' ? G.ctx.brand : 'br-DG' },
        fields: [
          { key: 'code', label: 'Código', required: true, placeholder: 'VUELVE10' }, { key: 'brand_id', label: 'Marca', type: 'select', options: brandOpts(false) },
          { key: 'discount_type', label: 'Tipo', type: 'select', required: true, options: DISC }, { key: 'value', label: 'Valor (% o S/)', type: 'number', min: 0 },
          { key: 'max_discount', label: 'Descuento máximo (S/)', type: 'money' }, { key: 'min_order_amount', label: 'Pedido mínimo (S/)', type: 'money', min: 0 },
          { key: 'valid_from', label: 'Vigente desde', type: 'date', required: true }, { key: 'valid_to', label: 'Vigente hasta', type: 'date', required: true },
          { key: 'max_uses_total', label: 'Usos totales', type: 'number', min: 1 }, { key: 'max_uses_per_customer', label: 'Usos por cliente', type: 'number', min: 1, required: true },
          { key: 'customer_id', label: 'Cliente (cupón personal)', type: 'select', options: () => G.db.where('customers', c => c.customer_type === 'PERSON' && c.status === 'ACTIVE').slice(0, 300).map(c => [c.id, c.full_name]) },
          { key: 'campaign_id', label: 'Campaña', type: 'select', options: () => G.db.where('campaigns', c => !['CANCELLED'].includes(c.status)).map(c => [c.id, c.code + ' · ' + c.name]) },
          { key: 'channels_txt', label: 'Canales (vacío = todos)', placeholder: 'WHATSAPP,WEB', help: 'Códigos separados por coma: WHATSAPP, WEB, TIKTOK, FACEBOOK, INSTAGRAM, PHONE, B2B' },
          { key: 'description', label: 'Descripción', span: 2 },
        ],
        onCancel: close,
        onSubmit: v => { const ch = String(v.channels_txt || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean); const cp = C.saveCoupon(Object.assign({}, v, { channels: ch }), ex); close(); toast(`Cupón ${cp.code} guardado`, 'ok'); G.refresh(); return true; },
      }));
    }, { code: 'CMP-07' });
  }
  function couponDrawer(cp) {
    drawer('Cupón ' + cp.code, (bd, close) => {
      const reds = G.db.where('coupon_redemptions', x => x.coupon_id === cp.id);
      bd.appendChild(h('div', { class: 'row' },
        G.can('cmp.coupon.manage') ? btn('Editar', () => { close(); couponForm(cp); }, { sm: true }) : null,
        G.can('cmp.coupon.manage') && cp.status !== 'EXPIRED' ? btn(cp.status === 'ACTIVE' ? 'Pausar' : 'Activar', () => { G.db.update('coupons', cp.id, { status: cp.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }); close(); G.refresh(); }, { sm: true }) : null));
      bd.appendChild(dl([['Tipo', discName(cp.discount_type)], ['Valor', cp.discount_type === 'PCT' ? cp.value + ' %' : cp.discount_type === 'AMOUNT' ? F.money(cp.value) : 'Costo del delivery'], ['Tope del descuento', cp.max_discount ? F.money(cp.max_discount) : '—'], ['Pedido mínimo', F.money(cp.min_order_amount)], ['Vigencia', `${F.date(cp.valid_from)} al ${F.date(cp.valid_to)}`], ['Usos', `${reds.filter(x => x.status === 'APPLIED').length} de ${cp.max_uses_total || 'sin límite'} · ${cp.max_uses_per_customer} por cliente`], ['Cliente', cp.customer_id ? G.custName(cp.customer_id) : 'Cualquiera'], ['Canales', (cp.channels || []).length ? cp.channels.map(G.channelName).join(', ') : 'Todos'], ['Campaña', cp.campaign_id ? (G.db.get('campaigns', cp.campaign_id) || {}).code : '—'], ['Marca', cp.brand_id ? G.brandName(cp.brand_id) : 'Todas']]));
      const orders = G.db.where('sales_orders', o => ['DRAFT', 'CONFIRMED'].includes(o.status) && (!cp.brand_id || o.brand_id === cp.brand_id) && !o.coupon_id && (!cp.customer_id || o.customer_id === cp.customer_id)).slice(0, 40);
      const s = sel([['', 'Elige un pedido en borrador o confirmado']].concat(orders.map(o => [o.id, `${o.number} · ${G.custName(o.customer_id)} · ${F.money(o.estimated_total)}`])), '', () => { }, { id: 'cmp07-order', 'aria-label': 'Pedido' });
      const out = h('div');
      bd.appendChild(card('Aplicar a un pedido', h('div', { class: 'stack' }, s, h('div', { class: 'row' },
        btn('Probar reglas', () => { G.ui.clear(out); try { const o = G.db.get('sales_orders', s.value); if (!o) throw new Error('Elige un pedido.'); const r = C.checkCoupon(o, cp); out.appendChild(notice(`Cumple las reglas: descuento de ${F.money(r.discount)} sobre ${F.money(r.base)} en productos.`, 'ok')); } catch (e) { out.appendChild(notice(e.message, 'bad')); } }, { sm: true }),
        btn('Aplicar cupón', () => { const o = G.db.get('sales_orders', s.value); if (!o) return toast('Elige un pedido.', 'warn'); const r = tryDo(() => C.applyCoupon(o, cp.code)); if (r) { toast(`Cupón aplicado: −${F.money(r.discount)}; total ${F.money(r.total)}`, 'ok'); close(); } }, { sm: true, kind: 'primary' })), out)));
      bd.appendChild(h('h3', null, 'Usos'));
      bd.appendChild(table({ id: 'cmp07-red-' + cp.id, search: false, pageSize: 8, rows: reds, columns: [{ key: 'order_id', label: 'Pedido', render: r => (G.db.get('sales_orders', r.order_id) || {}).number, mono: true }, { key: 'customer_id', label: 'Cliente', render: r => G.custName(r.customer_id) }, { key: 'redeemed_at', label: 'Fecha', render: r => F.datetime(r.redeemed_at) }, { key: 'order_amount', label: 'Productos', align: 'r', render: r => F.money(r.order_amount) }, { key: 'discount_amount', label: 'Descuento', align: 'r', render: r => F.money(r.discount_amount) }, { key: 'status', label: 'Estado', render: r => r.status === 'APPLIED' ? badge('Aplicado', 'ok') : badge('Revertido', 'bad') }] }));
    }, { code: 'CMP-07', wide: true });
  }
  function scr07(el) {
    const cps = G.db.all('coupons').filter(inScope);
    const reds = G.db.all('coupon_redemptions').filter(x => x.status === 'APPLIED');
    const used = U.groupBy(reds, 'coupon_id');
    const body = page(el, { code: 'CMP-07', title: scName('CMP-07'), sub: 'Cupones con código único, vigencia, mínimo, usos totales y por cliente. Un pedido acepta un solo cupón.', actions: G.can('cmp.coupon.manage') ? [{ label: 'Nuevo cupón', kind: 'primary', icon: '+', onClick: () => couponForm(null) }] : [] });
    const k5 = G.kpi('KPI-CMP-05', { from: '2026-09-01' }) || {};
    body.appendChild(kpis([
      { label: 'Cupones activos', value: cps.filter(c => c.status === 'ACTIVE').length, sub: `${cps.filter(c => c.customer_id).length} personales` },
      { label: 'Usos registrados', value: reds.length, sub: `descuento otorgado ${F.money(U.sum(reds, x => x.discount_amount))}` },
      { label: 'Tasa de uso (KPI-CMP-05)', value: F.pct(k5.value || 0), sub: `${k5.numerator || 0} canjes / ${k5.denominator || 0} destinatarios con cupón` },
      { label: 'Vencen en 7 días', value: cps.filter(c => c.status === 'ACTIVE' && c.valid_to >= today() && G.date.diff(c.valid_to, today()) <= 7).length, tone: 'warn' },
    ]));
    body.appendChild(table({
      id: 'cmp07', rows: cps, onRow: couponDrawer,
      filters: [{ key: 'brand_id', label: 'Marca', options: brandOpts(false) }, { key: 'status', label: 'Estado', options: [['ACTIVE', 'Activo'], ['PAUSED', 'Pausado'], ['EXPIRED', 'Vencido']] }, { key: 'discount_type', label: 'Tipo', options: DISC }],
      columns: [
        { key: 'code', label: 'Código', mono: true }, { key: 'discount_type', label: 'Tipo', render: r => discName(r.discount_type) },
        { key: 'value', label: 'Valor', align: 'r', render: r => r.discount_type === 'PCT' ? r.value + ' %' : r.discount_type === 'AMOUNT' ? F.money(r.value) : 'Delivery' },
        { key: 'valid_to', label: 'Vigencia', render: r => `${F.date(r.valid_from)} – ${F.date(r.valid_to)}` },
        { key: 'min_order_amount', label: 'Mínimo', align: 'r', render: r => F.money(r.min_order_amount) },
        { key: 'limits', label: 'Límites', render: r => `${r.max_uses_total || '∞'} total · ${r.max_uses_per_customer}/cliente`, sort: false },
        { key: 'customer_id', label: 'Cliente', render: r => r.customer_id ? G.custName(r.customer_id) : 'Todos' },
        { key: 'brand_id', label: 'Marca', render: r => brandDot(r.brand_id) },
        { key: 'uses', label: 'Usos', align: 'r', value: r => (used[r.id] || []).length },
        { key: 'status', label: 'Estado', render: r => r.status === 'PAUSED' ? badge('Pausado', 'warn') : G.ui.status(r.status) },
      ],
    }));
  }

  /* ---------- CMP-08 Programa de puntos ---------- */
  function scr08(el) {
    const pr = C.program();
    const body = page(el, { code: 'CMP-08', title: scName('CMP-08'), sub: 'Puntos por cada sol cobrado sin IGV, valor del punto, canje mínimo y vencimiento. D-CMP-01: los puntos son comunes a todas las marcas.' });
    if (!pr) { body.appendChild(G.ui.empty('No hay programa de puntos.')); return; }
    const led = G.db.all('loyalty_ledger');
    const mon = G.date.month(today());
    const sumMov = (m, from) => U.sum(led.filter(x => x.movement === m && (!from || dOf(x.created_at) >= from)), x => x.points);
    const bal = U.sum(led, x => x.points);
    const custs = new Set(led.map(x => x.customer_id)).size;
    body.appendChild(kpis([
      { label: 'Puntos ganados este mes', value: F.num(sumMov('EARN', mon)) },
      { label: 'Canjeados este mes', value: F.num(-sumMov('REDEEM', mon)), sub: F.money(-sumMov('REDEEM', mon) * pr.pen_per_point) },
      { label: 'Saldo vigente', value: F.num(bal), sub: `${F.num(custs)} clientes con puntos` },
      { label: 'Pasivo de puntos (KPI-CMP-06)', value: F.money(bal * pr.pen_per_point), sub: `saldo × ${F.money(pr.pen_per_point)}`, tone: 'warn' },
    ]));
    const g = h('div', { class: 'grid c2' }); body.appendChild(g);
    g.appendChild(card('Reglas del programa', form({
      id: 'cmp08', values: pr, submitLabel: G.can('cmp.loyalty.adjust') || G.can('cmp.campaign.manage') ? 'Guardar reglas' : false,
      fields: [{ key: 'name', label: 'Nombre', required: true, span: 2 }, { key: 'points_per_pen', label: 'Puntos por sol cobrado (sin IGV)', type: 'number', min: 0.01, required: true }, { key: 'pen_per_point', label: 'Valor del punto (S/)', type: 'number', min: 0.001, required: true }, { key: 'min_redeem_points', label: 'Canje mínimo (puntos)', type: 'number', min: 1, required: true }, { key: 'expiry_months', label: 'Vencen a los (meses)', type: 'number', min: 1, max: 60, required: true }, { key: 'referral_bonus_points', label: 'Premio por referido (puntos)', type: 'number', min: 0, required: true }, { key: 'brand', label: 'Marca', type: 'readonly', help: 'D-CMP-01: comunes a todas las marcas' }],
      onSubmit: v => { G.db.update('loyalty_programs', pr.id, { name: v.name, points_per_pen: v.points_per_pen, pen_per_point: v.pen_per_point, min_redeem_points: v.min_redeem_points, expiry_months: v.expiry_months, referral_bonus_points: v.referral_bonus_points }); toast('Reglas del programa guardadas', 'ok'); G.refresh(); return true; },
    })));
    const sim = h('div', { class: 'stack' });
    const amt = h('input', { class: 'input', type: 'number', value: 118, attrs: { id: 'cmp08-amt', 'aria-label': 'Monto cobrado' } });
    const out = h('div');
    const calc = () => { const a = Number(amt.value) || 0; const pts = C.pointsFor(a); G.ui.clear(out).appendChild(dl([['Cobrado', F.money(a)], ['Sin IGV', F.money(R(a / (1 + igvRate())))], ['Puntos que gana', h('b', null, F.num(pts))], ['Valor de esos puntos', F.money(pts * pr.pen_per_point)], ['Retorno al cliente', a ? F.pct(pts * pr.pen_per_point / a * 100, 2) : '—'], ['Vencen el', F.date(G.date.addMonths(today(), pr.expiry_months))]])); };
    amt.addEventListener('input', calc); calc();
    sim.append(fld('Monto cobrado (con IGV)', amt), out);
    g.appendChild(card('Simulador (RN-CMP-11)', sim));
    // por mes
    const months = ['2026-09-01', '2026-10-01'];
    const byM = m => led.filter(x => G.date.month(dOf(x.created_at)) === m);
    body.appendChild(card('Movimientos por mes', G.ui.chart.bar({ labels: months.map(G.date.monthName), series: [{ name: 'Ganados', values: months.map(m => U.sum(byM(m).filter(x => x.points > 0), x => x.points)) }, { name: 'Canjeados, vencidos y reversos', values: months.map(m => -U.sum(byM(m).filter(x => x.points < 0), x => x.points)) }], format: v => F.num(v) })));
    const exp = h('div');
    const dIn = h('input', { class: 'input', type: 'date', value: '2027-09-30', attrs: { id: 'cmp08-exp', 'aria-label': 'Fecha de vencimiento' } });
    const prevExp = () => { G.ui.clear(exp); let tot = 0, n = 0; for (const id of ledgerIdx().m.keys()) { const e = C.expiring(id, dIn.value); const p = U.sum(e, x => x.points); if (p) { tot += p; n++; } } exp.appendChild(notice(`Hasta el ${F.date(dIn.value)} vencerían ${F.num(tot)} puntos (${F.money(tot * pr.pen_per_point)}) de ${n} clientes si no se canjean.`, tot ? 'warn' : 'info')); };
    dIn.addEventListener('change', prevExp); prevExp();
    body.appendChild(card('Vencimientos (RN-CMP-11)', h('div', { class: 'stack' }, h('div', { class: 'row' }, dIn, btn('Procesar vencidos al día de hoy', () => { const n = C.runExpiry(today()); toast(n ? `${n} vencimientos registrados` : 'No hay puntos vencidos hoy', n ? 'ok' : 'info'); G.refresh(); }, { sm: true })), exp)));
  }

  /* ---------- CMP-09 Puntos del cliente ---------- */
  function custPoints(id) {
    const pr = C.program();
    drawer(G.custName(id), (bd, close) => {
      const rows = C.ledgerOf(id); const bal = C.balance(id);
      const soon = C.expiring(id, G.date.add(today(), 90));
      bd.appendChild(kpis([{ label: 'Saldo', value: F.num(bal) + ' pts', sub: F.money(bal * pr.pen_per_point) }, { label: 'Vencen en 90 días', value: F.num(U.sum(soon, x => x.points)) }, { label: 'Código de referido', value: (G.db.get('customers', id) || {}).referral_code || '—' }]));
      const pts = h('input', { class: 'input', type: 'number', value: Math.min(bal, Math.max(pr.min_redeem_points, 100)), attrs: { id: 'cmp09-pts', 'aria-label': 'Puntos' } });
      const ords = G.db.where('sales_orders', o => o.customer_id === id && ['DRAFT', 'CONFIRMED'].includes(o.status));
      const os = sel([['', 'Sin pedido (vale de descuento)']].concat(ords.map(o => [o.id, `${o.number} · ${F.money(o.estimated_total)}`])), '', () => { }, { 'aria-label': 'Pedido', id: 'cmp09-order' });
      bd.appendChild(card('Canjear (RN-CMP-12)', h('div', { class: 'stack' }, h('div', { class: 'row' }, pts, os), h('div', { class: 'row' }, btn('Canjear', () => { const r = tryDo(() => C.redeem(id, pts.value, { order_id: os.value || null })); if (r) { toast(`Canje de ${-r.points} puntos por ${F.money(r.value_pen)}`, 'ok'); close(); custPoints(id); } }, { kind: 'primary', sm: true }), G.can('cmp.loyalty.adjust') ? btn('Ajustar con motivo', () => modal('Ajuste de puntos', b2 => { b2.append(fld('Puntos (+/−)', h('input', { class: 'input', type: 'number', attrs: { id: 'cmp09-adj' } })), fld('Motivo', h('input', { class: 'input', attrs: { id: 'cmp09-why' } }))); }, [{ label: 'Cancelar' }, { label: 'Registrar ajuste', kind: 'primary', onClick: () => { const r = tryDo(() => C.adjust(id, document.getElementById('cmp09-adj').value, document.getElementById('cmp09-why').value), 'Ajuste registrado'); if (r) { close(); custPoints(id); } return !!r; } }]), { sm: true }) : null))));
      bd.appendChild(h('h3', null, 'Movimientos (solo inserción, RN-CMP-13)'));
      bd.appendChild(table({ id: 'cmp09-led-' + id, search: false, pageSize: 10, rows, columns: [{ key: 'created_at', label: 'Fecha', render: r => F.datetime(r.created_at) }, { key: 'movement', label: 'Movimiento', render: r => bdg(MOV, r.movement) }, { key: 'points', label: 'Puntos', align: 'r', render: r => h('b', { style: `color:var(--${r.points < 0 ? 'bad' : 'ok'})` }, (r.points > 0 ? '+' : '') + F.num(r.points)) }, { key: 'reason', label: 'Detalle' }, { key: 'expires_on', label: 'Vence', render: r => r.points > 0 ? F.date(r.expires_on) : '' }], actions: r => G.can('cmp.loyalty.adjust') && r.movement !== 'REVERSAL' && !G.db.find('loyalty_ledger', x => x.reversal_of === r.id) ? [btn('Revertir', () => { const r2 = tryDo(() => C.reverse(r, 'Corrección: ' + (r.reason || r.movement)), 'Reverso registrado'); if (r2) { close(); custPoints(id); } }, { sm: true, kind: 'ghost' })] : [] }));
    }, { code: 'CMP-09', wide: true });
  }
  function scr09(el, params) {
    const pr = C.program() || { pen_per_point: 0.05 };
    const body = page(el, { code: 'CMP-09', title: scName('CMP-09'), sub: 'Saldo, movimientos y próximos vencimientos por cliente; canje y ajuste con motivo.' });
    const idx = ledgerIdx().m; const st = C.stats();
    const rows = [...idx.entries()].map(([id, rs]) => { const c = G.db.get('customers', id) || {}; return { id, name: c.full_name, phone: c.phone, code: c.referral_code, bal: U.sum(rs, x => x.points), earned: U.sum(rs.filter(x => x.points > 0), x => x.points), redeemed: -U.sum(rs.filter(x => x.movement === 'REDEEM'), x => x.points), last: rs.map(x => x.created_at).sort().pop(), orders: (st.by.get(id) || {}).n || 0 }; });
    body.appendChild(kpis([{ label: 'Clientes con saldo', value: F.num(rows.filter(r => r.bal > 0).length) }, { label: 'Pueden canjear', value: F.num(rows.filter(r => r.bal >= (C.program() || {}).min_redeem_points).length), sub: `saldo ≥ ${(C.program() || {}).min_redeem_points} puntos` }, { label: 'Saldo promedio', value: F.num(rows.length ? U.sum(rows, r => r.bal) / rows.length : 0) + ' pts' }]));
    body.appendChild(table({ id: 'cmp09', rows, sort: 'bal', dir: -1, onRow: r => custPoints(r.id), filters: [{ key: 'can', label: 'Canje', options: [['1', 'Puede canjear'], ['0', 'Aún no']], value: r => r.bal >= (C.program() || {}).min_redeem_points ? '1' : '0' }], columns: [{ key: 'name', label: 'Cliente' }, { key: 'phone', label: 'Celular', mono: true }, { key: 'code', label: 'Código', mono: true }, { key: 'orders', label: 'Pedidos', align: 'r' }, { key: 'earned', label: 'Ganados', align: 'r', render: r => F.num(r.earned) }, { key: 'redeemed', label: 'Canjeados', align: 'r', render: r => F.num(r.redeemed) }, { key: 'bal', label: 'Saldo', align: 'r', render: r => h('b', null, F.num(r.bal)) }, { key: 'value', label: 'Valor', align: 'r', value: r => R(r.bal * pr.pen_per_point), render: r => F.money(r.bal * pr.pen_per_point) }, { key: 'last', label: 'Último movimiento', render: r => F.date(r.last) }] }));
    if (params.customer_id) setTimeout(() => custPoints(params.customer_id), 0);
  }

  /* ---------- CMP-10 Referidos ---------- */
  function scr10(el) {
    const refs = G.db.all('referrals');
    const body = page(el, { code: 'CMP-10', title: scName('CMP-10'), sub: 'Cada cliente tiene su código. El referido es un cliente nuevo; el premio (200 puntos al referente y 10 % al referido, D-CMP-02) se da cuando su primer pedido queda entregado y cobrado.', actions: G.can('cmp.campaign.manage') || G.can('cmp.coupon.manage') ? [{ label: 'Registrar referido', kind: 'primary', icon: '+', onClick: newRef }] : [] });
    const mon = G.date.month(today());
    body.appendChild(kpis([{ label: 'Referidos', value: refs.length }, { label: 'Premiados este mes (KPI-CMP-07)', value: G.kpi('KPI-CMP-07', { from: mon, to: today() }).value, tone: 'ok' }, { label: 'Pendientes de primer pedido', value: refs.filter(r => ['PENDING', 'QUALIFIED'].includes(r.status)).length, tone: 'warn' }, { label: 'Rechazados', value: refs.filter(r => r.status === 'REJECTED').length }]));
    body.appendChild(table({
      id: 'cmp10', rows: refs, onRow: refDrawer, filters: [{ key: 'status', label: 'Estado', options: Object.entries(REF_ST).map(([k, v]) => [k, v[0]]) }],
      columns: [{ key: 'referral_code', label: 'Código', mono: true }, { key: 'referrer_customer_id', label: 'Referente', render: r => G.custName(r.referrer_customer_id), value: r => G.custName(r.referrer_customer_id) }, { key: 'referred_customer_id', label: 'Referido', render: r => G.custName(r.referred_customer_id), value: r => G.custName(r.referred_customer_id) }, { key: 'created_at', label: 'Registrado', render: r => F.date(r.created_at) }, { key: 'first_order_id', label: 'Primer pedido', render: r => r.first_order_id ? (G.db.get('sales_orders', r.first_order_id) || {}).number : '—' }, { key: 'status', label: 'Estado', render: r => bdg(REF_ST, r.status) }, { key: 'reward', label: 'Premio', render: r => r.status === 'REWARDED' ? '+200 pts al referente' : '—', sort: false }],
    }));
    const top = Object.entries(U.groupBy(refs.filter(r => r.status !== 'REJECTED'), 'referrer_customer_id')).map(([id, rs]) => ({ id, name: G.custName(id), code: (G.db.get('customers', id) || {}).referral_code, n: rs.length, ok: rs.filter(x => x.status === 'REWARDED').length })).sort((a, b) => b.n - a.n);
    body.appendChild(card('Clientes que más refieren', table({ id: 'cmp10-top', search: false, rows: top, columns: [{ key: 'name', label: 'Cliente' }, { key: 'code', label: 'Código de referido', mono: true }, { key: 'n', label: 'Referidos', align: 'r' }, { key: 'ok', label: 'Premiados', align: 'r' }] }), { flush: true }));
    function newRef() {
      drawer('Registrar referido', (bd, close) => {
        const persons = G.db.where('customers', c => c.customer_type === 'PERSON' && c.status === 'ACTIVE');
        bd.appendChild(form({ id: 'cmp10', values: {}, fields: [{ key: 'code', label: 'Código del referente', required: true, placeholder: 'ROSA0012', help: 'El código que el cliente comparte (customers.referral_code)' }, { key: 'referred', label: 'Cliente referido', type: 'select', required: true, options: persons.filter(c => !(c.orders_count > 0)).map(c => [c.id, c.full_name + ' · ' + (c.phone || '')]).concat(persons.filter(c => c.orders_count > 0).slice(0, 30).map(c => [c.id, c.full_name + ' (ya compró)'])) }], onCancel: close, onSubmit: v => { const a = G.db.find('customers', c => String(c.referral_code || '').toUpperCase() === String(v.code).trim().toUpperCase()); if (!a) return { code: 'No existe ese código de referido.' }; const r = C.registerReferral(a.id, v.referred); close(); toast(`Referido registrado. Cupón de bienvenida ${r.welcome_coupon} para ${G.custName(v.referred)}`, 'ok'); G.refresh(); return true; } }));
      }, { code: 'CMP-10' });
    }
    function refDrawer(r) {
      drawer('Referido de ' + G.custName(r.referrer_customer_id), (bd, close) => {
        const o = r.first_order_id && G.db.get('sales_orders', r.first_order_id);
        bd.appendChild(dl([['Referente', G.custName(r.referrer_customer_id)], ['Código', r.referral_code], ['Referido', G.custName(r.referred_customer_id)], ['Estado', bdg(REF_ST, r.status)], ['Primer pedido', o ? `${o.number} · ${G.ui.statusLabel(o.status)} · cobrado ${F.money(o.paid_amount)} de ${F.money(o.final_total ?? o.estimated_total)}` : 'Aún sin pedido'], ['Calificado', F.datetime(r.qualified_at)], ['Premio', r.reward_ledger_id ? '+200 puntos al referente' : '—'], ['Motivo de rechazo', r.reject_reason]]));
        bd.appendChild(h('div', { class: 'row' }, ['PENDING', 'QUALIFIED'].includes(r.status) ? btn('Verificar primer pedido', () => { const ord = G.db.where('sales_orders', x => x.customer_id === r.referred_customer_id && x.status !== 'CANCELLED').sort(U.by('created_at'))[0]; if (!ord) return toast('El referido aún no tiene pedidos.', 'info'); const res = C.checkReferral(ord); toast(res && res.status === 'REWARDED' ? 'Premio otorgado al referente' : 'Aún falta que el pedido esté entregado y cobrado', res && res.status === 'REWARDED' ? 'ok' : 'info'); close(); G.refresh(); }, { sm: true }) : null, ['PENDING', 'QUALIFIED'].includes(r.status) ? btn('Rechazar', () => modal('Rechazar referido', b2 => { b2.appendChild(fld('Motivo', h('input', { class: 'input', attrs: { id: 'cmp10-why' } }))); }, [{ label: 'Volver' }, { label: 'Rechazar', kind: 'danger', onClick: () => { const ok = tryDo(() => C.rejectReferral(r, document.getElementById('cmp10-why').value), 'Referido rechazado'); if (ok !== null) close(); return ok !== null; } }]), { sm: true, kind: 'danger' }) : null));
      }, { code: 'CMP-10' });
    }
  }

  /* ---------- CMP-11 Consentimientos por marca ---------- */
  function scr11(el) {
    const rows = G.db.where('contact_consents', x => x.purpose === 'MARKETING');
    const body = page(el, { code: 'CMP-11', title: scName('CMP-11'), sub: 'Amplía CRM-18 con la marca: consentimiento y bajas por cliente, canal y marca (Ley 29733). El registro es de solo inserción y el último manda.' });
    const brands = G.scope.brands();
    const pers = universe();
    const ok = b => pers.filter(c => C.hasConsent(c.id, b).ok).length;
    const since = G.date.add(today(), -30);
    const kw = rows.filter(r => !r.granted && r.source === 'KEYWORD' && dOf(r.recorded_at) >= since);
    body.appendChild(kpis([{ label: 'Clientes con celular', value: F.num(pers.length) }, ...brands.slice(0, 5).map(b => ({ label: 'Aceptan ' + G.brandName(b.id), value: F.num(ok(b.id)), sub: F.pct(ok(b.id) / pers.length * 100, 0) })), { label: 'Bajas por palabra clave (30 días)', value: kw.length, tone: kw.length ? 'warn' : '' }]));
    const tb = tabs([
      { key: 'reg', label: 'Registro', render: p => p.appendChild(table({ id: 'cmp11-reg', rows: rows.slice().sort(U.by('recorded_at', -1)), filters: [{ key: 'brand_id', label: 'Marca', options: [['', 'Todas las marcas']].concat(brands.map(b => [b.id, G.brandName(b.id)])), value: r => r.brand_id || '' }, { key: 'granted', label: 'Tipo', options: [['true', 'Consentimiento'], ['false', 'Baja']] }, { key: 'source', label: 'Origen', options: [['FIRST_ORDER', 'Primer pedido'], ['KEYWORD', 'Palabra clave'], ['MANUAL', 'Manual'], ['CRM', 'Bandeja CRM']] }], columns: [{ key: 'recorded_at', label: 'Fecha', render: r => F.datetime(r.recorded_at) }, { key: 'customer_id', label: 'Cliente', render: r => G.custName(r.customer_id), value: r => G.custName(r.customer_id) }, { key: 'channel', label: 'Canal', render: r => G.channelName(r.channel) }, { key: 'brand_id', label: 'Marca', render: r => r.brand_id ? G.brandName(r.brand_id) : 'Todas' }, { key: 'granted', label: 'Registro', render: r => r.granted ? badge('Consentimiento', 'ok') : badge('Baja', 'bad') }, { key: 'evidence_text', label: 'Evidencia' }, { key: 'campaign_id', label: 'Campaña', render: r => r.campaign_id ? (G.db.get('campaigns', r.campaign_id) || {}).code : '' }] })) },
      { key: 'cli', label: 'Estado por cliente y marca', render: p => { const data = pers.slice(0, 600).map(c => { const o = { id: c.id, name: c.full_name, phone: c.phone }; for (const b of brands) o[b.id] = C.hasConsent(c.id, b.id).ok; return o; }); p.appendChild(table({ id: 'cmp11-cli', rows: data, onRow: r => consentDrawer(r.id), columns: [{ key: 'name', label: 'Cliente' }, { key: 'phone', label: 'Celular', mono: true }].concat(brands.map(b => ({ key: b.id, label: G.brandName(b.id), render: r => r[b.id] ? badge('Sí', 'ok') : badge('No', 'bad') }))) })); } },
      { key: 'camp', label: 'Bajas por campaña', render: p => { const cs = G.db.where('campaigns', c => c.status === 'SENT').map(c => { const x = C.results(c); return { id: c.id, code: c.code, name: c.name, brand: c.brand_id, delivered: x.delivered, optouts: x.optouts, pct: x.delivered ? R(x.optouts / x.delivered * 100, 2) : 0 }; }); p.appendChild(table({ id: 'cmp11-camp', search: false, rows: cs, onRow: r => G.go('CMP-06', { id: r.id }), columns: [{ key: 'code', label: 'Campaña', mono: true }, { key: 'name', label: 'Nombre' }, { key: 'brand', label: 'Marca', render: r => G.brandName(r.brand) }, { key: 'delivered', label: 'Entregados', align: 'r' }, { key: 'optouts', label: 'Bajas', align: 'r' }, { key: 'pct', label: '% bajas (KPI-CMP-04)', align: 'r', render: r => F.pct(r.pct, 2) }] })); } },
      { key: 'sim', label: 'Mensaje entrante', render: p => {
        p.appendChild(notice(`Palabras de baja (cmp_optout_keywords): ${(P('cmp_optout_keywords') || []).join(', ')}. La baja se registra al instante, se confirma con un mensaje de servicio gratuito y se respeta en todas las campañas de la marca (RN-CMP-04).`, 'info'));
        p.appendChild(form({ id: 'cmp11-sim', values: { brand_id: 'br-DG', text: 'BAJA' }, submitLabel: 'Recibir mensaje', fields: [{ key: 'customer_id', label: 'Cliente', type: 'select', required: true, options: pers.slice(0, 300).map(c => [c.id, c.full_name + ' · ' + c.phone]) }, { key: 'brand_id', label: 'Número de la marca', type: 'select', required: true, options: brandOpts(false) }, { key: 'text', label: 'Texto que escribe el cliente', required: true, span: 2 }], onSubmit: v => { const r = C.inbound(v); toast(r.optout ? `Baja de ${G.brandName(v.brand_id)} registrada para ${G.custName(v.customer_id)} (RN-CMP-04)` : 'Mensaje registrado: no es una palabra de baja', r.optout ? 'warn' : 'info'); G.refresh(); return true; } }));
      } },
    ]);
    tb.style.minWidth = '0'; if (tb.firstChild) { tb.firstChild.style.overflowX = 'auto'; tb.firstChild.style.maxWidth = '100%'; }
    body.appendChild(tb);
  }
  function consentDrawer(id) {
    drawer(G.custName(id), (bd, close) => {
      const rows = (consentIdx().m.get(id) || []).slice().reverse();
      bd.appendChild(dl(G.scope.brands().map(b => [G.brandName(b.id), C.hasConsent(id, b.id).ok ? badge('Acepta marketing', 'ok') : badge('Sin consentimiento', 'bad')])));
      const can = G.can('crm.consent.manage') || G.can('cmp.campaign.manage');
      if (can) bd.appendChild(form({ id: 'cmp11-c', values: { brand_id: '', granted: 'false' }, submitLabel: 'Registrar', fields: [{ key: 'brand_id', label: 'Marca', type: 'select', options: brandOpts(true) }, { key: 'granted', label: 'Registro', type: 'select', required: true, options: [['true', 'Consentimiento'], ['false', 'Baja']] }, { key: 'evidence', label: 'Evidencia', required: true, span: 2, placeholder: 'Mensaje, formulario o llamada' }], onSubmit: v => { C.setConsent({ customer_id: id, brand_id: v.brand_id || null, granted: v.granted === 'true', evidence: v.evidence }); toast('Registro de consentimiento agregado', 'ok'); close(); G.refresh(); return true; } }));
      bd.appendChild(h('div', { class: 'timeline' }, rows.map(r => h('div', { class: 'tl-item' }, h('b', null, (r.granted ? 'Consentimiento' : 'Baja') + ' · ' + (r.brand_id ? G.brandName(r.brand_id) : 'todas las marcas')), h('div', { class: 'small muted' }, `${F.datetime(r.recorded_at)} · ${r.evidence_text || ''}`)))));
    }, { code: 'CMP-11' });
  }

  /* ---------- CMP-12 Recompra esperada ---------- */
  function scr12(el) {
    const due = C.rebuyDue().filter(x => !x.brand_id || G.scope.ok({ brand_id: x.brand_id }));
    const pint = [...C.productIntervals().values()].filter(x => x.interval).map(x => Object.assign({ name: (G.db.get('products', x.product_id) || {}).name, brand_id: (G.db.get('products', x.product_id) || {}).brand_id }, x)).sort((a, b) => b.buyers - a.buyers);
    const body = page(el, { code: 'CMP-12', title: scName('CMP-12'), sub: 'Clientes que ya pasaron su frecuencia habitual de compra de un producto. El intervalo sale de sus compras repetidas o, si compró una vez, de la mediana del producto.' });
    const cuy = pint.find(x => (G.variant('va-DG-CUY-ENT') || {}).product_id === x.product_id);
    body.appendChild(kpis([{ label: 'Recompras vencidas', value: F.num(due.length), sub: `${F.num(new Set(due.map(x => x.customer_id)).size)} clientes` }, { label: 'En riesgo', value: F.num(due.filter(x => x.status === 'AT_RISK').length), sub: 'más del doble del intervalo', tone: 'bad' }, { label: 'Con consentimiento', value: F.num(due.filter(x => C.hasConsent(x.customer_id, x.brand_id).ok).length), tone: 'ok' }, cuy ? { label: 'El cuy se recompra cada', value: `~${cuy.interval} días`, sub: `mediana de ${cuy.samples} recompras de ${cuy.repeat} clientes` } : null].filter(Boolean)));
    const st = { rows: due };
    body.appendChild(table({
      id: 'cmp12', rows: due, sort: 'over', dir: -1,
      filters: [{ key: 'brand_id', label: 'Marca', options: brandOpts(false) }, { key: 'zone_id', label: 'Zona', options: G.db.all('delivery_zones').map(z => [z.id, z.name]) }, { key: 'product_id', label: 'Producto', options: pint.map(p => [p.product_id, p.name]) }, { key: 'status', label: 'Estado', options: [['DUE', 'Le toca'], ['AT_RISK', 'En riesgo']] }],
      columns: [{ key: 'customer_id', label: 'Cliente', render: r => G.custName(r.customer_id), value: r => G.custName(r.customer_id) }, { key: 'brand_id', label: 'Marca', render: r => G.brandName(r.brand_id) }, { key: 'zone_id', label: 'Zona', render: r => r.zone_id ? G.zoneName(r.zone_id) : '—' }, { key: 'product_id', label: 'Producto', render: r => (G.db.get('products', r.product_id) || {}).name, value: r => (G.db.get('products', r.product_id) || {}).name }, { key: 'last', label: 'Última compra', render: r => F.date(r.last) }, { key: 'interval', label: 'Cada', align: 'r', render: r => `${r.interval} d${r.own ? '' : ' *'}` }, { key: 'over', label: 'Vencida hace', align: 'r', render: r => F.days(r.over) }, { key: 'status', label: 'Estado', render: r => r.status === 'AT_RISK' ? badge('En riesgo', 'bad') : badge('Le toca', 'warn') }, { key: 'ok', label: 'Consentimiento', value: r => C.hasConsent(r.customer_id, r.brand_id).ok ? 'Sí' : 'No', render: r => C.hasConsent(r.customer_id, r.brand_id).ok ? badge('Sí', 'ok') : badge('No', 'bad') }],
      toolbar: G.can('cmp.segment.manage') ? [btn('Crear segmento con este filtro', () => {
        const f = (G.ui._tblState || {})['cmp12'] || { f: {} }; const fl = f.f || {};
        const rules = { rebuy_due: true }; if (fl.product_id) rules.rebuy_product = fl.product_id; if (fl.brand_id) rules.brands = [fl.brand_id]; if (fl.zone_id) rules.zones = [fl.zone_id];
        G.go('CMP-02', { rules });
      }, { sm: true })] : null,
    }));
    body.appendChild(h('div', { class: 'small muted' }, '* intervalo de la mediana del producto: el cliente compró una sola vez.'));
    body.appendChild(card('Frecuencia de recompra por producto', table({ id: 'cmp12-p', search: false, pageSize: 10, rows: pint, columns: [{ key: 'name', label: 'Producto' }, { key: 'brand_id', label: 'Marca', render: r => G.brandName(r.brand_id) }, { key: 'buyers', label: 'Compradores', align: 'r' }, { key: 'repeat', label: 'Recompraron', align: 'r' }, { key: 'interval', label: 'Intervalo mediano', align: 'r', render: r => `${r.interval} días` }] }), { flush: true }));
    void st;
  }

  /* ---------- CMP-13 Calendario ---------- */
  let calMonth = null;
  function scr13(el) {
    calMonth = calMonth || G.date.month(today());
    const body = page(el, { code: 'CMP-13', title: scName('CMP-13'), sub: `Vista mensual por marca para no saturar a los mismos clientes: el tope es de ${P('cmp_max_marketing_per_week')} mensajes de marketing por cliente y semana entre todas las marcas (RN-CMP-05).`, actions: [btn('‹ Mes anterior', () => { calMonth = G.date.addMonths(calMonth, -1); G.refresh(); }), btn('Mes siguiente ›', () => { calMonth = G.date.addMonths(calMonth, 1); G.refresh(); })] });
    const cs = G.db.all('campaigns').filter(inScope).filter(c => G.date.month(dOf(c.sent_at || c.scheduled_at)) === calMonth);
    body.appendChild(h('h2', { style: 'margin:0' }, ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'][Number(calMonth.slice(5, 7)) - 1] + ' ' + calMonth.slice(0, 4)));
    const first = G.date.parse(calMonth); const dow = (first.getUTCDay() + 6) % 7; const last = G.date.add(G.date.addMonths(calMonth, 1), -1); const nd = Number(last.slice(8, 10));
    const grid = h('div', { style: 'display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px' });
    for (const d of ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']) grid.appendChild(h('div', { class: 'small muted', style: 'text-align:center;font-weight:600' }, d));
    for (let i = 0; i < dow; i++) grid.appendChild(h('div'));
    const byDay = U.groupBy(cs, c => dOf(c.sent_at || c.scheduled_at));
    for (let d = 1; d <= nd; d++) {
      const ds = calMonth.slice(0, 8) + U.pad(d, 2);
      const items = byDay[ds] || [];
      grid.appendChild(h('div', { style: `min-height:74px;border:1px solid var(--line);border-radius:8px;padding:4px;min-width:0;overflow:hidden;background:${ds === today() ? 'var(--primary-soft, var(--surface-2))' : 'var(--surface)'}` },
        h('div', { class: 'small', style: 'font-weight:600' }, d),
        items.map(c => { const b = G.db.get('brands', c.brand_id); return h('button', { class: 'small', title: `${c.code} · ${c.name} · ${lbl(CAMP_ST, c.status)}`, style: `display:block;width:100%;text-align:left;border:0;border-left:3px solid ${b ? b.primary_color : 'var(--primary)'};background:var(--surface-2, transparent);margin-top:3px;padding:2px 4px;border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;color:inherit;${c.status === 'CANCELLED' ? 'text-decoration:line-through;opacity:.6' : ''}`, on: { click: () => G.go(c.status === 'SENT' ? 'CMP-06' : 'CMP-05', { id: c.id }) } }, G.brandName(c.brand_id) + ' · ' + c.name); })));
    }
    body.appendChild(card(null, grid));
    // saturación por semana: clientes alcanzados por más de una campaña
    const weeks = {};
    for (const c of cs.filter(x => x.status !== 'CANCELLED')) {
      const d = dOf(c.sent_at || c.scheduled_at); const wd = (G.date.parse(d).getUTCDay() + 6) % 7; const wk = G.date.add(d, -wd);
      const ids = c.status === 'SENT' ? G.db.where('campaign_recipients', x => x.campaign_id === c.id && x.sent_at).map(x => x.customer_id) : C.plan(c, { noRefresh: true }).rows.filter(x => x.status === 'QUEUED').map(x => x.customer_id);
      (weeks[wk] = weeks[wk] || { wk, camps: [], hits: new Map() }).camps.push(c);
      for (const id of ids) weeks[wk].hits.set(id, (weeks[wk].hits.get(id) || 0) + 1);
    }
    const max = P('cmp_max_marketing_per_week') || 2;
    const rows = Object.values(weeks).sort(U.by('wk')).map(w => ({ wk: w.wk, camps: w.camps.map(c => c.code + ' ' + G.brandName(c.brand_id)).join(' · '), reach: w.hits.size, multi: [...w.hits.values()].filter(n => n > 1).length, over: [...w.hits.values()].filter(n => n > max).length }));
    body.appendChild(card('Saturación por semana', table({ id: 'cmp13-w', search: false, rows, columns: [{ key: 'wk', label: 'Semana del', render: r => F.date(r.wk) }, { key: 'camps', label: 'Campañas' }, { key: 'reach', label: 'Clientes alcanzados', align: 'r' }, { key: 'multi', label: 'Reciben 2 o más', align: 'r', render: r => r.multi ? badge(F.num(r.multi), 'warn') : '0' }, { key: 'over', label: `Sobre el tope (${max})`, align: 'r', render: r => r.over ? badge(F.num(r.over) + ' se omitirán', 'bad') : '0' }] }), { flush: true }));
  }

  /* ------------------------------------------------------------------
     Registro del módulo, búsqueda, escaneo y alertas
     ------------------------------------------------------------------ */
  G.register({
    code: 'CMP', name: 'Campañas y fidelización', phase: 3, group: 'Nuevos canales',
    screens: [
      { code: 'CMP-01', name: scName('CMP-01'), render: scr01 }, { code: 'CMP-02', name: scName('CMP-02'), render: scr02 }, { code: 'CMP-03', name: scName('CMP-03'), render: scr03 },
      { code: 'CMP-04', name: scName('CMP-04'), render: scr04 }, { code: 'CMP-05', name: scName('CMP-05'), render: scr05 }, { code: 'CMP-06', name: scName('CMP-06'), render: scr06 },
      { code: 'CMP-07', name: scName('CMP-07'), render: scr07 }, { code: 'CMP-08', name: scName('CMP-08'), render: scr08 }, { code: 'CMP-09', name: scName('CMP-09'), render: scr09 },
      { code: 'CMP-10', name: scName('CMP-10'), render: scr10 }, { code: 'CMP-11', name: scName('CMP-11'), render: scr11 }, { code: 'CMP-12', name: scName('CMP-12'), render: scr12 },
      { code: 'CMP-13', name: scName('CMP-13'), render: scr13 },
    ],
  });
  void scSub;
  G.searchProviders.push(q => {
    if (!G.canSee('CMP')) return [];
    const out = [];
    for (const c of G.db.all('campaigns')) if ((c.code + ' ' + c.name).toLowerCase().includes(q)) out.push({ label: c.code + ' · ' + c.name, sub: 'Campaña · ' + lbl(CAMP_ST, c.status), go: () => G.go(c.status === 'SENT' ? 'CMP-06' : 'CMP-05', { id: c.id }) });
    for (const c of G.db.all('coupons')) if (c.code.toLowerCase().includes(q)) out.push({ label: 'Cupón ' + c.code, sub: c.description || discName(c.discount_type), go: () => { G.go('CMP-07'); setTimeout(() => couponDrawer(c), 0); } });
    for (const s of G.db.all('customer_segments')) if ((s.code + ' ' + s.name).toLowerCase().includes(q)) out.push({ label: s.name, sub: 'Segmento · ' + s.code, go: () => { G.go('CMP-01'); setTimeout(() => segDrawer(s), 0); } });
    return out.slice(0, 8);
  });
  G.scanHandlers.push(code => { const cp = C.couponByCode(code); return cp && G.canSee('CMP') ? () => { G.go('CMP-07'); setTimeout(() => couponDrawer(cp), 0); } : null; });
  G.alertProviders.push(() => {
    if (!G.canSee('CMP')) return [];
    const out = [];
    const pend = G.db.where('campaigns', c => c.status === 'PENDING_APPROVAL');
    if (pend.length) out.push({ module: 'CMP', title: `${pend.length} campaña(s) por aprobar`, detail: pend.map(c => `${c.code} · ${F.money(c.estimated_cost)}`).join(', '), tone: 'warn', go: () => G.go('CMP-05', { id: pend[0].id }) });
    const soon = G.db.where('campaigns', c => c.status === 'APPROVED' && c.scheduled_at && G.date.diff(dOf(c.scheduled_at), today()) <= 5);
    if (soon.length) out.push({ module: 'CMP', title: `${soon.length} campaña(s) aprobadas salen en 5 días`, detail: soon.map(c => `${c.code} el ${F.date(c.scheduled_at)}`).join(', '), tone: 'info', go: () => G.go('CMP-13') });
    return out;
  });

  /* ------------------------------------------------------------------
     Pruebas de aceptación (CA-CMP-01 a 09)
     ------------------------------------------------------------------ */
  const eq = (a, b, msg) => { if (Math.abs(Number(a) - Number(b)) > 0.005) throw new Error(`${msg}: se esperaba ${b} y salió ${a}`); };
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e; throw new Error(`Se esperaba ${code} y salió: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code}`); };
  G.tests.push({ module: 'CMP', name: 'CA-CMP-01: 1 000 inactivos, 100 de control → 900 efectivos, S/ 210,51 y aprobación de GERENTE', fn: async () => {
    const e = C.estimate({ eligible: 1000, controlPct: 10, excludedConsent: 0 });
    eq(e.control, 100, 'Grupo de control'); eq(e.effective, 900, 'Efectivos'); eq(e.cost, 210.51, 'Costo estimado');
    if (!e.needsGerente) throw new Error('Debía exigir GERENTE');
    const c = G.db.get('campaigns', 'cm-CMP-0006'); c.estimated_cost = e.cost; c.status = 'PENDING_APPROVAL';
    const adm = G.db.find('users', u => u.role === 'ADMINISTRACION');
    expectFail(() => C.approve(c, { role: 'ADMINISTRACION', user_id: adm.id }), 'RN-CMP-02');
    const ger = G.db.find('users', u => u.role === 'GERENTE');
    C.approve(c, { role: 'GERENTE', user_id: ger.id }); if (c.status !== 'APPROVED') throw new Error('GERENTE no pudo aprobar');
  } });
  G.tests.push({ module: 'CMP', name: 'CA-CMP-02: quien escribió «BAJA» queda excluido por consentimiento y el envío se rechaza con RN-CMP-03', fn: async () => {
    const seg = G.db.get('customer_segments', 'sg-SEG-DG-14');
    const id = segMembers(seg).find(x => C.hasConsent(x, 'br-DG').ok); if (!id) throw new Error('Sin cliente con consentimiento en el segmento');
    const r = C.inbound({ customer_id: id, brand_id: 'br-DG', text: 'BAJA' }); if (!r.optout) throw new Error('No reconoció la palabra BAJA');
    const camp = G.db.get('campaigns', 'cm-CMP-0007'); const fake = Object.assign({}, camp, { segment_id: seg.id, brand_id: 'br-DG', code: 'T-CA02' });
    const { rows } = C.plan(fake); const row = rows.find(x => x.customer_id === id);
    if (!row || row.status !== 'SKIPPED_CONSENT') throw new Error('No quedó excluido por consentimiento: ' + (row && row.status));
    expectFail(() => C.sendTo(fake, id), 'RN-CMP-03');
  } });
  G.tests.push({ module: 'CMP', name: 'CA-CMP-03: VUELVE10 (1 uso por cliente) en un segundo pedido se rechaza con RN-CMP-08', fn: async () => {
    const cu = G.db.insert('customers', { doc_type: 'DNI', doc_number: '70998877', full_name: 'Cliente Prueba Cupón', phone: '+51987650022', customer_type: 'PERSON', marketing_opt_in: true, status: 'ACTIVE' });
    const mk = () => { const o = G.orders.create({ customer_id: cu.id, brand_id: 'br-DG', channel: 'WHATSAPP', fulfillment: 'PICKUP', lines: [{ variant_id: 'va-DG-CAL-1L', qty: 3 }] }); return o; };
    const o1 = mk(), o2 = mk();
    const r1 = C.applyCoupon(o1, 'VUELVE10'); eq(r1.discount, R(o1.lines[0].est_amount * 0.1), 'Descuento del 10 %');
    expectFail(() => C.applyCoupon(o2, 'VUELVE10'), 'RN-CMP-08');
    expectFail(() => C.applyCoupon(o1, 'CUY5'), 'RN-CMP-10');
  } });
  G.tests.push({ module: 'CMP', name: 'CA-CMP-04: cobro de S/ 118,00 da 100 puntos y su reverso registra −100', fn: async () => {
    const before = C.balance('cu-0003');
    const p = G.pay.register({ customer_id: 'cu-0003', payment_method_id: 'pm-CASH', amount: 118, brand_id: 'br-DG', establishment_id: 'es-L1' });
    const e = G.db.find('loyalty_ledger', x => x.payment_id === p.id && x.movement === 'EARN'); if (!e) throw new Error('No se registraron puntos'); eq(e.points, 100, 'Puntos ganados');
    G.events.emit('payment.reversed', { payment_id: p.id, reason: 'Prueba' });
    const rv = G.db.find('loyalty_ledger', x => x.payment_id === p.id && x.movement === 'REVERSAL'); if (!rv) throw new Error('No hubo reverso'); eq(rv.points, -100, 'Reverso');
    eq(C.balance('cu-0003'), before, 'Saldo final');
  } });
  G.tests.push({ module: 'CMP', name: 'CA-CMP-05: con 300 puntos, canjear 500 se rechaza con RN-CMP-12', fn: async () => {
    const id = 'cu-0400'; const bal = C.balance(id); C.adjust(id, 300 - bal || 1, 'Prueba de saldo'); if (C.balance(id) !== 300) C.adjust(id, 300 - C.balance(id), 'Prueba de saldo');
    eq(C.balance(id), 300, 'Saldo preparado');
    expectFail(() => C.redeem(id, 500), 'RN-CMP-12');
    const ok = C.redeem(id, 200); eq(ok.points, -200, 'Canje válido'); eq(ok.value_pen, 10, 'Valor del canje');
  } });
  G.tests.push({ module: 'CMP', name: 'CA-CMP-06: 45 pedidos por S/ 4 050, mensajes S/ 210,51 y descuentos S/ 405 → retorno 5,58', fn: async () => {
    const cost = R(210.51 + 405); eq(cost, 615.51, 'Costo total');
    eq(C.roi({ collected: 4050, cost }), 5.58, 'Retorno neto');
    const c = G.db.where('campaigns', x => x.status === 'SENT')[0]; const x = C.results(c);
    eq(x.roi, C.roi({ collected: x.collected, cost: x.total }), 'Retorno de una campaña sembrada');
  } });
  G.tests.push({ module: 'CMP', name: 'CA-CMP-07: autorreferido se rechaza con RN-CMP-14; el referido nuevo se premia al quedar entregado y cobrado', fn: async () => {
    const ref = G.db.find('customers', c => c.customer_type === 'PERSON' && c.orders_count >= 3);
    expectFail(() => C.registerReferral(ref.id, ref.id), 'RN-CMP-14');
    const nb = G.db.insert('customers', { doc_type: 'DNI', doc_number: '70112233', full_name: 'Lucía Prueba Referida', phone: '+51987650011', customer_type: 'PERSON', source_channel: 'WHATSAPP', marketing_opt_in: true, status: 'ACTIVE', orders_count: 0 });
    const rr = C.registerReferral(ref.id, nb.id); if (rr.status !== 'PENDING') throw new Error('El referido no quedó pendiente');
    expectFail(() => C.registerReferral(G.db.find('customers', c => c.orders_count >= 2 && c.id !== ref.id).id, nb.id), 'RN-CMP-14');
    const o = G.orders.create({ customer_id: nb.id, brand_id: 'br-DG', channel: 'WHATSAPP', fulfillment: 'PICKUP', establishment_id: 'es-L1', pickup_establishment_id: 'es-L1', delivery_date: G.TODAY, slot_id: 'ts-L1-1', payment_method_id: 'pm-YAPE', notes: 'Recoge en tienda', lines: [{ variant_id: 'va-DG-CAL-1L', qty: 2 }] });
    const before = C.balance(ref.id);
    G.orders.transition(o, 'CONFIRMED'); G.orders.transition(o, 'IN_PREPARATION'); G.orders.transition(o, 'READY'); G.orders.transition(o, 'DELIVERED');
    if (G.db.get('referrals', rr.id).status === 'REWARDED') throw new Error('Se premió sin cobro');
    G.pay.register({ customer_id: nb.id, payment_method_id: 'pm-YAPE', amount: o.estimated_total, reference: 'OP123456', allocations: [{ order_id: o.id, amount: o.estimated_total }], brand_id: 'br-DG', establishment_id: 'es-L1' });
    if (G.db.get('referrals', rr.id).status !== 'REWARDED') throw new Error('No se premió al quedar entregado y cobrado');
    eq(C.balance(ref.id) - before, 200, 'Puntos del referente');
  } });
  G.tests.push({ module: 'CMP', name: 'CA-CMP-08: cliente con 2 mensajes de marketing esta semana (DG y Marca 2) se omite por frecuencia', fn: async () => {
    const seg = G.db.get('customer_segments', 'sg-SEG-DG-14');
    const id = segMembers(seg).find(x => C.hasConsent(x, 'br-DG').ok && C.weekCount(x) === 0); if (!id) throw new Error('Sin cliente libre');
    const ch1 = G.db.find('messaging_channels', x => x.brand_id === 'br-DG'), ch2 = G.db.find('messaging_channels', x => x.brand_id === 'br-M2');
    G.msg.send({ customer_id: id, channel_id: ch1 && ch1.id, kind: 'MARKETING', text: 'Promo DG', ref: 'T1' });
    G.msg.send({ customer_id: id, channel_id: ch2 && ch2.id, kind: 'MARKETING', text: 'Promo M2', ref: 'T2' });
    eq(C.weekCount(id), 2, 'Mensajes de la semana');
    const { rows } = C.plan({ code: 'T-CA08', segment_id: seg.id, brand_id: 'br-DG', control_group_pct: 10 });
    const row = rows.find(x => x.customer_id === id); if (!row || row.status !== 'SKIPPED_FREQUENCY') throw new Error('No se omitió por frecuencia: ' + (row && row.status));
  } });
  G.tests.push({ module: 'CMP', name: 'CA-CMP-09: cupón vigente del 01/11 al 30/11/2026 aplicado el 01/12/2026 se rechaza con RN-CMP-07', fn: async () => {
    const o = G.orders.create({ customer_id: 'cu-0010', brand_id: 'br-DG', channel: 'WHATSAPP', fulfillment: 'PICKUP', lines: [{ variant_id: 'va-DG-CAL-1L', qty: 5 }] });
    expectFail(() => C.applyCoupon(o, 'NOV-CUY', { date: '2026-12-01' }), 'RN-CMP-07');
    const ok = C.checkCoupon(o, 'NOV-CUY', { date: '2026-11-15' }); eq(ok.discount, 8, 'Descuento dentro de la vigencia');
    expectFail(() => C.saveCoupon({ code: 'MALAFECHA', discount_type: 'PCT', value: 5, valid_from: '2026-11-30', valid_to: '2026-11-01', max_uses_per_customer: 1 }), 'RN-CMP-07');
  } });
})();
