/* =====================================================================
   SEG · Seguridad: inicio de sesión (simulador con las funciones reales
   de G.auth), segundo factor, recuperación, mi cuenta, sesiones,
   dispositivos, usuarios, roles, permisos, matriz y política.
   Expone G.seg (servicios de seguridad para los demás módulos).
   ===================================================================== */
(function () {
  'use strict';
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, modal, form, toast, tabs, pills } = G.ui;
  const D = G.db, F = G.fmt, U = G.util;
  const P = G.plt;
  const S = G.seg = G.seg || {};
  const A = () => G.auth;
  const DEMO_PWD = 'DonGuando2026';
  const GENERIC = 'Correo o contraseña incorrectos.';
  const BASE_ACCESS = JSON.parse(JSON.stringify(G.ACCESS));
  const BASE_PERMS = JSON.parse(JSON.stringify(G.PERMS));
  const ROLE_DESC = { ADMIN_SISTEMA: 'Configura la plataforma, usuarios y permisos', GERENTE: 'Gerencia: ve todo y aprueba', ADMINISTRACION: 'Administración y finanzas', SUPERVISORA_VENTAS: 'Supervisa vendedoras, reasigna chats, escucha grabaciones', VENDEDORA: 'Atiende la bandeja de sus marcas y crea pedidos', CAJERO: 'Mostrador', ALMACENERO: 'Recepción, transferencias, conteos', PREPARADOR: 'Arma los pedidos con escaneo', COORDINADOR_DELIVERY: 'Rutas, asignación de vehículos, terceros', REPARTIDOR: 'App de reparto', MARKETING: 'Anuncios, atribución y campañas', JEFE_PRODUCCION: 'Órdenes de producción, despiece, recetas', OPERARIO_PRODUCCION: 'Registra consumos y producción', CALIDAD: 'Inspecciones, liberación de lotes, no conformidades', COMPRAS: 'Órdenes de compra y proveedores', CONTADORA: 'Aprueba asientos, cierra períodos, presenta SIRE', PRACTICANTE_CONTABLE: 'Registra y clasifica; no aprueba ni cierra', VISITADOR_CONSIGNACION: 'Visita puntos de consignación', RRHH: 'Personal, asistencia, pagos', CLIENTE_B2B: 'Portal del cliente empresarial', SOPORTE_PLATAFORMA: 'Soporte de Intelectalab con acceso temporal auditado', AUDITOR: 'Solo lectura para auditoría' };
  const MOBILE_ROLES = ['REPARTIDOR', 'VISITADOR_CONSIGNACION'];
  const COMMON = ['password1234', 'contraseña123', 'contrasena123', '1234567890', 'qwerty12345', 'admin12345', 'peru123456', 'aycha12345', 'abc1234567', 'clave123456', 'donguando123', '123456789a'];
  const LBL = { ACTIVE: ['Activo', 'ok'], LOCKED: ['Bloqueado', 'bad'], INACTIVE: ['Inactivo', ''], PENDING_MFA: ['Falta 2FA', 'warn'], REVOKED: ['Cerrada', ''], EXPIRED: ['Vencida', ''], PENDING: ['Por aprobar', 'warn'], APPROVED: ['Aprobado', 'ok'] };
  const sb = (s, kind) => { if (kind === 'device' && s === 'REVOKED') return badge('Revocado', 'bad'); const l = LBL[s] || [G.ui.statusLabel(s), '']; return badge(l[0], l[1]); };
  const EVENTS = { LOGIN_OK: 'Inicio correcto', LOGIN_FAILED: 'Inicio fallido', LOCKED: 'Bloqueo', UNLOCKED: 'Desbloqueo', MFA_OK: 'Segundo factor correcto', MFA_FAILED: 'Segundo factor fallido', MFA_ENROLLED: '2FA activado', MFA_RESET: '2FA reiniciado', RECOVERY_CODE_USED: 'Código de recuperación usado', PASSWORD_RESET_REQUESTED: 'Pidió recuperar contraseña', PASSWORD_RESET: 'Contraseña restablecida', PASSWORD_CHANGED: 'Contraseña cambiada', LOGOUT: 'Cierre de sesión', SESSION_REVOKED: 'Sesión cerrada por otro', SESSION_EXPIRED: 'Sesión vencida', DEVICE_PENDING: 'Celular por aprobar', DEVICE_APPROVED: 'Celular aprobado', DEVICE_REVOKED: 'Celular revocado', LOGIN_BLOCKED: 'Intento con cuenta bloqueada', LOGIN_DENIED_DEVICE: 'Celular no aprobado', USER_INVITED: 'Invitación enviada', USER_DEACTIVATED: 'Usuario desactivado' };
  const evName = e => EVENTS[e] || e;

  /* ---------- utilidades ---------- */
  const now = () => { const n = G.date.now().slice(0, 19); return n.length === 16 ? n + ':00' : n; };
  const pMin = (k, d) => { const v = G.param(k); return v === undefined || v === null ? d : v; };
  const lower = s => String(s || '').trim().toLowerCase();
  const tokenHash = s => A().hash('tok:' + s);
  const roleRow = code => D.find('roles', r => r.code === code);
  S.roleLabel = code => (G.ROLES.find(x => x[0] === code) || [0, (roleRow(code) || {}).name ? roleRow(code).name + ' (propio)' : code])[1];
  S.isMfaRole = code => { const r = roleRow(code); return r ? !!r.requires_mfa : P.MFA_ROLES.includes(code); };
  S.requiresMfa = u => !!u && S.isMfaRole(u.role);
  S.scopeMode = code => { const r = roleRow(code); return r ? r.scope_mode : (P.ASSIGNED_ROLES.includes(code) ? 'ASSIGNED' : 'ALL'); };
  S.allRoles = () => G.ROLES.map(r => [r[0], r[1]]).concat(D.where('roles', r => !r.is_system).map(r => [r.code, r.name + ' (propio)']));
  const userOf = id => D.get('users', id);
  const me = () => G.scope.user() || D.find('users', x => x.role === G.ctx.role && x.status === 'ACTIVE');

  /* ---------- bitácora de accesos (tabla access_log de AUD) ---------- */
  S.logAccess = function (event, o = {}) {
    const row = { user_id: o.user ? o.user.id : (o.user_id || null), email_attempted: o.email || (o.user ? o.user.email : null), event, module_code: 'SEG', ip: o.ip || null, user_agent: o.ua || null, session_id: o.session_id || null, device_id: o.device_id || null, details: o.details || {}, occurred_at: o.at || now() };
    if (G.aud && typeof G.aud.logAccess === 'function') { try { return G.aud.logAccess(row); } catch (e) { /* respaldo abajo */ } }
    return D.insert('access_log', row, { silent: true });
  };

  /* ---------- política de contraseñas (RN-SEG-02, RN-SEG-03) ---------- */
  S.policyChecks = function (pwd, u) {
    const min = pMin('seg_password_min_length', 10); const p = String(pwd || ''); const pl = p.toLowerCase();
    const local = u && u.email ? lower(u.email).split('@')[0] : '';
    const parts = u ? String(u.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(x => x.length >= 3) : [];
    const pn = pl.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const n = pMin('seg_password_history_count', 5);
    const hist = u ? [u.pwd_hash].concat(D.where('password_history', x => x.user_id === u.id).sort(U.by('set_at', -1)).slice(0, n).map(x => x.password_hash)).filter(Boolean) : [];
    return [
      { code: 'RN-SEG-02', label: `Al menos ${min} caracteres`, ok: p.length >= min },
      { code: 'RN-SEG-02', label: 'Letras y números', ok: /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(p) && /\d/.test(p) },
      { code: 'RN-SEG-02', label: 'No contiene tu correo ni tu nombre', ok: !!p && !(local.length >= 3 && pn.includes(local)) && !parts.some(x => pn.includes(x)) },
      { code: 'RN-SEG-02', label: 'No es una contraseña común', ok: !!p && !COMMON.includes(pl) },
      { code: 'RN-SEG-03', label: `No repite tus últimas ${n} contraseñas`, ok: !!p && !hist.includes(A().hash(p)) },
    ];
  };
  S.assertPolicy = function (pwd, u) { const bad = S.policyChecks(pwd, u).filter(c => !c.ok); if (bad.length) G.fail(bad[0].code, 'La contraseña no cumple: ' + bad.map(b => b.label.toLowerCase()).join('; ') + '.'); };
  function setPassword(u, pwd, at, how) {
    if (u.pwd_hash) D.insert('password_history', { user_id: u.id, password_hash: u.pwd_hash, set_at: u.password_changed_at || at }, { silent: true });
    u.pwd_hash = A().hash(pwd); u.password_changed_at = at; u.must_change_password = false; D.touch();
    S.logAccess(how, { user: u, at });
  }

  /* ---------- sesiones (RN-SEG-09, RN-SEG-10) ---------- */
  const isMobile = c => c === 'ANDROID' || c === 'IOS';
  S.openSession = function (u, { client = 'WEB', device_id = null, ip = null, ua = null, at = now(), status = 'ACTIVE' } = {}) {
    if (status === 'ACTIVE') S.enforceMax(u, at);
    const exp = isMobile(client) ? P.addMin(at, pMin('seg_mobile_session_days', 7) * 1440) : P.addMin(at, pMin('seg_session_max_hours', 12) * 60);
    return D.insert('user_sessions', { user_id: u.id, device_id, token_hash: tokenHash(U.uid('ses') + at), ip, user_agent: ua, client, status, mfa_verified_at: status === 'ACTIVE' && S.requiresMfa(u) ? at : null, started_at: at, last_seen_at: at, expires_at: exp, revoked_at: null, revoke_reason: null }, { silent: true });
  };
  S.activeSessions = uid => D.where('user_sessions', s => s.user_id === uid && s.status === 'ACTIVE');
  S.enforceMax = function (u, at) {
    const max = pMin('seg_max_concurrent_sessions', 3); const act = S.activeSessions(u.id).sort(U.by('last_seen_at'));
    while (act.length >= max) { const s = act.shift(); S.revokeSession(s.id, 'RN-SEG-10: se abrió otra sesión y se cerró la de uso más antiguo', { at, system: true }); }
  };
  S.revokeSession = function (id, reason, { at = now(), system = false } = {}) {
    const s = D.get('user_sessions', id); if (!s || !['ACTIVE', 'PENDING_MFA'].includes(s.status)) return s;
    D.update('user_sessions', id, { status: 'REVOKED', revoked_at: at, revoke_reason: reason || 'Cerrada' }, { silent: true });
    S.logAccess(system ? 'SESSION_REVOKED' : 'SESSION_REVOKED', { user_id: s.user_id, session_id: s.id, device_id: s.device_id, ip: s.ip, at, details: { reason } });
    if (!G._seeding) G.events.emit('session.revoked', { session_id: id, user_id: s.user_id, reason });
    return s;
  };
  S.revokeAll = function (uid, reason, { exceptId = null, at = now() } = {}) { let n = 0; for (const s of D.where('user_sessions', x => x.user_id === uid && ['ACTIVE', 'PENDING_MFA'].includes(x.status) && x.id !== exceptId)) { S.revokeSession(s.id, reason, { at, system: true }); n++; } return n; };
  /** cada petición toca la sesión: vence por inactividad o por duración máxima (RN-SEG-09) */
  S.touchSession = function (id, at = now()) {
    const s = D.get('user_sessions', id); if (!s || s.status !== 'ACTIVE') G.fail('RN-SEG-09', '401 · la sesión no está activa: vuelve a iniciar sesión.', { status: 401 });
    const idle = isMobile(s.client) ? pMin('seg_mobile_session_days', 7) * 1440 : pMin('seg_session_idle_minutes', 30);
    if (P.minDiff(at, s.last_seen_at) > idle || at > s.expires_at) { D.update('user_sessions', id, { status: 'EXPIRED', revoked_at: at, revoke_reason: 'Vencida por inactividad o duración (RN-SEG-09)' }, { silent: true }); S.logAccess('SESSION_EXPIRED', { user_id: s.user_id, session_id: id, at }); G.fail('RN-SEG-09', '401 · la sesión venció: vuelve a iniciar sesión.', { status: 401 }); }
    s.last_seen_at = at; D.touch(); return s;
  };

  /** marca como vencidas las sesiones sin uso o pasadas de su duración máxima, sin tocarlas (RN-SEG-09) */
  S.expireSessions = function (at = now()) {
    let n = 0;
    for (const s of D.where('user_sessions', x => x.status === 'ACTIVE')) {
      const idle = isMobile(s.client) ? pMin('seg_mobile_session_days', 7) * 1440 : pMin('seg_session_idle_minutes', 30);
      if (P.minDiff(at, s.last_seen_at) > idle || at > s.expires_at) { D.update('user_sessions', s.id, { status: 'EXPIRED', revoked_at: at, revoke_reason: 'Vencida por inactividad o duración (RN-SEG-09)' }, { silent: true }); S.logAccess('SESSION_EXPIRED', { user_id: s.user_id, session_id: s.id, at }); n++; }
    }
    return n;
  };
  /* ---------- inicio de sesión (RN-SEG-04, -05, -11, -19) ---------- */
  const ghost = {}; // intentos con correos inexistentes: mismo comportamiento que los reales (RN-SEG-19)
  S.login = function ({ email, password, ip = '190.42.10.20', ua = 'Chrome 129 · Windows', client = 'WEB', fingerprint = null, device_name = null, at = now() } = {}) {
    const e = lower(email); const max = pMin('seg_max_failed_logins', 5), lockMin = pMin('seg_lockout_minutes', 15);
    const lockMsg = `Demasiados intentos fallidos: el acceso queda bloqueado ${lockMin} minutos. Vuelve a intentarlo después o pide el desbloqueo al administrador.`;
    const u = D.find('users', x => lower(x.email) === e);
    if (!u || u.status === 'INACTIVE' || (u.platform && u.status === 'LOCKED' && !u.locked_until)) {
      const g = ghost[e] = ghost[e] || { n: 0, until: null };
      if (g.until && at < g.until) { S.logAccess('LOGIN_BLOCKED', { email: e, ip, ua, at }); G.fail('RN-SEG-04', lockMsg); }
      g.n++; if (g.n >= max) { g.until = P.addMin(at, lockMin); g.n = 0; }
      S.logAccess('LOGIN_FAILED', { user: u && u.status === 'INACTIVE' ? u : null, email: e, ip, ua, at, details: { reason: u ? 'INACTIVE' : 'UNKNOWN_EMAIL' } });
      G.fail('RN-SEG-19', GENERIC);
    }
    if (u.status === 'LOCKED') {
      if (u.locked_until && at >= u.locked_until) { u.status = 'ACTIVE'; u.locked_until = null; u.failed_logins = 0; D.touch(); }
      else { S.logAccess('LOGIN_BLOCKED', { user: u, ip, ua, at }); G.fail('RN-SEG-04', lockMsg); }
    }
    if (!password || u.pwd_hash !== A().hash(password)) {
      u.failed_logins = (u.failed_logins || 0) + 1; u.last_failed_login_at = at;
      if (u.failed_logins >= max) {
        u.status = 'LOCKED'; u.locked_until = P.addMin(at, lockMin); u.lock_reason = `${max} intentos fallidos seguidos`; D.touch();
        S.logAccess('LOGIN_FAILED', { user: u, ip, ua, at, details: { attempt: u.failed_logins } });
        S.logAccess('LOCKED', { user: u, ip, ua, at, details: { until: u.locked_until } });
        S.revokeAll(u.id, 'RN-SEG-18: cuenta bloqueada', { at });
        if (!G._seeding) G.events.emit('user.locked', { user_id: u.id, until: u.locked_until });
        G.fail('RN-SEG-04', lockMsg);
      }
      D.touch(); S.logAccess('LOGIN_FAILED', { user: u, ip, ua, at, details: { attempt: u.failed_logins } });
      G.fail('RN-SEG-19', GENERIC);
    }
    // dispositivo aprobado para la app móvil (RN-SEG-11)
    let dev = null;
    if (isMobile(client) && pMin('seg_mobile_device_approval', true)) {
      const fp = tokenHash('fp:' + (fingerprint || 'sin-huella'));
      dev = D.find('user_devices', d => d.user_id === u.id && d.fingerprint_hash === fp);
      if (!dev) { dev = D.insert('user_devices', { user_id: u.id, fingerprint_hash: fp, fingerprint_hint: String(fingerprint || ''), name: device_name || 'Celular nuevo', platform: client, status: 'PENDING', requested_at: at, last_seen_at: at }, { silent: true }); S.logAccess('DEVICE_PENDING', { user: u, ip, ua, at, device_id: dev.id }); G.notify({ role: 'COORDINADOR_DELIVERY', title: 'Celular por aprobar', body: `${u.name} pide entrar desde ${dev.name}.`, ref: '#SEG-13', tone: 'warn', module: 'SEG' }); }
      u.failed_logins = 0; D.touch();
      if (dev.status !== 'APPROVED') { S.logAccess('LOGIN_DENIED_DEVICE', { user: u, ip, ua, at, device_id: dev.id }); G.fail('RN-SEG-11', dev.status === 'REVOKED' ? 'Este celular fue revocado: la app no inicia sesión desde él.' : 'Este celular aún no está aprobado. Pide al coordinador de delivery que lo apruebe (SEG-13).'); }
      dev.last_seen_at = at;
    }
    u.failed_logins = 0; D.touch();
    if (S.requiresMfa(u)) {
      const s = S.openSession(u, { client, device_id: dev && dev.id, ip, ua, at, status: 'PENDING_MFA' });
      S.logAccess('LOGIN_OK', { user: u, ip, ua, at, session_id: s.id, details: { mfa: 'PENDING' } });
      return { status: u.twofa_enabled ? 'MFA_REQUIRED' : 'MFA_ENROLL', user: u, session: s };
    }
    const s = S.openSession(u, { client, device_id: dev && dev.id, ip, ua, at });
    u.last_login = at; S.logAccess('LOGIN_OK', { user: u, ip, ua, at, session_id: s.id, device_id: dev && dev.id });
    return { status: 'OK', user: u, session: s };
  };
  /** valida el TOTP (RN-SEG-06) o un código de recuperación (RN-SEG-07) y activa la sesión */
  S.verifyMfa = function (sessionId, code, { at = now() } = {}) {
    const s = D.get('user_sessions', sessionId); if (!s || s.status !== 'PENDING_MFA') G.fail('RN-SEG-05', 'No hay un inicio de sesión esperando el segundo factor.');
    const u = userOf(s.user_id); const c = String(code || '').trim().toUpperCase().replace(/\s/g, '');
    let ok = false, how = 'TOTP';
    if (/^\d{6}$/.test(c) && u.twofa_enabled) {
      const win = pMin('seg_totp_window_steps', 1); const base = Math.floor(Date.now() / 30000);
      for (let o = -win; o <= win; o++) if (A().totp(u, o) === c) { const step = base + o; if (u.totp_last_step && step <= u.totp_last_step) { S.logAccess('MFA_FAILED', { user: u, session_id: s.id, at, details: { reason: 'STEP_REUSED' } }); G.fail('RN-SEG-06', 'Ese código ya se usó: espera el siguiente de tu aplicación.'); } u.totp_last_step = step; ok = true; break; }
    } else if (/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/.test(c)) {
      const norm = c.includes('-') ? c : c.slice(0, 4) + '-' + c.slice(4);
      const rc = D.find('mfa_recovery_codes', r => r.user_id === u.id && r.code_hash === A().hash(norm) && !r.used_at && !r.voided_at);
      if (rc) { D.update('mfa_recovery_codes', rc.id, { used_at: at }, { silent: true }); ok = true; how = 'RECOVERY'; S.logAccess('RECOVERY_CODE_USED', { user: u, session_id: s.id, at }); }
    }
    if (!ok) { S.logAccess('MFA_FAILED', { user: u, session_id: s.id, at }); G.fail('RN-SEG-06', 'El código no es válido o ya venció. Usa el código vigente de tu aplicación o un código de recuperación.'); }
    S.enforceMax(u, at);
    D.update('user_sessions', s.id, { status: 'ACTIVE', mfa_verified_at: at, last_seen_at: at }, { silent: true });
    u.last_login = at; D.touch(); S.logAccess('MFA_OK', { user: u, session_id: s.id, at, details: { how } });
    return { user: u, session: s, how };
  };
  /* ---------- activar segundo factor (SEG-03) ---------- */
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  S.startEnroll = function (uid) { const u = userOf(uid); if (!u) G.fail('RN-SEG-05', 'Usuario no encontrado.'); let sec = ''; for (let i = 0; i < 16; i++) sec += B32[Math.floor(Math.random() * 32)]; return { user_id: u.id, secret: sec, uri: `otpauth://totp/Aycha:${encodeURIComponent(u.email)}?secret=${sec}&issuer=Aycha%20Don%20Guando&digits=6&period=30` }; };
  S.newRecoveryCodes = function (u, at = now()) {
    for (const r of D.where('mfa_recovery_codes', x => x.user_id === u.id && !x.voided_at && !x.used_at)) r.voided_at = at;
    const batch = 1 + Math.max(0, ...D.where('mfa_recovery_codes', x => x.user_id === u.id).map(x => x.batch_no || 1));
    const n = pMin('seg_recovery_codes_count', 10); const codes = [];
    const cs = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < n; i++) { let c = ''; for (let j = 0; j < 8; j++) c += cs[Math.floor(Math.random() * cs.length)]; c = c.slice(0, 4) + '-' + c.slice(4); codes.push(c); D.insert('mfa_recovery_codes', { user_id: u.id, code_hash: A().hash(c), batch_no: batch, used_at: null, voided_at: null }, { silent: true }); }
    D.touch(); return codes;
  };
  S.confirmEnroll = function (enroll, code, { at = now(), sessionId = null } = {}) {
    const u = userOf(enroll.user_id); const c = String(code || '').replace(/\s/g, '');
    const win = pMin('seg_totp_window_steps', 1); let ok = false;
    for (let o = -win; o <= win; o++) if (A().totp(u, o) === c) { ok = true; u.totp_last_step = Math.floor(Date.now() / 30000) + o; }
    if (!ok) G.fail('RN-SEG-06', 'El código no coincide: escanea el QR y escribe el código que muestra tu aplicación.');
    Object.assign(u, { twofa_enabled: true, mfa_enrolled_at: at, totp_secret_enc: 'enc:' + A().hash(enroll.secret) });
    const codes = S.newRecoveryCodes(u, at);
    S.logAccess('MFA_ENROLLED', { user: u, at, session_id: sessionId });
    if (sessionId) { const s = D.get('user_sessions', sessionId); if (s && s.status === 'PENDING_MFA') { S.enforceMax(u, at); D.update('user_sessions', s.id, { status: 'ACTIVE', mfa_verified_at: at }, { silent: true }); u.last_login = at; } }
    D.touch(); return codes;
  };
  S.regenCodes = function (uid) { const u = userOf(uid); if (!u || !u.twofa_enabled) G.fail('RN-SEG-07', 'Primero activa el segundo factor.'); const codes = S.newRecoveryCodes(u); S.logAccess('MFA_ENROLLED', { user: u, details: { regenerated: true } }); return codes; };

  /* ---------- recuperación de contraseña (RN-SEG-08) ---------- */
  S.FORGOT_MSG = 'Si el correo existe, te enviamos un enlace para crear una nueva contraseña.';
  S.forgot = function (email, { ip = '190.42.10.20', at = now() } = {}) {
    const e = lower(email); const u = D.find('users', x => lower(x.email) === e && x.status !== 'INACTIVE');
    S.logAccess('PASSWORD_RESET_REQUESTED', { user: u, email: e, ip, at, details: { exists: !!u } });
    if (!u) return { message: S.FORGOT_MSG, token: null };
    for (const t of D.where('password_reset_tokens', x => x.user_id === u.id && !x.used_at && !x.voided_at)) D.update('password_reset_tokens', t.id, { voided_at: at }, { silent: true });
    const token = U.token(24);
    D.insert('password_reset_tokens', { user_id: u.id, token_hash: tokenHash(token), expires_at: P.addMin(at, pMin('seg_reset_token_minutes', 30)), used_at: null, voided_at: null, requested_ip: ip, kind: 'RESET', requested_at: at }, { silent: true });
    return { message: S.FORGOT_MSG, token, user: u };
  };
  S.tokenInfo = token => D.find('password_reset_tokens', x => x.token_hash === tokenHash(token));
  S.reset = function (token, p1, p2, { at = now(), ip = '190.42.10.20' } = {}) {
    const t = S.tokenInfo(token);
    if (!t || t.used_at || t.voided_at) G.fail('RN-SEG-08', 'El enlace ya se usó o fue reemplazado por uno más nuevo. Pide otro en «Olvidé mi contraseña».');
    if (at > t.expires_at) G.fail('RN-SEG-08', `El enlace venció (dura ${pMin('seg_reset_token_minutes', 30)} minutos). Pide otro en «Olvidé mi contraseña».`);
    const u = userOf(t.user_id);
    if (p1 !== p2) G.fail('RN-SEG-02', 'Las dos contraseñas no coinciden.');
    S.assertPolicy(p1, u);
    D.update('password_reset_tokens', t.id, { used_at: at }, { silent: true });
    setPassword(u, p1, at, 'PASSWORD_RESET');
    if (u.status === 'LOCKED' && u.locked_until) { u.status = 'ACTIVE'; u.locked_until = null; }
    u.failed_logins = 0;
    const n = S.revokeAll(u.id, 'RN-SEG-08: contraseña restablecida', { at });
    return { user: u, closed: n };
  };
  S.changePassword = function (uid, current, p1, p2, { at = now() } = {}) {
    const u = userOf(uid); if (!u) G.fail('RN-SEG-02', 'Usuario no encontrado.');
    if (u.pwd_hash !== A().hash(current)) G.fail('RN-SEG-02', 'La contraseña actual no es correcta.');
    if (p1 !== p2) G.fail('RN-SEG-02', 'Las dos contraseñas nuevas no coinciden.');
    S.assertPolicy(p1, u);
    setPassword(u, p1, at, 'PASSWORD_CHANGED');
    return u;
  };

  /* ---------- usuarios (RN-SEG-01, -13, -15, -17, -18, -20) ---------- */
  const lastAdmin = u => u.role === 'ADMIN_SISTEMA' && D.where('users', x => x.role === 'ADMIN_SISTEMA' && x.status === 'ACTIVE' && x.id !== u.id).length === 0;
  function syncUserLinks(u) {
    const r = roleRow(u.role);
    for (const x of D.where('user_roles', x => x.user_id === u.id)) D.remove('user_roles', x.id);
    if (r) D.insert('user_roles', { user_id: u.id, role_id: r.id }, { silent: true });
    for (const x of D.where('user_scopes', x => x.user_id === u.id)) D.remove('user_scopes', x.id);
    for (const b of u.brands || []) D.insert('user_scopes', { user_id: u.id, brand_id: b, establishment_id: null }, { silent: true });
    for (const s of u.sites || []) D.insert('user_scopes', { user_id: u.id, brand_id: null, establishment_id: s }, { silent: true });
  }
  function checkScope(role, brands, sites) { if (S.scopeMode(role) === 'ASSIGNED' && !(brands || []).length && !(sites || []).length) G.fail('RN-SEG-13', `El rol ${S.roleLabel(role)} es de alcance asignado: elige al menos un local o una marca.`); }
  S.createUser = function (v) {
    P.assertPerm('seg.user.manage');
    const email = lower(v.email);
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) G.fail('RN-SEG-01', 'Escribe un correo válido.');
    if (D.find('users', x => lower(x.email) === email)) G.fail('RN-SEG-01', `Ya existe un usuario con el correo ${email} (sin distinguir mayúsculas).`);
    if (!S.allRoles().some(r => r[0] === v.role)) G.fail('RN-SEG-12', 'Elige un rol existente.');
    const brands = v.brands || [], sites = v.sites || [];
    checkScope(v.role, brands, sites);
    const u = D.insert('users', { name: String(v.name || '').trim(), email, role: v.role, brands, sites, employee_id: v.employee_id || null, status: 'ACTIVE', twofa_enabled: false, must_change_password: true, failed_logins: 0, pwd_hash: null, last_login: null, invited_at: now(), default_brand_id: brands.length === 1 ? brands[0] : null, ui_theme_mode: 'SYSTEM', locale: 'es-PE' });
    syncUserLinks(u);
    const token = U.token(24);
    D.insert('password_reset_tokens', { user_id: u.id, token_hash: tokenHash(token), expires_at: P.addMin(now(), 72 * 60), used_at: null, voided_at: null, kind: 'INVITE', requested_at: now() }, { silent: true });
    S.logAccess('USER_INVITED', { user: u, details: { by: G.ctx.userName() } });
    G.events.emit('user.created', { user_id: u.id, role: u.role });
    return { user: u, token };
  };
  S.updateUser = function (id, v) {
    P.assertPerm('seg.user.manage');
    const u = userOf(id); if (!u) G.fail('RN-SEG-12', 'Usuario no encontrado.');
    if (v.role && v.role !== u.role && lastAdmin(u)) G.fail('RN-SEG-15', 'Es el único administrador del sistema activo: no se le puede quitar el rol. Asigna antes otro administrador.');
    const role = v.role || u.role, brands = v.brands ?? u.brands, sites = v.sites ?? u.sites;
    checkScope(role, brands, sites);
    const changed = role !== u.role || JSON.stringify(brands) !== JSON.stringify(u.brands) || JSON.stringify(sites) !== JSON.stringify(u.sites);
    D.update('users', id, { name: v.name || u.name, role, brands, sites, employee_id: v.employee_id !== undefined ? v.employee_id || null : u.employee_id, perm_version: (u.perm_version || 0) + (changed ? 1 : 0) });
    syncUserLinks(u);
    if (changed) G.events.emit('user.roles_changed', { user_id: id, role, brands, sites });
    return u;
  };
  S.lockUser = function (id, reason) {
    P.assertPerm('seg.user.manage'); const u = userOf(id);
    if (u.id === G.ctx.userId()) G.fail('RN-SEG-16', 'No puedes bloquear tu propio usuario.');
    if (!String(reason || '').trim()) G.fail('RN-SEG-18', 'Indica el motivo del bloqueo.');
    D.update('users', id, { status: 'LOCKED', locked_until: null, lock_reason: reason.trim() });
    S.logAccess('LOCKED', { user: u, details: { manual: true, by: G.ctx.userName(), reason } });
    S.revokeAll(u.id, 'RN-SEG-18: usuario bloqueado');
    G.events.emit('user.locked', { user_id: id, manual: true });
    return u;
  };
  S.unlock = function (id) { P.assertPerm('seg.user.unlock'); const u = userOf(id); if (u.status !== 'LOCKED') G.fail('RN-SEG-04', 'El usuario no está bloqueado.'); D.update('users', id, { status: 'ACTIVE', locked_until: null, failed_logins: 0, lock_reason: null }); S.logAccess('UNLOCKED', { user: u, details: { by: G.ctx.userName() } }); return u; };
  S.resetMfa = function (id) {
    P.assertPerm('seg.user.reset_mfa'); const u = userOf(id);
    if (u.id === G.ctx.userId()) G.fail('RN-SEG-16', 'No puedes reiniciar tu propio segundo factor: pídelo a otro administrador.');
    D.update('users', id, { twofa_enabled: false, mfa_enrolled_at: null, totp_last_step: null, totp_secret_enc: null });
    for (const r of D.where('mfa_recovery_codes', x => x.user_id === id && !x.voided_at && !x.used_at)) r.voided_at = now();
    S.revokeAll(id, 'Segundo factor reiniciado'); S.logAccess('MFA_RESET', { user: u, details: { by: G.ctx.userName() } });
    return u;
  };
  S.deactivate = function (id, reason) {
    P.assertPerm('seg.user.manage'); const u = userOf(id);
    if (lastAdmin(u)) G.fail('RN-SEG-15', 'Es el único administrador del sistema activo: no se puede desactivar.');
    if (!String(reason || '').trim()) G.fail('RN-SEG-17', 'Indica el motivo: los usuarios no se borran, se desactivan con motivo.');
    D.update('users', id, { status: 'INACTIVE', deactivated_at: now(), deactivate_reason: reason.trim() });
    S.revokeAll(id, 'RN-SEG-18: usuario desactivado');
    for (const d of D.where('user_devices', x => x.user_id === id && x.status !== 'REVOKED')) D.update('user_devices', d.id, { status: 'REVOKED', revoked_at: now(), revoke_reason: 'Usuario desactivado (RN-SEG-18)' }, { silent: true });
    S.logAccess('USER_DEACTIVATED', { user: u, details: { by: G.ctx.userName(), reason } });
    G.events.emit('user.deactivated', { user_id: id, role: u.role });
    return u;
  };
  S.reactivate = function (id) { P.assertPerm('seg.user.manage'); const u = userOf(id); if (u.status !== 'INACTIVE') G.fail('RN-SEG-17', 'El usuario no está inactivo.'); D.update('users', id, { status: 'ACTIVE', deactivated_at: null, failed_logins: 0 }); return u; };
  /** RN-SEG-16: nadie aprueba lo que registró (salvo la gerencia si es la única con el permiso; queda marcado) */
  S.assertNotSelfApproval = function (registeredBy, perm, approver = G.ctx.userId()) {
    if (!registeredBy || registeredBy !== approver) return { ok: true, flagged: false };
    const others = D.where('users', u => u.status === 'ACTIVE' && u.id !== approver && P.hasPerm(perm, u.role));
    const ap = userOf(approver);
    if (ap && ap.role === 'GERENTE' && !others.length) { G.audit('APROBACION_PROPIA', 'users', approver, `Aprobó lo que registró (${perm}): única persona con el permiso`); return { ok: true, flagged: true }; }
    G.fail('RN-SEG-16', 'Nadie aprueba lo que él mismo registró: pide la aprobación a otra persona con el permiso ' + perm + '.');
  };

  /* ---------- dispositivos de la app (RN-SEG-11) ---------- */
  S.approveDevice = function (id) {
    P.assertPerm('seg.device.approve'); const d = D.get('user_devices', id); if (!d) G.fail('RN-SEG-11', 'Dispositivo no encontrado.');
    if (d.status !== 'PENDING') G.fail('RN-SEG-11', 'Solo se aprueban celulares pendientes.');
    S.assertNotSelfApproval(d.user_id, 'seg.device.approve');
    D.update('user_devices', id, { status: 'APPROVED', approved_by: G.ctx.userId(), approved_at: now() });
    S.logAccess('DEVICE_APPROVED', { user_id: d.user_id, device_id: id, details: { by: G.ctx.userName() } });
    G.notify({ user_id: d.user_id, title: 'Celular aprobado', body: `${d.name} ya puede iniciar sesión en la app.`, tone: 'ok', module: 'SEG' });
    return d;
  };
  S.revokeDevice = function (id, reason) {
    P.assertPerm('seg.device.approve'); const d = D.get('user_devices', id); if (!d) G.fail('RN-SEG-11', 'Dispositivo no encontrado.');
    if (!String(reason || '').trim()) G.fail('RN-SEG-11', 'Indica el motivo (por ejemplo: celular perdido).');
    D.update('user_devices', id, { status: 'REVOKED', revoked_at: now(), revoke_reason: reason.trim() });
    let n = 0; for (const s of D.where('user_sessions', s => s.device_id === id && ['ACTIVE', 'PENDING_MFA'].includes(s.status))) { S.revokeSession(s.id, 'RN-SEG-11: celular revocado'); n++; }
    S.logAccess('DEVICE_REVOKED', { user_id: d.user_id, device_id: id, details: { reason, sessions: n } });
    return { device: d, closed: n };
  };

  /* ---------- roles y permisos (RN-SEG-12, RN-SEG-14) ---------- */
  /** vuelve a armar G.ACCESS y G.PERMS desde las tablas (roles propios y ajustes por empresa) */
  S.syncRoles = function () {
    for (const k of Object.keys(G.ACCESS)) if (!(k in BASE_ACCESS)) delete G.ACCESS[k];
    for (const [k, v] of Object.entries(BASE_ACCESS)) G.ACCESS[k] = JSON.parse(JSON.stringify(v));
    for (const k of Object.keys(G.PERMS)) if (!(k in BASE_PERMS)) delete G.PERMS[k];
    for (const [k, v] of Object.entries(BASE_PERMS)) G.PERMS[k] = Array.isArray(v) ? v.slice() : v;
    let any = false;
    const rp = U.groupBy(D.all('role_permissions'), 'role_id'); const pc = new Map(D.all('permissions').map(p => [p.id, p.code]));
    for (const r of D.all('roles')) {
      if (r.code === 'GERENTE') continue;
      if (r.access_override && Object.keys(r.access_override).length) { G.ACCESS[r.code] = Object.assign({}, typeof BASE_ACCESS[r.code] === 'object' ? BASE_ACCESS[r.code] : { '*': '' }, r.access_override); any = true; }
      else if (!r.is_system) G.ACCESS[r.code] = { '*': '' };
      if (D.all('role_permissions').length) { const list = (rp[r.id] || []).map(x => pc.get(x.permission_id)).filter(Boolean); const base = (BASE_PERMS[r.code] || []).slice().sort().join(); if (list.slice().sort().join() !== base) any = true; G.PERMS[r.code] = list; }
    }
    return any;
  };
  S.rolePerms = code => code === 'GERENTE' ? Object.keys(G.PERM_INFO) : (Array.isArray(G.PERMS[code]) ? G.PERMS[code] : []);
  S.setRolePerm = function (code, perm, on) {
    P.assertPerm('seg.role.manage');
    if (code === 'GERENTE') G.fail('RN-SEG-14', 'La gerencia tiene todos los permisos por contrato del núcleo.');
    const info = G.PERM_INFO[perm]; if (info && on && !G.modOn(info.module)) G.fail('RN-PLT-07', `El módulo ${info.module} está apagado: su permiso ${perm} no se concede.`);
    const r = roleRow(code), p = D.find('permissions', x => x.code === perm); if (!r || !p) G.fail('RN-SEG-12', 'Rol o permiso no encontrado.');
    const ex = D.find('role_permissions', x => x.role_id === r.id && x.permission_id === p.id);
    if (on && !ex) D.insert('role_permissions', { role_id: r.id, permission_id: p.id });
    if (!on && ex) D.remove('role_permissions', ex.id);
    S.syncRoles(); for (const u of D.where('users', u => u.role === code)) u.perm_version = (u.perm_version || 0) + 1;
    G.events.emit('user.roles_changed', { role: code, perm, on });
  };
  S.setRoleAccess = function (code, mod, letters) {
    P.assertPerm('seg.role.manage');
    if (code === 'GERENTE') G.fail('RN-SEG-14', 'La gerencia ve todo por contrato del núcleo.');
    if (letters && !G.modOn(mod)) G.fail('RN-PLT-07', `El módulo ${mod} está apagado: no se conceden accesos.`);
    const r = roleRow(code); if (!r) G.fail('RN-SEG-12', 'Rol no encontrado.');
    const ov = Object.assign({}, r.access_override || {}); ov[mod] = letters; D.update('roles', r.id, { access_override: ov });
    S.syncRoles(); G.events.emit('user.roles_changed', { role: code, module: mod, access: letters });
  };
  S.copyRole = function (base, code, name) {
    P.assertPerm('seg.role.manage');
    code = String(code || '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{2,24}$/.test(code)) G.fail('RN-SEG-14', 'El código usa mayúsculas, números y guion bajo (3 a 25).');
    if (roleRow(code) || G.ROLES.find(x => x[0] === code)) G.fail('RN-SEG-14', 'Ya existe un rol con ese código.');
    const b = roleRow(base);
    const acc = {}; for (const m of Object.keys(G.SPEC)) acc[m] = G.access(m, base);
    const r = D.insert('roles', { code, name: String(name || code).trim(), is_system: false, description: `Copia de ${S.roleLabel(base)}`, requires_mfa: b ? b.requires_mfa : false, scope_mode: b ? b.scope_mode : 'ALL', phase: b ? b.phase : 0, status: 'ACTIVE', access_override: acc, based_on: base });
    for (const pc of S.rolePerms(base)) { const p = D.find('permissions', x => x.code === pc); if (p) D.insert('role_permissions', { role_id: r.id, permission_id: p.id }, { silent: true }); }
    S.syncRoles(); return r;
  };
  S.deleteRole = function (code) {
    P.assertPerm('seg.role.manage'); const r = roleRow(code);
    if (!r) G.fail('RN-SEG-14', 'Rol no encontrado.'); if (r.is_system) G.fail('RN-SEG-14', 'Los roles del sistema no se borran ni cambian su código.');
    if (D.find('users', u => u.role === code)) G.fail('RN-SEG-14', 'Hay usuarios con este rol: cámbialos de rol antes de borrarlo.');
    for (const x of D.where('role_permissions', x => x.role_id === r.id)) D.remove('role_permissions', x.id);
    D.remove('roles', r.id); S.syncRoles();
  };
  S.userHasPermission = function (uid, perm) { const u = userOf(uid); if (!u || u.status !== 'ACTIVE') return false; return P.hasPerm(perm, u.role); };

  /* ---------- semillas (orden 11 y 12) ---------- */
  G.seed(11, function seedSEG() {
    const ins = (t, r) => D.insert(t, r, { silent: true }); const r = U.rng(111111);
    for (const [code, name] of G.ROLES) ins('roles', { id: 'ro-' + code, code, name, is_system: true, description: ROLE_DESC[code] || '', requires_mfa: P.MFA_ROLES.includes(code), scope_mode: P.ASSIGNED_ROLES.includes(code) ? 'ASSIGNED' : 'ALL', phase: P.ROLE_PHASE[code] ?? 0, status: 'ACTIVE' });
    for (const [code, info] of Object.entries(G.PERM_INFO)) ins('permissions', { id: 'pe-' + code, code, module_code: info.module, description: info.desc, everyone: !info.roles.length });
    for (const [code] of G.ROLES) for (const pc of (code === 'GERENTE' ? Object.keys(G.PERM_INFO) : (BASE_PERMS[code] || []))) ins('role_permissions', { role_id: 'ro-' + code, permission_id: 'pe-' + pc });
    // correo de Ana Torres como en CA-SEG-06; 6.ª vendedora (solo Marca 3) y exvendedora inactiva (D-SEG-04)
    const ana = D.get('users', 'us-atorres'); if (ana) ana.email = 'ana.torres@donguando.pe';
    ins('employees', { id: 'em-41530011', doc_type: 'DNI', doc_number: '41530011', full_name: 'Fiorella Quispe Lara', position: 'Vendedora Marca 3', establishment_id: 'es-L1', hire_date: '2026-08-17', phone: '+51991530011', status: 'ACTIVE', monthly_salary: 1500 });
    ins('users', { id: 'us-fquispe', employee_id: 'em-41530011', name: 'Fiorella Quispe Lara', email: 'fquispe@donguando.pe', role: 'VENDEDORA', brands: ['br-M3'], sites: [], status: 'ACTIVE', twofa_enabled: false, last_login: '2026-10-10T08:40' });
    ins('employees', { id: 'em-41530012', doc_type: 'DNI', doc_number: '41530012', full_name: 'Karina Ruiz Soto', position: 'Vendedora (cesada)', establishment_id: 'es-L1', hire_date: '2025-06-02', phone: '+51991530012', status: 'TERMINATED', monthly_salary: 1500 });
    ins('users', { id: 'us-kruiz', employee_id: 'em-41530012', name: 'Karina Ruiz Soto', email: 'kruiz@donguando.pe', role: 'VENDEDORA', brands: ['br-M2'], sites: [], status: 'INACTIVE', twofa_enabled: false, last_login: '2026-08-30T18:10', deactivated_at: '2026-08-31T19:00', deactivate_reason: 'Renuncia: se cerró su acceso y su celular el mismo día' });
    // columnas agregadas de SEG
    const users = D.all('users');
    users.forEach((u, i) => {
      Object.assign(u, { password_changed_at: G.date.add('2026-03-02', i * 3) + 'T09:00', must_change_password: false, locked_until: null, last_failed_login_at: null, mfa_enrolled_at: u.twofa_enabled ? G.date.add('2026-03-02', i * 3) + 'T09:10' : null, totp_last_step: null, default_brand_id: (u.brands || []).length ? u.brands[0] : null, ui_theme_mode: 'SYSTEM', locale: 'es-PE', notify_prefs: { email: true, push: MOBILE_ROLES.includes(u.role), daily_summary: ['GERENTE', 'SUPERVISORA_VENTAS'].includes(u.role) } });
      if (u.role === 'AUDITOR') { u.twofa_enabled = true; u.mfa_enrolled_at = '2026-07-01T10:00'; u.last_login = '2026-07-22T10:00'; }
      ins('password_history', { user_id: u.id, password_hash: 'fnv1a$prev' + (i * 7919).toString(16), set_at: G.date.add('2025-11-01', i) + 'T09:00' });
      ins('user_roles', { user_id: u.id, role_id: 'ro-' + u.role });
      for (const b of u.brands || []) ins('user_scopes', { user_id: u.id, brand_id: b, establishment_id: null });
      for (const s of u.sites || []) ins('user_scopes', { user_id: u.id, brand_id: null, establishment_id: s });
    });
    // practicante bloqueada por intentos (vence hoy 09:35)
    const and = D.get('users', 'us-acusi'); if (and) Object.assign(and, { status: 'LOCKED', locked_until: '2026-10-10T09:35:00', failed_logins: 5, last_failed_login_at: '2026-10-10T09:20:00', lock_reason: '5 intentos fallidos seguidos' });
    // códigos de recuperación (hash) de quienes tienen 2FA
    for (const u of users.filter(x => x.twofa_enabled)) for (let k = 0; k < 10; k++) ins('mfa_recovery_codes', { user_id: u.id, code_hash: 'fnv1a$rc' + Math.floor(r() * 1e9).toString(16), batch_no: 1, used_at: k === 0 && u.role === 'GERENTE' ? '2026-08-14T07:50:00' : null, voided_at: null });
    // dispositivos
    const fp = s => A().hash('tok:fp:' + s);
    const DEV = [['us-pcondori', 'Motorola G54 de Pedro', 'ANDROID', 'APPROVED', 'fp-pcondori-1'], ['us-pcondori', 'Samsung Galaxy A15 (nuevo)', 'ANDROID', 'PENDING', 'fp-pcondori-2'], ['us-hticona', 'Xiaomi Redmi Note 13 de Hugo', 'ANDROID', 'APPROVED', 'fp-hticona-1'], ['us-jchoque', 'Xiaomi Redmi 9 (perdido)', 'ANDROID', 'REVOKED', 'fp-jchoque-1'], ['us-jchoque', 'Samsung Galaxy A05 de Julio', 'ANDROID', 'APPROVED', 'fp-jchoque-2'], ['us-mvilla', 'iPhone 12 de Marco', 'IOS', 'APPROVED', 'fp-mvilla-1'], ['us-rquispe', 'Laptop gerencia (Chrome)', 'WEB', 'APPROVED', 'fp-rquispe-web'], ['us-rquispe', 'iPhone 14 de Rosa', 'IOS', 'APPROVED', 'fp-rquispe-ios'], ['us-lccahuana', 'PC sistemas (Firefox)', 'WEB', 'APPROVED', 'fp-lccahuana-web']];
    for (const [uid, name, plat, st, f] of DEV) if (D.get('users', uid)) ins('user_devices', { id: 'dv-' + f, user_id: uid, fingerprint_hash: fp(f), fingerprint_hint: f, name, platform: plat, status: st, approved_by: st !== 'PENDING' ? 'us-rchavez' : null, approved_at: st !== 'PENDING' ? '2026-09-02T08:00:00' : null, revoked_at: st === 'REVOKED' ? '2026-09-27T21:10:00' : null, revoke_reason: st === 'REVOKED' ? 'Celular perdido en ruta (Lurín)' : null, requested_at: st === 'PENDING' ? '2026-10-10T07:10:00' : '2026-09-01T08:00:00', last_seen_at: st === 'APPROVED' ? '2026-10-10T07:' + U.pad(U.int(r, 10, 59), 2) + ':00' : '2026-10-10T07:10:00' });
    // sesiones abiertas y cerradas
    const UA = ['Chrome 129 · Windows', 'Chrome 129 · Android', 'Safari · iPhone', 'Edge 129 · Windows', 'Firefox 131 · Windows'];
    users.filter(u => u.status === 'ACTIVE' && !u.platform).forEach((u, i) => {
      const mob = MOBILE_ROLES.includes(u.role); const dev = mob ? D.find('user_devices', d => d.user_id === u.id && d.status === 'APPROVED') : null;
      const at = '2026-10-10T0' + (7 + i % 3) + ':' + U.pad(U.int(r, 0, 59), 2) + ':00';
      ins('user_sessions', { user_id: u.id, device_id: dev ? dev.id : null, token_hash: 'tok-s' + i, ip: mob ? '181.65.' + U.int(r, 10, 250) + '.' + U.int(r, 2, 250) : '190.42.10.' + (20 + i), user_agent: mob ? 'App Aycha 1.4 · Android' : UA[i % UA.length], client: mob ? (dev && dev.platform) || 'ANDROID' : 'WEB', status: 'ACTIVE', mfa_verified_at: S.isMfaRole(u.role) && u.twofa_enabled ? at : null, started_at: at, last_seen_at: P.addMin(at, U.int(r, 5, 90)), expires_at: mob ? P.addMin(at, 7 * 1440) : P.addMin(at, 12 * 60) });
      if (['GERENTE', 'SUPERVISORA_VENTAS', 'VENDEDORA'].includes(u.role) && i % 2 === 0) ins('user_sessions', { user_id: u.id, device_id: u.id === 'us-rquispe' ? 'dv-fp-rquispe-ios' : null, token_hash: 'tok-m' + i, ip: '181.65.33.' + (40 + i), user_agent: 'Safari · iPhone', client: 'WEB', status: 'ACTIVE', mfa_verified_at: u.twofa_enabled ? '2026-10-09T21:00:00' : null, started_at: '2026-10-09T21:00:00', last_seen_at: '2026-10-09T22:15:00', expires_at: '2026-10-10T09:00:00' });
      ins('user_sessions', { user_id: u.id, device_id: null, token_hash: 'tok-o' + i, ip: '190.42.10.' + (20 + i), user_agent: UA[(i + 1) % UA.length], client: 'WEB', status: i % 3 ? 'EXPIRED' : 'REVOKED', started_at: '2026-10-08T08:00:00', last_seen_at: '2026-10-08T13:30:00', expires_at: '2026-10-08T20:00:00', revoked_at: '2026-10-08T14:00:00', revoke_reason: i % 3 ? 'Vencida por inactividad (RN-SEG-09)' : 'Cierre de sesión' });
    });
    const jdev = D.get('user_devices', 'dv-fp-jchoque-1'); if (jdev) ins('user_sessions', { user_id: 'us-jchoque', device_id: jdev.id, token_hash: 'tok-lost', ip: '181.65.70.9', user_agent: 'App Aycha 1.4 · Android', client: 'ANDROID', status: 'REVOKED', started_at: '2026-09-27T08:00:00', last_seen_at: '2026-09-27T19:40:00', expires_at: '2026-10-04T08:00:00', revoked_at: '2026-09-27T21:10:00', revoke_reason: 'RN-SEG-11: celular revocado' });
    // enlace de recuperación vencido de ejemplo
    ins('password_reset_tokens', { user_id: 'us-bramos', token_hash: 'tok-demo-old', expires_at: '2026-10-06T10:02:00', used_at: '2026-10-06T09:41:00', voided_at: null, requested_ip: '190.42.10.5', kind: 'RESET', requested_at: '2026-10-06T09:32:00' });
    S.syncRoles();
  }, 'SEG');
  G.seed(12, function seedAccessLog() {
    const ins = (t, row) => D.insert(t, row, { silent: true }); const r = U.rng(121212);
    const users = D.where('users', u => u.status !== 'INACTIVE' && !u.platform && u.role !== 'CLIENTE_B2B');
    const ip = u => MOBILE_ROLES.includes(u.role) ? '181.65.' + (20 + (u.id.length * 7) % 200) + '.' + (u.name.length * 3) : '190.42.10.' + (20 + u.name.length);
    for (let d = 0; d < 40; d++) {
      const day = G.date.add('2026-09-01', d); const wd = G.date.parse(day).getUTCDay(); if (wd === 0) continue;
      for (const u of users) {
        if (u.role === 'AUDITOR' && day > '2026-07-22') continue;
        if (r() > 0.82) continue;
        const at = day + 'T0' + U.int(r, 7, 9) + ':' + U.pad(U.int(r, 0, 59), 2) + ':00';
        if (r() < 0.035) ins('access_log', { user_id: u.id, email_attempted: u.email, event: 'LOGIN_FAILED', module_code: 'SEG', ip: ip(u), user_agent: 'Chrome 129 · Windows', details: { attempt: 1 }, occurred_at: P.addMin(at, -1) });
        ins('access_log', { user_id: u.id, email_attempted: u.email, event: 'LOGIN_OK', module_code: 'SEG', ip: ip(u), user_agent: MOBILE_ROLES.includes(u.role) ? 'App Aycha 1.4 · Android' : 'Chrome 129 · Windows', details: {}, occurred_at: at });
        if (u.twofa_enabled) ins('access_log', { user_id: u.id, email_attempted: u.email, event: 'MFA_OK', module_code: 'SEG', ip: ip(u), user_agent: 'Chrome 129 · Windows', details: { how: 'TOTP' }, occurred_at: P.addMin(at, 1) });
      }
      if (d % 9 === 4) ins('access_log', { user_id: null, email_attempted: 'ventas@donguando.pe', event: 'LOGIN_FAILED', module_code: 'SEG', ip: '45.231.' + U.int(r, 10, 99) + '.12', user_agent: 'curl/8.4', details: { reason: 'UNKNOWN_EMAIL' }, occurred_at: day + 'T03:1' + (d % 10) + ':00' });
    }
    // bloqueo de Betty Ramos el 06/10 desde 190.42.10.5 y desbloqueo por el administrador
    const b = D.get('users', 'us-bramos');
    if (b) { for (let k = 1; k <= 5; k++) ins('access_log', { user_id: b.id, email_attempted: b.email, event: 'LOGIN_FAILED', module_code: 'SEG', ip: '190.42.10.5', user_agent: 'Chrome 129 · Android', details: { attempt: k }, occurred_at: '2026-10-06T09:2' + k + ':00' }); ins('access_log', { user_id: b.id, email_attempted: b.email, event: 'LOCKED', module_code: 'SEG', ip: '190.42.10.5', user_agent: 'Chrome 129 · Android', details: { until: '2026-10-06T09:40:00' }, occurred_at: '2026-10-06T09:25:00' }); ins('access_log', { user_id: b.id, email_attempted: b.email, event: 'PASSWORD_RESET_REQUESTED', module_code: 'SEG', ip: '190.42.10.5', details: {}, occurred_at: '2026-10-06T09:32:00' }); ins('access_log', { user_id: b.id, email_attempted: b.email, event: 'PASSWORD_RESET', module_code: 'SEG', ip: '190.42.10.5', details: {}, occurred_at: '2026-10-06T09:41:00' }); }
    const a = D.get('users', 'us-acusi');
    if (a) { for (let k = 1; k <= 5; k++) ins('access_log', { user_id: a.id, email_attempted: a.email, event: 'LOGIN_FAILED', module_code: 'SEG', ip: '190.42.10.33', user_agent: 'Edge 129 · Windows', details: { attempt: k }, occurred_at: '2026-10-10T09:1' + (5 + k) + ':00' }); ins('access_log', { user_id: a.id, email_attempted: a.email, event: 'LOCKED', module_code: 'SEG', ip: '190.42.10.33', user_agent: 'Edge 129 · Windows', details: { until: '2026-10-10T09:35:00' }, occurred_at: '2026-10-10T09:20:00' }); }
    ins('access_log', { user_id: 'us-jchoque', email_attempted: 'jchoque@donguando.pe', event: 'DEVICE_REVOKED', module_code: 'SEG', ip: '190.42.10.24', details: { reason: 'Celular perdido en ruta (Lurín)', sessions: 1 }, occurred_at: '2026-09-27T21:10:00' });
    ins('access_log', { user_id: 'us-pcondori', email_attempted: 'pcondori@donguando.pe', event: 'DEVICE_PENDING', module_code: 'SEG', ip: '181.65.70.15', device_id: 'dv-fp-pcondori-2', details: {}, occurred_at: '2026-10-10T07:10:00' });
    ins('access_log', { user_id: 'us-pcondori', email_attempted: 'pcondori@donguando.pe', event: 'LOGIN_DENIED_DEVICE', module_code: 'SEG', ip: '181.65.70.15', device_id: 'dv-fp-pcondori-2', details: {}, occurred_at: '2026-10-10T07:10:30' });
  }, 'SEG-bitácora');
  // después del arranque, los ajustes de roles guardados en el navegador vuelven a regir
  window.addEventListener('load', () => { try { if (S.syncRoles() && G.ctx.session) G.render(); } catch (e) { console.error(e); } });

  /* ---------- indicadores ---------- */
  const inRange = (x, from, to) => { const d = String(x || '').slice(0, 10); return d >= from && d <= to; }; /* access_log también lo escribe AUD con la columna «at» */
  G.kpiCalc['KPI-SEG-01'] = () => { const req = D.where('users', u => u.status === 'ACTIVE' && S.requiresMfa(u)); const ok = req.filter(u => u.twofa_enabled).length; return { value: req.length ? U.round(ok / req.length * 100, 1) : 100, numerator: ok, denominator: req.length }; };
  G.kpiCalc['KPI-SEG-02'] = ({ from, to }) => D.where('access_log', e => e.event === 'LOCKED' && inRange(e.occurred_at || e.at, from, to)).length;
  G.kpiCalc['KPI-SEG-03'] = ({ to }) => { const lim = G.date.add(to || G.TODAY, -pMin('seg_inactive_user_days', 60)); return D.where('users', u => u.status === 'ACTIVE' && !u.platform && (!u.last_login || u.last_login.slice(0, 10) < lim)).length; };
  G.kpiCalc['KPI-SEG-04'] = ({ from, to }) => { const ev = D.where('access_log', e => (e.event === 'LOGIN_FAILED' || e.event === 'LOGIN_OK') && inRange(e.occurred_at || e.at, from, to)); const f = ev.filter(e => e.event === 'LOGIN_FAILED').length; return { value: ev.length ? U.round(f / ev.length * 100, 2) : 0, numerator: f, denominator: ev.length }; };

  /* ---------- alertas y búsqueda ---------- */
  G.alertProviders.push(() => {
    const out = [];
    const pend = D.where('user_devices', d => d.status === 'PENDING'); if (pend.length) out.push({ module: 'SEG', title: `${pend.length} celular(es) por aprobar`, detail: pend.map(d => G.userShort(d.user_id) + ' · ' + d.name).join(', '), tone: 'warn', go: () => G.go('SEG-13') });
    const lk = D.where('users', u => u.status === 'LOCKED'); if (lk.length) out.push({ module: 'SEG', title: `${lk.length} usuario(s) bloqueado(s)`, detail: lk.map(u => u.name).join(', ') + ' · RN-SEG-04', tone: 'bad', go: () => G.go('SEG-08') });
    const k = G.kpi('KPI-SEG-01'); if (k && k.value < 100) out.push({ module: 'SEG', title: `Segundo factor: ${F.pct(k.value, 0)} de cobertura`, detail: `${k.denominator - k.numerator} usuario(s) con rol que exige 2FA aún no lo activan (RN-SEG-05).`, tone: 'info', go: () => G.go('SEG-08') });
    return out;
  });
  G.searchProviders.push(q => { const qq = lower(q); if (qq.length < (G.param('plt_search_min_chars') || 3) || !G.canSee('SEG') || !G.modOn('SEG')) return []; return D.where('users', u => lower(u.name).includes(qq) || lower(u.email).includes(qq)).slice(0, 5).map(u => ({ label: u.name, sub: `Usuario · ${u.email} · ${S.roleLabel(u.role)}`, go: () => G.go('SEG-09', { id: u.id }) })); });

  /* =================== PANTALLAS =================== */
  const can = perm => P.hasPerm(perm);
  const guard = (perm, fn) => () => { if (!can(perm)) { toast(`RN-SEG-12: 403 · tu rol (${G.roleName()}) no tiene el permiso ${perm}.`, 'warn'); return; } fn(); };
  const run = (fn, okMsg) => { try { const r = fn(); if (okMsg) toast(okMsg, 'ok'); G.refresh(); return r || true; } catch (e) { toast(e.message, 'bad'); return null; } };
  const scopeText = u => [(u.brands || []).length ? u.brands.map(G.brandName).join(', ') : null, (u.sites || []).length ? u.sites.map(G.siteName).join(', ') : null].filter(Boolean).join(' · ') || (S.scopeMode(u.role) === 'ALL' ? 'Todo' : 'Todo (sin filas de alcance)');
  const ago = iso => { if (!iso) return '—'; const m = Math.round(P.minDiff(now(), iso)); return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };
  function reasonModal(title, text, label, kind, fn) { modal(title, bd => { bd.appendChild(h('p', null, text)); bd.appendChild(h('textarea', { class: 'input', attrs: { id: 'seg-reason', placeholder: 'Motivo' } })); }, [{ label: 'Cancelar' }, { label, kind, onClick: () => run(() => fn(document.getElementById('seg-reason').value), 'Hecho') ? undefined : false }]); }

  /* ---- simulador de inicio de sesión (SEG-01 a SEG-05) ---- */
  const sim = { host: 'donguando.aycha.pe', ip: '190.42.10.5', device: 'WEB', clock: 0, email: '', msg: null, tone: 'bad', session_id: null, result: null, token: null, enroll: null, codes: null, forgot: null };
  S.sim = sim;
  const simAt = () => P.addMin(G.TODAY + 'T09:00:00', sim.clock);
  const DEVICES = [['WEB', 'Navegador web · Chrome en Windows'], ['ANDROID_OK', 'App móvil · celular aprobado'], ['ANDROID_NEW', 'App móvil · celular nuevo']];
  function simDevice(email) {
    const u = D.find('users', x => lower(x.email) === lower(email));
    if (sim.device === 'WEB') return { client: 'WEB', ua: 'Chrome 129 · Windows' };
    if (sim.device === 'ANDROID_OK') { const d = u && D.find('user_devices', x => x.user_id === u.id && x.status === 'APPROVED' && x.platform !== 'WEB'); return { client: 'ANDROID', ua: 'App Aycha 1.4 · Android', fingerprint: d ? d.fingerprint_hint : 'fp-sim-' + lower(email), device_name: d ? d.name : 'Celular' }; }
    return { client: 'ANDROID', ua: 'App Aycha 1.4 · Android', fingerprint: 'fp-sim-nuevo-' + lower(email), device_name: 'Celular nuevo (simulador)' };
  }
  function frame(inner) {
    const th = P.themeFor('br-DG') || {}; const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); const t = (dark ? th.dark : th.light) || {};
    let hostOk = null; try { P.resolveHost(sim.host); } catch (e) { hostOk = e.message; }
    return h('div', { style: `border:1px solid var(--line);border-radius:12px;overflow:hidden;min-width:0;align-self:start;background:${t.background}` },
      h('div', { style: 'display:flex;gap:8px;align-items:center;padding:6px 10px;background:var(--surface-2);border-bottom:1px solid var(--line);font-size:.8rem' }, h('span', { class: 'mono', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, 'https://' + sim.host + '/ingresar'), h('span', { class: 'muted', style: 'margin-left:auto' }, F.datetime(simAt()))),
      h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))' },
        h('div', { style: `background:${(th.light || t).primary};color:${(th.light || t).on_primary};padding:22px;display:grid;gap:10px;align-content:start` }, h('span', { style: `width:46px;height:46px;border-radius:50%;display:grid;place-items:center;background:${(th.light || t).accent};color:${(th.light || t).primary_dark};font-weight:800` }, 'DG'), h('b', { style: 'font-size:1.5rem;line-height:1' }, 'Don Guando'), h('span', { style: 'font-size:.85rem;opacity:.9' }, 'Comercial · ventas, reparto y producción'), h('span', { style: 'font-size:.75rem;opacity:.75' }, 'Colores de la marca principal (PLT-06)')),
        h('div', { style: `padding:22px;display:grid;gap:12px;align-content:start;background:${t.surface};color:${t.text};min-width:0` }, hostOk ? notice(hostOk, 'bad') : inner)));
  }
  function msgBox() { return sim.msg ? h('div', { class: 'notice ' + sim.tone, attrs: { role: 'alert' } }, h('div', null, sim.msg.replace(/^RN-SEG-19: /, ''), /^RN-/.test(sim.msg) ? h('div', { class: 'small muted mono' }, sim.msg.split(':')[0]) : null)) : null; }
  function controls() {
    const host = h('input', { class: 'input mono', value: sim.host, attrs: { id: 'seg-host', 'aria-label': 'Dominio' } }); host.addEventListener('change', () => { sim.host = host.value.trim(); G.refresh(); });
    const ip = h('input', { class: 'input mono', value: sim.ip, attrs: { id: 'seg-ip', 'aria-label': 'IP' } }); ip.addEventListener('change', () => { sim.ip = ip.value.trim(); });
    const dev = h('select', { class: 'input', attrs: { id: 'seg-dev', 'aria-label': 'Dispositivo' } }, DEVICES.map(([v, l]) => h('option', { value: v, selected: sim.device === v }, l))); dev.addEventListener('change', () => { sim.device = dev.value; });
    const chips = [['Gerente (2FA)', 'GERENTE'], ['Supervisora (debe activar 2FA)', 'SUPERVISORA_VENTAS'], ['Vendedora', 'VENDEDORA'], ['Repartidor', 'REPARTIDOR']].map(([l, role]) => { const u = D.find('users', x => x.role === role && x.status !== 'INACTIVE'); return u ? btn(l, () => { sim.email = u.email; sim.msg = null; sim.device = role === 'REPARTIDOR' ? 'ANDROID_OK' : 'WEB'; G.go('SEG-01'); }, { sm: true }) : null; });
    return card('Condiciones de la prueba', h('div', { class: 'stack' },
      h('div', { class: 'stack', style: 'gap:8px' }, h('div', { class: 'field' }, h('label', { attrs: { for: 'seg-host' } }, 'Dominio (RN-PLT-19)'), host), h('div', { class: 'field' }, h('label', { attrs: { for: 'seg-ip' } }, 'IP'), ip), h('div', { class: 'field' }, h('label', { attrs: { for: 'seg-dev' } }, 'Dispositivo'), dev)),
      h('div', { class: 'row' }, h('span', { class: 'small muted' }, `Reloj simulado: ${F.datetime(simAt())}`), btn('+15 min', () => { sim.clock += 15; G.refresh(); }, { sm: true }), btn('+31 min', () => { sim.clock += 31; G.refresh(); }, { sm: true }), sim.clock ? btn('Volver a las 09:00', () => { sim.clock = 0; G.refresh(); }, { sm: true, kind: 'ghost' }) : null),
      h('div', { class: 'row' }, h('span', { class: 'small muted' }, `Usuarios de prueba (contraseña ${DEMO_PWD}):`), chips)));
  }
  function logCard(email) {
    const e = lower(email); const rows = D.all('access_log').filter(x => !e || lower(x.email_attempted) === e).sort(U.by('occurred_at', -1)).slice(0, 10);
    return card('Bitácora de accesos de este correo (AUD-03)', rows.length ? table({ id: 'seg-sim-log', search: false, pageSize: 10, rows, columns: [{ key: 'occurred_at', label: 'Hora', render: x => F.datetime(x.occurred_at) }, { key: 'event', label: 'Evento', render: x => badge(evName(x.event), /FAILED|LOCKED|DENIED|BLOCKED/.test(x.event) ? 'bad' : /OK|APPROVED|ENROLLED|RESET$/.test(x.event) ? 'ok' : '') }, { key: 'ip', label: 'IP', mono: true }, { key: 'user_agent', label: 'Dispositivo' }] }) : G.ui.empty('Sin intentos registrados.'));
  }
  function simPage(el, code, sub, inner, email) {
    const body = page(el, { code, title: G.screens[code].name, sub, actions: [{ label: 'Reiniciar simulador', onClick: () => { Object.assign(sim, { clock: 0, msg: null, session_id: null, result: null, token: null, enroll: null, codes: null, forgot: null }); G.refresh(); } }] });
    body.appendChild(h('div', { class: 'grid side-r' }, frame(inner), controls()));
    body.appendChild(logCard(email !== undefined ? email : sim.email));
    return body;
  }
  function loginScreen(el) {
    const email = h('input', { class: 'input', type: 'email', value: sim.email, placeholder: 'tu.correo@donguando.pe', attrs: { id: 'seg01-email', autocomplete: 'off' } });
    const pwd = h('input', { class: 'input', type: 'password', placeholder: '••••••••••', attrs: { id: 'seg01-pwd', autocomplete: 'off' } });
    const fm = h('form', { class: 'stack', attrs: { novalidate: true } }, h('h2', null, 'Iniciar sesión'), h('p', { class: 'small', style: 'opacity:.8' }, 'Ingresa con el correo que te registró el administrador.'), msgBox(),
      h('div', { class: 'field' }, h('label', { attrs: { for: 'seg01-email' } }, 'Correo'), email), h('div', { class: 'field' }, h('label', { attrs: { for: 'seg01-pwd' } }, 'Contraseña'), pwd),
      h('div', { class: 'row between' }, h('button', { type: 'button', class: 'linklike', on: { click: () => { sim.email = email.value; sim.msg = null; G.go('SEG-04'); } } }, 'Olvidé mi contraseña'), h('button', { type: 'button', class: 'linklike small', on: { click: () => { pwd.value = DEMO_PWD; } } }, 'Usar contraseña de demo')),
      h('button', { class: 'btn primary', type: 'submit', style: 'justify-content:center' }, 'Ingresar'));
    fm.addEventListener('submit', e => {
      e.preventDefault(); sim.email = email.value;
      try {
        const d = simDevice(email.value);
        const r = S.login(Object.assign({ email: email.value, password: pwd.value, ip: sim.ip, at: simAt() }, d));
        sim.msg = null; sim.session_id = r.session.id; sim.result = r.status;
        if (r.status === 'MFA_REQUIRED') return G.go('SEG-02');
        if (r.status === 'MFA_ENROLL') { sim.enroll = S.startEnroll(r.user.id); return G.go('SEG-03', { user: r.user.id }); }
        G.refresh();
      } catch (err) { sim.msg = err.message; sim.tone = /RN-SEG-04|RN-SEG-11/.test(err.message) ? 'warn' : 'bad'; sim.result = null; sim.session_id = null; G.refresh(); }
    });
    const s = sim.result === 'OK' && D.get('user_sessions', sim.session_id);
    const inner = s ? h('div', { class: 'stack' }, notice([h('b', null, 'Sesión activa. '), `Bienvenida/o, ${G.userName(s.user_id)}.`], 'ok'), dl([['Sesión', h('span', { class: 'mono' }, s.id)], ['Cliente', s.client], ['IP', s.ip], ['Vence', F.datetime(s.expires_at)], ['Estado', sb(s.status)]]), h('div', { class: 'row' }, btn('Entrar de verdad con este usuario', () => { const u = userOf(s.user_id); if (u && u.status === 'ACTIVE') G.auth.start(u, { via: 'demo' }); }, { kind: 'primary', sm: true }), btn('Probar otro inicio', () => { sim.result = null; sim.session_id = null; G.refresh(); }, { sm: true }))) : fm;
    simPage(el, 'SEG-01', 'Simulador del inicio de sesión real (G.auth y G.seg.login) sobre el dominio de la empresa. El error es siempre el mismo y no revela si el correo existe (RN-SEG-19); 5 fallos seguidos bloquean 15 minutos aunque luego la contraseña sea correcta (RN-SEG-04).', inner);
  }
  function mfaScreen(el) {
    const s = sim.session_id && D.get('user_sessions', sim.session_id); const pending = s && s.status === 'PENDING_MFA'; const u = s && userOf(s.user_id);
    let inner;
    if (!pending || !u || !u.twofa_enabled) inner = h('div', { class: 'stack' }, h('h2', null, 'Verificación en dos pasos'), notice('No hay un inicio de sesión esperando el segundo factor. Inicia sesión con un usuario cuyo rol lo exige (RN-SEG-05).', 'info'), btn('Iniciar como la gerente para probar', () => { const g = D.find('users', x => x.role === 'GERENTE'); sim.email = g.email; try { const r = S.login({ email: g.email, password: DEMO_PWD, ip: sim.ip, at: simAt() }); sim.session_id = r.session.id; sim.result = r.status; sim.msg = null; } catch (e) { sim.msg = e.message; } G.refresh(); }, { kind: 'primary', sm: true }));
    else {
      const code = h('input', { class: 'input mono', inputmode: 'numeric', maxlength: 9, placeholder: '000000 o XXXX-XXXX', attrs: { id: 'seg02-code', autocomplete: 'off', 'aria-label': 'Código' }, style: 'font-size:1.3rem;letter-spacing:.2em;text-align:center' });
      const fm = h('form', { class: 'stack', attrs: { novalidate: true } }, h('h2', null, 'Verificación en dos pasos'), h('p', { class: 'small' }, `Hola, ${u.name.split(' ')[0]}. Escribe el código de 6 dígitos de tu aplicación autenticadora o uno de tus códigos de recuperación.`), msgBox(), code,
        h('div', { class: 'login-totp' }, h('span', { class: 'small muted' }, 'Aplicación autenticadora (simulada)'), h('b', { class: 'mono' }, A().totp(u)), h('span', { class: 'small muted' }, 'Aycha · ' + u.email)),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Verificar e ingresar'), btn('Cancelar', () => { S.revokeSession(s.id, 'Cancelado en el segundo factor', { at: simAt() }); sim.session_id = null; sim.msg = null; G.go('SEG-01'); }, { kind: 'ghost' })));
      fm.addEventListener('submit', e => { e.preventDefault(); try { S.verifyMfa(s.id, code.value, { at: simAt() }); sim.result = 'OK'; sim.msg = null; toast('Segundo factor verificado: sesión activa', 'ok'); G.go('SEG-01'); } catch (err) { sim.msg = err.message; sim.tone = 'bad'; G.refresh(); } });
      inner = h('div', { class: 'stack' }, fm, dl([['Sesión', h('span', null, h('span', { class: 'mono' }, s.id), ' ', sb(s.status))], ['Tolerancia', `±${pMin('seg_totp_window_steps', 1)} paso de 30 s; un mismo código no vale dos veces (RN-SEG-06)`], ['Códigos de recuperación', `${D.where('mfa_recovery_codes', x => x.user_id === u.id && !x.used_at && !x.voided_at).length} disponibles (RN-SEG-07)`]]));
    }
    simPage(el, 'SEG-02', 'Pide el código TOTP de 6 dígitos (RFC 6238) o un código de recuperación. Sin este paso la sesión queda en «falta 2FA» y no da acceso (RN-SEG-05).', inner, u ? u.email : sim.email);
  }
  function enrollScreen(el, params) {
    const uid = params.user || (sim.enroll && sim.enroll.user_id) || (me() || {}).id; const u = userOf(uid);
    if (u && (!sim.enroll || sim.enroll.user_id !== u.id) && !u.twofa_enabled) sim.enroll = S.startEnroll(u.id);
    let inner;
    if (sim.codes && sim.codes.user_id === uid) inner = h('div', { class: 'stack' }, h('h2', null, 'Guarda tus códigos de recuperación'), notice(`Segundo factor activo para ${u.name}. Cada código sirve una sola vez; si generas otro lote, estos dejan de servir (RN-SEG-07).`, 'ok'), h('div', { class: 'grid c2', style: 'font-family:var(--font-mono);font-size:1.05rem' }, sim.codes.list.map(c => h('div', { style: 'padding:6px 10px;border:1px dashed var(--line);border-radius:6px;text-align:center' }, c))), h('div', { class: 'row' }, btn('Imprimir', () => G.print(), { sm: true }), btn('Ya los guardé', () => { sim.codes = null; G.go(D.find('user_sessions', x => x.id === sim.session_id && x.status === 'ACTIVE') ? 'SEG-01' : 'SEG-06'); }, { kind: 'primary', sm: true })));
    else if (!u) inner = notice('Elige un usuario.', 'info');
    else if (u.twofa_enabled) inner = h('div', { class: 'stack' }, h('h2', null, 'Segundo factor activo'), dl([['Usuario', u.name], ['Activado', F.datetime(u.mfa_enrolled_at)], ['Códigos disponibles', D.where('mfa_recovery_codes', x => x.user_id === u.id && !x.used_at && !x.voided_at).length]]), h('div', { class: 'row' }, btn('Generar códigos nuevos', () => { if (u.id !== (me() || {}).id && !can('seg.user.reset_mfa')) return toast('RN-SEG-12: solo el propio usuario genera sus códigos.', 'warn'); const list = run(() => S.regenCodes(u.id)); if (Array.isArray(list)) { sim.codes = { user_id: u.id, list }; G.refresh(); } }, { sm: true })));
    else {
      const code = h('input', { class: 'input mono', inputmode: 'numeric', maxlength: 6, placeholder: '000000', attrs: { id: 'seg03-code', 'aria-label': 'Código' }, style: 'font-size:1.3rem;letter-spacing:.3em;text-align:center' });
      const fm = h('form', { class: 'stack', attrs: { novalidate: true } }, h('h2', null, 'Activa el segundo factor'), h('p', { class: 'small' }, `${u.name}: tu rol (${S.roleLabel(u.role)}) ${S.isMfaRole(u.role) ? 'lo exige en el primer ingreso (RN-SEG-05)' : 'no lo exige, pero puedes activarlo'}. Escanea el QR con Google Authenticator u otra aplicación y escribe el código.`), msgBox(),
        h('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;align-items:center' }, h('div', { style: 'background:#fff;padding:6px;border-radius:6px' }, G.ui.qr(sim.enroll.uri, 140)), h('div', { class: 'small', style: 'min-width:0' }, h('div', null, 'Clave manual:'), h('b', { class: 'mono', style: 'word-break:break-all' }, sim.enroll.secret.replace(/(.{4})/g, '$1 ').trim()), h('div', { class: 'muted' }, 'Se guarda cifrada (RN-SEG-06).'))),
        code, h('div', { class: 'login-totp' }, h('span', { class: 'small muted' }, 'Aplicación autenticadora (simulada)'), h('b', { class: 'mono' }, A().totp(u))), h('button', { class: 'btn primary', type: 'submit' }, 'Confirmar y activar'));
      fm.addEventListener('submit', e => { e.preventDefault(); try { const list = S.confirmEnroll(sim.enroll, code.value, { at: simAt(), sessionId: sim.session_id && D.get('user_sessions', sim.session_id) && D.get('user_sessions', sim.session_id).user_id === u.id ? sim.session_id : null }); sim.codes = { user_id: u.id, list }; sim.enroll = null; sim.msg = null; if (sim.session_id && D.get('user_sessions', sim.session_id).status === 'ACTIVE') sim.result = 'OK'; G.refresh(); } catch (err) { sim.msg = err.message; sim.tone = 'bad'; G.refresh(); } });
      inner = fm;
    }
    const body = simPage(el, 'SEG-03', 'Muestra el QR del secreto, pide confirmar con un código y entrega 10 códigos de recuperación para guardar o imprimir. Es obligatoria en el primer ingreso de los roles que exigen segundo factor.', inner, u ? u.email : '');
    const pend = D.where('users', x => x.status === 'ACTIVE' && S.requiresMfa(x) && !x.twofa_enabled);
    body.appendChild(card('Usuarios que deben activarlo (RN-SEG-05)', pend.length ? h('div', { class: 'row' }, pend.map(x => { const b = btn(`${x.name} · ${S.roleLabel(x.role)}`, () => { sim.enroll = null; sim.codes = null; G.go('SEG-03', { user: x.id }); }, { sm: true }); b.style.whiteSpace = 'normal'; b.style.textAlign = 'left'; return b; })) : notice('Todos los roles que lo exigen ya lo activaron.', 'ok')));
  }
  function forgotScreen(el) {
    const email = h('input', { class: 'input', type: 'email', value: sim.email, attrs: { id: 'seg04-email', autocomplete: 'off' } });
    const fm = h('form', { class: 'stack', attrs: { novalidate: true } }, h('h2', null, 'Olvidé mi contraseña'), h('p', { class: 'small' }, `Te enviaremos un enlace para crear una nueva contraseña. Vence en ${pMin('seg_reset_token_minutes', 30)} minutos y sirve una sola vez.`), msgBox(), h('div', { class: 'field' }, h('label', { attrs: { for: 'seg04-email' } }, 'Correo'), email), h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Enviar enlace'), btn('Volver', () => G.go('SEG-01'), { kind: 'ghost' })));
    fm.addEventListener('submit', e => { e.preventDefault(); sim.email = email.value; if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email.value.trim())) { sim.msg = 'Escribe un correo válido.'; sim.tone = 'bad'; return G.refresh(); } const r = S.forgot(email.value, { ip: sim.ip, at: simAt() }); sim.forgot = { email: lower(email.value), message: r.message, token: r.token, at: simAt() }; sim.token = r.token || sim.token; sim.msg = null; G.refresh(); });
    const inner = sim.forgot ? h('div', { class: 'stack' }, h('h2', null, 'Revisa tu correo'), notice(sim.forgot.message, 'info'), h('p', { class: 'small muted' }, 'El mensaje es el mismo exista o no la cuenta (RN-SEG-19).'), btn('Volver al inicio de sesión', () => { sim.forgot = null; G.go('SEG-01'); }, { sm: true })) : fm;
    const body = simPage(el, 'SEG-04', 'Pide el correo y siempre responde «Si el correo existe, te enviamos un enlace». Pedir otro enlace anula el anterior (RN-SEG-08).', inner);
    if (sim.forgot) body.appendChild(card('Bandeja de correo simulada (conector EMAIL de INT)', sim.forgot.token ? h('div', { class: 'stack' }, dl([['Para', sim.forgot.email], ['Asunto', 'Crea tu nueva contraseña · Don Guando'], ['Enviado', F.datetime(sim.forgot.at)], ['Vence', F.datetime(P.addMin(sim.forgot.at, pMin('seg_reset_token_minutes', 30)))], ['Enlace', h('span', { class: 'mono small', style: 'word-break:break-all' }, `https://${sim.host}/restablecer?t=${sim.forgot.token}`)]]), btn('Abrir el enlace', () => G.go('SEG-05', { token: sim.forgot.token }), { kind: 'primary', sm: true })) : notice('No se envió ningún correo: ese correo no corresponde a un usuario activo. La pantalla mostró el mismo mensaje.', 'info')));
  }
  function newPwdScreen(el, params) {
    const token = params.token || sim.token; const t = token && S.tokenInfo(token); const u = t && userOf(t.user_id);
    let inner;
    if (!t) inner = h('div', { class: 'stack' }, h('h2', null, 'Nueva contraseña'), notice('Abre esta pantalla desde el enlace del correo (SEG-04).', 'info'), btn('Pedir un enlace', () => G.go('SEG-04'), { sm: true }));
    else {
      const p1 = h('input', { class: 'input', type: 'password', attrs: { id: 'seg05-p1', autocomplete: 'new-password' } }); const p2 = h('input', { class: 'input', type: 'password', attrs: { id: 'seg05-p2', autocomplete: 'new-password' } });
      const list = h('div', { class: 'stack', style: 'gap:2px' });
      const draw = () => { G.ui.clear(list); for (const c of S.policyChecks(p1.value, u)) list.appendChild(h('div', { class: 'small' }, badge(c.ok ? 'Sí' : 'No', c.ok ? 'ok' : 'warn'), ' ', c.label)); list.appendChild(h('div', { class: 'small' }, badge(p1.value && p1.value === p2.value ? 'Sí' : 'No', p1.value && p1.value === p2.value ? 'ok' : 'warn'), ' Las dos coinciden')); };
      p1.addEventListener('input', draw); p2.addEventListener('input', draw);
      const fm = h('form', { class: 'stack', attrs: { novalidate: true } }, h('h2', null, 'Nueva contraseña'), h('p', { class: 'small' }, `Para ${u.email}. El enlace vence ${F.datetime(t.expires_at)}.`), msgBox(), h('div', { class: 'field' }, h('label', { attrs: { for: 'seg05-p1' } }, 'Nueva contraseña'), p1), h('div', { class: 'field' }, h('label', { attrs: { for: 'seg05-p2' } }, 'Repite la contraseña'), p2), list, h('button', { class: 'btn primary', type: 'submit' }, 'Guardar y cerrar mis otras sesiones'));
      fm.addEventListener('submit', e => { e.preventDefault(); try { const r = S.reset(token, p1.value, p2.value, { at: simAt(), ip: sim.ip }); sim.msg = `Contraseña actualizada. Se cerraron ${r.closed} sesión(es) anteriores. Ingresa con la nueva.`; sim.tone = 'ok'; sim.email = u.email; sim.token = null; sim.forgot = null; G.go('SEG-01'); } catch (err) { sim.msg = err.message; sim.tone = 'bad'; G.refresh(); } });
      draw(); inner = fm;
    }
    const body = simPage(el, 'SEG-05', 'Desde el enlace del correo: pide la contraseña nueva dos veces y muestra la política (largo, letras y números, no repetir las 5 anteriores). Al guardar se cierran todas las sesiones del usuario (RN-SEG-08).', inner, u ? u.email : '');
    if (t) body.appendChild(card('Estado del enlace', dl([['Pedido', F.datetime(t.requested_at)], ['Vence', F.datetime(t.expires_at)], ['Reloj simulado', F.datetime(simAt()) + (simAt() > t.expires_at ? ' · vencido' : ' · vigente')], ['Usado', t.used_at ? F.datetime(t.used_at) : 'No'], ['Reemplazado por otro', t.voided_at ? 'Sí' : 'No']])));
  }

  /* ---- SEG-06 Mi cuenta ---- */
  function accountScreen(el) {
    const u = me();
    const body = page(el, { code: 'SEG-06', title: 'Mi cuenta', sub: 'Tus datos, contraseña, segundo factor, marca por defecto, modo de color y avisos. Todo queda en la bitácora de accesos.' });
    if (!u) { body.appendChild(notice('No hay un usuario asociado a esta sesión.', 'warn')); return; }
    body.appendChild(kpis([{ label: 'Rol', value: S.roleLabel(u.role), sub: S.isMfaRole(u.role) ? 'exige segundo factor' : '' }, { label: 'Segundo factor', value: u.twofa_enabled ? 'Activo' : 'No activo', tone: u.twofa_enabled ? 'ok' : (S.isMfaRole(u.role) ? 'bad' : ''), onClick: () => G.go('SEG-03', { user: u.id }) }, { label: 'Sesiones abiertas', value: S.activeSessions(u.id).length, sub: `máximo ${pMin('seg_max_concurrent_sessions', 3)}`, onClick: () => G.go('SEG-07') }, { label: 'Contraseña cambiada', value: F.date(u.password_changed_at), sub: pMin('seg_password_max_age_days', 0) ? `vence a los ${pMin('seg_password_max_age_days', 0)} días` : 'no vence (RN-SEG-02)' }]));
    const emp = u.employee_id && D.get('employees', u.employee_id);
    body.appendChild(h('div', { class: 'grid c2' },
      card('Mis datos', dl([['Nombre', u.name], ['Correo', u.email], ['Rol', S.roleLabel(u.role)], ['Alcance', scopeText(u)], ['Trabajador', emp ? `${emp.full_name} · ${emp.position}` : '—'], ['Último ingreso', F.datetime(u.last_login)], ['Idioma', u.locale || 'es-PE']])),
      card('Preferencias', form({ id: 'seg06p', values: { default_brand_id: u.default_brand_id || '', ui_theme_mode: u.ui_theme_mode || 'SYSTEM', n_email: (u.notify_prefs || {}).email !== false, n_push: !!(u.notify_prefs || {}).push, n_daily: !!(u.notify_prefs || {}).daily_summary }, submitLabel: 'Guardar preferencias',
        fields: [{ key: 'default_brand_id', label: 'Marca por defecto', type: 'select', options: G.scope.brands().filter(b => b.status === 'ACTIVE').map(b => [b.id, b.name]) }, { key: 'ui_theme_mode', label: 'Modo de color', type: 'select', required: true, options: [['LIGHT', 'Claro'], ['DARK', 'Oscuro'], ['SYSTEM', 'El del sistema']] }, { key: 'n_email', label: 'Avisos por correo', type: 'checkbox' }, { key: 'n_push', label: 'Notificaciones push en el celular', type: 'checkbox' }, { key: 'n_daily', label: 'Resumen diario', type: 'checkbox' }],
        onSubmit: v => { D.update('users', u.id, { default_brand_id: v.default_brand_id || null, ui_theme_mode: v.ui_theme_mode, notify_prefs: { email: !!v.n_email, push: !!v.n_push, daily_summary: !!v.n_daily } }); G.ctx.theme = { LIGHT: 'light', DARK: 'dark', SYSTEM: 'system' }[v.ui_theme_mode]; if (v.default_brand_id && G.scope.brands().some(b => b.id === v.default_brand_id)) G.ctx.brand = v.default_brand_id; D.save(); toast('Preferencias guardadas', 'ok'); G.render(); return true; } }))));
    const list = h('div', { class: 'stack', style: 'gap:2px' }); let pf;
    const draw = () => { G.ui.clear(list); const v = pf.api.values; for (const c of S.policyChecks(v.p1 || '', u)) list.appendChild(h('div', { class: 'small' }, badge(c.ok ? 'Sí' : 'No', c.ok ? 'ok' : 'warn'), ' ', c.label)); };
    pf = form({ id: 'seg06c', values: {}, submitLabel: 'Cambiar contraseña', fields: [{ key: 'cur', label: 'Contraseña actual', type: 'password', required: true }, { key: 'p1', label: 'Nueva contraseña', type: 'password', required: true, onChange: () => draw() }, { key: 'p2', label: 'Repite la nueva', type: 'password', required: true }],
      onSubmit: v => { try { S.changePassword(u.id, v.cur, v.p1, v.p2); } catch (e) { return e.message; } toast('Contraseña cambiada', 'ok'); G.refresh(); return true; } });
    const codesLeft = D.where('mfa_recovery_codes', x => x.user_id === u.id && !x.used_at && !x.voided_at).length;
    body.appendChild(h('div', { class: 'grid c2' }, card('Cambiar contraseña', h('div', { class: 'stack' }, pf, list)),
      card('Segundo factor', h('div', { class: 'stack' }, dl([['Estado', u.twofa_enabled ? badge('Activo', 'ok') : badge(S.isMfaRole(u.role) ? 'Obligatorio y no activo' : 'No activo', S.isMfaRole(u.role) ? 'bad' : '')], ['Activado', F.datetime(u.mfa_enrolled_at)], ['Códigos de recuperación disponibles', codesLeft]]),
        h('div', { class: 'row' }, u.twofa_enabled ? btn('Generar códigos nuevos', () => { const list2 = run(() => S.regenCodes(u.id)); if (Array.isArray(list2)) { sim.codes = { user_id: u.id, list: list2 }; G.go('SEG-03', { user: u.id }); } }, { sm: true }) : btn('Activar segundo factor', () => { sim.enroll = null; sim.codes = null; G.go('SEG-03', { user: u.id }); }, { sm: true, kind: 'primary' })), h('p', { class: 'small muted' }, 'Generar códigos nuevos anula los anteriores (RN-SEG-07). Para reiniciarlo pide al administrador (SEG-09).')))));
    draw();
  }

  /* ---- SEG-07 Mis sesiones y dispositivos ---- */
  function ensureCurrent(u) {
    const s = G.ctx.session; if (!s || !u) return null;
    const key = tokenHash('cur:' + s.user_id + s.at);
    return D.find('user_sessions', x => x.token_hash === key) || D.insert('user_sessions', { user_id: u.id, device_id: null, token_hash: key, ip: '190.42.10.20', user_agent: (navigator.userAgent.match(/(Chrome|Firefox|Safari|Edg)\/[\d.]+/) || ['Navegador'])[0].replace('Edg', 'Edge'), client: 'WEB', status: 'ACTIVE', mfa_verified_at: u.twofa_enabled ? s.at : null, started_at: s.at.slice(0, 19), last_seen_at: now(), expires_at: P.addMin(s.at.slice(0, 19).length === 16 ? s.at + ':00' : s.at.slice(0, 19), pMin('seg_session_max_hours', 12) * 60), current: true }, { silent: true });
  }
  function sessionsTable(rows, opts = {}) {
    return table({ id: opts.id || 'seg-ses', rows, search: !!opts.search, pageSize: opts.pageSize || 15, filters: opts.filters,
      columns: [opts.user ? { key: 'user', label: 'Usuario', value: s => G.userName(s.user_id) } : null, { key: 'client', label: 'Cliente', value: s => s.client === 'WEB' ? 'Web' : 'App ' + s.client.toLowerCase() }, { key: 'user_agent', label: 'Dispositivo', value: s => { const d = s.device_id && D.get('user_devices', s.device_id); return d ? d.name : s.user_agent; } }, { key: 'ip', label: 'IP', mono: true }, { key: 'started_at', label: 'Inicio', render: s => F.datetime(s.started_at) }, { key: 'last_seen_at', label: 'Última actividad', value: s => s.last_seen_at, render: s => F.datetime(s.last_seen_at) }, { key: 'expires_at', label: 'Vence', render: s => F.datetime(s.expires_at) }, { key: 'status', label: 'Estado', render: s => h('span', null, sb(s.status), s.current ? ' ' : null, s.current ? badge('esta sesión', 'info') : null) }].filter(Boolean),
      actions: opts.actions });
  }
  function mySessionsScreen(el) {
    const u = me(); const cur = ensureCurrent(u);
    const body = page(el, { code: 'SEG-07', title: 'Mis sesiones y dispositivos', sub: `Sesiones abiertas con su dispositivo, IP y última actividad. Máximo ${pMin('seg_max_concurrent_sessions', 3)} a la vez: al abrir otra se cierra la de uso más antiguo (RN-SEG-10). La web vence a los ${pMin('seg_session_idle_minutes', 30)} min sin uso o a las ${pMin('seg_session_max_hours', 12)} h; la app, a los ${pMin('seg_mobile_session_days', 7)} días (RN-SEG-09).`, actions: [{ label: 'Cerrar todas las demás', kind: 'danger', onClick: () => { if (!u) return; const n = S.revokeAll(u.id, 'Cerrada por el usuario («cerrar todas las demás»)', { exceptId: cur && cur.id }); toast(`${n} sesión(es) cerrada(s)`, 'ok'); G.refresh(); } }] });
    if (!u) return;
    const act = D.where('user_sessions', s => s.user_id === u.id && ['ACTIVE', 'PENDING_MFA'].includes(s.status)).sort(U.by('last_seen_at', -1));
    const old = D.where('user_sessions', s => s.user_id === u.id && !['ACTIVE', 'PENDING_MFA'].includes(s.status)).sort(U.by('started_at', -1));
    const devs = D.where('user_devices', d => d.user_id === u.id);
    body.appendChild(kpis([{ label: 'Abiertas', value: act.length, sub: `de ${pMin('seg_max_concurrent_sessions', 3)} permitidas`, tone: act.length > pMin('seg_max_concurrent_sessions', 3) ? 'bad' : 'ok' }, { label: 'Dispositivos', value: devs.length, sub: `${devs.filter(d => d.status === 'APPROVED').length} aprobados` }, { label: 'Último ingreso', value: F.datetime(u.last_login) }]));
    body.appendChild(card('Sesiones abiertas', sessionsTable(act, { id: 'seg07-a', actions: s => s.current ? [] : [btn('Cerrar', () => run(() => S.revokeSession(s.id, 'Cerrada por el usuario'), 'Sesión cerrada'), { sm: true })] })));
    body.appendChild(card('Dispositivos registrados', devs.length ? table({ id: 'seg07-d', rows: devs, search: false, columns: [{ key: 'name', label: 'Dispositivo' }, { key: 'platform', label: 'Plataforma' }, { key: 'status', label: 'Estado', render: d => sb(d.status, 'device') }, { key: 'last_seen_at', label: 'Último uso', render: d => F.datetime(d.last_seen_at) }, { key: 'approved_by', label: 'Aprobado por', value: d => d.approved_by ? G.userName(d.approved_by) : '—' }] }) : G.ui.empty('Sin dispositivos registrados: la web no exige aprobar el equipo (D-SEG-03).')));
    body.appendChild(card('Sesiones anteriores', sessionsTable(old.slice(0, 20), { id: 'seg07-o' })));
  }

  /* ---- SEG-08 Usuarios ---- */
  function userForm() {
    drawer('Invitar usuario', (bd, close) => {
      const hint = h('div', { class: 'small' });
      const f = form({ id: 'seg08n', values: { role: 'VENDEDORA' }, submitLabel: 'Crear e invitar por correo', onCancel: close,
        fields: [{ key: 'name', label: 'Nombre completo', required: true }, { key: 'email', label: 'Correo', required: true, help: 'Único en la empresa sin distinguir mayúsculas; se guarda en minúsculas (RN-SEG-01).' }, { key: 'role', label: 'Rol', type: 'select', required: true, options: S.allRoles().filter(r => r[0] !== 'SOPORTE_PLATAFORMA'), onChange: v => { G.ui.clear(hint).appendChild(notice(`${S.roleLabel(v)}: alcance ${S.scopeMode(v) === 'ASSIGNED' ? 'asignado (elige al menos una marca o un local, RN-SEG-13)' : 'total'}${S.isMfaRole(v) ? ' · exige segundo factor' : ''}.`, 'info')); } },
          { key: 'employee_id', label: 'Trabajador vinculado', type: 'select', options: D.all('employees').filter(e => e.status === 'ACTIVE' && !D.find('users', u => u.employee_id === e.id)).map(e => [e.id, `${e.full_name} · ${e.position}`]) }]
          .concat(D.all('brands').filter(b => b.status === 'ACTIVE').map(b => ({ key: 'b_' + b.id, label: 'Marca: ' + b.name, type: 'checkbox' }))).concat(D.all('establishments').map(e => ({ key: 's_' + e.id, label: 'Local: ' + (e.short || e.name), type: 'checkbox' }))),
        onSubmit: v => { const brands = Object.keys(v).filter(k => k.startsWith('b_') && v[k]).map(k => k.slice(2)); const sites = Object.keys(v).filter(k => k.startsWith('s_') && v[k]).map(k => k.slice(2)); try { const r = S.createUser({ name: v.name, email: v.email, role: v.role, employee_id: v.employee_id, brands, sites }); toast(`Usuario creado. Invitación enviada a ${r.user.email}`, 'ok'); close(); G.go('SEG-09', { id: r.user.id }); } catch (e) { return e.message; } return true; } });
      bd.append(hint, f);
    }, { code: 'SEG-08' });
  }
  function usersScreen(el) {
    const body = page(el, { code: 'SEG-08', title: 'Usuarios', sub: 'Rol, alcance, estado, segundo factor y último ingreso de cada persona. Los usuarios no se borran: se desactivan (RN-SEG-17) y eso cierra su acceso al instante (RN-SEG-18).', actions: [{ label: 'Invitar usuario', kind: 'primary', onClick: guard('seg.user.manage', userForm) }] });
    const us = D.where('users', u => !u.platform);
    const k1 = G.kpi('KPI-SEG-01') || {}; const k3 = G.kpi('KPI-SEG-03') || {};
    body.appendChild(kpis([{ label: 'Activos', value: us.filter(u => u.status === 'ACTIVE').length, sub: `${us.length} en total` }, { label: 'Bloqueados', value: us.filter(u => u.status === 'LOCKED').length, tone: us.some(u => u.status === 'LOCKED') ? 'bad' : 'ok' }, { label: 'Inactivos', value: us.filter(u => u.status === 'INACTIVE').length }, { label: 'KPI-SEG-01 · cobertura 2FA', value: F.pct(k1.value, 0), sub: `${k1.numerator} de ${k1.denominator} que lo exigen`, tone: k1.value >= 100 ? 'ok' : 'warn' }, { label: 'KPI-SEG-03 · sin uso', value: k3.value, sub: `activos sin ingresar en ${pMin('seg_inactive_user_days', 60)} días`, tone: k3.value ? 'warn' : 'ok' }]));
    body.appendChild(table({ id: 'seg08', rows: us, pageSize: 40, onRow: u => G.go('SEG-09', { id: u.id }),
      filters: [{ key: 'role', label: 'Rol', options: S.allRoles() }, { key: 'site', label: 'Local', value: u => (u.sites || [])[0] || 'ALL', options: [['ALL', 'Todos (sin asignar)']].concat(D.all('establishments').map(e => [e.id, e.short])) }, { key: 'brand', label: 'Marca', value: u => (u.brands || []).join(','), options: [...new Set(us.map(u => (u.brands || []).join(',')).filter(Boolean))].map(k => [k, k.split(',').map(G.brandName).join(' + ')]) }, { key: 'status', label: 'Estado', options: [['ACTIVE', 'Activo'], ['LOCKED', 'Bloqueado'], ['INACTIVE', 'Inactivo']] }],
      columns: [{ key: 'name', label: 'Nombre' }, { key: 'email', label: 'Correo', mono: true }, { key: 'role', label: 'Rol', value: u => S.roleLabel(u.role) }, { key: 'scope', label: 'Alcance', value: scopeText }, { key: 'status', label: 'Estado', render: u => sb(u.status) },
        { key: 'mfa', label: 'Segundo factor', value: u => u.twofa_enabled ? 'Activo' : S.requiresMfa(u) ? 'Falta (obligatorio)' : 'No', render: u => u.twofa_enabled ? badge('Activo', 'ok') : S.requiresMfa(u) ? badge('Falta', 'bad') : h('span', { class: 'muted' }, 'No exige') }, { key: 'last_login', label: 'Último ingreso', value: u => u.last_login || '', render: u => F.datetime(u.last_login) }] }));
    body.appendChild(notice([h('b', null, 'D-SEG-04 · valor provisional: '), 'se dimensiona con 6 vendedoras, 1 supervisora, 2 cajeros, 4 preparadores, 4 repartidores y 6 administrativos. D-SEG-01: el cajero no usa segundo factor; su caja exige apertura y arqueo.'], 'info'));
  }

  /* ---- SEG-09 Ficha del usuario ---- */
  function userScreen(el, params) {
    const u = userOf(params.id) || D.find('users', x => x.role === 'VENDEDORA' && x.status === 'ACTIVE');
    const body = page(el, { code: 'SEG-09', title: 'Ficha del usuario', sub: 'Rol, locales y marcas permitidos, trabajador vinculado y estado, con las acciones de seguridad y su bitácora de accesos. Los cambios de rol o alcance rigen en su siguiente petición (RN-SEG-20).', actions: [{ label: 'Volver a usuarios', onClick: () => G.go('SEG-08') }] });
    if (!u) { body.appendChild(G.ui.empty('Usuario no encontrado.')); return; }
    const acts = [];
    if (u.status === 'LOCKED') acts.push(btn('Desbloquear', guard('seg.user.unlock', () => run(() => S.unlock(u.id), 'Usuario desbloqueado')), { kind: 'primary', sm: true }));
    if (u.status === 'ACTIVE') acts.push(btn('Bloquear', guard('seg.user.manage', () => reasonModal(`Bloquear a ${u.name}`, 'Cierra sus sesiones al instante (RN-SEG-18).', 'Bloquear', 'danger', r => S.lockUser(u.id, r))), { sm: true }));
    if (u.twofa_enabled) acts.push(btn('Reiniciar segundo factor', guard('seg.user.reset_mfa', () => G.ui.confirm({ title: 'Reiniciar segundo factor', message: `${u.name} deberá activarlo otra vez en su siguiente ingreso; sus códigos de recuperación dejan de servir.`, confirmLabel: 'Reiniciar', danger: true, onConfirm: () => run(() => S.resetMfa(u.id), 'Segundo factor reiniciado') })), { sm: true }));
    acts.push(btn('Cerrar sesiones', guard('seg.session.revoke', () => run(() => S.revokeAll(u.id, 'Cerradas por ' + G.ctx.userName()), 'Sesiones cerradas')), { sm: true }));
    if (u.status !== 'INACTIVE') acts.push(btn('Desactivar', guard('seg.user.manage', () => reasonModal(`Desactivar a ${u.name}`, 'Se cierran sus sesiones y se revocan sus celulares. No se borra (RN-SEG-17).', 'Desactivar', 'danger', r => S.deactivate(u.id, r))), { sm: true, kind: 'danger' }));
    else acts.push(btn('Reactivar', guard('seg.user.manage', () => run(() => S.reactivate(u.id), 'Usuario reactivado')), { sm: true }));
    const emp = u.employee_id && D.get('employees', u.employee_id);
    body.appendChild(card(u.name, h('div', { class: 'stack' }, h('div', { class: 'grid c2' }, dl([['Correo', u.email], ['Rol', S.roleLabel(u.role)], ['Alcance', scopeText(u)], ['Trabajador', emp ? `${emp.full_name} · ${emp.position}` : '—']]), dl([['Estado', h('span', null, sb(u.status), u.locked_until ? ` hasta ${F.datetime(u.locked_until)}` : '', u.lock_reason ? ' · ' + u.lock_reason : '', u.deactivate_reason ? ' · ' + u.deactivate_reason : '')], ['Segundo factor', u.twofa_enabled ? `Activo desde ${F.date(u.mfa_enrolled_at)}` : S.requiresMfa(u) ? 'Obligatorio y no activo' : 'No'], ['Intentos fallidos seguidos', u.failed_logins || 0], ['Último ingreso', F.datetime(u.last_login)]])), h('div', { class: 'row' }, acts))));
    const ses = D.where('user_sessions', s => s.user_id === u.id).sort(U.by('started_at', -1));
    const log = D.where('access_log', x => x.user_id === u.id || lower(x.email_attempted) === lower(u.email)).sort(U.by('occurred_at', -1));
    body.appendChild(h('div', { style: 'min-width:0' }, tabs([
      { key: 'edit', label: 'Rol y alcance', render: p => { const vals = { role: u.role, employee_id: u.employee_id || '' }; for (const b of D.all('brands')) vals['b_' + b.id] = (u.brands || []).includes(b.id); for (const e of D.all('establishments')) vals['s_' + e.id] = (u.sites || []).includes(e.id); p.appendChild(form({ id: 'seg09', values: vals, submitLabel: 'Guardar rol y alcance', fields: [{ key: 'role', label: 'Rol', type: 'select', required: true, options: S.allRoles() }, { key: 'employee_id', label: 'Trabajador vinculado', type: 'select', options: D.all('employees').map(e => [e.id, `${e.full_name} · ${e.position}`]) }].concat(D.all('brands').map(b => ({ key: 'b_' + b.id, label: 'Marca: ' + b.name, type: 'checkbox' }))).concat(D.all('establishments').map(e => ({ key: 's_' + e.id, label: 'Local: ' + (e.short || e.name), type: 'checkbox' }))), onSubmit: v => { if (!can('seg.user.manage')) return `RN-SEG-12: 403 · tu rol (${G.roleName()}) no tiene el permiso seg.user.manage.`; const brands = D.all('brands').filter(b => v['b_' + b.id]).map(b => b.id); const sites = D.all('establishments').filter(e => v['s_' + e.id]).map(e => e.id); try { S.updateUser(u.id, { role: v.role, employee_id: v.employee_id, brands, sites }); } catch (e) { return e.message; } toast('Rol y alcance guardados: rigen en su siguiente petición', 'ok'); G.refresh(); return true; } })); } },
      { key: 'ses', label: 'Sesiones', count: ses.filter(s => s.status === 'ACTIVE').length, render: p => p.appendChild(sessionsTable(ses, { id: 'seg09-s', actions: s => ['ACTIVE', 'PENDING_MFA'].includes(s.status) ? [btn('Cerrar', guard('seg.session.revoke', () => run(() => S.revokeSession(s.id, 'Cerrada por ' + G.ctx.userName()), 'Sesión cerrada')), { sm: true })] : [] })) },
      { key: 'dev', label: 'Dispositivos', count: D.where('user_devices', d => d.user_id === u.id).length, render: p => p.appendChild(devicesTable(D.where('user_devices', d => d.user_id === u.id), 'seg09-d')) },
      { key: 'log', label: 'Bitácora de accesos (AUD-03)', count: log.length, render: p => p.appendChild(table({ id: 'seg09-l', rows: log, pageSize: 15, filters: [{ key: 'event', label: 'Evento', options: [...new Set(log.map(x => x.event))].map(e => [e, evName(e)]) }], columns: [{ key: 'occurred_at', label: 'Fecha', render: x => F.datetime(x.occurred_at) }, { key: 'event', label: 'Evento', value: x => evName(x.event), render: x => badge(evName(x.event), /FAILED|LOCKED|DENIED|BLOCKED|REVOKED/.test(x.event) ? 'bad' : /OK|APPROVED/.test(x.event) ? 'ok' : '') }, { key: 'ip', label: 'IP', mono: true }, { key: 'user_agent', label: 'Dispositivo' }, { key: 'details', label: 'Detalle', value: x => Object.entries(x.details || {}).map(([k, v]) => `${k}: ${v}`).join(' · ') }] })) },
    ], { key: 'seg09:' + u.id })));
  }

  /* ---- SEG-10 Roles ---- */
  function rolesScreen(el) {
    const body = page(el, { code: 'SEG-10', title: 'Roles', sub: 'Roles del sistema (22) y propios, con descripción, si exigen segundo factor, alcance y cantidad de usuarios. Los del sistema no se borran ni cambian su código; sus permisos sí se ajustan por empresa (RN-SEG-14).', actions: [{ label: 'Copiar un rol del sistema', kind: 'primary', onClick: guard('seg.role.manage', () => copyDlg('VENDEDORA')) }] });
    const rows = D.all('roles').slice().sort((a, b) => (b.is_system - a.is_system) || (a.phase - b.phase) || a.name.localeCompare(b.name));
    const cnt = U.groupBy(D.where('users', u => u.status !== 'INACTIVE'), 'role');
    body.appendChild(kpis([{ label: 'Roles del sistema', value: rows.filter(r => r.is_system).length }, { label: 'Roles propios', value: rows.filter(r => !r.is_system).length }, { label: 'Exigen segundo factor', value: rows.filter(r => r.requires_mfa).length }, { label: 'Alcance asignado', value: rows.filter(r => r.scope_mode === 'ASSIGNED').length, sub: 'ven solo sus marcas o locales' }]));
    body.appendChild(table({ id: 'seg10', rows, pageSize: 30, onRow: r => G.go('SEG-11', { role: r.code }), filters: [{ key: 'kind', label: 'Tipo', value: r => r.is_system ? 'S' : 'P', options: [['S', 'Del sistema'], ['P', 'Propio']] }, { key: 'phase', label: 'Fase', options: [0, 1, 2, 3].map(p => [p, 'Fase ' + p]) }],
      columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Rol' }, { key: 'description', label: 'Descripción' }, { key: 'phase', label: 'Fase', align: 'c' }, { key: 'requires_mfa', label: '2FA', value: r => r.requires_mfa ? 'Exige' : 'No', render: r => r.requires_mfa ? badge('Exige', 'warn') : h('span', { class: 'muted' }, 'No') }, { key: 'scope_mode', label: 'Alcance', value: r => r.scope_mode === 'ALL' ? 'Todo' : 'Asignado' }, { key: 'users', label: 'Usuarios', align: 'r', value: r => (cnt[r.code] || []).length }, { key: 'perms', label: 'Permisos especiales', align: 'r', value: r => S.rolePerms(r.code).length }, { key: 'status', label: 'Estado', render: r => sb(r.status) }],
      actions: r => [btn('Copiar', guard('seg.role.manage', () => copyDlg(r.code)), { sm: true }), !r.is_system ? btn('Borrar', guard('seg.role.manage', () => G.ui.confirm({ title: 'Borrar rol propio', message: `Se borra ${r.name}.`, danger: true, confirmLabel: 'Borrar', onConfirm: () => run(() => S.deleteRole(r.code), 'Rol borrado') })), { sm: true, kind: 'ghost' }) : null].filter(Boolean) }));
  }
  function copyDlg(base) {
    drawer('Crear rol propio', (bd, close) => bd.appendChild(form({ id: 'seg10c', values: { base, code: base + '_LOCAL', name: S.roleLabel(base) + ' (propio)' }, onCancel: close, submitLabel: 'Crear rol',
      fields: [{ key: 'base', label: 'Copiar de', type: 'select', required: true, options: G.ROLES.filter(r => r[0] !== 'GERENTE').map(r => [r[0], r[1]]) }, { key: 'code', label: 'Código', required: true, help: 'Mayúsculas, números y guion bajo.' }, { key: 'name', label: 'Nombre', required: true }],
      onSubmit: v => { try { const r = S.copyRole(v.base, v.code, v.name); toast('Rol creado: ajusta sus permisos', 'ok'); close(); G.go('SEG-11', { role: r.code }); } catch (e) { return e.message; } return true; } })), { code: 'SEG-10' });
  }

  /* ---- SEG-11 Permisos del rol ---- */
  const RS = { role: 'VENDEDORA' };
  function permsScreen(el, params) {
    if (params.role) RS.role = params.role;
    const role = RS.role; const r = roleRow(role);
    const body = page(el, { code: 'SEG-11', title: 'Permisos del rol', sub: 'Acceso por módulo (C crear · L leer · E editar · A aprobar o anular) y permisos especiales con su explicación, agrupados por módulo. Los módulos apagados aparecen en gris y no conceden permisos (RN-PLT-07, RN-SEG-12).' });
    const sel = h('select', { class: 'input', attrs: { id: 'seg11-role', 'aria-label': 'Rol' } }, S.allRoles().map(([c, n]) => h('option', { value: c, selected: c === role }, `${n} (${c})`)));
    sel.addEventListener('change', () => { RS.role = sel.value; G.go('SEG-11', { role: sel.value }); });
    const editable = can('seg.role.manage') && role !== 'GERENTE';
    body.appendChild(h('div', { class: 'row' }, sel, r ? badge(r.is_system ? 'Rol del sistema' : 'Rol propio', r.is_system ? 'info' : 'primary') : null, r && r.requires_mfa ? badge('Exige 2FA', 'warn') : null, role === 'GERENTE' ? badge('Ve todo y tiene todos los permisos', 'ok') : null, !editable ? h('span', { class: 'small muted' }, can('seg.role.manage') ? '' : 'Solo lectura: cambiar permisos exige seg.role.manage.') : null));
    const mods = G.GROUPS.flatMap(g => g.mods.filter(m => G.SPEC[m]).map(m => ({ m, phase: g.phase, group: g.name })));
    const perms = U.groupBy(Object.entries(G.PERM_INFO).map(([code, i]) => Object.assign({ code }, i)), 'module');
    const have = new Set(S.rolePerms(role));
    const grid = h('div', { class: 'grid c2' });
    for (const { m, phase } of mods) {
      const off = !G.modOn(m); const acc = G.access(m, role);
      const letters = h('div', { class: 'row' }, ['C', 'L', 'E', 'A'].map(L => { const cb = h('input', { type: 'checkbox', checked: acc.includes(L), disabled: !editable || off, attrs: { 'aria-label': `${m} ${L}` } }); cb.addEventListener('change', () => { const cur = G.access(m, role); const next = ['C', 'L', 'E', 'A'].filter(x => x === L ? cb.checked : cur.includes(x)).join(''); if (!run(() => S.setRoleAccess(role, m, next), `${m}: acceso ${next || 'ninguno'}`)) cb.checked = !cb.checked; }); return h('label', { class: 'check small' }, cb, h('span', { class: 'mono' }, L)); }));
      const plist = (perms[m] || []).map(p => { const everyone = !p.roles.length; const cb = h('input', { type: 'checkbox', checked: everyone || have.has(p.code), disabled: !editable || off || everyone }); cb.addEventListener('change', () => { if (!run(() => S.setRolePerm(role, p.code, cb.checked), `${p.code} ${cb.checked ? 'concedido' : 'quitado'}`)) cb.checked = !cb.checked; }); return h('label', { class: 'check small', style: 'align-items:flex-start' }, cb, h('span', null, h('span', { class: 'mono' }, p.code), ' · ', p.desc, everyone ? h('span', { class: 'muted' }, ' (todos)') : null)); });
      grid.appendChild(h('section', { class: 'card', style: off ? 'opacity:.55;filter:grayscale(1)' : '' }, h('div', { class: 'card-head' }, h('h3', null, h('span', { class: 'mono' }, m), ' ', P.modName(m), ' ', h('span', { class: 'muted small' }, 'F' + phase)), off ? badge('Apagado', 'warn') : null), h('div', { class: 'card-body stack', style: 'gap:6px' }, letters, plist.length ? h('div', { class: 'stack', style: 'gap:2px' }, plist) : null)));
    }
    body.appendChild(grid);
  }

  /* ---- SEG-12 Matriz ---- */
  const MS = { view: 'perms' };
  function download(name, text) { try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast('Matriz exportada: ' + name, 'ok'); } catch (e) { toast('No se pudo descargar en este navegador.', 'warn'); } }
  S.matrixCsv = function () {
    const roles = S.allRoles().map(r => r[0]); const lines = [['Tipo', 'Módulo', 'Permiso', 'Descripción', 'Módulo encendido'].concat(roles).join(';')];
    for (const m of Object.keys(G.SPEC)) lines.push(['ACCESO', m, m + '.*', P.modName(m), G.modOn(m) ? 'Sí' : 'No'].concat(roles.map(r => G.modOn(m) ? G.access(m, r) : '')).join(';'));
    for (const [code, i] of Object.entries(G.PERM_INFO)) lines.push(['PERMISO', i.module, code, i.desc.replace(/;/g, ','), G.modOn(i.module) ? 'Sí' : 'No'].concat(roles.map(r => P.hasPerm(code, r) ? 'X' : '')).join(';'));
    return lines.join('\n');
  };
  function matrixScreen(el) {
    const body = page(el, { code: 'SEG-12', title: 'Matriz de roles y permisos', sub: 'Vista de solo lectura de todos los roles contra todos los permisos para la revisión de accesos (AUD-08). Los módulos apagados no conceden nada.', actions: [{ label: 'Exportar CSV', kind: 'primary', onClick: () => download(`matriz-roles-permisos-${G.TODAY}.csv`, S.matrixCsv()) }] });
    const roles = S.allRoles().map(r => r[0]);
    const abbr = r => r.split('_').map(x => x.slice(0, 3)).join('·');
    body.appendChild(pills([['perms', 'Permisos especiales'], ['access', 'Acceso por módulo']], MS.view, v => { MS.view = v; G.refresh(); }));
    if (MS.view === 'access') {
      body.appendChild(table({ id: 'seg12-a', rows: Object.keys(G.SPEC).map(m => ({ id: m, m })), pageSize: 50, filters: [{ key: 'phase', label: 'Fase', value: r => G.SPEC[r.m].phase, options: [0, 1, 2, 3, 4].map(p => [p, 'Fase ' + p]) }],
        columns: [{ key: 'm', label: 'Módulo', render: r => h('span', { style: G.modOn(r.m) ? '' : 'opacity:.5' }, h('span', { class: 'mono' }, r.m), ' ', P.modName(r.m), G.modOn(r.m) ? null : ' (apagado)') }].concat(roles.map(rc => ({ key: rc, label: abbr(rc), sort: false, align: 'c', value: r => G.access(r.m, rc), render: r => { const a = G.modOn(r.m) ? G.access(r.m, rc) : ''; return a ? h('span', { class: 'mono small', title: `${S.roleLabel(rc)} · ${r.m}` }, a) : h('span', { class: 'muted' }, '·'); } }))) }));
    } else {
      const rows = Object.entries(G.PERM_INFO).map(([code, i]) => ({ id: code, code, module: i.module, desc: i.desc }));
      body.appendChild(table({ id: 'seg12-p', rows, pageSize: 40, filters: [{ key: 'module', label: 'Módulo', options: Object.keys(G.SPEC).filter(m => rows.some(r => r.module === m)).map(m => [m, m + ' · ' + P.modName(m)]) }],
        columns: [{ key: 'code', label: 'Permiso', render: r => h('span', { style: G.modOn(r.module) ? '' : 'opacity:.5', title: r.desc }, h('span', { class: 'mono small' }, r.code), G.modOn(r.module) ? null : h('span', { class: 'muted small' }, ' (apagado)')) }, { key: 'desc', label: 'Para qué' }].concat(roles.map(rc => ({ key: rc, label: abbr(rc), sort: false, align: 'c', value: r => P.hasPerm(r.code, rc) ? 'X' : '', render: r => P.hasPerm(r.code, rc) ? h('span', { title: S.roleLabel(rc), style: 'color:var(--ok);font-weight:700' }, '●') : h('span', { class: 'muted' }, '·') }))) }));
    }
    body.appendChild(card('Leyenda', h('div', { class: 'small', style: 'display:flex;flex-wrap:wrap;gap:6px 14px' }, roles.map(rc => h('span', null, h('span', { class: 'mono' }, abbr(rc)), ' = ', S.roleLabel(rc))))));
  }

  /* ---- SEG-13 Dispositivos de la app ---- */
  function devicesTable(rows, id) {
    return table({ id, rows, pageSize: 20, filters: [{ key: 'status', label: 'Estado', options: [['PENDING', 'Por aprobar'], ['APPROVED', 'Aprobado'], ['REVOKED', 'Revocado']] }, { key: 'platform', label: 'Plataforma', options: [['ANDROID', 'Android'], ['IOS', 'iPhone'], ['WEB', 'Web']] }],
      columns: [{ key: 'user', label: 'Usuario', value: d => G.userName(d.user_id) }, { key: 'role', label: 'Rol', value: d => S.roleLabel((userOf(d.user_id) || {}).role) }, { key: 'name', label: 'Dispositivo' }, { key: 'platform', label: 'Plataforma' }, { key: 'status', label: 'Estado', render: d => sb(d.status, 'device') }, { key: 'requested_at', label: 'Registrado', render: d => F.datetime(d.requested_at) }, { key: 'approved_by', label: 'Aprobó', value: d => d.approved_by ? G.userShort(d.approved_by) + ' · ' + F.date(d.approved_at) : '—' }, { key: 'revoke_reason', label: 'Motivo de revocación' }, { key: 'last_seen_at', label: 'Último uso', render: d => F.datetime(d.last_seen_at) }],
      actions: d => [d.status === 'PENDING' ? btn('Aprobar', guard('seg.device.approve', () => run(() => S.approveDevice(d.id), 'Celular aprobado: ya puede iniciar sesión')), { sm: true, kind: 'primary' }) : null, d.status !== 'REVOKED' ? btn('Revocar', guard('seg.device.approve', () => reasonModal(`Revocar ${d.name}`, 'Sus sesiones se cierran en ese momento (RN-SEG-11).', 'Revocar', 'danger', r => S.revokeDevice(d.id, r))), { sm: true }) : null].filter(Boolean) });
  }
  function devicesScreen(el) {
    const body = page(el, { code: 'SEG-13', title: 'Dispositivos de la app', sub: 'Celulares de repartidores y visitadores pendientes, aprobados y revocados. La app móvil solo inicia sesión desde un celular aprobado; revocarlo cierra sus sesiones al instante (RN-SEG-11). Nadie aprueba su propio celular (RN-SEG-16).' });
    const ds = D.all('user_devices').filter(d => d.platform !== 'WEB');
    body.appendChild(kpis([{ label: 'Por aprobar', value: ds.filter(d => d.status === 'PENDING').length, tone: ds.some(d => d.status === 'PENDING') ? 'warn' : 'ok' }, { label: 'Aprobados', value: ds.filter(d => d.status === 'APPROVED').length }, { label: 'Revocados', value: ds.filter(d => d.status === 'REVOKED').length }, { label: 'Aprobación exigida', value: pMin('seg_mobile_device_approval', true) ? 'Sí' : 'No', sub: 'seg_mobile_device_approval · D-SEG-03: solo la app' }]));
    body.appendChild(devicesTable(ds, 'seg13'));
  }

  /* ---- SEG-14 Política ---- */
  function policyScreen(el) {
    const body = page(el, { code: 'SEG-14', title: 'Política de contraseñas y sesiones', sub: 'Parámetros de SEG con su valor vigente y su historial (PLT-11). Cambiarlos exige seg.policy.edit o plt.parameter.edit y un motivo (RN-PLT-06).' });
    const keys = Object.keys(G.PARAM_DEFS).filter(k => G.PARAM_DEFS[k].module === 'SEG');
    const GROUPS = [['Contraseñas', /password/], ['Bloqueo', /failed|lockout/], ['Sesiones', /session|concurrent/], ['Segundo factor y recuperación', /totp|recovery|reset/], ['Dispositivos y revisión', /mobile_device|inactive/]];
    const grid = h('div', { class: 'grid c3' });
    for (const [gn, re] of GROUPS) grid.appendChild(card(gn, h('div', { class: 'stack', style: 'gap:4px' }, keys.filter(k => re.test(k)).map(k => h('button', { class: 'btn', style: 'justify-content:space-between;text-align:left;white-space:normal', on: { click: () => { if (!can('seg.policy.edit') && !can('plt.parameter.edit')) return toast(`RN-SEG-12: tu rol (${G.roleName()}) no tiene seg.policy.edit.`, 'warn'); P.paramEditor(k); } } }, h('span', { style: 'min-width:0' }, h('span', { class: 'small' }, G.PARAM_DEFS[k].desc), h('div', { class: 'mono small muted' }, k)), h('b', null, P.fmtParam(k, G.param(k))))))));
    body.appendChild(grid);
    const inp = h('input', { class: 'input', type: 'text', placeholder: 'Escribe una contraseña para probarla', attrs: { id: 'seg14-p', autocomplete: 'off', 'aria-label': 'Contraseña de prueba' } }); const out = h('div', { class: 'stack', style: 'gap:2px' });
    const u = me(); const draw = () => { G.ui.clear(out); for (const c of S.policyChecks(inp.value, u)) out.appendChild(h('div', { class: 'small' }, badge(c.ok ? 'Sí' : 'No', c.ok ? 'ok' : 'warn'), ' ', c.label, ' ', h('span', { class: 'mono muted' }, c.code))); }; inp.addEventListener('input', draw); draw();
    const hist = D.where('parameter_history', x => x.key.startsWith('seg_')).sort(U.by('changed_at', -1));
    body.appendChild(h('div', { class: 'grid c2' }, card('Probar la política con tu usuario', h('div', { class: 'stack' }, inp, out, h('p', { class: 'small muted' }, 'Se guarda con Argon2id en el sistema real; la demo usa un hash simple.'))),
      card('Historial de la política', hist.length ? table({ id: 'seg14-h', search: false, rows: hist, columns: [{ key: 'changed_at', label: 'Fecha', render: x => F.datetime(x.changed_at) }, { key: 'key', label: 'Clave', mono: true }, { key: 'chg', label: 'Cambio', value: x => `${P.fmtParam(x.key, x.old_value)} → ${P.fmtParam(x.key, x.new_value)}` }, { key: 'changed_by', label: 'Usuario' }, { key: 'reason', label: 'Motivo' }] }) : G.ui.empty('Sin cambios: rigen los valores por defecto.'))));
    const k2 = G.kpi('KPI-SEG-02') || {}; const k4 = G.kpi('KPI-SEG-04') || {};
    body.appendChild(kpis([{ label: 'KPI-SEG-02 · bloqueos del mes', value: k2.value, tone: k2.value ? 'warn' : 'ok' }, { label: 'KPI-SEG-04 · inicios fallidos', value: F.pct(k4.value, 1), sub: `${k4.numerator} de ${k4.denominator} intentos del mes` }]));
  }

  /* ---- SEG-15 Sesiones activas ---- */
  function allSessionsScreen(el) {
    const body = page(el, { code: 'SEG-15', title: 'Sesiones activas de la empresa', sub: 'Todas las sesiones abiertas por usuario, dispositivo e IP. Cerrar una o todas las de un usuario surte efecto en su siguiente petición.', actions: [{ label: 'Aplicar vencimientos ahora (RN-SEG-09)', onClick: guard('seg.session.revoke', () => { const n = S.expireSessions(); toast(`${n} sesión(es) vencidas por inactividad o duración`, n ? 'warn' : 'ok'); G.refresh(); }) }] });
    if (!can('seg.session.view_all')) { body.appendChild(notice(`RN-SEG-12: tu rol (${G.roleName()}) no tiene seg.session.view_all.`, 'warn')); return; }
    const act = D.where('user_sessions', s => ['ACTIVE', 'PENDING_MFA'].includes(s.status));
    const byU = U.groupBy(act, 'user_id');
    body.appendChild(kpis([{ label: 'Sesiones abiertas', value: act.length }, { label: 'Usuarios conectados', value: Object.keys(byU).length }, { label: 'App móvil', value: act.filter(s => s.client !== 'WEB').length }, { label: 'Esperando 2FA', value: act.filter(s => s.status === 'PENDING_MFA').length, tone: act.some(s => s.status === 'PENDING_MFA') ? 'warn' : '' }]));
    body.appendChild(sessionsTable(act.sort(U.by('last_seen_at', -1)), { id: 'seg15', user: true, search: true, pageSize: 25, filters: [{ key: 'client', label: 'Cliente', options: [['WEB', 'Web'], ['ANDROID', 'Android'], ['IOS', 'iPhone']] }, { key: 'role', label: 'Rol', value: s => (userOf(s.user_id) || {}).role, options: S.allRoles() }],
      actions: s => [btn('Cerrar', guard('seg.session.revoke', () => run(() => S.revokeSession(s.id, 'Cerrada por ' + G.ctx.userName()), 'Sesión cerrada')), { sm: true }), byU[s.user_id] && byU[s.user_id].length > 1 ? btn('Todas del usuario', guard('seg.session.revoke', () => run(() => S.revokeAll(s.user_id, 'Cerradas por ' + G.ctx.userName()), 'Sesiones del usuario cerradas')), { sm: true, kind: 'ghost' }) : null].filter(Boolean) }));
  }

  /* ---------- registro ---------- */
  const SC = Object.fromEntries(G.SPEC.SEG.screens.map(s => [s[0], s[1]]));
  G.register({ code: 'SEG', name: 'Seguridad', phase: 0, group: 'Plataforma', screens: [
    { code: 'SEG-01', name: SC['SEG-01'], render: loginScreen }, { code: 'SEG-02', name: SC['SEG-02'], render: mfaScreen }, { code: 'SEG-03', name: SC['SEG-03'], render: enrollScreen }, { code: 'SEG-04', name: SC['SEG-04'], render: forgotScreen }, { code: 'SEG-05', name: SC['SEG-05'], render: newPwdScreen },
    { code: 'SEG-06', name: SC['SEG-06'], render: accountScreen }, { code: 'SEG-07', name: SC['SEG-07'], render: mySessionsScreen }, { code: 'SEG-08', name: SC['SEG-08'], render: usersScreen }, { code: 'SEG-09', name: SC['SEG-09'], render: userScreen }, { code: 'SEG-10', name: SC['SEG-10'], render: rolesScreen },
    { code: 'SEG-11', name: SC['SEG-11'], render: permsScreen }, { code: 'SEG-12', name: SC['SEG-12'], render: matrixScreen }, { code: 'SEG-13', name: SC['SEG-13'], render: devicesScreen }, { code: 'SEG-14', name: SC['SEG-14'], render: policyScreen }, { code: 'SEG-15', name: SC['SEG-15'], render: allSessionsScreen },
  ] });

  /* ---------- pruebas (criterios CA-SEG) ---------- */
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (code && !String(e.message).startsWith(code)) throw new Error(`Se esperaba ${code} y llegó: ${e.message}`); return e; } throw new Error(`Se esperaba el error ${code} y no falló.`); };
  const T = (name, fn) => G.tests.push({ module: 'SEG', name, fn: async () => { const role = G.ctx.role; try { await fn(); } finally { G.ctx.role = role; G.ctx.tenant = 'DG'; if (G.ctx.session && G.ctx.session.role !== 'GERENTE') { G.ctx.session = null; G.auth.demoLogin('GERENTE'); } } } });
  const T0 = '2026-10-10T10:00:00';
  T('CA-SEG-01: la gerente con 2FA no entra sin el código TOTP; con el código de su aplicación su sesión queda activa', () => {
    const g = D.find('users', u => u.role === 'GERENTE');
    const r = S.login({ email: g.email, password: DEMO_PWD, at: T0 });
    assert(r.status === 'MFA_REQUIRED' && r.session.status === 'PENDING_MFA', 'Sin TOTP la sesión no debe quedar activa');
    expectFail(() => S.touchSession(r.session.id, T0), 'RN-SEG-09');
    const bad = A().totp(g) === '123456' ? '654321' : '123456'; expectFail(() => S.verifyMfa(r.session.id, bad, { at: T0 }), 'RN-SEG-06');
    const code = A().totp(g); S.verifyMfa(r.session.id, code, { at: T0 });
    assert(D.get('user_sessions', r.session.id).status === 'ACTIVE' && D.get('user_sessions', r.session.id).mfa_verified_at, 'Con el código vigente la sesión debe quedar activa');
    const r2 = S.login({ email: g.email, password: DEMO_PWD, at: T0 }); expectFail(() => S.verifyMfa(r2.session.id, code, { at: T0 }), 'RN-SEG-06');
    assert(D.where('access_log', e => e.user_id === g.id && e.event === 'MFA_OK').length >= 1, 'Falta MFA_OK en la bitácora');
  });
  T('CA-SEG-02: 5 fallos de la vendedora desde 190.42.10.5 bloquean 15 minutos; el 6.º con la clave correcta da RN-SEG-04; vencido el plazo entra con el contador en cero', () => {
    const v = D.find('users', u => u.role === 'VENDEDORA' && u.status === 'ACTIVE');
    for (let i = 1; i <= 4; i++) expectFail(() => S.login({ email: v.email, password: 'mala-clave-' + i, ip: '190.42.10.5', at: P.addMin(T0, i) }), 'RN-SEG-19');
    const e5 = expectFail(() => S.login({ email: v.email, password: 'mala-clave-5', ip: '190.42.10.5', at: P.addMin(T0, 5) }), 'RN-SEG-04');
    assert(v.status === 'LOCKED' && v.locked_until === P.addMin(T0, 20), 'Debe quedar bloqueada 15 minutos: ' + v.locked_until);
    expectFail(() => S.login({ email: v.email, password: DEMO_PWD, ip: '190.42.10.5', at: P.addMin(T0, 6) }), 'RN-SEG-04');
    const r = S.login({ email: v.email, password: DEMO_PWD, ip: '190.42.10.5', at: P.addMin(T0, 21) });
    assert(r.status === 'OK' && v.failed_logins === 0 && v.status === 'ACTIVE', 'Vencido el plazo debe entrar con el contador en cero');
    assert(D.where('access_log', e => e.user_id === v.id && e.event === 'LOCKED' && e.ip === '190.42.10.5').length === 1, 'Falta el evento LOCKED con la IP');
    expectFail(() => S.login({ email: 'noexiste@donguando.pe', password: 'x' }), 'RN-SEG-19');
    assert(/Correo o contraseña incorrectos/.test(e5.message) === false, 'El bloqueo usa su propio mensaje');
  });
  T('CA-SEG-03: la vendedora asignada solo a la Marca 3 ve solo datos de la Marca 3; la supervisora con las 5 marcas ve todo', () => {
    const f = D.find('users', u => u.role === 'VENDEDORA' && (u.brands || []).join() === 'br-M3'); assert(f, 'Falta la vendedora de la Marca 3');
    G.auth.start(f, { via: 'demo' });
    const os = G.scope.filter(D.all('sales_orders')); assert(os.length && os.every(o => o.brand_id === 'br-M3'), 'La vendedora ve pedidos de otras marcas');
    assert(G.scope.brands().length === 1 && G.scope.brands()[0].id === 'br-M3', 'El selector de marca debe mostrar solo la Marca 3');
    const hits = P.search('p-0', { noLimit: true }).hits.filter(x => x.type === 'order'); assert(hits.length && hits.every(x => x.brand_id === 'br-M3'), 'La búsqueda devuelve pedidos de otras marcas');
    const wa = D.where('messaging_channels', c => G.scope.ok(c, { brand: 'brand_id', site: 'x' })); assert(wa.every(c => c.brand_id === 'br-M3') && wa.length === 1, 'Debe ver 1 de los 6 números de WhatsApp');
    const sup = D.find('users', u => u.role === 'SUPERVISORA_VENTAS'); G.ctx.session = null; G.auth.start(sup, { via: 'demo' });
    assert(new Set(G.scope.filter(D.all('sales_orders')).map(o => o.brand_id)).size === 5, 'La supervisora debe ver las 5 marcas');
  });
  T('CA-SEG-04: el celular nuevo del repartidor se rechaza con RN-SEG-11 hasta que el coordinador lo apruebe; revocado, su sesión se cierra', () => {
    const rp = D.find('users', u => u.role === 'REPARTIDOR' && u.status === 'ACTIVE');
    expectFail(() => S.login({ email: rp.email, password: DEMO_PWD, client: 'ANDROID', fingerprint: 'fp-prueba-nuevo', device_name: 'Moto E22', at: T0 }), 'RN-SEG-11');
    const d = D.find('user_devices', x => x.user_id === rp.id && x.fingerprint_hint === 'fp-prueba-nuevo'); assert(d && d.status === 'PENDING', 'Debe quedar pendiente');
    G.ctx.role = 'REPARTIDOR'; expectFail(() => S.approveDevice(d.id), 'RN-SEG-12');
    G.ctx.role = 'COORDINADOR_DELIVERY'; S.approveDevice(d.id); assert(d.status === 'APPROVED' && d.approved_by, 'Debe quedar aprobado');
    const r = S.login({ email: rp.email, password: DEMO_PWD, client: 'ANDROID', fingerprint: 'fp-prueba-nuevo', at: P.addMin(T0, 2) }); assert(r.status === 'OK' && r.session.device_id === d.id, 'Aprobado, debe entrar');
    S.revokeDevice(d.id, 'Celular perdido'); assert(D.get('user_sessions', r.session.id).status === 'REVOKED', 'Revocado, la sesión debe cerrarse en ese momento');
    expectFail(() => S.login({ email: rp.email, password: DEMO_PWD, client: 'ANDROID', fingerprint: 'fp-prueba-nuevo', at: P.addMin(T0, 3) }), 'RN-SEG-11');
  });
  T('CA-SEG-05: el enlace de 30 minutos usado a los 31 o por segunda vez se rechaza con RN-SEG-08; a tiempo fija la contraseña y cierra las sesiones', () => {
    const v = D.find('users', u => u.role === 'CAJERO');
    const s1 = S.login({ email: v.email, password: DEMO_PWD, at: T0 }).session;
    const t1 = S.forgot(v.email, { at: T0 }); assert(t1.message === S.FORGOT_MSG && t1.token, 'Debe responder el mensaje único');
    assert(S.forgot('nadie@donguando.pe', { at: T0 }).message === S.FORGOT_MSG, 'El mensaje no revela si el correo existe');
    expectFail(() => S.reset(t1.token, 'CajaMostrador2026', 'CajaMostrador2026', { at: P.addMin(T0, 31) }), 'RN-SEG-08');
    const t2 = S.forgot(v.email, { at: P.addMin(T0, 32) }); expectFail(() => S.reset(t1.token, 'CajaMostrador2026', 'CajaMostrador2026', { at: P.addMin(T0, 33) }), 'RN-SEG-08');
    expectFail(() => S.reset(t2.token, 'corta1', 'corta1', { at: P.addMin(T0, 34) }), 'RN-SEG-02');
    expectFail(() => S.reset(t2.token, DEMO_PWD, DEMO_PWD, { at: P.addMin(T0, 34) }), 'RN-SEG-03');
    const r = S.reset(t2.token, 'CajaMostrador2026', 'CajaMostrador2026', { at: P.addMin(T0, 40) });
    assert(r.closed >= 1 && D.get('user_sessions', s1.id).status === 'REVOKED', 'Debe cerrar las sesiones anteriores');
    expectFail(() => S.reset(t2.token, 'OtraClave20261', 'OtraClave20261', { at: P.addMin(T0, 41) }), 'RN-SEG-08');
    assert(S.login({ email: v.email, password: 'CajaMostrador2026', at: P.addMin(T0, 42) }).status === 'OK', 'Debe entrar con la nueva');
  });
  T('CA-SEG-06: crear ANA.TORRES@donguando.pe con ana.torres@donguando.pe existente se rechaza por correo duplicado', () => {
    assert(D.find('users', u => u.email === 'ana.torres@donguando.pe'), 'Falta ana.torres@donguando.pe');
    expectFail(() => S.createUser({ name: 'Ana Torres', email: 'ANA.TORRES@donguando.pe', role: 'VENDEDORA', brands: ['br-DG'] }), 'RN-SEG-01');
    expectFail(() => S.createUser({ name: 'Nueva', email: 'nueva.vendedora@donguando.pe', role: 'VENDEDORA' }), 'RN-SEG-13');
    const r = S.createUser({ name: 'Nueva Vendedora', email: 'Nueva.Vendedora@DonGuando.pe', role: 'VENDEDORA', brands: ['br-M4'] });
    assert(r.user.email === 'nueva.vendedora@donguando.pe' && r.user.must_change_password, 'Se guarda en minúsculas y con invitación');
  });
  T('CA-SEG-07: al único administrador del sistema no se le quita el rol ni se le desactiva (RN-SEG-15)', () => {
    const ad = D.where('users', u => u.role === 'ADMIN_SISTEMA' && u.status === 'ACTIVE'); assert(ad.length === 1, 'Debe haber un solo administrador');
    expectFail(() => S.updateUser(ad[0].id, { role: 'GERENTE' }), 'RN-SEG-15');
    expectFail(() => S.deactivate(ad[0].id, 'Prueba de baja'), 'RN-SEG-15');
    assert(ad[0].status === 'ACTIVE' && ad[0].role === 'ADMIN_SISTEMA', 'No debe cambiar');
  });
  T('CA-SEG-08: la practicante contable no puede cerrar un período (403 sin plt.period.close); la contadora sí', () => {
    const p = D.find('accounting_periods', x => x.period === '2026-09-01' && x.company_id === 'co-dg');
    G.ctx.role = 'PRACTICANTE_CONTABLE'; const e = expectFail(() => P.closePeriod(p.id), 'RN-SEG-12'); assert(e.data && e.data.status === 403 && /plt\.period\.close/.test(e.message), 'Debe ser 403 por plt.period.close');
    assert(p.status === 'OPEN', 'No debe cerrar');
    G.ctx.role = 'CONTADORA'; P.closePeriod(p.id, 'Cierre de setiembre'); assert(p.status === 'CLOSED', 'La contadora sí puede cerrar');
  });
})();
