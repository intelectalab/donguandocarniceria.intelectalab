/* =====================================================================
   INT · Integraciones (INT-01 … INT-13)
   Conectores por proveedor y entorno con adaptador falso para desarrollo,
   credenciales cifradas (solo ••••1234), webhooks firmados con HMAC-SHA256
   y deduplicados, outbox con reintentos exponenciales y cola muerta,
   claves de idempotencia, corridas programadas, notificaciones internas
   con preferencias y archivos adjuntos con enlaces temporales.
   Expone G.int: enqueue, dispatch, runOutbox, retryDead, cancelDead,
   receiveWebhook, sign, idempotent, notify, attach, fileLink, deleteFile,
   attachmentsPanel, connectorReport, credentialsExpiring, adapterFor,
   sha256, hmac, runJob, credentialView.
   ===================================================================== */
(function () {
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, modal, form, toast, tabs, pills, chart } = G.ui;
  const U = G.util, F = G.fmt, D = G.db;
  const R = (n, d = 2) => U.round(n, d);

  /* ---------- SHA-256 y HMAC (sincrónicos, sin dependencias) ---------- */
  const K256 = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  const utf8 = s => new TextEncoder().encode(String(s));
  function sha256Bytes(msg) {
    const bytes = msg instanceof Uint8Array ? msg : msg instanceof ArrayBuffer ? new Uint8Array(msg) : utf8(msg);
    const l = bytes.length, nb = ((l + 9 + 63) >> 6) << 6; const m = new Uint8Array(nb); m.set(bytes); m[l] = 0x80;
    const bits = l * 8; const dv = new DataView(m.buffer); dv.setUint32(nb - 4, bits >>> 0); dv.setUint32(nb - 8, Math.floor(bits / 4294967296));
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]); const W = new Uint32Array(64);
    const rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < nb; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) { const s0 = rot(W[i - 15], 7) ^ rot(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = rot(W[i - 2], 17) ^ rot(W[i - 2], 19) ^ (W[i - 2] >>> 10); W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0; }
      let [a, b, c, d, e, f, g, hh] = H;
      for (let i = 0; i < 64; i++) { const S1 = rot(e, 6) ^ rot(e, 11) ^ rot(e, 25), ch = (e & f) ^ (~e & g), t1 = (hh + S1 + ch + K256[i] + W[i]) | 0, S0 = rot(a, 2) ^ rot(a, 13) ^ rot(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) | 0; hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0; }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += hh;
    }
    const out = new Uint8Array(32); const ov = new DataView(out.buffer); for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]); return out;
  }
  const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  const sha256 = m => hex(sha256Bytes(m));
  function hmac(key, msg) {
    let k = utf8(key); if (k.length > 64) k = sha256Bytes(k);
    const kp = new Uint8Array(64); kp.set(k); const ip = kp.map(x => x ^ 0x36), op = kp.map(x => x ^ 0x5c);
    const mb = utf8(msg); const inner = new Uint8Array(64 + mb.length); inner.set(ip); inner.set(mb, 64);
    const ih = sha256Bytes(inner); const outer = new Uint8Array(96); outer.set(op); outer.set(ih, 64);
    return hex(sha256Bytes(outer));
  }
  /* ---------- cifrado de secretos (RN-INT-02): la clave maestra vive fuera de la base (KMS, D-INT-02) ---------- */
  const MASTER = 'kms://aycha-prod/donguando/master-key-v1';
  const b64e = bytes => btoa(String.fromCharCode(...bytes));
  const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const xorKey = bytes => { const k = utf8(MASTER); return bytes.map((x, i) => x ^ k[i % k.length]); };
  const enc = secret => 'enc:v1:' + b64e(xorKey(utf8(secret)));
  const dec = s => { if (!s || !String(s).startsWith('enc:v1:')) return ''; return new TextDecoder().decode(xorKey(b64d(String(s).slice(7)))); };
  const mask = last4 => '••••' + (last4 || '????');
  // Sin AUD en el build: enmascarado mínimo de secretos en la auditoría (RN-INT-02 / RN-AUD-07)
  if (!G.aud) { const orig = G.audit; const scrub = v => v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, /secret|token|password|pwd_hash|totp|api_key/i.test(k) || /^enc:v\d+:/.test(String(x)) ? '***' : x])) : v; G.audit = (a, e, id, d, b, af) => orig(a, e, id, String(d || '').replace(/enc:v\d+:[A-Za-z0-9+/=]+/g, '***'), scrub(b), scrub(af)); }

  /* ---------- catálogos ---------- */
  const KINDS = [['MESSAGING', 'Mensajería', 'MessagingProvider'], ['EINVOICE', 'Comprobantes (OSE/PSE)', 'EInvoiceProvider'], ['PAYMENTS', 'Pagos', 'PaymentGateway'], ['ADS', 'Anuncios', 'AdsProvider'], ['TELEPHONY', 'Telefonía', 'TelephonyProvider'], ['MAPS', 'Mapas', 'MapsProvider'], ['COMMERCE', 'Comercio electrónico', 'CommerceProvider'], ['SCALE', 'Balanzas', 'ScaleProvider'], ['DELIVERY', 'Empresas de delivery', 'DeliveryProvider'], ['GPS', 'GPS de flota', 'TrackingProvider'], ['FARM', 'Granja', 'FarmProvider'], ['HR', 'Personal (Ayni HR)', 'HrProvider'], ['EMAIL', 'Correo', 'EmailProvider'], ['PUSH', 'Push', 'PushProvider'], ['FX', 'Tipo de cambio', 'FxProvider']];
  const kindName = k => (KINDS.find(x => x[0] === k) || [k, k])[1];
  const IFACE = Object.fromEntries(KINDS.map(k => [k[0], k[2]]));
  const ST = { ACTIVE: ['Activo', 'ok'], ERROR: ['En error', 'bad'], DISABLED: ['Desactivado', ''], PENDING: ['Por configurar', 'warn'], RECEIVED: ['Recibido', 'info'], PROCESSED: ['Procesado', 'ok'], FAILED: ['Fallido', 'bad'], REJECTED: ['Rechazado', 'bad'], IGNORED: ['Ignorado', ''], SENT: ['Enviado', 'ok'], RETRYING: ['Reintentando', 'warn'], DEAD: ['Cola muerta', 'bad'], CANCELLED: ['Cancelado', ''], QUEUED: ['En cola', 'info'], REVOKED: ['Revocada', ''], EXPIRED: ['Vencida', 'bad'], COMPLETED: ['Completada', 'ok'], PARTIAL: ['Parcial', 'warn'], RUNNING: ['En curso', 'info'], IN_PROGRESS: ['En proceso', 'info'], DELETED: ['Eliminado', ''] };
  const st = s => badge((ST[s] || [s])[0], (ST[s] || [, ''])[1]);
  const SEV = { CRITICAL: ['Crítica', 'bad'], WARNING: ['Advertencia', 'warn'], INFO: ['Información', 'info'], OK: ['Correcto', 'ok'] };
  const sevOfTone = t => ({ bad: 'CRITICAL', warn: 'WARNING', ok: 'OK' })[t] || 'INFO';
  const sevBadge = s => badge((SEV[s] || [s])[0], (SEV[s] || [, ''])[1]);
  const NOTIF_TYPES = [['ORDERS', 'Pedidos y entregas'], ['STOCK', 'Stock y vencimientos'], ['DOCUMENTS', 'Comprobantes y SUNAT'], ['PAYMENTS', 'Cobros y conciliación'], ['APPROVALS', 'Aprobaciones pendientes'], ['INTEGRATIONS', 'Integraciones'], ['SECURITY', 'Seguridad y accesos'], ['EXPORTS', 'Exportaciones'], ['CRITICAL', 'Avisos críticos']];
  const typeName = t => (NOTIF_TYPES.find(x => x[0] === t) || [t, t || 'General'])[1];
  const CLASSES = [['PUBLIC', 'Público'], ['INTERNAL', 'Interno'], ['CONFIDENTIAL', 'Confidencial'], ['PERSONAL_DATA', 'Datos personales']];
  const className = c => (CLASSES.find(x => x[0] === c) || [c, c])[1];
  const JOBS = { FX_DAILY: 'Tipo de cambio SUNAT', ADS_SPEND_IMPORT: 'Gasto de anuncios', WOO_CATALOG_SYNC: 'Catálogo a WooCommerce', WOO_STOCK_SYNC: 'Stock a WooCommerce', GRJ_LOTS_SYNC: 'Lotes de la granja', OSE_STATUS_POLL: 'Estado de comprobantes en el OSE' };
  const HOST = 'https://donguando.aycha.pe';

  /* ---------- tiempo ---------- */
  const toDate = s => new Date(String(s).length <= 16 ? String(s).slice(0, 16) + ':00Z' : String(s).slice(0, 19) + 'Z');
  const addSec = (s, n) => new Date(toDate(s).getTime() + n * 1000).toISOString().slice(0, 19);
  const secs = (a, b) => (toDate(a) - toDate(b)) / 1000;
  const p95 = arr => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; };
  const fmtSec = s => s >= 3600 ? F.num(s / 3600, 1) + ' h' : s >= 60 ? F.num(s / 60, s % 60 ? 1 : 0) + ' min' : F.num(s, s < 10 && s % 1 ? 1 : 0) + ' s';

  const accessLog = (event, o = {}) => {
    if (G.aud && G.aud.log) return G.aud.log(event, o);
    D.insert('access_log', Object.assign({ at: G.date.now(), user_id: G.ctx.userId(), user_name: G.ctx.userName(), role: G.ctx.role, event, ip: '181.65.12.40', device: 'Navegador web', result: 'OK' }, o), { silent: true });
  };
  const conn = id => D.get('integration_connectors', id) || D.find('integration_connectors', c => c.code === id);
  const connName = id => { const c = conn(id); return c ? c.name : '—'; };
  const ownerOn = c => !c || !c.owner_module || !G.SPEC[c.owner_module] || G.modOn(c.owner_module);

  /* ---------- adaptadores: interfaz única por proveedor y adaptador falso (RN-INT-01) ---------- */
  const effects = {}; // efectos registrados por el proveedor falso, por clave de idempotencia (RN-INT-11)
  const FAKES = {
    MessagingProvider: { send: p => ({ ok: true, provider_id: 'wamid.FAKE.' + sha256(JSON.stringify(p)).slice(0, 16) }), templates: () => ['confirmacion_pedido', 'pedido_en_camino', 'diferencia_de_peso'] },
    EInvoiceProvider: { send: doc => ({ ok: true, status: 'ACCEPTED', cdr_code: '0', message: `La ${doc && doc.full_number ? doc.full_number : 'boleta'} ha sido aceptada (OSE de prueba)` }), status: () => ({ ok: true, status: 'ACCEPTED' }) },
    PaymentGateway: { getPayment: id => ({ ok: true, id, status: 'approved' }), createPreference: o => ({ ok: true, init_point: 'https://sandbox.mercadopago.com.pe/checkout/' + sha256(JSON.stringify(o)).slice(0, 12) }) },
    AdsProvider: { spend: ({ day }) => ({ ok: true, rows: 3, day }) },
    TelephonyProvider: { call: to => ({ ok: true, call_id: 'CA-FAKE-' + String(to).slice(-4) }) },
    MapsProvider: { geocode: a => { const z = G.db.find('delivery_zones', x => !x.province && (x.districts || []).some(d => String(a).toLowerCase().includes(d.toLowerCase()))); return { ok: !!z, lat: z ? z.lat : null, lng: z ? z.lng : null, zone_id: z ? z.id : null }; } },
    CommerceProvider: { pushStock: items => ({ ok: true, updated: items.length }), pushCatalog: items => ({ ok: true, updated: items.length }) },
    ScaleProvider: { read: () => ({ ok: true, kg: 1.25, stable: true }) },
    DeliveryProvider: { quote: km => ({ ok: true, fee: R(6 + km * 1.2) }) },
    TrackingProvider: { position: plate => ({ ok: true, plate, lat: -12.13, lng: -76.99 }) },
    FarmProvider: { lots: () => ({ ok: true, lots: 2 }) },
    HrProvider: { employees: () => ({ ok: true, count: G.db.all('employees').length }) },
    EmailProvider: { send: () => ({ ok: true }) }, PushProvider: { send: () => ({ ok: true }) },
    FxProvider: { rate: date => ({ ok: true, date }) },
  };
  const REAL = { MESSAGING: 'WhatsAppCloudAdapter', EINVOICE: 'OsePseAdapter', PAYMENTS: 'MercadoPagoAdapter', ADS: 'AdsApiAdapter', TELEPHONY: 'TwilioAdapter', MAPS: 'GoogleMapsAdapter', COMMERCE: 'WooCommerceRestAdapter', SCALE: 'SerialScaleAdapter', DELIVERY: 'DeliveryCompanyAdapter', GPS: 'GpsTrackerAdapter', FARM: 'GranjaApiAdapter', HR: 'AyniHrAdapter', EMAIL: 'SmtpAdapter', PUSH: 'FcmAdapter', FX: 'SunatFxAdapter' };

  /* =====================================================================
     Dominio
     ===================================================================== */
  const I = G.int = {
    ENV: 'PRODUCTION', sha256, hmac, FAKES,
    /** adaptador de una interfaz: en SANDBOX (pruebas, CI sin internet) siempre el falso; FAKE nunca en producción */
    adapterFor(iface, env = I.ENV, adapter) {
      if (!FAKES[iface]) G.fail('RN-INT-01', `La interfaz ${iface} no existe.`);
      if (env === 'PRODUCTION' && adapter === 'FAKE') G.fail('RN-INT-01', 'El adaptador falso solo existe en el entorno de prueba (SANDBOX), nunca en producción.');
      if (env === 'SANDBOX' || adapter === 'FAKE') return Object.assign({ name: 'Fake' + iface, fake: true, online: false }, FAKES[iface]);
      const kind = (KINDS.find(k => k[2] === iface) || [])[0];
      return Object.assign({ name: REAL[kind] || iface, fake: false, online: true }, FAKES[iface]);
    },
    /** RN-INT-19: resultado de una llamada al proveedor */
    connectorReport(id, ok, error, latency) {
      const c = conn(id); if (!c) return null;
      const at = G.date.now();
      if (ok) {
        const was = c.status;
        D.update('integration_connectors', c.id, { consecutive_failures: 0, last_ok_at: at, status: c.status === 'ERROR' ? 'ACTIVE' : c.status, latency_ms: latency || c.latency_ms }, { silent: true });
        if (was === 'ERROR') { G.events.emit('connector.recovered', { connector_id: c.id }); I.notify({ role: 'ADMIN_SISTEMA', type: 'INTEGRATIONS', severity: 'OK', title: `${c.name} volvió a conectar`, body: 'La conexión respondió correctamente y el conector pasó a Activo (RN-INT-19).', ref: { screen: 'INT-02', params: { id: c.id } }, module: 'INT' }); }
      } else {
        const n = (c.consecutive_failures || 0) + 1; const th = G.param('int_connector_error_threshold') ?? 3;
        const errs = (c.errors || []).concat([{ at, msg: error || 'Error del proveedor' }]).slice(-30);
        const toError = n >= th && c.status === 'ACTIVE';
        D.update('integration_connectors', c.id, { consecutive_failures: n, last_error_at: at, last_error: error, errors: errs, status: toError ? 'ERROR' : c.status }, { silent: true });
        if (toError) { G.events.emit('connector.failed', { connector_id: c.id, failures: n }); I.notify({ role: 'ADMIN_SISTEMA', type: 'INTEGRATIONS', severity: 'CRITICAL', title: `${c.name} en error`, body: `${n} fallos seguidos: ${error}. Revisa la conexión (RN-INT-19).`, ref: { screen: 'INT-02', params: { id: c.id } }, module: 'INT' }); }
      }
      return conn(c.id);
    },
    testConnection(id) {
      const c = conn(id);
      if (c.status === 'DISABLED') G.fail('RN-INT-14', `${c.name} está desactivado${ownerOn(c) ? '' : ` porque el módulo ${c.owner_module} está apagado (RN-PLT-07)`}.`);
      const ad = I.adapterFor(c.interface, c.environment, c.adapter);
      const lat = 120 + (sha256(c.id + G.date.now()).charCodeAt(0) % 9) * 37;
      if (c.simulate_down) { I.connectorReport(c.id, false, 'HTTP 503 Service Unavailable: el proveedor no respondió'); return { ok: false, adapter: ad.name, msg: 'El proveedor no respondió (HTTP 503).' }; }
      I.connectorReport(c.id, true, null, lat);
      return { ok: true, adapter: ad.name, latency: lat, msg: `Conexión correcta con ${ad.name}${ad.fake ? ' (adaptador falso, sin internet)' : ''} en ${lat} ms.` };
    },
    /* ---------- credenciales (RN-INT-02, RN-INT-03, RN-INT-20) ---------- */
    credentialView(cr) { return { id: cr.id, connector: connName(cr.connector_id), name: cr.name, version: cr.version, value: mask(cr.last4), expires_at: cr.expires_at, status: cr.status }; },
    loadCredential({ connector_id, name, secret, expires_at }) {
      if (!G.can('int.credential.rotate')) G.fail('RN-INT-03', `Tu rol (${G.roleName()}) no tiene el permiso int.credential.rotate.`);
      if (!secret || String(secret).length < 8) G.fail('RN-INT-02', 'El secreto tiene al menos 8 caracteres.');
      const cur = D.find('integration_credentials', x => x.connector_id === connector_id && x.name === name && x.status === 'ACTIVE');
      if (cur) G.fail('RN-INT-03', `Ya hay una credencial vigente «${name}» (v${cur.version}): usa «Rotar» para reemplazarla.`);
      const v = 1 + Math.max(0, ...D.where('integration_credentials', x => x.connector_id === connector_id && x.name === name).map(x => x.version));
      const cr = D.insert('integration_credentials', { connector_id, name, version: v, secret_enc: enc(secret), last4: String(secret).slice(-4), expires_at: expires_at || null, status: 'ACTIVE', created_by: G.ctx.userName() }, { silent: true });
      G.audit('CREDENCIAL', 'integration_credentials', cr.id, `Credencial ${name} v${v} cargada para ${connName(connector_id)} (${mask(cr.last4)})`);
      return cr;
    },
    rotate(id, { secret, expires_at }) {
      if (!G.can('int.credential.rotate')) G.fail('RN-INT-03', `Tu rol (${G.roleName()}) no tiene el permiso int.credential.rotate.`);
      const old = D.get('integration_credentials', id); if (!old || old.status !== 'ACTIVE') G.fail('RN-INT-03', 'Solo se rota una credencial vigente.');
      if (!secret || String(secret).length < 8) G.fail('RN-INT-02', 'El secreto nuevo tiene al menos 8 caracteres.');
      D.update('integration_credentials', old.id, { status: 'REVOKED', revoked_at: G.date.now(), revoked_reason: 'Rotación' }, { silent: true });
      const cr = D.insert('integration_credentials', { connector_id: old.connector_id, name: old.name, version: old.version + 1, secret_enc: enc(secret), last4: String(secret).slice(-4), expires_at: expires_at || null, status: 'ACTIVE', created_by: G.ctx.userName(), rotated_from: old.id }, { silent: true });
      G.audit('CREDENCIAL', 'integration_credentials', cr.id, `Rotación de ${old.name}: v${old.version} (${mask(old.last4)}) revocada, v${cr.version} (${mask(cr.last4)}) vigente`);
      return cr;
    },
    revoke(id, reason) {
      if (!G.can('int.credential.rotate')) G.fail('RN-INT-03', `Tu rol (${G.roleName()}) no tiene el permiso int.credential.rotate.`);
      if (!reason || reason.trim().length < 10) G.fail('RN-INT-03', 'Revocar una credencial exige un motivo de al menos 10 caracteres.');
      const cr = D.get('integration_credentials', id);
      D.update('integration_credentials', id, { status: 'REVOKED', revoked_at: G.date.now(), revoked_reason: reason }, { silent: true });
      G.audit('CREDENCIAL', 'integration_credentials', id, `Credencial ${cr.name} v${cr.version} (${mask(cr.last4)}) revocada: ${reason}`);
    },
    credentialsExpiring(days = G.param('int_credential_expiry_warn_days') ?? 7) { return D.where('integration_credentials', x => x.status === 'ACTIVE' && x.expires_at && G.date.diff(x.expires_at.slice(0, 10), G.TODAY) <= days); },
    /* ---------- webhooks (RN-INT-04 … RN-INT-07, RN-INT-14) ---------- */
    endpointSecret(ep) { return dec(ep.secret_enc); },
    sign(endpoint_id, body) { const ep = D.get('webhook_endpoints', endpoint_id); return 'sha256=' + hmac(I.endpointSecret(ep), typeof body === 'string' ? body : JSON.stringify(body)); },
    /** int_receive_webhook: valida firma, deduplica, guarda crudo y procesa en cola. Devuelve {http, status, event, duplicate}. */
    receiveWebhook({ endpoint_id, token, body, signature, event_id, headers = {}, at } = {}) {
      const ep = endpoint_id ? D.get('webhook_endpoints', endpoint_id) : D.find('webhook_endpoints', e => e.token === token);
      if (!ep || ep.status !== 'ACTIVE') return { http: 404, status: 'NOT_FOUND' };
      const c = conn(ep.connector_id);
      const raw = typeof body === 'string' ? body : JSON.stringify(body);
      const when = at || G.date.now();
      const key = event_id || (() => { try { const b = JSON.parse(raw); return b.id ? String(b.id) : null; } catch (e) { return null; } })() || sha256(raw);
      const hdrs = Object.assign({ 'content-type': 'application/json', 'x-signature': signature || '', 'x-request-id': 'req-' + sha256(raw + when).slice(0, 12), 'user-agent': ({ MERCADOPAGO: 'MercadoPago WebHook v1.0', WOOCOMMERCE: 'WooCommerce/9.3 Hookshot', WHATSAPP_CLOUD: 'facebookexternalua' })[c.provider] || 'Webhook' }, headers);
      const base = { endpoint_id: ep.id, connector_id: c.id, owner_module: ep.owner_module, event_key: key, headers: hdrs, body: raw, signature: signature || null, received_at: when, duplicates: 0, attempts: 0, ack_ms: 40 + (raw.length % 120) };
      // RN-INT-04: firma
      const expected = 'sha256=' + hmac(I.endpointSecret(ep), raw);
      if (!signature || signature !== expected) { const ev = D.insert('webhook_events', Object.assign(base, { status: 'REJECTED', http_status: 401, last_error: 'RN-INT-04: firma ausente o inválida; no se procesa.' }), { silent: true }); return { http: 401, status: 'REJECTED', event: ev }; }
      // RN-INT-05: duplicado
      const dup = D.find('webhook_events', e => e.endpoint_id === ep.id && e.event_key === key && e.status !== 'REJECTED');
      if (dup) { D.update('webhook_events', dup.id, { duplicates: (dup.duplicates || 0) + 1, last_duplicate_at: when }, { silent: true }); return { http: 200, status: dup.status, event: dup, duplicate: true }; }
      // RN-INT-14: módulo dueño apagado
      if (!G.modOn(ep.owner_module) || c.status === 'DISABLED') { const ev = D.insert('webhook_events', Object.assign(base, { status: 'IGNORED', http_status: 200, last_error: !G.modOn(ep.owner_module) ? `RN-INT-14: el módulo ${ep.owner_module} está apagado; se guarda y no se procesa.` : 'Conector desactivado.' }), { silent: true }); return { http: 200, status: 'IGNORED', event: ev }; }
      const ev = D.insert('webhook_events', Object.assign(base, { status: 'RECEIVED', http_status: 200 }), { silent: true });
      D.update('webhook_endpoints', ep.id, { last_received_at: when, received_count: (ep.received_count || 0) + 1 }, { silent: true });
      G.events.emit('webhook.received', { event_id: ev.id, connector: c.code, module: ep.owner_module });
      I.processWebhook(ev.id);
      return { http: 200, status: D.get('webhook_events', ev.id).status, event: D.get('webhook_events', ev.id) };
    },
    /** procesamiento en cola: reintenta hasta int_webhook_max_attempts y queda FAILED (RN-INT-07) */
    processWebhook(id, { once } = {}) {
      const ev = D.get('webhook_events', id); const c = conn(ev.connector_id);
      const max = G.param('int_webhook_max_attempts') ?? 5;
      let attempts = ev.attempts || 0, result = null, err = null;
      do {
        attempts++;
        try { result = HANDLERS[c.provider] ? HANDLERS[c.provider](JSON.parse(ev.body), c, ev) : { detail: 'Evento registrado para el módulo ' + ev.owner_module }; err = null; }
        catch (e) { err = e.message; }
      } while (err && !once && attempts < max);
      const t0 = ev.received_at; const lat = 0.6 + (parseInt(sha256(ev.id).slice(0, 4), 16) % 40) / 10;
      if (err) D.update('webhook_events', id, { status: attempts >= max ? 'FAILED' : 'RECEIVED', attempts, last_error: err, failed_at: G.date.now() }, { silent: true });
      else D.update('webhook_events', id, { status: 'PROCESSED', attempts, processed_at: addSec(t0, attempts * lat), result: result && result.detail, last_error: null }, { silent: true });
      return D.get('webhook_events', id);
    },
    reprocess(id) {
      if (!G.can('int.webhook.reprocess')) G.fail('RN-INT-07', `Tu rol (${G.roleName()}) no tiene el permiso int.webhook.reprocess.`);
      const ev = D.get('webhook_events', id); if (ev.status !== 'FAILED') G.fail('RN-INT-07', 'Solo se reprocesa un webhook fallido.');
      if (!G.modOn(ev.owner_module)) G.fail('RN-INT-14', `El módulo ${ev.owner_module} está apagado.`);
      accessLog('WEBHOOK_REPROCESS', { entity: 'webhook_events', entity_id: id, detail: `Reproceso manual del webhook ${ev.event_key}` });
      return I.processWebhook(id, { once: true });
    },
    regenerateToken(epId) {
      if (!G.can('int.connector.manage')) G.fail('RN-INT-04', `Tu rol (${G.roleName()}) no tiene el permiso int.connector.manage.`);
      const ep = D.get('webhook_endpoints', epId); const token = sha256(ep.id + G.date.now() + Math.random()).slice(0, 32);
      D.update('webhook_endpoints', epId, { token, url: `${HOST}/hooks/${token}`, token_rotated_at: G.date.now(), previous_token_valid_until: addSec(G.date.now(), 86400) }, { silent: true });
      G.audit('TOKEN', 'webhook_endpoints', epId, `Token regenerado para ${ep.name}`);
      return D.get('webhook_endpoints', epId);
    },
    /* ---------- outbox (RN-INT-08 … RN-INT-11, RN-INT-14) ---------- */
    delay(n) { const base = G.param('int_outbox_base_delay_seconds') ?? 30, max = G.param('int_outbox_max_delay_seconds') ?? 3600; return Math.min(base * Math.pow(2, n - 1), max); },
    /** int_outbox_enqueue: devuelve null si el módulo dueño está apagado (RN-INT-14) */
    enqueue({ connector, module, kind = 'MESSAGE', event, payload = {}, ref, idempotency_key, at }) {
      const c = conn(connector); if (!c) G.fail('RN-INT-01', `No existe el conector ${connector}.`);
      if (module && G.SPEC[module] && !G.modOn(module)) return null;
      if (!ownerOn(c)) return null;
      const key = idempotency_key || 'ob-' + sha256(c.id + (event || '') + JSON.stringify(payload) + (ref || '') + (at || G.date.now()) + Math.random()).slice(0, 24);
      if (D.find('outbox_messages', m => m.idempotency_key === key)) G.fail('RN-INT-11', `La clave de idempotencia ${key} ya existe en el outbox.`);
      return D.insert('outbox_messages', { number: D.next('OB', 'OB-', 6), connector_id: c.id, module: module || c.owner_module, kind, event: event || null, payload, ref: ref || null, idempotency_key: key, status: 'PENDING', attempts: 0, next_attempt_at: at || G.date.now(), last_error: null, tries: [], created_at: at || G.date.now() }, { silent: true });
    },
    /** un intento de envío (int_outbox_claim + mark_sent / mark_failed) */
    dispatch(id, at) {
      const m = D.get('outbox_messages', id); if (!m || !['PENDING', 'RETRYING'].includes(m.status)) return m;
      const c = conn(m.connector_id); const when = at || G.date.now();
      const ad = I.adapterFor(c.interface, c.environment, c.adapter);
      if (c.simulate_down || c.status === 'DISABLED') return I.markFailed(m, c.status === 'DISABLED' ? 'Conector desactivado' : 'HTTP 503 Service Unavailable: el proveedor no respondió', when);
      const first = !effects[m.idempotency_key]; effects[m.idempotency_key] = (effects[m.idempotency_key] || 0) + (first ? 1 : 0);
      const res = (ad.send || (() => ({ ok: true })))(Object.assign({ idempotency_key: m.idempotency_key }, m.payload));
      D.update('outbox_messages', m.id, { status: 'SENT', attempts: m.attempts + 1, sent_at: when, provider_ref: res.provider_id || res.status || 'OK', last_error: null, tries: (m.tries || []).concat([{ at: when, ok: true }]) }, { silent: true });
      I.connectorReport(c.id, true);
      return D.get('outbox_messages', m.id);
    },
    effects: key => effects[key] || 0,
    markFailed(m, error, at) {
      const n = m.attempts + 1; const max = G.param('int_outbox_max_attempts') ?? 8;
      const tries = (m.tries || []).concat([{ at, ok: false, error, delay: n < max ? I.delay(n) : null }]);
      I.connectorReport(m.connector_id, false, error);
      if (n >= max) {
        D.update('outbox_messages', m.id, { status: 'DEAD', attempts: n, last_error: error, dead_at: at, next_attempt_at: null, tries }, { silent: true });
        G.events.emit('outbox.dead', { outbox_id: m.id, number: m.number });
        I.notify({ role: 'ADMIN_SISTEMA', type: 'INTEGRATIONS', severity: 'CRITICAL', title: `Mensaje ${m.number} en la cola muerta`, body: `${connName(m.connector_id)} falló ${n} veces: ${error}. Reintenta o cancela con motivo (RN-INT-09).`, ref: { screen: 'INT-07', params: { id: m.id } }, module: 'INT' });
      } else D.update('outbox_messages', m.id, { status: 'RETRYING', attempts: n, last_error: error, next_attempt_at: addSec(at, I.delay(n)), tries }, { silent: true });
      return D.get('outbox_messages', m.id);
    },
    /** procesa la cola: cada mensaje vencido tiene un intento en su hora programada */
    runOutbox({ upTo, all } = {}) {
      const lim = upTo || G.date.now(); let n = 0;
      for (const m of D.where('outbox_messages', x => ['PENDING', 'RETRYING'].includes(x.status) && (all || !x.next_attempt_at || x.next_attempt_at <= lim))) { I.dispatch(m.id, all && m.next_attempt_at > lim ? m.next_attempt_at : lim); n++; }
      return n;
    },
    /** RN-INT-10: reintento manual con motivo; se registra en la bitácora de accesos */
    retryDead(id, reason) {
      if (!G.can('int.outbox.retry')) G.fail('RN-INT-10', `Tu rol (${G.roleName()}) no tiene el permiso int.outbox.retry.`);
      if (!reason || reason.trim().length < 10) G.fail('RN-INT-10', 'Reintentar un mensaje de la cola muerta exige un motivo de al menos 10 caracteres.');
      const m = D.get('outbox_messages', id); if (m.status !== 'DEAD') G.fail('RN-INT-10', 'Solo se reintentan mensajes de la cola muerta.');
      D.update('outbox_messages', id, { status: 'PENDING', manual: (m.manual || []).concat([{ at: G.date.now(), by: G.ctx.userName(), action: 'RETRY', reason }]) }, { silent: true });
      accessLog('OUTBOX_RETRY', { entity: 'outbox_messages', entity_id: id, detail: `Reintento manual de ${m.number}: ${reason}` });
      const r = I.dispatch(id);
      if (r.status !== 'SENT') D.update('outbox_messages', id, { status: 'DEAD' }, { silent: true });
      return D.get('outbox_messages', id);
    },
    cancelDead(id, reason) {
      if (!G.can('int.outbox.retry')) G.fail('RN-INT-10', `Tu rol (${G.roleName()}) no tiene el permiso int.outbox.retry.`);
      if (!reason || reason.trim().length < 10) G.fail('RN-INT-10', 'Cancelar un mensaje de la cola muerta exige un motivo de al menos 10 caracteres.');
      const m = D.get('outbox_messages', id);
      D.update('outbox_messages', id, { status: 'CANCELLED', cancel_reason: reason, manual: (m.manual || []).concat([{ at: G.date.now(), by: G.ctx.userName(), action: 'CANCEL', reason }]) }, { silent: true });
      accessLog('OUTBOX_RETRY', { entity: 'outbox_messages', entity_id: id, detail: `Cancelación manual de ${m.number}: ${reason}` });
      return D.get('outbox_messages', id);
    },
    /* ---------- idempotencia (RN-INT-12, RN-INT-13) ---------- */
    idemBegin({ key, scope, body }) {
      if (!key) G.fail('RN-INT-12', 'Falta la cabecera Idempotency-Key.');
      const hash = sha256(scope + '|' + JSON.stringify(body));
      const now = G.date.now();
      let row = D.find('idempotency_keys', k => k.key === key && k.scope === scope);
      if (row && row.expires_at < now) { D.update('idempotency_keys', row.id, { status: 'EXPIRED' }, { silent: true }); row = null; }
      if (row && row.status !== 'EXPIRED') {
        if (row.request_hash !== hash) G.fail('RN-INT-12', `La clave ${key} ya se usó con otro cuerpo: se responde 422.`, { http: 422 });
        if (row.status === 'IN_PROGRESS') G.fail('RN-INT-13', `La petición con la clave ${key} aún se procesa: se responde 409.`, { http: 409 });
        D.update('idempotency_keys', row.id, { replays: (row.replays || 0) + 1, last_replay_at: now }, { silent: true });
        return { replay: true, http: row.response_code, body: row.response_body, row };
      }
      row = D.insert('idempotency_keys', { key, scope, request_hash: hash, status: 'IN_PROGRESS', user_id: G.ctx.userId(), created_at: now, expires_at: addSec(now, (G.param('int_idempotency_ttl_hours') ?? 24) * 3600), replays: 0 }, { silent: true });
      return { replay: false, row };
    },
    idemComplete(row, code, body) { D.update('idempotency_keys', row.id, { status: 'COMPLETED', response_code: code, response_body: body, completed_at: G.date.now() }, { silent: true }); },
    /** ejecuta fn una sola vez por clave: con la misma clave y cuerpo devuelve la respuesta guardada */
    idempotent({ key, scope, body, code = 201 }, fn) {
      const b = I.idemBegin({ key, scope, body });
      if (b.replay) return { http: b.http, body: b.body, replayed: true };
      try { const res = fn(); I.idemComplete(b.row, code, res); return { http: code, body: res, replayed: false }; }
      catch (e) { D.t.idempotency_keys = D.raw('idempotency_keys').filter(k => k.id !== b.row.id); throw e; }
    },
    /* ---------- notificaciones (RN-INT-15) ---------- */
    pref(user_id, type) { return D.find('notification_preferences', p => p.user_id === user_id && p.type === type); },
    notify({ user_id, role, type = 'INTEGRATIONS', severity = 'INFO', title, body, ref, module }) {
      const targets = user_id ? [user_id] : D.where('users', u => u.role === role && u.status === 'ACTIVE').map(u => u.id);
      const out = [];
      for (const uid of targets) {
        const p = I.pref(uid, type); const crit = severity === 'CRITICAL';
        const ch = { in_app: crit || !p || p.in_app !== false, email: crit ? true : !!(p && p.email), push: crit ? true : !!(p && p.push) };
        if (!ch.in_app && !ch.email && !ch.push) continue;
        out.push(D.insert('notifications', { user_id: uid, title, body, ref, tone: ({ CRITICAL: 'bad', WARNING: 'warn', OK: 'ok' })[severity] || 'info', severity, type, module, channels: ch, in_app: ch.in_app, read_at: null, at: G.date.now() }, { silent: true }));
      }
      return out;
    },
    /* ---------- archivos (RN-INT-16 … RN-INT-18) ---------- */
    allowedTypes() { return String(G.param('int_file_allowed_types') || '').split(/[,\s]+/).filter(Boolean).map(x => x.toUpperCase()); },
    attach({ entity, entity_id, file_name, size_bytes, classification = 'INTERNAL', content, mime }) {
      if (!G.can('int.file.upload') && G.ctx.role !== 'CLIENTE_B2B') G.fail('RN-INT-16', `Tu rol (${G.roleName()}) no puede adjuntar archivos.`);
      const ext = String(file_name || '').split('.').pop().toUpperCase().replace('JPEG', 'JPG');
      const maxMb = G.param('int_file_max_mb') ?? 20;
      if (!I.allowedTypes().includes(ext)) G.fail('RN-INT-16', `El tipo .${ext.toLowerCase()} no está permitido. Tipos válidos: ${I.allowedTypes().join(', ')}.`);
      if (!(size_bytes > 0)) G.fail('RN-INT-16', 'El archivo está vacío.');
      if (size_bytes > maxMb * 1024 * 1024) G.fail('RN-INT-16', `El archivo pesa ${F.num(size_bytes / 1048576, 1)} MB y el máximo es ${maxMb} MB.`);
      const hash = sha256(content !== undefined ? content : `${file_name}|${size_bytes}|${entity}|${entity_id}`);
      const id = U.uid('fa');
      return D.insert('file_attachments', { id, entity, entity_id, file_name, ext, mime: mime || null, size_bytes, sha256: hash, classification, storage_key: `s3://aycha-dg-files/${entity}/${entity_id}/${hash.slice(0, 16)}.${ext.toLowerCase()}`, status: 'ACTIVE', uploaded_by: G.ctx.userName(), uploaded_at: G.date.now(), links: [] });
    },
    /** enlace temporal (RN-INT-17): nunca URL pública; confidenciales exigen permiso y quedan en la bitácora */
    fileLink(id) {
      const f = D.get('file_attachments', id); if (!f || f.status !== 'ACTIVE') G.fail('RN-INT-18', 'El archivo fue eliminado.');
      const sens = ['CONFIDENTIAL', 'PERSONAL_DATA'].includes(f.classification);
      if (sens && !G.can('int.file.view_confidential')) { accessLog('PERMISSION_DENIED', { entity: 'file_attachments', entity_id: id, result: 'DENIED', detail: `Descarga de ${f.file_name} (${className(f.classification)}) sin permiso` }); G.fail('RN-INT-17', `${f.file_name} es ${className(f.classification).toLowerCase()}: descargarlo exige el permiso int.file.view_confidential.`); }
      const min = G.param('int_file_link_minutes') ?? 10; const now = G.date.now(); const exp = addSec(now, min * 60);
      const sig = hmac(MASTER, f.storage_key + exp).slice(0, 32);
      const link = { url: `https://files.aycha.pe/${f.storage_key.replace('s3://', '')}?X-Amz-Expires=${min * 60}&X-Amz-Signature=${sig}`, expires_at: exp, minutes: min };
      D.update('file_attachments', id, { links: (f.links || []).concat([{ at: now, by: G.ctx.userName(), expires_at: exp }]).slice(-20) }, { silent: true });
      if (sens) accessLog('FILE_DOWNLOADED', { entity: 'file_attachments', entity_id: id, detail: `${f.file_name} · ${className(f.classification)} · enlace de ${min} min` });
      return link;
    },
    deleteFile(id, reason) {
      if (!G.can('int.file.delete')) G.fail('RN-INT-18', `Tu rol (${G.roleName()}) no tiene el permiso int.file.delete.`);
      if (!reason || reason.trim().length < 10) G.fail('RN-INT-18', 'Eliminar un archivo exige un motivo de al menos 10 caracteres; se marca como eliminado y se depura por retención.');
      D.update('file_attachments', id, { status: 'DELETED', deleted_reason: reason, deleted_by: G.ctx.userName(), deleted_at: G.date.now() });
      return D.get('file_attachments', id);
    },
    /* ---------- corridas programadas ---------- */
    runJob(job, connector_code) {
      const c = conn(connector_code); const started = G.date.now(); let ok = 0, failed = 0, detail = '', status = 'COMPLETED';
      try {
        if (c && c.simulate_down) throw new Error('El proveedor no respondió (HTTP 503)');
        if (c && !ownerOn(c)) G.fail('RN-INT-14', `El módulo ${c.owner_module} está apagado.`);
        if (job === 'FX_DAILY') { if (!G.mae) throw new Error('El módulo MAE no está disponible.'); const r = G.mae.loadFx(G.TODAY); ok = r.published && !r.already ? 1 : 0; detail = r.msg; }
        else if (job === 'WOO_STOCK_SYNC') { const vs = D.where('product_variants', v => v.status === 'ACTIVE' && v.sellable && v.brand_id === 'br-DG' && (G.productOf(v.id) || {}).web_publishable); ok = vs.length; failed = vs.filter(v => !v.sku).length; detail = `${ok} productos con stock enviados a donguando.com`; }
        else if (job === 'WOO_CATALOG_SYNC') { const vs = D.where('product_variants', v => v.status === 'ACTIVE' && v.sellable && v.brand_id === 'br-DG'); ok = vs.filter(v => G.price.of(v.id, { channel: 'WEB' })).length; failed = vs.length - ok; detail = failed ? `${failed} productos sin precio web no se publicaron (RN-CAT-05)` : 'Catálogo publicado'; }
        else if (job === 'ADS_SPEND_IMPORT') { const camps = D.where('ad_campaigns', x => !c || x.platform === c.config.platform); ok = camps.length; detail = `${ok} campañas · gasto de ${F.date(G.date.add(G.TODAY, -1))}`; }
        else if (job === 'GRJ_LOTS_SYNC') { ok = D.where('lots', l => l.supplier_id === 'su-GRANJA').length; detail = `${ok} lotes de la granja sincronizados`; }
        else { ok = D.where('sales_documents', d => d.sunat_status === 'PENDING').length; detail = `${ok} comprobantes consultados`; }
        if (failed && ok) status = 'PARTIAL';
        if (c) I.connectorReport(c.id, true);
      } catch (e) { status = 'FAILED'; detail = e.message; failed = 1; if (c) I.connectorReport(c.id, false, e.message); }
      const run = D.insert('integration_runs', { connector_id: c ? c.id : null, job, started_at: started, finished_at: G.date.now(), status, items_ok: ok, items_failed: failed, detail, triggered_by: G.ctx.userName() }, { silent: true });
      if (job === 'FX_DAILY' && status === 'FAILED') {
        const today = D.where('integration_runs', r => r.job === 'FX_DAILY' && r.started_at.slice(0, 10) === G.TODAY && r.status === 'FAILED').length;
        if (today === 3) I.notify({ role: 'ADMINISTRACION', type: 'INTEGRATIONS', severity: 'WARNING', title: 'Carga el tipo de cambio a mano', body: 'La carga automática desde SUNAT falló 3 veces hoy (RN-MAE-14).', ref: { screen: 'MAE-05' }, module: 'MAE' });
      }
      return run;
    },
  };

  /* ---------- procesadores de webhooks por proveedor ---------- */
  const HANDLERS = {
    MERCADOPAGO(b) {
      const d = b.data || {}; if (b.type !== 'payment') return { detail: 'Evento ' + b.type + ' registrado' };
      if (d.status !== 'approved') return { detail: `Pago ${d.id} en estado ${d.status}: sin efecto` };
      const o = D.find('sales_orders', x => x.number === d.external_reference || x.external_ref === d.external_reference);
      if (!o) throw new Error(`No existe el pedido ${d.external_reference} del pago ${d.id}.`);
      const ref = 'MP-' + d.id;
      if (D.find('payments', p => p.reference === ref && p.status !== 'REVERSED')) return { detail: `Pago ${ref} ya registrado` };
      const p = G.pay.register({ customer_id: o.customer_id, payment_method_id: 'pm-MP', amount: Number(d.transaction_amount), reference: ref, allocations: [{ order_id: o.id, amount: Number(d.transaction_amount) }], brand_id: o.brand_id, establishment_id: o.establishment_id });
      return { detail: `Cobro ${p.number} de ${F.money(p.amount)} aplicado a ${o.number}`, payment_id: p.id };
    },
    WOOCOMMERCE(b) {
      if (G.web && G.web.importWooOrder) { const o = G.web.importWooOrder(b); return { detail: `Pedido ${o.number} creado desde WooCommerce` }; }
      const ext = 'WC-' + b.number;
      const ex = D.find('sales_orders', o => o.external_ref === ext); if (ex) return { detail: `Pedido web ${ext} ya importado como ${ex.number}` };
      const phone = (b.billing || {}).phone; const cu = D.find('customers', c => c.phone === phone);
      if (!cu) throw new Error(`No se encontró cliente con el celular ${phone}; regístralo en CLI.`);
      const lines = (b.line_items || []).map(li => { const v = D.find('product_variants', x => x.sku === li.sku); if (!v) throw new Error(`SKU ${li.sku} no existe en el catálogo.`); return { variant_id: v.id, qty: li.quantity }; });
      const o = G.orders.create({ customer_id: cu.id, brand_id: 'br-DG', channel: 'WEB', fulfillment: 'DELIVERY', payment_method_id: 'pm-MP', lines, external_ref: ext, seller_id: null, notes: b.customer_note || 'Pedido web', origin_utm: b.utm || null });
      return { detail: `Pedido ${o.number} creado desde WooCommerce ${ext}`, order_id: o.id };
    },
    WHATSAPP_CLOUD(b, c) {
      const v = (((b.entry || [])[0] || {}).changes || [])[0] || {}; const val = v.value || {}; const msg = (val.messages || [])[0];
      if (!msg) return { detail: 'Estado de mensaje registrado' };
      if (G.crm && G.crm.inbound) { G.crm.inbound({ from: msg.from, text: (msg.text || {}).body, channel_id: c.config.channel_id }); return { detail: 'Mensaje entregado a CRM' }; }
      const phone = '+' + String(msg.from).replace(/^\+/, ''); const cu = D.find('customers', x => x.phone === phone);
      D.insert('messages', { conversation_id: null, customer_id: cu ? cu.id : null, channel_id: c.config.channel_id || null, direction: 'IN', kind: 'SESSION', text: (msg.text || {}).body || '', wa_message_id: msg.id, sent_at: G.date.now(), status: 'RECEIVED', cost: 0, from_phone: phone }, { silent: true });
      return { detail: `Mensaje de ${phone}${cu ? ' (' + (cu.trade_name || cu.full_name) + ')' : ''} registrado` };
    },
  };

  /* ---------- eventos: confirmación por WhatsApp y envío al OSE por el outbox ---------- */
  function waConnectorFor(o) {
    const cs = D.where('integration_connectors', c => c.provider === 'WHATSAPP_CLOUD' && c.environment === 'PRODUCTION' && c.brand_id === o.brand_id);
    return cs.find(c => c.config.display_number === o.origin_wa_number) || cs[0] || null;
  }
  I.enqueueOrderMessage = function (orderId, template = 'confirmacion_pedido') {
    const o = D.get('sales_orders', orderId); if (!o) return null;
    const c = waConnectorFor(o); if (!c) return null;
    const m = I.enqueue({ connector: c.id, module: 'CRM', kind: 'MESSAGE', event: 'order.confirmed', payload: { to: o.contact_phone, template, order: o.number, total: o.estimated_total }, ref: o.number });
    if (m) I.dispatch(m.id);
    return m ? D.get('outbox_messages', m.id) : null;
  };
  G.events.on('order.confirmed', p => { try { I.enqueueOrderMessage(p.order_id); } catch (e) { console.error(e); } });
  G.events.on('document.issued', p => { try { const c = D.find('integration_connectors', x => x.code === 'OSE-PSE'); if (!c) return; const m = I.enqueue({ connector: c.id, module: 'FAC', kind: 'EINVOICE', event: 'document.issued', payload: { document_id: p.document_id, full_number: p.full_number }, ref: p.full_number }); if (m) I.dispatch(m.id); } catch (e) { console.error(e); } });

  /* =====================================================================
     Semillas (14: conectores, credenciales, endpoints y preferencias;
               15: webhooks, outbox, corridas, notificaciones, archivos)
     ===================================================================== */
  const detTok = (r, n) => { const c = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < n; i++) s += c[Math.floor(r() * c.length)]; return s; };
  G.seed(14, function seedINT1() {
    const ins = (t, r) => D.insert(t, r, { silent: true });
    const r = U.rng(140014);
    const C = (code, name, kind, provider, owner, o = {}) => ins('integration_connectors', Object.assign({ id: 'ic-' + code, code, name, kind, interface: IFACE[kind], provider, adapter: o.environment === 'SANDBOX' ? 'FAKE' : REAL[kind], environment: 'PRODUCTION', owner_module: owner, brand_id: null, establishment_id: null, status: 'ACTIVE', config: {}, consecutive_failures: 0, last_ok_at: G.date.add(G.TODAY, 0) + 'T0' + (6 + Math.floor(r() * 3)) + ':' + U.pad(Math.floor(r() * 59), 2), last_error_at: null, last_error: null, errors: [], latency_ms: 90 + Math.floor(r() * 300), simulate_down: false }, o));
    for (const ch of D.where('messaging_channels', c => c.kind === 'WHATSAPP')) C('WA-' + ch.number.slice(-4), `WhatsApp ${ch.display_name} · ${ch.number}`, 'MESSAGING', 'WHATSAPP_CLOUD', 'CRM', { brand_id: ch.brand_id, config: { channel_id: ch.id, display_number: ch.number, phone_number_id: '10' + ch.number.replace(/\D/g, '').slice(-9) + '7', waba_id: '2207' + ch.number.replace(/\D/g, '').slice(-6), coexistence: ch.coexistence, quality_rating: ch.quality_rating, messaging_limit: ch.messaging_limit } });
    C('TT-MSG', 'TikTok Business Messaging', 'MESSAGING', 'TIKTOK', 'CRM', { brand_id: 'br-DG', config: { accounts: '@donguando, @marca5gourmet' } });
    C('META-MSG', 'Messenger e Instagram (Meta)', 'MESSAGING', 'META_MESSAGING', 'CRM', { brand_id: 'br-DG', config: { page: 'fb.com/donguando', instagram: '@donguando' } });
    C('WOO-DG', 'WooCommerce · donguando.com', 'COMMERCE', 'WOOCOMMERCE', 'WEB', { brand_id: 'br-DG', config: { store_url: 'https://www.donguando.com', api_version: 'wc/v3', stock_sync: 'cada hora' } });
    C('MP-DG', 'Mercado Pago · donguando.com', 'PAYMENTS', 'MERCADOPAGO', 'WEB', { brand_id: 'br-DG', config: { collector_id: '1204578833', notification_url: `${HOST}/hooks/…`, release_days: 14 } });
    C('GADS', 'Google Ads', 'ADS', 'GOOGLE_ADS', 'ADS', { config: { platform: 'GOOGLE', accounts: 5 } });
    C('META-ADS', 'Meta Ads (Facebook e Instagram)', 'ADS', 'META_ADS', 'ADS', { config: { platform: 'META', accounts: 5 } });
    C('TT-ADS', 'TikTok Ads', 'ADS', 'TIKTOK_ADS', 'ADS', { config: { platform: 'TIKTOK', accounts: 5 } });
    C('OSE-PSE', 'OSE/PSE de comprobantes electrónicos', 'EINVOICE', 'OSE', 'FAC', { config: { ruc: (D.get('companies', 'co-dg') || {}).ruc, mode: 'Producción', series: 'F001–F005, B001–B005, B010' } });
    C('SCALE-L1', 'Balanza del mostrador · Local 1', 'SCALE', 'SCALE_SERIAL', 'POS', { establishment_id: 'es-L1', config: { model: 'Balanza etiquetadora 30 kg', port: 'COM3', protocol: 'Serial 9600 8N1' } });
    C('SCALE-L2', 'Balanza de producción · Local 2', 'SCALE', 'SCALE_SERIAL', 'PRE', { establishment_id: 'es-L2', status: 'ERROR', consecutive_failures: 3, last_error_at: G.TODAY + 'T07:42', last_error: 'Puerto COM4 sin respuesta (cable o adaptador USB)', last_ok_at: '2026-10-09T18:10', errors: [{ at: G.TODAY + 'T07:12', msg: 'Puerto COM4 sin respuesta' }, { at: G.TODAY + 'T07:27', msg: 'Puerto COM4 sin respuesta' }, { at: G.TODAY + 'T07:42', msg: 'Puerto COM4 sin respuesta (cable o adaptador USB)' }], config: { model: 'Plataforma 150 kg', port: 'COM4' } });
    C('GPS-FLOTA', 'GPS de la flota de reparto', 'GPS', 'GPS_TRACKER', 'DEL', { config: { vehicles: D.all('vehicles').length, interval: '60 s' } });
    C('MAPS', 'Mapas y geocodificación', 'MAPS', 'GOOGLE_MAPS', 'DEL', { config: { usage: 'Direcciones con pin y rutas' } });
    C('DLV-CO', 'Empresa de delivery (envíos tercerizados)', 'DELIVERY', 'DELIVERY_COMPANY', 'DEL', { config: { provider: G.supName((D.find('suppliers', s => /delivery/i.test(s.trade_name || s.legal_name || '')) || {}).id) } });
    C('GRJ-API', 'Granja Don Guando (lotes y despachos)', 'FARM', 'GRANJA_API', 'GRJ', { config: { base_url: 'https://granja.donguando.pe/api', company: 'Granja Don Guando (mismo RUC)' } });
    C('AYNI-HR', 'Ayni HR (personal y planillas)', 'HR', 'AYNI_HR', 'PER', { status: 'PENDING', last_ok_at: null, config: { note: 'Fase 3: pendiente de contrato' } });
    C('TEL-TWILIO', 'Telefonía en la nube', 'TELEPHONY', 'TWILIO', 'TEL', { status: 'DISABLED', last_ok_at: null, config: { note: 'Módulo TEL apagado (RN-PLT-07)' } });
    C('SMTP', 'Correo transaccional', 'EMAIL', 'SMTP', 'INT', { config: { from: 'avisos@donguando.pe' } });
    C('FCM', 'Notificaciones push (app Android)', 'PUSH', 'FCM', 'INT', { config: { app: 'pe.donguando.aycha' } });
    C('FX-SUNAT', 'Tipo de cambio SUNAT', 'FX', 'SUNAT_FX', 'MAE', { config: { schedule: (G.param('mae_fx_load_time') || '09:00') + ' de lunes a viernes', currency: 'USD' } });
    C('WA-SBX', 'WhatsApp · entorno de prueba', 'MESSAGING', 'WHATSAPP_CLOUD', 'CRM', { environment: 'SANDBOX', adapter: 'FAKE', brand_id: 'br-DG', config: { channel_id: 'ch-wa-SBX', display_number: '+15550001111' } });
    C('MP-SBX', 'Mercado Pago · entorno de prueba', 'PAYMENTS', 'MERCADOPAGO', 'WEB', { environment: 'SANDBOX', adapter: 'FAKE', brand_id: 'br-DG' });
    C('WOO-SBX', 'WooCommerce · staging', 'COMMERCE', 'WOOCOMMERCE', 'WEB', { environment: 'SANDBOX', adapter: 'FAKE', brand_id: 'br-DG', config: { store_url: 'https://staging.donguando.com' } });
    // medio de pago Mercado Pago enlazado a su conector
    const mp = D.get('payment_methods', 'pm-MP'); if (mp) mp.connector_id = 'ic-MP-DG';
    /* credenciales */
    const CR = (cid, name, secret, expires, o = {}) => ins('integration_credentials', Object.assign({ connector_id: cid, name, version: 1, secret_enc: enc(secret), last4: secret.slice(-4), expires_at: expires, status: 'ACTIVE', created_by: 'Luis Ccahuana Rojas', created_at: '2026-08-15T10:00' }, o));
    CR('ic-MP-DG', 'access_token', 'APP_USR-7712045788331245-' + detTok(r, 18) + '3456', null, { version: 2, created_at: '2026-09-01T11:20' });
    ins('integration_credentials', { connector_id: 'ic-MP-DG', name: 'access_token', version: 1, secret_enc: enc('APP_USR-old-' + detTok(r, 20)), last4: '9921', expires_at: null, status: 'REVOKED', revoked_at: '2026-09-01T11:20', revoked_reason: 'Rotación', created_by: 'Luis Ccahuana Rojas', created_at: '2026-05-10T09:00' });
    CR('ic-MP-DG', 'webhook_secret', 'mpwh_' + detTok(r, 32), null);
    for (const c of D.where('integration_connectors', c => c.provider === 'WHATSAPP_CLOUD' && c.environment === 'PRODUCTION')) CR(c.id, 'system_user_token', 'EAAG' + detTok(r, 40), null);
    CR('ic-META-MSG', 'page_access_token', 'EAAP' + detTok(r, 40), '2026-12-05T00:00');
    CR('ic-TT-MSG', 'access_token', 'act.' + detTok(r, 36), '2026-11-02T00:00');
    CR('ic-WOO-DG', 'consumer_key', 'ck_' + detTok(r, 40), null); CR('ic-WOO-DG', 'consumer_secret', 'cs_' + detTok(r, 40), null);
    CR('ic-GADS', 'refresh_token', '1//0' + detTok(r, 44), null); CR('ic-GADS', 'developer_token', detTok(r, 22), null);
    CR('ic-META-ADS', 'access_token', 'EAAB' + detTok(r, 40), G.date.add(G.TODAY, 4) + 'T00:00');
    CR('ic-TT-ADS', 'access_token', detTok(r, 40), G.date.add(G.TODAY, 6) + 'T00:00');
    CR('ic-OSE-PSE', 'usuario_sol_secundario', 'DGFACT01:' + detTok(r, 14), null); CR('ic-OSE-PSE', 'certificado_digital', 'PFX-' + detTok(r, 30), '2027-03-14T00:00');
    CR('ic-GPS-FLOTA', 'api_key', 'gps_' + detTok(r, 30), null); CR('ic-MAPS', 'api_key', 'AIza' + detTok(r, 35), null);
    CR('ic-DLV-CO', 'api_key', 'dlv_' + detTok(r, 28), '2026-10-31T00:00'); CR('ic-GRJ-API', 'client_secret', 'grj_' + detTok(r, 32), null);
    CR('ic-SMTP', 'password', detTok(r, 20), null); CR('ic-FCM', 'service_account_key', 'fcm_' + detTok(r, 40), null); CR('ic-FX-SUNAT', 'api_token', 'fx_' + detTok(r, 24), null);
    CR('ic-MP-SBX', 'access_token', 'TEST-' + detTok(r, 30), null); CR('ic-MP-SBX', 'webhook_secret', 'sbx_' + detTok(r, 24), null); CR('ic-WA-SBX', 'system_user_token', 'TEST' + detTok(r, 30), null); CR('ic-WOO-SBX', 'consumer_secret', 'cs_test_' + detTok(r, 30), null);
    /* endpoints de entrada */
    const E = (id, cid, name, owner, scheme) => { const token = detTok(r, 32); const secret = 'whsec_' + detTok(r, 32); return ins('webhook_endpoints', { id, connector_id: cid, name, owner_module: owner, token, url: `${HOST}/hooks/${token}`, signature_scheme: scheme, secret_enc: enc(secret), status: 'ACTIVE', received_count: 0, last_received_at: null }); };
    E('we-MP-DG', 'ic-MP-DG', 'Mercado Pago · pagos de donguando.com', 'WEB', 'HMAC-SHA256 del cuerpo (x-signature)');
    E('we-WOO-DG', 'ic-WOO-DG', 'WooCommerce · pedidos de donguando.com', 'WEB', 'HMAC-SHA256 (X-WC-Webhook-Signature)');
    E('we-WA', D.find('integration_connectors', c => c.provider === 'WHATSAPP_CLOUD' && c.environment === 'PRODUCTION').id, 'WhatsApp Cloud API (6 números)', 'CRM', 'HMAC-SHA256 (X-Hub-Signature-256)');
    E('we-META', 'ic-META-MSG', 'Messenger e Instagram', 'CRM', 'HMAC-SHA256 (X-Hub-Signature-256)');
    E('we-TT', 'ic-TT-MSG', 'TikTok Business Messaging', 'CRM', 'HMAC-SHA256 (TikTok-Signature)');
    E('we-OSE', 'ic-OSE-PSE', 'OSE · constancias de recepción (CDR)', 'FAC', 'HMAC-SHA256 (x-signature)');
    E('we-GPS', 'ic-GPS-FLOTA', 'GPS · posiciones y alertas', 'DEL', 'HMAC-SHA256 (x-signature)');
    E('we-DLV', 'ic-DLV-CO', 'Empresa de delivery · estados del envío', 'DEL', 'HMAC-SHA256 (x-signature)');
    E('we-TEL', 'ic-TEL-TWILIO', 'Telefonía · llamadas y grabaciones', 'TEL', 'HMAC-SHA1 (X-Twilio-Signature)');
    E('we-MP-SBX', 'ic-MP-SBX', 'Mercado Pago · prueba', 'WEB', 'HMAC-SHA256 del cuerpo (x-signature)');
    E('we-WOO-SBX', 'ic-WOO-SBX', 'WooCommerce · staging', 'WEB', 'HMAC-SHA256 (X-WC-Webhook-Signature)');
    E('we-WA-SBX', 'ic-WA-SBX', 'WhatsApp · prueba', 'CRM', 'HMAC-SHA256 (X-Hub-Signature-256)');
    /* preferencias de notificación */
    const P = (uid, type, in_app, email, push) => ins('notification_preferences', { user_id: uid, type, in_app, email, push });
    const byRole = role => D.where('users', u => u.role === role && u.status === 'ACTIVE');
    for (const u of byRole('GERENTE')) { P(u.id, 'APPROVALS', true, true, true); P(u.id, 'EXPORTS', true, true, false); P(u.id, 'STOCK', false, false, false); P(u.id, 'CRITICAL', true, true, true); }
    for (const u of byRole('ADMIN_SISTEMA')) { P(u.id, 'INTEGRATIONS', true, true, true); P(u.id, 'SECURITY', true, true, true); P(u.id, 'ORDERS', false, false, false); }
    for (const u of byRole('ADMINISTRACION')) { P(u.id, 'PAYMENTS', true, true, false); P(u.id, 'INTEGRATIONS', true, false, false); }
    for (const u of byRole('VENDEDORA')) { P(u.id, 'ORDERS', true, false, true); P(u.id, 'STOCK', false, false, false); }
  }, 'INT conectores');

  G.seed(15, function seedINT2() {
    const ins = (t, row) => D.insert(t, row, { silent: true });
    const r = U.rng(150015);
    const T0 = G.date.add(G.TODAY, -9);
    const tm = (d, h0 = 8, h1 = 21) => `${d}T${U.pad(h0 + Math.floor(r() * (h1 - h0)), 2)}:${U.pad(Math.floor(r() * 60), 2)}:${U.pad(Math.floor(r() * 60), 2)}`;
    const lat = () => r() < 0.04 ? 62 + r() * 30 : 0.4 + r() * (r() < 0.8 ? 3 : 14);
    const ev = (ep, body, at, o = {}) => { const raw = JSON.stringify(body); const e = D.get('webhook_endpoints', ep); const c = conn(e.connector_id); const sig = o.badSig ? 'sha256=' + detTok(r, 64).toLowerCase() : 'sha256=' + hmac(dec(e.secret_enc), raw); const l = lat();
      const row = ins('webhook_events', Object.assign({ endpoint_id: ep, connector_id: c.id, owner_module: e.owner_module, event_key: o.key || String(body.id || sha256(raw)), headers: { 'content-type': 'application/json', 'x-signature': sig, 'x-request-id': 'req-' + detTok(r, 12), 'user-agent': ({ MERCADOPAGO: 'MercadoPago WebHook v1.0', WOOCOMMERCE: 'WooCommerce/9.3 Hookshot', WHATSAPP_CLOUD: 'facebookexternalua' })[c.provider] || 'Webhook' }, body: raw, signature: sig, received_at: at, status: 'PROCESSED', http_status: 200, duplicates: o.dups || 0, attempts: 1, processed_at: addSec(at, l), ack_ms: 30 + Math.floor(r() * 160), result: o.result || null, last_error: null }, o.patch || {}));
      e.received_count = (e.received_count || 0) + 1 + (o.dups || 0); e.last_received_at = at > (e.last_received_at || '') ? at : e.last_received_at; return row; };
    // Mercado Pago: un evento por cobro web confirmado en octubre
    const orders = D.where('sales_orders', o => o.channel === 'WEB' && o.created_at.slice(0, 10) >= T0);
    const ordById = new Map(orders.map(o => [o.id, o]));
    for (const p of D.where('payments', p => p.payment_method_id === 'pm-MP' && String(p.paid_at).slice(0, 10) >= T0)) {
      const o = ordById.get(((p.allocations || [])[0] || {}).order_id) || {};
      const mpId = String(1320000000 + Math.floor(r() * 9999999));
      ev('we-MP-DG', { id: mpId, type: 'payment', action: 'payment.updated', live_mode: true, date_created: p.paid_at, data: { id: mpId, status: 'approved', transaction_amount: p.amount, external_reference: o.number || null } }, String(p.paid_at).length > 10 ? String(p.paid_at).slice(0, 16) + ':' + U.pad(Math.floor(r() * 60), 2) : tm(String(p.paid_at)), { dups: r() < 0.18 ? 1 + Math.floor(r() * 2) : 0, result: `Cobro ${p.number} aplicado a ${o.number || '—'}` });
    }
    // WooCommerce: pedidos web
    for (const o of orders) ev('we-WOO-DG', { id: Number(String(o.external_ref || '').replace(/\D/g, '')) || 8000 + Math.floor(r() * 999), number: String(o.external_ref || '').replace('WC-', ''), status: 'processing', billing: { first_name: G.custName(o.customer_id).split(' ')[0], phone: (D.get('customers', o.customer_id) || {}).phone }, line_items: (o.lines || []).map(l => ({ sku: (G.variant(l.variant_id) || {}).sku, quantity: l.qty })), payment_method: 'woo-mercado-pago-basic' }, o.created_at.length > 16 ? o.created_at.slice(0, 19) : o.created_at.slice(0, 16) + ':10', { dups: r() < 0.1 ? 1 : 0, result: `Pedido ${o.number} creado desde WooCommerce ${o.external_ref}` });
    // WhatsApp entrantes
    const WAc = D.where('integration_connectors', c => c.provider === 'WHATSAPP_CLOUD' && c.environment === 'PRODUCTION');
    const custs = D.where('customers', c => c.customer_type === 'PERSON' && c.phone).slice(0, 300);
    const TXT = ['Hola, ¿tienen cuy entero para mañana?', 'Quisiera 2 cuyes y 1 caldo de 1 L', '¿Hacen delivery a Surco?', 'Ya hice el Yape, te envío la captura', '¿A qué hora llega mi pedido?', 'Buenas, precio del conejo entero por favor', 'Gracias, todo llegó bien', '¿Tienen bondiola por kilo?'];
    for (let i = 0; i < 70; i++) { const c = U.pick(r, WAc); const cu = U.pick(r, custs); const d = G.date.add(T0, Math.floor(r() * 10)); const wamid = 'wamid.HBgL' + detTok(r, 24); ev('we-WA', { object: 'whatsapp_business_account', entry: [{ id: c.config.waba_id, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: c.config.display_number.replace('+', ''), phone_number_id: c.config.phone_number_id }, messages: [{ from: cu.phone.replace('+', ''), id: wamid, type: 'text', text: { body: U.pick(r, TXT) } }] } }] }] }, tm(d), { key: wamid, dups: r() < 0.06 ? 1 : 0, result: `Mensaje de ${cu.phone} entregado a CRM` }); }
    // GPS, delivery, OSE
    for (let i = 0; i < 24; i++) { const d = G.date.add(T0, Math.floor(r() * 10)); const v = U.pick(r, D.all('vehicles')); ev('we-GPS', { id: 'gps-' + detTok(r, 10), type: U.pick(r, ['position', 'position', 'ignition_off', 'overspeed']), plate: v ? v.plate : 'ABC-123', lat: -12.1 - r() * 0.15, lng: -76.95 - r() * 0.1 }, tm(d), { result: 'Posición registrada' }); }
    for (let i = 0; i < 10; i++) { const d = G.date.add(T0, Math.floor(r() * 10)); ev('we-DLV', { id: 'dlv-' + detTok(r, 10), status: U.pick(r, ['picked_up', 'delivered', 'delivered', 'failed_attempt']), tracking: 'TRK' + detTok(r, 8) }, tm(d), { result: 'Estado del envío actualizado' }); }
    // casos de control: firma inválida, pedido inexistente, módulo apagado
    ev('we-MP-DG', { id: '1329990001', type: 'payment', data: { id: '1329990001', status: 'approved', transaction_amount: 250, external_reference: 'P-000999' } }, G.date.add(G.TODAY, -1) + 'T23:14:05', { badSig: true, patch: { status: 'REJECTED', http_status: 401, processed_at: null, attempts: 0, last_error: 'RN-INT-04: firma ausente o inválida; no se procesa.', headers: { 'content-type': 'application/json', 'x-forwarded-for': '45.155.204.17', 'user-agent': 'python-requests/2.31' } } });
    ev('we-MP-DG', { id: '1329990077', type: 'payment', data: { id: '1329990077', status: 'approved', transaction_amount: 96.5, external_reference: 'P-099871' } }, G.TODAY + 'T08:02:11', { patch: { status: 'FAILED', attempts: 5, processed_at: null, last_error: 'No existe el pedido P-099871 del pago 1329990077.' } });
    for (let i = 0; i < 2; i++) ev('we-TEL', { id: 'CA' + detTok(r, 30), CallStatus: 'completed', From: '+51987' + U.pad(Math.floor(r() * 999999), 6) }, tm(G.date.add(G.TODAY, -i - 1)), { patch: { status: 'IGNORED', processed_at: null, attempts: 0, last_error: 'RN-INT-14: el módulo TEL está apagado; se guarda y no se procesa.' } });
    // eventos antiguos (para la depuración por retención)
    for (let i = 0; i < 8; i++) ev('we-GPS', { id: 'gps-old-' + i, type: 'position', plate: 'AWK-482' }, `2026-0${3 + (i % 2)}-1${i}T10:00:00`, { result: 'Posición registrada' });

    /* outbox */
    const OB = (o) => { const m = ins('outbox_messages', Object.assign({ number: D.next('OB', 'OB-', 6), status: 'SENT', attempts: 1, next_attempt_at: null, last_error: null, tries: [], idempotency_key: 'ob-' + detTok(r, 24).toLowerCase() }, o)); return m; };
    const recent = D.where('sales_orders', o => o.confirmed_at && o.confirmed_at.slice(0, 10) >= G.date.add(G.TODAY, -3) && o.channel === 'WHATSAPP').slice(0, 90);
    for (const o of recent) { const c = waConnectorFor(o); if (!c) continue; const at = o.confirmed_at.length > 16 ? o.confirmed_at.slice(0, 19) : o.confirmed_at.slice(0, 16) + ':05'; OB({ connector_id: c.id, module: 'CRM', kind: 'MESSAGE', event: 'order.confirmed', payload: { to: o.contact_phone, template: 'confirmacion_pedido', order: o.number }, ref: o.number, created_at: at, sent_at: addSec(at, 1 + Math.floor(r() * 4)), provider_ref: 'wamid.HBgL' + detTok(r, 20), tries: [{ at, ok: true }] }); }
    const docs = D.where('sales_documents', d => d.issue_date >= G.date.add(G.TODAY, -2)).slice(0, 40);
    for (const d of docs) OB({ connector_id: 'ic-OSE-PSE', module: 'FAC', kind: 'EINVOICE', event: 'document.issued', payload: { document_id: d.id, full_number: d.full_number }, ref: d.full_number, created_at: d.issue_date + 'T21:00:00', sent_at: d.issue_date + 'T21:00:04', provider_ref: 'CDR-0', tries: [{ at: d.issue_date + 'T21:00:00', ok: true }] });
    for (let i = 0; i < 7; i++) { const d = G.date.add(G.TODAY, -i); OB({ connector_id: 'ic-WOO-DG', module: 'WEB', kind: 'SYNC', event: 'stock.sync', payload: { items: 38 + i }, ref: 'Stock ' + F.date(d), created_at: d + 'T06:00:00', sent_at: d + 'T06:00:09', provider_ref: 'OK', tries: [{ at: d + 'T06:00:00', ok: true }] }); }
    const DEV = ['order.confirmed', 'order.delivered', 'payment.confirmed', 'document.accepted', 'stock.moved', 'lot.released', 'wave.released'];
    for (let i = 0; i < 30; i++) { const d = G.date.add(G.TODAY, -Math.floor(r() * 3)); const at = tm(d); OB({ connector_id: 'ic-SMTP', module: 'INT', kind: 'DOMAIN_EVENT', event: U.pick(r, DEV), payload: { source: 'aycha' }, ref: null, created_at: at, sent_at: addSec(at, 0.2), provider_ref: 'cola interna', tries: [{ at, ok: true }] }); }
    // reintentando (número de Marca 3 con límite de envío) y cola muerta
    const m3 = D.find('integration_connectors', c => c.provider === 'WHATSAPP_CLOUD' && c.brand_id === 'br-M3');
    const o3 = D.where('sales_orders', o => o.brand_id === 'br-M3' && o.status === 'CONFIRMED').slice(0, 3);
    o3.forEach((o, k) => { const at = G.TODAY + 'T09:1' + k + ':00'; const n = 2 + k; const tries = []; let t = at; for (let j = 1; j <= n; j++) { tries.push({ at: t, ok: false, error: 'HTTP 429: límite de mensajes por segundo del número', delay: I.delay(j) }); t = addSec(t, I.delay(j)); } OB({ connector_id: (m3 || {}).id || 'ic-SMTP', module: 'CRM', kind: 'MESSAGE', event: 'order.confirmed', payload: { to: o.contact_phone, template: 'confirmacion_pedido', order: o.number }, ref: o.number, status: 'RETRYING', attempts: n, created_at: at, sent_at: null, next_attempt_at: t, last_error: 'HTTP 429: límite de mensajes por segundo del número', tries }); });
    const deadCase = (cid, module, kind, event, ref, payload, at, err) => { const tries = []; let t = at; for (let j = 1; j <= 8; j++) { tries.push({ at: t, ok: false, error: err, delay: j < 8 ? I.delay(j) : null }); if (j < 8) t = addSec(t, I.delay(j)); } return OB({ connector_id: cid, module, kind, event, payload, ref, status: 'DEAD', attempts: 8, created_at: at, dead_at: t, sent_at: null, last_error: err, tries }); };
    const od = D.where('sales_orders', o => o.brand_id === 'br-M3' && ['CONFIRMED', 'IN_PREPARATION'].includes(o.status))[3] || recent[0];
    if (od && m3) deadCase(m3.id, 'CRM', 'MESSAGE', 'order.confirmed', od.number, { to: od.contact_phone, template: 'confirmacion_pedido', order: od.number }, G.date.add(G.TODAY, -1) + 'T16:20:00', 'HTTP 400: plantilla «confirmacion_pedido» pausada por calidad baja');
    const dd = D.where('sales_documents', d => d.doc_type === 'RECEIPT' && d.issue_date === G.date.add(G.TODAY, -1))[0];
    if (dd) deadCase('ic-OSE-PSE', 'FAC', 'EINVOICE', 'document.issued', dd.full_number, { document_id: dd.id, full_number: dd.full_number }, G.date.add(G.TODAY, -1) + 'T21:00:00', 'Tiempo de espera agotado (OSE no respondió en 30 s)');
    // outbox antiguo enviado (depuración)
    for (let i = 0; i < 12; i++) OB({ connector_id: 'ic-SMTP', module: 'INT', kind: 'DOMAIN_EVENT', event: 'order.delivered', payload: {}, created_at: `2026-03-${U.pad(2 + i, 2)}T10:00:00`, sent_at: `2026-03-${U.pad(2 + i, 2)}T10:00:01`, tries: [] });

    /* corridas programadas */
    const RUN = (cid, job, at, status, ok, failed, detail, by = 'Programador de tareas') => ins('integration_runs', { connector_id: cid, job, started_at: at, finished_at: addSec(at, 3 + Math.floor(r() * 40)), status, items_ok: ok, items_failed: failed, detail, triggered_by: by });
    for (let d = '2026-09-01'; d <= G.TODAY; d = G.date.add(d, 1)) {
      if (G.mae && G.mae.isBusinessDay(d)) {
        if (d === '2026-10-06') { for (let k = 0; k < 3; k++) RUN('ic-FX-SUNAT', 'FX_DAILY', `${d}T09:${U.pad(k * 15, 2)}:00`, 'FAILED', 0, 1, 'El servicio de tipo de cambio no respondió (HTTP 504)'); }
        else RUN('ic-FX-SUNAT', 'FX_DAILY', d + 'T09:00:00', 'COMPLETED', 1, 0, `Tipo de cambio del ${F.date(d)} cargado`);
      }
      if (d >= G.date.add(G.TODAY, -9)) {
        for (const [cid, pl] of [['ic-GADS', 'GOOGLE'], ['ic-META-ADS', 'META'], ['ic-TT-ADS', 'TIKTOK']]) { const n = D.where('ad_campaigns', x => x.platform === pl).length; RUN(cid, 'ADS_SPEND_IMPORT', d + 'T06:' + U.pad(10 + (pl.length % 9), 2) + ':00', pl === 'TIKTOK' && d === G.date.add(G.TODAY, -3) ? 'PARTIAL' : 'COMPLETED', n, pl === 'TIKTOK' && d === G.date.add(G.TODAY, -3) ? 1 : 0, pl === 'TIKTOK' && d === G.date.add(G.TODAY, -3) ? '1 campaña sin datos del día (la plataforma aún no consolidaba)' : `${n} campañas · gasto de ${F.date(G.date.add(d, -1))}`); }
        RUN('ic-WOO-DG', 'WOO_STOCK_SYNC', d + 'T06:00:00', 'COMPLETED', 38, 0, '38 productos con stock enviados a donguando.com');
        RUN('ic-GRJ-API', 'GRJ_LOTS_SYNC', d + 'T05:30:00', 'COMPLETED', 2 + Math.floor(r() * 3), 0, 'Lotes de la granja sincronizados');
      }
    }
    RUN('ic-WOO-DG', 'WOO_CATALOG_SYNC', G.date.add(G.TODAY, -2) + 'T22:00:00', 'PARTIAL', 21, 2, '2 productos sin precio web no se publicaron (RN-CAT-05)', 'Lucía Paredes Gil');

    /* notificaciones */
    const N = (uid, at, type, severity, title, body, ref, module, read) => ins('notifications', { user_id: uid, title, body, ref, tone: ({ CRITICAL: 'bad', WARNING: 'warn', OK: 'ok' })[severity] || 'info', severity, type, module, channels: { in_app: true, email: severity === 'CRITICAL', push: severity === 'CRITICAL' }, in_app: true, read_at: read ? addSec(at, 900) : null, at });
    const us = role => D.where('users', u => u.role === role && u.status === 'ACTIVE');
    const deadMsgs = D.where('outbox_messages', m => m.status === 'DEAD');
    for (const u of [...us('ADMIN_SISTEMA'), ...us('GERENTE')]) {
      for (const m of deadMsgs) N(u.id, m.dead_at, 'INTEGRATIONS', 'CRITICAL', `Mensaje ${m.number} en la cola muerta`, `${connName(m.connector_id)} falló 8 veces: ${m.last_error}.`, { screen: 'INT-07', params: { id: m.id } }, 'INT', false);
      N(u.id, G.TODAY + 'T07:42:00', 'INTEGRATIONS', 'CRITICAL', 'Balanza de producción · Local 2 en error', '3 fallos seguidos: Puerto COM4 sin respuesta (RN-INT-19).', { screen: 'INT-02', params: { id: 'ic-SCALE-L2' } }, 'INT', false);
      N(u.id, G.TODAY + 'T08:00:00', 'INTEGRATIONS', 'WARNING', 'Credenciales por vencer', 'El token de Meta Ads vence en 4 días y el de TikTok Ads en 6 (RN-INT-20).', { screen: 'INT-03' }, 'INT', false);
      N(u.id, G.date.add(G.TODAY, -1) + 'T23:14:06', 'SECURITY', 'WARNING', 'Webhook rechazado por firma inválida', 'Un intento contra el endpoint de Mercado Pago desde 45.155.204.17 fue rechazado (RN-INT-04).', { screen: 'INT-05' }, 'INT', true);
    }
    for (const u of us('ADMINISTRACION')) { N(u.id, '2026-10-06T09:31:00', 'INTEGRATIONS', 'WARNING', 'Carga el tipo de cambio a mano', 'La carga automática desde SUNAT falló 3 veces hoy (RN-MAE-14).', { screen: 'MAE-05' }, 'MAE', false); N(u.id, G.TODAY + 'T08:02:30', 'PAYMENTS', 'WARNING', 'Pago de Mercado Pago sin pedido', 'El pago 1329990077 por S/ 96,50 no encontró el pedido P-099871.', { screen: 'INT-05' }, 'INT', false); }
    for (const u of us('GERENTE')) { N(u.id, G.TODAY + 'T09:05:00', 'APPROVALS', 'INFO', 'Exportación por aprobar', 'Supervisora de ventas pidió exportar contactos de clientes con teléfono.', { screen: 'AUD-05' }, 'AUD', false); N(u.id, '2026-10-01T08:00:00', 'SECURITY', 'INFO', 'Revisión trimestral de accesos', 'Inicia la revisión de accesos del 4.º trimestre (RN-AUD-10).', { screen: 'AUD-08' }, 'AUD', true); }
    for (const u of us('CONTADORA')) N(u.id, G.date.add(G.TODAY, -1) + 'T21:30:00', 'DOCUMENTS', 'CRITICAL', 'Boleta sin enviar al OSE', 'Una boleta del 09/10 está en la cola muerta del outbox.', { screen: 'INT-07' }, 'FAC', false);
    // notificaciones antiguas ya leídas (más de 90 días): candidatas a depuración
    for (const u of D.where('users', u => ['GERENTE', 'ADMIN_SISTEMA', 'ADMINISTRACION'].includes(u.role))) for (let i = 0; i < 6; i++) N(u.id, `2026-0${5 + (i % 2)}-${U.pad(3 + i * 4, 2)}T10:00:00`, 'ORDERS', 'INFO', 'Resumen diario de pedidos', 'Pedidos del día cerrados.', null, 'PED', true);

    /* archivos adjuntos */
    const FA = (entity, entity_id, file_name, size, cls, at, by, o = {}) => ins('file_attachments', Object.assign({ entity, entity_id, file_name, ext: file_name.split('.').pop().toUpperCase().replace('JPEG', 'JPG'), size_bytes: size, sha256: sha256(file_name + entity_id + size), classification: cls, storage_key: `s3://aycha-dg-files/${entity}/${entity_id}/${sha256(file_name + entity_id).slice(0, 16)}.${file_name.split('.').pop()}`, status: 'ACTIVE', uploaded_by: by, uploaded_at: at, links: [] }, o));
    const deliv = D.where('sales_orders', o => o.status === 'DELIVERED' || o.status === 'CLOSED').slice(-6);
    deliv.forEach((o, k) => FA('sales_orders', o.id, `entrega-${o.number}.jpg`, 1200000 + k * 210000, 'INTERNAL', (o.delivered_at || G.TODAY + 'T12:00').slice(0, 16), U.pick(r, ['Pedro Condori Ari', 'Hugo Ticona Laura', 'Julio Choque Mena'])));
    D.where('payments', p => p.payment_method_id === 'pm-YAPE').slice(-4).forEach((p, k) => FA('payments', p.id, `yape-${p.reference || p.number}.png`, 380000 + k * 41000, 'CONFIDENTIAL', String(p.paid_at).slice(0, 16), 'Ana Torres Lazo'));
    D.where('sales_documents', d => d.doc_type === 'INVOICE').slice(-3).forEach(d => { FA('sales_documents', d.id, `${d.full_number}.xml`, 18400, 'INTERNAL', d.issue_date + 'T21:00', 'Sistema'); FA('sales_documents', d.id, `${d.full_number}.pdf`, 96200, 'INTERNAL', d.issue_date + 'T21:00', 'Sistema'); });
    D.all('employees').slice(4, 8).forEach(e => FA('employees', e.id, `dni-${e.doc_number}.pdf`, 640000, 'PERSONAL_DATA', '2026-08-20T10:00', 'Gabriela Soto Ruiz'));
    FA('suppliers', 'su-GRANJA', 'contrato-suministro-granja-2026.pdf', 2400000, 'CONFIDENTIAL', '2026-07-01T11:00', 'Carmen Huamán Soto');
    FA('integration_runs', 'fx', 'tc-sunat-agosto-2026.csv', 4200, 'INTERNAL', '2026-09-01T09:10', 'Carmen Huamán Soto');
    FA('sales_orders', (deliv[0] || {}).id || 'x', 'foto-duplicada.jpg', 900000, 'INTERNAL', '2026-10-05T14:00', 'Hugo Ticona Laura', { status: 'DELETED', deleted_reason: 'Foto duplicada de la misma entrega', deleted_by: 'Luis Ccahuana Rojas', deleted_at: '2026-10-05T15:20' });

    /* claves de idempotencia (app del repartidor y web) */
    for (const o of deliv.slice(0, 6)) { const at = (o.delivered_at || G.TODAY + 'T12:00').slice(0, 16) + ':00'; ins('idempotency_keys', { key: 'drv-' + detTok(r, 20).toLowerCase(), scope: `POST /api/v1/orders/${o.number}/delivered`, request_hash: sha256(o.id), status: 'COMPLETED', response_code: 201, response_body: { order: o.number, status: 'DELIVERED' }, user_id: (D.find('users', u => u.role === 'REPARTIDOR') || {}).id, created_at: at, completed_at: addSec(at, 1), expires_at: addSec(at, 86400), replays: r() < 0.4 ? 1 : 0 }); }
    ins('idempotency_keys', { key: 'web-' + detTok(r, 20).toLowerCase(), scope: 'POST /api/v1/payments', request_hash: sha256('x'), status: 'EXPIRED', response_code: 201, response_body: { ok: true }, created_at: '2026-10-02T10:00:00', completed_at: '2026-10-02T10:00:01', expires_at: '2026-10-03T10:00:00', replays: 0 });
  }, 'INT historia');

  /* =====================================================================
     Pantallas
     ===================================================================== */
  const canMng = () => G.can('int.connector.manage');
  const wrap = fn => { try { return fn(); } catch (e) { toast(e.message, 'bad'); return null; } };
  const sel = (options, value, onChange, label) => { const s = h('select', { class: 'input', attrs: { 'aria-label': label || 'Elegir' } }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l))); s.addEventListener('change', () => onChange(s.value)); return s; };
  const pre = s => h('pre', { class: 'mono small', style: 'white-space:pre-wrap;word-break:break-all;background:var(--surface-2, var(--bg));border:1px solid var(--line);border-radius:6px;padding:8px;max-height:260px;overflow:auto;margin:0' }, s);
  const pretty = raw => { try { return JSON.stringify(JSON.parse(raw), null, 2); } catch (e) { return raw; } };
  const envBadge = e => e === 'SANDBOX' ? badge('Prueba', 'info') : badge('Producción', '');
  const reasonModal = (title, label, onOk) => modal(title, (bd, close) => bd.appendChild(form({ id: 'intreason', fields: [{ key: 'reason', label, type: 'textarea', required: true, help: 'Mínimo 10 caracteres. Queda en la bitácora.' }], submitLabel: 'Confirmar', onCancel: close, onSubmit: v => { onOk(v.reason, close); return true; } })));

  /* ---------- INT-01 Conectores ---------- */
  function renderConnectors(el) {
    const body = page(el, { code: 'INT-01', title: 'Conectores', sub: 'Cada proveedor externo detrás de su interfaz, con adaptador falso en el entorno de prueba (RN-INT-01). Estado, última conexión correcta y último error.' });
    const cs = D.all('integration_connectors');
    body.appendChild(kpis([
      { label: 'Conectores activos', value: `${cs.filter(c => c.status === 'ACTIVE').length} de ${cs.length}` },
      { label: 'En error', value: F.num(cs.filter(c => c.status === 'ERROR').length), tone: cs.some(c => c.status === 'ERROR') ? 'bad' : 'ok', sub: 'KPI-INT-05', onClick: () => G.go('INT-12') },
      { label: 'Números de WhatsApp', value: F.num(cs.filter(c => c.provider === 'WHATSAPP_CLOUD' && c.environment === 'PRODUCTION').length), sub: 'API oficial con coexistencia' },
      { label: 'Entorno de prueba', value: F.num(cs.filter(c => c.environment === 'SANDBOX').length), sub: 'adaptador falso' },
    ]));
    body.appendChild(table({ id: 'int01', rows: cs, onRow: c => G.go('INT-02', { id: c.id }), pageSize: 30,
      columns: [
        { key: 'name', label: 'Conector', render: c => h('div', null, h('b', null, c.name), h('div', { class: 'small muted mono' }, c.code)) },
        { key: 'kind', label: 'Tipo', value: c => kindName(c.kind) },
        { key: 'interface', label: 'Interfaz · adaptador', render: c => h('div', { class: 'small' }, c.interface, h('div', { class: 'muted mono' }, c.adapter === 'FAKE' ? 'Fake' + c.interface : c.adapter)) },
        { key: 'brand_id', label: 'Marca · local', value: c => [c.brand_id ? G.brandName(c.brand_id) : null, c.establishment_id ? G.siteName(c.establishment_id) : null].filter(Boolean).join(' · ') || 'Empresa' },
        { key: 'environment', label: 'Entorno', render: c => envBadge(c.environment) },
        { key: 'owner_module', label: 'Módulo', mono: true },
        { key: 'last_ok_at', label: 'Última conexión correcta', render: c => F.datetime(c.last_ok_at) },
        { key: 'last_error', label: 'Último error', render: c => c.last_error ? h('span', { class: 'small', style: 'color:var(--bad)' }, `${F.datetime(c.last_error_at)} · ${c.last_error}`) : '—' },
        { key: 'status', label: 'Estado', render: c => st(c.status) },
      ],
      filters: [{ key: 'kind', label: 'Tipo', options: KINDS.map(k => [k[0], k[1]]) }, { key: 'brand_id', label: 'Marca', options: D.all('brands').map(b => [b.id, G.brandName(b.id)]) }, { key: 'environment', label: 'Entorno', options: [['PRODUCTION', 'Producción'], ['SANDBOX', 'Prueba']] }, { key: 'status', label: 'Estado', options: Object.keys(ST).slice(0, 4).map(k => [k, ST[k][0]]) }] }));
  }

  /* ---------- INT-02 Ficha del conector ---------- */
  function renderConnector(el, p = {}) {
    const c = conn(p.id) || D.all('integration_connectors')[0];
    const acts = [];
    if (canMng()) {
      acts.push({ label: 'Probar conexión', kind: 'primary', onClick: () => wrap(() => { const r = I.testConnection(c.id); toast(r.msg, r.ok ? 'ok' : 'bad'); G.refresh(); }) });
      acts.push({ label: c.status === 'DISABLED' ? 'Activar' : 'Desactivar', onClick: () => reasonModal(c.status === 'DISABLED' ? 'Activar conector' : 'Desactivar conector', 'Motivo', (reason, close) => wrap(() => { if (c.status === 'DISABLED' && !ownerOn(c)) G.fail('RN-INT-14', `El módulo ${c.owner_module} está apagado (RN-PLT-07): actívalo antes en PLT-12.`); if (c.status === 'DISABLED' && c.environment === 'PRODUCTION' && c.adapter === 'FAKE') G.fail('RN-INT-01', 'El adaptador falso no se activa en producción.'); if (reason.trim().length < 10) G.fail('RN-INT-10', 'El motivo tiene al menos 10 caracteres.'); D.update('integration_connectors', c.id, { status: c.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED', status_reason: reason }); close(); toast('Estado del conector actualizado', 'ok'); G.refresh(); })) });
    } else acts.push({ label: 'Probar conexión', onClick: () => G.require('int.connector.manage', () => { }) });
    const body = page(el, { code: 'INT-02', title: c.name, sub: `${kindName(c.kind)} · ${c.interface} · módulo dueño ${c.owner_module}`, actions: [{ label: 'Conectores', onClick: () => G.go('INT-01') }, ...acts] });
    if (c.status === 'ERROR') body.appendChild(notice(`En error tras ${c.consecutive_failures} fallos seguidos (RN-INT-19). La siguiente conexión correcta lo devuelve a Activo.`, 'bad'));
    if (!ownerOn(c)) body.appendChild(notice(`El módulo ${c.owner_module} está apagado: sus webhooks se guardan como ignorados y no se crean mensajes salientes (RN-INT-14).`, 'warn'));
    const grid = h('div', { class: 'grid c2' });
    grid.appendChild(card('Configuración (no secreta)', dl([['Código', c.code], ['Proveedor', c.provider], ['Interfaz', c.interface], ['Adaptador', c.adapter === 'FAKE' ? 'Fake' + c.interface + ' (falso)' : c.adapter], ['Entorno', envBadge(c.environment)], ['Módulo dueño', c.owner_module], ['Marca', c.brand_id ? G.brandFull(c.brand_id) : 'Empresa'], ['Local', c.establishment_id ? G.siteName(c.establishment_id) : '—'],
      ...Object.entries(c.config || {}).map(([k, v]) => [k.replace(/_/g, ' '), String(v)]), ['Estado', st(c.status)], ['Latencia', c.latency_ms ? c.latency_ms + ' ms' : '—'], ['Última conexión correcta', F.datetime(c.last_ok_at)], ['Fallos seguidos', String(c.consecutive_failures || 0)]])));
    const side = h('div', { class: 'stack' });
    const creds = D.where('integration_credentials', x => x.connector_id === c.id && x.status === 'ACTIVE');
    side.appendChild(card('Credenciales', creds.length ? dl(creds.map(x => [x.name, `${mask(x.last4)} · v${x.version}${x.expires_at ? ' · vence ' + F.date(x.expires_at) : ''}`])) : h('p', { class: 'muted' }, 'Sin credenciales.'), { actions: [btn('Gestionar', () => G.go('INT-03', { connector: c.id }), { sm: true })] }));
    const eps = D.where('webhook_endpoints', e => e.connector_id === c.id);
    if (eps.length) side.appendChild(card('Webhooks de entrada', dl(eps.map(e => [e.name, h('span', { class: 'mono small', style: 'word-break:break-all' }, e.url)]))));
    const om = D.where('outbox_messages', m => m.connector_id === c.id);
    side.appendChild(card('Actividad', dl([['Mensajes salientes', `${om.filter(m => m.status === 'SENT').length} enviados · ${om.filter(m => m.status === 'RETRYING').length} reintentando · ${om.filter(m => m.status === 'DEAD').length} en cola muerta`], ['Webhooks recibidos', String(D.where('webhook_events', w => w.connector_id === c.id).length)], ['Corridas', String(D.where('integration_runs', x => x.connector_id === c.id).length)]])));
    if (canMng()) side.appendChild(card('Demostración', h('label', { class: 'check' }, (() => { const i = h('input', { type: 'checkbox', checked: !!c.simulate_down }); i.addEventListener('change', () => { D.update('integration_connectors', c.id, { simulate_down: i.checked }, { silent: true }); toast(i.checked ? 'El proveedor no responderá: los envíos fallarán y se reintentarán' : 'El proveedor vuelve a responder', 'info'); }); return i; })(), h('span', null, 'Simular caída del proveedor (los envíos y pruebas fallan)'))));
    grid.appendChild(side);
    body.appendChild(grid);
    body.appendChild(card('Historial de errores', table({ id: 'int02err', search: false, pageSize: 10, rows: (c.errors || []).slice().reverse(), empty: 'Sin errores registrados.', columns: [{ key: 'at', label: 'Fecha y hora', render: x => F.datetime(x.at) }, { key: 'msg', label: 'Error' }] }), { flush: true }));
  }

  /* ---------- INT-03 Credenciales ---------- */
  function renderCredentials(el, p = {}) {
    const canR = G.can('int.credential.rotate');
    const body = page(el, { code: 'INT-03', title: 'Credenciales', sub: 'Secretos cifrados por la aplicación (enc:vN, clave maestra fuera de la base). Solo se muestran los últimos 4 caracteres (RN-INT-02).', actions: canR ? [{ label: 'Cargar credencial', kind: 'primary', icon: '+', onClick: () => loadDlg() }] : [] });
    const exp = I.credentialsExpiring();
    if (exp.length) body.appendChild(notice(`RN-INT-20: ${exp.map(x => `${connName(x.connector_id)} · ${x.name} vence el ${F.date(x.expires_at)}`).join('; ')}.`, 'warn'));
    const rows = D.all('integration_credentials').filter(x => !p.connector || x.connector_id === p.connector);
    body.appendChild(table({ id: 'int03', rows, pageSize: 30, sort: 'connector_id',
      columns: [
        { key: 'connector_id', label: 'Conector', value: x => connName(x.connector_id) },
        { key: 'name', label: 'Credencial', mono: true },
        { key: 'value', label: 'Valor', render: x => h('span', { class: 'mono' }, mask(x.last4)) },
        { key: 'version', label: 'Versión', align: 'r', render: x => 'v' + x.version },
        { key: 'expires_at', label: 'Vence', render: x => x.expires_at ? h('span', { style: x.status === 'ACTIVE' && G.date.diff(x.expires_at.slice(0, 10), G.TODAY) <= 7 ? 'color:var(--warn);font-weight:700' : '' }, F.date(x.expires_at) + (x.status === 'ACTIVE' ? ` (${F.days(G.date.diff(x.expires_at.slice(0, 10), G.TODAY))})` : '')) : 'No vence' },
        { key: 'created_by', label: 'Cargada por', render: x => `${x.created_by} · ${F.date(x.created_at)}` },
        { key: 'status', label: 'Estado', render: x => st(x.status) },
      ],
      filters: [{ key: 'connector_id', label: 'Conector', options: D.all('integration_connectors').map(c => [c.id, c.name]) }, { key: 'status', label: 'Estado', options: [['ACTIVE', 'Activa'], ['REVOKED', 'Revocada']] }],
      actions: x => x.status === 'ACTIVE' && canR ? [btn('Rotar', () => rotDlg(x), { sm: true }), btn('Revocar', () => reasonModal('Revocar ' + x.name, 'Motivo de la revocación', (reason, close) => wrap(() => { I.revoke(x.id, reason); close(); toast('Credencial revocada', 'ok'); G.refresh(); })), { sm: true, kind: 'ghost' })] : [] }));
    body.appendChild(card('Así la ve la API (GET /integrations/credentials)', pre(JSON.stringify(rows.filter(x => x.status === 'ACTIVE').slice(0, 3).map(I.credentialView), null, 2))));
    function loadDlg() {
      drawer('Cargar credencial', (bd, close) => bd.appendChild(form({ id: 'int03new', fields: [{ key: 'connector_id', label: 'Conector', type: 'select', options: D.all('integration_connectors').map(c => [c.id, c.name]), required: true }, { key: 'name', label: 'Nombre', required: true, placeholder: 'access_token' }, { key: 'secret', label: 'Secreto', type: 'password', required: true }, { key: 'expires_at', label: 'Vence', type: 'date' }], values: { connector_id: p.connector || 'ic-GADS' }, onCancel: close, submitLabel: 'Cifrar y guardar',
        onSubmit: v => { I.loadCredential(v); close(); toast('Credencial cifrada y guardada', 'ok'); G.refresh(); return true; } })), { code: 'INT-03' });
    }
    function rotDlg(x) {
      drawer('Rotar ' + x.name, (bd, close) => { bd.appendChild(notice(`Se crea la versión ${x.version + 1} y se revoca la ${x.version} (RN-INT-03).`, 'info')); bd.appendChild(form({ id: 'int03rot', fields: [{ key: 'secret', label: 'Secreto nuevo', type: 'password', required: true }, { key: 'expires_at', label: 'Vence', type: 'date' }], onCancel: close, submitLabel: 'Rotar', onSubmit: v => { I.rotate(x.id, v); close(); toast('Credencial rotada', 'ok'); G.refresh(); return true; } })); }, { code: 'INT-03' });
    }
  }

  /* ---------- INT-04 Webhooks de entrada ---------- */
  function renderEndpoints(el) {
    const body = page(el, { code: 'INT-04', title: 'Webhooks de entrada', sub: 'Una URL por proveedor (/hooks/{token}) con su esquema de firma. Sin firma válida se responde 401 y no se procesa (RN-INT-04).' });
    const evs = U.groupBy(D.all('webhook_events'), 'endpoint_id');
    body.appendChild(table({ id: 'int04', rows: D.all('webhook_endpoints'), search: false,
      columns: [
        { key: 'name', label: 'Endpoint', render: e => h('div', null, h('b', null, e.name), h('div', { class: 'mono small muted', style: 'word-break:break-all' }, e.url)) },
        { key: 'signature_scheme', label: 'Firma' },
        { key: 'owner_module', label: 'Módulo', mono: true, render: e => h('span', null, e.owner_module, !G.modOn(e.owner_module) ? badge(' apagado', '') : null) },
        { key: 'env', label: 'Entorno', render: e => envBadge((conn(e.connector_id) || {}).environment) },
        { key: 'n', label: 'Eventos', align: 'r', value: e => (evs[e.id] || []).length },
        { key: 'last_received_at', label: 'Último', render: e => F.datetime(e.last_received_at) },
        { key: 'status', label: 'Estado', render: e => st(e.status) },
      ],
      actions: e => [btn('Copiar URL', () => { try { navigator.clipboard.writeText(e.url); } catch (x) { } toast('URL copiada', 'ok'); }, { sm: true, kind: 'ghost' }), canMng() ? btn('Regenerar token', () => G.ui.confirm({ title: 'Regenerar token', message: `La URL actual de ${e.name} deja de funcionar en 24 horas. Actualízala en el panel del proveedor.`, confirmLabel: 'Regenerar', danger: true, onConfirm: () => wrap(() => { I.regenerateToken(e.id); toast('Token regenerado', 'ok'); G.refresh(); }) }), { sm: true }) : null] }));
  }

  /* ---------- INT-05 Bitácora de webhooks ---------- */
  function renderWebhookLog(el) {
    const body = page(el, { code: 'INT-05', title: 'Bitácora de webhooks', sub: 'Eventos recibidos tal cual llegaron: el crudo no se modifica (RN-INT-06). Los repetidos suman al contador y no se procesan dos veces (RN-INT-05).' });
    const rows = D.all('webhook_events').sort(U.by('received_at', -1));
    const k3 = G.kpi('KPI-INT-03'), k4 = G.kpi('KPI-INT-04');
    body.appendChild(kpis([
      { label: 'Recibidos (mes)', value: F.num(rows.filter(e => e.received_at >= G.date.month(G.TODAY)).length) },
      { label: 'Duplicados', value: k3 ? F.pct(k3.value, 2) : '—', sub: k3 ? `${k3.numerator} repetidos · KPI-INT-03` : '' },
      { label: 'Latencia p95', value: k4 ? fmtSec(k4.value) : '—', sub: 'meta ≤ 60 s · KPI-INT-04', tone: k4 && k4.value > 60 ? 'warn' : 'ok' },
      { label: 'Fallidos por reprocesar', value: F.num(rows.filter(e => e.status === 'FAILED').length), tone: rows.some(e => e.status === 'FAILED') ? 'bad' : '' },
      { label: 'Rechazados (firma)', value: F.num(rows.filter(e => e.status === 'REJECTED').length) },
    ]));
    body.appendChild(table({ id: 'int05', rows, onRow: e => evDrawer(e), searchText: e => e.body,
      columns: [
        { key: 'received_at', label: 'Recibido', render: e => F.datetime(e.received_at) },
        { key: 'connector_id', label: 'Conector', value: e => connName(e.connector_id) },
        { key: 'event_key', label: 'Clave', mono: true, render: e => String(e.event_key).slice(0, 22) },
        { key: 'owner_module', label: 'Módulo', mono: true },
        { key: 'duplicates', label: 'Duplic.', align: 'r' },
        { key: 'attempts', label: 'Intentos', align: 'r' },
        { key: 'lat', label: 'Proceso', align: 'r', value: e => e.processed_at ? secs(e.processed_at, e.received_at) : null, render: e => e.processed_at ? fmtSec(secs(e.processed_at, e.received_at)) : '—' },
        { key: 'status', label: 'Estado', render: e => st(e.status) },
        { key: 'last_error', label: 'Resultado o error', render: e => h('span', { class: 'small', style: e.last_error ? 'color:var(--bad)' : '' }, e.last_error || e.result || '') },
      ],
      filters: [{ key: 'status', label: 'Estado', options: ['RECEIVED', 'PROCESSED', 'FAILED', 'REJECTED', 'IGNORED'].map(s => [s, ST[s][0]]) }, { key: 'connector_id', label: 'Conector', options: [...new Set(rows.map(e => e.connector_id))].map(id => [id, connName(id)]) }, { key: 'day', label: 'Fecha', value: e => e.received_at.slice(0, 10), options: [...new Set(rows.map(e => e.received_at.slice(0, 10)))].map(d => [d, F.date(d)]) }] }));
    function evDrawer(e) {
      drawer('Webhook ' + String(e.event_key).slice(0, 24), (bd, close) => {
        bd.appendChild(dl([['Conector', connName(e.connector_id)], ['Endpoint', (D.get('webhook_endpoints', e.endpoint_id) || {}).name], ['Recibido', F.datetime(e.received_at)], ['Respuesta', `HTTP ${e.http_status} en ${e.ack_ms} ms (máx. ${G.param('int_webhook_ack_seconds') ?? 5} s)`], ['Procesado', e.processed_at ? `${F.datetime(e.processed_at)} (${fmtSec(secs(e.processed_at, e.received_at))})` : '—'], ['Intentos', `${e.attempts} de ${G.param('int_webhook_max_attempts') ?? 5}`], ['Duplicados', String(e.duplicates || 0)], ['Estado', st(e.status)], ['Resultado', e.result], ['Error', e.last_error]]));
        if (e.status === 'FAILED') bd.appendChild(h('div', { class: 'row', style: 'margin:10px 0' }, btn('Reprocesar', () => G.require('int.webhook.reprocess', () => wrap(() => { const r = I.reprocess(e.id); toast(r.status === 'PROCESSED' ? 'Webhook procesado' : 'Volvió a fallar: ' + r.last_error, r.status === 'PROCESSED' ? 'ok' : 'bad'); close(); G.refresh(); })), { kind: 'primary', sm: true })));
        bd.appendChild(h('h3', null, 'Cabeceras')); bd.appendChild(pre(JSON.stringify(e.headers, null, 2)));
        bd.appendChild(h('h3', null, 'Cuerpo crudo')); bd.appendChild(pre(pretty(e.body)));
      }, { code: 'INT-05', wide: true });
    }
  }

  /* ---------- INT-06 Mensajes salientes ---------- */
  function renderOutbox(el) {
    const body = page(el, { code: 'INT-06', title: 'Mensajes salientes', sub: 'Outbox: cada efecto externo se registra con el cambio de negocio y se reintenta con espera exponencial (30 s × 2^(n−1), tope 1 h) hasta enviarse o caer en la cola muerta (RN-INT-08, RN-INT-09).', actions: [{ label: 'Procesar la cola', kind: 'primary', onClick: () => { const n = I.runOutbox({ all: true }); toast(`${n} mensaje(s) procesados`, 'ok'); G.refresh(); } }] });
    const rows = D.all('outbox_messages').sort(U.by('created_at', -1));
    const k1 = G.kpi('KPI-INT-01');
    body.appendChild(kpis([
      { label: 'Éxito de entrega', value: k1 ? F.pct(k1.value, 2) : '—', sub: k1 ? `${k1.numerator} de ${k1.denominator} · meta ≥ 99,5 %` : '', tone: k1 && k1.value < 99.5 ? 'warn' : 'ok' },
      { label: 'Pendientes', value: F.num(rows.filter(m => m.status === 'PENDING').length) },
      { label: 'Reintentando', value: F.num(rows.filter(m => m.status === 'RETRYING').length), tone: rows.some(m => m.status === 'RETRYING') ? 'warn' : '' },
      { label: 'Cola muerta', value: F.num(rows.filter(m => m.status === 'DEAD').length), tone: rows.some(m => m.status === 'DEAD') ? 'bad' : 'ok', onClick: () => G.go('INT-07') },
    ]));
    const de = D.all('domain_events').sort(U.by('at', -1));
    body.appendChild(tabs([
      { key: 'ob', label: 'Outbox', count: rows.length, render: pn => pn.appendChild(table({ id: 'int06', rows, onRow: m => obDrawer(m),
        columns: [
          { key: 'number', label: 'N.º', mono: true },
          { key: 'created_at', label: 'Creado', render: m => F.datetime(m.created_at) },
          { key: 'module', label: 'Módulo', mono: true },
          { key: 'event', label: 'Evento' },
          { key: 'kind', label: 'Tipo', value: m => ({ MESSAGE: 'Mensaje', EINVOICE: 'Comprobante', SYNC: 'Sincronización', DOMAIN_EVENT: 'Evento de dominio' })[m.kind] || m.kind },
          { key: 'connector_id', label: 'Conector', value: m => connName(m.connector_id) },
          { key: 'ref', label: 'Referencia', mono: true },
          { key: 'attempts', label: 'Intentos', align: 'r' },
          { key: 'next_attempt_at', label: 'Próximo intento', render: m => ['PENDING', 'RETRYING'].includes(m.status) ? F.datetime(m.next_attempt_at) : '—' },
          { key: 'status', label: 'Estado', render: m => st(m.status) },
          { key: 'last_error', label: 'Último error', render: m => h('span', { class: 'small', style: 'color:var(--bad)' }, m.last_error || '') },
        ],
        filters: [{ key: 'status', label: 'Estado', options: ['PENDING', 'RETRYING', 'SENT', 'DEAD', 'CANCELLED'].map(s => [s, ST[s][0]]) }, { key: 'connector_id', label: 'Conector', options: [...new Set(rows.map(m => m.connector_id))].map(id => [id, connName(id)]) }, { key: 'module', label: 'Módulo', options: [...new Set(rows.map(m => m.module))].map(m => [m, m]) }, { key: 'day', label: 'Fecha', value: m => String(m.created_at).slice(0, 10), options: [...new Set(rows.map(m => String(m.created_at).slice(0, 10)))].map(d => [d, F.date(d)]) }] })) },
      { key: 'de', label: 'Eventos de dominio (núcleo)', count: de.length, render: pn => { pn.appendChild(notice('Eventos que emiten los módulos con G.events (02-mapa §3). Se publican en la cola como DOMAIN_EVENT para sus suscriptores.', 'info')); pn.appendChild(table({ id: 'int06de', rows: de, empty: 'Aún no hay eventos en esta sesión: confirma un pedido o registra un cobro y vuelve.', onRow: x => drawer(x.name, bd => bd.appendChild(pre(JSON.stringify(x.payload, null, 2))), { code: 'INT-06' }), columns: [{ key: 'at', label: 'Fecha y hora', render: x => F.datetime(x.at) }, { key: 'name', label: 'Evento', mono: true }, { key: 'user', label: 'Usuario' }, { key: 'payload', label: 'Datos', value: x => JSON.stringify(x.payload).slice(0, 90) }, { key: 'status', label: 'Estado', render: x => st(x.status === 'DISPATCHED' ? 'SENT' : x.status) }], filters: [{ key: 'name', label: 'Evento', options: [...new Set(de.map(x => x.name))].map(n => [n, n]) }] })); } },
    ]));
  }
  function obDrawer(m) {
    drawer('Mensaje ' + m.number, (bd, close) => {
      bd.appendChild(dl([['Conector', connName(m.connector_id)], ['Módulo', m.module], ['Evento', m.event], ['Referencia', m.ref], ['Clave de idempotencia', h('span', { class: 'mono small' }, m.idempotency_key)], ['Estado', st(m.status)], ['Intentos', `${m.attempts} de ${G.param('int_outbox_max_attempts') ?? 8}`], ['Próximo intento', ['PENDING', 'RETRYING'].includes(m.status) ? F.datetime(m.next_attempt_at) : '—'], ['Enviado', F.datetime(m.sent_at)], ['Respuesta del proveedor', m.provider_ref], ['Último error', m.last_error], m.cancel_reason ? ['Motivo de cancelación', m.cancel_reason] : null]));
      if (m.status === 'DEAD' && G.can('int.outbox.retry')) bd.appendChild(h('div', { class: 'row', style: 'margin:10px 0' }, btn('Reintentar', () => { close(); deadAction(m, 'retry'); }, { kind: 'primary', sm: true }), btn('Cancelar', () => { close(); deadAction(m, 'cancel'); }, { kind: 'danger', sm: true })));
      bd.appendChild(h('h3', null, 'Intentos'));
      bd.appendChild(h('div', { class: 'timeline' }, (m.tries || []).map((t, i) => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, String(t.at).slice(11, 19)), h('span', { class: 'dot', style: t.ok ? 'background:var(--ok)' : 'background:var(--bad)' }), h('div', { class: 'small' }, h('b', null, `Intento ${i + 1}: ${t.ok ? 'enviado' : 'falló'}`), t.error ? ' · ' + t.error : '', t.delay ? h('div', { class: 'muted' }, `Siguiente en ${fmtSec(t.delay)}`) : null)))));
      (m.manual || []).forEach(x => bd.appendChild(notice(`${x.action === 'RETRY' ? 'Reintento' : 'Cancelación'} manual de ${x.by} el ${F.datetime(x.at)}: ${x.reason}`, 'info')));
      bd.appendChild(h('h3', null, 'Contenido')); bd.appendChild(pre(JSON.stringify(m.payload, null, 2)));
    }, { code: 'INT-06' });
  }
  function deadAction(m, what) {
    reasonModal(what === 'retry' ? `Reintentar ${m.number}` : `Cancelar ${m.number}`, 'Motivo', (reason, close) => wrap(() => {
      const r = what === 'retry' ? I.retryDead(m.id, reason) : I.cancelDead(m.id, reason);
      close(); toast(what === 'retry' ? (r.status === 'SENT' ? 'Mensaje enviado' : 'Volvió a fallar: sigue en la cola muerta') : 'Mensaje cancelado', r.status === 'DEAD' ? 'bad' : 'ok'); G.refresh();
    }));
  }

  /* ---------- INT-07 Cola muerta ---------- */
  function renderDead(el) {
    const body = page(el, { code: 'INT-07', title: 'Cola muerta', sub: 'Mensajes que agotaron los ' + (G.param('int_outbox_max_attempts') ?? 8) + ' intentos. Solo se reintentan o cancelan a mano, con motivo de al menos 10 caracteres (RN-INT-10).' });
    const rows = D.where('outbox_messages', m => m.status === 'DEAD' || (m.manual && m.manual.length));
    if (!G.can('int.outbox.retry')) body.appendChild(notice(`Tu rol (${G.roleName()}) no tiene el permiso int.outbox.retry: solo puedes consultar.`, 'info'));
    body.appendChild(kpis([{ label: 'En cola muerta', value: F.num(rows.filter(m => m.status === 'DEAD').length), sub: 'KPI-INT-02 · meta 0', tone: rows.some(m => m.status === 'DEAD') ? 'bad' : 'ok' }, { label: 'Atendidos a mano', value: F.num(rows.filter(m => m.status !== 'DEAD').length) }]));
    body.appendChild(table({ id: 'int07', rows, onRow: m => obDrawer(m), search: false, empty: 'La cola muerta está vacía.',
      columns: [{ key: 'number', label: 'N.º', mono: true }, { key: 'dead_at', label: 'Cayó', render: m => F.datetime(m.dead_at) }, { key: 'connector_id', label: 'Conector', value: m => connName(m.connector_id) }, { key: 'event', label: 'Evento' }, { key: 'ref', label: 'Referencia', mono: true }, { key: 'attempts', label: 'Intentos', align: 'r' }, { key: 'last_error', label: 'Último error', render: m => h('span', { class: 'small' }, m.last_error) }, { key: 'status', label: 'Estado', render: m => st(m.status) }],
      actions: m => m.status === 'DEAD' && G.can('int.outbox.retry') ? [btn('Reintentar', () => deadAction(m, 'retry'), { sm: true, kind: 'primary' }), btn('Cancelar', () => deadAction(m, 'cancel'), { sm: true })] : [] }));
  }

  /* ---------- INT-08 Corridas programadas ---------- */
  function renderRuns(el) {
    const body = page(el, { code: 'INT-08', title: 'Corridas programadas', sub: 'Importaciones y sincronizaciones con su inicio, fin, ítems correctos y fallidos.' });
    const JOBC = [['FX_DAILY', 'FX-SUNAT'], ['ADS_SPEND_IMPORT', 'GADS'], ['ADS_SPEND_IMPORT', 'META-ADS'], ['ADS_SPEND_IMPORT', 'TT-ADS'], ['WOO_STOCK_SYNC', 'WOO-DG'], ['WOO_CATALOG_SYNC', 'WOO-DG'], ['GRJ_LOTS_SYNC', 'GRJ-API'], ['OSE_STATUS_POLL', 'OSE-PSE']];
    const rows = D.all('integration_runs').sort(U.by('started_at', -1));
    body.appendChild(card('Ejecutar ahora', h('div', { class: 'row' }, JOBC.map(([j, c]) => btn(`${JOBS[j]}${j === 'ADS_SPEND_IMPORT' ? ' · ' + connName('ic-' + c).split(' ')[0] : ''}`, () => wrap(() => { const r = I.runJob(j, 'ic-' + c); toast(`${JOBS[j]}: ${r.detail}`, r.status === 'FAILED' ? 'bad' : r.status === 'PARTIAL' ? 'warn' : 'ok'); G.refresh(); }), { sm: true })))));
    body.appendChild(table({ id: 'int08', rows,
      columns: [{ key: 'started_at', label: 'Inicio', render: x => F.datetime(x.started_at) }, { key: 'finished_at', label: 'Fin', render: x => F.datetime(x.finished_at) }, { key: 'job', label: 'Proceso', value: x => JOBS[x.job] || x.job }, { key: 'connector_id', label: 'Conector', value: x => connName(x.connector_id) }, { key: 'items_ok', label: 'Correctos', align: 'r' }, { key: 'items_failed', label: 'Fallidos', align: 'r' }, { key: 'status', label: 'Resultado', render: x => st(x.status) }, { key: 'detail', label: 'Detalle', render: x => h('span', { class: 'small' }, x.detail) }, { key: 'triggered_by', label: 'Origen' }],
      filters: [{ key: 'job', label: 'Proceso', options: Object.entries(JOBS) }, { key: 'status', label: 'Resultado', options: [['COMPLETED', 'Completada'], ['PARTIAL', 'Parcial'], ['FAILED', 'Fallida']] }] }));
  }

  /* ---------- INT-09 Centro de notificaciones ---------- */
  const goRef = ref => { if (!ref) return null; if (typeof ref === 'object' && (ref.screen || ref.code) && G.screens[ref.screen || ref.code]) return () => G.go(ref.screen || ref.code, ref.params || {}); if (typeof ref === 'string') { const m = ref.match(/^([A-Z]{3}-\d{2})(?::(.+))?$/); if (m && G.screens[m[1]]) return () => G.go(m[1], m[2] ? { id: m[2] } : {}); } return null; };
  const ntState = { scope: 'mine', sev: '' };
  function renderNotifications(el) {
    const me = G.ctx.userId();
    const body = page(el, { code: 'INT-09', title: 'Centro de notificaciones', sub: 'Avisos para ti con su severidad y enlace al registro. Solo llegan a su destinatario y respetan sus preferencias, salvo los críticos (RN-INT-15).', actions: [{ label: 'Marcar todas como leídas', onClick: () => { for (const n of D.where('notifications', n => n.user_id === me && !n.read_at)) D.update('notifications', n.id, { read_at: G.date.now() }, { silent: true }); toast('Notificaciones marcadas como leídas', 'ok'); G.refresh(); } }, { label: 'Preferencias', onClick: () => G.go('INT-10') }] });
    const admin = ['GERENTE', 'ADMIN_SISTEMA', 'AUDITOR'].includes(G.ctx.role);
    const all = D.all('notifications');
    const mine = all.filter(n => n.user_id === me && n.in_app !== false);
    body.appendChild(kpis([{ label: 'Sin leer', value: F.num(mine.filter(n => !n.read_at).length), tone: mine.some(n => !n.read_at) ? 'warn' : 'ok' }, { label: 'Críticas sin leer', value: F.num(mine.filter(n => !n.read_at && (n.severity === 'CRITICAL' || n.tone === 'bad')).length), tone: mine.some(n => !n.read_at && (n.severity === 'CRITICAL' || n.tone === 'bad')) ? 'bad' : '' }, { label: 'Recibidas (30 días)', value: F.num(mine.filter(n => n.at >= G.date.add(G.TODAY, -30)).length) }]));
    if (admin) body.appendChild(pills([['mine', 'Mis notificaciones'], ['all', 'Todas (por destinatario)']], ntState.scope, v => { ntState.scope = v; G.refresh(); }));
    const rows = (ntState.scope === 'all' && admin ? all : mine).slice().sort(U.by('at', -1));
    body.appendChild(table({ id: 'int09' + ntState.scope, rows, empty: 'No tienes notificaciones.',
      onRow: n => { if (n.user_id === me && !n.read_at) D.update('notifications', n.id, { read_at: G.date.now() }, { silent: true }); const go = goRef(n.ref); if (go) go(); else G.refresh(); },
      columns: [
        { key: 'read', label: '', sort: false, render: n => n.read_at ? h('span', { class: 'muted small' }, '·') : h('span', { title: 'Sin leer', style: 'display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--primary)' }) },
        { key: 'at', label: 'Fecha', render: n => F.datetime(n.at) },
        { key: 'severity', label: 'Severidad', value: n => n.severity || sevOfTone(n.tone), render: n => sevBadge(n.severity || sevOfTone(n.tone)) },
        { key: 'title', label: 'Aviso', render: n => h('div', null, h('b', { style: n.read_at ? 'font-weight:500' : '' }, n.title), h('div', { class: 'small muted' }, n.body)) },
        { key: 'type', label: 'Tipo', value: n => typeName(n.type) },
        { key: 'module', label: 'Módulo', mono: true },
        ntState.scope === 'all' ? { key: 'user_id', label: 'Destinatario', value: n => G.userShort(n.user_id) } : null,
        { key: 'link', label: '', sort: false, render: n => goRef(n.ref) ? h('span', { class: 'small', style: 'color:var(--primary)' }, 'Abrir ›') : '' },
      ].filter(Boolean),
      filters: [{ key: 'sev', label: 'Severidad', value: n => n.severity || sevOfTone(n.tone), options: Object.entries(SEV).map(([k, v]) => [k, v[0]]) }, { key: 'state', label: 'Lectura', value: n => n.read_at ? 'R' : 'U', options: [['U', 'Sin leer'], ['R', 'Leídas']] }],
      actions: n => n.user_id === me ? [btn(n.read_at ? 'No leída' : 'Leída', () => { D.update('notifications', n.id, { read_at: n.read_at ? null : G.date.now() }, { silent: true }); G.refresh(); }, { sm: true, kind: 'ghost' })] : [] }));
  }

  /* ---------- INT-10 Preferencias ---------- */
  function renderPrefs(el, p = {}) {
    const admin = ['GERENTE', 'ADMIN_SISTEMA'].includes(G.ctx.role);
    const uid = admin && p.user ? p.user : G.ctx.userId();
    const body = page(el, { code: 'INT-10', title: 'Preferencias de notificación', sub: 'Elige por tipo de aviso en qué canal recibirlo: en la app, correo o push. Los avisos críticos llegan siempre y no se pueden apagar (RN-INT-15).' });
    if (admin) body.appendChild(h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Usuario:'), sel(D.where('users', u => u.status === 'ACTIVE').map(u => [u.id, `${u.name} · ${G.roleName(u.role)}`]), uid, v => G.go('INT-10', { user: v }), 'Usuario')));
    body.appendChild(notice('D-INT-03: push solo en la app Android y la campana en la web.', 'info'));
    const tbl = h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Tipo de aviso'), h('th', { class: 'c' }, 'En la app'), h('th', { class: 'c' }, 'Correo'), h('th', { class: 'c' }, 'Push (Android)'))));
    const tb = h('tbody');
    for (const [t, label] of NOTIF_TYPES) {
      const pr = I.pref(uid, t) || { in_app: true, email: false, push: false }; const crit = t === 'CRITICAL';
      const cb = ch => { const i = h('input', { type: 'checkbox', checked: crit ? true : !!pr[ch], disabled: crit, attrs: { 'aria-label': `${label} · ${ch}` } }); i.addEventListener('change', () => { const ex = I.pref(uid, t); if (ex) D.update('notification_preferences', ex.id, { [ch]: i.checked }); else D.insert('notification_preferences', Object.assign({ user_id: uid, type: t, in_app: true, email: false, push: false }, { [ch]: i.checked })); toast('Preferencia guardada', 'ok'); }); return h('td', { class: 'c' }, i); };
      tb.appendChild(h('tr', null, h('td', null, label, crit ? h('div', { class: 'small muted' }, 'Siempre activos') : null), cb('in_app'), cb('email'), cb('push')));
    }
    tbl.appendChild(tb);
    body.appendChild(card(G.userName(uid), h('div', { class: 'tbl-wrap' }, tbl), { flush: true }));
  }

  /* ---------- INT-11 Archivos adjuntos (panel reutilizable) ---------- */
  const ENT = { sales_orders: ['Pedido', id => (D.get('sales_orders', id) || {}).number], payments: ['Cobro', id => (D.get('payments', id) || {}).number], sales_documents: ['Comprobante', id => (D.get('sales_documents', id) || {}).full_number], employees: ['Trabajador', id => (D.get('employees', id) || {}).full_name], suppliers: ['Proveedor', id => G.supName(id)], integration_runs: ['Corrida', () => 'Tipo de cambio'], expenses: ['Gasto', id => id] };
  const entLabel = (e, id) => { const x = ENT[e]; return x ? `${x[0]} ${x[1](id) || id}` : `${e} ${id}`; };
  const fmtSize = b => b >= 1048576 ? F.num(b / 1048576, 1) + ' MB' : F.num(b / 1024, 0) + ' KB';
  const thumbs = {};
  function showLink(f) {
    const l = I.fileLink(f.id);
    modal('Enlace temporal de descarga', bd => { bd.appendChild(dl([['Archivo', f.file_name], ['Clasificación', className(f.classification)], ['Vence', `${F.datetime(l.expires_at)} (${l.minutes} minutos)`], ['SHA-256', h('span', { class: 'mono small', style: 'word-break:break-all' }, f.sha256)]])); bd.appendChild(pre(l.url)); bd.appendChild(notice('Enlace firmado y temporal: nunca hay URL pública (RN-INT-17).', 'info')); });
    G.refresh();
  }
  I.attachmentsPanel = function (entity, entity_id, opts = {}) {
    const box = h('div', { class: 'stack' });
    const draw = () => {
      G.ui.clear(box);
      const files = D.where('file_attachments', f => f.entity === entity && f.entity_id === entity_id && (opts.showDeleted || f.status === 'ACTIVE'));
      if (!files.length) box.appendChild(h('p', { class: 'muted small' }, 'Sin archivos adjuntos.'));
      for (const f of files) box.appendChild(h('div', { class: 'row between', style: 'border:1px solid var(--line);border-radius:6px;padding:6px 8px;gap:8px' },
        h('div', { class: 'row', style: 'gap:8px;min-width:0' }, thumbs[f.id] ? h('img', { src: thumbs[f.id], alt: '', style: 'width:40px;height:40px;object-fit:cover;border-radius:4px' }) : h('span', { class: 'mono small', style: 'display:inline-grid;place-items:center;width:40px;height:40px;border-radius:4px;background:var(--primary-soft);color:var(--primary)' }, f.ext), h('div', { style: 'min-width:0' }, h('div', { class: 'small', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, f.file_name), h('div', { class: 'small muted' }, `${fmtSize(f.size_bytes)} · ${className(f.classification)} · ${f.uploaded_by}`))),
        f.status === 'ACTIVE' ? h('div', { class: 'row', style: 'gap:4px' }, btn('Descargar', () => wrap(() => showLink(f)), { sm: true }), G.can('int.file.delete') ? btn('Eliminar', () => reasonModal('Eliminar ' + f.file_name, 'Motivo', (reason, close) => wrap(() => { I.deleteFile(f.id, reason); close(); toast('Archivo marcado como eliminado', 'ok'); draw(); })), { sm: true, kind: 'ghost' }) : null) : badge('Eliminado', '')));
      const inp = h('input', { type: 'file', class: 'input', attrs: { accept: 'image/*,.pdf,.mp3,.ogg,.wav,.csv,.xlsx,.xml,.zip', capture: opts.camera ? 'environment' : null, 'aria-label': 'Subir archivo' } });
      const cls = sel(CLASSES, opts.classification || 'INTERNAL', () => { }, 'Clasificación');
      inp.addEventListener('change', () => { const file = inp.files[0]; if (!file) return; const rd = new FileReader(); rd.onload = () => { wrap(() => { const f = I.attach({ entity, entity_id, file_name: file.name, size_bytes: file.size, classification: cls.value, content: new Uint8Array(rd.result), mime: file.type }); if (/^image\//.test(file.type)) thumbs[f.id] = URL.createObjectURL(file); toast(`${file.name} adjuntado (SHA-256 ${f.sha256.slice(0, 10)}…)`, 'ok'); draw(); }); }; rd.readAsArrayBuffer(file); });
      if (G.can('int.file.upload') || G.ctx.role === 'CLIENTE_B2B') box.appendChild(h('div', { class: 'row' }, inp, cls));
    };
    draw();
    return box;
  };
  const faState = { entity: 'sales_orders', id: null };
  function renderFiles(el) {
    const body = page(el, { code: 'INT-11', title: 'Archivos adjuntos', sub: `Panel reutilizable en cualquier ficha: subir (cámara o archivo), ver, descargar con enlace de ${G.param('int_file_link_minutes') ?? 10} minutos y eliminar con motivo. Máx. ${G.param('int_file_max_mb') ?? 20} MB (RN-INT-16).` });
    const all = D.all('file_attachments');
    body.appendChild(kpis([{ label: 'Archivos activos', value: F.num(all.filter(f => f.status === 'ACTIVE').length) }, { label: 'Espacio usado', value: fmtSize(U.sum(all.filter(f => f.status === 'ACTIVE'), f => f.size_bytes)) }, { label: 'Confidenciales o personales', value: F.num(all.filter(f => ['CONFIDENTIAL', 'PERSONAL_DATA'].includes(f.classification) && f.status === 'ACTIVE').length), sub: 'descarga con int.file.view_confidential' }, { label: 'Eliminados', value: F.num(all.filter(f => f.status === 'DELETED').length), sub: 'se depuran por retención' }]));
    const grid = h('div', { class: 'grid side-r' });
    grid.appendChild(table({ id: 'int11', rows: all.slice().sort(U.by('uploaded_at', -1)),
      columns: [{ key: 'file_name', label: 'Archivo', render: f => h('div', null, h('b', { class: 'small' }, f.file_name), h('div', { class: 'small muted mono' }, f.sha256.slice(0, 16) + '…')) }, { key: 'entity', label: 'Registro', value: f => entLabel(f.entity, f.entity_id) }, { key: 'size_bytes', label: 'Tamaño', align: 'r', render: f => fmtSize(f.size_bytes) }, { key: 'classification', label: 'Clasificación', render: f => badge(className(f.classification), ['CONFIDENTIAL', 'PERSONAL_DATA'].includes(f.classification) ? 'warn' : '') }, { key: 'uploaded_at', label: 'Subido', render: f => `${F.datetime(f.uploaded_at)} · ${f.uploaded_by}` }, { key: 'status', label: 'Estado', render: f => f.status === 'ACTIVE' ? badge('Activo', 'ok') : h('span', { title: f.deleted_reason }, badge('Eliminado', '')) }],
      filters: [{ key: 'entity', label: 'Registro', options: Object.entries(ENT).map(([k, v]) => [k, v[0]]) }, { key: 'classification', label: 'Clasificación', options: CLASSES }],
      actions: f => f.status === 'ACTIVE' ? [btn('Descargar', () => wrap(() => showLink(f)), { sm: true })] : [] }));
    const recs = { sales_orders: D.where('sales_orders', o => ['DELIVERED', 'IN_ROUTE', 'CLOSED'].includes(o.status)).slice(-15).map(o => [o.id, `${o.number} · ${G.custName(o.customer_id)}`]), payments: D.where('payments', p => p.payment_method_id === 'pm-YAPE').slice(-10).map(p => [p.id, `${p.number} · ${F.money(p.amount)}`]), employees: D.all('employees').map(e => [e.id, e.full_name]) };
    if (!faState.id || !(recs[faState.entity] || []).some(x => x[0] === faState.id)) faState.id = (recs[faState.entity][recs[faState.entity].length - 1] || [])[0];
    const panelBox = h('div', { class: 'stack' },
      h('div', { class: 'grid c2' }, sel([['sales_orders', 'Pedido'], ['payments', 'Cobro'], ['employees', 'Trabajador']], faState.entity, v => { faState.entity = v; faState.id = null; G.refresh(); }, 'Tipo de registro'), sel(recs[faState.entity], faState.id, v => { faState.id = v; G.refresh(); }, 'Registro')),
      I.attachmentsPanel(faState.entity, faState.id, { camera: faState.entity === 'sales_orders', classification: faState.entity === 'employees' ? 'PERSONAL_DATA' : faState.entity === 'payments' ? 'CONFIDENTIAL' : 'INTERNAL' }));
    grid.appendChild(card('Panel de adjuntos de un registro', panelBox));
    body.appendChild(grid);
  }

  /* ---------- INT-12 Salud de integraciones ---------- */
  function renderHealth(el) {
    const body = page(el, { code: 'INT-12', title: 'Salud de integraciones', sub: 'Conectores en error, cola muerta, latencia de webhooks, éxito del outbox y credenciales por vencer.' });
    const p = { from: G.date.add(G.TODAY, -9), to: G.TODAY };
    const k = c => G.kpi(c, p) || {};
    const k1 = k('KPI-INT-01'), k2 = k('KPI-INT-02'), k3 = k('KPI-INT-03'), k4 = k('KPI-INT-04'), k5 = k('KPI-INT-05');
    body.appendChild(kpis([
      { label: 'Éxito del outbox', value: F.pct(k1.value, 2), sub: 'KPI-INT-01 · meta ≥ 99,5 %', tone: k1.value >= 99.5 ? 'ok' : 'warn', onClick: () => G.go('INT-06') },
      { label: 'Cola muerta', value: F.num(k2.value), sub: 'KPI-INT-02 · meta 0', tone: k2.value ? 'bad' : 'ok', onClick: () => G.go('INT-07') },
      { label: 'Webhooks duplicados', value: F.pct(k3.value, 2), sub: 'KPI-INT-03 · informativo' },
      { label: 'Latencia p95', value: fmtSec(k4.value || 0), sub: 'KPI-INT-04 · meta ≤ 60 s', tone: k4.value > 60 ? 'warn' : 'ok', onClick: () => G.go('INT-05') },
      { label: 'Conectores en error', value: F.num(k5.value), sub: 'KPI-INT-05 · meta 0', tone: k5.value ? 'bad' : 'ok', onClick: () => G.go('INT-01') },
    ]));
    const days = []; for (let d = p.from; d <= p.to; d = G.date.add(d, 1)) days.push(d);
    const evs = U.groupBy(D.where('webhook_events', e => e.status === 'PROCESSED' && e.processed_at), e => e.received_at.slice(0, 10));
    const obs = U.groupBy(D.all('outbox_messages'), m => String(m.created_at).slice(0, 10));
    const grid = h('div', { class: 'grid c2' });
    grid.appendChild(card('Latencia p95 de webhooks por día (s)', chart.line({ labels: days.map(d => d.slice(8) + '/' + d.slice(5, 7)), series: [{ name: 'p95', values: days.map(d => R(p95((evs[d] || []).map(e => secs(e.processed_at, e.received_at))), 1)) }], ref: 60, format: v => fmtSec(v) })));
    grid.appendChild(card('Outbox por día', chart.bar({ labels: days.map(d => d.slice(8) + '/' + d.slice(5, 7)), stacked: true, series: [{ name: 'Enviados', values: days.map(d => (obs[d] || []).filter(m => m.status === 'SENT').length), color: 'var(--ok)' }, { name: 'Reintentando', values: days.map(d => (obs[d] || []).filter(m => m.status === 'RETRYING').length), color: 'var(--warn)' }, { name: 'Cola muerta', values: days.map(d => (obs[d] || []).filter(m => m.status === 'DEAD').length), color: 'var(--bad)' }] })));
    body.appendChild(grid);
    const g2 = h('div', { class: 'grid c2' });
    g2.appendChild(card('Conectores con problemas', table({ id: 'int12c', search: false, pageSize: 10, rows: D.where('integration_connectors', c => c.status === 'ERROR' || (c.consecutive_failures || 0) > 0 || c.simulate_down), empty: 'Todos los conectores responden.', onRow: c => G.go('INT-02', { id: c.id }), columns: [{ key: 'name', label: 'Conector' }, { key: 'consecutive_failures', label: 'Fallos', align: 'r' }, { key: 'last_error', label: 'Último error' }, { key: 'status', label: 'Estado', render: c => st(c.status) }] }), { flush: true }));
    g2.appendChild(card('Credenciales por vencer (RN-INT-20)', table({ id: 'int12k', search: false, rows: I.credentialsExpiring(30), empty: 'Ninguna vence en 30 días.', onRow: () => G.go('INT-03'), columns: [{ key: 'connector_id', label: 'Conector', value: x => connName(x.connector_id) }, { key: 'name', label: 'Credencial', mono: true }, { key: 'expires_at', label: 'Vence', render: x => `${F.date(x.expires_at)} (${F.days(G.date.diff(x.expires_at.slice(0, 10), G.TODAY))})` }] }), { flush: true }));
    body.appendChild(g2);
  }

  /* ---------- INT-13 Simulador ---------- */
  const simState = { kind: 'MP', badSig: false, times: 1, last: null };
  function renderSimulator(el) {
    const body = page(el, { code: 'INT-13', title: 'Simulador de integraciones', sub: 'Solo en prueba: dispara webhooks de ejemplo firmados contra el adaptador falso y muestra la respuesta y el efecto.' });
    if (!G.can('int.simulator.use')) { body.appendChild(notice(`Tu rol (${G.roleName()}) no tiene el permiso int.simulator.use.`, 'warn')); }
    body.appendChild(notice('Los endpoints de prueba (SANDBOX) usan adaptadores falsos y no salen a internet (RN-INT-01). Para reproducir CA-INT-01 elige «Enviar 3 veces».', 'info'));
    const webOrder = D.where('sales_orders', o => o.channel === 'WEB' && ['CONFIRMED', 'IN_PREPARATION', 'DRAFT'].includes(o.status) && (o.paid_amount || 0) < (o.estimated_total || 0)).slice(-1)[0] || D.where('sales_orders', o => o.channel === 'WEB').slice(-1)[0];
    const cu = D.find('customers', c => c.customer_type === 'PERSON' && c.phone && c.status === 'ACTIVE');
    const SAMPLES = {
      MP: { label: 'Pago aprobado de Mercado Pago', ep: 'we-MP-SBX', body: () => { const id = String(1330000000 + Math.floor(Math.random() * 999999)); return { id, type: 'payment', action: 'payment.updated', live_mode: false, data: { id, status: 'approved', transaction_amount: R((webOrder || {}).estimated_total || 120), external_reference: (webOrder || {}).number } }; } },
      WA: { label: 'Mensaje entrante de WhatsApp', ep: 'we-WA-SBX', body: () => ({ object: 'whatsapp_business_account', entry: [{ id: 'SBX', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', messages: [{ from: (cu || {}).phone.replace('+', ''), id: 'wamid.SBX' + Math.floor(Math.random() * 1e9), type: 'text', text: { body: 'Hola, quiero 2 cuyes enteros para mañana' } }] } }] }] }) },
      WOO: { label: 'Pedido de WooCommerce', ep: 'we-WOO-SBX', body: () => { const n = String(9100 + Math.floor(Math.random() * 800)); return { id: Number(n), number: n, status: 'processing', billing: { first_name: (cu || {}).full_name.split(' ')[0], phone: (cu || {}).phone }, line_items: [{ sku: 'DG-CAL-1L', quantity: 2 }, { sku: 'DG-CHO-500', quantity: 1 }], customer_note: 'Dejar en portería', payment_method: 'woo-mercado-pago-basic' }; } },
    };
    const out = h('div', { class: 'stack' });
    body.appendChild(card('Disparar webhook', h('div', { class: 'stack' },
      pills(Object.entries(SAMPLES).map(([k, v]) => [k, v.label]), simState.kind, v => { simState.kind = v; G.refresh(); }),
      h('div', { class: 'row' }, h('label', { class: 'check' }, (() => { const i = h('input', { type: 'checkbox', checked: simState.badSig }); i.addEventListener('change', () => { simState.badSig = i.checked; }); return i; })(), h('span', null, 'Firma inválida')),
        sel([[1, 'Enviar 1 vez'], [3, 'Enviar 3 veces (reintentos del proveedor)']], simState.times, v => { simState.times = Number(v); }, 'Veces'),
        btn('Disparar', () => G.require('int.simulator.use', () => wrap(() => {
          const s = SAMPLES[simState.kind]; const ep = D.get('webhook_endpoints', s.ep); const c = conn(ep.connector_id);
          if (c.environment !== 'SANDBOX') G.fail('RN-INT-01', 'El simulador solo dispara contra endpoints de prueba.');
          const bodyObj = s.body(); const raw = JSON.stringify(bodyObj); const sig = simState.badSig ? 'sha256=' + '0'.repeat(64) : I.sign(ep.id, raw);
          const res = []; for (let i = 0; i < simState.times; i++) res.push(I.receiveWebhook({ endpoint_id: ep.id, body: raw, signature: sig }));
          simState.last = { raw, sig, res: res.map(r => ({ http: r.http, status: r.status, duplicate: !!r.duplicate })), ev: res[0].event };
          G.refresh();
        })), { kind: 'primary' })))));
    if (simState.last) {
      const L = simState.last; const ev = L.ev && D.get('webhook_events', L.ev.id);
      out.appendChild(table({ id: 'int13r', search: false, rows: L.res.map((r, i) => Object.assign({ n: i + 1 }, r)), columns: [{ key: 'n', label: 'Envío', align: 'r' }, { key: 'http', label: 'HTTP', mono: true }, { key: 'status', label: 'Estado', render: r => st(r.status) }, { key: 'duplicate', label: 'Duplicado', render: r => r.duplicate ? badge('Sí · no se procesa', 'warn') : 'No' }] }));
      if (ev) out.appendChild(dl([['Clave', ev.event_key], ['Duplicados', String(ev.duplicates)], ['Resultado', ev.result || ev.last_error], ['Firma enviada', h('span', { class: 'mono small', style: 'word-break:break-all' }, L.sig)]]));
      out.appendChild(pre(pretty(L.raw)));
      body.appendChild(card('Respuesta', out));
    }
  }

  /* =====================================================================
     Registro, indicadores, ganchos y pruebas
     ===================================================================== */
  const SP = G.SPEC.INT.screens; const nm = c => (SP.find(s => s[0] === c) || [c, c])[1];
  G.register({ code: 'INT', name: 'Integraciones', phase: 0, group: 'Plataforma', screens: [
    { code: 'INT-01', name: nm('INT-01'), render: renderConnectors }, { code: 'INT-02', name: nm('INT-02'), render: renderConnector },
    { code: 'INT-03', name: nm('INT-03'), render: renderCredentials }, { code: 'INT-04', name: nm('INT-04'), render: renderEndpoints },
    { code: 'INT-05', name: nm('INT-05'), render: renderWebhookLog }, { code: 'INT-06', name: nm('INT-06'), render: renderOutbox },
    { code: 'INT-07', name: nm('INT-07'), render: renderDead }, { code: 'INT-08', name: nm('INT-08'), render: renderRuns },
    { code: 'INT-09', name: nm('INT-09'), render: renderNotifications }, { code: 'INT-10', name: nm('INT-10'), render: renderPrefs },
    { code: 'INT-11', name: nm('INT-11'), render: renderFiles }, { code: 'INT-12', name: nm('INT-12'), render: renderHealth },
    { code: 'INT-13', name: nm('INT-13'), render: renderSimulator },
  ] });

  const inP = (s, { from, to }) => s && String(s).slice(0, 10) >= from && String(s).slice(0, 10) <= to;
  G.kpiCalc['KPI-INT-01'] = p => { const ms = D.where('outbox_messages', m => inP(m.created_at, p)); const s = ms.filter(m => m.status === 'SENT').length, d = ms.filter(m => m.status === 'DEAD').length; return { value: s + d ? R(s / (s + d) * 100, 2) : 100, numerator: s, denominator: s + d }; };
  G.kpiCalc['KPI-INT-02'] = () => D.where('outbox_messages', m => m.status === 'DEAD').length;
  G.kpiCalc['KPI-INT-03'] = p => { const es = D.where('webhook_events', e => e.status !== 'REJECTED' && inP(e.received_at, p)); const dups = U.sum(es, e => e.duplicates || 0); return { value: es.length + dups ? R(dups / (es.length + dups) * 100, 2) : 0, numerator: dups, denominator: es.length + dups }; };
  G.kpiCalc['KPI-INT-04'] = p => R(p95(D.where('webhook_events', e => e.status === 'PROCESSED' && e.processed_at && inP(e.received_at, p)).map(e => secs(e.processed_at, e.received_at))), 1);
  G.kpiCalc['KPI-INT-05'] = () => D.where('integration_connectors', c => c.status === 'ERROR').length;

  G.alertProviders.push(() => {
    const out = [];
    const dead = D.where('outbox_messages', m => m.status === 'DEAD').length; if (dead) out.push({ module: 'INT', title: `${dead} mensaje(s) en la cola muerta`, detail: 'Reintenta o cancela con motivo (RN-INT-10).', tone: 'bad', go: () => G.go('INT-07') });
    const err = D.where('integration_connectors', c => c.status === 'ERROR'); if (err.length) out.push({ module: 'INT', title: `${err.length} conector(es) en error`, detail: err.map(c => c.name).join(', '), tone: 'bad', go: () => G.go('INT-01') });
    const ex = I.credentialsExpiring(); if (ex.length) out.push({ module: 'INT', title: `${ex.length} credencial(es) por vencer`, detail: ex.map(x => `${connName(x.connector_id)} · ${F.date(x.expires_at)}`).join(', '), tone: 'warn', go: () => G.go('INT-03') });
    const me = G.ctx.userId(); const un = D.where('notifications', n => n.user_id === me && !n.read_at && n.in_app !== false).length; if (un) out.push({ module: 'INT', title: `${un} notificación(es) sin leer`, detail: 'Centro de notificaciones', tone: 'info', go: () => G.go('INT-09') });
    return out;
  });
  G.searchProviders.push(q => { const s = q.toLowerCase(); return D.all('integration_connectors').filter(c => c.name.toLowerCase().includes(s) || c.code.toLowerCase().includes(s)).slice(0, 4).map(c => ({ label: c.name, sub: `Conector · ${kindName(c.kind)}`, go: () => G.go('INT-02', { id: c.id }) })).concat(D.all('outbox_messages').filter(m => m.number.toLowerCase() === s).map(m => ({ label: m.number, sub: 'Mensaje saliente', go: () => obDrawer(m) }))); });

  /* ---------- pruebas (CA-INT-01 … CA-INT-07) ---------- */
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const throwsRule = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e; throw new Error(`Se esperaba ${code} y salió: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code}`); };
  const pickWebOrder = () => D.where('sales_orders', o => o.channel === 'WEB' && ['CONFIRMED', 'IN_PREPARATION'].includes(o.status)).slice(-1)[0];
  G.tests.push({ module: 'INT', name: 'CA-INT-01: el mismo webhook de pago aprobado de Mercado Pago 3 veces se procesa una vez (1 evento, 2 duplicados, KPI-INT-03 = 66,67 %)', fn: async () => {
    const o = pickWebOrder(); assert(o, 'Falta un pedido web confirmado');
    const ep = D.get('webhook_endpoints', 'we-MP-DG'); const at = G.TODAY + 'T23:50:00';
    const raw = JSON.stringify({ id: '1339000111', type: 'payment', action: 'payment.updated', data: { id: '1339000111', status: 'approved', transaction_amount: 80, external_reference: o.number } });
    const paid0 = o.paid_amount || 0; const n0 = D.where('payments', p => p.reference === 'MP-1339000111').length;
    const rs = [1, 2, 3].map(() => I.receiveWebhook({ endpoint_id: ep.id, body: raw, signature: I.sign(ep.id, raw), at }));
    assert(rs.every(r => r.http === 200), 'Las tres respuestas deben ser 200');
    const evs = D.where('webhook_events', e => e.event_key === '1339000111'); assert(evs.length === 1 && evs[0].duplicates === 2 && evs[0].status === 'PROCESSED', `Debe haber 1 evento con 2 duplicados (hay ${evs.length}, dup ${evs[0] && evs[0].duplicates})`);
    assert(D.where('payments', p => p.reference === 'MP-1339000111').length === n0 + 1 && R(D.get('sales_orders', o.id).paid_amount - paid0) === 80, 'El cobro debe registrarse una sola vez');
    const only = D.t.webhook_events; D.t.webhook_events = only.filter(e => e.event_key === '1339000111'); const k = G.kpi('KPI-INT-03', { from: G.TODAY, to: G.TODAY }); D.t.webhook_events = only;
    assert(k.value === 66.67, 'KPI-INT-03 en esa ventana debe ser 66,67 % y es ' + k.value);
  } });
  G.tests.push({ module: 'INT', name: 'CA-INT-02: un webhook con firma inválida responde 401, queda REJECTED y no cambia ningún pedido', fn: async () => {
    const o = pickWebOrder(); const before = JSON.stringify(D.get('sales_orders', o.id));
    const raw = JSON.stringify({ id: '1339000222', type: 'payment', data: { id: '1339000222', status: 'approved', transaction_amount: 50, external_reference: o.number } });
    const r = I.receiveWebhook({ endpoint_id: 'we-MP-DG', body: raw, signature: 'sha256=deadbeef' });
    assert(r.http === 401 && r.status === 'REJECTED' && D.get('webhook_events', r.event.id).status === 'REJECTED', 'Debe responder 401 y quedar REJECTED');
    assert(JSON.stringify(D.get('sales_orders', o.id)) === before && !D.find('payments', p => p.reference === 'MP-1339000222'), 'No debe cambiar el pedido ni crear cobros');
  } });
  G.tests.push({ module: 'INT', name: 'CA-INT-03: el repartidor reenvía «entregado» con la misma Idempotency-Key: misma respuesta 201 y una sola entrega; con otro cuerpo se rechaza RN-INT-12', fn: async () => {
    const o = D.where('sales_orders', x => x.status === 'IN_ROUTE')[0]; assert(o, 'Falta un pedido en ruta');
    const key = 'drv-test-' + o.id; const scope = `POST /api/v1/orders/${o.number}/delivered`; const body = { lat: -12.13, lng: -76.99, received_by: 'Titular' };
    const fn = () => { G.orders.transition(o.id, 'DELIVERED', { reason: 'Entregado (app del repartidor)' }); return { order: o.number, status: 'DELIVERED' }; };
    const r1 = I.idempotent({ key, scope, body }, fn); const r2 = I.idempotent({ key, scope, body }, fn);
    assert(r1.http === 201 && r2.http === 201 && r2.replayed && JSON.stringify(r1.body) === JSON.stringify(r2.body), 'La segunda respuesta debe ser la misma 201 guardada');
    assert(D.get('sales_orders', o.id).history.filter(x => x.to === 'DELIVERED').length === 1, 'La entrega debe registrarse una sola vez');
    throwsRule(() => I.idempotent({ key, scope, body: Object.assign({}, body, { received_by: 'Vecino' }) }, fn), 'RN-INT-12');
    const b = I.idemBegin({ key: 'k-prog', scope, body }); throwsRule(() => I.idemBegin({ key: 'k-prog', scope, body }), 'RN-INT-13'); I.idemComplete(b.row, 201, {});
  } });
  G.tests.push({ module: 'INT', name: 'CA-INT-04: con WhatsApp caído la confirmación se reintenta a 30 s, 60 s, 2 min… y al octavo fallo pasa a la cola muerta con aviso crítico; reintentada con motivo se envía una vez', fn: async () => {
    const o = D.where('sales_orders', x => x.status === 'DRAFT' && x.brand_id === 'br-DG' && x.channel === 'WHATSAPP' && !G.orders.missing(x).length)[0] || D.where('sales_orders', x => x.status === 'CONFIRMED' && x.brand_id === 'br-DG')[0];
    const c = waConnectorFor(o); D.update('integration_connectors', c.id, { simulate_down: true }, { silent: true });
    const before = D.where('notifications', n => n.severity === 'CRITICAL').length;
    let m;
    if (o.status === 'DRAFT') { G.orders.transition(o.id, 'CONFIRMED'); m = D.where('outbox_messages', x => x.ref === o.number && x.event === 'order.confirmed').slice(-1)[0]; } else m = I.enqueueOrderMessage(o.id);
    assert(m && D.get('outbox_messages', m.id).status === 'RETRYING' && D.get('outbox_messages', m.id).attempts === 1, 'El primer envío debe fallar y quedar reintentando');
    while (D.get('outbox_messages', m.id).status === 'RETRYING') { const x = D.get('outbox_messages', m.id); I.dispatch(x.id, x.next_attempt_at); }
    const x = D.get('outbox_messages', m.id);
    const delays = x.tries.map(t => t.delay).filter(Boolean);
    assert(JSON.stringify(delays) === JSON.stringify([30, 60, 120, 240, 480, 960, 1920]), 'Esperas: ' + delays.join(', '));
    assert(x.status === 'DEAD' && x.attempts === 8, 'Al octavo fallo debe pasar a la cola muerta');
    assert(D.where('notifications', n => n.severity === 'CRITICAL').length > before && D.find('notifications', n => n.severity === 'CRITICAL' && n.title.includes(x.number) && (D.get('users', n.user_id) || {}).role === 'ADMIN_SISTEMA'), 'Falta el aviso crítico al administrador');
    throwsRule(() => I.retryDead(m.id, 'corto'), 'RN-INT-10');
    D.update('integration_connectors', c.id, { simulate_down: false }, { silent: true });
    const r = I.retryDead(m.id, 'WhatsApp volvió a responder, se reenvía la confirmación');
    assert(r.status === 'SENT' && I.effects(r.idempotency_key) === 1, 'Debe enviarse una sola vez');
  } });
  G.tests.push({ module: 'INT', name: 'CA-INT-05: una foto de 25 MB se rechaza (RN-INT-16); una de 3 MB se acepta y su enlace vence a los 10 minutos', fn: async () => {
    throwsRule(() => I.attach({ entity: 'expenses', entity_id: 'ex-1', file_name: 'boleta-combustible.jpg', size_bytes: 25 * 1048576 }), 'RN-INT-16');
    const f = I.attach({ entity: 'expenses', entity_id: 'ex-1', file_name: 'boleta-combustible.jpg', size_bytes: 3 * 1048576, content: 'jpeg-bytes' });
    assert(f.sha256 === sha256('jpeg-bytes') && f.sha256.length === 64, 'Debe guardar el SHA-256');
    const l = I.fileLink(f.id); assert(secs(l.expires_at, G.date.now()) >= 599 && secs(l.expires_at, G.date.now()) <= 601 && /X-Amz-Expires=600/.test(l.url), 'El enlace debe vencer a los 10 minutos');
    assert(sha256('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256 de referencia incorrecto');
  } });
  G.tests.push({ module: 'INT', name: 'CA-INT-06: en la CI sin internet todas las interfaces usan su adaptador falso y los flujos de WEB, CRM, FAC, CAJ y DEL funcionan', fn: async () => {
    const prev = I.ENV; try {
      I.ENV = 'SANDBOX';
      for (const k of KINDS) { const a = I.adapterFor(k[2]); assert(a.fake && !a.online && a.name === 'Fake' + k[2], 'Interfaz sin adaptador falso: ' + k[2]); }
      throwsRule(() => I.adapterFor('PaymentGateway', 'PRODUCTION', 'FAKE'), 'RN-INT-01');
      const cu = D.find('customers', c => c.customer_type === 'PERSON' && c.phone && c.status === 'ACTIVE');
      const woo = JSON.stringify({ id: 99001, number: '99001', billing: { phone: cu.phone }, line_items: [{ sku: 'DG-CAL-1L', quantity: 2 }] });
      const r1 = I.receiveWebhook({ endpoint_id: 'we-WOO-SBX', body: woo, signature: I.sign('we-WOO-SBX', woo) }); assert(r1.status === 'PROCESSED' && D.find('sales_orders', o => o.external_ref === 'WC-99001'), 'WEB: el pedido de WooCommerce no se creó');
      const wa = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: cu.phone.slice(1), id: 'wamid.CI1', text: { body: 'Hola' } }] } }] }] });
      const r2 = I.receiveWebhook({ endpoint_id: 'we-WA-SBX', body: wa, signature: I.sign('we-WA-SBX', wa) }); assert(r2.status === 'PROCESSED', 'CRM: el mensaje entrante no se procesó');
      assert(I.adapterFor('EInvoiceProvider').send({ full_number: 'B001-00000001' }).status === 'ACCEPTED', 'FAC: el OSE falso no aceptó');
      const o = D.find('sales_orders', x => x.external_ref === 'WC-99001'); const mp = JSON.stringify({ id: 'CI-1', type: 'payment', data: { id: 'CI-1', status: 'approved', transaction_amount: 36, external_reference: o.number } });
      const r3 = I.receiveWebhook({ endpoint_id: 'we-MP-SBX', body: mp, signature: I.sign('we-MP-SBX', mp) }); assert(r3.status === 'PROCESSED' && D.find('payments', p => p.reference === 'MP-CI-1'), 'CAJ: el cobro no se registró');
      assert(I.adapterFor('MapsProvider').geocode('Av. Primavera 120, Santiago de Surco').zone_id, 'DEL: la geocodificación falsa no devolvió zona');
    } finally { I.ENV = prev; }
  } });
  G.tests.push({ module: 'INT', name: 'CA-INT-07: la credencial de Mercado Pago solo se ve como ••••3456 y la auditoría no contiene el secreto cifrado', fn: async () => {
    const cr = D.find('integration_credentials', x => x.connector_id === 'ic-MP-DG' && x.name === 'access_token' && x.status === 'ACTIVE');
    assert(I.credentialView(cr).value === '••••3456' && !('secret_enc' in I.credentialView(cr)), 'La API debe mostrar solo ••••3456');
    const prev = G.ctx.role; try {
      G.ctx.role = 'ADMIN_SISTEMA';
      const nw = I.rotate(cr.id, { secret: 'APP_USR-nuevo-secreto-XYZ-3456' });
      D.update('integration_credentials', nw.id, { secret_enc: enc('otro-secreto-7777'), last4: '7777' });
      const auditTxt = JSON.stringify(D.raw('audit'));
      assert(!auditTxt.includes(nw.secret_enc) && !auditTxt.includes(enc('APP_USR-nuevo-secreto-XYZ-3456')) && !auditTxt.includes('APP_USR-nuevo-secreto') && !auditTxt.includes('otro-secreto-7777'), 'La auditoría contiene el secreto');
      assert(dec(nw.secret_enc) === 'otro-secreto-7777' || dec(D.get('integration_credentials', nw.id).secret_enc) === 'otro-secreto-7777', 'El cifrado debe ser reversible solo con la clave maestra');
    } finally { G.ctx.role = prev; }
  } });
})();
