/* =====================================================================
   API · API pública, claves y webhooks (API-01 … API-11)
   Claves ak_live_/ak_test_ con alcances, marcas, IP y vencimiento (se guarda
   solo el prefijo y el hash SHA-256 del secreto), autenticación por prefijo
   con comparación en tiempo constante, límites del plan (día y minuto → 429),
   idempotencia de escrituras (idempotency_keys de INT), pedidos por API con
   las reglas de PED, sandbox emparejado con OSE y mensajería FAKE, webhooks
   salientes firmados (Aycha-Signature t=…, v1=HMAC-SHA256) con reintentos
   1-5-30-120-360-720-1440 min, cola muerta, reenvío, desactivación por
   racha de fallos y documentación OpenAPI generada del catálogo.
   Expone G.api: call, createKey, revokeKey, reactivateKey, updateKey,
   keyStatus, plan, dailyUsed, publish, enqueue, attempt, runQueue, resend,
   sendTest, saveEndpoint, setEndpointStatus, rotateSecret, validateUrl,
   signature, signatureHeader, verify, resetSandbox, sandbox, openapi,
   exampleOrderBody, tokenFor, ROUTES.
   ===================================================================== */
(function () {
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, modal, form, toast, tabs, pills, chart } = G.ui;
  const U = G.util, F = G.fmt, D = G.db;
  const R = (n, d = 2) => U.round(n, d);

  /* ---------- SHA-256 y HMAC: los de INT (G.int) y un respaldo propio ---------- */
  const K256 = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const utf8 = s => new TextEncoder().encode(String(s));
  function shaBytes(bytes) {
    const l = bytes.length, nb = ((l + 9 + 63) >> 6) << 6; const m = new Uint8Array(nb); m.set(bytes); m[l] = 0x80;
    const dv = new DataView(m.buffer); dv.setUint32(nb - 4, (l * 8) >>> 0); dv.setUint32(nb - 8, Math.floor(l * 8 / 4294967296));
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]); const W = new Uint32Array(64);
    const rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < nb; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) { const s0 = rot(W[i - 15], 7) ^ rot(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = rot(W[i - 2], 17) ^ rot(W[i - 2], 19) ^ (W[i - 2] >>> 10); W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0; }
      let [a, b, c, d, e, f, g, hh] = H;
      for (let i = 0; i < 64; i++) { const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) | 0, t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0; hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0; }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += hh;
    }
    const out = new Uint8Array(32); const ov = new DataView(out.buffer); for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]); return out;
  }
  const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  const shaLocal = s => hex(shaBytes(utf8(s)));
  function hmacLocal(key, msg) {
    let k = utf8(key); if (k.length > 64) k = shaBytes(k);
    const kp = new Uint8Array(64); kp.set(k); const mb = utf8(msg);
    const inner = new Uint8Array(64 + mb.length); inner.set(kp.map(x => x ^ 0x36)); inner.set(mb, 64);
    const outer = new Uint8Array(96); outer.set(kp.map(x => x ^ 0x5c)); outer.set(shaBytes(inner), 64);
    return hex(shaBytes(outer));
  }
  const sha256 = s => (G.int && G.int.sha256 ? G.int.sha256(s) : shaLocal(s));
  const hmac = (k, m) => (G.int && G.int.hmac ? G.int.hmac(k, m) : hmacLocal(k, m));
  /** comparación en tiempo constante (RN-API-11) */
  const safeEq = (a, b) => { a = String(a || ''); b = String(b || ''); let d = a.length ^ b.length; const n = Math.max(a.length, b.length); for (let i = 0; i < n; i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };
  /* secretos de firma de webhooks: cifrados por la aplicación (clave maestra fuera de la base, como INT) */
  const MASTER = 'kms://aycha-prod/api-webhooks/master-key-v1';
  const xorK = bytes => { const k = utf8(MASTER); return bytes.map((x, i) => x ^ k[i % k.length]); };
  const enc = s => 'enc:v1:' + btoa(String.fromCharCode(...xorK(utf8(s))));
  const dec = s => (s && String(s).startsWith('enc:v1:') ? new TextDecoder().decode(xorK(Uint8Array.from(atob(String(s).slice(7)), c => c.charCodeAt(0)))) : '');

  /* ---------- tiempo (hora de Lima, UTC−5) ---------- */
  const norm = s => { s = String(s); if (s.length === 10) s += 'T00:00:00'; if (s.length === 16) s += ':00'; return s.slice(0, 19); };
  const toMs = s => Date.parse(norm(s) + '-05:00');
  const fromMs = ms => new Date(ms - 5 * 3600e3).toISOString().slice(0, 19);
  const addMin = (s, n) => fromMs(toMs(s) + n * 60000);
  const unix = s => Math.floor(toMs(s) / 1000);
  const fmtMin = m => m >= 1440 ? F.num(m / 1440, m % 1440 ? 1 : 0) + ' d' : m >= 60 ? F.num(m / 60, m % 60 ? 1 : 0) + ' h' : m + ' min';
  const fmtMs = ms => ms >= 1000 ? F.num(ms / 1000, 1) + ' s' : ms + ' ms';

  /* ---------- aleatorios: sembrados con rng; en la demo, crypto ---------- */
  const ALNUM = 'abcdefghijkmnopqrstuvwxyz0123456789', B62 = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const rnd = (n, set, r) => { let s = ''; const buf = r ? null : crypto.getRandomValues(new Uint32Array(n)); for (let i = 0; i < n; i++) s += set[r ? Math.floor(r() * set.length) : buf[i] % set.length]; return s; };

  /* ---------- catálogos (globales: api_scopes, api_event_types) ---------- */
  const SCOPES = [
    ['orders:read', 'Leer pedidos', 'PED', 'Pedidos con estado, líneas, pesos y totales.'],
    ['orders:write', 'Crear pedidos', 'PED', 'Crear pedidos con Idempotency-Key y pedir su comprobante.'],
    ['customers:read', 'Leer clientes', 'CLI', 'Clientes con documento, contacto y direcciones.'],
    ['customers:write', 'Crear clientes', 'CLI', 'Registrar clientes nuevos (RUC o DNI válidos).'],
    ['products:read', 'Leer catálogo', 'CAT', 'Presentaciones vendibles: SKU, modo de venta y peso nominal.'],
    ['prices:read', 'Leer precios', 'CAT', 'Precio vigente con IGV de la lista del canal de la clave.'],
    ['stock:read', 'Leer stock', 'ALM', 'Disponible por SKU en almacenes de venta (sin reservas).'],
    ['documents:read', 'Leer comprobantes', 'FAC', 'Facturas, boletas y notas con su estado SUNAT.'],
    ['payments:read', 'Leer cobros', 'CAJ', 'Cobros confirmados y su aplicación a pedidos.'],
    ['deliveries:read', 'Leer entregas', 'DEL', 'Pedidos en ruta, entregados y no entregados.'],
    ['webhooks:write', 'Gestionar webhooks', 'API', 'Crear y listar destinos de webhooks desde la API.'],
  ];
  const EVENTS = [
    ['order.created', 'PED', 'orders:read', 'Pedido creado en cualquier canal', 'v1', 'ACTIVE'],
    ['order.confirmed', 'PED', 'orders:read', 'Pedido confirmado con datos completos', 'v1', 'ACTIVE'],
    ['order.dispatched', 'DEL', 'deliveries:read', 'Pedido salió a reparto', 'v1', 'ACTIVE'],
    ['order.delivered', 'DEL', 'orders:read', 'Pedido entregado al cliente', 'v1', 'ACTIVE'],
    ['order.not_delivered', 'DEL', 'deliveries:read', 'Entrega fallida con motivo', 'v1', 'ACTIVE'],
    ['order.cancelled', 'PED', 'orders:read', 'Pedido cancelado', 'v1', 'ACTIVE'],
    ['document.accepted', 'FAC', 'documents:read', 'Comprobante aceptado por SUNAT u OSE', 'v1', 'ACTIVE'],
    ['document.rejected', 'FAC', 'documents:read', 'Comprobante rechazado por SUNAT u OSE', 'v1', 'ACTIVE'],
    ['payment.confirmed', 'CAJ', 'payments:read', 'Cobro confirmado', 'v1', 'ACTIVE'],
    ['payment.reversed', 'CAJ', 'payments:read', 'Cobro revertido', 'v1', 'ACTIVE'],
    ['stock.low', 'ALM', 'stock:read', 'Disponible bajo el mínimo (D-API-04)', 'v1', 'ACTIVE'],
    ['order.updated', 'PED', 'orders:read', 'Retirado: se reemplazó por eventos de cada estado', 'v0', 'RETIRED'],
  ];
  const ST = { ACTIVE: ['Activa', 'ok'], REVOKED: ['Revocada', ''], EXPIRED: ['Vencida', 'bad'], PAUSED: ['Pausado', 'warn'], DISABLED: ['Desactivado', 'bad'], PENDING: ['Pendiente', 'info'], RETRYING: ['Reintentando', 'warn'], DELIVERED: ['Entregado', 'ok'], DEAD: ['Cola muerta', 'bad'], READY: ['Listo', 'ok'], RESETTING: ['Reiniciando', 'warn'], RETIRED: ['Retirado', ''] };
  const stD = s => badge((ST[s] || [s])[0], (ST[s] || [, ''])[1]);
  const envBadge = e => e === 'TEST' ? badge('Pruebas', 'info') : badge('Producción', '');
  const HOST = 'https://donguando.aycha.pe', SBX_HOST = 'https://sandbox.aycha.pe';
  const sp = c => (G.SPEC.API.screens.find(s => s[0] === c) || [c, c])[1];

  /* ---------- DNS de demostración (RN-API-05: se resuelve al enviar) ---------- */
  const FAKE_DNS = { 'erp.elcuydorado.pe': '190.12.88.41', 'bi.estudiorojas.pe': '181.176.40.9', 'tienda.marca5gourmet.pe': '172.67.150.22', 'erp-legacy.donguando.pe': '10.20.0.15', 'webhook.site': '46.4.105.116', 'hooks.zapier.com': '54.86.12.7' };
  const isPrivate = ip => /^(10\.|127\.|0\.|169\.254\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || ip === '::1' || /^f[cd]/i.test(ip);
  const isIp = s => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || s.includes(':');
  const resolve = host => { host = String(host).toLowerCase(); if (isIp(host)) return host; if (host === 'localhost' || host.endsWith('.localhost')) return '127.0.0.1'; if (FAKE_DNS[host]) return FAKE_DNS[host]; const x = sha256(host); return `200.${parseInt(x.slice(0, 2), 16)}.${parseInt(x.slice(2, 4), 16)}.${1 + parseInt(x.slice(4, 6), 16) % 254}`; };
  const hostOf = url => { try { return new URL(url).hostname.replace(/^\[|\]$/g, ''); } catch (e) { return ''; } };

  /* ---------- bóveda de la sesión: los secretos solo viven aquí (nunca en la base) ---------- */
  const vault = new Map(); // prefijo → clave completa (sembradas y creadas en esta sesión)
  const minuteBuckets = new Map();
  const isAdmin = () => G.can('api.key.manage');
  const perm = (p, what) => { if (!G.can(p)) G.fail('RN-SEG-12', `Tu rol (${G.roleName()}) no tiene el permiso ${p}${what ? ' para ' + what : ''}.`); };
  const brandCode = id => (D.get('brands', id) || {}).code || id;
  const brandByCode = c => D.find('brands', b => b.code === c || b.id === c || b.id === 'br-' + c);
  const scopeRow = c => D.find('api_scopes', s => s.code === c);
  const eventRow = c => D.find('api_event_types', e => e.code === c);
  const keyName = id => { const k = D.get('api_keys', id); return k ? k.name : '—'; };
  const epName = id => { const e = D.get('api_webhook_endpoints', id); return e ? e.name : '—'; };
  const inP = (s, { from, to }) => s && String(s).slice(0, 10) >= from && String(s).slice(0, 10) <= to;

  class ApiErr extends Error { constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; } }
  const E = (status, code, message, extra) => { throw new ApiErr(status, code, `${code}: ${message}`, extra); };

  /* =====================================================================
     Dominio
     ===================================================================== */
  const A = G.api = {
    vault,
    /** plan de la empresa con API y llamadas por día (SUS) o respaldo si SUS no está */
    plan(ten = G.ctx.tenant) {
      if (A._planOverride) return Object.assign({ addons: 0 }, A._planOverride);
      const t = D.raw('tenants').find(x => x.id === ten) || {};
      const plans = D.raw('saas_plans').filter(p => !p.tenant && p.code === t.plan && p.status === 'PUBLISHED').sort((a, b) => b.version - a.version);
      if (plans.length) {
        const p = plans[0]; const mods = D.raw('saas_plan_modules').filter(m => m.plan_id === p.id).map(m => m.module_code);
        const lim = D.raw('saas_plan_limits').find(l => l.plan_id === p.id && l.limit_key === 'API_CALLS_DAY');
        const sub = D.raw('subscriptions').find(s => s.tenant === ten && s.status !== 'CANCELLED');
        const adds = sub ? D.raw('subscription_addons').filter(a => a.subscription_id === sub.id && a.status === 'ACTIVE') : [];
        const extra = U.sum(adds, a => { const ad = D.raw('saas_addons').find(x => x.id === a.addon_id); return ad && ad.limit_key === 'API_CALLS_DAY' ? (ad.limit_increment || 0) * (a.qty || 1) : 0; });
        const base = lim ? lim.limit_value : null;
        return { code: p.code, name: p.name, has_api: mods.includes('API'), calls_day: base == null ? null : base + extra, addons: extra, source: 'SUS' };
      }
      const FB = { PILOTO: ['Piloto', true, 5000], INICIA: ['Inicia', false, 0], CRECER: ['Crecer', false, 0], ESCALA: ['Escala', true, 10000] };
      const f = FB[t.plan] || ['Sin plan', false, 0];
      return { code: t.plan || '—', name: f[0], has_api: f[1], calls_day: f[2], addons: 0, source: 'respaldo' };
    },
    keyStatus(k) { if (!k) return null; if (k.status === 'REVOKED') return 'REVOKED'; if (k.expires_at < G.TODAY) return 'EXPIRED'; return 'ACTIVE'; },
    tokenFor(prefix) { return vault.get(prefix) || null; },
    /* ---------- claves (RN-API-01 … RN-API-04, RN-API-09, RN-API-10) ---------- */
    createKey(o = {}, { r, at, by } = {}) {
      if (!r) { perm('api.key.manage', 'crear claves'); G.assertMod('API'); }
      const pl = A.plan(); if (!pl.has_api) G.fail('RN-PLT-07', `El plan ${pl.name} no incluye la API (RN-API-09, D-API-02): no se pueden crear claves (403).`);
      const name = String(o.name || '').trim(); if (name.length < 3) G.fail('RN-API-01', 'Ponle a la clave un nombre de al menos 3 caracteres (quién la usa y para qué).');
      const env = o.environment === 'TEST' ? 'TEST' : 'LIVE';
      const scopes = [...new Set(o.scopes || [])]; if (!scopes.length) G.fail('RN-API-03', 'Elige al menos un alcance.');
      const bad = scopes.filter(s => !scopeRow(s)); if (bad.length) G.fail('RN-API-03', `Alcances fuera del catálogo: ${bad.join(', ')}.`);
      const today = (at || G.date.now()).slice(0, 10);
      const exp = o.expires_at || G.date.add(today, G.param('api_key_default_days') ?? 180); const max = G.param('api_key_max_days') ?? 365;
      if (exp <= today) G.fail('RN-API-02', 'El vencimiento debe ser posterior a hoy.');
      if (G.date.diff(exp, today) > max) G.fail('RN-API-02', `El vencimiento máximo es de ${max} días (hasta el ${F.date(G.date.add(today, max))}); pediste ${G.date.diff(exp, today)}.`);
      const brands = (o.brand_ids || []).filter(Boolean); for (const b of brands) if (!D.get('brands', b)) G.fail('RN-API-11', `La marca ${b} no es de esta empresa.`);
      const ips = (Array.isArray(o.allowed_ips) ? o.allowed_ips : String(o.allowed_ips || '').split(/[\s,;]+/)).map(x => x.trim()).filter(Boolean);
      for (const ip of ips) if (!/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(ip) || ip.split(/[./]/).slice(0, 4).some(n => +n > 255)) G.fail('RN-API-11', `«${ip}» no es una IP ni un rango válido (ej. 181.65.70.12 o 181.65.70.0/24).`);
      if (o.customer_id && !D.get('customers', o.customer_id)) G.fail('RN-API-11', 'El cliente vinculado no existe.');
      let prefix; do { prefix = `ak_${env === 'LIVE' ? 'live' : 'test'}_${rnd(8, ALNUM, r)}`; } while (D.raw('api_keys').some(k => k.prefix === prefix)); // RN-API-04: único en la plataforma
      const secret = rnd(40, B62, r); const token = `${prefix}_${secret}`;
      const sbx = env === 'TEST' ? A.sandbox(true) : null;
      const key = D.insert('api_keys', { name, environment: env, prefix, secret_hash: sha256(secret), hash_algo: 'SHA-256', scopes, brand_ids: brands, allowed_ips: ips, customer_id: o.customer_id || null, channel: o.channel || (o.customer_id ? 'B2B' : 'WEB'), expires_at: exp, status: 'ACTIVE', created_by: by || G.ctx.userName(), created_at: at || G.date.now(), last_used_at: null, last_ip: null, recent: [], sandbox_id: sbx ? sbx.id : null, description: o.description || null }, { silent: true });
      vault.set(prefix, token);
      if (!r) G.audit('CREAR', 'api_keys', key.id, `Clave ${prefix}… (${env === 'LIVE' ? 'producción' : 'pruebas'}) «${name}» · alcances ${scopes.join(', ')} · vence ${F.date(exp)}`);
      return { key, token };
    },
    revokeKey(id, reason, { at, by, silent } = {}) {
      if (!silent) perm('api.key.manage', 'revocar claves');
      const k = D.get('api_keys', id); if (!k) G.fail('RN-API-10', 'La clave no existe.');
      if (A.keyStatus(k) !== 'ACTIVE') G.fail('RN-API-10', `La clave ${k.prefix} ya está ${A.keyStatus(k) === 'REVOKED' ? 'revocada' : 'vencida'}.`);
      if (!reason || String(reason).trim().length < 10) G.fail('RN-API-10', 'Revocar exige un motivo de al menos 10 caracteres.');
      D.update('api_keys', id, { status: 'REVOKED', revoked_at: at || G.date.now(), revoked_by: by || G.ctx.userName(), revoke_reason: reason }, { silent: true });
      if (!silent) G.audit('REVOCAR', 'api_keys', id, `Clave ${k.prefix}… revocada: ${reason}`);
      vault.delete(k.prefix);
      return D.get('api_keys', id);
    },
    reactivateKey(id) { const k = D.get('api_keys', id); G.fail('RN-API-10', `La clave ${k ? k.prefix : ''} está ${k && A.keyStatus(k) === 'EXPIRED' ? 'vencida' : 'revocada'} y no se reactiva: crea una clave nueva.`); },
    /** solo cambia nombre, descripción e IP permitidas; secreto, prefijo, entorno y vencimiento no cambian (RN-API-02, RN-API-10) */
    updateKey(id, patch = {}) {
      perm('api.key.manage', 'editar claves');
      const k = D.get('api_keys', id);
      const locked = ['secret_hash', 'prefix', 'environment', 'secret', 'status'].filter(f => f in patch);
      if (locked.length) G.fail('RN-API-10', `El ${locked.map(f => ({ secret_hash: 'secreto', secret: 'secreto', prefix: 'prefijo', environment: 'entorno', status: 'estado' })[f]).join(', ')} de una clave no cambia: crea otra clave.`);
      if ('expires_at' in patch && patch.expires_at > k.expires_at) G.fail('RN-API-02', 'El vencimiento no se extiende: crea otra clave.');
      if (A.keyStatus(k) !== 'ACTIVE') G.fail('RN-API-10', 'Una clave revocada o vencida no se edita.');
      const ok = {}; for (const f of ['name', 'description', 'allowed_ips', 'expires_at']) if (f in patch) ok[f] = patch[f];
      D.update('api_keys', id, ok);
      return D.get('api_keys', id);
    },
    /* ---------- uso y límites (RN-API-09) ---------- */
    usageRow(k, day) {
      let u = D.find('api_usage_daily', x => x.key_id === k.id && x.day === day);
      if (!u) u = D.insert('api_usage_daily', { key_id: k.id, environment: k.environment, day, calls: 0, ok_2xx: 0, err_4xx: 0, err_5xx: 0, rejected_limit: 0, by_route: {} }, { silent: true });
      return u;
    },
    /** llamadas aceptadas del día en el entorno (las rechazadas por límite no consumen) */
    dailyUsed(env = 'LIVE', day = G.TODAY) { return U.sum(D.where('api_usage_daily', u => u.day === day && u.environment === env), u => u.calls - u.rejected_limit); },
    record(k, res, { route, method, path, ip, at }) {
      const day = at.slice(0, 10); const u = A.usageRow(k, day); const s = res.status;
      const patch = { calls: u.calls + 1, ok_2xx: u.ok_2xx + (s < 300 ? 1 : 0), err_4xx: u.err_4xx + (s >= 400 && s < 500 ? 1 : 0), err_5xx: u.err_5xx + (s >= 500 ? 1 : 0), rejected_limit: u.rejected_limit + (s === 429 ? 1 : 0), by_route: Object.assign({}, u.by_route, route ? { [route]: ((u.by_route || {})[route] || 0) + 1 } : {}) };
      D.update('api_usage_daily', u.id, patch, { silent: true });
      const rec = [{ at, method, path, status: s, ms: res.ms, ip, code: res.body && res.body.code || null, replayed: !!(res.headers || {})['Idempotent-Replayed'] }].concat(k.recent || []).slice(0, 25);
      D.update('api_keys', k.id, { last_used_at: at, last_ip: ip, recent: rec }, { silent: true });
    },
    /* ---------- la llamada (RN-API-03, 09, 11, 13, 14, 15, 18) ---------- */
    call({ token, method = 'GET', path = '', body = null, headers = {}, ip = '181.65.70.12', at } = {}) {
      const when = at || G.date.now(); method = String(method).toUpperCase();
      const hd = {}; for (const [k, v] of Object.entries(headers || {})) hd[k.toLowerCase()] = v;
      token = String(token || hd.authorization || '').replace(/^Bearer\s+/i, '').trim();
      const [pathOnly, qs] = String(path).split('?'); const query = {}; for (const kv of (qs || '').split('&').filter(Boolean)) { const [a, b] = kv.split('='); query[decodeURIComponent(a)] = decodeURIComponent(b || ''); }
      const reqId = 'req_' + sha256(token.slice(0, 16) + when + path + JSON.stringify(body) + Math.random()).slice(0, 16);
      const ms = 38 + parseInt(sha256(method + pathOnly).slice(0, 2), 16) % 140;
      const resp = (status, b, extra = {}) => ({ status, headers: Object.assign({ 'Content-Type': 'application/json', 'X-Request-Id': reqId, 'Aycha-Api-Version': 'v1' }, extra), body: b, ms });
      const errB = e => Object.assign({ code: e.code, message: e.message.replace(/^RN-[A-Z]+-\d+:\s*/, '') }, e.extra || {});
      const prefix = token.slice(0, 16), secret = token.slice(17);
      const k = /^ak_(live|test)_[a-z0-9]{8}$/.test(prefix) ? D.raw('api_keys').find(x => x.prefix === prefix) : null; // RN-API-04: el prefijo identifica al tenant
      if (!k) return resp(401, { code: 'RN-API-11', message: 'Falta la clave o no existe. Envía Authorization: Bearer ak_live_… (401).' });
      const prevTen = G.ctx.tenant; G.ctx.tenant = k.tenant;
      let route = null, out;
      try {
        const kst = A.keyStatus(k);
        if (kst !== 'ACTIVE' || !safeEq(sha256(secret), k.secret_hash)) {
          out = kst === 'REVOKED' ? resp(401, { code: 'RN-API-10', message: `La clave ${prefix} está revocada desde el ${F.datetime(k.revoked_at)}.` })
            : kst === 'EXPIRED' ? resp(401, { code: 'RN-API-02', message: `La clave ${prefix} venció el ${F.date(k.expires_at)}.` })
              : resp(401, { code: 'RN-API-11', message: 'El secreto no corresponde a la clave.' });
        } else {
          const m = /^\/api\/(v\d+)(\/.*)?$/.exec(pathOnly);
          const minute = when.slice(0, 16); const b = minuteBuckets.get(k.id) || { minute, n: 0 }; if (b.minute !== minute) { b.minute = minute; b.n = 0; }
          const pl = A.plan(); const perMin = G.param('api_rate_limit_per_minute') ?? 120;
          const ipOk = !k.allowed_ips || !k.allowed_ips.length || k.allowed_ips.some(x => x.includes('/') ? ipInCidr(ip, x) : x === ip);
          if (!m || m[1] !== 'v1') out = resp(404, { code: 'RN-API-15', message: `La versión ${m ? m[1] : 'pedida'} no existe: usa /api/v1.` });
          else if (!ipOk) out = resp(403, { code: 'RN-API-11', message: `La IP ${ip} no está en la lista permitida de la clave.` });
          else if (!G.modOn('API')) out = resp(403, { code: 'RN-PLT-07', message: 'El módulo API está apagado para esta empresa.' });
          else if (!pl.has_api) out = resp(403, { code: 'RN-PLT-07', message: `El plan ${pl.name} no incluye la API (RN-API-09).` });
          else if (b.n >= perMin) { minuteBuckets.set(k.id, b); out = resp(429, { code: 'RN-API-09', message: `Superaste la ráfaga de ${perMin} llamadas por minuto de la clave.` }, { 'Retry-After': String(60 - (+when.slice(17, 19) || 0)) }); }
          else if (pl.calls_day != null && A.dailyUsed(k.environment, when.slice(0, 10)) >= pl.calls_day) out = resp(429, { code: 'RN-API-09', message: `Llegaste al límite de ${F.num(pl.calls_day)} llamadas del día del plan ${pl.name}.` }, { 'Retry-After': String(Math.max(1, Math.round((toMs(G.date.add(when.slice(0, 10), 1)) - toMs(when)) / 1000))) });
          else {
            b.n++; minuteBuckets.set(k.id, b);
            const rest = m[2] || '/'; const hit = matchRoute(method, rest);
            if (!hit) out = resp(404, { code: 'RN-API-15', message: `No existe ${method} /api/v1${rest}.` });
            else if (hit.method405) out = resp(405, { code: 'RN-API-15', message: `${method} no está permitido en /api/v1${rest}.` });
            else {
              route = hit.r.m + ' ' + hit.r.p;
              if (!k.scopes.includes(hit.r.scope)) out = resp(403, { code: 'RN-API-03', message: `La clave no tiene el alcance ${hit.r.scope}.` });
              else {
                const ctx = { key: k, params: hit.params, query, body, at: when, src: k.environment === 'TEST' ? sbxSrc() : liveSrc };
                try {
                  if (hit.r.write) {
                    const ik = hd['idempotency-key'];
                    if (!ik) E(422, 'RN-API-13', 'Toda escritura exige la cabecera Idempotency-Key.');
                    const res = idem({ key: ik, scope: `${k.prefix} ${route}${k.environment === 'TEST' ? ' [sandbox]' : ''}`, body: { params: hit.params, body } }, () => hit.r.h(ctx), hit.r.code || 201);
                    out = resp(res.http, res.body, res.replayed ? { 'Idempotent-Replayed': 'true' } : {});
                  } else out = resp(200, hit.r.h(ctx));
                } catch (e) {
                  if (e instanceof ApiErr) out = resp(e.status, errB(e));
                  else if (e instanceof G.RuleError) out = /^RN-INT-1[23]$/.test(e.code) ? resp(409, { code: e.code, message: e.message.replace(/^RN-[A-Z]+-\d+:\s*/, '').replace(/: se responde \d+\.?/, '.') }) : resp(422, Object.assign({ code: e.code, message: e.message.replace(/^RN-[A-Z]+-\d+:\s*/, '') }, e.data && e.data.missing ? { missing: e.data.missing } : {}));
                  else { console.error(e); out = resp(500, { code: 'RN-API-18', message: 'Error interno: ' + e.message }); }
                }
              }
            }
          }
        }
        A.record(k, out, { route, method, path, ip, at: when });
        return out;
      } finally { G.ctx.tenant = prevTen; }
    },
    /* ---------- webhooks salientes (RN-API-05 … RN-API-08, RN-API-12, RN-API-17) ---------- */
    validateUrl(url) {
      let u; try { u = new URL(String(url || '').trim()); } catch (e) { G.fail('RN-API-05', 'Escribe una URL completa, por ejemplo https://erp.tucliente.pe/hooks/aycha.'); }
      if (u.protocol !== 'https:') G.fail('RN-API-05', `El destino debe usar https (pusiste ${u.protocol.replace(':', '')}).`);
      const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
      if (host === 'localhost' || /\.(localhost|local|internal|lan)$/.test(host) || !host.includes('.') && !host.includes(':')) G.fail('RN-API-05', `${host} es un nombre local: usa un dominio público.`);
      if (isIp(host) && isPrivate(host)) G.fail('RN-API-05', `${host} es una IP privada o de loopback (protección contra SSRF).`);
      return u.href;
    },
    secretOf(ep, prev) { return dec(prev ? ep.prev_secret_enc : ep.secret_enc); },
    signature(secret, t, body) { return hmac(secret, `${t}.${body}`); },
    signatureHeader(ep, body, at) { const t = unix(at); const sigs = [A.signature(A.secretOf(ep), t, body)]; if (ep.prev_secret_enc && ep.prev_valid_until && at <= ep.prev_valid_until) sigs.push(A.signature(A.secretOf(ep, true), t, body)); return `t=${t}, ` + sigs.map(s => 'v1=' + s).join(', '); },
    /** lo que hace el receptor: acepta si alguna v1 coincide y la marca de tiempo no supera la tolerancia */
    verify(header, secret, body, nowTs) {
      const parts = String(header || '').split(',').map(x => x.trim()); const t = +((parts.find(p => p.startsWith('t=')) || '').slice(2)); const v1 = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));
      if (!t || !v1.length) return { ok: false, reason: 'Cabecera incompleta' };
      const tol = G.param('api_signature_tolerance_seconds') ?? 300;
      if (Math.abs((nowTs ?? t) - t) > tol) return { ok: false, reason: `Firma con ${Math.abs(nowTs - t)} s de antigüedad (máximo ${tol} s)` };
      const exp = A.signature(secret, t, body);
      return v1.some(s => safeEq(s, exp)) ? { ok: true, reason: 'Firma válida' } : { ok: false, reason: 'Ninguna v1 coincide con el HMAC esperado' };
    },
    saveEndpoint(o = {}, { r, at, by } = {}) {
      if (!r) { perm('api.webhook.manage', 'gestionar destinos'); G.assertMod('API'); }
      const name = String(o.name || '').trim(); if (name.length < 3) G.fail('RN-API-05', 'Ponle un nombre al destino.');
      const url = A.validateUrl(o.url);
      const evs = [...new Set(o.events || [])]; if (!evs.length) G.fail('RN-API-06', 'Suscribe el destino a al menos un evento.');
      for (const e of evs) { const et = eventRow(e); if (!et) G.fail('RN-API-06', `El evento ${e} no existe en el catálogo.`); if (et.status !== 'ACTIVE') G.fail('RN-API-06', `El evento ${e} (${et.version}) está retirado del catálogo.`); }
      const when = at || G.date.now();
      const base = { name, url, events: evs, environment: o.environment === 'TEST' ? 'TEST' : 'LIVE', brand_ids: (o.brand_ids || []).filter(Boolean), customer_id: o.customer_id || null, sim_mode: o.sim_mode || 'OK', description: o.description || null };
      if (o.id) {
        const ep = D.get('api_webhook_endpoints', o.id); D.update('api_webhook_endpoints', o.id, base, { silent: !!r });
        return { endpoint: D.get('api_webhook_endpoints', ep.id), secret: null };
      }
      const secret = 'whsec_' + rnd(32, B62, r);
      const ep = D.insert('api_webhook_endpoints', Object.assign(base, { status: 'ACTIVE', secret_enc: enc(secret), secret_last4: secret.slice(-4), secret_version: 1, prev_secret_enc: null, prev_valid_until: null, failure_streak: 0, last_delivery_at: null, last_delivery_status: null, created_by: by || G.ctx.userName(), created_at: when }), { silent: true });
      if (!r) G.audit('CREAR', 'api_webhook_endpoints', ep.id, `Destino ${name} → ${url} · ${evs.join(', ')}`);
      return { endpoint: ep, secret };
    },
    setEndpointStatus(id, status, reason) {
      perm('api.webhook.manage', 'pausar o reanudar destinos');
      const ep = D.get('api_webhook_endpoints', id);
      if (status === 'ACTIVE' && ep.status === 'DISABLED' && (!reason || reason.trim().length < 10)) G.fail('RN-API-12', 'Reactivar un destino desactivado por fallos exige un motivo de al menos 10 caracteres (qué se corrigió).');
      D.update('api_webhook_endpoints', id, { status, failure_streak: status === 'ACTIVE' ? 0 : ep.failure_streak, status_reason: reason || null, disabled_reason: status === 'ACTIVE' ? null : ep.disabled_reason });
      if (status === 'ACTIVE') A.runQueue({ endpoint: id });
      return D.get('api_webhook_endpoints', id);
    },
    /** rota el secreto: el anterior sigue firmando 24 h (RN-API-07) */
    rotateSecret(id, at) {
      perm('api.webhook.manage', 'rotar secretos');
      const ep = D.get('api_webhook_endpoints', id); const when = at || G.date.now();
      const secret = 'whsec_' + rnd(32, B62);
      D.update('api_webhook_endpoints', id, { prev_secret_enc: ep.secret_enc, prev_last4: ep.secret_last4, prev_valid_until: addMin(when, 24 * 60), secret_enc: enc(secret), secret_last4: secret.slice(-4), secret_version: (ep.secret_version || 1) + 1, rotated_at: when }, { silent: true });
      G.audit('ROTAR', 'api_webhook_endpoints', id, `Secreto de ${ep.name}: v${ep.secret_version || 1} (••••${ep.secret_last4}) firma también hasta ${F.datetime(addMin(when, 1440))}; vigente v${(ep.secret_version || 1) + 1} (••••${secret.slice(-4)})`);
      return { endpoint: D.get('api_webhook_endpoints', id), secret };
    },
    eventId(type, sourceId, occurred) { return 'evt_' + sha256(`${G.ctx.tenant}|${type}|${sourceId}|${occurred}`).slice(0, 24); },
    /** publica un evento del catálogo a los destinos suscritos (RN-API-06, RN-API-07, RN-API-17) */
    publish(type, data, { brand_id, customer_id, occurred_at, env = 'LIVE', source_id, attemptNow = !G._seeding } = {}) {
      const et = eventRow(type); if (!et || et.status !== 'ACTIVE') return [];
      if (G.SPEC[et.module] && !G.modOn(et.module)) return [];
      if (!G.modOn('API')) return [];
      const occ = occurred_at || G.date.now(); const event_id = A.eventId(type, source_id || JSON.stringify(data).slice(0, 80), occ);
      const eps = D.where('api_webhook_endpoints', e => ['ACTIVE', 'PAUSED'].includes(e.status) && e.environment === env && (e.events || []).includes(type) && (!(e.brand_ids || []).length || !brand_id || e.brand_ids.includes(brand_id)) && (!e.customer_id || e.customer_id === customer_id));
      const out = eps.map(ep => A.enqueue(ep, { type, event_id, occurred_at: occ, data, version: et.version }));
      if (attemptNow) for (const d of out) if (d.attempts === 0) A.attempt(d.id, occ);
      return out.map(d => D.get('api_webhook_deliveries', d.id));
    },
    enqueue(ep, { type, event_id, occurred_at, data, version = 'v1', test = false }) {
      const dup = D.find('api_webhook_deliveries', d => d.endpoint_id === ep.id && d.event_id === event_id && !d.resent_from);
      if (dup) return dup; // RN-API-07: una sola vez por destino
      const payload = JSON.stringify({ event_id, type, version, occurred_at: occurred_at + '-05:00', livemode: ep.environment === 'LIVE', data });
      return D.insert('api_webhook_deliveries', { number: D.next('WD', 'WD-', 6), endpoint_id: ep.id, environment: ep.environment, event_id, event_type: type, event_version: version, occurred_at, payload, status: 'PENDING', attempts: 0, next_attempt_at: occurred_at, delivered_at: null, dead_at: null, resent_from: null, resent_to: null, last_http: null, last_error: null, test, created_at: occurred_at }, { silent: true });
    },
    /** lo que responde el receptor de la demo según su comportamiento simulado */
    simulate(ep, d, n) {
      const host = hostOf(ep.url); const ip = resolve(host);
      if (isPrivate(ip)) return { http: 0, ms: 2, ip, error: `RN-API-05: ${host} resolvió a ${ip} (red privada); el envío se bloqueó.` };
      const hs = parseInt(sha256(d.id + '#' + n).slice(0, 4), 16);
      const ok = { http: 200, ms: 70 + hs % 260, ip, body: '{"received":true}' };
      switch (ep.sim_mode) {
        case 'FLAKY': return n === 1 ? { http: 504, ms: 9200 + hs % 700, ip, body: '<html><body><h1>504 Gateway Time-out</h1>The server didn\'t respond in time.</body></html>' } : ok;
        case 'DOWN': return n % 2 ? { http: 503, ms: 40 + hs % 90, ip, body: '<html><head><title>503 Service Unavailable</title></head><body>nginx</body></html>' } : { http: 0, ms: 15000, ip };
        case 'SLOW': return { http: 200, ms: 12000 + hs % 3000, ip, body: '{"received":true}' };
        case 'ERROR_500': return { http: 500, ms: 120 + hs % 200, ip, body: '{"error":"Undefined index: data in /var/www/hooks/aycha.php on line 14"}' };
        default: return ok;
      }
    },
    /** un intento de entrega (RN-API-07, RN-API-08, RN-API-12) */
    attempt(id, at) {
      const d = D.get('api_webhook_deliveries', id); if (!d || !['PENDING', 'RETRYING'].includes(d.status)) return d;
      const ep = D.get('api_webhook_endpoints', d.endpoint_id); if (!ep || ep.status !== 'ACTIVE') return d;
      const when = at || G.date.now(); const n = d.attempts + 1;
      const tmo = (G.param('api_webhook_timeout_seconds') ?? 10) * 1000;
      const sig = A.signatureHeader(ep, d.payload, when);
      let res = A.simulate(ep, d, n);
      if (res.ms > tmo) res = { http: 0, ms: tmo, ip: res.ip, error: `Sin respuesta en ${tmo / 1000} s: tiempo de espera agotado (RN-API-08).` };
      if (!res.http && !res.error) res.error = 'Conexión rechazada';
      const ok = res.http >= 200 && res.http < 300;
      const max = G.param('api_webhook_max_attempts') ?? 8; const back = G.param('api_webhook_backoff_minutes') || [1, 5, 30, 120, 360, 720, 1440];
      const wait = !ok && n < max ? back[Math.min(n - 1, back.length - 1)] : null;
      D.insert('api_webhook_attempts', { delivery_id: d.id, endpoint_id: ep.id, attempt_no: n, at: when, http_status: res.http || null, duration_ms: res.ms, ok, resolved_ip: res.ip || null, response_snippet: String(res.body || '').slice(0, 200), error: res.error || (ok ? null : `HTTP ${res.http}`), signature: sig, secret_version: ep.secret_version || 1, wait_next_min: wait, created_at: when }, { silent: true });
      if (ok) {
        D.update('api_webhook_deliveries', d.id, { status: 'DELIVERED', attempts: n, delivered_at: when, last_http: res.http, last_error: null, next_attempt_at: null, signature: sig }, { silent: true });
        D.update('api_webhook_endpoints', ep.id, { failure_streak: 0, last_delivery_at: when, last_delivery_status: 'DELIVERED' }, { silent: true });
      } else {
        const streak = (ep.failure_streak || 0) + 1; const lim = G.param('api_webhook_disable_after_failures') ?? 50;
        const err = res.error || `HTTP ${res.http}`;
        if (n >= max) {
          D.update('api_webhook_deliveries', d.id, { status: 'DEAD', attempts: n, dead_at: when, last_http: res.http || null, last_error: err, next_attempt_at: null, signature: sig }, { silent: true });
          if (!G._seeding) G.notify({ role: 'ADMIN_SISTEMA', title: `Entrega ${d.number} en la cola muerta`, body: `${ep.name} falló ${n} veces (${err}). Reenvíala desde API-07 cuando el destino responda (RN-API-08).`, ref: { screen: 'API-07', params: { id: d.id } }, tone: 'bad', module: 'API' });
        } else D.update('api_webhook_deliveries', d.id, { status: 'RETRYING', attempts: n, last_http: res.http || null, last_error: err, next_attempt_at: addMin(when, wait), signature: sig }, { silent: true });
        const patch = { failure_streak: streak, last_delivery_at: when, last_delivery_status: 'FAILED' };
        if (streak >= lim) Object.assign(patch, { status: 'DISABLED', disabled_at: when, disabled_reason: `RN-API-12: ${streak} intentos fallidos seguidos (último: ${err}).` });
        D.update('api_webhook_endpoints', ep.id, patch, { silent: true });
        if (streak >= lim && !G._seeding) G.notify({ role: 'ADMIN_SISTEMA', title: `Destino ${ep.name} desactivado`, body: `${streak} intentos fallidos seguidos (RN-API-12). Corrige el receptor y reactívalo con motivo en API-04.`, ref: { screen: 'API-04' }, tone: 'bad', module: 'API' });
      }
      return D.get('api_webhook_deliveries', d.id);
    },
    /** procesa las entregas vencidas; all: cada pendiente tiene su siguiente intento a su hora programada */
    runQueue({ upTo, all, endpoint } = {}) {
      const lim = upTo || G.date.now(); let n = 0;
      const due = D.where('api_webhook_deliveries', d => ['PENDING', 'RETRYING'].includes(d.status) && (!endpoint || d.endpoint_id === endpoint) && (all || d.next_attempt_at <= lim)).sort(U.by('next_attempt_at'));
      for (const d of due) { const r = A.attempt(d.id, d.next_attempt_at > lim ? d.next_attempt_at : lim); if (r && r.attempts > d.attempts) n++; }
      return n;
    },
    /** reenvío manual: una entrega nueva del mismo evento (RN-API-07) */
    resend(id, { at } = {}) {
      perm('api.webhook.resend', 'reenviar entregas');
      const d = D.get('api_webhook_deliveries', id);
      if (!['DEAD', 'DELIVERED'].includes(d.status)) G.fail('RN-API-08', `Solo se reenvía una entrega entregada o en la cola muerta (esta está ${(ST[d.status] || [d.status])[0].toLowerCase()}).`);
      const ep = D.get('api_webhook_endpoints', d.endpoint_id); if (ep.status === 'DISABLED') G.fail('RN-API-12', `${ep.name} está desactivado: reactívalo en API-04 antes de reenviar.`);
      const when = at || G.date.now();
      const nd = D.insert('api_webhook_deliveries', { number: D.next('WD', 'WD-', 6), endpoint_id: d.endpoint_id, environment: d.environment, event_id: d.event_id, event_type: d.event_type, event_version: d.event_version, occurred_at: d.occurred_at, payload: d.payload, status: 'PENDING', attempts: 0, next_attempt_at: when, resent_from: d.id, resent_by: G.ctx.userName(), test: d.test, created_at: when }, { silent: true });
      D.update('api_webhook_deliveries', d.id, { resent_to: nd.id, resent_at: when }, { silent: true });
      G.audit('REENVIAR', 'api_webhook_deliveries', d.id, `Reenvío de ${d.number} (${d.event_type}, ${d.event_id}) como ${nd.number}`);
      return A.attempt(nd.id, when);
    },
    sendTest(id, at) {
      perm('api.webhook.manage', 'enviar pruebas');
      const ep = D.get('api_webhook_endpoints', id); if (ep.status !== 'ACTIVE') G.fail('RN-API-12', `${ep.name} no está activo.`);
      const when = at || G.date.now();
      const d = A.enqueue(ep, { type: 'webhook.test', event_id: 'evt_test_' + sha256(id + when + Math.random()).slice(0, 16), occurred_at: when, data: { message: 'Envío de prueba de Aycha', endpoint: ep.name }, test: true });
      return A.attempt(d.id, when);
    },
    /* ---------- sandbox (RN-API-16) ---------- */
    sandbox(create) {
      let s = D.find('api_sandboxes', x => x.tenant === G.ctx.tenant);
      if (!s && create) s = A.resetSandbox({ silent: true });
      return s;
    },
    resetSandbox({ silent, at, r } = {}) {
      if (!silent) perm('api.sandbox.reset', 'reiniciar el sandbox');
      const when = at || G.date.now(); const rr = r || U.rng(860123);
      const data = sandboxData(rr, when);
      let s = D.find('api_sandboxes', x => x.tenant === G.ctx.tenant);
      const patch = { paired_tenant: G.ctx.tenant + '-SBX', status: 'READY', ose_provider: 'FAKE', messaging_provider: 'FAKE', payments_provider: 'FAKE', host: SBX_HOST, last_reset_at: when, next_reset_at: G.date.add(when.slice(0, 10), G.param('api_sandbox_reset_days') ?? 30), reset_count: s ? (s.reset_count || 0) + 1 : 0, reset_by: silent ? 'Sistema' : G.ctx.userName(), data, seq: { order: data.orders.length, doc: data.documents.length } };
      if (s) D.update('api_sandboxes', s.id, patch, { silent: true }); else s = D.insert('api_sandboxes', Object.assign({ id: 'sbx-' + G.ctx.tenant, created_at: when }, patch), { silent: true });
      if (!silent) G.audit('REINICIAR', 'api_sandboxes', s.id, 'Sandbox reiniciado con datos de demostración');
      return D.get('api_sandboxes', s.id);
    },
    exampleOrderBody(env = 'LIVE', o = {}) {
      if (env === 'TEST') { const s = A.sandbox(true); const c = s.data.customers[0]; return { customer_id: c.id, fulfillment: 'DELIVERY', address_id: c.addresses[0].id, delivery_date: G.date.add(G.TODAY, 2), slot: '09:00–13:00', payment_method: 'CREDIT', notes: 'Entregar por la puerta de cocina', external_ref: 'OC-DEMO-' + (o.ref || '0001'), lines: [{ sku: s.data.products[0].sku, qty: 4, est_weight_kg: 3.6 }, { sku: s.data.products[2].sku, qty: 2 }] }; }
      const cu = D.get('customers', o.customer_id || 'cu-B001'); const ad = cu && D.find('customer_addresses', a => a.customer_id === cu.id && a.is_default);
      const z = ad && D.get('delivery_zones', ad.zone_id); const slot = D.find('order_time_slots', s => s.establishment_id === (z ? z.establishment_id : 'es-L1') && /^ts-L\d-1$/.test(s.id)) || D.find('order_time_slots', s => true);
      return { customer_id: cu ? cu.id : null, brand: 'DG', fulfillment: 'DELIVERY', address_id: ad ? ad.id : null, delivery_date: G.date.add(G.TODAY, 2), slot_id: slot ? slot.id : null, payment_method: 'pm-CREDIT', notes: 'Cuyes pelados y eviscerados, entregar por cocina', external_ref: 'OC-ERP-' + (o.ref || '8812'), lines: [{ sku: 'DG-CUY-ENT', qty: 4, est_weight_kg: 3.6 }, { sku: (G.variant('va-DG-CAL-1L') || {}).sku || 'DG-CAL-1L', qty: 2 }] };
    },
  };
  function ipInCidr(ip, cidr) { const [base, bits] = cidr.split('/'); const n = s => s.split('.').reduce((a, x) => (a << 8) + (+x), 0) >>> 0; const mask = bits === '0' ? 0 : (~0 << (32 - +bits)) >>> 0; return (n(ip) & mask) === (n(base) & mask); }

  /* ---------- idempotencia: idempotency_keys de INT (respaldo propio si INT no está) ---------- */
  function idem({ key, scope, body }, fn, code) {
    if (G.int && G.int.idempotent) return G.int.idempotent({ key, scope, body, code }, fn);
    const hash = sha256(scope + '|' + JSON.stringify(body)); const now = G.date.now();
    const row = D.find('idempotency_keys', k => k.key === key && k.scope === scope && k.status !== 'EXPIRED' && k.expires_at >= now);
    if (row) { if (row.request_hash !== hash) G.fail('RN-INT-12', `La clave ${key} ya se usó con otro cuerpo.`); D.update('idempotency_keys', row.id, { replays: (row.replays || 0) + 1, last_replay_at: now }, { silent: true }); return { http: row.response_code, body: row.response_body, replayed: true }; }
    const res = fn();
    D.insert('idempotency_keys', { key, scope, request_hash: hash, status: 'COMPLETED', response_code: code, response_body: res, created_at: now, completed_at: now, expires_at: addMin(now, 24 * 60), replays: 0, user_id: null }, { silent: true });
    return { http: code, body: res, replayed: false };
  }

  /* ---------- rutas de /api/v1 ---------- */
  const lim = (q, def = 20, max = 100) => Math.max(1, Math.min(max, +q.limit || def));
  const ROUTES = A.ROUTES = [
    { m: 'GET', p: '/orders', scope: 'orders:read', name: 'Listar pedidos', q: [['status', 'Estado (CONFIRMED, DELIVERED…)'], ['from', 'Fecha de entrega desde (AAAA-MM-DD)'], ['limit', 'Máximo 100, por defecto 20']], h: c => c.src.listOrders(c) },
    { m: 'GET', p: '/orders/{number}', scope: 'orders:read', name: 'Ver un pedido', h: c => c.src.getOrder(c) },
    { m: 'POST', p: '/orders', scope: 'orders:write', write: true, name: 'Crear pedido', desc: 'Crea y confirma un pedido con las reglas de PED: datos obligatorios (RN-PED-01), precio de la lista del canal de la clave (RN-PED-10) y peso estimado en los productos de peso variable. Guarda la clave que lo creó.', h: c => c.src.createOrder(c) },
    { m: 'POST', p: '/orders/{number}/documents', scope: 'orders:write', write: true, name: 'Emitir comprobante del pedido', desc: 'En producción, solo para pedidos entregados; en el sandbox va al OSE FAKE y queda aceptado sin tocar SUNAT.', h: c => c.src.createDocument(c) },
    { m: 'GET', p: '/customers', scope: 'customers:read', name: 'Listar clientes', q: [['q', 'Texto: nombre, documento o celular'], ['limit', 'Máximo 100']], h: c => c.src.listCustomers(c) },
    { m: 'POST', p: '/customers', scope: 'customers:write', write: true, name: 'Crear cliente', h: c => c.src.createCustomer(c) },
    { m: 'GET', p: '/products', scope: 'products:read', name: 'Catálogo', q: [['brand', 'Código de marca (DG, M2…)'], ['limit', 'Máximo 100']], h: c => c.src.products(c) },
    { m: 'GET', p: '/prices', scope: 'prices:read', name: 'Precios vigentes', q: [['sku', 'Un SKU'], ['limit', 'Máximo 100']], h: c => c.src.prices(c) },
    { m: 'GET', p: '/stock', scope: 'stock:read', name: 'Stock disponible', q: [['sku', 'Un SKU'], ['limit', 'Máximo 100']], h: c => c.src.stock(c) },
    { m: 'GET', p: '/documents', scope: 'documents:read', name: 'Comprobantes', q: [['from', 'Emitidos desde (AAAA-MM-DD)'], ['status', 'Estado SUNAT (ACCEPTED…)'], ['limit', 'Máximo 100']], h: c => c.src.documents(c) },
    { m: 'GET', p: '/payments', scope: 'payments:read', name: 'Cobros', q: [['from', 'Desde (AAAA-MM-DD)'], ['limit', 'Máximo 100']], h: c => c.src.payments(c) },
    { m: 'GET', p: '/deliveries', scope: 'deliveries:read', name: 'Entregas', q: [['date', 'Fecha de entrega (por defecto hoy)']], h: c => c.src.deliveries(c) },
    { m: 'GET', p: '/webhook-endpoints', scope: 'webhooks:write', name: 'Listar destinos de webhooks', h: c => ({ data: D.where('api_webhook_endpoints', e => e.environment === c.key.environment).map(e => ({ id: e.id, url: e.url, events: e.events, status: e.status, failure_streak: e.failure_streak })) }) },
    { m: 'POST', p: '/webhook-endpoints', scope: 'webhooks:write', write: true, name: 'Crear destino de webhooks', desc: 'Devuelve el secreto de firma una sola vez.', h: c => { const b = c.body || {}; try { const r = A.saveEndpoint({ name: b.name || 'Destino creado por API', url: b.url, events: b.events, environment: c.key.environment, brand_ids: c.key.brand_ids }, { r: true, at: c.at, by: 'API ' + c.key.prefix }); return { id: r.endpoint.id, url: r.endpoint.url, events: r.endpoint.events, secret: r.secret }; } catch (e) { if (e instanceof G.RuleError) E(422, e.code, e.message.replace(/^RN-[A-Z]+-\d+:\s*/, '')); throw e; } } },
  ];
  for (const r of ROUTES) r.rx = new RegExp('^' + r.p.replace(/\{(\w+)\}/g, '(?<$1>[^/]+)') + '/?$');
  function matchRoute(method, rest) {
    const hits = ROUTES.filter(r => r.rx.test(rest)); if (!hits.length) return null;
    const r = hits.find(x => x.m === method); if (!r) return { method405: true };
    return { r, params: Object.assign({}, (rest.match(r.rx) || {}).groups || {}) };
  }

  /* ---------- fuente de datos de producción ---------- */
  const brandsOf = k => (k.brand_ids && k.brand_ids.length ? k.brand_ids : D.all('brands').map(b => b.id));
  const orderOut = o => ({
    number: o.number, status: o.status, brand: brandCode(o.brand_id), channel: o.channel, customer: { id: o.customer_id, name: G.custName(o.customer_id) }, external_ref: o.external_ref || null,
    fulfillment: o.fulfillment, delivery_date: o.delivery_date, slot: o.slot_from ? `${o.slot_from}–${o.slot_to}` : null, payment_method: o.payment_method_id, estimated_total: o.estimated_total, final_total: o.final_total ?? null, delivery_fee: o.delivery_fee || 0, paid_amount: o.paid_amount || 0, currency: 'PEN',
    created_at: o.created_at, confirmed_at: o.confirmed_at || null, delivered_at: o.delivered_at || null,
    lines: (o.lines || []).map(l => { const v = G.variant(l.variant_id) || {}; return { sku: v.sku, name: v.name, qty: l.qty, price_basis: l.price_basis, unit_price: l.unit_price, est_weight_kg: l.est_weight_kg ?? null, weighed_kg: l.weighed_kg ?? null, amount: l.final_amount ?? l.est_amount }; }),
  });
  const docOut = d => ({ full_number: d.full_number, doc_type: d.doc_type, issue_date: d.issue_date, brand: brandCode(d.brand_id), customer: { doc_type: d.customer_doc_type, doc_number: d.customer_doc_number, name: d.customer_name }, subtotal: d.subtotal, igv: d.igv, total: d.total, currency: 'PEN', sunat_status: d.sunat_status, order_number: d.order_id ? (D.get('sales_orders', d.order_id) || {}).number || null : null });
  const payOut = p => ({ number: p.number, amount: p.amount, method: p.payment_method_id, paid_at: p.paid_at, status: p.status, brand: brandCode(p.brand_id), orders: (p.allocations || []).map(a => ({ number: a.order_id ? (D.get('sales_orders', a.order_id) || {}).number : null, amount: a.amount })) });
  const variantsOf = k => { const bs = new Set(brandsOf(k)); return D.where('product_variants', v => v.status === 'ACTIVE' && v.sellable && bs.has(v.brand_id)); };
  const stockMap = () => { const whs = new Set(D.where('warehouses', w => w.allows_sale).map(w => w.id)); const m = new Map(); for (const b of D.all('stock_balances')) if (whs.has(b.warehouse_id)) { const x = m.get(b.variant_id) || { qty: 0, kg: 0 }; x.qty += (b.qty || 0) - (b.reserved_qty || 0); x.kg += b.weight_kg || 0; m.set(b.variant_id, x); } return m; };
  const liveSrc = {
    listOrders(c) {
      const bs = new Set(brandsOf(c.key)); const q = c.query;
      let os = D.where('sales_orders', o => bs.has(o.brand_id) && (!c.key.customer_id || o.customer_id === c.key.customer_id) && (!q.status || o.status === q.status) && (!q.from || (o.delivery_date || '') >= q.from));
      os = os.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); const n = lim(q);
      return { data: os.slice(0, n).map(orderOut), total: os.length, has_more: os.length > n };
    },
    getOrder(c) {
      const o = D.find('sales_orders', x => x.number === c.params.number);
      if (!o || !brandsOf(c.key).includes(o.brand_id) || (c.key.customer_id && o.customer_id !== c.key.customer_id)) E(404, 'RN-API-11', `No existe el pedido ${c.params.number} para esta clave.`);
      return orderOut(o);
    },
    createOrder(c) {
      const k = c.key; const b = c.body || {};
      const brand = b.brand ? brandByCode(b.brand) : D.get('brands', brandsOf(k)[0]);
      if (!brand || !brandsOf(k).includes(brand.id)) E(403, 'RN-API-11', `La clave no puede crear pedidos de la marca ${b.brand || '—'}.`);
      const cid = b.customer_id || k.customer_id; if (k.customer_id && cid !== k.customer_id) E(403, 'RN-API-11', `La clave solo crea pedidos de ${G.custName(k.customer_id)}.`);
      const cust = cid && D.get('customers', cid);
      const ad = b.address_id ? D.get('customer_addresses', b.address_id) : null;
      const adOk = ad && ad.customer_id === cid ? ad : null;
      const zone = adOk && adOk.zone_id ? D.get('delivery_zones', adOk.zone_id) : null;
      const pm = b.payment_method ? (D.get('payment_methods', b.payment_method) || D.get('payment_methods', 'pm-' + b.payment_method)) : null;
      const slot = b.slot_id ? D.get('order_time_slots', b.slot_id) : null;
      const fulfillment = b.fulfillment || 'DELIVERY';
      if (!['DELIVERY', 'PICKUP', 'PROVINCE_SHIPPING'].includes(fulfillment)) E(422, 'RN-PED-01', `Modo de entrega no válido: ${fulfillment}.`);
      const lines = (b.lines || []).map(l => { const v = D.find('product_variants', x => x.sku === l.sku); if (!v) E(422, 'RN-PED-02', `El SKU ${l.sku} no existe en el catálogo.`); return { variant_id: v.id, qty: +l.qty || 1, est_weight_kg: l.est_weight_kg != null ? +l.est_weight_kg : undefined, cut_notes: l.cut_notes || null }; });
      const probe = { brand_id: brand.id, channel: k.channel || 'B2B', customer_id: cust ? cust.id : null, fulfillment, address_id: adOk ? adOk.id : null, zone_id: zone ? zone.id : null, delivery_date: b.delivery_date || null, slot_id: slot ? slot.id : null, payment_method_id: pm ? pm.id : null, notes: b.notes || null, requested_doc_type: b.doc_type || (cust && cust.doc_type === 'RUC' ? 'INVOICE' : 'RECEIPT'), contact_phone: b.contact_phone || (cust && cust.phone) || null, pickup_establishment_id: fulfillment === 'PICKUP' ? (b.pickup_establishment_id || 'es-L1') : null, lines: [] };
      for (const ln of lines) G.orders.addLine(probe, ln, { noRecalc: true }); // RN-PED-02, RN-CAT-05, RN-PED-10
      G.orders.recalc(probe);
      const miss = G.orders.missing(probe);
      if (miss.length) E(422, 'RN-PED-01', `Faltan datos obligatorios: ${miss.join(', ')}.`, { missing: miss });
      const o = G.orders.create({ customer_id: probe.customer_id, brand_id: brand.id, channel: probe.channel, fulfillment, address_id: probe.address_id, delivery_date: probe.delivery_date, slot_id: probe.slot_id, payment_method_id: probe.payment_method_id, requested_doc_type: probe.requested_doc_type, notes: probe.notes, lines, external_ref: b.external_ref || null, seller_id: null, contact_phone: probe.contact_phone, pickup_establishment_id: probe.pickup_establishment_id, establishment_id: zone ? zone.establishment_id : undefined, extra: { api_key_id: k.id, origin_ref: 'API ' + k.prefix } });
      try { G.orders.transition(o.id, 'CONFIRMED', { reason: `Recibido por la API (${k.prefix}, ${k.name})`, user: 'API ' + k.prefix }); }
      catch (e) { try { G.orders.transition(o.id, 'CANCELLED', { reason: 'Rechazado al confirmar por la API: ' + e.message, user: 'API ' + k.prefix }); } catch (x) { } throw e; }
      return Object.assign(orderOut(D.get('sales_orders', o.id)), { api_key: k.prefix });
    },
    createDocument(c) {
      const o = D.find('sales_orders', x => x.number === c.params.number);
      if (!o || !brandsOf(c.key).includes(o.brand_id) || (c.key.customer_id && o.customer_id !== c.key.customer_id)) E(404, 'RN-API-11', `No existe el pedido ${c.params.number} para esta clave.`);
      const ex = D.find('sales_documents', d => d.order_id === o.id && ['INVOICE', 'RECEIPT'].includes(d.doc_type) && d.status !== 'VOIDED'); if (ex) return docOut(ex);
      if (!['DELIVERED', 'CLOSED'].includes(o.status)) E(422, 'RN-API-14', `El pedido ${o.number} está ${G.ui.statusLabel(o.status).toLowerCase()}: el comprobante se emite al entregar (FAC).`);
      if (!G.docs || !G.docs.fromOrder) E(503, 'RN-API-18', 'Facturación no disponible.');
      return docOut(G.docs.fromOrder(o));
    },
    listCustomers(c) {
      const s = String(c.query.q || '').toLowerCase(); const n = lim(c.query);
      const cs = c.key.customer_id ? [D.get('customers', c.key.customer_id)].filter(Boolean) : D.where('customers', x => x.status === 'ACTIVE' && (!s || [x.full_name, x.trade_name, x.doc_number, x.phone].some(v => String(v || '').toLowerCase().includes(s))));
      return { data: cs.slice(0, n).map(x => ({ id: x.id, doc_type: x.doc_type, doc_number: x.doc_number, name: x.trade_name || x.full_name, legal_name: x.full_name, phone: x.phone, email: x.email, type: x.customer_type, addresses: D.where('customer_addresses', a => a.customer_id === x.id && a.status === 'ACTIVE').map(a => ({ id: a.id, label: a.label, address_line: a.address_line, zone: a.zone_id, has_pin: a.lat != null })) })), total: cs.length };
    },
    createCustomer(c) {
      const b = c.body || {}; const dt = String(b.doc_type || '').toUpperCase(); const dn = String(b.doc_number || '');
      if (dt === 'RUC' && !U.rucOk(dn)) E(422, 'RN-API-14', `El RUC ${dn} no es válido (dígito verificador).`);
      if (dt === 'DNI' && !U.dniOk(dn)) E(422, 'RN-API-14', `El DNI ${dn} no es válido (8 dígitos).`);
      if (!['RUC', 'DNI'].includes(dt)) E(422, 'RN-API-14', 'doc_type debe ser RUC o DNI.');
      if (b.phone && !U.phoneOk(b.phone)) E(422, 'RN-API-14', `El celular ${b.phone} no tiene el formato +51 9XXXXXXXX.`);
      if (!b.name) E(422, 'RN-API-14', 'Falta el nombre o razón social.');
      const dup = D.find('customers', x => x.doc_number === dn); if (dup) E(422, 'RN-API-14', `Ya existe el cliente ${dup.id} con el documento ${dn}.`, { id: dup.id });
      const cu = D.insert('customers', { doc_type: dt, doc_number: dn, full_name: b.name, trade_name: b.trade_name || null, phone: b.phone || null, email: b.email || null, customer_type: dt === 'RUC' ? 'BUSINESS' : 'PERSON', source_channel: 'API', marketing_opt_in: false, status: 'ACTIVE', orders_count: 0, segment_brands: [], created_by_api_key: c.key.id });
      return { id: cu.id, doc_type: dt, doc_number: dn, name: cu.full_name };
    },
    products(c) { const bf = c.query.brand ? (brandByCode(c.query.brand) || {}).id : null; const vs = variantsOf(c.key).filter(v => !bf || v.brand_id === bf); const n = lim(c.query, 50); return { data: vs.slice(0, n).map(v => ({ sku: v.sku, name: v.name, brand: brandCode(v.brand_id), sale_mode: v.sale_mode, uom: (v.uom_id || '').replace('um-', ''), nominal_weight_kg: v.nominal_weight_kg ?? null, min_order_qty: v.min_order_qty ?? 1, storage: (G.productOf(v.id) || {}).storage || null })), total: vs.length }; },
    prices(c) { const vs = variantsOf(c.key).filter(v => !c.query.sku || v.sku === c.query.sku); const n = lim(c.query, 50); const out = []; for (const v of vs) { if (out.length >= n) break; const p = G.price.of(v.id, { brand_id: v.brand_id, channel: c.key.channel || 'WEB', customer_id: c.key.customer_id || undefined }); if (p) out.push({ sku: v.sku, price: p.price, basis: p.basis, includes_igv: true, currency: 'PEN', list: p.list_id }); } return { data: out, channel: c.key.channel || 'WEB' }; },
    stock(c) { const m = stockMap(); const vs = variantsOf(c.key).filter(v => !c.query.sku || v.sku === c.query.sku); if (c.query.sku && !vs.length) E(404, 'RN-API-11', `No existe el SKU ${c.query.sku}.`); const n = lim(c.query, 50); return { data: vs.slice(0, n).map(v => { const x = m.get(v.id) || { qty: 0, kg: 0 }; return { sku: v.sku, available_qty: Math.max(0, R(x.qty, 3)), weight_kg: R(x.kg, 3), status: x.qty <= 0 ? 'OUT' : x.qty <= lowOf(v) ? 'LOW' : 'OK' }; }), as_of: c.at }; },
    documents(c) { const bs = new Set(brandsOf(c.key)); const q = c.query; const ds = D.where('sales_documents', d => bs.has(d.brand_id) && (!q.from || d.issue_date >= q.from) && (!q.status || d.sunat_status === q.status) && (!c.key.customer_id || d.customer_id === c.key.customer_id)).sort((a, b) => String(b.issue_date + b.full_number).localeCompare(String(a.issue_date + a.full_number))); const n = lim(q); return { data: ds.slice(0, n).map(docOut), total: ds.length, has_more: ds.length > n }; },
    payments(c) { const bs = new Set(brandsOf(c.key)); const ps = D.where('payments', p => bs.has(p.brand_id) && (!c.query.from || String(p.paid_at) >= c.query.from) && (!c.key.customer_id || p.customer_id === c.key.customer_id)).sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at))); const n = lim(c.query); return { data: ps.slice(0, n).map(payOut), total: ps.length }; },
    deliveries(c) { const day = c.query.date || c.at.slice(0, 10); const bs = new Set(brandsOf(c.key)); const os = D.where('sales_orders', o => bs.has(o.brand_id) && o.delivery_date === day && ['IN_ROUTE', 'DELIVERED', 'NOT_DELIVERED', 'CLOSED'].includes(o.status) && (!c.key.customer_id || o.customer_id === c.key.customer_id)); return { data: os.map(o => ({ number: o.number, status: o.status, zone: o.zone_id, driver: o.driver_user_id ? G.userShort(o.driver_user_id) : null, slot: o.slot_from ? `${o.slot_from}–${o.slot_to}` : null, delivered_at: o.delivered_at || null })), date: day }; },
  };
  const lowOf = v => (v.min_stock_qty ?? v.min_qty ?? v.reorder_point ?? G.param('api_stock_low_default_qty') ?? 5);

  /* ---------- fuente de datos del sandbox (tenant de pruebas emparejado, RN-API-16) ---------- */
  function sandboxData(r, when) {
    const vs = ['va-DG-CUY-ENT', 'va-DG-CON-ENT', 'va-DG-CAL-1L', 'va-DG-POL-ENT', 'va-M2-BON-KG', 'va-M3-CHO-500', 'va-M5-MER-AGU'].map(id => G.variant(id)).filter(Boolean);
    const products = vs.map((v, i) => { const p = G.price.of(v.id, { brand_id: v.brand_id, channel: 'B2B' }) || G.price.of(v.id, { brand_id: v.brand_id, channel: 'WEB' }) || { price: 20, basis: 'UNIT' }; return { sku: 'SBX-' + v.sku, name: v.name + ' (demo)', brand: brandCode(v.brand_id), sale_mode: v.sale_mode, nominal_weight_kg: v.nominal_weight_kg ?? null, price: p.price, basis: p.basis, stock: 20 + Math.floor(r() * 80) - (i === 3 ? 18 : 0) }; });
    const ruc = U.rucCheck ? U.rucCheck('2061234567') : '20612345671';
    const customers = [
      { id: 'sbx-cu-1', doc_type: 'RUC', doc_number: ruc, name: 'RESTAURANTE DEMO SAC', phone: '+51900000001', addresses: [{ id: 'sbx-ad-1', address_line: 'Av. Ejemplo 123, Santiago de Surco', reference: 'Puerta de cocina', lat: -12.13, lng: -76.99 }] },
      { id: 'sbx-cu-2', doc_type: 'DNI', doc_number: '40000001', name: 'Cliente de Prueba', phone: '+51900000002', addresses: [{ id: 'sbx-ad-2', address_line: 'Calle Prueba 456, Miraflores', reference: 'Frente al parque', lat: -12.12, lng: -77.03 }] },
      { id: 'sbx-cu-3', doc_type: 'RUC', doc_number: U.rucCheck ? U.rucCheck('2061234568') : '20612345680', name: 'TIENDA ONLINE DEMO EIRL', phone: '+51900000003', addresses: [] },
    ];
    const orders = []; const STS = ['DELIVERED', 'DELIVERED', 'CONFIRMED', 'IN_ROUTE', 'CANCELLED'];
    for (let i = 0; i < 5; i++) {
      const c = customers[i % 2]; const p1 = products[i % products.length], p2 = products[(i + 2) % products.length];
      const ls = [p1, p2].map((p, j) => { const qty = 1 + ((i + j) % 3); const w = p.basis === 'KG' ? R(qty * (p.nominal_weight_kg || 1), 3) : null; return { sku: p.sku, name: p.name, qty, price_basis: p.basis, unit_price: p.price, est_weight_kg: w, weighed_kg: null, amount: R((w ?? qty) * p.price) }; });
      const day = G.date.add(when.slice(0, 10), -(5 - i));
      orders.push({ number: 'SBX-' + U.pad(i + 1, 6), status: STS[i], brand: 'DG', channel: 'B2B', customer: { id: c.id, name: c.name }, external_ref: 'OC-DEMO-' + U.pad(100 + i, 4), fulfillment: 'DELIVERY', delivery_date: day, slot: '09:00–13:00', payment_method: 'pm-CREDIT', estimated_total: R(U.sum(ls, l => l.amount)), final_total: null, delivery_fee: 0, paid_amount: 0, currency: 'PEN', created_at: day + 'T08:1' + i + ':00', confirmed_at: day + 'T08:2' + i + ':00', delivered_at: STS[i] === 'DELIVERED' ? day + 'T11:40:00' : null, lines: ls, address_id: c.addresses[0] ? c.addresses[0].id : null });
    }
    const documents = [orders[0]].map((o, i) => { const t = G.tax.split(o.estimated_total, true, '10'); return { full_number: 'F001-' + U.pad(i + 1, 8), doc_type: 'INVOICE', issue_date: o.delivery_date, brand: 'DG', customer: { doc_type: 'RUC', doc_number: ruc, name: 'RESTAURANTE DEMO SAC' }, subtotal: t.base, igv: t.igv, total: t.total, currency: 'PEN', sunat_status: 'ACCEPTED', ose: 'FAKE', sent_to_sunat: false, cdr_code: '0', order_number: o.number }; });
    return { customers, products, orders, documents, payments: [], messages: [] };
  }
  function sbxSrc() {
    const s = A.sandbox(true); const dt = s.data;
    const save = () => D.update('api_sandboxes', s.id, { data: dt, seq: s.seq }, { silent: true });
    const custOk = (k, cid) => !k.customer_id || !k.customer_id.startsWith('sbx-') || k.customer_id === cid;
    return {
      listOrders(c) { const q = c.query; const os = dt.orders.filter(o => (!q.status || o.status === q.status) && (!q.from || o.delivery_date >= q.from)).slice().reverse(); const n = lim(q); return { data: os.slice(0, n).map(o => { const x = Object.assign({}, o); delete x.address_id; return x; }), total: os.length, has_more: os.length > n, sandbox: true }; },
      getOrder(c) { const o = dt.orders.find(x => x.number === c.params.number); if (!o) E(404, 'RN-API-16', `No existe el pedido ${c.params.number} en el sandbox (las claves ak_test_ no leen producción).`); return o; },
      createOrder(c) {
        const b = c.body || {}; const cu = dt.customers.find(x => x.id === b.customer_id); const miss = [];
        if (!cu || !custOk(c.key, b.customer_id)) miss.push('CLIENTE');
        const fulf = b.fulfillment || 'DELIVERY';
        if (fulf === 'DELIVERY' && !(cu && cu.addresses.find(a => a.id === b.address_id))) miss.push('DIRECCION_CON_PIN');
        if (!b.delivery_date || !(b.slot || b.slot_id)) miss.push('FRANJA');
        const ls = (b.lines || []).map(l => { const p = dt.products.find(x => x.sku === l.sku); if (!p) E(422, 'RN-PED-02', `El SKU ${l.sku} no existe en el sandbox.`); const qty = +l.qty || 1; const w = p.basis === 'KG' ? (l.est_weight_kg != null ? +l.est_weight_kg : (p.sale_mode === 'KG' ? qty : null)) : null; return { sku: p.sku, name: p.name, qty, price_basis: p.basis, unit_price: p.price, est_weight_kg: w, weighed_kg: null, amount: R((p.basis === 'KG' ? (w || 0) : qty) * p.price) }; });
        if (!ls.length) miss.push('PRODUCTOS');
        if (ls.some(l => l.price_basis === 'KG' && !(l.est_weight_kg > 0))) miss.push('PESO_ESTIMADO');
        if (!b.payment_method) miss.push('FORMA_DE_PAGO');
        if (!b.notes) miss.push('NOTAS_DE_PREPARACION');
        if (miss.length) E(422, 'RN-PED-01', `Faltan datos obligatorios: ${miss.join(', ')}.`, { missing: miss });
        s.seq = s.seq || { order: dt.orders.length, doc: dt.documents.length }; s.seq.order++;
        const o = { number: 'SBX-' + U.pad(s.seq.order, 6), status: 'CONFIRMED', brand: 'DG', channel: 'B2B', customer: { id: cu.id, name: cu.name }, external_ref: b.external_ref || null, fulfillment: fulf, delivery_date: b.delivery_date, slot: b.slot || '09:00–13:00', payment_method: b.payment_method, estimated_total: R(U.sum(ls, l => l.amount)), final_total: null, delivery_fee: 0, paid_amount: 0, currency: 'PEN', created_at: c.at, confirmed_at: c.at, delivered_at: null, lines: ls, address_id: b.address_id || null, api_key: c.key.prefix };
        dt.orders.push(o);
        dt.messages.push({ at: c.at, provider: 'FAKE', to: cu.phone, template: 'confirmacion_pedido', ref: o.number, delivered: false, note: 'Proveedor FAKE: no se envía a WhatsApp' });
        save();
        A.publish('order.created', o, { env: 'TEST', occurred_at: c.at, source_id: o.number });
        return Object.assign({}, o, { api_key: c.key.prefix, sandbox: true });
      },
      createDocument(c) {
        const o = dt.orders.find(x => x.number === c.params.number); if (!o) E(404, 'RN-API-16', `No existe el pedido ${c.params.number} en el sandbox.`);
        const ex = dt.documents.find(d => d.order_number === o.number); if (ex) return ex;
        if (o.status === 'CANCELLED') E(422, 'RN-API-14', `El pedido ${o.number} está cancelado.`);
        const cu = dt.customers.find(x => x.id === o.customer.id) || {};
        const type = cu.doc_type === 'RUC' ? 'INVOICE' : 'RECEIPT'; s.seq = s.seq || { order: dt.orders.length, doc: dt.documents.length }; s.seq.doc++;
        const t = G.tax.split(o.estimated_total + (o.delivery_fee || 0), true, '10');
        const doc = { full_number: (type === 'INVOICE' ? 'F001-' : 'B001-') + U.pad(s.seq.doc, 8), doc_type: type, issue_date: c.at.slice(0, 10), brand: o.brand, customer: { doc_type: cu.doc_type, doc_number: cu.doc_number, name: cu.name }, subtotal: t.base, igv: t.igv, total: t.total, currency: 'PEN', order_number: o.number };
        const ad = G.int && G.int.adapterFor ? G.int.adapterFor('EInvoiceProvider', 'SANDBOX') : { name: 'FakeEInvoiceProvider', fake: true, send: d => ({ ok: true, status: 'ACCEPTED', cdr_code: '0', message: `La ${d.full_number} ha sido aceptada (OSE de prueba)` }) };
        if (!ad.fake) E(500, 'RN-API-16', 'El sandbox solo usa el OSE FAKE.');
        const res = ad.send(doc);
        Object.assign(doc, { sunat_status: res.status || 'ACCEPTED', ose: 'FAKE', ose_adapter: ad.name, cdr_code: res.cdr_code || '0', ose_message: res.message, sent_to_sunat: false });
        dt.documents.push(doc); save();
        A.publish('document.accepted', doc, { env: 'TEST', occurred_at: c.at, source_id: doc.full_number });
        return Object.assign({}, doc, { sandbox: true });
      },
      listCustomers(c) { return { data: dt.customers, total: dt.customers.length, sandbox: true }; },
      createCustomer(c) { const b = c.body || {}; if (!b.name || !b.doc_number) E(422, 'RN-API-14', 'Faltan name y doc_number.'); if (String(b.doc_type).toUpperCase() === 'RUC' && !U.rucOk(String(b.doc_number))) E(422, 'RN-API-14', `El RUC ${b.doc_number} no es válido (dígito verificador).`); const cu = { id: 'sbx-cu-' + (dt.customers.length + 1), doc_type: String(b.doc_type || 'DNI').toUpperCase(), doc_number: String(b.doc_number), name: b.name, phone: b.phone || null, addresses: [] }; dt.customers.push(cu); save(); return Object.assign({}, cu, { sandbox: true }); },
      products(c) { return { data: dt.products.map(p => ({ sku: p.sku, name: p.name, brand: p.brand, sale_mode: p.sale_mode, nominal_weight_kg: p.nominal_weight_kg })), total: dt.products.length, sandbox: true }; },
      prices(c) { return { data: dt.products.filter(p => !c.query.sku || p.sku === c.query.sku).map(p => ({ sku: p.sku, price: p.price, basis: p.basis, includes_igv: true, currency: 'PEN' })), sandbox: true }; },
      stock(c) { return { data: dt.products.filter(p => !c.query.sku || p.sku === c.query.sku).map(p => ({ sku: p.sku, available_qty: p.stock, status: p.stock <= (G.param('api_stock_low_default_qty') ?? 5) ? 'LOW' : 'OK' })), as_of: c.at, sandbox: true }; },
      documents(c) { return { data: dt.documents.slice().reverse(), total: dt.documents.length, sandbox: true }; },
      payments(c) { return { data: dt.payments, total: dt.payments.length, sandbox: true }; },
      deliveries(c) { return { data: dt.orders.filter(o => ['IN_ROUTE', 'DELIVERED'].includes(o.status)).map(o => ({ number: o.number, status: o.status, delivered_at: o.delivered_at })), sandbox: true }; },
    };
  }

  /* ---------- eventos del sistema → webhooks (RN-API-06, RN-API-17) ---------- */
  const lastEventAt = () => { const ev = D.raw('domain_events'); const e = ev[ev.length - 1]; return e ? e.at : G.date.now(); };
  const ORDER_EVENTS = ['order.created', 'order.confirmed', 'order.dispatched', 'order.delivered', 'order.not_delivered', 'order.cancelled'];
  for (const name of ORDER_EVENTS) G.events.on(name, p => { try { const o = D.get('sales_orders', p.order_id); if (!o) return; const at = lastEventAt(); A.publish(name, orderOut(o), { brand_id: o.brand_id, customer_id: o.customer_id, occurred_at: at, source_id: o.id + '|' + (o.history || []).length }); } catch (e) { console.error(e); } });
  for (const name of ['document.accepted', 'document.rejected']) G.events.on(name, p => { try { const d = D.get('sales_documents', p.document_id); if (!d) return; A.publish(name, docOut(d), { brand_id: d.brand_id, customer_id: d.customer_id, occurred_at: lastEventAt(), source_id: d.id }); } catch (e) { console.error(e); } });
  for (const name of ['payment.confirmed', 'payment.reversed']) G.events.on(name, p => { try { const x = D.get('payments', p.payment_id); if (!x) return; A.publish(name, payOut(x), { brand_id: x.brand_id, customer_id: x.customer_id, occurred_at: lastEventAt(), source_id: x.id }); } catch (e) { console.error(e); } });
  G.events.on('stock.moved', p => { try {
    if (!p.variant || !(p.qty < 0)) return; const v = G.variant(p.variant); if (!v || !v.sellable) return;
    const x = stockMap().get(v.id) || { qty: 0 }; const th = lowOf(v); if (x.qty > th) return;
    const day = G.TODAY; A.publish('stock.low', { sku: v.sku, name: v.name, brand: brandCode(v.brand_id), available_qty: R(x.qty, 3), threshold: th, threshold_source: v.min_stock_qty != null ? 'ALM' : 'api_stock_low_default_qty' }, { brand_id: v.brand_id, occurred_at: lastEventAt(), source_id: v.id + '|' + day });
  } catch (e) { console.error(e); } });

  /* =====================================================================
     Semilla (86): catálogos, claves, uso de 30 días, sandbox y entregas
     ===================================================================== */
  G.seed(86, function seedAPI() {
    const r = U.rng(860086); const ins = (t, row) => D.insert(t, row, { silent: true });
    const NOW = G.TODAY + 'T10:30:00';
    if (!D.raw('api_scopes').length) {
      SCOPES.forEach(([code, name, module, description], i) => D.insert('api_scopes', { id: 'sc-' + code.replace(':', '-'), code, name, module, description, write: /write$/.test(code), sort_order: i + 1, created_at: '2026-05-02T10:00:00' }, { global: true, silent: true }));
      EVENTS.forEach(([code, module, scope, description, version, status], i) => D.insert('api_event_types', { id: 'et-' + code, code, module, scope, description, version, status, sort_order: i + 1, retired_at: status === 'RETIRED' ? '2026-08-01' : null, created_at: '2026-05-02T10:00:00' }, { global: true, silent: true }));
    }
    if (D.where('api_keys', () => true).length) return;
    const sbx = A.resetSandbox({ silent: true, at: '2026-10-01T03:00:00', r });
    D.update('api_sandboxes', sbx.id, { reset_count: 3, created_at: '2026-07-15T09:00:00' }, { silent: true });

    /* claves */
    const KEY = (o, at, by) => A.createKey(o, { r, at, by }).key;
    const kErp = KEY({ name: 'ERP El Cuy Dorado', description: 'Sistema de compras del restaurante: crea pedidos y consulta precios y stock', environment: 'LIVE', scopes: ['orders:write', 'orders:read', 'products:read', 'prices:read', 'stock:read', 'deliveries:read'], brand_ids: ['br-DG'], allowed_ips: ['181.65.70.12', '181.65.70.13'], customer_id: 'cu-B001', channel: 'B2B', expires_at: '2027-03-15' }, '2026-09-16T11:20:00', 'Luis Ccahuana Rojas');
    const kM5 = KEY({ name: 'Tienda online Marca 5 Gourmet', description: 'Tienda propia en WordPress: catálogo, precios y stock cada 15 min', environment: 'LIVE', scopes: ['products:read', 'prices:read', 'stock:read', 'orders:write', 'orders:read'], brand_ids: ['br-M5'], channel: 'WEB', expires_at: '2027-02-20' }, '2026-08-24T16:05:00', 'Luis Ccahuana Rojas');
    const kBi = KEY({ name: 'BI contabilidad (Estudio Rojas)', description: 'Lee comprobantes y cobros cada noche para el tablero contable', environment: 'LIVE', scopes: ['documents:read', 'payments:read'], brand_ids: [], allowed_ips: ['181.176.40.0/24'], expires_at: G.date.add(G.TODAY, 12) }, '2026-04-25T10:00:00', 'Luis Ccahuana Rojas');
    const kOld = KEY({ name: 'Integración antigua del ERP', environment: 'LIVE', scopes: ['orders:write', 'orders:read'], brand_ids: ['br-DG'], customer_id: 'cu-B001', channel: 'B2B', expires_at: '2027-01-10' }, '2026-07-12T09:00:00', 'Luis Ccahuana Rojas');
    A.revokeKey(kOld.id, 'El restaurante cambió de ERP y la clave se compartió por correo: se reemplaza por una nueva', { at: '2026-09-20T18:05:00', by: 'Luis Ccahuana Rojas', silent: true });
    const kTest = KEY({ name: 'Pruebas El Cuy Dorado', description: 'Desarrollo de la integración del ERP', environment: 'TEST', scopes: ['orders:write', 'orders:read', 'products:read', 'prices:read', 'stock:read', 'documents:read', 'webhooks:write'], brand_ids: [], customer_id: null, channel: 'B2B', expires_at: G.date.add(G.TODAY, 150) }, '2026-09-10T15:00:00', 'Luis Ccahuana Rojas');
    const kExp = KEY({ name: 'Prueba agencia de marketing', environment: 'TEST', scopes: ['products:read', 'prices:read'], brand_ids: ['br-M2'], expires_at: '2026-09-30' }, '2026-07-01T12:00:00', 'Luis Ccahuana Rojas');

    /* uso de los últimos 30 días */
    const day0 = G.date.add(G.TODAY, -29);
    const PROF = [
      [kErp, d => (new Date(d + 'T12:00:00Z').getUTCDay() === 0 ? 90 : 380) + Math.floor(r() * 240), { 'GET /stock': 0.45, 'GET /prices': 0.25, 'GET /orders': 0.16, 'POST /orders': 0.08, 'GET /deliveries': 0.06 }, 0.012, 0.001, { '2026-09-26': 9 }],
      [kM5, () => 900 + Math.floor(r() * 700), { 'GET /stock': 0.62, 'GET /prices': 0.22, 'GET /products': 0.12, 'POST /orders': 0.03, 'GET /orders': 0.01 }, 0.006, 0.0005, { '2026-10-04': 37, '2026-10-08': 12 }],
      [kBi, () => 40 + Math.floor(r() * 25), { 'GET /documents': 0.7, 'GET /payments': 0.3 }, 0.01, 0, {}],
      [kTest, () => Math.floor(r() * 40), { 'GET /orders': 0.3, 'POST /orders': 0.3, 'GET /products': 0.2, 'POST /orders/{number}/documents': 0.2 }, 0.12, 0.01, {}],
    ];
    for (let d = day0; d <= G.TODAY; d = G.date.add(d, 1)) {
      for (const [k, gen, routes, p4, p5, rej] of PROF) {
        if (d < k.created_at.slice(0, 10)) continue;
        let calls = gen(d); if (d === G.TODAY) calls = k === kBi ? 0 : Math.round(calls * 0.42);
        if (!calls) continue;
        const e4 = Math.round(calls * p4 + r() * 2), e5 = Math.round(calls * p5 + (r() < p5 * 100 ? 1 : 0)), rj = rej[d] || 0;
        const by = {}; for (const [rt, f] of Object.entries(routes)) by[rt] = Math.round(calls * f);
        ins('api_usage_daily', { key_id: k.id, environment: k.environment, day: d, calls: calls + rj, ok_2xx: calls - e4 - e5, err_4xx: e4 + rj, err_5xx: e5, rejected_limit: rj, by_route: by, created_at: d + 'T23:59:00' });
      }
      if (d >= '2026-09-11' && d <= '2026-09-20') { const n = 160 + Math.floor(r() * 90); ins('api_usage_daily', { key_id: kOld.id, environment: 'LIVE', day: d, calls: n, ok_2xx: n - 2, err_4xx: 2, err_5xx: 0, rejected_limit: 0, by_route: { 'POST /orders': Math.round(n * 0.2), 'GET /orders': Math.round(n * 0.8) }, created_at: d + 'T23:59:00' }); }
      const late = { '2026-09-21': 14, '2026-09-22': 6, '2026-09-23': 2 }[d]; if (late) ins('api_usage_daily', { key_id: kOld.id, environment: 'LIVE', day: d, calls: late, ok_2xx: 0, err_4xx: late, err_5xx: 0, rejected_limit: 0, by_route: {}, created_at: d + 'T23:59:00' });
    }
    const lastUsed = { [kErp.id]: G.TODAY + 'T10:24:13', [kM5.id]: G.TODAY + 'T10:29:02', [kBi.id]: G.date.add(G.TODAY, -1) + 'T23:31:40', [kTest.id]: G.TODAY + 'T09:12:55', [kOld.id]: '2026-09-23T07:10:02', [kExp.id]: '2026-09-18T16:40:00' };
    const skus = ['DG-CUY-ENT', 'DG-CAL-1L', 'DG-CON-ENT', 'DG-POL-ENT'];
    const erpOrders = D.where('sales_orders', o => o.customer_id === 'cu-B001' && o.brand_id === 'br-DG').sort(U.by('created_at', -1));
    for (const k of [kErp, kM5, kBi, kTest, kOld, kExp]) {
      const recent = []; let t = lastUsed[k.id];
      for (let i = 0; i < 12; i++) {
        const isOld = k === kOld && i < 3; const rt = isOld ? 'GET /orders' : U.pick(r, Object.keys((PROF.find(x => x[0] === k) || [, , { 'GET /products': 1 }])[2]));
        const [m, p0] = rt.split(' '); const path = '/api/v1' + p0.replace('{number}', (erpOrders[i % Math.max(1, erpOrders.length)] || { number: 'P-000001' }).number) + (p0 === '/stock' ? '?sku=' + skus[i % 4] : '');
        const status = isOld ? 401 : m === 'POST' ? (i % 5 === 3 ? 422 : 201) : (k === kM5 && i === 4 ? 429 : 200);
        recent.push({ at: t, method: m, path, status, ms: 40 + Math.floor(r() * 160), ip: k.allowed_ips && k.allowed_ips.length ? k.allowed_ips[0].replace('/24', '').replace(/\.0$/, '.9') : '38.25.' + (10 + i) + '.4', code: status === 401 ? 'RN-API-10' : status === 422 ? 'RN-PED-01' : status === 429 ? 'RN-API-09' : null, replayed: m === 'POST' && i === 1 });
        t = addMin(t, -(3 + Math.floor(r() * 25)));
      }
      D.update('api_keys', k.id, { last_used_at: lastUsed[k.id], last_ip: recent[0].ip, recent }, { silent: true });
    }
    /* pedidos del restaurante creados por la API (sales_orders.api_key_id) y sus claves de idempotencia */
    erpOrders.slice(0, 4).forEach((o, i) => {
      const k = i < 3 ? kErp : kOld; D.update('sales_orders', o.id, { api_key_id: k.id, origin_ref: 'API ' + k.prefix, external_ref: o.external_ref || 'OC-ERP-' + (8790 + i) }, { silent: true });
      ins('idempotency_keys', { key: 'erp-oc-' + (8790 + i), scope: `${k.prefix} POST /orders`, request_hash: sha256(o.id), status: 'COMPLETED', response_code: 201, response_body: { number: o.number, status: 'CONFIRMED' }, user_id: null, created_at: String(o.created_at).slice(0, 19), completed_at: String(o.created_at).slice(0, 19), expires_at: addMin(String(o.created_at).slice(0, 19), 1440), replays: i === 0 ? 1 : 0 });
    });

    /* destinos de webhooks */
    const EP = (o, at) => A.saveEndpoint(o, { r, at, by: 'Luis Ccahuana Rojas' }).endpoint;
    const eErp = EP({ name: 'ERP El Cuy Dorado · avisos de pedido', url: 'https://erp.elcuydorado.pe/hooks/aycha', events: ['order.confirmed', 'order.dispatched', 'order.delivered', 'order.not_delivered'], brand_ids: ['br-DG'], customer_id: 'cu-B001', sim_mode: 'OK', description: 'El ERP del restaurante registra la recepción de la mercadería' }, '2026-09-16T11:40:00');
    const eBi = EP({ name: 'Contabilidad · comprobantes y cobros', url: 'https://bi.estudiorojas.pe/aycha/webhook', events: ['document.accepted', 'payment.confirmed'], sim_mode: 'OK' }, '2026-04-25T10:20:00');
    const eM5 = EP({ name: 'Tienda Marca 5 Gourmet · stock', url: 'https://tienda.marca5gourmet.pe/wp-json/aycha/v1/webhook', events: ['stock.low', 'order.confirmed'], brand_ids: ['br-M5'], sim_mode: 'OK' }, '2026-08-24T16:30:00');
    const eOld = EP({ name: 'ERP antiguo (servidor interno)', url: 'https://erp-legacy.donguando.pe/aycha/webhook', events: ['order.confirmed'], brand_ids: ['br-DG'], sim_mode: 'OK' }, '2026-06-02T09:00:00');
    const eSbx = EP({ name: 'Sandbox · webhook.site', url: 'https://webhook.site/7d1c2e9a-4b8f-4c55-9a51-3e0f1f6b2c11', events: ['order.created', 'document.accepted'], environment: 'TEST', sim_mode: 'OK' }, '2026-09-10T15:10:00');
    D.update('api_webhook_endpoints', eBi.id, { prev_secret_enc: enc('whsec_' + rnd(32, B62, r)), prev_last4: 'Q7xa', prev_valid_until: G.date.add(G.TODAY, -20) + 'T09:00:00', secret_version: 2, rotated_at: G.date.add(G.TODAY, -21) + 'T09:00:00' }, { silent: true });

    const run = (d, upTo = NOW) => { let x = D.get('api_webhook_deliveries', d.id); while (x && ['PENDING', 'RETRYING'].includes(x.status) && x.next_attempt_at <= upTo) { const n = x.attempts; x = A.attempt(x.id, x.next_attempt_at); if (x.attempts === n) break; } return x; };
    const pub = (ep, type, data, at, src, mode) => { const prev = ep.sim_mode; if (mode) D.update('api_webhook_endpoints', ep.id, { sim_mode: mode }, { silent: true }); const d = A.enqueue(D.get('api_webhook_endpoints', ep.id), { type, event_id: A.eventId(type, src, at), occurred_at: at, data }); run(d); if (mode) D.update('api_webhook_endpoints', ep.id, { sim_mode: prev }, { silent: true }); return d; };
    // ERP del restaurante: estados de sus pedidos
    const MAP = { CONFIRMED: 'order.confirmed', IN_ROUTE: 'order.dispatched', DELIVERED: 'order.delivered', NOT_DELIVERED: 'order.not_delivered' };
    let k1 = 0;
    for (const o of erpOrders.slice().reverse()) {
      const hist = (o.history || []).filter(x => MAP[x.to]).map(x => [x.to, norm(x.at)]);
      if (!hist.length) { const c0 = norm(o.confirmed_at || addMin(norm(o.created_at), 12)); hist.push(['CONFIRMED', c0]); if (['DELIVERED', 'CLOSED'].includes(o.status)) { const dv = o.delivered_at ? norm(o.delivered_at) : addMin(c0, 26 * 60); hist.push(['IN_ROUTE', addMin(dv, -95)], ['DELIVERED', dv]); } }
      for (const [to, at] of hist) if (at >= '2026-09-16' && at <= NOW) pub(eErp, MAP[to], Object.assign(orderOut(o), { status: to }), at, o.id + '|' + to, (k1++ % 4 === 2) ? 'FLAKY' : null);
    }
    // contabilidad: comprobantes aceptados y cobros de los últimos días
    const docs = D.where('sales_documents', d => d.sunat_status === 'ACCEPTED' && d.issue_date >= G.date.add(G.TODAY, -3) && d.issue_date < G.TODAY).sort(U.by('full_number')).slice(-18);
    docs.forEach((d, i) => pub(eBi, 'document.accepted', docOut(d), d.issue_date + 'T21:' + U.pad(5 + i, 2) + ':00', d.id, i % 6 === 2 ? 'FLAKY' : null));
    D.where('payments', p => String(p.paid_at || '') >= G.date.add(G.TODAY, -2) && String(p.paid_at) < G.TODAY).slice(-10).forEach((p, i) => pub(eBi, 'payment.confirmed', payOut(p), norm(p.paid_at), p.id, i === 3 ? 'ERROR_500' : null));
    // tienda Gourmet: avisos de stock; el receptor cae desde el 08/10
    const m5 = D.where('product_variants', v => v.brand_id === 'br-M5' && v.sellable && v.status === 'ACTIVE').slice(0, 5);
    const stockEv = (v, at, qty) => ({ sku: v.sku, name: v.name, brand: 'M5', available_qty: qty, threshold: lowOf(v), threshold_source: 'api_stock_low_default_qty' });
    m5.slice(0, 3).forEach((v, i) => pub(eM5, 'stock.low', stockEv(v, null, 2 + i), G.date.add(G.TODAY, -5 + i) + 'T16:4' + i + ':00', v.id + '|a'));
    D.update('api_webhook_endpoints', eM5.id, { sim_mode: 'DOWN' }, { silent: true });
    [['2026-10-08T08:15:00', 0], ['2026-10-08T13:40:00', 1], ['2026-10-09T17:20:00', 2], ['2026-10-10T07:05:00', 3], ['2026-10-10T09:50:00', 4]].forEach(([at, i]) => { if (m5[i % m5.length]) pub(eM5, 'stock.low', stockEv(m5[i % m5.length], at, i % 3), at, m5[i % m5.length].id + '|' + at); });
    // ERP antiguo: el nombre resuelve a una IP privada (RN-API-05) y se desactivó por la racha (RN-API-12)
    const dOld = A.enqueue(D.get('api_webhook_endpoints', eOld.id), { type: 'order.confirmed', event_id: A.eventId('order.confirmed', 'legacy', '2026-09-26T10:12:00'), occurred_at: '2026-09-26T10:12:00', data: erpOrders[4] ? orderOut(erpOrders[4]) : { number: 'P-000001' } });
    D.update('api_webhook_endpoints', eOld.id, { failure_streak: 42 }, { silent: true });
    run(dOld);
    // sandbox: eventos de los pedidos de demostración
    const sd = A.sandbox().data; sd.orders.slice(0, 3).forEach((o, i) => pub(eSbx, 'order.created', o, o.created_at, o.number)); sd.documents.forEach(dd => pub(eSbx, 'document.accepted', dd, dd.issue_date + 'T21:00:00', dd.full_number));
    D.update('api_keys', kExp.id, { recent: (D.get('api_keys', kExp.id).recent || []).slice(0, 4) }, { silent: true });
  }, 'API');

  /* =====================================================================
     Interfaz
     ===================================================================== */
  const wrap = fn => { try { return fn(); } catch (e) { toast(e.message, 'bad'); return null; } };
  const pre = (s, max = 320) => h('pre', { class: 'mono small', style: `white-space:pre-wrap;word-break:break-all;background:var(--surface-2);border:1px solid var(--line);border-radius:6px;padding:8px 10px;max-height:${max}px;overflow:auto;margin:0` }, s);
  const pretty = s => { try { return JSON.stringify(typeof s === 'string' ? JSON.parse(s) : s, null, 2); } catch (e) { return String(s); } };
  const copyBtn = (text, label = 'Copiar') => btn(label, () => { try { navigator.clipboard.writeText(text); } catch (e) { } toast('Copiado al portapapeles', 'ok'); }, { sm: true, kind: 'ghost' });
  const chip = (t, tone) => h('span', { class: 'badge ' + (tone || ''), style: 'margin:0 4px 4px 0;font-family:var(--font-mono);font-size:11px' }, t);
  const httpBadge = s => badge(s ? String(s) : 'sin respuesta', s >= 200 && s < 300 ? 'ok' : s === 429 || s === 409 ? 'warn' : s >= 400 || !s ? 'bad' : 'info');
  const checks = (opts, sel, onCh, cls = 'c2') => h('div', { class: 'grid ' + cls, style: 'gap:6px 14px' }, opts.map(([v, l, sub]) => { const i = h('input', { type: 'checkbox', checked: sel.has(v) }); i.addEventListener('change', () => { if (i.checked) sel.add(v); else sel.delete(v); if (onCh) onCh(); }); return h('label', { class: 'check', style: 'align-items:flex-start' }, i, h('span', { style: 'min-width:0' }, h('span', { class: 'mono small' }, l), sub ? h('div', { class: 'muted small' }, sub) : null)); }));
  const daysLeft = k => G.date.diff(k.expires_at, G.TODAY);
  const reasonModal = (title, label, onOk) => modal(title, (bd, close) => bd.appendChild(form({ id: 'apireason', fields: [{ key: 'reason', label, type: 'textarea', required: true, help: 'Mínimo 10 caracteres. Queda en la auditoría.' }], submitLabel: 'Confirmar', onCancel: close, onSubmit: v => { onOk(v.reason, close); return true; } })));
  const planNote = () => { const p = A.plan(); return `${p.name}${p.source === 'respaldo' ? ' (respaldo sin SUS)' : ''} · ${p.has_api ? (p.calls_day == null ? 'sin límite diario' : F.num(p.calls_day) + ' llamadas/día') : 'sin API'} · ráfaga ${G.param('api_rate_limit_per_minute') ?? 120}/min por clave`; };
  const noApiNotice = body => { const p = A.plan(); if (!p.has_api) body.appendChild(notice(`RN-API-09: el plan ${p.name} de ${(D.raw('tenants').find(t => t.id === G.ctx.tenant) || {}).short || G.ctx.tenant} no incluye la API (D-API-02: el plan Inicial no incluye API). Crear claves responde 403 (RN-PLT-07).`, 'warn')); };

  /* ---------- consola de prueba (usada en API-03, API-08 y API-09) ---------- */
  const CON = { prefix: null, ri: 0, path: '', body: '', idem: '', ip: '181.65.70.12', last: null };
  function apiConsole({ env, prefix } = {}) {
    const keys = D.all('api_keys').filter(k => vault.has(k.prefix) && (!env || k.environment === env));
    if (prefix && vault.has(prefix)) CON.prefix = prefix;
    if (!keys.some(k => k.prefix === CON.prefix)) CON.prefix = keys[0] ? keys[0].prefix : null;
    const key = () => D.find('api_keys', k => k.prefix === CON.prefix);
    const box = h('div', { class: 'stack', style: 'gap:10px' });
    if (!keys.length) { box.appendChild(notice('No hay claves con secreto disponible en esta sesión: crea una en API-02 (el secreto solo se muestra al crearla) o pega una clave completa.', 'info')); }
    const sample = ri => { const r = ROUTES[ri]; const k = key(); const tst = k && k.environment === 'TEST'; const sbx = tst ? A.sandbox(true).data : null; const ord = tst ? sbx.orders[0].number : ((D.where('sales_orders', o => !k || !k.customer_id || o.customer_id === k.customer_id).slice(-1)[0]) || {}).number; let p = '/api/v1' + r.p.replace('{number}', ord || 'P-000001'); if (r.p === '/stock' || r.p === '/prices') p += '?sku=' + (tst ? sbx.products[0].sku : 'DG-CUY-ENT'); if (r.p === '/orders') p += r.m === 'GET' ? '?limit=5' : ''; let b = ''; if (r.m === 'POST') b = pretty(r.p === '/orders' ? A.exampleOrderBody(tst ? 'TEST' : 'LIVE', { customer_id: k && k.customer_id && !tst ? k.customer_id : undefined }) : r.p === '/customers' ? { doc_type: 'RUC', doc_number: U.rucCheck ? U.rucCheck('2061888888') : '20618888881', name: 'PARRILLA EL BUEN CORTE SAC', phone: '+51987654321' } : r.p === '/webhook-endpoints' ? { url: 'https://erp.elcuydorado.pe/hooks/aycha-2', events: ['order.delivered'] } : {}); return { p, b }; };
    if (!CON.path) { const s = sample(CON.ri); CON.path = s.p; CON.body = s.b; }
    const selKey = h('select', { class: 'input', attrs: { 'aria-label': 'Clave' } }, keys.map(k => h('option', { value: k.prefix, selected: k.prefix === CON.prefix }, `${k.prefix}… · ${k.name}${A.keyStatus(k) !== 'ACTIVE' ? ' (' + ST[A.keyStatus(k)][0].toLowerCase() + ')' : ''}`)), h('option', { value: '__paste', selected: CON.prefix === '__paste' }, 'Pegar una clave completa…'));
    const paste = h('input', { class: 'input mono', placeholder: 'ak_live_xxxxxxxx_secreto', value: CON.pasted || '', style: CON.prefix === '__paste' ? '' : 'display:none' });
    const selRoute = h('select', { class: 'input', attrs: { 'aria-label': 'Operación' } }, ROUTES.map((r, i) => h('option', { value: i, selected: i === CON.ri }, `${r.m} ${r.p} · ${r.name}`)));
    const inPath = h('input', { class: 'input mono', value: CON.path });
    const inBody = h('textarea', { class: 'input mono small', rows: 8, style: 'min-height:150px' }, CON.body);
    const inIdem = h('input', { class: 'input mono', value: CON.idem || 'erp-' + rnd(10, ALNUM) });
    const inIp = h('input', { class: 'input mono', value: CON.ip });
    const out = h('div');
    const writeFields = h('div', { class: 'grid c2', style: 'gap:10px' }, h('div', { class: 'field' }, h('label', null, 'Idempotency-Key (RN-API-13)'), h('div', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, inIdem, btn('Nueva', () => { inIdem.value = 'erp-' + rnd(10, ALNUM); CON.idem = inIdem.value; }, { sm: true, kind: 'ghost' }))), h('div', { class: 'field' }, h('label', null, 'Cuerpo JSON'), inBody));
    const showWrite = () => { writeFields.style.display = ROUTES[CON.ri].m === 'POST' ? '' : 'none'; };
    selKey.addEventListener('change', () => { CON.prefix = selKey.value; paste.style.display = CON.prefix === '__paste' ? '' : 'none'; const s = sample(CON.ri); inPath.value = CON.path = s.p; inBody.value = CON.body = s.b; });
    selRoute.addEventListener('change', () => { CON.ri = +selRoute.value; const s = sample(CON.ri); inPath.value = CON.path = s.p; inBody.value = CON.body = s.b; showWrite(); });
    paste.addEventListener('input', () => { CON.pasted = paste.value.trim(); });
    inPath.addEventListener('input', () => { CON.path = inPath.value; }); inBody.addEventListener('input', () => { CON.body = inBody.value; }); inIdem.addEventListener('input', () => { CON.idem = inIdem.value; }); inIp.addEventListener('input', () => { CON.ip = inIp.value; });
    const send = () => {
      const token = CON.prefix === '__paste' ? CON.pasted : vault.get(CON.prefix);
      let body = null; if (ROUTES[CON.ri].m === 'POST' && inBody.value.trim()) { try { body = JSON.parse(inBody.value); } catch (e) { toast('El cuerpo no es JSON válido: ' + e.message, 'bad'); return; } }
      const headers = { Authorization: 'Bearer ' + (token || '') }; if (ROUTES[CON.ri].m === 'POST' && inIdem.value.trim()) headers['Idempotency-Key'] = inIdem.value.trim();
      const res = A.call({ token, method: ROUTES[CON.ri].m, path: inPath.value.trim(), body, headers, ip: inIp.value.trim() });
      CON.idem = inIdem.value; CON.last = { res, method: ROUTES[CON.ri].m, path: inPath.value.trim(), body, headers }; drawOut();
    };
    const drawOut = () => {
      G.ui.clear(out); const L = CON.last; if (!L) return;
      const { res } = L; const tok = (L.headers.Authorization || '').replace('Bearer ', '');
      const curl = `curl -X ${L.method} '${(tok.startsWith('ak_test_') ? SBX_HOST : HOST)}${L.path}' \\\n  -H 'Authorization: Bearer ${tok.slice(0, 16)}_••••' \\\n  -H 'Content-Type: application/json'` + (L.headers['Idempotency-Key'] ? ` \\\n  -H 'Idempotency-Key: ${L.headers['Idempotency-Key']}'` : '') + (L.body ? ` \\\n  -d '${JSON.stringify(L.body)}'` : '');
      out.appendChild(h('div', { class: 'stack', style: 'gap:8px' },
        h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;align-items:center' }, httpBadge(res.status), h('b', null, `${L.method} ${L.path}`), h('span', { class: 'muted small' }, fmtMs(res.ms)), res.headers['Idempotent-Replayed'] ? badge('Respuesta repetida (misma Idempotency-Key)', 'info') : null, res.headers['Retry-After'] ? badge('Retry-After: ' + res.headers['Retry-After'] + ' s', 'warn') : null),
        h('div', { class: 'grid c2', style: 'gap:10px' }, h('div', null, h('div', { class: 'muted small' }, 'Cabeceras de respuesta'), pre(Object.entries(res.headers).map(([k, v]) => `${k}: ${v}`).join('\n'), 160)), h('div', null, h('div', { class: 'muted small' }, 'Equivalente en curl'), pre(curl, 160))),
        h('div', null, h('div', { class: 'muted small' }, 'Cuerpo de respuesta'), pre(pretty(res.body), 360))));
    };
    box.append(
      h('div', { class: 'grid c2', style: 'gap:10px' }, h('div', { class: 'field' }, h('label', null, 'Clave (Authorization: Bearer)'), selKey, paste), h('div', { class: 'field' }, h('label', null, 'Operación'), selRoute)),
      h('div', { class: 'grid c2', style: 'gap:10px' }, h('div', { class: 'field' }, h('label', null, 'Ruta'), inPath), h('div', { class: 'field' }, h('label', null, 'IP de origen (simulada)'), inIp)),
      writeFields, h('div', { class: 'row', style: 'gap:8px' }, btn('Enviar llamada', send, { kind: 'primary' }), btn('Repetir la misma llamada', send, { title: 'Simula un reintento por corte de red' })), out);
    showWrite(); drawOut();
    return box;
  }

  /* ---------- API-01 Claves ---------- */
  function scrKeys(el) {
    const can = isAdmin();
    const body = page(el, { code: 'API-01', title: sp('API-01'), sub: 'Claves con alcances, marcas, IP y vencimiento. Solo se guarda el prefijo y el hash del secreto (RN-API-01); el prefijo identifica a la empresa (RN-API-04).', actions: can ? [{ label: 'Crear clave', kind: 'primary', icon: '+', onClick: () => G.go('API-02') }] : [] });
    if (!G.can('api.key.view')) { body.appendChild(notice(`Tu rol (${G.roleName()}) no tiene el permiso api.key.view.`, 'warn')); return; }
    noApiNotice(body);
    const ks = D.all('api_keys'); const pl = A.plan(); const used = A.dailyUsed('LIVE'); const k3 = G.kpi('KPI-API-03', { from: G.date.add(G.TODAY, -29), to: G.TODAY });
    const soon = ks.filter(k => A.keyStatus(k) === 'ACTIVE' && daysLeft(k) <= 15);
    body.appendChild(kpis([
      { label: 'Claves activas', value: `${ks.filter(k => A.keyStatus(k) === 'ACTIVE').length} de ${ks.length}`, sub: `${ks.filter(k => k.environment === 'LIVE' && A.keyStatus(k) === 'ACTIVE').length} producción · ${ks.filter(k => k.environment === 'TEST' && A.keyStatus(k) === 'ACTIVE').length} pruebas` },
      { label: 'Vencen en 15 días', value: F.num(soon.length), tone: soon.length ? 'warn' : '', sub: soon.map(k => k.name).join(', ') || 'ninguna' },
      { label: 'Llamadas de hoy', value: F.num(used), sub: pl.calls_day == null ? 'sin límite diario' : `de ${F.num(pl.calls_day)} del plan ${pl.name}`, tone: pl.calls_day && used / pl.calls_day > 0.8 ? 'warn' : '', onClick: () => G.go('API-10') },
      { label: 'Rechazadas por límite (30 d)', value: k3 ? F.pct(k3.value, 2) : '—', sub: k3 ? `${F.num(k3.numerator)} de ${F.num(k3.denominator)} · KPI-API-03` : '', onClick: () => G.go('API-10') },
    ]));
    body.appendChild(notice(h('span', null, 'D-API-01: solo claves de API (sin OAuth). D-API-03: solo OpenAPI y ejemplos, sin bibliotecas cliente. Plan: ', h('b', null, planNote()), '.'), 'info'));
    body.appendChild(table({ id: 'api01', rows: ks.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), onRow: k => G.go('API-03', { id: k.id }), searchText: k => k.prefix + ' ' + (k.scopes || []).join(' ') + ' ' + (k.description || ''),
      columns: [
        { key: 'name', label: 'Nombre', render: k => h('div', null, h('b', null, k.name), k.customer_id ? h('div', { class: 'small muted' }, 'Cliente: ' + G.custName(k.customer_id)) : null) },
        { key: 'environment', label: 'Entorno', render: k => envBadge(k.environment) },
        { key: 'prefix', label: 'Prefijo', render: k => h('span', { class: 'mono small' }, k.prefix + '…') },
        { key: 'scopes', label: 'Alcances', value: k => (k.scopes || []).join(' '), render: k => h('div', { style: 'max-width:340px;display:flex;flex-wrap:wrap' }, (k.scopes || []).map(s => chip(s, /write/.test(s) ? 'warn' : ''))) },
        { key: 'brands', label: 'Marcas', value: k => (k.brand_ids || []).length ? k.brand_ids.map(G.brandName).join(', ') : 'Todas' },
        { key: 'expires_at', label: 'Vence', render: k => h('span', { style: A.keyStatus(k) === 'ACTIVE' && daysLeft(k) <= 15 ? 'color:var(--warn);font-weight:700' : '' }, F.date(k.expires_at) + (A.keyStatus(k) === 'ACTIVE' ? ` (${F.days(daysLeft(k))})` : '')) },
        { key: 'last_used_at', label: 'Último uso', render: k => k.last_used_at ? h('div', { class: 'small' }, F.datetime(k.last_used_at), h('div', { class: 'muted mono' }, k.last_ip || '')) : 'Nunca' },
        { key: 'status', label: 'Estado', value: k => A.keyStatus(k), render: k => stD(A.keyStatus(k)) },
      ],
      filters: [{ key: 'environment', label: 'Entorno', options: [['LIVE', 'Producción'], ['TEST', 'Pruebas']] }, { key: 'status', label: 'Estado', value: k => A.keyStatus(k), options: [['ACTIVE', 'Activa'], ['REVOKED', 'Revocada'], ['EXPIRED', 'Vencida']] }, { key: 'write', label: 'Escritura', value: k => (k.scopes || []).some(s => /write$/.test(s)) ? 'Y' : 'N', options: [['Y', 'Con alcances de escritura'], ['N', 'Solo lectura']] }],
      actions: k => can && A.keyStatus(k) === 'ACTIVE' ? [btn('Revocar', () => revokeDlg(k), { sm: true, kind: 'ghost' })] : [] }));
  }
  function revokeDlg(k) { reasonModal(`Revocar ${k.prefix}…`, 'Motivo de la revocación', (reason, close) => wrap(() => { A.revokeKey(k.id, reason); close(); toast(`Clave ${k.prefix}… revocada: la siguiente llamada responderá 401`, 'ok'); G.refresh(); })); }

  /* ---------- API-02 Crear clave ---------- */
  function scrCreateKey(el) {
    const body = page(el, { code: 'API-02', title: sp('API-02'), sub: 'Nombre, entorno, alcances, marcas, IP y vencimiento. El secreto se muestra una sola vez (RN-API-01) y la clave vence siempre (RN-API-02).', actions: [{ label: 'Claves', onClick: () => G.go('API-01') }] });
    noApiNotice(body);
    if (!isAdmin()) body.appendChild(notice(`Tu rol (${G.roleName()}) puede ver esta pantalla pero no crear claves: hace falta api.key.manage (Administrador del sistema).`, 'warn'));
    const def = G.param('api_key_default_days') ?? 180, max = G.param('api_key_max_days') ?? 365;
    const sc = new Set(['orders:read']), br = new Set();
    const preview = h('div');
    const f = form({ id: 'api02', submitLabel: false, values: { environment: 'LIVE', expires_at: G.date.add(G.TODAY, def), channel: 'B2B' }, fields: [
      { key: 'name', label: 'Nombre', required: true, placeholder: 'ERP del restaurante, tienda online…', help: 'Quién usará la clave y para qué.' },
      { key: 'environment', label: 'Entorno', type: 'select', required: true, options: [['LIVE', 'Producción (ak_live_)'], ['TEST', 'Pruebas · sandbox (ak_test_)']], onChange: () => draw() },
      { key: 'expires_at', label: 'Vence', type: 'date', required: true, help: `Por defecto ${def} días; máximo ${max} (RN-API-02).`, onChange: () => draw() },
      { key: 'customer_id', label: 'Cliente vinculado (opcional)', type: 'select', options: D.where('customers', c => c.doc_type === 'RUC' && c.status === 'ACTIVE' && /^cu-B/.test(c.id)).map(c => [c.id, c.trade_name || c.full_name]), help: 'Si la usa un cliente B2B, solo verá y creará sus propios pedidos.' },
      { key: 'channel', label: 'Canal de los pedidos y precios', type: 'select', required: true, options: G.CHANNELS.filter(c => ['B2B', 'WEB', 'OTHER'].includes(c[0])), help: 'Define la lista de precios que aplica (RN-PED-10).' },
      { key: 'allowed_ips', label: 'IP permitidas (opcional)', placeholder: '181.65.70.12, 181.65.70.0/24', help: 'Separadas por coma. Vacío: cualquier IP.' },
      { key: 'description', label: 'Descripción', type: 'textarea' },
    ] });
    function draw() {
      const v = f.api.values; const d = v.expires_at ? G.date.diff(v.expires_at, G.TODAY) : null;
      G.ui.clear(preview).appendChild(h('div', { class: 'stack', style: 'gap:6px' },
        h('div', null, 'Prefijo: ', h('b', { class: 'mono' }, `ak_${v.environment === 'TEST' ? 'test' : 'live'}_xxxxxxxx`), ' + secreto de 40 caracteres.'),
        d == null ? null : h('div', { style: d > max || d <= 0 ? 'color:var(--bad);font-weight:700' : '' }, d > max ? `RN-API-02: ${d} días supera el máximo de ${max}.` : d <= 0 ? 'RN-API-02: el vencimiento debe ser posterior a hoy.' : `Vence el ${F.date(v.expires_at)}, en ${F.days(d)}.`),
        h('div', null, `Alcances: ${sc.size ? [...sc].join(', ') : 'ninguno'} · Marcas: ${br.size ? [...br].map(G.brandName).join(', ') : 'todas'}`),
        v.environment === 'TEST' ? h('div', { class: 'muted small' }, 'RN-API-16: opera solo en el sandbox emparejado (OSE y mensajería FAKE); no lee producción.') : null));
    }
    const grid = h('div', { class: 'grid side-r' });
    grid.appendChild(h('div', { class: 'stack' },
      card('Datos de la clave', f),
      card('Alcances (RN-API-03)', checks(SCOPES.map(s => [s[0], s[0], s[1] + ' · ' + s[2]]), sc, draw)),
      card('Marcas', h('div', null, h('p', { class: 'muted small', style: 'margin-top:0' }, 'Sin marcar: todas las marcas. Los datos se filtran por estas marcas (RN-API-11).'), checks(D.all('brands').map(b => [b.id, b.name]), br, draw)))));
    grid.appendChild(h('div', { class: 'stack' }, card('Resumen', preview), card(null, h('div', { class: 'stack' }, btn('Crear clave', () => {
      const v = f.api.values;
      const r = wrap(() => A.createKey({ name: v.name, environment: v.environment, expires_at: v.expires_at, customer_id: v.customer_id || null, channel: v.channel, allowed_ips: v.allowed_ips, description: v.description, scopes: [...sc], brand_ids: [...br] }));
      if (!r) return;
      G.go('API-03', { id: r.key.id }); showSecret(r);
    }, { kind: 'primary', disabled: !isAdmin() }), h('p', { class: 'muted small', style: 'margin:0' }, 'Guárdala en el gestor de secretos del sistema que la usará. Si se pierde, revócala y crea otra.')))));
    body.appendChild(grid); draw();
  }
  function showSecret({ key, token }) {
    modal('Copia tu clave ahora', bd => bd.append(
      notice('RN-API-01: el secreto se muestra una sola vez. Aycha guarda solo el prefijo y el hash SHA-256; nadie podrá volver a verlo.', 'warn'),
      h('div', { class: 'field' }, h('label', null, key.name), pre(token, 80)),
      dl([['Prefijo', key.prefix], ['Hash guardado', h('span', { class: 'mono small', style: 'word-break:break-all' }, key.secret_hash)], ['Vence', F.date(key.expires_at)]])),
    [{ label: 'Copiar clave', kind: 'primary', onClick: () => { try { navigator.clipboard.writeText(token); } catch (e) { } toast('Clave copiada', 'ok'); return false; } }, { label: 'Ya la guardé', onClick: () => true }]);
  }

  /* ---------- API-03 Detalle de clave ---------- */
  function scrKey(el, p = {}) {
    const k = D.get('api_keys', p.id) || D.all('api_keys').find(x => A.keyStatus(x) === 'ACTIVE') || D.all('api_keys')[0];
    if (!k) { page(el, { code: 'API-03', title: sp('API-03'), sub: 'Sin claves todavía.' }).appendChild(G.ui.empty('Crea la primera clave en API-02.')); return; }
    const s = A.keyStatus(k); const can = isAdmin();
    const acts = [{ label: 'Claves', onClick: () => G.go('API-01') }];
    if (can && s === 'ACTIVE') acts.push({ label: 'Revocar', kind: 'danger', onClick: () => revokeDlg(k) });
    if (can && s !== 'ACTIVE') acts.push({ label: 'Reactivar', onClick: () => wrap(() => A.reactivateKey(k.id)) });
    const body = page(el, { code: 'API-03', title: k.name, sub: `${k.prefix}… · ${k.environment === 'TEST' ? 'pruebas (sandbox)' : 'producción'} · alcances, uso de 30 días y revocación con motivo`, actions: acts });
    if (s === 'REVOKED') body.appendChild(notice(`Revocada el ${F.datetime(k.revoked_at)} por ${k.revoked_by}: ${k.revoke_reason}. No se reactiva y su secreto, prefijo y entorno no cambian (RN-API-10).`, 'bad'));
    if (s === 'EXPIRED') body.appendChild(notice(`Venció el ${F.date(k.expires_at)}: responde 401 y no se extiende; crea otra clave (RN-API-02).`, 'bad'));
    if (s === 'ACTIVE' && daysLeft(k) <= 15) body.appendChild(notice(`Vence en ${F.days(daysLeft(k))}: crea la clave de reemplazo y pásala al sistema que la usa antes del ${F.date(k.expires_at)}.`, 'warn'));
    const from = G.date.add(G.TODAY, -29); const us = D.where('api_usage_daily', u => u.key_id === k.id && u.day >= from).sort(U.by('day'));
    const tot = { calls: U.sum(us, u => u.calls), rej: U.sum(us, u => u.rejected_limit), e4: U.sum(us, u => u.err_4xx), e5: U.sum(us, u => u.err_5xx) };
    body.appendChild(kpis([
      { label: 'Llamadas (30 d)', value: F.num(tot.calls), sub: `${F.num(us.length ? tot.calls / us.length : 0, 0)} por día con uso` },
      { label: 'Rechazadas por límite', value: F.num(tot.rej), sub: tot.calls ? F.pct(tot.rej / tot.calls * 100, 2) + ' · KPI-API-03' : 'KPI-API-03', tone: tot.rej ? 'warn' : '' },
      { label: 'Errores 4xx · 5xx', value: `${F.num(tot.e4)} · ${F.num(tot.e5)}`, tone: tot.e5 ? 'bad' : '' },
      { label: 'Pedidos creados', value: F.num(D.where('sales_orders', o => o.api_key_id === k.id).length), sub: 'sales_orders.api_key_id' },
    ]));
    const grid = h('div', { class: 'grid c2' });
    grid.appendChild(card('Datos', dl([['Prefijo', h('span', { class: 'mono' }, k.prefix + '…')], ['Secreto', h('span', { class: 'mono small' }, 'No se muestra · hash SHA-256 ' + k.secret_hash.slice(0, 12) + '…')], ['Entorno', envBadge(k.environment)], ['Estado', stD(s)], ['Vence', `${F.date(k.expires_at)}${s === 'ACTIVE' ? ' (' + F.days(daysLeft(k)) + ')' : ''}`], ['Marcas', (k.brand_ids || []).length ? k.brand_ids.map(G.brandName).join(', ') : 'Todas'], ['Cliente vinculado', k.customer_id ? G.custName(k.customer_id) : '—'], ['Canal de pedidos', G.channelName(k.channel)], ['IP permitidas', (k.allowed_ips || []).join(', ') || 'Cualquiera'], ['Creada', `${F.datetime(k.created_at)} · ${k.created_by}`], ['Último uso', k.last_used_at ? `${F.datetime(k.last_used_at)} desde ${k.last_ip}` : 'Nunca'], ['Descripción', k.description || '—']])));
    grid.appendChild(card('Alcances', h('div', { class: 'stack', style: 'gap:6px' }, SCOPES.map(([c, n, m]) => h('div', { class: 'row', style: 'gap:8px;align-items:center;opacity:' + (k.scopes.includes(c) ? 1 : 0.45) }, badge(k.scopes.includes(c) ? 'Sí' : 'No', k.scopes.includes(c) ? 'ok' : ''), h('span', { class: 'mono small' }, c), h('span', { class: 'muted small' }, `${n} · ${m}`))))));
    body.appendChild(grid);
    const days = []; for (let d = from; d <= G.TODAY; d = G.date.add(d, 1)) days.push(d);
    const byDay = new Map(us.map(u => [u.day, u]));
    body.appendChild(card('Uso de los últimos 30 días', us.length ? chart.bar({ labels: days.map(d => days.length > 14 ? d.slice(8) : d.slice(8) + '/' + d.slice(5, 7)), stacked: true, series: [{ name: 'Correctas (2xx)', values: days.map(d => (byDay.get(d) || {}).ok_2xx || 0), color: 'var(--ok)' }, { name: 'Errores 4xx', values: days.map(d => { const u = byDay.get(d); return u ? u.err_4xx - u.rejected_limit : 0; }), color: 'var(--accent)' }, { name: 'Rechazadas por límite (429)', values: days.map(d => (byDay.get(d) || {}).rejected_limit || 0), color: 'var(--bad)' }, { name: 'Errores 5xx', values: days.map(d => (byDay.get(d) || {}).err_5xx || 0), color: 'var(--muted)' }] }) : G.ui.empty('Sin llamadas en el período.')));
    body.appendChild(card('Últimas llamadas', table({ id: 'api03rec', search: false, pageSize: 10, rows: k.recent || [], empty: 'Sin llamadas registradas.', columns: [{ key: 'at', label: 'Fecha y hora', render: x => F.datetime(x.at) }, { key: 'method', label: 'Método', mono: true }, { key: 'path', label: 'Ruta', render: x => h('span', { class: 'mono small', style: 'word-break:break-all' }, x.path) }, { key: 'status', label: 'HTTP', render: x => httpBadge(x.status) }, { key: 'code', label: 'Código', render: x => x.code ? h('span', { class: 'mono small' }, x.code) : (x.replayed ? badge('repetida', 'info') : '—') }, { key: 'ms', label: 'Tiempo', align: 'r', render: x => fmtMs(x.ms) }, { key: 'ip', label: 'IP', mono: true }] }), { flush: true }));
    if (vault.has(k.prefix) && s === 'ACTIVE') body.appendChild(card('Probar esta clave', apiConsole({ prefix: k.prefix })));
    else body.appendChild(notice(s === 'ACTIVE' ? 'El secreto de esta clave no está disponible en esta sesión (solo se muestra al crearla). Prueba la API con una clave creada ahora o con las de demostración en API-08.' : 'Prueba con la consola de API-08: una llamada con esta clave responderá 401.', 'info'));
  }

  /* ---------- API-04 Destinos de webhooks ---------- */
  function scrEndpoints(el) {
    const can = G.can('api.webhook.manage');
    const body = page(el, { code: 'API-04', title: sp('API-04'), sub: 'Destinos https que reciben los eventos firmados. Una racha de fallos desactiva el destino (RN-API-12); una entrega exitosa la reinicia.', actions: [can ? { label: 'Nuevo destino', kind: 'primary', icon: '+', onClick: () => G.go('API-05') } : null, { label: 'Procesar reintentos vencidos', onClick: () => { const n = A.runQueue(); toast(n ? `${n} intento(s) realizados` : 'No hay reintentos vencidos a esta hora', n ? 'ok' : 'info'); G.refresh(); } }].filter(Boolean) });
    const eps = D.all('api_webhook_endpoints'); const k1 = G.kpi('KPI-API-01', { from: G.date.add(G.TODAY, -29), to: G.TODAY }); const k2 = G.kpi('KPI-API-02');
    body.appendChild(kpis([
      { label: 'Destinos activos', value: `${eps.filter(e => e.status === 'ACTIVE').length} de ${eps.length}` },
      { label: 'Desactivados o pausados', value: F.num(eps.filter(e => e.status !== 'ACTIVE').length), tone: eps.some(e => e.status === 'DISABLED') ? 'bad' : '' },
      { label: 'Entrega a la primera (30 d)', value: k1 ? F.pct(k1.value, 1) : '—', sub: k1 ? `${k1.numerator} de ${k1.denominator} · KPI-API-01` : '' },
      { label: 'En cola muerta', value: F.num(k2 ? (k2.value ?? k2) : 0), sub: 'sin reenviar · KPI-API-02', tone: k2 && (k2.value ?? k2) ? 'bad' : 'ok', onClick: () => { G.ui._tblState = G.ui._tblState || {}; G.go('API-06', { status: 'DEAD' }); } },
    ]));
    const dl2 = U.groupBy(D.all('api_webhook_deliveries'), 'endpoint_id');
    body.appendChild(table({ id: 'api04', rows: eps, onRow: e => epDrawer(e),
      columns: [
        { key: 'name', label: 'Destino', render: e => h('div', { style: 'min-width:0' }, h('b', null, e.name), h('div', { class: 'mono small muted', style: 'word-break:break-all' }, e.url)) },
        { key: 'events', label: 'Eventos', value: e => e.events.join(' '), render: e => h('div', { style: 'max-width:300px;display:flex;flex-wrap:wrap' }, e.events.map(x => chip(x))) },
        { key: 'environment', label: 'Entorno', render: e => envBadge(e.environment) },
        { key: 'failure_streak', label: 'Racha de fallos', align: 'r', render: e => h('span', { style: e.failure_streak ? 'color:var(--bad);font-weight:700' : '' }, `${e.failure_streak || 0} / ${G.param('api_webhook_disable_after_failures') ?? 50}`) },
        { key: 'last_delivery_at', label: 'Última entrega', render: e => e.last_delivery_at ? h('div', { class: 'small' }, F.datetime(e.last_delivery_at), ' ', e.last_delivery_status === 'DELIVERED' ? badge('OK', 'ok') : badge('Falló', 'bad')) : '—' },
        { key: 'n', label: 'Entregas', align: 'r', value: e => (dl2[e.id] || []).length },
        { key: 'status', label: 'Estado', render: e => stEp(e.status) },
      ],
      filters: [{ key: 'status', label: 'Estado', options: [['ACTIVE', 'Activo'], ['PAUSED', 'Pausado'], ['DISABLED', 'Desactivado']] }, { key: 'environment', label: 'Entorno', options: [['LIVE', 'Producción'], ['TEST', 'Pruebas']] }],
      actions: e => can ? [btn('Editar', () => G.go('API-05', { id: e.id }), { sm: true, kind: 'ghost' }), e.status === 'ACTIVE' ? btn('Enviar prueba', () => testSend(e), { sm: true, kind: 'ghost' }) : null].filter(Boolean) : [] }));
  }
  const stEp = s => badge(({ ACTIVE: 'Activo', PAUSED: 'Pausado', DISABLED: 'Desactivado' })[s] || s, ({ ACTIVE: 'ok', PAUSED: 'warn', DISABLED: 'bad' })[s] || '');
  function testSend(e) { const d = wrap(() => A.sendTest(e.id)); if (!d) return; const at = D.where('api_webhook_attempts', a => a.delivery_id === d.id).slice(-1)[0]; toast(d.status === 'DELIVERED' ? `Prueba entregada: HTTP ${at.http_status} en ${fmtMs(at.duration_ms)}` : `La prueba falló (${d.last_error}); se reintentará en ${fmtMin(at.wait_next_min || 0)}`, d.status === 'DELIVERED' ? 'ok' : 'bad'); G.refresh(); }
  function epDrawer(e) {
    drawer(e.name, (bd, close) => {
      const can = G.can('api.webhook.manage');
      if (e.status === 'DISABLED') bd.appendChild(notice(e.disabled_reason || 'Desactivado.', 'bad'));
      bd.appendChild(dl([['URL', h('span', { class: 'mono small', style: 'word-break:break-all' }, e.url)], ['IP resuelta (al enviar)', h('span', null, resolve(hostOf(e.url)), isPrivate(resolve(hostOf(e.url))) ? badge(' privada: bloqueada (RN-API-05)', 'bad') : null)], ['Entorno', envBadge(e.environment)], ['Eventos', e.events.join(', ')], ['Marcas', (e.brand_ids || []).length ? e.brand_ids.map(G.brandName).join(', ') : 'Todas'], ['Cliente', e.customer_id ? G.custName(e.customer_id) : 'Todos'], ['Secreto de firma', `v${e.secret_version || 1} · whsec_••••${e.secret_last4}` + (e.prev_valid_until && e.prev_valid_until >= G.date.now() ? ` · el anterior (••••${e.prev_last4}) firma hasta ${F.datetime(e.prev_valid_until)}` : '')], ['Racha de fallos', `${e.failure_streak || 0} de ${G.param('api_webhook_disable_after_failures') ?? 50}`], ['Estado', stEp(e.status)], ['Receptor de la demo', SIM.find(s => s[0] === e.sim_mode)[1]]]));
      const ds = D.where('api_webhook_deliveries', d => d.endpoint_id === e.id).sort(U.by('created_at', -1)).slice(0, 8);
      bd.appendChild(card('Últimas entregas', table({ id: 'api04d', search: false, pageSize: 8, rows: ds, onRow: d => { close(); G.go('API-07', { id: d.id }); }, columns: [{ key: 'number', label: 'Entrega', mono: true }, { key: 'event_type', label: 'Evento', mono: true }, { key: 'created_at', label: 'Creada', render: d => F.datetime(d.created_at) }, { key: 'attempts', label: 'Int.', align: 'r' }, { key: 'status', label: 'Estado', render: d => stD(d.status) }] }), { flush: true }));
      if (can) bd.appendChild(h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
        btn('Editar', () => { close(); G.go('API-05', { id: e.id }); }),
        e.status === 'ACTIVE' ? btn('Pausar', () => wrap(() => { A.setEndpointStatus(e.id, 'PAUSED', 'Pausa manual'); close(); toast('Destino pausado: las entregas quedan pendientes', 'ok'); G.refresh(); })) : null,
        e.status === 'PAUSED' ? btn('Reanudar', () => wrap(() => { A.setEndpointStatus(e.id, 'ACTIVE'); close(); toast('Destino reanudado: se enviaron las pendientes', 'ok'); G.refresh(); }), { kind: 'primary' }) : null,
        e.status === 'DISABLED' ? btn('Reactivar con motivo', () => reasonModal('Reactivar ' + e.name, 'Qué se corrigió en el receptor', (reason, c2) => wrap(() => { A.setEndpointStatus(e.id, 'ACTIVE', reason); c2(); close(); toast('Destino reactivado', 'ok'); G.refresh(); })), { kind: 'primary' }) : null,
        e.status === 'ACTIVE' ? btn('Enviar prueba', () => { close(); testSend(e); }) : null,
        btn('Ver entregas', () => { close(); G.go('API-06', { endpoint: e.id }); }, { kind: 'ghost' })));
    }, { code: 'API-04', wide: true });
  }

  /* ---------- API-05 Crear o editar destino ---------- */
  const SIM = [['OK', 'Responde 200 al instante'], ['FLAKY', 'Falla el primer intento (504) y luego responde 200'], ['DOWN', 'Caído: 503 o sin respuesta'], ['SLOW', 'Tarda más de 10 s (tiempo agotado)'], ['ERROR_500', 'Responde 500 (error del receptor)']];
  function scrEndpointEdit(el, p = {}) {
    const ep = p.id ? D.get('api_webhook_endpoints', p.id) : null; const can = G.can('api.webhook.manage');
    const body = page(el, { code: 'API-05', title: ep ? ep.name : 'Nuevo destino', sub: 'URL https pública (RN-API-05), eventos del catálogo vigentes (RN-API-06) y secreto de firma con rotación y 24 h de convivencia (RN-API-07).', actions: [{ label: 'Destinos', onClick: () => G.go('API-04') }] });
    if (!can) body.appendChild(notice(`Tu rol (${G.roleName()}) no tiene el permiso api.webhook.manage.`, 'warn'));
    const evs = new Set(ep ? ep.events : ['order.delivered']); const br = new Set(ep ? ep.brand_ids || [] : []);
    const urlMsg = h('div', { class: 'small' });
    const checkUrl = u => { G.ui.clear(urlMsg); if (!u) return; try { A.validateUrl(u); const ip = resolve(hostOf(u)); urlMsg.append(isPrivate(ip) ? h('span', { style: 'color:var(--warn)' }, `Válida, pero ${hostOf(u)} resuelve hoy a ${ip} (red privada): los envíos se bloquearán (RN-API-05).`) : h('span', { style: 'color:var(--ok)' }, `URL válida · ${hostOf(u)} → ${ip}`)); } catch (e) { urlMsg.append(h('span', { style: 'color:var(--bad)' }, e.message)); } };
    const f = form({ id: 'api05', submitLabel: false, values: ep ? { name: ep.name, url: ep.url, environment: ep.environment, customer_id: ep.customer_id || '', sim_mode: ep.sim_mode, description: ep.description } : { environment: 'LIVE', sim_mode: 'OK', url: 'https://' }, fields: [
      { key: 'name', label: 'Nombre', required: true },
      { key: 'url', label: 'URL del receptor', required: true, span: 2, placeholder: 'https://erp.cliente.pe/hooks/aycha', onChange: v => checkUrl(v) },
      { key: 'environment', label: 'Entorno', type: 'select', required: true, options: [['LIVE', 'Producción'], ['TEST', 'Pruebas (sandbox)']], disabled: !!ep },
      { key: 'customer_id', label: 'Solo pedidos del cliente (opcional)', type: 'select', options: D.where('customers', c => /^cu-B/.test(c.id)).map(c => [c.id, c.trade_name || c.full_name]) },
      { key: 'sim_mode', label: 'Comportamiento del receptor (demostración)', type: 'select', required: true, options: SIM, help: 'Simula cómo responde el sistema del cliente para ver reintentos y cola muerta.' },
      { key: 'description', label: 'Descripción', type: 'textarea' },
    ] });
    f.querySelector('[id="f-api05-url"]') && f.querySelector('[id="f-api05-url"]').parentNode.appendChild(urlMsg);
    const modsOff = EVENTS.filter(x => G.SPEC[x[1]] && !G.modOn(x[1])).map(x => x[0]);
    const grid = h('div', { class: 'grid side-r' });
    grid.appendChild(h('div', { class: 'stack' }, card('Destino', f),
      card('Eventos', h('div', null, h('p', { class: 'muted small', style: 'margin-top:0' }, 'Solo eventos vigentes; un evento de un módulo apagado no se envía (RN-API-06).'), checks(D.all('api_event_types').filter(x => x.status === 'ACTIVE').map(x => [x.code, x.code, `${x.description} · ${x.scope}${modsOff.includes(x.code) ? ' · módulo apagado' : ''}`]), evs))),
      card('Marcas', checks(D.all('brands').map(b => [b.id, b.name]), br))));
    const side = h('div', { class: 'stack' });
    if (ep) {
      side.appendChild(card('Secreto de firma', h('div', { class: 'stack', style: 'gap:8px' }, dl([['Vigente', `v${ep.secret_version || 1} · whsec_••••${ep.secret_last4}`], ['Anterior', ep.prev_valid_until ? `••••${ep.prev_last4} · ${ep.prev_valid_until >= G.date.now() ? 'firma también hasta ' : 'dejó de firmar el '}${F.datetime(ep.prev_valid_until)}` : '—']]),
        btn('Rotar secreto', () => G.ui.confirm({ title: 'Rotar el secreto', message: 'Se genera un secreto nuevo. Durante 24 horas cada entrega lleva dos firmas v1 (nuevo y anterior) para que actualices el receptor sin perder eventos.', confirmLabel: 'Rotar', onConfirm: () => { const r = wrap(() => A.rotateSecret(ep.id)); if (r) { G.refresh(); showWhsec(r.secret, 'Secreto rotado'); } } }), { disabled: !can }))));
      side.appendChild(card('Envío de prueba', h('div', { class: 'stack', style: 'gap:8px' }, h('p', { class: 'muted small', style: 'margin:0' }, 'Envía el evento webhook.test firmado y muestra la respuesta del receptor.'), btn('Enviar prueba', () => testSend(ep), { disabled: !can || ep.status !== 'ACTIVE' }))));
    }
    side.appendChild(card(null, btn(ep ? 'Guardar cambios' : 'Crear destino', () => {
      const v = f.api.values;
      const r = wrap(() => A.saveEndpoint({ id: ep ? ep.id : null, name: v.name, url: v.url, environment: ep ? ep.environment : v.environment, events: [...evs], brand_ids: [...br], customer_id: v.customer_id || null, sim_mode: v.sim_mode, description: v.description }));
      if (!r) return;
      toast(ep ? 'Destino guardado' : 'Destino creado', 'ok');
      G.go('API-05', { id: r.endpoint.id }); if (r.secret) showWhsec(r.secret, 'Secreto de firma del destino');
    }, { kind: 'primary', disabled: !can })));
    grid.appendChild(side); body.appendChild(grid); checkUrl(f.api.values.url);
  }
  function showWhsec(secret, title) { modal(title, bd => bd.append(notice('Se muestra una sola vez. Configúralo en el receptor para validar la cabecera Aycha-Signature.', 'warn'), pre(secret, 60)), [{ label: 'Copiar', kind: 'primary', onClick: () => { try { navigator.clipboard.writeText(secret); } catch (e) { } toast('Secreto copiado', 'ok'); return false; } }, { label: 'Listo', onClick: () => true }]); }

  /* ---------- API-06 Entregas ---------- */
  function scrDeliveries(el, p = {}) {
    const body = page(el, { code: 'API-06', title: sp('API-06'), sub: 'Historial por destino, evento y estado. Los reintentos esperan 1, 5, 30, 120, 360, 720 y 1440 minutos; al octavo intento la entrega pasa a la cola muerta (RN-API-08).', actions: [{ label: 'Procesar vencidas ahora', onClick: () => { const n = A.runQueue(); toast(n ? `${n} intento(s) realizados` : 'Nada vencido a esta hora', n ? 'ok' : 'info'); G.refresh(); } }, { label: 'Adelantar al siguiente reintento', title: 'Demostración: cada entrega pendiente hace su siguiente intento a la hora programada', onClick: () => { const n = A.runQueue({ all: true }); toast(`${n} intento(s) a su hora programada`, 'ok'); G.refresh(); } }] });
    if (!G.can('api.webhook.view_deliveries')) { body.appendChild(notice(`Tu rol (${G.roleName()}) no tiene el permiso api.webhook.view_deliveries.`, 'warn')); return; }
    const all = D.all('api_webhook_deliveries').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const rows = all.filter(d => (!p.endpoint || d.endpoint_id === p.endpoint));
    const cnt = s => rows.filter(d => d.status === s).length;
    const k1 = G.kpi('KPI-API-01', { from: G.date.add(G.TODAY, -29), to: G.TODAY });
    body.appendChild(kpis([{ label: 'Pendientes', value: F.num(cnt('PENDING')) }, { label: 'Reintentando', value: F.num(cnt('RETRYING')), tone: cnt('RETRYING') ? 'warn' : '' }, { label: 'Entregadas', value: F.num(cnt('DELIVERED')) }, { label: 'Cola muerta', value: F.num(cnt('DEAD')), tone: cnt('DEAD') ? 'bad' : '', sub: `${rows.filter(d => d.status === 'DEAD' && !d.resent_to).length} sin reenviar` }, { label: 'A la primera (30 d)', value: k1 ? F.pct(k1.value, 1) : '—', sub: 'KPI-API-01' }]));
    if (p.endpoint) body.appendChild(notice(h('span', null, 'Filtrado por ', h('b', null, epName(p.endpoint)), '. ', h('a', { href: '#', on: { click: e => { e.preventDefault(); G.go('API-06'); } } }, 'Ver todas')), 'info'));
    const tState = (G.ui._tblState || {}).api06; if (p.status && tState) tState.f = Object.assign({}, tState.f, { status: p.status });
    const daysOpts = [...new Set(rows.map(d => String(d.created_at).slice(0, 10)))].sort().reverse().slice(0, 14).map(d => [d, F.date(d)]);
    body.appendChild(table({ id: 'api06', rows, onRow: d => G.go('API-07', { id: d.id }), searchText: d => d.event_id + ' ' + d.payload.slice(0, 300),
      columns: [
        { key: 'number', label: 'Entrega', mono: true, render: d => h('div', null, h('b', { class: 'mono' }, d.number), d.resent_from ? h('div', { class: 'small muted' }, 'reenvío de ' + (D.get('api_webhook_deliveries', d.resent_from) || {}).number) : d.test ? h('div', { class: 'small muted' }, 'prueba') : null) },
        { key: 'created_at', label: 'Creada', render: d => F.datetime(d.created_at) },
        { key: 'endpoint_id', label: 'Destino', value: d => epName(d.endpoint_id) },
        { key: 'event_type', label: 'Evento', render: d => h('div', null, h('span', { class: 'mono small' }, d.event_type), h('div', { class: 'mono small muted' }, d.event_id.slice(0, 18) + '…')) },
        { key: 'attempts', label: 'Intentos', align: 'r', render: d => `${d.attempts} / ${G.param('api_webhook_max_attempts') ?? 8}` },
        { key: 'last_http', label: 'Última respuesta', render: d => d.attempts ? h('span', null, httpBadge(d.last_http), d.last_error && d.status !== 'DELIVERED' ? h('div', { class: 'small', style: 'color:var(--bad)' }, String(d.last_error).slice(0, 70)) : null) : '—' },
        { key: 'next_attempt_at', label: 'Siguiente intento', render: d => ['PENDING', 'RETRYING'].includes(d.status) ? F.datetime(d.next_attempt_at) : d.status === 'DELIVERED' ? 'Entregado ' + F.datetime(d.delivered_at).slice(-5) : d.resent_to ? 'Reenviada' : '—' },
        { key: 'status', label: 'Estado', render: d => stD(d.status) },
      ],
      filters: [{ key: 'status', label: 'Estado', options: [['PENDING', 'Pendiente'], ['RETRYING', 'Reintentando'], ['DELIVERED', 'Entregado'], ['DEAD', 'Cola muerta']] }, { key: 'endpoint_id', label: 'Destino', options: D.all('api_webhook_endpoints').map(e => [e.id, e.name]) }, { key: 'event_type', label: 'Evento', options: [...new Set(all.map(d => d.event_type))].map(x => [x, x]) }, { key: 'day', label: 'Fecha', value: d => String(d.created_at).slice(0, 10), options: daysOpts }] }));
  }

  /* ---------- API-07 Detalle de entrega ---------- */
  function scrDelivery(el, p = {}) {
    const d = D.get('api_webhook_deliveries', p.id) || D.all('api_webhook_deliveries').find(x => x.status === 'DEAD') || D.all('api_webhook_deliveries')[0];
    if (!d) { page(el, { code: 'API-07', title: sp('API-07'), sub: 'Sin entregas todavía.' }).appendChild(G.ui.empty('No hay entregas.')); return; }
    const ep = D.get('api_webhook_endpoints', d.endpoint_id) || {}; const canR = G.can('api.webhook.resend');
    const acts = [{ label: 'Entregas', onClick: () => G.go('API-06') }];
    if (['DEAD', 'DELIVERED'].includes(d.status)) acts.push({ label: 'Reenviar', kind: 'primary', disabled: !canR, onClick: () => { const nd = wrap(() => A.resend(d.id)); if (nd) { toast(`Reenviada como ${nd.number}: ${(ST[nd.status] || [nd.status])[0].toLowerCase()}`, nd.status === 'DELIVERED' ? 'ok' : 'warn'); G.go('API-07', { id: nd.id }); } } });
    if (['PENDING', 'RETRYING'].includes(d.status) && G.can('api.webhook.manage')) acts.push({ label: 'Intentar ahora', onClick: () => wrap(() => { const r = A.attempt(d.id); toast(r.status === 'DELIVERED' ? 'Entregada' : `Falló: ${r.last_error}`, r.status === 'DELIVERED' ? 'ok' : 'bad'); G.refresh(); }) });
    const body = page(el, { code: 'API-07', title: `Entrega ${d.number}`, sub: `${d.event_type} → ${ep.name || '—'} · cuerpo, firma, cada intento y reenvío`, actions: acts });
    if (d.status === 'DEAD') body.appendChild(notice(`En la cola muerta desde ${F.datetime(d.dead_at)} tras ${d.attempts} intentos (RN-API-08).${d.resent_to ? ` Reenviada el ${F.datetime(d.resent_at)} como ${(D.get('api_webhook_deliveries', d.resent_to) || {}).number}.` : ' Reenvíala cuando el destino responda: se crea una entrega nueva del mismo evento.'}`, 'bad'));
    if (d.resent_from) body.appendChild(notice(`Reenvío de ${(D.get('api_webhook_deliveries', d.resent_from) || {}).number} (mismo event_id ${d.event_id}; el receptor deduplica por event_id).`, 'info'));
    const ats = D.where('api_webhook_attempts', a => a.delivery_id === d.id).sort(U.by('attempt_no'));
    const span = ats.length > 1 ? (toMs(ats[ats.length - 1].at) - toMs(ats[0].at)) / 3600e3 : 0;
    body.appendChild(kpis([{ label: 'Estado', value: (ST[d.status] || [d.status])[0], tone: ({ DELIVERED: 'ok', DEAD: 'bad', RETRYING: 'warn' })[d.status] || '' }, { label: 'Intentos', value: `${d.attempts} de ${G.param('api_webhook_max_attempts') ?? 8}` }, { label: 'Entre primer y último intento', value: span ? F.num(span, 1) + ' h' : '—' }, { label: 'Siguiente intento', value: ['PENDING', 'RETRYING'].includes(d.status) ? F.datetime(d.next_attempt_at) : '—' }]));
    const lastSig = d.signature || (ats.slice(-1)[0] || {}).signature || '';
    const hdrs = { 'Content-Type': 'application/json', 'User-Agent': 'Aycha-Webhooks/1.0', 'Aycha-Event': d.event_type, 'Aycha-Event-Id': d.event_id, 'Aycha-Delivery': d.number, 'Aycha-Signature': lastSig };
    const grid = h('div', { class: 'grid c2' });
    grid.appendChild(card('Cuerpo enviado', h('div', { class: 'stack', style: 'gap:6px' }, pre(pretty(d.payload), 380), h('div', { class: 'row', style: 'gap:6px' }, copyBtn(d.payload, 'Copiar cuerpo crudo')))));
    const verifyOut = h('div', { class: 'small' });
    grid.appendChild(card('Cabeceras y firma (RN-API-07)', h('div', { class: 'stack', style: 'gap:8px' }, pre(Object.entries(hdrs).map(([k, v]) => `${k}: ${v}`).join('\n'), 200),
      h('p', { class: 'muted small', style: 'margin:0' }, 'v1 = HMAC-SHA256 en hexadecimal de «t.cuerpo» con el secreto del destino. Durante una rotación van dos v1.'),
      G.can('api.webhook.manage') ? btn('Verificar como el receptor', () => { const t = +((lastSig.match(/t=(\d+)/) || [])[1]); const r1 = A.verify(lastSig, A.secretOf(ep), d.payload, t + 30); const r2 = A.verify(lastSig, A.secretOf(ep), d.payload, unix(G.date.now())); G.ui.clear(verifyOut).append(h('div', null, httpBadge(r1.ok ? 200 : 401), ` A los 30 s del envío: ${r1.reason}.`), h('div', null, httpBadge(r2.ok ? 200 : 401), ` Ahora (${F.datetime(G.date.now())}): ${r2.reason}.`)); }, { sm: true }) : null, verifyOut)));
    body.appendChild(grid);
    body.appendChild(card('Intentos (solo inserción)', table({ id: 'api07', search: false, rows: ats, empty: 'Aún sin intentos.', columns: [
      { key: 'attempt_no', label: '#', align: 'r' }, { key: 'at', label: 'Fecha y hora', render: a => F.datetime(a.at) }, { key: 'http_status', label: 'Código', render: a => httpBadge(a.http_status) }, { key: 'duration_ms', label: 'Tiempo', align: 'r', render: a => fmtMs(a.duration_ms) },
      { key: 'response_snippet', label: 'Respuesta (recortada) o error', render: a => h('div', { class: 'small', style: 'max-width:420px;word-break:break-all' }, a.error && !a.ok ? h('div', { style: 'color:var(--bad)' }, a.error) : null, a.response_snippet ? h('span', { class: 'mono muted' }, a.response_snippet.slice(0, 160)) : null) },
      { key: 'wait_next_min', label: 'Espera al siguiente', render: a => a.wait_next_min ? fmtMin(a.wait_next_min) : a.ok ? '—' : 'cola muerta' }, { key: 'resolved_ip', label: 'IP destino', mono: true }] }), { flush: true }));
  }

  /* ---------- API-08 Documentación ---------- */
  const ERRORS = [[400, '—', 'Cuerpo que no es JSON'], [401, 'RN-API-11 · RN-API-10 · RN-API-02', 'Clave inválida, revocada o vencida'], [403, 'RN-API-03 · RN-PLT-07 · RN-API-11', 'Sin alcance, módulo o plan sin API, IP no permitida o marca fuera de la clave'], [404, 'RN-API-15 · RN-API-16', 'Ruta, versión o recurso inexistente (o de otro entorno)'], [409, 'RN-INT-12 · RN-INT-13', 'Idempotency-Key reutilizada con otro cuerpo o aún en proceso'], [422, 'RN-PED-01 · RN-PED-02 · RN-CAT-05 · RN-API-13 · RN-API-14', 'Regla de negocio: faltan datos, SKU inválido, sin precio o sin Idempotency-Key'], [429, 'RN-API-09', 'Límite del día del plan o ráfaga por minuto; respeta Retry-After']];
  A.openapi = function () {
    const paths = {};
    for (const r of ROUTES) {
      const ex = docExample(r);
      const op = { summary: r.name, description: (r.desc || '') + ` Alcance requerido: ${r.scope}.`, tags: [r.scope.split(':')[0]], 'x-scope': r.scope, security: [{ bearerAuth: [] }], parameters: [].concat((r.p.match(/\{(\w+)\}/g) || []).map(x => ({ name: x.slice(1, -1), in: 'path', required: true, schema: { type: 'string' } })), (r.q || []).map(([n, d]) => ({ name: n, in: 'query', required: false, description: d, schema: { type: 'string' } })), r.write ? [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } }] : []), responses: { [r.write ? 201 : 200]: { description: 'Correcto', content: { 'application/json': { example: ex.res } } } } };
      for (const [code, rn, d] of ERRORS) if (code !== 400 && (r.write || ![409, 422].includes(code) || code === 422 && r.p.includes('{'))) op.responses[code] = { description: `${d} (${rn})`, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
      if (r.write) op.requestBody = { required: true, content: { 'application/json': { example: ex.req } } };
      (paths['/api/v1' + r.p] = paths['/api/v1' + r.p] || {})[r.m.toLowerCase()] = op;
    }
    return { openapi: '3.0.3', info: { title: 'Aycha API', version: 'v1', description: 'API pública de Aycha. Versión en la ruta; los cambios incompatibles salen como /api/v2 y la anterior se retira con ' + (G.param('api_version_deprecation_months') ?? 12) + ' meses de aviso (RN-API-15).' }, servers: [{ url: HOST, description: 'Producción (ak_live_)' }, { url: SBX_HOST, description: 'Sandbox (ak_test_)' }], paths, components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'ak_live_xxxxxxxx_secreto' } }, schemas: { Error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string', example: 'RN-PED-01' }, message: { type: 'string' } } } } }, 'x-webhooks': D.all('api_event_types').filter(e => e.status === 'ACTIVE').map(e => ({ type: e.code, scope: e.scope, version: e.version })) };
  };
  /** ejemplo real: ejecuta la ruta contra el sandbox con una clave de documentación (sin registrar uso) */
  function docExample(r) {
    const s = A.sandbox(true); const dt = s.data; const ord = dt.orders[0];
    const fake = { key: { prefix: 'ak_test_docs0000', environment: 'TEST', scopes: SCOPES.map(x => x[0]), brand_ids: [], customer_id: null, channel: 'B2B' }, params: { number: ord.number }, query: { limit: '2' }, at: G.date.now() };
    const req = r.write ? (r.p === '/orders' ? A.exampleOrderBody('TEST') : r.p === '/customers' ? { doc_type: 'RUC', doc_number: dt.customers[0].doc_number, name: 'PARRILLA EL BUEN CORTE SAC', phone: '+51987654321' } : r.p === '/webhook-endpoints' ? { url: 'https://erp.cliente.pe/hooks/aycha', events: ['order.delivered'] } : {}) : null;
    let res;
    if (!r.write) { try { res = r.p === '/webhook-endpoints' ? { data: [{ id: 'awe-…', url: 'https://webhook.site/…', events: ['order.created'], status: 'ACTIVE', failure_streak: 0 }] } : r.h(Object.assign({ src: sbxSrc() }, fake)); } catch (e) { res = { code: e.code, message: e.message }; } }
    else if (r.p === '/orders') res = Object.assign({}, ord, { number: 'SBX-000006', status: 'CONFIRMED', external_ref: req.external_ref, api_key: 'ak_test_xxxxxxxx', sandbox: true });
    else if (r.p === '/orders/{number}/documents') res = Object.assign({}, dt.documents[0] || {}, { sandbox: true });
    else if (r.p === '/customers') res = { id: 'cu-…', doc_type: 'RUC', doc_number: req.doc_number, name: req.name };
    else res = { id: 'awe-…', url: req.url, events: req.events, secret: 'whsec_… (se muestra una sola vez)' };
    if (res && res.data && Array.isArray(res.data)) res = Object.assign({}, res, { data: res.data.slice(0, 2) });
    return { req, res };
  }
  const DOC = { sel: 0 };
  function scrDocs(el) {
    const body = page(el, { code: 'API-08', title: sp('API-08'), sub: 'OpenAPI navegable generado de las rutas y alcances, con ejemplos ejecutados en el sandbox, errores con su código RN y guía de firma de webhooks.', actions: [{ label: 'Descargar openapi.json', onClick: () => { const blob = new Blob([JSON.stringify(A.openapi(), null, 2)], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), attrs: { download: 'aycha-openapi-v1.json' } }); document.body.appendChild(a); a.click(); a.remove(); toast('OpenAPI descargado', 'ok'); } }] });
    if (!G.can('api.docs.view')) { body.appendChild(notice(`Tu rol (${G.roleName()}) no tiene el permiso api.docs.view.`, 'warn')); return; }
    body.appendChild(notice(h('span', null, 'Base: ', h('b', { class: 'mono' }, HOST + '/api/v1'), ' (producción) y ', h('b', { class: 'mono' }, SBX_HOST + '/api/v1'), ' (sandbox). Autenticación: ', h('span', { class: 'mono' }, 'Authorization: Bearer ak_live_xxxxxxxx_secreto'), `. Versión en la ruta (RN-API-15): agregar campos no es incompatible; una versión nueva se anuncia con ${G.param('api_version_deprecation_months') ?? 12} meses de aviso.`), 'info'));
    const grid = h('div', { class: 'grid side-r' });
    const nav = h('div', { class: 'stack', style: 'gap:2px' }); const detail = h('div', { class: 'stack' });
    const groups = U.groupBy(ROUTES.map((r, i) => Object.assign({ i }, r)), 'scope');
    for (const [scope, rs] of Object.entries(groups)) { nav.appendChild(h('div', { class: 'muted small', style: 'margin-top:8px;font-weight:700' }, scope)); for (const r of rs) nav.appendChild(h('button', { class: 'btn ghost sm', style: `justify-content:flex-start;text-align:left;${DOC.sel === r.i ? 'background:var(--primary-soft)' : ''}`, on: { click: () => { DOC.sel = r.i; G.refresh(); } } }, h('b', { class: 'mono', style: 'min-width:42px;display:inline-block' }, r.m), ' ', h('span', { class: 'mono small' }, r.p))); }
    const r = ROUTES[DOC.sel] || ROUTES[0]; const ex = docExample(r);
    detail.appendChild(card(`${r.m} /api/v1${r.p}`, h('div', { class: 'stack', style: 'gap:10px' },
      h('div', null, h('b', null, r.name), r.desc ? h('p', { class: 'muted', style: 'margin:4px 0 0' }, r.desc) : null),
      dl([['Alcance', h('span', { class: 'mono' }, r.scope)], ['Idempotency-Key', r.write ? 'Obligatoria (RN-API-13): repetir devuelve la misma respuesta sin duplicar' : 'No aplica'], ['Parámetros', (r.q || []).map(q => q[0] + ': ' + q[1]).join(' · ') || (r.p.includes('{') ? 'number: número del pedido' : '—')]]),
      ex.req ? h('div', null, h('div', { class: 'muted small' }, 'Ejemplo de petición'), pre(pretty(ex.req), 260)) : null,
      h('div', null, h('div', { class: 'muted small' }, `Respuesta ${r.write ? 201 : 200} (ejecutada en el sandbox)`), pre(pretty(ex.res), 320)))));
    detail.appendChild(card('Errores', table({ id: 'api08err', search: false, rows: ERRORS.map(([c, rn, d]) => ({ c, rn, d })), columns: [{ key: 'c', label: 'HTTP', render: x => httpBadge(x.c) }, { key: 'rn', label: 'Código RN', mono: true }, { key: 'd', label: 'Cuándo' }] }), { flush: true }));
    detail.appendChild(card('Formato de error (RN-API-18)', pre('{\n  "code": "RN-PED-01",\n  "message": "Faltan datos obligatorios: DIRECCION_CON_PIN.",\n  "missing": ["DIRECCION_CON_PIN"]\n}', 140)));
    detail.appendChild(sigGuide());
    detail.appendChild(card('Probar (consola)', apiConsole({})));
    grid.append(detail, h('div', null, card('Operaciones', nav))); body.appendChild(grid);
  }
  const SIG = { secret: 'whsec_prueba', t: '1760090400', body: '{"id":1}' };
  function sigGuide() {
    const out = h('div');
    const inS = h('input', { class: 'input mono', value: SIG.secret }), inT = h('input', { class: 'input mono', value: SIG.t }), inB = h('input', { class: 'input mono', value: SIG.body });
    const calc = () => { SIG.secret = inS.value; SIG.t = inT.value; SIG.body = inB.value; const v = A.signature(SIG.secret, SIG.t, SIG.body); G.ui.clear(out).append(dl([['Mensaje firmado', h('span', { class: 'mono small', style: 'word-break:break-all' }, `${SIG.t}.${SIG.body}`)], ['v1', h('span', { class: 'mono small', style: 'word-break:break-all' }, v)], ['Cabecera', h('span', { class: 'mono small', style: 'word-break:break-all' }, `Aycha-Signature: t=${SIG.t}, v1=${v}`)]])); };
    [inS, inT, inB].forEach(i => i.addEventListener('input', calc)); calc();
    const tol = G.param('api_signature_tolerance_seconds') ?? 300;
    return card('Firma de webhooks (RN-API-07, RN-API-17)', h('div', { class: 'stack', style: 'gap:10px' },
      h('p', { style: 'margin:0' }, `Cada entrega lleva la cabecera Aycha-Signature: t=<marca de tiempo Unix>, v1=<HMAC-SHA256 en hexadecimal de "t.cuerpo" con el secreto del destino>. Rechaza firmas con más de ${tol} s de antigüedad. Al rotar el secreto llegan dos v1 durante 24 horas; acepta si alguna coincide. Deduplica por event_id y ordena por occurred_at: el orden de llegada no está garantizado.`),
      h('div', { class: 'grid c3', style: 'gap:10px' }, h('div', { class: 'field' }, h('label', null, 'Secreto'), inS), h('div', { class: 'field' }, h('label', null, 'Marca de tiempo (t)'), inT), h('div', { class: 'field' }, h('label', null, 'Cuerpo crudo'), inB)), out,
      tabs([{ key: 'node', label: 'Node.js', render: p => p.appendChild(pre(`const crypto = require('crypto');\n\nfunction verificar(cabecera, cuerpoCrudo, secreto, tolerancia = ${tol}) {\n  const partes = Object.fromEntries([]);\n  const t = Number((cabecera.match(/t=(\\d+)/) || [])[1]);\n  const firmas = [...cabecera.matchAll(/v1=([0-9a-f]{64})/g)].map(m => m[1]);\n  if (!t || Math.abs(Date.now() / 1000 - t) > tolerancia) return false;\n  const esperada = crypto.createHmac('sha256', secreto).update(t + '.' + cuerpoCrudo).digest('hex');\n  return firmas.some(f => crypto.timingSafeEqual(Buffer.from(f), Buffer.from(esperada)));\n}`, 260)) }, { key: 'php', label: 'PHP', render: p => p.appendChild(pre(`function verificar($cabecera, $cuerpoCrudo, $secreto, $tolerancia = ${tol}) {\n  preg_match('/t=(\\d+)/', $cabecera, $t);\n  preg_match_all('/v1=([0-9a-f]{64})/', $cabecera, $v1);\n  if (!$t || abs(time() - (int)$t[1]) > $tolerancia) return false;\n  $esperada = hash_hmac('sha256', $t[1] . '.' . $cuerpoCrudo, $secreto);\n  foreach ($v1[1] as $f) if (hash_equals($esperada, $f)) return true;\n  return false;\n}`, 220)) }], { key: 'api08sig' })));
  }

  /* ---------- API-09 Sandbox ---------- */
  function scrSandbox(el) {
    const s = A.sandbox(true); const dt = s.data; const can = G.can('api.sandbox.reset');
    const body = page(el, { code: 'API-09', title: sp('API-09'), sub: 'Tenant de pruebas emparejado: las claves ak_test_ operan solo aquí, con datos de demostración; comprobantes al OSE FAKE y mensajes al proveedor FAKE (RN-API-16).', actions: [{ label: 'Reiniciar sandbox', kind: 'danger', disabled: !can, onClick: () => G.ui.confirm({ title: 'Reiniciar el sandbox', message: 'Se borran los pedidos, comprobantes y clientes creados en pruebas y se cargan los datos de demostración. Las claves de prueba siguen vigentes.', confirmLabel: 'Reiniciar', danger: true, onConfirm: () => { if (wrap(() => A.resetSandbox())) { toast('Sandbox reiniciado con datos de demostración', 'ok'); G.refresh(); } } }) }] });
    const tk = D.where('api_keys', k => k.environment === 'TEST');
    body.appendChild(kpis([{ label: 'Estado', value: (ST[s.status] || [s.status])[0], tone: 'ok', sub: `tenant ${s.paired_tenant}` }, { label: 'Último reinicio', value: F.date(s.last_reset_at), sub: `${s.reset_count || 0} reinicios · por ${s.reset_by}` }, { label: 'Próximo reinicio automático', value: F.date(s.next_reset_at), sub: `cada ${G.param('api_sandbox_reset_days') ?? 30} días` }, { label: 'Claves de prueba activas', value: `${tk.filter(k => A.keyStatus(k) === 'ACTIVE').length} de ${tk.length}` }]));
    const grid = h('div', { class: 'grid c2' });
    grid.appendChild(card('Proveedores del sandbox', dl([['Comprobantes', 'OSE FAKE · acepta al instante, nunca llega a SUNAT'], ['Mensajería', `Proveedor FAKE · ${dt.messages.length} mensaje(s) simulados, ninguno a clientes reales`], ['Pagos', 'Pasarela FAKE'], ['Host', s.host], ['Datos de demostración', `${dt.customers.length} clientes · ${dt.products.length} productos · ${dt.orders.length} pedidos · ${dt.documents.length} comprobantes`]])));
    grid.appendChild(card('Claves de prueba', table({ id: 'api09k', search: false, rows: tk, onRow: k => G.go('API-03', { id: k.id }), empty: 'Sin claves de prueba: créalas en API-02 con entorno Pruebas.', columns: [{ key: 'name', label: 'Nombre' }, { key: 'prefix', label: 'Prefijo', render: k => h('span', { class: 'mono small' }, k.prefix + '…') }, { key: 'expires_at', label: 'Vence', render: k => F.date(k.expires_at) }, { key: 'st', label: 'Estado', render: k => stD(A.keyStatus(k)) }] }), { flush: true }));
    body.appendChild(grid);
    body.appendChild(h('div', { style: 'min-width:0;max-width:100%' }, tabs([
      { key: 'orders', label: 'Pedidos', count: dt.orders.length, render: p => p.appendChild(table({ id: 'api09o', rows: dt.orders.slice().reverse(), search: false, columns: [{ key: 'number', label: 'Pedido', mono: true }, { key: 'created_at', label: 'Creado', render: o => F.datetime(o.created_at) }, { key: 'customer', label: 'Cliente', value: o => o.customer.name }, { key: 'external_ref', label: 'Ref. externa', mono: true }, { key: 'estimated_total', label: 'Total', align: 'r', render: o => F.money(o.estimated_total) }, { key: 'api_key', label: 'Clave', mono: true, render: o => o.api_key || 'demostración' }, { key: 'status', label: 'Estado', render: o => G.ui.status(o.status) }] })) },
      { key: 'docs', label: 'Comprobantes', count: dt.documents.length, render: p => p.appendChild(table({ id: 'api09d', rows: dt.documents.slice().reverse(), search: false, empty: 'Sin comprobantes.', columns: [{ key: 'full_number', label: 'Número', mono: true }, { key: 'issue_date', label: 'Fecha', render: d => F.date(d.issue_date) }, { key: 'customer', label: 'Cliente', value: d => d.customer.name }, { key: 'total', label: 'Total', align: 'r', render: d => F.money(d.total) }, { key: 'ose', label: 'OSE', render: d => badge(d.ose + ' · CDR ' + d.cdr_code, 'info') }, { key: 'sent_to_sunat', label: 'SUNAT', render: d => d.sent_to_sunat ? 'Enviado' : badge('No se envía', '') }, { key: 'sunat_status', label: 'Estado', render: d => G.ui.status(d.sunat_status) }] })) },
      { key: 'msgs', label: 'Mensajes FAKE', count: dt.messages.length, render: p => p.appendChild(table({ id: 'api09m', rows: dt.messages.slice().reverse(), search: false, empty: 'Sin mensajes: se generan al crear pedidos en el sandbox.', columns: [{ key: 'at', label: 'Fecha', render: m => F.datetime(m.at) }, { key: 'to', label: 'Para', mono: true }, { key: 'template', label: 'Plantilla', mono: true }, { key: 'ref', label: 'Pedido', mono: true }, { key: 'note', label: 'Proveedor' }] })) },
      { key: 'data', label: 'Clientes y productos', render: p => p.appendChild(h('div', { class: 'grid c2' }, card('Clientes', table({ id: 'api09c', search: false, rows: dt.customers, columns: [{ key: 'id', label: 'id', mono: true }, { key: 'name', label: 'Nombre' }, { key: 'doc_number', label: 'Documento', mono: true }, { key: 'addresses', label: 'Direcciones', render: c => c.addresses.map(a => a.id).join(', ') || '—' }] }), { flush: true }), card('Productos', table({ id: 'api09p', search: false, rows: dt.products, columns: [{ key: 'sku', label: 'SKU', mono: true }, { key: 'price', label: 'Precio', align: 'r', render: x => F.money(x.price) + (x.basis === 'KG' ? '/kg' : '') }, { key: 'stock', label: 'Stock', align: 'r' }] }), { flush: true }))) },
    ], { key: 'api09tabs' })));
    body.appendChild(card('Probar en el sandbox', apiConsole({ env: 'TEST' })));
  }

  /* ---------- API-10 Uso de la API ---------- */
  const USE = { days: 30, key: '' };
  function scrUsage(el) {
    const body = page(el, { code: 'API-10', title: sp('API-10'), sub: 'Llamadas por día y clave frente al límite del plan, errores 4xx y 5xx y rechazos por límite (RN-API-09, KPI-API-03).' });
    const pl = A.plan(); const from = G.date.add(G.TODAY, -(USE.days - 1));
    const keys = D.all('api_keys');
    const ctl = h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;align-items:center' }, pills([[7, '7 días'], [30, '30 días']], USE.days, v => { USE.days = v; G.refresh(); }),
      (() => { const s = h('select', { class: 'input', style: 'max-width:320px', attrs: { 'aria-label': 'Clave' } }, h('option', { value: '' }, 'Todas las claves'), keys.map(k => h('option', { value: k.id, selected: USE.key === k.id }, `${k.name} (${k.prefix}…)`))); s.addEventListener('change', () => { USE.key = s.value; G.refresh(); }); return s; })());
    body.appendChild(ctl);
    const us = D.where('api_usage_daily', u => u.day >= from && (!USE.key || u.key_id === USE.key));
    const tot = { c: U.sum(us, u => u.calls), e4: U.sum(us, u => u.err_4xx - u.rejected_limit), e5: U.sum(us, u => u.err_5xx), rj: U.sum(us, u => u.rejected_limit) };
    const used = A.dailyUsed('LIVE'); const pct = pl.calls_day ? used / pl.calls_day * 100 : 0;
    body.appendChild(kpis([
      { label: 'Hoy (producción)', value: F.num(used), sub: pl.calls_day == null ? 'sin límite diario' : `${F.pct(pct, 1)} de ${F.num(pl.calls_day)}`, tone: pct > 80 ? 'warn' : '' },
      { label: `Llamadas (${USE.days} d)`, value: F.num(tot.c) },
      { label: 'Errores 4xx', value: F.num(tot.e4), sub: tot.c ? F.pct(tot.e4 / tot.c * 100, 2) : '' },
      { label: 'Errores 5xx', value: F.num(tot.e5), tone: tot.e5 ? 'bad' : 'ok' },
      { label: 'Rechazadas por límite', value: F.num(tot.rj), sub: (tot.c ? F.pct(tot.rj / tot.c * 100, 2) : '0 %') + ' · KPI-API-03', tone: tot.rj ? 'warn' : '' },
    ]));
    const grid = h('div', { class: 'grid side-r' });
    const days = []; for (let d = from; d <= G.TODAY; d = G.date.add(d, 1)) days.push(d);
    const byDay = U.groupBy(us, 'day'); const sumD = (d, f) => U.sum(byDay[d] || [], f);
    const liveByDay = U.groupBy(D.where('api_usage_daily', u => u.day >= from && u.environment === 'LIVE'), 'day');
    grid.appendChild(h('div', { class: 'stack' },
      card('Llamadas por día', chart.bar({ labels: days.map(d => days.length > 14 ? d.slice(8) : d.slice(8) + '/' + d.slice(5, 7)), stacked: true, series: [{ name: '2xx', values: days.map(d => sumD(d, u => u.ok_2xx)), color: 'var(--ok)' }, { name: '4xx', values: days.map(d => sumD(d, u => u.err_4xx - u.rejected_limit)), color: 'var(--accent)' }, { name: '429 por límite', values: days.map(d => sumD(d, u => u.rejected_limit)), color: 'var(--bad)' }, { name: '5xx', values: days.map(d => sumD(d, u => u.err_5xx)), color: 'var(--muted)' }] })),
      pl.calls_day ? card(`Producción frente al límite del plan (${F.num(pl.calls_day)}/día)`, chart.line({ labels: days.map(d => d.slice(8) + '/' + d.slice(5, 7)), ref: pl.calls_day, max: Math.max(pl.calls_day * 1.1, ...days.map(d => U.sum(liveByDay[d] || [], u => u.calls - u.rejected_limit))), series: [{ name: 'Llamadas aceptadas', values: days.map(d => U.sum(liveByDay[d] || [], u => u.calls - u.rejected_limit)) }] })) : null));
    const byKey = U.groupBy(us, 'key_id');
    grid.appendChild(h('div', { class: 'stack' },
      card('Plan', dl([['Plan', `${pl.name} (${pl.code})`], ['Fuente', pl.source === 'SUS' ? 'SUS: saas_plan_limits.API_CALLS_DAY' : 'Respaldo: SUS no está en este build'], ['API incluida', pl.has_api ? 'Sí' : 'No (RN-API-09)'], ['Llamadas por día', pl.calls_day == null ? 'Sin límite' : F.num(pl.calls_day) + (pl.addons ? ` (incluye ${F.num(pl.addons)} de complementos)` : '')], ['Ráfaga por clave', `${G.param('api_rate_limit_per_minute') ?? 120} por minuto`], ['Al superar', '429 con Retry-After; se cuenta como rechazada']])),
      card('Por clave', G.ui.chart.hbar({ items: Object.entries(byKey).map(([id, rows]) => ({ label: keyName(id), value: U.sum(rows, u => u.calls), tone: U.sum(rows, u => u.rejected_limit) ? 'warn' : '' })).sort((a, b) => b.value - a.value), format: v => F.num(v) }))));
    body.appendChild(grid);
    body.appendChild(card('Detalle por día y clave', table({ id: 'api10', rows: us.slice().sort((a, b) => b.day.localeCompare(a.day) || b.calls - a.calls), onRow: u => G.go('API-03', { id: u.key_id }), columns: [
      { key: 'day', label: 'Día', render: u => F.date(u.day) }, { key: 'key_id', label: 'Clave', value: u => keyName(u.key_id) }, { key: 'environment', label: 'Entorno', render: u => envBadge(u.environment) },
      { key: 'calls', label: 'Llamadas', align: 'r', render: u => F.num(u.calls) }, { key: 'ok_2xx', label: '2xx', align: 'r', render: u => F.num(u.ok_2xx) }, { key: 'err_4xx', label: '4xx', align: 'r', render: u => F.num(u.err_4xx) }, { key: 'err_5xx', label: '5xx', align: 'r', render: u => F.num(u.err_5xx) },
      { key: 'rejected_limit', label: 'Rechazadas', align: 'r', render: u => u.rejected_limit ? h('b', { style: 'color:var(--bad)' }, F.num(u.rejected_limit)) : '0' },
      { key: 'top', label: 'Ruta más usada', value: u => (Object.entries(u.by_route || {}).sort((a, b) => b[1] - a[1])[0] || ['—'])[0], mono: true }],
      filters: [{ key: 'environment', label: 'Entorno', options: [['LIVE', 'Producción'], ['TEST', 'Pruebas']] }] })));
  }

  /* ---------- API-11 Eventos y alcances ---------- */
  function scrCatalog(el) {
    const body = page(el, { code: 'API-11', title: sp('API-11'), sub: 'Catálogo de eventos con su alcance requerido, versión del contenido y ejemplo; y los alcances con sus operaciones. Todo evento lleva event_id, type, occurred_at y versión (RN-API-17).' });
    const eps = D.all('api_webhook_endpoints'); const ks = D.all('api_keys');
    body.appendChild(table({ id: 'api11e', rows: D.all('api_event_types'), onRow: e => evDrawer(e), columns: [
      { key: 'code', label: 'Evento', mono: true, render: e => h('b', { class: 'mono' }, e.code) }, { key: 'description', label: 'Cuándo' }, { key: 'module', label: 'Módulo', render: e => h('span', null, e.module, G.SPEC[e.module] && !G.modOn(e.module) ? badge(' apagado', '') : null) },
      { key: 'scope', label: 'Alcance', mono: true }, { key: 'version', label: 'Versión', mono: true }, { key: 'subs', label: 'Destinos', align: 'r', value: e => eps.filter(x => x.events.includes(e.code)).length }, { key: 'status', label: 'Estado', render: e => e.status === 'ACTIVE' ? badge('Vigente', 'ok') : badge('Retirado ' + F.date(e.retired_at), '') }],
      filters: [{ key: 'module', label: 'Módulo', options: [...new Set(EVENTS.map(e => e[1]))].map(m => [m, m]) }, { key: 'status', label: 'Estado', options: [['ACTIVE', 'Vigente'], ['RETIRED', 'Retirado']] }] }));
    body.appendChild(card('Alcances (RN-API-03)', table({ id: 'api11s', search: false, rows: D.all('api_scopes'), columns: [
      { key: 'code', label: 'Alcance', mono: true, render: s => h('b', { class: 'mono' }, s.code) }, { key: 'name', label: 'Nombre' }, { key: 'description', label: 'Qué permite' }, { key: 'module', label: 'Módulo' },
      { key: 'ops', label: 'Operaciones', render: s => h('div', null, ROUTES.filter(r => r.scope === s.code).map(r => chip(`${r.m} ${r.p}`))) },
      { key: 'evs', label: 'Eventos', render: s => h('div', null, D.all('api_event_types').filter(e => e.scope === s.code && e.status === 'ACTIVE').map(e => chip(e.code, 'info'))) },
      { key: 'keys', label: 'Claves activas', align: 'r', value: s => ks.filter(k => A.keyStatus(k) === 'ACTIVE' && k.scopes.includes(s.code)).length }] }), { flush: true }));
  }
  function exampleFor(code) {
    const o = D.where('sales_orders', x => x.status === 'DELIVERED').slice(-1)[0]; const d = D.where('sales_documents', x => x.sunat_status === 'ACCEPTED').slice(-1)[0]; const p = D.all('payments').slice(-1)[0]; const v = G.variant('va-M5-MER-AGU') || D.all('product_variants')[0];
    const data = code.startsWith('order.') ? (o ? orderOut(o) : {}) : code.startsWith('document.') ? (d ? docOut(d) : {}) : code.startsWith('payment.') ? (p ? payOut(p) : {}) : { sku: v.sku, name: v.name, brand: brandCode(v.brand_id), available_qty: 3, threshold: lowOf(v), threshold_source: 'api_stock_low_default_qty' };
    const at = G.TODAY + 'T09:41:07';
    return { event_id: A.eventId(code, 'ejemplo', at), type: code, version: (eventRow(code) || {}).version || 'v1', occurred_at: at + '-05:00', livemode: true, data };
  }
  function evDrawer(e) { drawer(e.code, bd => { bd.append(dl([['Descripción', e.description], ['Módulo', e.module], ['Alcance requerido', e.scope], ['Versión del contenido', e.version], ['Estado', e.status === 'ACTIVE' ? 'Vigente' : `Retirado el ${F.date(e.retired_at)}`], ['Destinos suscritos', D.all('api_webhook_endpoints').filter(x => x.events.includes(e.code)).map(x => x.name).join(', ') || 'Ninguno']]), e.code === 'stock.low' ? notice(`D-API-04: el umbral es el mínimo de la variante en ALM y, si no tiene, api_stock_low_default_qty (${G.param('api_stock_low_default_qty') ?? 5}).`, 'info') : null, h('div', { class: 'muted small' }, 'Ejemplo de contenido'), pre(pretty(exampleFor(e.code)), 420)); }, { code: 'API-11', wide: true }); }

  /* =====================================================================
     Registro, indicadores, ganchos y pruebas
     ===================================================================== */
  G.register({ code: 'API', name: 'API pública y webhooks', phase: 4, group: 'Producto SaaS', screens: [
    { code: 'API-01', name: sp('API-01'), render: scrKeys }, { code: 'API-02', name: sp('API-02'), render: scrCreateKey },
    { code: 'API-03', name: sp('API-03'), render: scrKey }, { code: 'API-04', name: sp('API-04'), render: scrEndpoints },
    { code: 'API-05', name: sp('API-05'), render: scrEndpointEdit }, { code: 'API-06', name: sp('API-06'), render: scrDeliveries },
    { code: 'API-07', name: sp('API-07'), render: scrDelivery }, { code: 'API-08', name: sp('API-08'), render: scrDocs },
    { code: 'API-09', name: sp('API-09'), render: scrSandbox }, { code: 'API-10', name: sp('API-10'), render: scrUsage },
    { code: 'API-11', name: sp('API-11'), render: scrCatalog },
  ] });

  G.kpiCalc['KPI-API-01'] = p => { const ds = D.where('api_webhook_deliveries', d => ['DELIVERED', 'DEAD'].includes(d.status) && !d.test && inP(d.created_at, p)); const n = ds.filter(d => d.status === 'DELIVERED' && d.attempts === 1).length; return { value: ds.length ? R(n / ds.length * 100, 2) : 100, numerator: n, denominator: ds.length }; };
  G.kpiCalc['KPI-API-02'] = () => D.where('api_webhook_deliveries', d => d.status === 'DEAD' && !d.resent_to).length;
  G.kpiCalc['KPI-API-03'] = p => { const us = D.where('api_usage_daily', u => inP(u.day, p)); const c = U.sum(us, u => u.calls), rj = U.sum(us, u => u.rejected_limit); return { value: c ? R(rj / c * 100, 2) : 0, numerator: rj, denominator: c }; };

  G.alertProviders.push(() => {
    if (!G.canSee || !G.canSee('API')) return [];
    const out = [];
    const soon = D.where('api_keys', k => A.keyStatus(k) === 'ACTIVE' && daysLeft(k) <= 15); if (soon.length) out.push({ module: 'API', title: `${soon.length} clave(s) de API por vencer`, detail: soon.map(k => `${k.name} · ${F.date(k.expires_at)}`).join(', '), tone: 'warn', go: () => G.go('API-03', { id: soon[0].id }) });
    const dead = D.where('api_webhook_deliveries', d => d.status === 'DEAD' && !d.resent_to).length; if (dead) out.push({ module: 'API', title: `${dead} entrega(s) de webhooks en la cola muerta`, detail: 'Reenvíalas cuando el destino responda (RN-API-08).', tone: 'bad', go: () => G.go('API-06', { status: 'DEAD' }) });
    const dis = D.where('api_webhook_endpoints', e => e.status === 'DISABLED'); if (dis.length) out.push({ module: 'API', title: `${dis.length} destino(s) de webhooks desactivado(s)`, detail: dis.map(e => e.name).join(', ') + ' (RN-API-12)', tone: 'bad', go: () => G.go('API-04') });
    const down = D.where('api_webhook_endpoints', e => e.status === 'ACTIVE' && e.failure_streak >= 10); if (down.length) out.push({ module: 'API', title: `${down.length} destino(s) fallando`, detail: down.map(e => `${e.name}: ${e.failure_streak} fallos seguidos`).join(', '), tone: 'warn', go: () => G.go('API-04') });
    const pl = A.plan(); if (pl.calls_day) { const u = A.dailyUsed('LIVE'); if (u / pl.calls_day > 0.8) out.push({ module: 'API', title: 'Uso de la API sobre el 80 % del día', detail: `${F.num(u)} de ${F.num(pl.calls_day)} llamadas`, tone: 'warn', go: () => G.go('API-10') }); }
    return out;
  });
  G.searchProviders.push(q => { const s = q.toLowerCase(); if (s.length < 3) return []; return D.all('api_keys').filter(k => k.name.toLowerCase().includes(s) || k.prefix.includes(s)).slice(0, 4).map(k => ({ label: k.name, sub: `Clave de API · ${k.prefix}…`, go: () => G.go('API-03', { id: k.id }) })).concat(D.all('api_webhook_deliveries').filter(d => d.number.toLowerCase() === s || d.event_id === s).slice(0, 3).map(d => ({ label: d.number, sub: `Entrega de webhook · ${d.event_type}`, go: () => G.go('API-07', { id: d.id }) }))).concat(D.all('api_webhook_endpoints').filter(e => e.name.toLowerCase().includes(s) || e.url.includes(s)).slice(0, 3).map(e => ({ label: e.name, sub: 'Destino de webhooks', go: () => G.go('API-05', { id: e.id }) }))); });
  G.scanHandlers.push(code => { const c = String(code).toLowerCase(); const k = D.find('api_keys', x => c.startsWith(x.prefix)); if (k) return () => G.go('API-03', { id: k.id }); const d = D.find('api_webhook_deliveries', x => x.number === code); return d ? () => G.go('API-07', { id: d.id }) : null; });

  /* ---------- pruebas (CA-API-01 … CA-API-07) ---------- */
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const throwsRule = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e; throw new Error(`Se esperaba ${code} y salió: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code}`); };
  G.tests.push({ module: 'API', name: 'CA-API-01: el ERP del restaurante envía un pedido con Idempotency-Key y lo repite por un corte de red: un solo pedido con la clave registrada; sin dirección para delivery responde 422 con RN-PED-01', fn: async () => {
    const { key, token } = A.createKey({ name: 'ERP prueba CA-01', environment: 'LIVE', scopes: ['orders:write', 'orders:read'], brand_ids: ['br-DG'], customer_id: 'cu-B001', channel: 'B2B', expires_at: G.date.add(G.TODAY, 90) });
    const body = A.exampleOrderBody('LIVE', { ref: 'CA01' }); const n0 = D.all('sales_orders').length;
    const r1 = A.call({ token, method: 'POST', path: '/api/v1/orders', body, headers: { 'Idempotency-Key': 'erp-oc-ca01' } });
    assert(r1.status === 201, `La primera llamada debe responder 201 y respondió ${r1.status}: ${JSON.stringify(r1.body)}`);
    const r2 = A.call({ token, method: 'POST', path: '/api/v1/orders', body, headers: { 'Idempotency-Key': 'erp-oc-ca01' } });
    assert(r2.status === 201 && r2.headers['Idempotent-Replayed'] === 'true' && r2.body.number === r1.body.number, 'La repetición debe devolver la misma respuesta 201 sin duplicar');
    const os = D.where('sales_orders', o => o.api_key_id === key.id);
    assert(os.length === 1 && D.all('sales_orders').length === n0 + 1 && os[0].number === r1.body.number && os[0].status === 'CONFIRMED' && os[0].external_ref === 'OC-ERP-CA01', `Debe existir un solo pedido confirmado con la clave (hay ${os.length})`);
    assert(os[0].lines.find(l => G.variant(l.variant_id).sku === 'DG-CUY-ENT').price_basis === 'KG' && os[0].channel === 'B2B', 'El pedido debe seguir las reglas de PED (precio por kg de la lista B2B)');
    const bad = Object.assign({}, body); delete bad.address_id;
    const r3 = A.call({ token, method: 'POST', path: '/api/v1/orders', body: bad, headers: { 'Idempotency-Key': 'erp-oc-ca01-b' } });
    assert(r3.status === 422 && r3.body.code === 'RN-PED-01' && r3.body.missing.includes('DIRECCION_CON_PIN'), `Sin dirección debe responder 422 RN-PED-01 (respondió ${r3.status} ${JSON.stringify(r3.body)})`);
    assert(D.all('sales_orders').length === n0 + 1, 'El rechazo no debe crear pedidos');
    const r4 = A.call({ token, method: 'POST', path: '/api/v1/orders', body: Object.assign({}, body, { notes: 'otro cuerpo' }), headers: { 'Idempotency-Key': 'erp-oc-ca01' } });
    assert(r4.status === 409, 'La misma Idempotency-Key con otro cuerpo debe responder 409');
  } });
  G.tests.push({ module: 'API', name: 'CA-API-02: una clave activa autentica por su prefijo; revocada, la siguiente llamada responde 401 y no se reactiva ni cambia su secreto', fn: async () => {
    const { key, token } = A.createKey({ name: 'Clave CA-02', environment: 'LIVE', scopes: ['orders:read'], expires_at: G.date.add(G.TODAY, 30) });
    assert(/^ak_live_[a-z0-9]{8}$/.test(key.prefix) && /^[0-9a-f]{64}$/.test(key.secret_hash) && !JSON.stringify(D.get('api_keys', key.id)).includes(token.slice(17)), 'Debe guardarse solo el prefijo y el hash de 64 hexadecimales (RN-API-01)');
    const ok = A.call({ token, path: '/api/v1/orders?limit=2' }); assert(ok.status === 200 && ok.body.data.length === 2, 'Con la clave activa debe responder 200');
    const wrong = A.call({ token: key.prefix + '_otrosecreto', path: '/api/v1/orders' }); assert(wrong.status === 401 && wrong.body.code === 'RN-API-11', 'Un secreto equivocado debe responder 401');
    A.revokeKey(key.id, 'Se filtró en un correo, se reemplaza');
    const r = A.call({ token, path: '/api/v1/orders' }); assert(r.status === 401 && r.body.code === 'RN-API-10', `Revocada debe responder 401 RN-API-10 (respondió ${r.status})`);
    throwsRule(() => A.reactivateKey(key.id), 'RN-API-10');
    throwsRule(() => A.updateKey(key.id, { secret_hash: sha256('nuevo') }), 'RN-API-10');
    throwsRule(() => A.updateKey(key.id, { prefix: 'ak_live_nuevo000' }), 'RN-API-10');
    throwsRule(() => A.createKey({ name: 'Muy larga', scopes: ['orders:read'], expires_at: G.date.add(G.TODAY, 400) }), 'RN-API-02');
    const k2 = D.get('api_keys', key.id); assert(k2.status === 'REVOKED' && k2.secret_hash === key.secret_hash && k2.prefix === key.prefix, 'El secreto y el prefijo no deben cambiar');
  } });
  G.tests.push({ module: 'API', name: 'CA-API-03: un destino que responde 504 y luego 200 queda DELIVERED en el segundo intento, con dos intentos en el historial y la racha vuelve a 0', fn: async () => {
    const { endpoint: ep } = A.saveEndpoint({ name: 'ERP CA-03', url: 'https://erp.elcuydorado.pe/hooks/ca03', events: ['order.delivered'], sim_mode: 'FLAKY' });
    const o = D.where('sales_orders', x => x.status === 'DELIVERED')[0]; const at = G.TODAY + 'T11:00:00';
    const d = A.enqueue(ep, { type: 'order.delivered', event_id: A.eventId('order.delivered', o.id, at), occurred_at: at, data: orderOut(o) });
    const a1 = A.attempt(d.id, at); assert(a1.status === 'RETRYING' && a1.last_http === 504 && D.get('api_webhook_endpoints', ep.id).failure_streak === 1, 'El primer intento debe fallar con 504');
    assert(a1.next_attempt_at === addMin(at, 1), 'El reintento debe programarse al minuto');
    const a2 = A.attempt(d.id, a1.next_attempt_at);
    const ats = D.where('api_webhook_attempts', x => x.delivery_id === d.id).sort(U.by('attempt_no'));
    assert(a2.status === 'DELIVERED' && a2.attempts === 2 && ats.length === 2 && ats[0].http_status === 504 && ats[1].http_status === 200, 'Debe quedar DELIVERED en el segundo intento con dos intentos');
    assert(D.get('api_webhook_endpoints', ep.id).failure_streak === 0, 'La racha de fallos debe volver a 0');
    assert(/^t=\d+, v1=[0-9a-f]{64}$/.test(ats[1].signature), 'Cada intento va firmado');
    const dup = A.enqueue(ep, { type: 'order.delivered', event_id: d.event_id, occurred_at: at, data: {} }); assert(dup.id === d.id, 'El mismo event_id no crea otra entrega (RN-API-07)');
  } });
  G.tests.push({ module: 'API', name: 'CA-API-04: con el destino caído se reintenta a 1, 5, 30, 120, 360, 720 y 1440 min; tras el octavo intento (unas 45 h) pasa a la cola muerta y se reenvía como entrega nueva del mismo evento', fn: async () => {
    const { endpoint: ep } = A.saveEndpoint({ name: 'Destino caído CA-04', url: 'https://tienda.marca5gourmet.pe/wp-json/aycha/v1/ca04', events: ['stock.low'], sim_mode: 'DOWN' });
    const at = G.TODAY + 'T08:00:00'; const d = A.enqueue(ep, { type: 'stock.low', event_id: A.eventId('stock.low', 'ca04', at), occurred_at: at, data: { sku: 'M5-MER-AGU', available_qty: 2 } });
    let x = A.attempt(d.id, at); for (let i = 0; i < 20 && x.status === 'RETRYING'; i++) x = A.attempt(x.id, x.next_attempt_at);
    const ats = D.where('api_webhook_attempts', a => a.delivery_id === d.id).sort(U.by('attempt_no'));
    const waits = ats.map(a => a.wait_next_min).filter(Boolean);
    assert(JSON.stringify(waits) === '[1,5,30,120,360,720,1440]', 'Esperas: ' + waits.join(', '));
    assert(x.status === 'DEAD' && x.attempts === 8 && ats.map(a => a.attempt_no).join() === '1,2,3,4,5,6,7,8', 'Al octavo intento debe pasar a la cola muerta con los intentos numerados');
    const hrs = (toMs(ats[7].at) - toMs(ats[0].at)) / 3600e3; assert(Math.abs(hrs - 44.6) < 0.05, 'Entre el primer y el octavo intento deben pasar unas 45 h y pasaron ' + hrs);
    const deadBefore = G.kpi('KPI-API-02'); const kv = deadBefore.value ?? deadBefore;
    D.update('api_webhook_endpoints', ep.id, { sim_mode: 'OK' }, { silent: true });
    const nd = A.resend(d.id);
    assert(nd.id !== d.id && nd.event_id === d.event_id && nd.resent_from === d.id && nd.status === 'DELIVERED' && D.get('api_webhook_deliveries', d.id).resent_to === nd.id, 'El reenvío debe ser una entrega nueva del mismo evento');
    const after = G.kpi('KPI-API-02'); assert((after.value ?? after) === kv - 1, 'KPI-API-02 no debe contar la entrega reenviada');
  } });
  G.tests.push({ module: 'API', name: 'CA-API-05: con el plan Crecimiento de 5000 llamadas al día, la llamada 5001 responde 429 con Retry-After y se cuenta como rechazada', fn: async () => {
    A._planOverride = { code: 'CRECIMIENTO', name: 'Crecimiento', has_api: true, calls_day: 5000, source: 'prueba' };
    try {
      const { key, token } = A.createKey({ name: 'Clave CA-05', environment: 'LIVE', scopes: ['stock:read'], expires_at: G.date.add(G.TODAY, 60) });
      const day = G.date.now().slice(0, 10); const used = A.dailyUsed('LIVE', day); assert(used < 5000, 'El uso sembrado del día debe ser menor a 5000');
      const u = A.usageRow(key, day); D.update('api_usage_daily', u.id, { calls: 4999 - used, ok_2xx: 4999 - used }, { silent: true });
      const r5000 = A.call({ token, path: '/api/v1/stock?sku=DG-CUY-ENT' }); assert(r5000.status === 200, 'La llamada 5000 debe responder 200 y respondió ' + r5000.status);
      assert(A.dailyUsed('LIVE', day) === 5000, 'Deben ir 5000 llamadas del día');
      const r = A.call({ token, path: '/api/v1/stock?sku=DG-CUY-ENT' });
      assert(r.status === 429 && r.body.code === 'RN-API-09' && +r.headers['Retry-After'] > 0, `La 5001 debe responder 429 con Retry-After (respondió ${r.status})`);
      const u2 = D.get('api_usage_daily', u.id); assert(u2.rejected_limit === 1 && u2.err_4xx === 1 && A.dailyUsed('LIVE', day) === 5000, 'La 5001 debe contarse como rechazada y no consumir');
      const k3 = G.kpi('KPI-API-03', { from: day, to: day }); assert(k3.numerator >= 1, 'KPI-API-03 debe contar la rechazada');
      A._planOverride = { code: 'INICIA', name: 'Inicia', has_api: false, calls_day: 0 };
      throwsRule(() => A.createKey({ name: 'Sin API', scopes: ['orders:read'] }), 'RN-PLT-07');
    } finally { A._planOverride = null; }
  } });
  G.tests.push({ module: 'API', name: 'CA-API-06: con el secreto whsec_prueba, t=1760090400 y el cuerpo {"id":1}, v1 es el HMAC-SHA256 hexadecimal de «1760090400.{"id":1}»; la documentación lo calcula igual', fn: async () => {
    const msg = '1760090400.{"id":1}';
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('whsec_prueba'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const ref = hex(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg))));
    assert(A.signature('whsec_prueba', 1760090400, '{"id":1}') === ref && hmacLocal('whsec_prueba', msg) === ref, 'La firma no coincide con WebCrypto: ' + ref);
    SIG.secret = 'whsec_prueba'; SIG.t = '1760090400'; SIG.body = '{"id":1}';
    const node = sigGuide(); assert(node.textContent.includes(ref) && node.textContent.includes(`t=1760090400, v1=${ref}`), 'El ejemplo de la documentación (API-08) debe mostrar la misma firma');
    const hdr = `t=1760090400, v1=${ref}`;
    assert(A.verify(hdr, 'whsec_prueba', '{"id":1}', 1760090400 + 299).ok && !A.verify(hdr, 'whsec_prueba', '{"id":1}', 1760090400 + 301).ok && !A.verify(hdr, 'whsec_otro', '{"id":1}', 1760090400).ok, 'El receptor debe rechazar firmas de más de 300 s o con otro secreto');
    const ep = D.find('api_webhook_endpoints', e => e.status === 'ACTIVE' && e.environment === 'LIVE'); const old = A.secretOf(ep);
    const rr = A.rotateSecret(ep.id, G.TODAY + 'T12:00:00'); const h2 = A.signatureHeader(D.get('api_webhook_endpoints', ep.id), '{"id":1}', G.TODAY + 'T13:00:00');
    assert(h2.split('v1=').length === 3 && A.verify(h2, old, '{"id":1}').ok && A.verify(h2, rr.secret, '{"id":1}').ok, 'Durante 24 h deben ir dos firmas (secreto nuevo y anterior)');
    assert(A.signatureHeader(D.get('api_webhook_endpoints', ep.id), '{"id":1}', G.date.add(G.TODAY, 2) + 'T13:00:00').split('v1=').length === 2, 'Pasadas 24 h solo firma el secreto nuevo');
  } });
  G.tests.push({ module: 'API', name: 'CA-API-07: con una clave ak_test_ el comprobante creado en el sandbox queda aceptado por el OSE FAKE y no va a SUNAT; la clave no lee producción', fn: async () => {
    const { token } = A.createKey({ name: 'Sandbox CA-07', environment: 'TEST', scopes: ['orders:write', 'orders:read', 'documents:read'], expires_at: G.date.add(G.TODAY, 30) });
    assert(token.startsWith('ak_test_'), 'La clave de prueba debe empezar con ak_test_');
    const docs0 = D.all('sales_documents').length, ord0 = D.all('sales_orders').length, ob0 = D.all('outbox_messages').length;
    const r1 = A.call({ token, method: 'POST', path: '/api/v1/orders', body: A.exampleOrderBody('TEST'), headers: { 'Idempotency-Key': 'sbx-ca07' } });
    assert(r1.status === 201 && /^SBX-/.test(r1.body.number), 'El pedido de prueba debe crearse en el sandbox: ' + JSON.stringify(r1.body));
    const r2 = A.call({ token, method: 'POST', path: `/api/v1/orders/${r1.body.number}/documents`, body: {}, headers: { 'Idempotency-Key': 'sbx-ca07-doc' } });
    assert(r2.status === 201 && r2.body.sunat_status === 'ACCEPTED' && r2.body.ose === 'FAKE' && r2.body.sent_to_sunat === false, 'El comprobante debe quedar aceptado por el OSE FAKE sin ir a SUNAT: ' + JSON.stringify(r2.body));
    assert(D.all('sales_documents').length === docs0 && D.all('sales_orders').length === ord0 && D.all('outbox_messages').length === ob0, 'No debe tocar comprobantes, pedidos ni el outbox de producción');
    assert(A.sandbox().data.messages.some(m => m.ref === r1.body.number && m.provider === 'FAKE'), 'La confirmación debe ir al proveedor FAKE');
    const r3 = A.call({ token, path: '/api/v1/orders?limit=100' }); assert(r3.status === 200 && r3.body.data.length && r3.body.data.every(o => /^SBX-/.test(o.number)), 'La clave de prueba solo debe ver pedidos del sandbox');
    const prod = D.all('sales_orders')[0].number; const r4 = A.call({ token, path: '/api/v1/orders/' + prod }); assert(r4.status === 404, `Leer el pedido de producción ${prod} debe responder 404 (respondió ${r4.status})`);
    const r5 = A.call({ token, path: '/api/v1/documents' }); assert(r5.body.data.every(d => d.ose === 'FAKE'), 'Solo comprobantes del sandbox');
  } });
})();
