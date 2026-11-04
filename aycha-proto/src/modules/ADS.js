/* =====================================================================
   ADS · Gasto de anuncios y atribución a ventas cobradas (Fase 1)
   Cuentas de Google Ads, Meta Ads y TikTok Ads, importación diaria del
   gasto (con tipo de cambio), rastreo por anuncio (código, UTM, referral
   de clic a WhatsApp), atribución anuncio → lead → pedido → cobro,
   retorno con ventas COBRADAS, conciliación de facturas de plataformas y
   costo de creadores de contenido por campaña.
   ===================================================================== */
(function () {
  const { h, btn, badge, card, table, kpis, dl, notice, drawer, modal, form, toast, tabs, pills } = G.ui;
  const U = G.util;
  const R = (n, d = 2) => U.round(n, d);
  const A = G.ads = G.ads || {};
  const ins = (t, r) => G.db.insert(t, r, { silent: true });

  const PLAT = [['GOOGLE', 'Google Ads'], ['META', 'Meta Ads'], ['TIKTOK', 'TikTok Ads']];
  const platName = p => (PLAT.find(x => x[0] === p) || [p, p || '—'])[1];
  const METHODS = [['CTWA_REFERRAL', 'Referral de clic a WhatsApp'], ['TRACKING_CODE', 'Código en el mensaje'], ['UTM', 'UTM de la web'], ['TIKTOK_DM', 'Mensaje de TikTok'], ['INHERITED_FROM_LEAD', 'Heredado del lead'], ['MANUAL', 'Corrección manual'], ['NONE', 'Sin atribución']];
  const methodName = m => (METHODS.find(x => x[0] === m) || [m, m])[1];
  const DEST = [['WHATSAPP', 'WhatsApp'], ['WEB', 'Web (WooCommerce)'], ['TIKTOK_DM', 'Mensaje de TikTok'], ['MESSENGER', 'Messenger'], ['INSTAGRAM_DM', 'Mensaje de Instagram'], ['LEAD_FORM', 'Formulario'], ['OTHER', 'Otro']];
  const destName = d => (DEST.find(x => x[0] === d) || [d, d || '—'])[1];
  const DIGITAL = ['WEB', 'WHATSAPP', 'TIKTOK', 'FACEBOOK', 'INSTAGRAM'];
  const CODE_RE = /^[A-Z0-9]{2,6}-[A-Z0-9]{2,8}$/;
  A.PLAT = PLAT; A.platName = platName; A.methodName = methodName;
  const XST = { RECONCILED: ['Conciliada', 'ok'], OBSERVED: ['Observada', 'warn'], PENDING: ['Pendiente', 'warn'], PAUSED: ['Pausado', 'warn'], DISCONNECTED: ['Desconectada', 'bad'], ENDED: ['Terminado', ''], REMOVED: ['Eliminado', ''], OK: ['OK', 'ok'], FAILED: ['Fallida', 'bad'], PARTIAL: ['Parcial', 'warn'] };
  const st = s => XST[s] ? badge(XST[s][0], XST[s][1]) : G.ui.status(s);
  A.status = st;

  /* ------------------------------------------------------------------
     Apoyo: tipo de cambio (MAE), anuncios por código, cobros por pedido
     ------------------------------------------------------------------ */
  /** tipo de cambio de VENTA del día (RN-ADS-01); si no hay del día, el último anterior; si no, el primero posterior */
  A.fx = function (date, currency = 'USD') {
    if (!currency || currency === 'PEN') return 1;
    const rows = G.db.where('exchange_rates', x => (x.currency || 'USD') === currency);
    let best = null, after = null;
    for (const x of rows) { if (x.date <= date && (!best || x.date > best.date)) best = x; if (x.date > date && (!after || x.date < after.date)) after = x; }
    const r = best || after; return r ? Number(r.sell) : 3.75;
  };
  A.ads = () => G.db.all('ad_ads');
  /** anuncio por código interno o código de rastreo (sin importar mayúsculas, RN-ADS-04) */
  A.adByCode = function (code) {
    if (!code) return null; const c = String(code).trim().toUpperCase();
    return G.db.find('ad_ads', a => (a.code || '').toUpperCase() === c || (a.tracking_code || '').toUpperCase() === c);
  };
  A.campaign = id => G.db.get('ad_campaigns', id);
  A.account = id => G.db.get('ad_accounts', id);
  A.adLabel = ad => ad ? (ad.tracking_code || ad.code) + ' · ' + ad.name : '—';
  /** cobrado por pedido: pagos CONFIRMED aplicados (los revertidos no suman, RN-ADS-07) */
  A.collectedMap = function () {
    const m = new Map();
    for (const p of G.db.all('payments')) { if (p.status !== 'CONFIRMED') continue; for (const al of p.allocations || []) if (al.order_id) m.set(al.order_id, (m.get(al.order_id) || 0) + Number(al.amount || 0)); }
    return m;
  };
  /** cobros CONFIRMED del período (por fecha de cobro), opcionalmente por marca y local */
  A.collectedTotal = function ({ from, to, brand, site }) {
    let t = 0;
    for (const p of G.db.all('payments')) { if (p.status !== 'CONFIRMED') continue; const d = String(p.paid_at).slice(0, 10); if (d < from || d > to) continue; if (brand && p.brand_id !== brand) continue; if (site && p.establishment_id !== site) continue; t += Number(p.amount) || 0; }
    return R(t);
  };
  /** primer pedido no anulado de cada cliente (RN-ADS-09) */
  A.firstOrderMap = function () {
    const m = new Map();
    for (const o of G.db.all('sales_orders')) { if (o.status === 'CANCELLED' || !o.customer_id) continue; const f = m.get(o.customer_id); if (!f || o.created_at < f.created_at) m.set(o.customer_id, o); }
    return m;
  };
  /** problemas de rastreo de un anuncio (RN-ADS-03) */
  A.trackingIssues = function (ad, all) {
    const out = [];
    if (!ad || ad.status !== 'ACTIVE') return out;
    if (ad.destination === 'WHATSAPP' || ad.destination === 'TIKTOK_DM') {
      if (ad.destination === 'WHATSAPP' && !ad.channel_id) out.push('sin número de WhatsApp');
      if (ad.destination === 'WHATSAPP' && ad.channel_id) { const ch = G.db.get('messaging_channels', ad.channel_id); if (ch && ch.brand_id !== ad.brand_id) out.push('el número es de otra marca'); }
      if (!ad.tracking_code && !ad.is_ctwa) out.push('sin código de rastreo');
      if (ad.tracking_code && !CODE_RE.test(ad.tracking_code)) out.push('código con formato inválido');
      if (ad.tracking_code) { const dup = (all || A.ads()).filter(x => x.id !== ad.id && (x.tracking_code || '').toUpperCase() === ad.tracking_code.toUpperCase()); if (dup.length) out.push('código repetido'); }
    }
    if (ad.destination === 'WEB' && !(ad.utm_source && ad.utm_campaign)) out.push('sin UTM');
    return out;
  };
  A.untracked = () => { const all = A.ads(); return all.filter(a => A.trackingIssues(a, all).length); };
  A.waLink = function (ad) {
    const ch = ad && G.db.get('messaging_channels', ad.channel_id);
    if (!ch || !ad.tracking_code) return null;
    return `https://wa.me/${ch.number.replace(/\D/g, '')}?text=${encodeURIComponent('Hola, vi el anuncio ' + ad.tracking_code)}`;
  };
  A.utmUrl = function (ad) {
    if (!ad || !ad.utm_source) return null;
    const base = ad.landing_url || 'https://www.donguando.com/tienda/';
    const q = [['utm_source', ad.utm_source], ['utm_medium', ad.utm_medium], ['utm_campaign', ad.utm_campaign], ['utm_content', ad.utm_content]].filter(x => x[1]).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    return base + (base.includes('?') ? '&' : '?') + q;
  };

  /* ------------------------------------------------------------------
     Importación de gasto (adaptador falso de AdsProvider) · RN-ADS-01, 02, 12
     ------------------------------------------------------------------ */
  const BRAND_BUDGET = { 'br-DG': 7200, 'br-M2': 1700, 'br-M3': 1500, 'br-M4': 900, 'br-M5': 1700 };
  const hash = s => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
  /** gasto diario en soles que «devuelve la plataforma» (determinista por anuncio y fecha) */
  A.fakeSpendPen = function (ad, date) {
    const camp = A.campaign(ad.campaign_id); if (!camp || camp.status === 'REMOVED') return 0;
    if (camp.paused_from && date >= camp.paused_from) return 0;
    if (ad.status !== 'ACTIVE' && ad.paused_from && date >= ad.paused_from) return 0;
    const acc = A.account(camp.account_id);
    const ck = G.ctx.tenant + '|' + ad.id + '|' + G.db.all('ad_ads').length;
    let w = (A._w = A._w || {})[ck];
    if (!w) {
      const plats = G.db.where('ad_accounts', a => a.brand_id === ad.brand_id).map(a => a.platform);
      const share = plats.includes('TIKTOK') ? { META: 0.45, GOOGLE: 0.35, TIKTOK: 0.2 } : { META: 0.55, GOOGLE: 0.45, TIKTOK: 0 };
      const nCamps = G.db.where('ad_campaigns', c => c.account_id === acc.id).length || 1;
      const siblings = G.db.where('ad_ads', a => a.campaign_id === camp.id).sort(U.by('code'));
      const idx = siblings.findIndex(a => a.id === ad.id);
      w = A._w[ck] = { share, nCamps, adShare: siblings.length === 1 ? 1 : idx === 0 ? 0.6 : 0.4 / (siblings.length - 1) };
    }
    const { share, nCamps, adShare } = w;
    const r = U.rng(hash(ad.id + date));
    const dow = G.date.parse(date).getUTCDay();
    const wk = dow === 0 || dow === 6 ? 1.18 : 1;
    return R((BRAND_BUDGET[ad.brand_id] || 800) * (share[acc.platform] || 0) / nCamps * adShare / 30 * (0.7 + 0.6 * r()) * wk);
  };
  /**
   * Importa (o reimporta) un día de una cuenta: una sola fila por campaña, anuncio y fecha (RN-ADS-02).
   * rows opcional: [{campaign_id, ad_id, spend (en moneda de la cuenta), impressions, clicks, platform_leads}] (si no, lo trae el adaptador falso)
   * exchange_rate opcional: si no, el de venta del día (RN-ADS-01). Devuelve {read, upserted}.
   */
  A.importDay = function ({ account_id, date, rows, run_id, exchange_rate }) {
    const acc = A.account(account_id); if (!acc) G.fail('RN-ADS-01', 'Cuenta publicitaria no encontrada.');
    const fx = exchange_rate != null ? Number(exchange_rate) : A.fx(date, acc.currency);
    if (!rows) {
      rows = [];
      for (const camp of G.db.where('ad_campaigns', c => c.account_id === acc.id)) for (const ad of G.db.where('ad_ads', a => a.campaign_id === camp.id)) {
        const pen = A.fakeSpendPen(ad, date); if (!(pen > 0)) continue;
        const r = U.rng(hash('m' + ad.id + date));
        const spend = acc.currency === 'PEN' ? pen : R(pen / fx);
        const imp = Math.round(pen * (80 + 60 * r())); const clicks = Math.round(imp * (0.012 + 0.013 * r()));
        rows.push({ campaign_id: camp.id, ad_id: ad.id, spend, impressions: imp, clicks, platform_leads: Math.round(clicks * (0.06 + 0.05 * r())), platform_conversions: Math.round(clicks * 0.02) });
      }
    }
    let upserted = 0;
    const idx = new Map(G.db.where('ad_spend_daily', s => s.spend_date === date).map(s => [s.campaign_id + '|' + (s.ad_id || ''), s]));
    for (const x of rows) {
      const spend = R(Number(x.spend) || 0);
      if (spend < 0) G.fail('RN-ADS-02', 'El gasto no puede ser negativo.');
      const spend_pen = R(spend * fx);
      const prev = idx.get(x.campaign_id + '|' + (x.ad_id || ''));
      const patch = { currency: acc.currency, spend, exchange_rate: fx, spend_pen, impressions: x.impressions || 0, clicks: x.clicks || 0, platform_leads: x.platform_leads || 0, platform_conversions: x.platform_conversions || 0, import_run_id: run_id || null };
      if (prev) { if (prev.spend !== spend || prev.exchange_rate !== fx) { Object.assign(prev, patch, { updated_at: G.date.now() }); upserted++; } }
      else { idx.set(x.campaign_id + '|' + (x.ad_id || ''), ins('ad_spend_daily', Object.assign({ campaign_id: x.campaign_id, ad_id: x.ad_id || null, spend_date: date }, patch))); upserted++; }
    }
    G.db.touch();
    return { read: rows.length, upserted };
  };
  /** corrida de importación de un rango (reimportar) · deja la corrida con filas leídas y actualizadas */
  A.importRange = function (account_id, from, to, { at, silent } = {}) {
    const acc = A.account(account_id); if (!acc) G.fail('RN-ADS-01', 'Cuenta publicitaria no encontrada.');
    if (to < from) G.fail('RN-ADS-02', 'La fecha final es anterior a la inicial.');
    if (to >= G.TODAY) G.fail('RN-ADS-01', 'Solo se importan días cerrados (hasta ayer).');
    if (acc.status !== 'ACTIVE') G.fail('RN-ADS-01', `La cuenta ${acc.name} está ${G.ui.statusLabel(acc.status).toLowerCase()}: reconéctala antes de importar.`);
    const run = ins('ad_import_runs', { account_id, date_from: from, date_to: to, status: 'RUNNING', rows_read: 0, rows_upserted: 0, error: null, started_at: at || G.date.now(), finished_at: null, user: G.ctx.userName() });
    let read = 0, up = 0;
    for (let d = from; d <= to; d = G.date.add(d, 1)) { const r = A.importDay({ account_id, date: d, run_id: run.id }); read += r.read; up += r.upserted; }
    Object.assign(run, { status: 'OK', rows_read: read, rows_upserted: up, finished_at: at || G.date.now() });
    acc.last_import_at = run.finished_at; G.db.touch();
    if (!silent) G.events.emit('ad_spend.imported', { account_id, from, to, rows: up });
    return run;
  };
  /** corrida diaria (RN-ADS-01): cuentas activas, últimos ads_import_lookback_days días hasta ayer */
  A.runDaily = function () {
    const back = Number(G.param('ads_import_lookback_days')) || 3;
    const to = G.date.add(G.TODAY, -1), from = G.date.add(G.TODAY, -back);
    return G.db.where('ad_accounts', a => a.status === 'ACTIVE').map(a => { try { return A.importRange(a.id, from, to); } catch (e) { return ins('ad_import_runs', { account_id: a.id, date_from: from, date_to: to, status: 'FAILED', rows_read: 0, rows_upserted: 0, error: e.message, started_at: G.date.now(), finished_at: G.date.now() }); } });
  };

  /* ------------------------------------------------------------------
     Atribución · RN-ADS-04, 05, 06, 09
     ------------------------------------------------------------------ */
  const methodForAd = (ad, channel) => !ad ? 'NONE' : channel === 'WEB' ? 'UTM' : ad.is_ctwa && channel === 'WHATSAPP' ? 'CTWA_REFERRAL' : channel === 'TIKTOK' || ad.destination === 'TIKTOK_DM' ? 'TIKTOK_DM' : 'TRACKING_CODE';
  /**
   * Atribuye un lead o conversación (RN-ADS-04): referral de clic a WhatsApp → código en el primer mensaje → UTM → TikTok.
   * {lead_id, conversation_id, customer_id, phone, brand_id, referral_ad_id, first_message, utm:{campaign,content}, tiktok_ad_id, at}
   */
  A.attributeLead = function (d) {
    let ad = null, method = 'NONE';
    if (d.referral_ad_id) { ad = G.db.get('ad_ads', d.referral_ad_id) || A.adByCode(d.referral_ad_id); if (ad) method = 'CTWA_REFERRAL'; }
    if (!ad && d.first_message) { const m = String(d.first_message).toUpperCase().match(/\b[A-Z0-9]{2,6}-[A-Z0-9]{2,8}\b/g) || []; for (const c of m) { const a = A.adByCode(c); if (a) { ad = a; method = 'TRACKING_CODE'; break; } } }
    if (!ad && d.utm) { ad = A.adByCode(d.utm.content) || A.adByCode(d.utm.campaign); if (ad) method = 'UTM'; }
    if (!ad && d.tiktok_ad_id) { ad = G.db.get('ad_ads', d.tiktok_ad_id) || A.adByCode(d.tiktok_ad_id); if (ad) method = 'TIKTOK_DM'; }
    const camp = ad && A.campaign(ad.campaign_id);
    const at = d.at || G.date.now();
    const row = G.db.insert('ad_attributions', { lead_id: d.lead_id || U.uid('ld'), order_id: null, conversation_id: d.conversation_id || null, ad_id: ad ? ad.id : null, campaign_id: camp ? camp.id : null, platform: ad ? ad.platform : null, brand_id: ad ? ad.brand_id : (d.brand_id || null), method, is_new_customer: false, attributed_at: at, lead_at: at, lead_origin: true, customer_id: d.customer_id || null, phone: d.phone || null, manual_reason: null }, { silent: G._seeding });
    if (method !== 'NONE' && !G._seeding) G.events.emit('attribution.created', { attribution_id: row.id, lead_id: row.lead_id, ad_id: row.ad_id, method });
    return row;
  };
  /** lead atribuido más reciente del cliente dentro de la ventana (RN-ADS-05) */
  A.leadFor = function (customer_id, at) {
    if (!customer_id) return null;
    const win = Number(G.param('ads_attribution_window_days')) || 30;
    const day = String(at).slice(0, 10);
    let best = null;
    for (const x of G.db.where('ad_attributions', x => x.lead_origin && x.customer_id === customer_id && x.ad_id && x.method !== 'NONE')) {
      const ld = String(x.lead_at || x.attributed_at);
      if (ld > at) continue;
      if (G.date.diff(day, ld.slice(0, 10)) > win) continue;
      if (!best || ld > String(best.lead_at || best.attributed_at)) best = x;
    }
    return best;
  };
  /** Atribuye un pedido (una sola atribución, último toque; RN-ADS-05 y RN-ADS-09). Se llama al crear el pedido. */
  A.attributeOrder = function (o, opts = {}) {
    if (typeof o === 'string') o = G.db.get('sales_orders', o);
    if (!o) return null;
    const existing = G.db.find('ad_attributions', x => x.order_id === o.id);
    if (existing && !opts.force) return existing;
    let ad = o.origin_ad_code ? A.adByCode(o.origin_ad_code) : null;
    if (!ad && o.origin_utm) ad = A.adByCode(o.origin_utm.content) || A.adByCode(o.origin_utm.campaign);
    let method = ad ? methodForAd(ad, o.channel) : 'NONE', lead = null;
    if (!ad) { lead = A.leadFor(o.customer_id, o.created_at || G.date.now()); if (lead) { ad = G.db.get('ad_ads', lead.ad_id); method = 'INHERITED_FROM_LEAD'; } }
    if (!ad && !DIGITAL.includes(o.channel)) return null; // pedidos no digitales sin anuncio no generan fila
    const first = A.firstOrderMap().get(o.customer_id);
    const camp = ad && A.campaign(ad.campaign_id);
    const row = { lead_id: lead ? lead.lead_id : (ad ? U.uid('ld') : null), order_id: o.id, conversation_id: null, ad_id: ad ? ad.id : null, campaign_id: camp ? camp.id : null, platform: ad ? ad.platform : null, brand_id: o.brand_id, method, is_new_customer: !!first && first.id === o.id, attributed_at: o.created_at || G.date.now(), lead_at: lead ? lead.lead_at : (o.created_at || G.date.now()), lead_origin: !lead && !!ad, customer_id: o.customer_id, manual_reason: null };
    const saved = existing ? G.db.update('ad_attributions', existing.id, row, { silent: true }) : G.db.insert('ad_attributions', row, { silent: !!G._seeding });
    if (method !== 'NONE' && !G._seeding) G.events.emit('attribution.created', { attribution_id: saved.id, order_id: o.id, ad_id: saved.ad_id, method });
    return saved;
  };
  /** Corrección manual con motivo (RN-ADS-06): queda en la auditoría con el valor anterior */
  A.correct = function (order_id, ad_id, reason) {
    if (!G.can('ads.attribution.correct')) G.fail('RN-ADS-06', `Tu rol (${G.roleName()}) no tiene el permiso ads.attribution.correct.`);
    if (!reason || String(reason).trim().length < 5) G.fail('RN-ADS-06', 'La corrección exige un motivo (al menos 5 caracteres).');
    const o = G.db.get('sales_orders', order_id); if (!o) G.fail('RN-ADS-06', 'Pedido no encontrado.');
    const ad = ad_id ? G.db.get('ad_ads', ad_id) : null;
    if (ad_id && !ad) G.fail('RN-ADS-06', 'Anuncio no encontrado.');
    if (ad && ad.brand_id !== o.brand_id) G.fail('RN-ADS-06', `El anuncio es de ${G.brandName(ad.brand_id)} y el pedido de ${G.brandName(o.brand_id)}.`);
    const prev = G.db.find('ad_attributions', x => x.order_id === order_id);
    const before = prev ? { ad_id: prev.ad_id, method: prev.method } : { ad_id: null, method: 'NONE' };
    const first = A.firstOrderMap().get(o.customer_id);
    const patch = { ad_id: ad ? ad.id : null, campaign_id: ad ? ad.campaign_id : null, platform: ad ? ad.platform : null, method: ad ? 'MANUAL' : 'NONE', manual_reason: reason, corrected_by: G.ctx.userName(), corrected_at: G.date.now(), previous: before, is_new_customer: !!first && first.id === o.id };
    let row;
    if (prev) row = G.db.update('ad_attributions', prev.id, patch);
    else row = G.db.insert('ad_attributions', Object.assign({ lead_id: null, order_id, brand_id: o.brand_id, attributed_at: o.created_at, lead_at: o.created_at, lead_origin: false, customer_id: o.customer_id }, patch));
    G.audit('CORREGIR_ATRIBUCION', 'ad_attributions', row.id, `${o.number}: ${before.method}${before.ad_id ? ' ' + A.adLabel(G.db.get('ad_ads', before.ad_id)) : ''} → ${patch.method} ${ad ? A.adLabel(ad) : ''} · ${reason}`, before, { ad_id: patch.ad_id, method: patch.method });
    return row;
  };
  G.events.on('order.created', p => { try { const o = G.db.get('sales_orders', p.order_id); if (o) A.attributeOrder(o); } catch (e) { console.error('ADS atribución', e); } });

  /* ------------------------------------------------------------------
     Resultados · RN-ADS-07, 09, 11, 12 (KPI-ADS-01 a 05)
     ------------------------------------------------------------------ */
  const inRange = (d, from, to) => { const s = String(d || '').slice(0, 10); return s >= from && s <= to; };
  /**
   * Resultados por anuncio, campaña, plataforma o marca.
   * {from, to, brand, brands, site, platform, campaign_id, ad_id, by:'ad'|'campaign'|'platform'|'brand'|'all'}
   * Cada fila: {key, spend, leads, orders, newCust, collected, cpl, cpo, cpn, roas, orderIds}
   */
  A.results = function (f = {}) {
    const from = f.from || G.date.month(G.TODAY), to = f.to || G.TODAY, by = f.by || 'ad';
    const ads = new Map(G.db.all('ad_ads').map(a => [a.id, a]));
    const camps = new Map(G.db.all('ad_campaigns').map(c => [c.id, c]));
    const brandOk = b => (!f.brand || b === f.brand) && (!f.brands || f.brands.includes(b));
    const keyOf = (ad, camp) => by === 'ad' ? ad.id : by === 'campaign' ? camp.id : by === 'platform' ? camp.platform : by === 'brand' ? camp.brand_id : 'ALL';
    const pass = (ad, camp) => camp && brandOk(camp.brand_id) && (!f.platform || camp.platform === f.platform) && (!f.campaign_id || camp.id === f.campaign_id) && (!f.ad_id || (ad && ad.id === f.ad_id));
    const out = new Map();
    const row = k => out.get(k) || (out.set(k, { key: k, spend: 0, leads: 0, orders: 0, newCust: 0, collected: 0, orderIds: [] }), out.get(k));
    for (const s of G.db.all('ad_spend_daily')) {
      if (!inRange(s.spend_date, from, to)) continue;
      const camp = camps.get(s.campaign_id); const ad = s.ad_id ? ads.get(s.ad_id) : null;
      if (!pass(ad, camp)) continue; if (by === 'ad' && !ad) continue;
      row(keyOf(ad || { id: null }, camp)).spend += s.spend_pen;
    }
    const col = A.collectedMap();
    const orders = new Map(G.db.all('sales_orders').map(o => [o.id, o]));
    for (const x of G.db.all('ad_attributions')) {
      if (!x.ad_id || x.method === 'NONE') continue;
      const ad = ads.get(x.ad_id); const camp = ad && camps.get(ad.campaign_id);
      if (!pass(ad, camp)) continue;
      const k = keyOf(ad, camp);
      if (x.lead_origin && inRange(x.lead_at || x.attributed_at, from, to)) row(k).leads++;
      if (x.order_id && inRange(x.attributed_at, from, to)) {
        const o = orders.get(x.order_id); if (!o || ['CANCELLED', 'DRAFT'].includes(o.status)) continue;
        if (f.site && o.establishment_id !== f.site) continue;
        const r = row(k); r.orders++; if (x.is_new_customer) r.newCust++; r.collected += col.get(o.id) || 0; r.orderIds.push(o.id);
      }
    }
    const res = [...out.values()].map(r => Object.assign(r, { spend: R(r.spend), collected: R(r.collected), cpl: r.leads ? R(r.spend / r.leads) : null, cpo: r.orders ? R(r.spend / r.orders) : null, cpn: r.newCust ? R(r.spend / r.newCust) : null, roas: r.spend ? R(r.collected / r.spend, 2) : null }));
    return res;
  };
  A.total = f => A.results(Object.assign({}, f, { by: 'all' }))[0] || { spend: 0, leads: 0, orders: 0, newCust: 0, collected: 0, cpl: null, cpo: null, cpn: null, roas: null, orderIds: [] };
  /** pedidos digitales del período con y sin atribución (KPI-ADS-08) */
  A.digitalOrders = function ({ from, to, brand, site }) {
    const att = new Map(G.db.all('ad_attributions').filter(x => x.order_id).map(x => [x.order_id, x]));
    const rows = G.db.where('sales_orders', o => DIGITAL.includes(o.channel) && !['CANCELLED', 'DRAFT'].includes(o.status) && inRange(o.created_at, from, to) && (!brand || o.brand_id === brand) && (!site || o.establishment_id === site));
    return rows.map(o => ({ o, att: att.get(o.id) || null }));
  };
  /** creadores de contenido (GAS: expenses.ad_campaign_id). Si GAS sembró los suyos, se ignoran los de respaldo de ADS. */
  A.creatorExpenses = function ({ from, to, brand, campaign_id, statuses = ['APPROVED', 'PAID'] } = {}) {
    const all = G.db.where('expenses', e => !!e.ad_campaign_id);
    const own = all.filter(e => !e.demo_fallback);
    const base = own.length ? own : all;
    return base.filter(e => (!statuses || statuses.includes(e.status)) && (!from || inRange(e.issue_date, from, to)) && (!brand || e.brand_id === brand) && (!campaign_id || e.ad_campaign_id === campaign_id));
  };
  A.creatorCost = f => R(U.sum(A.creatorExpenses(f), e => e.amount_pen ?? e.total));

  /* ------------------------------------------------------------------
     Facturas de plataformas · RN-ADS-08
     ------------------------------------------------------------------ */
  A.importedSpend = (account_id, from, to) => R(U.sum(G.db.where('ad_spend_daily', s => { const c = A.campaign(s.campaign_id); return c && c.account_id === account_id && inRange(s.spend_date, from, to); }), s => s.spend_pen));
  /** concilia una factura: RECONCILED si |dif| ≤ max(S/ 5, 2 % del gasto); si no, OBSERVED */
  A.reconcile = function (inv, { note } = {}) {
    const spent = A.importedSpend(inv.account_id, inv.period_from, inv.period_to);
    const tol = Math.max(Number(G.param('ads_reconcile_tolerance_pen')) || 5, spent * (Number(G.param('ads_reconcile_tolerance_pct')) || 2) / 100);
    const diff = R(inv.amount_pen - spent);
    const status = Math.abs(diff) <= tol + 1e-9 ? 'RECONCILED' : 'OBSERVED';
    Object.assign(inv, { imported_spend_pen: spent, difference_pen: diff, tolerance_pen: R(tol), status, reconciled_by: G.ctx.userId(), reconciled_at: G.date.now(), note: note || inv.note || (status === 'OBSERVED' ? 'Diferencia mayor a la tolerancia: revisar ajustes y créditos de la plataforma.' : null) });
    G.db.touch();
    return inv;
  };
  /** registra la factura de la plataforma y la concilia (ads_reconcile_invoice) */
  A.registerInvoice = function (d) {
    if (!G._seeding && !G.can('ads.invoice.reconcile')) G.fail('RN-ADS-08', `Tu rol (${G.roleName()}) no tiene el permiso ads.invoice.reconcile.`);
    const acc = A.account(d.account_id); if (!acc) G.fail('RN-ADS-08', 'Elige la cuenta publicitaria.');
    if (!d.invoice_number) G.fail('RN-ADS-08', 'Falta el número de factura o recibo.');
    if (G.db.find('ad_platform_invoices', x => x.account_id === acc.id && x.invoice_number === d.invoice_number)) G.fail('RN-ADS-08', `La factura ${d.invoice_number} ya está registrada para ${acc.name}.`);
    if (!d.period_from || !d.period_to || d.period_to < d.period_from) G.fail('RN-ADS-08', 'Revisa el período de la factura.');
    if (!(Number(d.amount) >= 0)) G.fail('RN-ADS-08', 'El monto debe ser mayor o igual a cero.');
    const currency = d.currency || acc.currency;
    const rate = currency === 'PEN' ? 1 : (d.exchange_rate ? Number(d.exchange_rate) : A.fx(d.issue_date || G.TODAY, currency)); // D-ADS-03: tipo de cambio de la fecha de la factura
    const inv = G.db.insert('ad_platform_invoices', { account_id: acc.id, supplier_id: acc.supplier_id || null, invoice_number: d.invoice_number, issue_date: d.issue_date || G.TODAY, period_from: d.period_from, period_to: d.period_to, currency, amount: R(d.amount), exchange_rate: rate, amount_pen: R(d.amount * rate), imported_spend_pen: null, difference_pen: null, status: 'PENDING', expense_id: null, file_id: null, doc_type: 'FOREIGN_INVOICE', brand_id: acc.brand_id }, { silent: !!G._seeding });
    if (d.reconcile !== false) { A.reconcile(inv, { note: d.note }); if (inv.status === 'RECONCILED' && d.sendToGas !== false && !G._seeding) A.sendInvoiceToGas(inv.id); }
    return inv;
  };
  /** pasa la factura conciliada a GAS como gasto de publicidad (D-ADS-04: FOREIGN_INVOICE) */
  A.sendInvoiceToGas = function (id) {
    const inv = G.db.get('ad_platform_invoices', id);
    if (!inv) G.fail('RN-ADS-08', 'Factura no encontrada.');
    if (inv.status !== 'RECONCILED') G.fail('RN-ADS-08', 'Solo una factura conciliada pasa a GAS como gasto.');
    if (inv.expense_id) return G.db.get('expenses', inv.expense_id);
    G.period.assertOpen(inv.issue_date);
    const acc = A.account(inv.account_id);
    const brandCode = (G.db.get('brands', acc.brand_id) || {}).code || 'DG';
    const cat = G.db.find('expense_categories', c => c.category_group === 'ADVERTISING');
    const data = { company_id: 'co-dg', establishment_id: 'es-L1', cost_center_id: 'cc-MKT-' + brandCode, brand_id: acc.brand_id, category_id: cat ? cat.id : null, category_code: 'ADVERTISING', supplier_id: inv.supplier_id, doc_type: 'FOREIGN_INVOICE', doc_series: null, doc_number: inv.invoice_number, issue_date: inv.issue_date, currency: inv.currency, exchange_rate: inv.exchange_rate, subtotal: inv.amount, igv: 0, other_taxes: 0, total: inv.amount, withholding_amount: 0, amount_pen: inv.amount_pen, description: `Publicidad ${platName(acc.platform)} ${G.fmt.date(inv.period_from)} – ${G.fmt.date(inv.period_to)} (${acc.name})`, status: 'APPROVED', source_module: 'ADS', ad_platform_invoice_id: inv.id };
    let exp = null;
    if (G.gas && typeof G.gas.createExpense === 'function') { try { exp = G.gas.createExpense(data); } catch (e) { if (e instanceof G.RuleError) throw e; } }
    if (!exp) exp = G.db.insert('expenses', Object.assign({ number: G.db.next('GS', 'GS-', 6) }, data));
    G.db.update('ad_platform_invoices', inv.id, { expense_id: exp.id, sent_to_gas_at: G.date.now() });
    G.events.emit('ad_invoice.reconciled', { invoice_id: inv.id, expense_id: exp.id, amount_pen: inv.amount_pen });
    return exp;
  };
  /** gasto de creador de contenido (RN-ADS-10 / RN-GAS-03): recibo por honorarios y campaña obligatoria */
  A.registerCreatorExpense = function (d) {
    if (!d.ad_campaign_id) G.fail('RN-ADS-10', 'El gasto de un creador de contenido exige la campaña (RN-GAS-03).');
    if (!d.supplier_id) G.fail('RN-ADS-10', 'Elige el creador de contenido.');
    const sup = G.db.get('suppliers', d.supplier_id);
    if (!sup || sup.supplier_type !== 'CONTENT_CREATOR') G.fail('RN-ADS-10', 'El proveedor debe ser un creador de contenido.');
    if (!d.doc_number) G.fail('RN-ADS-10', 'Falta el número del recibo por honorarios.');
    if (!(Number(d.amount) > 0)) G.fail('RN-ADS-10', 'El monto debe ser mayor que cero.');
    G.period.assertOpen(d.issue_date || G.TODAY);
    const camp = A.campaign(d.ad_campaign_id);
    const amount = R(d.amount); const wh = amount > 1500 ? R(amount * 0.08) : 0; // retención de 4.ª categoría sobre S/ 1500
    const cat = G.db.find('expense_categories', c => c.category_group === 'CONTENT_CREATORS');
    const data = { company_id: 'co-dg', establishment_id: 'es-L1', cost_center_id: 'cc-MKT-' + ((G.db.get('brands', camp.brand_id) || {}).code || 'DG'), brand_id: camp.brand_id, category_id: cat ? cat.id : null, category_code: 'CONTENT_CREATORS', supplier_id: d.supplier_id, doc_type: 'FEES_RECEIPT', doc_series: 'E001', doc_number: d.doc_number, issue_date: d.issue_date || G.TODAY, currency: 'PEN', exchange_rate: 1, subtotal: amount, igv: 0, other_taxes: 0, total: amount, withholding_amount: wh, amount_pen: amount, ad_campaign_id: camp.id, description: d.description || `Contenido para ${camp.name}`, status: 'SUBMITTED', submitted_at: G.date.now(), source_module: 'ADS' };
    if (G.gas && typeof G.gas.createExpense === 'function') { try { const e = G.gas.createExpense(data); if (e) return e; } catch (e) { if (e instanceof G.RuleError) throw e; } }
    return G.db.insert('expenses', Object.assign({ number: G.db.next('GS', 'GS-', 6) }, data));
  };
  /** reversa de un cobro (respaldo si CAJ no está en el build): el cobro deja de sumar al retorno (RN-ADS-07) */
  A.reversePayment = function (payment_id, reason) {
    if (G.caj && typeof G.caj.reversePayment === 'function') return G.caj.reversePayment(payment_id, reason);
    const p = G.db.get('payments', payment_id); if (!p) G.fail('RN-CAJ-01', 'Cobro no encontrado.');
    if (p.status !== 'CONFIRMED') G.fail('RN-CAJ-01', 'Solo se revierte un cobro confirmado.');
    G.db.update('payments', p.id, { status: 'REVERSED', reversed_at: G.date.now(), reversal_reason: reason || 'Reversa' });
    for (const al of p.allocations || []) { const o = al.order_id && G.db.get('sales_orders', al.order_id); if (o) o.paid_amount = R((o.paid_amount || 0) - al.amount); }
    G.events.emit('payment.reversed', { payment_id: p.id, amount: p.amount });
    return p;
  };

  /* ------------------------------------------------------------------
     Indicadores KPI-ADS-01 a 09
     ------------------------------------------------------------------ */
  const kf = p => ({ from: p.from, to: p.to, brand: p.brand || null, brands: p.brands || null, site: p.site || null });
  G.kpiCalc['KPI-ADS-01'] = p => { const t = A.total(kf(p)); return { value: t.spend, numerator: t.spend, denominator: null }; };
  G.kpiCalc['KPI-ADS-02'] = p => { const t = A.total(kf(p)); return { value: t.cpl, numerator: t.spend, denominator: t.leads }; };
  G.kpiCalc['KPI-ADS-03'] = p => { const t = A.total(kf(p)); return { value: t.cpo, numerator: t.spend, denominator: t.orders }; };
  G.kpiCalc['KPI-ADS-04'] = p => { const t = A.total(kf(p)); return { value: t.cpn, numerator: t.spend, denominator: t.newCust }; };
  G.kpiCalc['KPI-ADS-05'] = p => { const t = A.total(kf(p)); return { value: t.roas, numerator: t.collected, denominator: t.spend }; };
  G.kpiCalc['KPI-ADS-06'] = p => { const t = A.total(kf(p)); const c = A.collectedTotal(p); return { value: c ? R(t.spend / c * 100, 2) : null, numerator: t.spend, denominator: c }; };
  G.kpiCalc['KPI-ADS-07'] = p => { const v = A.creatorCost({ from: p.from, to: p.to, brand: p.brand }); return { value: v, numerator: v, denominator: null }; };
  G.kpiCalc['KPI-ADS-08'] = p => { const d = A.digitalOrders(p); const n = d.filter(x => x.att && x.att.method !== 'NONE' && x.att.ad_id).length; return { value: d.length ? R(n / d.length * 100, 1) : null, numerator: n, denominator: d.length }; };
  G.kpiCalc['KPI-ADS-09'] = p => {
    const leads = G.db.where('ad_attributions', x => x.lead_origin && inRange(x.lead_at || x.attributed_at, p.from, p.to) && (!p.brand || x.brand_id === p.brand));
    const ctwa = leads.filter(x => x.method === 'CTWA_REFERRAL').length;
    const crm = G.db.where('leads', l => inRange(l.first_contact_at, p.from, p.to) && (!p.brand || l.brand_id === p.brand)).length;
    const den = Math.max(leads.length, crm);
    return { value: den ? R(ctwa / den * 100, 1) : null, numerator: ctwa, denominator: den };
  };
  /** detalle para TAB-10 (bajada al detalle): pedidos atribuidos o gasto según el indicador */
  A.drill = function (code, p) {
    const ads = new Map(G.db.all('ad_ads').map(a => [a.id, a]));
    if (['KPI-ADS-01', 'KPI-ADS-02'].includes(code)) {
      const rows = A.results(Object.assign(kf(p), { by: 'ad' })).filter(r => r.spend || r.leads).map(r => { const ad = ads.get(r.key) || {}; return { anuncio: A.adLabel(ad), plataforma: platName(ad.platform), marca: G.brandName(ad.brand_id), inversion: r.spend, leads: r.leads, costo_lead: r.cpl }; });
      return { columns: [['anuncio', 'Anuncio'], ['plataforma', 'Plataforma'], ['marca', 'Marca'], ['inversion', 'Inversión', 'money'], ['leads', 'Leads', 'num'], ['costo_lead', 'Costo por lead', 'money']], rows, sum: ['inversion', 'leads'] };
    }
    if (code === 'KPI-ADS-08') {
      const rows = A.digitalOrders(p).map(({ o, att }) => ({ pedido: o.number, canal: G.channelName(o.channel), marca: G.brandName(o.brand_id), metodo: att ? methodName(att.method) : 'Sin atribución', anuncio: att && att.ad_id ? A.adLabel(ads.get(att.ad_id)) : '—', atribuido: att && att.ad_id && att.method !== 'NONE' ? 1 : 0 }));
      return { columns: [['pedido', 'Pedido'], ['canal', 'Canal'], ['marca', 'Marca'], ['metodo', 'Método'], ['anuncio', 'Anuncio'], ['atribuido', 'Atribuido (1/0)', 'num']], rows, sum: ['atribuido'] };
    }
    const col = A.collectedMap();
    const rows = [];
    const t = A.results(Object.assign(kf(p), { by: 'ad' }));
    for (const r of t) for (const oid of r.orderIds) { const o = G.db.get('sales_orders', oid); const att = G.db.find('ad_attributions', x => x.order_id === oid); rows.push({ pedido: o.number, fecha: G.fmt.date(o.created_at), anuncio: A.adLabel(ads.get(r.key)), metodo: methodName(att.method), nuevo: att.is_new_customer ? 1 : 0, cobrado: R(col.get(oid) || 0) }); }
    return { columns: [['pedido', 'Pedido'], ['fecha', 'Fecha'], ['anuncio', 'Anuncio'], ['metodo', 'Método'], ['nuevo', 'Cliente nuevo (1/0)', 'num'], ['cobrado', 'Cobrado', 'money']], rows, sum: ['nuevo', 'cobrado'] };
  };

  /* ------------------------------------------------------------------
     Semilla (orden 24): rastreo, gasto set–oct, corridas, atribuciones,
     facturas de setiembre y creadores (respaldo si GAS no siembra los suyos)
     ------------------------------------------------------------------ */
  G.seed(24, function seedADS() {
    const r = U.rng(2424);
    const sup = {}; for (const s of G.db.where('suppliers', s => s.supplier_type === 'ADVERTISING')) sup[/google/i.test(s.trade_name) ? 'GOOGLE' : /meta/i.test(s.trade_name) ? 'META' : 'TIKTOK'] = s.id;
    const waOf = b => G.db.find('messaging_channels', c => c.kind === 'WHATSAPP' && c.brand_id === b);
    // cuentas
    for (const a of G.db.all('ad_accounts')) Object.assign(a, { supplier_id: sup[a.platform] || null, timezone: a.platform === 'TIKTOK' && a.brand_id === 'br-M3' ? 'UTC' : 'America/Lima', connector_id: 'ic-ads-' + a.platform.toLowerCase(), status: 'ACTIVE', last_import_at: G.TODAY + 'T06:0' + (a.platform === 'GOOGLE' ? 2 : a.platform === 'META' ? 4 : 6) });
    for (const c of G.db.all('ad_campaigns')) Object.assign(c, { external_id: c.external_id || String(23000000 + hash(c.id) % 900000) });
    const pmax = G.db.get('ad_campaigns', 'ac-M4-GOOGLE-PMAX'); if (pmax) Object.assign(pmax, { status: 'PAUSED', paused_from: '2026-09-21' });
    // rastreo por anuncio (RN-ADS-03)
    const cnt = {};
    for (const ad of G.db.all('ad_ads').sort(U.by('id'))) {
      const camp = G.db.get('ad_campaigns', ad.campaign_id); const b = G.db.get('brands', ad.brand_id).code;
      const cc = camp.id.split('-').pop(); const k = ad.id.endsWith('-1') ? 1 : 2;
      let dest = 'WHATSAPP', ctwa = false;
      if (ad.platform === 'META') { if (cc === 'CTWA') ctwa = true; else dest = 'WEB'; }
      if (ad.platform === 'GOOGLE') dest = cc === 'SRCH' && k === 1 ? 'WHATSAPP' : 'WEB';
      if (ad.platform === 'TIKTOK') dest = k === 1 ? 'TIKTOK_DM' : 'WHATSAPP';
      const letter = ad.platform === 'GOOGLE' ? 'G' : ad.platform === 'TIKTOK' ? 'T' : ctwa ? 'C' : 'M';
      const key = b + letter; if (dest !== 'WEB') cnt[key] = (cnt[key] || 0) + 1;
      const wa = waOf(ad.brand_id);
      Object.assign(ad, { external_id: String(120000000 + hash(ad.id) % 90000000), ad_group_name: camp.name + ' · grupo ' + k, destination: dest, is_ctwa: ctwa, channel_id: dest === 'WHATSAPP' && wa ? wa.id : null, tracking_code: dest === 'WEB' ? null : `${b}-${letter}${U.pad(cnt[key], 2)}`, utm_source: dest === 'WEB' ? ({ GOOGLE: 'google', META: 'facebook', TIKTOK: 'tiktok' })[ad.platform] : null, utm_medium: dest === 'WEB' ? 'cpc' : null, utm_campaign: dest === 'WEB' ? camp.code : null, utm_content: dest === 'WEB' ? ad.code : null, landing_url: dest === 'WEB' ? (b === 'DG' ? 'https://www.donguando.com/tienda/' : `https://www.donguando.com/${b.toLowerCase()}/`) : null });
      if (camp.status === 'PAUSED') { ad.status = 'PAUSED'; ad.paused_from = camp.paused_from; }
    }
    // anuncio nuevo sin rastreo (aparece en «sin rastreo», RN-ADS-03) y uno pausado
    const m4c = G.db.get('ad_campaigns', 'ac-M4-GOOGLE-SRCH');
    if (m4c) ins('ad_ads', { id: 'ad-M4-GOOGLE-SRCH-3', campaign_id: m4c.id, brand_id: 'br-M4', platform: 'GOOGLE', code: 'M4GSR3', external_id: '129004417', name: 'Búsqueda · creativo 3 (caldos)', ad_group_name: m4c.name + ' · grupo 3', destination: 'WHATSAPP', is_ctwa: false, channel_id: null, tracking_code: null, status: 'ACTIVE', created_at: '2026-10-02T11:00' });
    const pz = G.db.get('ad_ads', 'ad-M2-META-CAT-2'); if (pz) Object.assign(pz, { status: 'PAUSED', paused_from: '2026-10-05' });
    // tipo de cambio de setiembre que falte (MAE: venta del día)
    const rf = U.rng(9091);
    for (let d = '2026-08-01'; d <= G.TODAY; d = G.date.add(d, 1)) if (!G.db.get('exchange_rates', 'fx-' + d) && !G.db.find('exchange_rates', x => x.date === d)) { const s = R(3.735 + (rf() - 0.5) * 0.05, 3); if ([0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())) continue; /* la SUNAT no publica sábado ni domingo (RN-MAE-07) */ ins('exchange_rates', { id: 'fx-' + d, date: d, currency: 'USD', buy: R(s - 0.02, 3), sell: s, source: 'SUNAT' }); }
    // corridas diarias 06:00 con 3 días de ventana y gasto set 1 → oct 9
    const back = 3; const accs = G.db.all('ad_accounts'); const perDay = {};
    for (let d = '2026-09-02'; d <= G.TODAY; d = G.date.add(d, 1)) {
      for (const a of accs) {
        const to = G.date.add(d, -1), from = G.date.add(d, -back) < '2026-09-01' ? '2026-09-01' : G.date.add(d, -back);
        const failed = d === G.TODAY && a.id === 'aa-M4-META';
        const run = ins('ad_import_runs', { account_id: a.id, date_from: from, date_to: to, status: failed ? 'FAILED' : 'OK', rows_read: 0, rows_upserted: 0, error: failed ? 'Token de acceso vencido: reconecta la cuenta de Meta Ads (OAuth) y reimporta el rango.' : null, started_at: d + 'T06:00', finished_at: d + 'T06:0' + (1 + (hash(a.id) % 5)), user: 'Programador de tareas' });
        if (failed) { a.last_import_at = G.date.add(d, -1) + 'T06:03'; continue; }
        // la corrida trae el día nuevo y relee los anteriores de la ventana (sin cambios, salvo el ajuste de Meta del penúltimo día)
        const rr = A.importDay({ account_id: a.id, date: to, run_id: run.id });
        perDay[a.id + '|' + to] = rr.read;
        let read = 0; for (let x = from; x <= to; x = G.date.add(x, 1)) read += perDay[a.id + '|' + x] || 0;
        run.rows_read = read; run.rows_upserted = rr.upserted + (a.platform === 'META' && read > rr.read ? 1 : 0);
      }
    }
    // atribuciones de pedidos con anuncio, heredadas del lead y leads sin pedido
    const first = A.firstOrderMap();
    const persons = G.db.where('customers', c => c.customer_type === 'PERSON' && c.id.startsWith('cu-0'));
    let nL = 0; const lid = () => 'ld-ads-' + U.pad(++nL, 5);
    const ctwaAds = U.groupBy(G.db.where('ad_ads', a => a.is_ctwa && a.status === 'ACTIVE'), 'brand_id');
    for (const o of G.db.all('sales_orders').sort(U.by('created_at'))) {
      const ad = o.origin_ad_code ? A.adByCode(o.origin_ad_code) : null;
      const isNew = first.get(o.customer_id) && first.get(o.customer_id).id === o.id;
      if (ad) {
        const leadAt = G.date.add(o.created_at.slice(0, 10), -(r() < 0.6 ? 0 : U.int(r, 1, 3))) + o.created_at.slice(10);
        ins('ad_attributions', { id: 'at-' + o.id.slice(3), lead_id: lid(), order_id: o.id, conversation_id: null, ad_id: ad.id, campaign_id: ad.campaign_id, platform: ad.platform, brand_id: o.brand_id, method: methodForAd(ad, o.channel), is_new_customer: !!isNew, attributed_at: o.created_at, lead_at: leadAt < '2026-09-01' ? o.created_at : leadAt, lead_origin: true, customer_id: o.customer_id, manual_reason: null });
      } else if (['WHATSAPP', 'TIKTOK'].includes(o.channel) && o.status !== 'DRAFT' && r() < 0.28 && (ctwaAds[o.brand_id] || []).length) {
        const la = G.date.add(o.created_at.slice(0, 10), -U.int(r, 2, 24));
        if (la < '2026-09-01') continue;
        const lad = U.pick(r, ctwaAds[o.brand_id]); const l = lid();
        ins('ad_attributions', { lead_id: l, order_id: null, ad_id: lad.id, campaign_id: lad.campaign_id, platform: lad.platform, brand_id: o.brand_id, method: 'CTWA_REFERRAL', is_new_customer: false, attributed_at: la + 'T1' + U.int(r, 0, 9) + ':2' + U.int(r, 0, 9), lead_at: la + 'T1' + U.int(r, 0, 9) + ':2' + U.int(r, 0, 9), lead_origin: true, customer_id: o.customer_id, manual_reason: null });
        ins('ad_attributions', { id: 'at-' + o.id.slice(3), lead_id: l, order_id: o.id, ad_id: lad.id, campaign_id: lad.campaign_id, platform: lad.platform, brand_id: o.brand_id, method: 'INHERITED_FROM_LEAD', is_new_customer: !!isNew, attributed_at: o.created_at, lead_at: la, lead_origin: false, customer_id: o.customer_id, manual_reason: null });
      }
    }
    // leads que no compraron: según el gasto del día (costo por lead de la plataforma)
    const adsById = new Map(G.db.all('ad_ads').map(a => [a.id, a]));
    for (const s of G.db.all('ad_spend_daily')) {
      const ad = adsById.get(s.ad_id); if (!ad || A.trackingIssues(ad).length) continue;
      const n = Math.max(0, Math.round(s.spend_pen / 13 * (0.5 + 0.8 * r())));
      for (let i = 0; i < n; i++) {
        const known = r() < 0.35 ? U.pick(r, persons) : null;
        const t = s.spend_date + 'T' + U.pad(U.int(r, 8, 21), 2) + ':' + U.pad(U.int(r, 0, 59), 2);
        ins('ad_attributions', { lead_id: lid(), order_id: null, ad_id: ad.id, campaign_id: ad.campaign_id, platform: ad.platform, brand_id: ad.brand_id, method: ad.is_ctwa ? 'CTWA_REFERRAL' : ad.destination === 'WEB' ? 'UTM' : ad.destination === 'TIKTOK_DM' ? 'TIKTOK_DM' : 'TRACKING_CODE', is_new_customer: false, attributed_at: t, lead_at: t, lead_origin: true, customer_id: known ? known.id : null, phone: known ? known.phone : '+519' + U.pad(U.int(r, 10000000, 99999999), 8), manual_reason: null });
      }
    }
    // dos correcciones manuales auditadas (RN-ADS-06)
    const hasAtt = new Set(G.db.all('ad_attributions').map(x => x.order_id).filter(Boolean));
    const dig = G.db.where('sales_orders', o => o.channel === 'WHATSAPP' && !o.origin_ad_code && o.status === 'CLOSED' && o.brand_id === 'br-DG' && !hasAtt.has(o.id)).slice(0, 2);
    const g01 = A.adByCode('DG-G01');
    dig.forEach((o, i) => ins('ad_attributions', { id: 'at-' + o.id.slice(3), lead_id: null, order_id: o.id, ad_id: g01.id, campaign_id: g01.campaign_id, platform: 'GOOGLE', brand_id: o.brand_id, method: 'MANUAL', is_new_customer: first.get(o.customer_id) && first.get(o.customer_id).id === o.id, attributed_at: o.created_at, lead_at: o.created_at, lead_origin: false, customer_id: o.customer_id, manual_reason: i ? 'La clienta escribió «vi el anuncio de Google» sin el código; confirmado por la vendedora' : 'Código DG-G01 enviado en un segundo mensaje, no en el primero', corrected_by: 'Lucía Paredes Gil', corrected_at: G.date.add(o.created_at.slice(0, 10), 1) + 'T10:15', previous: { ad_id: null, method: 'NONE' } }));
    // facturas de setiembre (D-ADS-03: moneda de la cuenta; tipo de cambio de la fecha de la factura)
    const prefix = { GOOGLE: 'GADS-', META: 'FBADS-', TIKTOK: 'TTADS-' };
    accs.forEach((a, i) => {
      const cur = G.db.where('ad_spend_daily', s => { const c = A.campaign(s.campaign_id); return c && c.account_id === a.id && s.spend_date >= '2026-09-01' && s.spend_date <= '2026-09-30'; });
      const amtCur = R(U.sum(cur, s => s.spend));
      if (!amtCur) return;
      const issue = G.date.add('2026-10-02', i % 4);
      const factor = a.id === 'aa-M2-META' ? 1.064 : a.id === 'aa-DG-TIKTOK' ? 0.996 : 1;
      const inv = A.registerInvoice({ account_id: a.id, invoice_number: prefix[a.platform] + (a.platform === 'GOOGLE' ? '5523' : '8810') + '-' + U.pad(9260 + i, 5), issue_date: issue, period_from: '2026-09-01', period_to: '2026-09-30', currency: a.currency, amount: R(amtCur * factor), reconcile: a.platform !== 'TIKTOK' || a.brand_id === 'br-DG', sendToGas: false });
      if (inv.status === 'PENDING') { inv.imported_spend_pen = null; }
      if (inv.status === 'OBSERVED') inv.note = 'Meta cobró S/ ' + G.fmt.num(inv.difference_pen, 2) + ' más: posible cargo de impuesto digital o crédito no aplicado. Pedir el detalle a Meta.';
    });
    // creadores de contenido (respaldo: si GAS siembra los suyos con ad_campaign_id, estos se ignoran)
    const cr = G.db.where('suppliers', s => s.supplier_type === 'CONTENT_CREATOR');
    if (cr.length) [['ac-DG-META-CTWA', 0, 1200, '2026-09-08', 'PAID', 'Reel «cuy al horno en casa» (3 piezas)'], ['ac-DG-TIKTOK-VID', 0, 900, '2026-09-19', 'PAID', 'Video receta caldo de huesos'], ['ac-M3-TIKTOK-VID', 1, 650, '2026-09-25', 'APPROVED', 'Parrillada con chorizo parrillero'], ['ac-M5-META-CAT', 0, 500, '2026-10-03', 'APPROVED', 'Fotos de mermeladas y café para el catálogo'], ['ac-DG-META-CTWA', 1, 1800, '2026-10-06', 'SUBMITTED', 'Campaña día del cuy (5 piezas)']]
      .forEach(([cid, si, amt, d, st, desc], i) => { const camp = G.db.get('ad_campaigns', cid); if (!camp) return; const bc = G.db.get('brands', camp.brand_id).code; ins('expenses', { id: 'ex-ads-cr-' + (i + 1), number: 'GS-ADS-' + U.pad(i + 1, 3), company_id: 'co-dg', establishment_id: 'es-L1', cost_center_id: 'cc-MKT-' + bc, brand_id: camp.brand_id, category_id: null, category_code: 'CONTENT_CREATORS', supplier_id: cr[si % cr.length].id, doc_type: 'FEES_RECEIPT', doc_series: 'E001', doc_number: String(40 + i * 3), issue_date: d, currency: 'PEN', exchange_rate: 1, subtotal: amt, igv: 0, other_taxes: 0, total: amt, withholding_amount: amt > 1500 ? R(amt * 0.08) : 0, amount_pen: amt, ad_campaign_id: cid, description: desc, status: st, demo_fallback: true, source_module: 'ADS' }); });
    // catálogo de indicadores: unidad, cálculo y detalle (kpi_register de TAB si está)
    const KD = { 'KPI-ADS-01': ['PEN', 'ADS-05'], 'KPI-ADS-02': ['PEN', 'ADS-05'], 'KPI-ADS-03': ['PEN', 'ADS-05'], 'KPI-ADS-04': ['PEN', 'ADS-05'], 'KPI-ADS-05': ['RATIO', 'ADS-05'], 'KPI-ADS-06': ['PCT', 'ADS-09'], 'KPI-ADS-07': ['PEN', 'ADS-08'], 'KPI-ADS-08': ['PCT', 'ADS-06'], 'KPI-ADS-09': ['PCT', 'ADS-09'] };
    for (const [code, [unit, dd]] of Object.entries(KD)) { const k = G.db.find('kpi_definitions', x => x.code === code); if (k) Object.assign(k, { unit, drilldown: dd, calculator: 'kpi_ads_' + code.slice(-2), decimals: unit === 'RATIO' ? 2 : unit === 'PCT' ? 1 : 2, dimensions: ['brand', 'platform', 'campaign', 'ad'], source: 'ad_spend_daily, ad_attributions, payments', visible_roles: ['GERENTE', 'MARKETING', 'AUDITOR', 'ADMINISTRACION'], requires_module: 'ADS' }); }
  }, 'ADS');

  /* ------------------------------------------------------------------
     Interfaz: estado compartido de período y filtros
     ------------------------------------------------------------------ */
  const S = A.ui = A.ui || { period: '2026-09', from: '2026-09-01', to: '2026-09-30', platform: '', campaign: '', by: 'ad' };
  function setPeriod(p) {
    S.period = p;
    if (p === '2026-09') { S.from = '2026-09-01'; S.to = '2026-09-30'; }
    else if (p === '2026-10') { S.from = '2026-10-01'; S.to = G.date.add(G.TODAY, -1); }
    G.refresh();
  }
  function periodBar(extra) {
    const custom = S.period === 'CUSTOM';
    const fromI = h('input', { class: 'input', type: 'date', value: S.from, attrs: { 'aria-label': 'Desde', id: 'ads-from' } });
    const toI = h('input', { class: 'input', type: 'date', value: S.to, attrs: { 'aria-label': 'Hasta', id: 'ads-to' } });
    const apply = () => { if (fromI.value && toI.value) { S.from = fromI.value; S.to = toI.value; G.refresh(); } };
    fromI.addEventListener('change', apply); toI.addEventListener('change', apply);
    return h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;align-items:center' },
      pills([['2026-09', 'Setiembre 2026'], ['2026-10', 'Octubre (al 09/10)'], ['CUSTOM', 'Rango']], S.period, setPeriod),
      custom ? [fromI, toI] : h('span', { class: 'muted small' }, `${G.fmt.date(S.from)} – ${G.fmt.date(S.to)} · marca: ${G.ctx.brand === 'ALL' ? 'todas' : G.brandName(G.ctx.brand)}`),
      extra || null);
  }
  const brandF = () => G.ctx.brand !== 'ALL' ? G.ctx.brand : null;
  const scopeBrands = () => { const u = G.scope.user(); return u && u.brands && u.brands.length ? u.brands : null; };
  const filt = () => ({ from: S.from, to: S.to, brand: brandF(), brands: scopeBrands(), site: G.ctx.site !== 'ALL' ? G.ctx.site : null });
  const platBadge = p => badge(platName(p), p === 'GOOGLE' ? 'info' : p === 'META' ? '' : 'warn');
  const roasTone = v => v == null ? '' : v >= 4 ? 'ok' : v >= 2 ? 'warn' : 'bad';
  const canManage = () => G.can('ads.account.manage');
  const canSeeResults = () => G.can('ads.result.view') || G.ctx.role === 'MARKETING';
  function resultsGate(body) { if (!canSeeResults()) { body.appendChild(notice(`Tu rol (${G.roleName()}) no tiene el permiso ads.result.view para ver resultados y comparativos.`, 'warn')); return false; } return true; }
  function copy(text) { try { navigator.clipboard.writeText(text); toast('Copiado al portapapeles', 'ok'); } catch (e) { toast('Copia manual: ' + text, 'info'); } }

  /* ---------- fichas ---------- */
  function adDrawer(ad) {
    drawer(A.adLabel(ad), (b, close) => {
      const camp = A.campaign(ad.campaign_id); const acc = camp && A.account(camp.account_id);
      const issues = A.trackingIssues(ad);
      const t = A.total({ ad_id: ad.id, from: S.from, to: S.to });
      b.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' },
        canManage() ? btn('Editar rastreo', () => { close(); editTracking(ad); }, { kind: 'primary', sm: true }) : null,
        ad.destination !== 'WEB' && ad.tracking_code ? btn('Enlace y QR', () => { close(); G.go('ADS-03', { ad: ad.id }); }, { sm: true }) : null,
        btn('Resultados', () => { close(); S.campaign = ''; G.go('ADS-05', { ad: ad.id }); }, { sm: true })));
      if (issues.length) b.appendChild(notice(`RN-ADS-03: anuncio activo sin rastreo (${issues.join(', ')}). No cuenta para el retorno por anuncio hasta corregirlo.`, 'warn'));
      b.appendChild(dl([['Plataforma', platName(ad.platform)], ['Marca', G.brandFull(ad.brand_id)], ['Cuenta', acc ? acc.name : '—'], ['Campaña', camp ? camp.name + ' (' + camp.code + ')' : '—'], ['Grupo', ad.ad_group_name], ['ID en la plataforma', ad.external_id], ['Código interno', h('span', { class: 'mono' }, ad.code)], ['Destino', destName(ad.destination) + (ad.is_ctwa ? ' · anuncio de clic a WhatsApp' : '')], ['Número de WhatsApp', ad.channel_id ? (G.db.get('messaging_channels', ad.channel_id) || {}).number : '—'], ['Código de rastreo', ad.tracking_code ? h('span', { class: 'mono' }, ad.tracking_code) : '—'], ['UTM', ad.utm_source ? `${ad.utm_source} / ${ad.utm_medium} / ${ad.utm_campaign} / ${ad.utm_content}` : '—'], ['Estado', st(ad.status)]]));
      b.appendChild(card(`Resultados ${G.fmt.date(S.from)} – ${G.fmt.date(S.to)}`, kpis([{ label: 'Inversión', value: G.fmt.money(t.spend) }, { label: 'Leads', value: G.fmt.num(t.leads) }, { label: 'Pedidos', value: G.fmt.num(t.orders), sub: `${t.newCust} de clientes nuevos` }, { label: 'Cobrado', value: G.fmt.money(t.collected) }, { label: 'Retorno', value: t.roas == null ? '—' : G.fmt.num(t.roas, 2), tone: roasTone(t.roas) }])));
    }, { code: 'ADS-02', wide: true });
  }
  function editTracking(ad) {
    if (!G.require('ads.account.manage', () => true)) return;
    drawer('Rastreo de ' + (ad.tracking_code || ad.code), (b, close) => {
      const chOpts = G.db.where('messaging_channels', c => c.kind === 'WHATSAPP').map(c => [c.id, `${c.number} · ${c.display_name}`]);
      b.appendChild(form({ id: 'ads-trk', values: Object.assign({}, ad), fields: [
        { key: 'destination', label: 'Destino', type: 'select', options: DEST, required: true },
        { key: 'is_ctwa', label: 'Anuncio de clic a WhatsApp (Meta trae el referral)', type: 'checkbox' },
        { key: 'channel_id', label: 'Número de WhatsApp de la marca', type: 'select', options: chOpts },
        { key: 'tracking_code', label: 'Código de rastreo (XX-XXXX)', type: 'text', placeholder: 'DG-A12', help: 'Va en el mensaje inicial: «Hola, vi el anuncio DG-A12». Único en la empresa.' },
        { key: 'utm_source', label: 'utm_source', type: 'text' }, { key: 'utm_medium', label: 'utm_medium', type: 'text' },
        { key: 'utm_campaign', label: 'utm_campaign', type: 'text' }, { key: 'utm_content', label: 'utm_content', type: 'text' },
        { key: 'landing_url', label: 'Página de destino', type: 'text', span: 2 },
        { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activo'], ['PAUSED', 'Pausado'], ['ENDED', 'Terminado'], ['REMOVED', 'Eliminado']], required: true }],
        submitLabel: 'Guardar rastreo', onCancel: close,
        onSubmit: v => {
          const code = v.tracking_code ? String(v.tracking_code).trim().toUpperCase() : null;
          if (code && !CODE_RE.test(code)) return { tracking_code: 'RN-ADS-03: formato XX-XXXX (letras y números, por ejemplo DG-A12).' };
          if (code && G.db.find('ad_ads', x => x.id !== ad.id && (x.tracking_code || '').toUpperCase() === code)) return { tracking_code: `RN-ADS-03: el código ${code} ya lo usa otro anuncio.` };
          if (v.destination === 'WHATSAPP' && v.status === 'ACTIVE') { if (!v.channel_id) return { channel_id: 'RN-ADS-03: un anuncio activo a WhatsApp necesita el número de su marca.' }; const ch = G.db.get('messaging_channels', v.channel_id); if (ch.brand_id !== ad.brand_id) return { channel_id: `RN-ADS-03: ese número es de ${G.brandName(ch.brand_id)}; el anuncio es de ${G.brandName(ad.brand_id)}.` }; if (!code && !v.is_ctwa) return { tracking_code: 'RN-ADS-03: un anuncio activo a WhatsApp necesita código de rastreo (o ser de clic a WhatsApp).' }; }
          if (v.destination === 'WEB' && v.status === 'ACTIVE' && !(v.utm_source && v.utm_campaign)) return { utm_source: 'RN-ADS-03: un anuncio a la web necesita UTM (al menos utm_source y utm_campaign).' };
          G.db.update('ad_ads', ad.id, { destination: v.destination, is_ctwa: !!v.is_ctwa, channel_id: v.destination === 'WHATSAPP' ? v.channel_id : null, tracking_code: code, utm_source: v.utm_source || null, utm_medium: v.utm_medium || null, utm_campaign: v.utm_campaign || null, utm_content: v.utm_content || null, landing_url: v.landing_url || null, status: v.status });
          close(); toast('Rastreo guardado', 'ok'); G.refresh(); return true;
        } }));
    }, { code: 'ADS-02' });
  }
  function ordersDrawer(title, orderIds) {
    const col = A.collectedMap();
    drawer(title, b => {
      const rows = orderIds.map(id => G.db.get('sales_orders', id)).filter(Boolean).map(o => ({ o, att: G.db.find('ad_attributions', x => x.order_id === o.id) }));
      b.appendChild(kpis([{ label: 'Pedidos', value: G.fmt.num(rows.length) }, { label: 'Clientes nuevos', value: G.fmt.num(rows.filter(x => x.att && x.att.is_new_customer).length) }, { label: 'Cobrado', value: G.fmt.money(U.sum(rows, x => col.get(x.o.id) || 0)) }]));
      b.appendChild(table({ id: 'ads-ord-' + title.length, columns: [
        { key: 'n', label: 'Pedido', value: x => x.o.number, mono: true }, { key: 'd', label: 'Fecha', value: x => x.o.created_at, render: x => G.fmt.date(x.o.created_at) },
        { key: 'c', label: 'Cliente', value: x => G.custName(x.o.customer_id) }, { key: 'm', label: 'Método', value: x => x.att ? methodName(x.att.method) : '—' },
        { key: 'nw', label: 'Nuevo', value: x => x.att && x.att.is_new_customer ? 'Sí' : 'No' }, { key: 's', label: 'Estado', value: x => x.o.status, render: x => st(x.o.status) },
        { key: 'col', label: 'Cobrado', align: 'r', value: x => col.get(x.o.id) || 0, render: x => G.fmt.money(col.get(x.o.id) || 0) }], rows, pageSize: 12 }));
    }, { code: 'ADS-05', wide: true });
  }

  /* ------------------------------------------------------------------
     Pantallas
     ------------------------------------------------------------------ */
  function s01(el) {
    const body = G.ui.page(el, { code: 'ADS-01', title: 'Cuentas publicitarias', sub: 'Cuentas de Google Ads, Meta Ads y TikTok Ads por marca: moneda, zona horaria, proveedor para la factura y última importación.', actions: [canManage() ? { label: 'Conectar cuenta', kind: 'primary', icon: '+', onClick: connectAccount } : null].filter(Boolean) });
    const accs = G.scope.filter(G.db.all('ad_accounts'));
    const lastRun = new Map(); for (const r of G.db.all('ad_import_runs')) { const p = lastRun.get(r.account_id); if (!p || r.started_at > p.started_at) lastRun.set(r.account_id, r); }
    const mFrom = G.date.month(G.TODAY);
    const spendBy = new Map(); for (const s of G.db.all('ad_spend_daily')) { if (s.spend_date < mFrom) continue; const c = A.campaign(s.campaign_id); if (c) spendBy.set(c.account_id, (spendBy.get(c.account_id) || 0) + s.spend_pen); }
    const failed = accs.filter(a => (lastRun.get(a.id) || {}).status === 'FAILED');
    body.appendChild(kpis([{ label: 'Cuentas conectadas', value: G.fmt.num(accs.filter(a => a.status === 'ACTIVE').length), sub: `${accs.length} en total` }, { label: 'Inversión de octubre', value: G.fmt.money(U.sum(accs, a => spendBy.get(a.id) || 0)), sub: 'al 09/10, en soles' }, { label: 'En dólares', value: G.fmt.num(accs.filter(a => a.currency === 'USD').length), sub: 'se convierten con el TC de venta del día' }, { label: 'Última importación fallida', value: G.fmt.num(failed.length), tone: failed.length ? 'bad' : 'ok', sub: failed.map(a => a.name).join(', ') || 'ninguna', onClick: () => G.go('ADS-04') }]));
    if (failed.length) body.appendChild(notice([h('b', null, 'RN-ADS-01: '), `La corrida de las ${G.param('ads_import_time') || '06:00'} falló para ${failed.map(a => a.name).join(', ')}. Reconecta la cuenta y reimporta el rango en ADS-04.`], 'bad'));
    body.appendChild(table({ id: 'ads-01', columns: [
      { key: 'platform', label: 'Plataforma', render: a => platBadge(a.platform) }, { key: 'name', label: 'Cuenta' }, { key: 'brand', label: 'Marca', value: a => G.brandName(a.brand_id) },
      { key: 'external_id', label: 'ID externo', mono: true }, { key: 'currency', label: 'Moneda' }, { key: 'timezone', label: 'Zona horaria' },
      { key: 'sup', label: 'Proveedor (factura)', value: a => G.supName(a.supplier_id) },
      { key: 'spend', label: 'Inversión oct.', align: 'r', value: a => spendBy.get(a.id) || 0, render: a => G.fmt.money(spendBy.get(a.id) || 0) },
      { key: 'last', label: 'Última importación', value: a => (lastRun.get(a.id) || {}).started_at || '', render: a => { const r = lastRun.get(a.id); return r ? h('span', null, G.fmt.datetime(r.started_at), ' ', st(r.status)) : '—'; } },
      { key: 'status', label: 'Estado', render: a => st(a.status) }],
      rows: accs, onRow: a => accountDrawer(a), filters: [{ key: 'platform', label: 'Plataforma', options: PLAT }, { key: 'status', label: 'Estado', options: [['ACTIVE', 'Activa'], ['PAUSED', 'Pausada'], ['DISCONNECTED', 'Desconectada']] }] }));
  }
  function accountDrawer(a) {
    drawer(a.name, (b, close) => {
      const set = st => { G.require('ads.account.manage', () => { G.db.update('ad_accounts', a.id, { status: st }); toast('Cuenta ' + G.ui.statusLabel(st).toLowerCase(), 'ok'); close(); G.refresh(); }); };
      b.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' },
        btn('Importar ayer', () => G.require('ads.account.manage', () => { try { const y = G.date.add(G.TODAY, -1); const r = A.importRange(a.id, y, y); toast(`Importación OK: ${r.rows_read} filas leídas, ${r.rows_upserted} actualizadas`, 'ok'); close(); G.refresh(); } catch (e) { toast(e.message, 'bad'); } }), { kind: 'primary', sm: true }),
        a.status === 'ACTIVE' ? btn('Pausar', () => set('PAUSED'), { sm: true }) : btn('Reconectar', () => set('ACTIVE'), { sm: true }),
        a.status !== 'DISCONNECTED' ? btn('Desconectar', () => set('DISCONNECTED'), { sm: true, kind: 'danger' }) : null));
      b.appendChild(dl([['Plataforma', platName(a.platform)], ['Marca', G.brandFull(a.brand_id)], ['ID externo', a.external_id], ['Moneda', a.currency + (a.currency !== 'PEN' ? ` (TC venta de hoy ${G.fmt.num(A.fx(G.TODAY, a.currency), 3)})` : '')], ['Zona horaria', a.timezone + ' · el gasto se asigna al día de esta zona (RN-ADS-12)'], ['Proveedor', G.supName(a.supplier_id)], ['Conector (INT)', a.connector_id], ['Conectada desde', G.fmt.datetime(a.connected_at)], ['Última importación', G.fmt.datetime(a.last_import_at)], ['Estado', st(a.status)]]));
      const camps = G.db.where('ad_campaigns', c => c.account_id === a.id);
      b.appendChild(card('Campañas', table({ id: 'ads-acc-c', columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Campaña' }, { key: 'objective', label: 'Objetivo' }, { key: 'n', label: 'Anuncios', align: 'r', value: c => G.db.where('ad_ads', x => x.campaign_id === c.id).length }, { key: 'status', label: 'Estado', render: c => st(c.status) }], rows: camps, search: false, pageSize: 10 }), { flush: true }));
    }, { code: 'ADS-01', wide: true });
  }
  function connectAccount() {
    if (!G.require('ads.account.manage', () => true)) return;
    drawer('Conectar cuenta publicitaria', (b, close) => {
      b.appendChild(notice('La conexión se autoriza una vez en la plataforma (OAuth). Después, la importación corre sola cada día (RN-ADS-01).', 'info'));
      b.appendChild(form({ id: 'ads-acc', values: { platform: 'META', currency: 'USD', timezone: 'America/Lima', brand_id: G.ctx.brand !== 'ALL' ? G.ctx.brand : 'br-DG' }, fields: [
        { key: 'platform', label: 'Plataforma', type: 'select', options: PLAT, required: true, onChange: (v, vals, api) => { api.set('currency', v === 'GOOGLE' ? 'PEN' : 'USD'); } },
        { key: 'brand_id', label: 'Marca', type: 'select', options: G.scope.brands().map(x => [x.id, x.name]), required: true },
        { key: 'external_id', label: 'ID de la cuenta en la plataforma', type: 'text', required: true, placeholder: 'act_1234567890' },
        { key: 'name', label: 'Nombre', type: 'text', required: true },
        { key: 'currency', label: 'Moneda', type: 'select', options: [['PEN', 'Soles (PEN)'], ['USD', 'Dólares (USD)']], required: true },
        { key: 'timezone', label: 'Zona horaria', type: 'select', options: [['America/Lima', 'America/Lima'], ['UTC', 'UTC'], ['America/Los_Angeles', 'America/Los_Angeles']], required: true },
        { key: 'supplier_id', label: 'Proveedor para la factura', type: 'select', options: G.ui.opts('suppliers', s => s.trade_name, s => s.supplier_type === 'ADVERTISING'), required: true }],
        submitLabel: 'Conectar', onCancel: close,
        onSubmit: v => {
          if (G.db.find('ad_accounts', a => a.platform === v.platform && a.external_id === v.external_id)) return { external_id: `Ya existe una cuenta de ${platName(v.platform)} con ese ID.` };
          const acc = G.db.insert('ad_accounts', Object.assign({}, v, { status: 'ACTIVE', connector_id: 'ic-ads-' + v.platform.toLowerCase(), connected_at: G.date.now(), last_import_at: null }));
          close(); toast(`Cuenta ${acc.name} conectada`, 'ok'); G.refresh(); return true;
        } }));
    }, { code: 'ADS-01' });
  }

  function s02(el, params) {
    const body = G.ui.page(el, { code: 'ADS-02', title: 'Campañas y anuncios', sub: 'Campañas y anuncios por plataforma y marca con su destino, número de WhatsApp, código de rastreo y UTM. Los activos sin rastreo no cuentan para el retorno por anuncio.' });
    const all = A.ads();
    const ads = G.scope.filter(all);
    const untr = ads.filter(a => A.trackingIssues(a, all).length);
    body.appendChild(kpis([{ label: 'Campañas activas', value: G.fmt.num(G.scope.filter(G.db.where('ad_campaigns', c => c.status === 'ACTIVE')).length) }, { label: 'Anuncios activos', value: G.fmt.num(ads.filter(a => a.status === 'ACTIVE').length) }, { label: 'Clic a WhatsApp (Meta)', value: G.fmt.num(ads.filter(a => a.is_ctwa).length) }, { label: 'Activos sin rastreo', value: G.fmt.num(untr.length), tone: untr.length ? 'bad' : 'ok', sub: 'RN-ADS-03' }]));
    const chNum = id => (G.db.get('messaging_channels', id) || {}).number || '—';
    const adCols = [
      { key: 'tracking_code', label: 'Rastreo', mono: true, value: a => a.tracking_code || '' , render: a => a.tracking_code ? h('span', { class: 'mono' }, a.tracking_code) : a.utm_source ? badge('UTM', 'info') : badge('—', 'bad') },
      { key: 'name', label: 'Anuncio' }, { key: 'camp', label: 'Campaña', value: a => (A.campaign(a.campaign_id) || {}).name },
      { key: 'platform', label: 'Plataforma', render: a => platBadge(a.platform) }, { key: 'brand', label: 'Marca', value: a => G.brandName(a.brand_id) },
      { key: 'destination', label: 'Destino', value: a => destName(a.destination) + (a.is_ctwa ? ' (clic a WA)' : '') },
      { key: 'wa', label: 'WhatsApp', mono: true, value: a => a.channel_id ? chNum(a.channel_id) : '—' },
      { key: 'utm', label: 'UTM', value: a => a.utm_source ? `${a.utm_source}/${a.utm_medium}/${a.utm_campaign}` : '—' },
      { key: 'issues', label: 'Rastreo', value: a => A.trackingIssues(a, all).join(', '), render: a => { const i = A.trackingIssues(a, all); return i.length ? badge('Sin rastreo: ' + i.join(', '), 'bad') : badge('OK', 'ok'); } },
      { key: 'status', label: 'Estado', render: a => st(a.status) }];
    body.appendChild(tabs([
      { key: 'ads', label: 'Anuncios', count: ads.length, render: p => p.appendChild(table({ id: 'ads-02a', columns: adCols, rows: ads, onRow: adDrawer, filters: [{ key: 'platform', label: 'Plataforma', options: PLAT }, { key: 'destination', label: 'Destino', options: DEST }, { key: 'status', label: 'Estado', options: [['ACTIVE', 'Activo'], ['PAUSED', 'Pausado']] }], actions: a => canManage() ? [btn('Rastreo', () => editTracking(a), { sm: true })] : [] })) },
      { key: 'untracked', label: 'Sin rastreo', count: untr.length, render: p => { p.appendChild(notice('Todo anuncio activo a WhatsApp tiene número de su marca y un código único XX-XXXX; los anuncios a la web tienen UTM (RN-ADS-03). Corrige estos para que sus pedidos se atribuyan.', untr.length ? 'warn' : 'ok')); p.appendChild(table({ id: 'ads-02u', columns: adCols, rows: untr, onRow: adDrawer, actions: a => canManage() ? [btn('Corregir', () => editTracking(a), { sm: true, kind: 'primary' })] : [], empty: 'Todos los anuncios activos tienen rastreo.' })); } },
      { key: 'camps', label: 'Campañas', count: G.scope.filter(G.db.all('ad_campaigns')).length, render: p => p.appendChild(table({ id: 'ads-02c', columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Campaña' }, { key: 'platform', label: 'Plataforma', render: c => platBadge(c.platform) }, { key: 'brand', label: 'Marca', value: c => G.brandName(c.brand_id) }, { key: 'objective', label: 'Objetivo' }, { key: 'daily_budget', label: 'Presupuesto diario', align: 'r', render: c => (A.account(c.account_id).currency === 'USD' ? 'USD ' + G.fmt.num(c.daily_budget, 2) : G.fmt.money(c.daily_budget)) }, { key: 'n', label: 'Anuncios', align: 'r', value: c => G.db.where('ad_ads', x => x.campaign_id === c.id).length }, { key: 'status', label: 'Estado', render: c => st(c.status) }], rows: G.scope.filter(G.db.all('ad_campaigns')), onRow: c => { S.campaign = c.id; G.go('ADS-05'); }, filters: [{ key: 'platform', label: 'Plataforma', options: PLAT }] })) },
    ]));
    if (params && params.ad) { const a = G.db.get('ad_ads', params.ad); if (a) setTimeout(() => adDrawer(a), 0); }
  }

  function s03(el, params) {
    const body = G.ui.page(el, { code: 'ADS-03', title: 'Enlaces de rastreo', sub: 'Enlace wa.me con el texto «Hola, vi el anuncio …» y URL con UTM para cada anuncio, con copia y código QR para pegarlos en la plataforma.' });
    const ads = G.scope.filter(A.ads().filter(a => a.status === 'ACTIVE'));
    const sel = (params && params.ad && G.db.get('ad_ads', params.ad)) || ads.find(a => a.tracking_code === 'DG-G01') || ads[0];
    const pick = h('select', { class: 'input', attrs: { 'aria-label': 'Anuncio', id: 'ads-03-sel' } }, ads.map(a => h('option', { value: a.id, selected: sel && a.id === sel.id }, `${a.tracking_code || a.code} · ${a.name} · ${G.brandName(a.brand_id)} · ${platName(a.platform)}`)));
    pick.addEventListener('change', () => G.go('ADS-03', { ad: pick.value }));
    body.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap' }, h('label', { class: 'muted small', attrs: { for: 'ads-03-sel' } }, 'Anuncio'), pick));
    if (sel) {
      const wa = A.waLink(sel), utm = A.utmUrl(sel); const link = wa || utm;
      const issues = A.trackingIssues(sel);
      body.appendChild(h('div', { class: 'grid c2' },
        card(sel.destination === 'WEB' ? 'URL con UTM' : 'Enlace a WhatsApp', h('div', { class: 'stack' },
          issues.length ? notice(`RN-ADS-03: ${issues.join(', ')}. Corrige el rastreo en ADS-02 antes de publicar el enlace.`, 'warn') : null,
          link ? h('div', { class: 'mono small', style: 'word-break:break-all;padding:8px;border:1px solid var(--line);border-radius:8px' }, link) : U2('Este anuncio no tiene enlace: le falta el código o la UTM.'),
          wa ? h('div', { class: 'muted small' }, 'Texto que verá el cliente: ', h('b', null, `Hola, vi el anuncio ${sel.tracking_code}`), ' · número ', (G.db.get('messaging_channels', sel.channel_id) || {}).number) : null,
          sel.is_ctwa ? notice('Anuncio de clic a WhatsApp: Meta envía el referral con el anuncio de origen; el código es respaldo si el cliente reenvía el enlace (RN-ADS-04).', 'info') : null,
          h('div', { class: 'row' }, link ? btn('Copiar', () => copy(link), { kind: 'primary', sm: true }) : null, canManage() ? btn('Editar rastreo', () => editTracking(sel), { sm: true }) : null))),
        card('Código QR', h('div', { class: 'stack', style: 'align-items:center' }, link ? G.ui.qr(link, 168) : U2('Sin enlace'), h('div', { class: 'muted small' }, 'Para afiches, empaques y la vitrina del mostrador.')))));
    }
    const rows = G.scope.filter(A.ads()).map(a => ({ a, link: A.waLink(a) || A.utmUrl(a) }));
    body.appendChild(table({ id: 'ads-03', columns: [
      { key: 'code', label: 'Rastreo', mono: true, value: x => x.a.tracking_code || x.a.utm_content || '—' }, { key: 'name', label: 'Anuncio', value: x => x.a.name }, { key: 'brand', label: 'Marca', value: x => G.brandName(x.a.brand_id) }, { key: 'plat', label: 'Plataforma', value: x => platName(x.a.platform) },
      { key: 'link', label: 'Enlace', value: x => x.link || '', render: x => x.link ? h('span', { class: 'mono small', style: 'word-break:break-all' }, x.link.length > 70 ? x.link.slice(0, 68) + '…' : x.link) : badge('Sin rastreo', 'bad') }],
      rows, onRow: x => G.go('ADS-03', { ad: x.a.id }), actions: x => x.link ? [btn('Copiar', () => copy(x.link), { sm: true })] : [] }));
  }
  const U2 = msg => h('div', { class: 'muted small' }, msg);

  function s04(el) {
    const body = G.ui.page(el, { code: 'ADS-04', title: 'Importaciones', sub: `Corridas diarias a las ${G.param('ads_import_time') || '06:00'} (Lima) con los últimos ${G.param('ads_import_lookback_days') || 3} días de cada cuenta activa: filas leídas y actualizadas, errores y reimportación de un rango.`, actions: canManage() ? [{ label: 'Correr importación diaria', onClick: () => { const rs = A.runDaily(); toast(`${rs.filter(r => r.status === 'OK').length} corridas OK, ${rs.filter(r => r.status !== 'OK').length} con error`, rs.some(r => r.status !== 'OK') ? 'warn' : 'ok'); G.refresh(); } }, { label: 'Reimportar un rango', kind: 'primary', onClick: reimport }] : [] });
    const runs = G.db.all('ad_import_runs').filter(r => G.scope.ok(A.account(r.account_id) || {})).sort(U.by('started_at', -1));
    const today = runs.filter(r => r.started_at.slice(0, 10) === G.TODAY);
    body.appendChild(kpis([{ label: 'Corridas de hoy', value: G.fmt.num(today.length), sub: `${today.filter(r => r.status === 'OK').length} OK` }, { label: 'Con error', value: G.fmt.num(runs.filter(r => r.status === 'FAILED' || r.status === 'PARTIAL').length), tone: runs.some(r => r.status === 'FAILED') ? 'bad' : 'ok' }, { label: 'Filas de gasto', value: G.fmt.num(G.db.all('ad_spend_daily').length), sub: 'una por campaña, anuncio y día (RN-ADS-02)' }, { label: 'Hasta', value: G.fmt.date(G.db.all('ad_spend_daily').reduce((m, s) => s.spend_date > m ? s.spend_date : m, '')), sub: 'último día importado' }]));
    body.appendChild(table({ id: 'ads-04', columns: [
      { key: 'started_at', label: 'Inicio', render: r => G.fmt.datetime(r.started_at) }, { key: 'acc', label: 'Cuenta', value: r => (A.account(r.account_id) || {}).name },
      { key: 'range', label: 'Rango', value: r => r.date_from, render: r => `${G.fmt.date(r.date_from)} – ${G.fmt.date(r.date_to)}` },
      { key: 'rows_read', label: 'Leídas', align: 'r' }, { key: 'rows_upserted', label: 'Actualizadas', align: 'r' },
      { key: 'status', label: 'Estado', render: r => st(r.status) }, { key: 'error', label: 'Error', value: r => r.error || '' }, { key: 'user', label: 'Ejecutó', value: r => r.user || 'Programador de tareas' }],
      rows: runs, onRow: runDrawer, filters: [{ key: 'status', label: 'Estado', options: [['OK', 'OK'], ['FAILED', 'Fallida'], ['PARTIAL', 'Parcial']] }, { key: 'account_id', label: 'Cuenta', options: G.scope.filter(G.db.all('ad_accounts')).map(a => [a.id, a.name]) }] }));
  }
  function runDrawer(r) {
    drawer('Corrida ' + G.fmt.datetime(r.started_at), (b, close) => {
      const acc = A.account(r.account_id);
      if (r.status !== 'OK') b.appendChild(notice(r.error || 'Corrida con error', 'bad'));
      b.appendChild(dl([['Cuenta', acc.name], ['Rango', `${G.fmt.date(r.date_from)} – ${G.fmt.date(r.date_to)}`], ['Filas leídas', r.rows_read], ['Filas actualizadas', r.rows_upserted], ['Inicio', G.fmt.datetime(r.started_at)], ['Fin', G.fmt.datetime(r.finished_at)], ['Estado', st(r.status)]]));
      if (canManage()) b.appendChild(btn('Reimportar este rango', () => { try { if (acc.status !== 'ACTIVE') G.db.update('ad_accounts', acc.id, { status: 'ACTIVE' }); const nr = A.importRange(acc.id, r.date_from, r.date_to); toast(`Reimportado: ${nr.rows_read} leídas, ${nr.rows_upserted} actualizadas`, 'ok'); close(); G.refresh(); } catch (e) { toast(e.message, 'bad'); } }, { kind: 'primary', sm: true }));
      const rows = G.db.where('ad_spend_daily', s => s.import_run_id === r.id);
      if (rows.length) b.appendChild(card('Filas de esta corrida', table({ id: 'ads-run-rows', columns: [{ key: 'spend_date', label: 'Día', render: s => G.fmt.date(s.spend_date) }, { key: 'ad', label: 'Anuncio', value: s => A.adLabel(G.db.get('ad_ads', s.ad_id)) }, { key: 'spend', label: 'Gasto', align: 'r', render: s => s.currency + ' ' + G.fmt.num(s.spend, 2) }, { key: 'exchange_rate', label: 'TC', align: 'r', render: s => G.fmt.num(s.exchange_rate, 3) }, { key: 'spend_pen', label: 'En soles', align: 'r', render: s => G.fmt.money(s.spend_pen) }, { key: 'clicks', label: 'Clics', align: 'r' }], rows, pageSize: 10, search: false }), { flush: true }));
    }, { code: 'ADS-04', wide: true });
  }
  function reimport() {
    drawer('Reimportar un rango', (b, close) => {
      b.appendChild(notice('RN-ADS-02: reimportar reemplaza el valor de cada día por campaña y anuncio; nunca duplica filas.', 'info'));
      b.appendChild(form({ id: 'ads-reimp', values: { account_id: (G.scope.filter(G.db.all('ad_accounts'))[0] || {}).id, from: G.date.add(G.TODAY, -3), to: G.date.add(G.TODAY, -1) }, fields: [
        { key: 'account_id', label: 'Cuenta', type: 'select', options: G.scope.filter(G.db.all('ad_accounts')).map(a => [a.id, a.name]), required: true },
        { key: 'from', label: 'Desde', type: 'date', required: true }, { key: 'to', label: 'Hasta', type: 'date', required: true }],
        submitLabel: 'Reimportar', onCancel: close,
        onSubmit: v => { const acc = A.account(v.account_id); if (acc.status === 'DISCONNECTED') return 'RN-ADS-01: la cuenta está desconectada; reconéctala en ADS-01.'; if (acc.status === 'PAUSED') G.db.update('ad_accounts', acc.id, { status: 'ACTIVE' }); const r = A.importRange(v.account_id, v.from, v.to); close(); toast(`Reimportado: ${r.rows_read} filas leídas, ${r.rows_upserted} actualizadas`, 'ok'); G.refresh(); return true; } }));
    }, { code: 'ADS-04' });
  }

  function s05(el, params) {
    const body = G.ui.page(el, { code: 'ADS-05', title: 'Resultados por anuncio', sub: 'Inversión, leads, pedidos, clientes nuevos y lo cobrado por anuncio o campaña; costo por lead, por pedido y por cliente nuevo y retorno con ventas cobradas (RN-ADS-07).' });
    if (!resultsGate(body)) return;
    const camps = G.scope.filter(G.db.all('ad_campaigns'));
    const pSel = h('select', { class: 'input', attrs: { 'aria-label': 'Plataforma', id: 'ads-05-p' } }, h('option', { value: '' }, 'Plataforma: todas'), PLAT.map(([v, l]) => h('option', { value: v, selected: S.platform === v }, l)));
    pSel.addEventListener('change', () => { S.platform = pSel.value; G.refresh(); });
    const cSel = h('select', { class: 'input', attrs: { 'aria-label': 'Campaña', id: 'ads-05-c' } }, h('option', { value: '' }, 'Campaña: todas'), camps.map(c => h('option', { value: c.id, selected: S.campaign === c.id }, c.name + ' · ' + platName(c.platform))));
    cSel.addEventListener('change', () => { S.campaign = cSel.value; G.refresh(); });
    body.appendChild(periodBar([pSel, cSel, pills([['ad', 'Por anuncio'], ['campaign', 'Por campaña']], S.by, v => { S.by = v; G.refresh(); })]));
    const f = Object.assign(filt(), { platform: S.platform || null, campaign_id: S.campaign || null });
    const t = A.total(f);
    body.appendChild(kpis([{ label: 'Inversión', value: G.fmt.money(t.spend), title: 'KPI-ADS-01' }, { label: 'Leads', value: G.fmt.num(t.leads), sub: 'costo ' + G.fmt.money(t.cpl), title: 'KPI-ADS-02' }, { label: 'Pedidos', value: G.fmt.num(t.orders), sub: 'costo ' + G.fmt.money(t.cpo), title: 'KPI-ADS-03' }, { label: 'Clientes nuevos', value: G.fmt.num(t.newCust), sub: 'costo ' + G.fmt.money(t.cpn), title: 'KPI-ADS-04' }, { label: 'Cobrado', value: G.fmt.money(t.collected), sub: 'pagos confirmados' }, { label: 'Retorno (ROAS)', value: t.roas == null ? '—' : G.fmt.num(t.roas, 2), tone: roasTone(t.roas), sub: 'soles cobrados por sol', title: 'KPI-ADS-05' }]));
    const res = A.results(Object.assign({}, f, { by: S.by }));
    const all = A.ads();
    const rows = res.map(r => { if (S.by === 'ad') { const ad = G.db.get('ad_ads', r.key); const untr = ad && A.trackingIssues(ad, all).length > 0; return Object.assign({}, r, { ad, camp: ad && A.campaign(ad.campaign_id), untr, roas: untr ? null : r.roas }); } const c = A.campaign(r.key); return Object.assign({}, r, { camp: c, creators: A.creatorCost({ campaign_id: r.key, from: f.from, to: f.to }) }); });
    const cols = S.by === 'ad' ? [
      { key: 'code', label: 'Anuncio', value: r => r.ad ? (r.ad.tracking_code || r.ad.code) : '', render: r => h('span', null, h('span', { class: 'mono' }, r.ad ? (r.ad.tracking_code || r.ad.code) : '—'), ' ', h('span', { class: 'muted small' }, r.ad ? r.ad.name : ''), r.untr ? [' ', badge('sin rastreo', 'bad')] : null) },
      { key: 'plat', label: 'Plataforma', value: r => r.camp ? platName(r.camp.platform) : '' }, { key: 'brand', label: 'Marca', value: r => r.camp ? G.brandName(r.camp.brand_id) : '' }] : [
      { key: 'camp', label: 'Campaña', value: r => r.camp ? r.camp.name : '' }, { key: 'plat', label: 'Plataforma', value: r => r.camp ? platName(r.camp.platform) : '' }, { key: 'brand', label: 'Marca', value: r => r.camp ? G.brandName(r.camp.brand_id) : '' },
      { key: 'creators', label: 'Creadores', align: 'r', render: r => G.fmt.money(r.creators) }];
    body.appendChild(table({ id: 'ads-05-' + S.by, sort: 'spend', dir: -1, columns: cols.concat([
      { key: 'spend', label: 'Inversión', align: 'r', render: r => G.fmt.money(r.spend) }, { key: 'leads', label: 'Leads', align: 'r' }, { key: 'orders', label: 'Pedidos', align: 'r' }, { key: 'newCust', label: 'Nuevos', align: 'r' },
      { key: 'collected', label: 'Cobrado', align: 'r', render: r => G.fmt.money(r.collected) }, { key: 'cpl', label: 'C/lead', align: 'r', render: r => G.fmt.money(r.cpl) }, { key: 'cpo', label: 'C/pedido', align: 'r', render: r => G.fmt.money(r.cpo) }, { key: 'cpn', label: 'C/cliente nuevo', align: 'r', render: r => G.fmt.money(r.cpn) },
      { key: 'roas', label: 'Retorno', align: 'r', value: r => r.roas ?? -1, render: r => r.roas == null ? '—' : badge(G.fmt.num(r.roas, 2), roasTone(r.roas)) }]),
      rows, onRow: r => ordersDrawer(`Pedidos de ${S.by === 'ad' ? (r.ad ? r.ad.tracking_code || r.ad.code : '') : (r.camp ? r.camp.name : '')} · ${G.fmt.date(f.from)} – ${G.fmt.date(f.to)}`, r.orderIds),
      footer: [S.by === 'ad' ? 'Total' : 'Total', '', '', S.by === 'campaign' ? '' : null, { v: G.fmt.money(t.spend), align: 'r' }, { v: G.fmt.num(t.leads), align: 'r' }, { v: G.fmt.num(t.orders), align: 'r' }, { v: G.fmt.num(t.newCust), align: 'r' }, { v: G.fmt.money(t.collected), align: 'r' }, { v: G.fmt.money(t.cpl), align: 'r' }, { v: G.fmt.money(t.cpo), align: 'r' }, { v: G.fmt.money(t.cpn), align: 'r' }, { v: t.roas == null ? '—' : G.fmt.num(t.roas, 2), align: 'r' }].filter(x => x !== null) }));
    body.appendChild(notice('El cobrado suma pagos CONFIRMADOS aplicados a pedidos atribuidos no anulados; un pedido solo confirmado o un cobro revertido no suman (RN-ADS-07). La inversión no se reparte por local: el filtro de local solo afecta pedidos y cobros.', 'info'));
    if (params && params.ad) { const ad = G.db.get('ad_ads', params.ad); const r = rows.find(x => x.key === params.ad); if (ad && r) setTimeout(() => ordersDrawer('Pedidos de ' + (ad.tracking_code || ad.code), r.orderIds), 0); }
  }

  function s06(el) {
    const body = G.ui.page(el, { code: 'ADS-06', title: 'Embudo de atribución', sub: 'Anuncio → leads → pedidos → cobros. Lista de pedidos digitales sin atribución y corrección manual con motivo (RN-ADS-06).' });
    body.appendChild(periodBar());
    const f = filt(); const t = A.total(f);
    const dig = A.digitalOrders(f);
    const none = dig.filter(x => !x.att || x.att.method === 'NONE' || !x.att.ad_id);
    const paidOrders = t.orderIds.filter(id => (A.collectedMap().get(id) || 0) > 0).length;
    const steps = [['Inversión', G.fmt.money(t.spend), null], ['Leads atribuidos', G.fmt.num(t.leads), null], ['Pedidos atribuidos', G.fmt.num(t.orders), t.leads ? G.fmt.pct(t.orders / t.leads * 100) + ' de los leads' : null], ['Pedidos con cobro', G.fmt.num(paidOrders), t.orders ? G.fmt.pct(paidOrders / t.orders * 100) + ' de los pedidos' : null], ['Cobrado', G.fmt.money(t.collected), t.roas == null ? null : 'retorno ' + G.fmt.num(t.roas, 2)]];
    body.appendChild(h('div', { class: 'steps' }, steps.map(([l, v, s]) => h('div', { class: 'step done' }, h('b', null, v), h('div', { class: 'small' }, l), s ? h('div', { class: 'muted small' }, s) : null))));
    const byM = U.groupBy(dig.filter(x => x.att && x.att.ad_id && x.att.method !== 'NONE'), x => x.att.method);
    body.appendChild(h('div', { class: 'grid c2' },
      card('Pedidos digitales por método de atribución', G.ui.chart.hbar({ items: METHODS.filter(m => m[0] !== 'NONE').map(([m, l]) => ({ label: l, value: (byM[m] || []).length })).concat([{ label: 'Sin atribución', value: none.length, tone: 'bad' }]), format: v => G.fmt.num(v) })),
      card('Cobertura', kpis([{ label: 'Pedidos digitales', value: G.fmt.num(dig.length) }, { label: 'Con atribución', value: G.fmt.pct(dig.length ? (dig.length - none.length) / dig.length * 100 : null), sub: 'KPI-ADS-08', tone: dig.length && (dig.length - none.length) / dig.length >= 0.7 ? 'ok' : 'warn' }, { label: 'Sin atribución', value: G.fmt.num(none.length), tone: none.length ? 'warn' : 'ok' }, { label: 'Ventana de herencia', value: G.fmt.days(G.param('ads_attribution_window_days')), sub: 'RN-ADS-05' }]))));
    const canCorrect = G.can('ads.attribution.correct');
    body.appendChild(tabs([
      { key: 'none', label: 'Pedidos digitales sin atribución', count: none.length, render: p => p.appendChild(table({ id: 'ads-06n', columns: [{ key: 'n', label: 'Pedido', mono: true, value: x => x.o.number }, { key: 'd', label: 'Fecha', value: x => x.o.created_at, render: x => G.fmt.datetime(x.o.created_at) }, { key: 'ch', label: 'Canal', value: x => G.channelName(x.o.channel) }, { key: 'b', label: 'Marca', value: x => G.brandName(x.o.brand_id) }, { key: 'c', label: 'Cliente', value: x => G.custName(x.o.customer_id) }, { key: 'wa', label: 'Número de origen', value: x => x.o.origin_wa_number || '—' }, { key: 's', label: 'Estado', render: x => st(x.o.status) }], rows: none, actions: x => canCorrect ? [btn('Atribuir', () => correctDrawer(x.o), { sm: true, kind: 'primary' })] : [], filters: [{ key: 'ch', label: 'Canal', options: DIGITAL.map(c => [G.channelName(c), G.channelName(c)]), value: x => G.channelName(x.o.channel) }] })) },
      { key: 'att', label: 'Atribuidos', count: dig.length - none.length, render: p => p.appendChild(table({ id: 'ads-06a', columns: [{ key: 'n', label: 'Pedido', mono: true, value: x => x.o.number }, { key: 'd', label: 'Fecha', value: x => x.o.created_at, render: x => G.fmt.date(x.o.created_at) }, { key: 'ad', label: 'Anuncio', value: x => A.adLabel(G.db.get('ad_ads', x.att.ad_id)) }, { key: 'm', label: 'Método', value: x => methodName(x.att.method) }, { key: 'nw', label: 'Cliente nuevo', value: x => x.att.is_new_customer ? 'Sí' : 'No' }, { key: 'r', label: 'Motivo manual', value: x => x.att.manual_reason || '' }], rows: dig.filter(x => x.att && x.att.ad_id && x.att.method !== 'NONE'), actions: x => canCorrect ? [btn('Corregir', () => correctDrawer(x.o), { sm: true })] : [], filters: [{ key: 'm', label: 'Método', options: METHODS.map(m => [m[1], m[1]]), value: x => methodName(x.att.method) }] })) },
    ]));
    if (!canCorrect) body.appendChild(notice(`Corregir atribuciones exige el permiso ads.attribution.correct (marketing o gerencia).`, 'info'));
  }
  function correctDrawer(o) {
    if (!G.require('ads.attribution.correct', () => true)) return;
    const prev = G.db.find('ad_attributions', x => x.order_id === o.id);
    drawer('Atribución de ' + o.number, (b, close) => {
      b.appendChild(dl([['Pedido', o.number + ' · ' + G.channelName(o.channel) + ' · ' + G.brandName(o.brand_id)], ['Cliente', G.custName(o.customer_id)], ['Creado', G.fmt.datetime(o.created_at)], ['Atribución actual', prev ? methodName(prev.method) + (prev.ad_id ? ' · ' + A.adLabel(G.db.get('ad_ads', prev.ad_id)) : '') : 'Sin atribución']]));
      b.appendChild(form({ id: 'ads-corr', values: { ad_id: prev && prev.ad_id || '' }, fields: [
        { key: 'ad_id', label: 'Anuncio', type: 'select', options: A.ads().filter(a => a.brand_id === o.brand_id).map(a => [a.id, `${a.tracking_code || a.code} · ${a.name} · ${platName(a.platform)}`]), help: 'Vacío = sin atribución' },
        { key: 'reason', label: 'Motivo (obligatorio)', type: 'textarea', required: true, placeholder: 'Por ejemplo: la clienta envió el código en un segundo mensaje' }],
        submitLabel: 'Guardar corrección', onCancel: close,
        onSubmit: v => { A.correct(o.id, v.ad_id || null, v.reason); close(); toast('Atribución corregida y auditada', 'ok'); G.refresh(); return true; } }));
      if (prev && prev.previous) b.appendChild(notice(`Corregida por ${prev.corrected_by} el ${G.fmt.datetime(prev.corrected_at)}. Antes: ${methodName(prev.previous.method)}.`, 'info'));
    }, { code: 'ADS-06' });
  }

  function s07(el) {
    const canRec = G.can('ads.invoice.reconcile');
    const body = G.ui.page(el, { code: 'ADS-07', title: 'Facturas de plataformas', sub: 'Factura o recibo de Google, Meta o TikTok contra el gasto importado del período; diferencia, estado y envío a GAS como gasto de publicidad.', actions: canRec ? [{ label: 'Registrar factura', kind: 'primary', icon: '+', onClick: invoiceForm }] : [] });
    const invs = G.db.all('ad_platform_invoices').filter(i => G.scope.ok(A.account(i.account_id) || {})).sort(U.by('issue_date', -1));
    body.appendChild(kpis([{ label: 'Facturas', value: G.fmt.num(invs.length) }, { label: 'Conciliadas', value: G.fmt.num(invs.filter(i => i.status === 'RECONCILED').length), tone: 'ok' }, { label: 'Observadas', value: G.fmt.num(invs.filter(i => i.status === 'OBSERVED').length), tone: invs.some(i => i.status === 'OBSERVED') ? 'bad' : 'ok' }, { label: 'Pendientes', value: G.fmt.num(invs.filter(i => i.status === 'PENDING').length), tone: 'warn' }, { label: 'Por pasar a GAS', value: G.fmt.num(invs.filter(i => i.status === 'RECONCILED' && !i.expense_id).length) }]));
    body.appendChild(notice(`RN-ADS-08: queda conciliada si la diferencia es ≤ el mayor entre S/ ${G.fmt.num(G.param('ads_reconcile_tolerance_pen'), 2)} y ${G.param('ads_reconcile_tolerance_pct')} % del gasto importado. D-ADS-04: las facturas del exterior se registran como FOREIGN_INVOICE y la contadora confirma el tratamiento.`, 'info'));
    if (!canRec) body.appendChild(notice('Conciliar facturas exige el permiso ads.invoice.reconcile (administración o contadora).', 'warn'));
    body.appendChild(table({ id: 'ads-07', columns: [
      { key: 'invoice_number', label: 'Factura', mono: true }, { key: 'acc', label: 'Cuenta', value: i => (A.account(i.account_id) || {}).name }, { key: 'issue_date', label: 'Emisión', render: i => G.fmt.date(i.issue_date) },
      { key: 'per', label: 'Período', value: i => i.period_from, render: i => `${G.fmt.date(i.period_from)} – ${G.fmt.date(i.period_to)}` },
      { key: 'amount', label: 'Monto', align: 'r', render: i => i.currency + ' ' + G.fmt.num(i.amount, 2) }, { key: 'amount_pen', label: 'En soles', align: 'r', render: i => G.fmt.money(i.amount_pen) },
      { key: 'imported_spend_pen', label: 'Gasto importado', align: 'r', render: i => G.fmt.money(i.imported_spend_pen) }, { key: 'difference_pen', label: 'Diferencia', align: 'r', render: i => i.difference_pen == null ? '—' : h('span', { class: Math.abs(i.difference_pen) > (i.tolerance_pen || 0) ? 'bad' : '' }, G.fmt.money(i.difference_pen)) },
      { key: 'status', label: 'Estado', render: i => st(i.status) }, { key: 'gas', label: 'GAS', value: i => i.expense_id ? 'Enviada' : '', render: i => i.expense_id ? badge('Gasto ' + ((G.db.get('expenses', i.expense_id) || {}).number || ''), 'ok') : i.status === 'RECONCILED' ? badge('Por enviar', 'warn') : '—' }],
      rows: invs, onRow: invoiceDrawer, filters: [{ key: 'status', label: 'Estado', options: [['PENDING', 'Pendiente'], ['RECONCILED', 'Conciliada'], ['OBSERVED', 'Observada']] }] }));
  }
  function invoiceDrawer(inv) {
    drawer('Factura ' + inv.invoice_number, (b, close) => {
      const acc = A.account(inv.account_id); const canRec = G.can('ads.invoice.reconcile');
      b.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' },
        canRec ? btn('Conciliar', () => { try { A.reconcile(inv); toast(inv.status === 'RECONCILED' ? 'Factura conciliada' : `RN-ADS-08: observada, diferencia ${G.fmt.money(inv.difference_pen)}`, inv.status === 'RECONCILED' ? 'ok' : 'warn'); close(); G.refresh(); } catch (e) { toast(e.message, 'bad'); } }, { kind: 'primary', sm: true }) : null,
        canRec && inv.status === 'RECONCILED' && !inv.expense_id ? btn('Enviar a GAS', () => { try { const e = A.sendInvoiceToGas(inv.id); toast(`Gasto ${e.number} creado en GAS`, 'ok'); close(); G.refresh(); } catch (e) { toast(e.message, 'bad'); } }, { sm: true, kind: 'accent' }) : null,
        canRec && inv.status === 'OBSERVED' ? btn('Agregar nota', () => { modal('Nota de la observación', bd => bd.appendChild(form({ id: 'ads-inv-note', values: { note: inv.note }, fields: [{ key: 'note', label: 'Nota', type: 'textarea', required: true }], submitLabel: 'Guardar', onSubmit: v => { G.db.update('ad_platform_invoices', inv.id, { note: v.note }); G.ui.closeAll(); toast('Nota guardada', 'ok'); G.refresh(); return true; } }))); }, { sm: true }) : null));
      if (inv.status === 'OBSERVED') b.appendChild(notice([h('b', null, 'RN-ADS-08: '), `diferencia ${G.fmt.money(inv.difference_pen)} supera la tolerancia de ${G.fmt.money(inv.tolerance_pen)}. `, inv.note || ''], 'warn'));
      b.appendChild(dl([['Cuenta', acc.name], ['Proveedor', G.supName(inv.supplier_id)], ['Documento', 'FOREIGN_INVOICE (D-ADS-04)'], ['Emisión', G.fmt.date(inv.issue_date)], ['Período', `${G.fmt.date(inv.period_from)} – ${G.fmt.date(inv.period_to)}`], ['Monto', inv.currency + ' ' + G.fmt.num(inv.amount, 2)], ['Tipo de cambio', G.fmt.num(inv.exchange_rate, 3) + (inv.currency !== 'PEN' ? ' (venta de la fecha de la factura, D-ADS-03)' : '')], ['En soles', G.fmt.money(inv.amount_pen)], ['Gasto importado', G.fmt.money(inv.imported_spend_pen)], ['Tolerancia', G.fmt.money(inv.tolerance_pen)], ['Diferencia', G.fmt.money(inv.difference_pen)], ['Estado', st(inv.status)], ['Conciliada por', inv.reconciled_by ? G.userName(inv.reconciled_by) + ' · ' + G.fmt.datetime(inv.reconciled_at) : '—'], ['Gasto en GAS', inv.expense_id ? (G.db.get('expenses', inv.expense_id) || {}).number : '—']]));
      const days = U.groupBy(G.db.where('ad_spend_daily', s => { const c = A.campaign(s.campaign_id); return c && c.account_id === acc.id && s.spend_date >= inv.period_from && s.spend_date <= inv.period_to; }), 'campaign_id');
      b.appendChild(card('Gasto importado por campaña', table({ id: 'ads-inv-c', search: false, columns: [{ key: 'c', label: 'Campaña', value: x => (A.campaign(x[0]) || {}).name }, { key: 'd', label: 'Días', align: 'r', value: x => new Set(x[1].map(s => s.spend_date)).size }, { key: 'cur', label: acc.currency, align: 'r', render: x => G.fmt.num(U.sum(x[1], s => s.spend), 2) }, { key: 'pen', label: 'Soles', align: 'r', render: x => G.fmt.money(U.sum(x[1], s => s.spend_pen)) }], rows: Object.entries(days) }), { flush: true }));
    }, { code: 'ADS-07', wide: true });
  }
  function invoiceForm() {
    if (!G.require('ads.invoice.reconcile', () => true)) return;
    drawer('Registrar factura de plataforma', (b, close) => {
      const accs = G.scope.filter(G.db.all('ad_accounts'));
      const prev = h('div', { class: 'muted small' });
      const upd = v => { const acc = A.account(v.account_id); if (!acc || !v.period_from || !v.period_to) return; const sp = A.importedSpend(acc.id, v.period_from, v.period_to); const rate = (v.currency || acc.currency) === 'PEN' ? 1 : A.fx(v.issue_date || G.TODAY, v.currency || acc.currency); const pen = R((Number(v.amount) || 0) * rate); const tol = Math.max(Number(G.param('ads_reconcile_tolerance_pen')) || 5, sp * (Number(G.param('ads_reconcile_tolerance_pct')) || 2) / 100); prev.textContent = `Gasto importado ${G.fmt.money(sp)} · factura en soles ${G.fmt.money(pen)} (TC ${G.fmt.num(rate, 3)}) · diferencia ${G.fmt.money(pen - sp)} · tolerancia ${G.fmt.money(tol)} → ${Math.abs(pen - sp) <= tol ? 'quedará CONCILIADA' : 'quedará OBSERVADA'}`; };
      const f = form({ id: 'ads-inv', values: { account_id: accs[0] && accs[0].id, currency: accs[0] && accs[0].currency, issue_date: G.TODAY, period_from: '2026-09-01', period_to: '2026-09-30' }, fields: [
        { key: 'account_id', label: 'Cuenta', type: 'select', options: accs.map(a => [a.id, a.name]), required: true, onChange: (v, vals, api) => { api.set('currency', A.account(v).currency); upd(vals); } },
        { key: 'invoice_number', label: 'Número de factura o recibo', type: 'text', required: true },
        { key: 'issue_date', label: 'Emisión', type: 'date', required: true, onChange: (v, vals) => upd(vals) },
        { key: 'currency', label: 'Moneda', type: 'select', options: [['PEN', 'PEN'], ['USD', 'USD']], required: true, onChange: (v, vals) => upd(vals) },
        { key: 'period_from', label: 'Período desde', type: 'date', required: true, onChange: (v, vals) => upd(vals) }, { key: 'period_to', label: 'Período hasta', type: 'date', required: true, onChange: (v, vals) => upd(vals) },
        { key: 'amount', label: 'Monto de la factura', type: 'money', required: true, min: 0, onChange: (v, vals) => upd(vals) },
        { key: 'note', label: 'Nota (si queda observada)', type: 'textarea' }],
        submitLabel: 'Registrar y conciliar', onCancel: close,
        onSubmit: v => { const inv = A.registerInvoice(v); close(); toast(inv.status === 'RECONCILED' ? `Factura conciliada y enviada a GAS` : `RN-ADS-08: factura observada, diferencia ${G.fmt.money(inv.difference_pen)}`, inv.status === 'RECONCILED' ? 'ok' : 'warn'); G.refresh(); return true; } });
      b.appendChild(f); b.appendChild(prev); upd(f.api.values);
    }, { code: 'ADS-07' });
  }

  function s08(el) {
    const body = G.ui.page(el, { code: 'ADS-08', title: 'Creadores de contenido', sub: 'Gastos de creadores (recibo por honorarios) por campaña y su peso en el costo de la campaña. Se registran en GAS con la campaña obligatoria (RN-ADS-10).', actions: G.canDo('GAS', 'C') || G.canDo('ADS', 'C') ? [{ label: 'Registrar gasto de creador', kind: 'primary', icon: '+', onClick: creatorForm }] : [] });
    body.appendChild(periodBar());
    const f = filt();
    const exps = A.creatorExpenses({ from: f.from, to: f.to, brand: f.brand, statuses: null }).filter(e => !f.brands || f.brands.includes(e.brand_id));
    const counted = exps.filter(e => ['APPROVED', 'PAID'].includes(e.status));
    const byCamp = U.groupBy(counted, 'ad_campaign_id');
    const res = A.results(Object.assign({}, f, { by: 'campaign' }));
    const rows = Object.entries(byCamp).map(([cid, es]) => { const r = res.find(x => x.key === cid) || { spend: 0, collected: 0 }; const cr = R(U.sum(es, e => e.amount_pen)); const tot = r.spend + cr; return { cid, camp: A.campaign(cid), creators: cr, spend: r.spend, total: R(tot), weight: tot ? R(cr / tot * 100, 1) : null, roasFull: tot ? R(r.collected / tot, 2) : null, n: es.length }; });
    body.appendChild(kpis([{ label: 'Costo de creadores', value: G.fmt.money(U.sum(counted, e => e.amount_pen)), sub: 'aprobados o pagados (KPI-ADS-07)' }, { label: 'Campañas con creadores', value: G.fmt.num(rows.length) }, { label: 'Pendientes de aprobar en GAS', value: G.fmt.num(exps.filter(e => !['APPROVED', 'PAID', 'REJECTED', 'VOIDED'].includes(e.status)).length), tone: 'warn' }]));
    body.appendChild(card('Peso en el costo de cada campaña', table({ id: 'ads-08c', search: false, columns: [{ key: 'c', label: 'Campaña', value: x => x.camp ? x.camp.name : x.cid }, { key: 'p', label: 'Plataforma', value: x => x.camp ? platName(x.camp.platform) : '' }, { key: 'creators', label: 'Creadores', align: 'r', render: x => G.fmt.money(x.creators) }, { key: 'spend', label: 'Inversión en anuncios', align: 'r', render: x => G.fmt.money(x.spend) }, { key: 'total', label: 'Costo total', align: 'r', render: x => G.fmt.money(x.total) }, { key: 'weight', label: 'Peso de creadores', align: 'r', render: x => G.fmt.pct(x.weight) }, { key: 'roasFull', label: 'Retorno con creadores', align: 'r', render: x => x.roasFull == null ? '—' : G.fmt.num(x.roasFull, 2) }], rows, empty: 'Sin gastos de creadores aprobados en el período.' }), { flush: true }));
    body.appendChild(table({ id: 'ads-08', columns: [{ key: 'number', label: 'Gasto', mono: true }, { key: 'issue_date', label: 'Fecha', render: e => G.fmt.date(e.issue_date) }, { key: 'sup', label: 'Creador', value: e => G.supName(e.supplier_id) }, { key: 'doc', label: 'Recibo por honorarios', value: e => `${e.doc_series || ''}-${e.doc_number || ''}` }, { key: 'camp', label: 'Campaña', value: e => (A.campaign(e.ad_campaign_id) || {}).name }, { key: 'description', label: 'Detalle' }, { key: 'amount_pen', label: 'Monto', align: 'r', render: e => G.fmt.money(e.amount_pen) }, { key: 'withholding_amount', label: 'Retención 4.ª', align: 'r', render: e => G.fmt.money(e.withholding_amount || 0) }, { key: 'status', label: 'Estado', render: e => st(e.status) }], rows: exps, filters: [{ key: 'status', label: 'Estado', options: [['SUBMITTED', 'Enviado'], ['APPROVED', 'Aprobado'], ['PAID', 'Pagado']] }] }));
  }
  function creatorForm() {
    drawer('Gasto de creador de contenido', (b, close) => {
      b.appendChild(notice('Se registra en GAS en la categoría de creadores con recibo por honorarios y campaña obligatoria; suma al costo de la campaña cuando GAS lo aprueba (RN-ADS-10).', 'info'));
      b.appendChild(form({ id: 'ads-cr', values: { issue_date: G.TODAY }, fields: [
        { key: 'supplier_id', label: 'Creador', type: 'select', options: G.ui.opts('suppliers', s => s.trade_name + ' · ' + s.legal_name, s => s.supplier_type === 'CONTENT_CREATOR'), required: true },
        { key: 'ad_campaign_id', label: 'Campaña', type: 'select', options: G.scope.filter(G.db.all('ad_campaigns')).map(c => [c.id, c.name + ' · ' + platName(c.platform)]) },
        { key: 'doc_number', label: 'Número del recibo (E001-…)', type: 'text', required: true }, { key: 'issue_date', label: 'Fecha', type: 'date', required: true },
        { key: 'amount', label: 'Monto (S/)', type: 'money', required: true, min: 0.01, help: 'Sobre S/ 1500 se retiene 8 % de 4.ª categoría' }, { key: 'description', label: 'Contenido entregado', type: 'textarea' }],
        submitLabel: 'Enviar a GAS', onCancel: close,
        onSubmit: v => { const e = A.registerCreatorExpense(v); close(); toast(`Gasto ${e.number} enviado a aprobación en GAS`, 'ok'); G.refresh(); return true; } }));
    }, { code: 'ADS-08' });
  }

  function s09(el) {
    const body = G.ui.page(el, { code: 'ADS-09', title: 'Comparativo de plataformas', sub: 'Google, Meta y TikTok lado a lado: inversión, ventas cobradas, retorno, inversión sobre ventas y porcentaje de leads por anuncios de clic a WhatsApp.' });
    if (!resultsGate(body)) return;
    body.appendChild(periodBar());
    const f = filt();
    const res = A.results(Object.assign({}, f, { by: 'platform' }));
    const coll = A.collectedTotal(f);
    const leads = G.db.where('ad_attributions', x => x.lead_origin && inRange(x.lead_at || x.attributed_at, f.from, f.to) && (!f.brand || x.brand_id === f.brand));
    const rows = PLAT.map(([p, n]) => { const r = res.find(x => x.key === p) || { spend: 0, leads: 0, orders: 0, newCust: 0, collected: 0 }; const pl = leads.filter(x => x.platform === p); return { p, n, r, share: coll ? R(r.spend / coll * 100, 2) : null, ctwa: pl.length ? R(pl.filter(x => x.method === 'CTWA_REFERRAL').length / pl.length * 100, 1) : null }; });
    const tot = A.total(f);
    body.appendChild(kpis([{ label: 'Inversión total', value: G.fmt.money(tot.spend) }, { label: 'Ventas cobradas del período', value: G.fmt.money(coll), sub: 'todas las ventas, no solo atribuidas' }, { label: 'Inversión sobre ventas', value: G.fmt.pct(coll ? tot.spend / coll * 100 : null, 2), sub: 'RN-ADS-11 · KPI-ADS-06' }, { label: 'Leads por clic a WhatsApp', value: G.fmt.pct(leads.length ? leads.filter(x => x.method === 'CTWA_REFERRAL').length / leads.length * 100 : null), sub: 'KPI-ADS-09 · D-ADS-01' }]));
    body.appendChild(h('div', { class: 'grid c3' }, rows.map(x => card(x.n, dl([['Inversión', G.fmt.money(x.r.spend)], ['Leads', G.fmt.num(x.r.leads)], ['Pedidos', G.fmt.num(x.r.orders)], ['Clientes nuevos', G.fmt.num(x.r.newCust)], ['Ventas cobradas atribuidas', G.fmt.money(x.r.collected)], ['Retorno', x.r.spend ? h('b', null, G.fmt.num(x.r.collected / x.r.spend, 2)) : '—'], ['Costo por pedido', x.r.orders ? G.fmt.money(x.r.spend / x.r.orders) : '—'], ['Costo por cliente nuevo', x.r.newCust ? G.fmt.money(x.r.spend / x.r.newCust) : '—'], ['Inversión sobre ventas', G.fmt.pct(x.share, 2)], ['Leads de clic a WhatsApp', G.fmt.pct(x.ctwa)]])))));
    body.appendChild(h('div', { class: 'grid c2' },
      card('Inversión y cobrado por plataforma', G.ui.chart.bar({ labels: rows.map(x => x.n), series: [{ name: 'Inversión', values: rows.map(x => x.r.spend) }, { name: 'Cobrado atribuido', values: rows.map(x => x.r.collected) }], format: v => G.fmt.money(v) })),
      card('Retorno por marca y plataforma', (() => { const bb = G.scope.brands().filter(b => !f.brand || b.id === f.brand); const by = A.results(Object.assign({}, f, { by: 'ad' })); const m = {}; for (const r of by) { const ad = G.db.get('ad_ads', r.key); if (!ad) continue; const k = ad.brand_id + '|' + ad.platform; m[k] = m[k] || { s: 0, c: 0 }; m[k].s += r.spend; m[k].c += r.collected; } return table({ id: 'ads-09b', search: false, columns: [{ key: 'b', label: 'Marca', value: b => G.brandName(b.id) }].concat(PLAT.map(([p, n]) => ({ key: p, label: n, align: 'r', render: b => { const v = m[b.id + '|' + p]; return v && v.s ? badge(G.fmt.num(v.c / v.s, 2), roasTone(v.c / v.s)) : '—'; } }))), rows: bb }); })())));
  }

  G.register({ code: 'ADS', name: 'Publicidad y atribución', phase: 1, group: 'Atención y marketing', screens: [
    { code: 'ADS-01', name: 'Cuentas publicitarias', render: s01 },
    { code: 'ADS-02', name: 'Campañas y anuncios', render: s02 },
    { code: 'ADS-03', name: 'Enlaces de rastreo', render: s03 },
    { code: 'ADS-04', name: 'Importaciones', render: s04 },
    { code: 'ADS-05', name: 'Resultados por anuncio', render: s05 },
    { code: 'ADS-06', name: 'Embudo de atribución', render: s06 },
    { code: 'ADS-07', name: 'Facturas de plataformas', render: s07 },
    { code: 'ADS-08', name: 'Creadores de contenido', render: s08 },
    { code: 'ADS-09', name: 'Comparativo de plataformas', render: s09 },
  ] });

  /* ---------- ganchos globales ---------- */
  G.searchProviders.push(q => { const s = q.toUpperCase(); return A.ads().filter(a => (a.tracking_code || '').includes(s) || (a.code || '').includes(s) || a.name.toUpperCase().includes(s)).slice(0, 5).map(a => ({ label: `${a.tracking_code || a.code} · ${a.name}`, sub: `Anuncio ${platName(a.platform)} · ${G.brandName(a.brand_id)}`, go: () => G.go('ADS-02', { ad: a.id }) })); });
  G.scanHandlers.push(code => { const a = CODE_RE.test(code) ? A.adByCode(code) : null; return a ? () => G.go('ADS-02', { ad: a.id }) : null; });
  G.alertProviders.push(() => {
    if (!G.canSee('ADS')) return [];
    const out = []; const u = A.untracked().filter(a => G.scope.ok(a));
    if (u.length) out.push({ module: 'ADS', title: `${u.length} anuncio(s) activo(s) sin rastreo`, detail: 'RN-ADS-03: no cuentan para el retorno por anuncio.', tone: 'warn', go: () => G.go('ADS-02') });
    const f = G.db.where('ad_import_runs', r => r.status === 'FAILED' && r.started_at.slice(0, 10) === G.TODAY);
    if (f.length) out.push({ module: 'ADS', title: `Importación de gasto fallida (${f.length})`, detail: f.map(r => (A.account(r.account_id) || {}).name).join(', '), tone: 'bad', go: () => G.go('ADS-04') });
    const ob = G.db.where('ad_platform_invoices', i => i.status === 'OBSERVED');
    if (ob.length) out.push({ module: 'ADS', title: `${ob.length} factura(s) de plataforma observada(s)`, detail: 'RN-ADS-08: diferencia mayor a la tolerancia.', tone: 'warn', go: () => G.go('ADS-07') });
    return out;
  });

  /* ------------------------------------------------------------------
     Pruebas CA-ADS-01 a 07 (llaman a las funciones de dominio)
     ------------------------------------------------------------------ */
  const eq = (a, b, msg, tol = 0.005) => { if (a == null || Math.abs(a - b) > tol) throw new Error(`${msg}: esperado ${b}, obtenido ${a}`); };
  /** escenario del CA-ADS-01 en la empresa de prueba CS (aislada): anuncio DG-G01 con S/ 500, 25 leads, 10 pedidos (6 nuevos), S/ 1500 cobrados */
  function fixtureCA01() {
    G.ctx.tenant = 'CS';
    const acc = G.db.insert('ad_accounts', { platform: 'GOOGLE', brand_id: 'br-CS', name: 'Google Ads · prueba', external_id: 'GO-TEST-1', currency: 'PEN', timezone: 'America/Lima', status: 'ACTIVE' }, { silent: true });
    const camp = G.db.insert('ad_campaigns', { account_id: acc.id, brand_id: 'br-CS', platform: 'GOOGLE', code: 'CS-GO-SRCH', name: 'Búsqueda prueba', status: 'ACTIVE' }, { silent: true });
    const ad = G.db.insert('ad_ads', { campaign_id: camp.id, brand_id: 'br-CS', platform: 'GOOGLE', code: 'CSGSR1', name: 'Anuncio DG-G01 (prueba)', destination: 'WHATSAPP', tracking_code: 'DG-G01', status: 'ACTIVE' }, { silent: true });
    for (let i = 0; i < 10; i++) A.importDay({ account_id: acc.id, date: G.date.add('2026-09-01', i * 3), rows: [{ campaign_id: camp.id, ad_id: ad.id, spend: 50 }] });
    for (let i = 0; i < 15; i++) A.attributeLead({ customer_id: null, phone: '+5195000' + U.pad(i, 4), first_message: 'Hola, vi el anuncio dg-g01', at: '2026-09-' + U.pad(2 + i, 2) + 'T10:00' });
    const pays = [];
    for (let i = 0; i < 10; i++) {
      const cust = 'cu-CS' + (i < 6 ? i + 1 : (i % 3) + 7);
      if (i >= 6) G.db.insert('sales_orders', { number: 'P-CSX' + i, brand_id: 'br-CS', establishment_id: 'es-CS1', channel: 'WHATSAPP', customer_id: cust, status: 'CLOSED', created_at: '2026-08-15T10:00', final_total: 100, lines: [] }, { silent: true }); // compras previas: no son clientes nuevos
      const o = G.db.insert('sales_orders', { number: 'P-CS' + U.pad(i, 4), brand_id: 'br-CS', establishment_id: 'es-CS1', channel: 'WHATSAPP', customer_id: cust, status: 'CLOSED', created_at: '2026-09-' + U.pad(5 + i * 2, 2) + 'T11:00', final_total: 150, estimated_total: 150, origin_ad_code: 'DG-G01', lines: [] }, { silent: true });
      A.attributeOrder(o);
      pays.push(G.db.insert('payments', { number: 'CB-CS' + i, customer_id: cust, payment_method_id: 'pm-YAPE', cash_account_id: 'ca-YAPE', amount: 150, paid_at: o.created_at, reference: 'OP' + (900000 + i), status: 'CONFIRMED', brand_id: 'br-CS', establishment_id: 'es-CS1', allocations: [{ order_id: o.id, document_id: null, amount: 150 }] }, { silent: true }));
    }
    return { acc, camp, ad, pays };
  }
  G.tests.push({ module: 'ADS', name: 'CA-ADS-01: DG-G01 con S/ 500, 25 leads, 10 pedidos (6 nuevos) y S/ 1500 cobrados → S/ 20,00; 50,00; 83,33; retorno 3,00', fn: async () => {
    try { const { ad } = fixtureCA01(); const r = A.total({ ad_id: ad.id, from: '2026-09-01', to: '2026-09-30' });
      eq(r.spend, 500, 'inversión'); eq(r.leads, 25, 'leads'); eq(r.orders, 10, 'pedidos'); eq(r.newCust, 6, 'clientes nuevos'); eq(r.collected, 1500, 'cobrado');
      eq(r.cpl, 20, 'costo por lead'); eq(r.cpo, 50, 'costo por pedido'); eq(r.cpn, 83.33, 'costo por cliente nuevo'); eq(r.roas, 3, 'retorno');
    } finally { G.ctx.tenant = 'DG'; }
  } });
  G.tests.push({ module: 'ADS', name: 'CA-ADS-02: reimportar un día de S/ 120 ajustado a S/ 118 deja una sola fila con S/ 118', fn: async () => {
    const camp = G.db.get('ad_campaigns', 'ac-DG-GOOGLE-SRCH'); const ad = G.db.get('ad_ads', 'ad-DG-GOOGLE-SRCH-1');
    A.importDay({ account_id: camp.account_id, date: '2026-08-20', rows: [{ campaign_id: camp.id, ad_id: ad.id, spend: 120 }] });
    const r = A.importDay({ account_id: camp.account_id, date: '2026-08-20', rows: [{ campaign_id: camp.id, ad_id: ad.id, spend: 118 }] });
    const rows = G.db.where('ad_spend_daily', s => s.campaign_id === camp.id && s.ad_id === ad.id && s.spend_date === '2026-08-20');
    if (rows.length !== 1) throw new Error('Se esperaba una sola fila y hay ' + rows.length);
    eq(rows[0].spend_pen, 118, 'gasto del día'); if (r.upserted !== 1) throw new Error('La reimportación debía actualizar 1 fila');
  } });
  G.tests.push({ module: 'ADS', name: 'CA-ADS-03: gasto Meta de S/ 3000 en agosto: factura S/ 3020 conciliada (tolerancia S/ 60); S/ 3100 observada con S/ 100', fn: async () => {
    const acc = G.db.get('ad_accounts', 'aa-DG-META'); const camp = G.db.get('ad_campaigns', 'ac-DG-META-CTWA'); const ad = G.db.get('ad_ads', 'ad-DG-META-CTWA-1');
    for (let i = 0; i < 30; i++) A.importDay({ account_id: acc.id, date: G.date.add('2026-08-01', i), rows: [{ campaign_id: camp.id, ad_id: ad.id, spend: 100 }], exchange_rate: 1 });
    eq(A.importedSpend(acc.id, '2026-08-01', '2026-08-31'), 3000, 'gasto importado de agosto');
    const ok = A.registerInvoice({ account_id: acc.id, invoice_number: 'FBADS-AGO-1', issue_date: '2026-09-03', period_from: '2026-08-01', period_to: '2026-08-31', currency: 'PEN', amount: 3020, sendToGas: false });
    if (ok.status !== 'RECONCILED') throw new Error('S/ 3020 debía quedar conciliada y quedó ' + ok.status); eq(ok.tolerance_pen, 60, 'tolerancia');
    const bad = A.registerInvoice({ account_id: acc.id, invoice_number: 'FBADS-AGO-2', issue_date: '2026-09-03', period_from: '2026-08-01', period_to: '2026-08-31', currency: 'PEN', amount: 3100, sendToGas: false });
    if (bad.status !== 'OBSERVED') throw new Error('S/ 3100 debía quedar observada'); eq(bad.difference_pen, 100, 'diferencia');
    const e = A.sendInvoiceToGas(ok.id); if (!e || ok.expense_id !== e.id) throw new Error('La factura conciliada no pasó a GAS');
  } });
  G.tests.push({ module: 'ADS', name: 'CA-ADS-04: clic a WhatsApp con el código de otro anuncio → gana el referral (CTWA_REFERRAL)', fn: async () => {
    const ctwa = A.adByCode('DG-C01'); const other = A.adByCode('DG-G01');
    const r = A.attributeLead({ referral_ad_id: ctwa.id, first_message: 'Hola, vi el anuncio ' + other.tracking_code, phone: '+51955000111' });
    if (r.method !== 'CTWA_REFERRAL' || r.ad_id !== ctwa.id) throw new Error(`Se esperaba CTWA_REFERRAL con ${ctwa.tracking_code} y salió ${r.method} con ${A.adLabel(G.db.get('ad_ads', r.ad_id))}`);
    const r2 = A.attributeLead({ first_message: 'hola vi el anuncio ' + other.tracking_code.toLowerCase() });
    if (r2.method !== 'TRACKING_CODE' || r2.ad_id !== other.id) throw new Error('Sin referral debía ganar el código (sin importar mayúsculas)');
  } });
  G.tests.push({ module: 'ADS', name: 'CA-ADS-05: se revierte un cobro Yape de S/ 150 → cobrado S/ 1350 y retorno 2,70', fn: async () => {
    try { const { ad, pays } = fixtureCA01(); A.reversePayment(pays[0].id, 'Yape devuelto por el banco');
      const r = A.total({ ad_id: ad.id, from: '2026-09-01', to: '2026-09-30' }); eq(r.collected, 1350, 'cobrado'); eq(r.roas, 2.7, 'retorno');
    } finally { G.ctx.tenant = 'DG'; }
  } });
  G.tests.push({ module: 'ADS', name: 'CA-ADS-06: TikTok en dólares, USD 100 con TC 3,80 → S/ 380', fn: async () => {
    const acc = G.db.get('ad_accounts', 'aa-DG-TIKTOK'); const camp = G.db.get('ad_campaigns', 'ac-DG-TIKTOK-VID'); const ad = G.db.get('ad_ads', 'ad-DG-TIKTOK-VID-1');
    if (acc.currency !== 'USD') throw new Error('La cuenta de TikTok debía estar en USD');
    const fx = G.db.find('exchange_rates', x => x.date === '2026-08-25'); G.db.update('exchange_rates', fx.id, { sell: 3.8 }, { silent: true });
    A.importDay({ account_id: acc.id, date: '2026-08-25', rows: [{ campaign_id: camp.id, ad_id: ad.id, spend: 100 }] });
    const row = G.db.find('ad_spend_daily', s => s.ad_id === ad.id && s.spend_date === '2026-08-25');
    eq(row.exchange_rate, 3.8, 'tipo de cambio'); eq(row.spend_pen, 380, 'gasto en soles');
  } });
  G.tests.push({ module: 'ADS', name: 'CA-ADS-07: pedido sin código con lead de hace 10 días a DG-C01 → heredado del lead; con 40 días queda sin atribución', fn: async () => {
    const c01 = A.adByCode('DG-C01');
    const mk = (id, ph) => G.db.insert('customers', { id, doc_type: 'NONE', full_name: 'Cliente prueba ' + id, phone: ph, customer_type: 'PERSON', status: 'ACTIVE' }, { silent: true });
    mk('cu-T-ADS1', '+51966000001'); mk('cu-T-ADS2', '+51966000002');
    A.attributeLead({ customer_id: 'cu-T-ADS1', referral_ad_id: c01.id, at: G.date.add(G.TODAY, -10) + 'T09:00' });
    A.attributeLead({ customer_id: 'cu-T-ADS2', referral_ad_id: c01.id, at: G.date.add(G.TODAY, -40) + 'T09:00' });
    const o1 = G.orders.create({ customer_id: 'cu-T-ADS1', brand_id: 'br-DG', channel: 'WHATSAPP', fulfillment: 'PICKUP', lines: [{ variant_id: 'va-DG-CAL-1L', qty: 1 }] });
    const o2 = G.orders.create({ customer_id: 'cu-T-ADS2', brand_id: 'br-DG', channel: 'WHATSAPP', fulfillment: 'PICKUP', lines: [{ variant_id: 'va-DG-CAL-1L', qty: 1 }] });
    const a1 = G.db.find('ad_attributions', x => x.order_id === o1.id) || A.attributeOrder(o1);
    const a2 = G.db.find('ad_attributions', x => x.order_id === o2.id) || A.attributeOrder(o2);
    if (!a1 || a1.method !== 'INHERITED_FROM_LEAD' || a1.ad_id !== c01.id) throw new Error('El pedido 1 debía heredar DG-C01 del lead y quedó ' + (a1 ? a1.method : 'sin fila'));
    if (a2 && a2.method !== 'NONE') throw new Error('El pedido 2 (lead de 40 días) debía quedar sin atribución y quedó ' + a2.method);
  } });
})();
