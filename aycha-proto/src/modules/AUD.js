/* =====================================================================
   AUD · Auditoría (AUD-01 … AUD-08)
   Bitácora de cambios (tabla `audit` que llena el núcleo) con antes y
   después campo por campo y secretos enmascarados (RN-AUD-07), historia
   de cada registro, bitácora de accesos (solo inserción), accesos a datos
   sensibles, exportaciones con motivo, aprobación y marca de agua,
   políticas de retención con corridas de archivo y depuración, y la
   revisión trimestral de accesos.
   Expone G.aud: log, mask, maskPII, history, historyPanel, syncAuth,
   requestExport, approveExport, rejectExport, downloadExport,
   inactiveUsers, reviewItems, startReview, closeReview, runPurge.
   ===================================================================== */
(function () {
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, modal, form, toast, tabs, pills, chart } = G.ui;
  const U = G.util, F = G.fmt, D = G.db;
  const R = (n, d = 2) => U.round(n, d);

  /* ---------- enmascarado (RN-AUD-07) ---------- */
  const SECRET_KEY = /^(password.*|.*_password|pwd_hash|password_hash|.*totp.*|.*secret.*|.*_token|token|access_token|refresh_token|api_key|.*fingerprint.*|recovery_codes?|reset_token.*|code_hash)$/i;
  const maskVal = (k, v) => (SECRET_KEY.test(k) && v !== null && v !== undefined && v !== '') || /^enc:v\d+:/.test(String(v)) ? '***' : v;
  function mask(o) {
    if (o === null || o === undefined) return o;
    if (Array.isArray(o)) return o.map(mask);
    if (typeof o !== 'object') return typeof o === 'string' ? o.replace(/enc:v\d+:[A-Za-z0-9+/=]+/g, '***') : o;
    const out = {}; for (const [k, v] of Object.entries(o)) { const m = maskVal(k, v); out[k] = m === '***' ? '***' : (v && typeof v === 'object' ? mask(v) : mask(v)); } return out;
  }
  const PII = { phone: 'phone', contact_phone: 'phone', from_phone: 'phone', doc_number: 'doc', customer_doc_number: 'doc', email: 'email', address_line: 'addr', reference: 'addr', full_name: null };
  function maskPII(field, v) {
    if (v === null || v === undefined || v === '') return v; const s = String(v); const t = PII[field];
    if (t === 'phone') return s.slice(0, 4) + '•••••' + s.slice(-3);
    if (t === 'doc') return '••••' + s.slice(-4);
    if (t === 'email') return s[0] + '•••@' + (s.split('@')[1] || '');
    if (t === 'addr') return s.slice(0, 8) + '…';
    return v;
  }
  const canPII = () => G.can('aud.export.personal_data');

  /* ---------- envoltorios del núcleo: auditoría enmascarada y bitácora de accesos ---------- */
  const origAudit = G.audit;
  G.audit = function (action, entity, id, detail, before, after) {
    if (G._seeding) return;
    let af = after;
    if (action === 'CREAR' && !after) { const row = (D.t[entity] || []).find(r => r.id === id); if (row) af = U.clone(row); }
    return origAudit(action, entity, id, mask(String(detail ?? '')), mask(before), mask(af));
  };
  const OP = { CREAR: 'INSERT', EDITAR: 'UPDATE', ELIMINAR: 'DELETE' };
  const OPL = { INSERT: ['Alta', 'ok'], UPDATE: ['Cambio', 'info'], DELETE: ['Borrado', 'bad'] };
  const opOf = a => OP[a.action] || a.action;
  const opBadge = a => { const o = opOf(a); return badge((OPL[o] || [o.charAt(0) + o.slice(1).toLowerCase().replace(/_/g, ' ')])[0], (OPL[o] || [, ''])[1]); };

  const EVENTS = { LOGIN_OK: ['Ingreso correcto', 'ok'], LOGIN_FAILED: ['Ingreso fallido', 'warn'], LOCKED: ['Cuenta bloqueada', 'bad'], UNLOCKED: ['Cuenta desbloqueada', 'info'], MFA_OK: ['Segundo factor correcto', 'ok'], MFA_FAILED: ['Segundo factor fallido', 'warn'], MFA_RECOVERY_CODE_USED: ['Código de recuperación usado', 'warn'], LOGOUT: ['Cierre de sesión', ''], SESSION_REVOKED: ['Sesión revocada', 'warn'], PASSWORD_RESET: ['Contraseña restablecida', 'info'], PERMISSION_DENIED: ['Acceso denegado (403)', 'bad'], MODULE_DISABLED: ['Módulo apagado (403)', 'bad'], FILE_DOWNLOADED: ['Descarga de archivo sensible', 'warn'], RECORDING_PLAYED: ['Grabación reproducida', 'warn'], EXPORT_DOWNLOADED: ['Exportación descargada', 'warn'], OUTBOX_RETRY: ['Reintento manual de integración', 'info'], WEBHOOK_REPROCESS: ['Reproceso de webhook', 'info'], AUDIT_VIEWED: ['Consulta de auditoría', ''], SENSITIVE_VIEW: ['Vista de datos sensibles', 'warn'] };
  const evBadge = e => badge((EVENTS[e] || [e])[0], (EVENTS[e] || [, ''])[1]);
  const SENSITIVE = ['FILE_DOWNLOADED', 'RECORDING_PLAYED', 'EXPORT_DOWNLOADED', 'SENSITIVE_VIEW'];
  const DEVICES = ['Chrome 129 · Windows 11', 'Edge 129 · Windows 10', 'Chrome 129 · Android 14', 'App Android Aycha 1.4 · Samsung A15', 'Safari · iPhone iOS 18'];

  const A = G.aud = {
    mask, maskPII, clientIp: '190.235.14.22',
    /** bitácora de accesos (solo inserción, RN-AUD-03) */
    log(event, o = {}) {
      if (G._seeding) return null;
      const s = G.ctx.session;
      return D.insert('access_log', Object.assign({ at: G.date.now(), user_id: G.ctx.userId(), user_name: G.ctx.userName(), role: G.ctx.role, event, ip: A.clientIp, device: s && s.via === 'mobile' ? DEVICES[3] : DEVICES[0], session_id: s ? 'ses-' + G.util.pad(String(s.at || '').replace(/\D/g, '').slice(-6), 6) : null, result: ['PERMISSION_DENIED', 'MODULE_DISABLED', 'LOGIN_FAILED', 'MFA_FAILED', 'LOCKED'].includes(event) ? 'DENIED' : 'OK', detail: '' }, o), { silent: true });
    },
    /** filas de access_log escritas por otros módulos (SEG) con las columnas occurred_at/user_agent/details: completa at, usuario, rol, dispositivo y detalle */
    normalize() {
      let n = 0;
      for (const x of D.all('access_log')) {
        if (x.at != null || !x.occurred_at) continue;
        const u = D.get('users', x.user_id) || {};
        x.at = x.occurred_at; x.user_name = x.user_name || u.name || x.email_attempted || '—'; x.role = x.role || u.role || null; x.device = x.device || x.user_agent || '—';
        if (x.detail == null) { const d = x.details || {}; x.detail = typeof d === 'string' ? d : Object.entries(d).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '); }
        if (!x.result) x.result = ['PERMISSION_DENIED', 'MODULE_DISABLED', 'LOGIN_FAILED', 'MFA_FAILED', 'LOCKED'].includes(x.event) ? 'DENIED' : 'OK';
        n++;
      }
      return n;
    },
    /** pasa a la bitácora los ingresos que registra el inicio de sesión del núcleo */
    syncAuth() {
      A.normalize();
      const done = new Set(D.all('access_log').map(x => x.src_audit_id).filter(Boolean));
      const MAP = { INICIO_SESION: ['LOGIN_OK'], INICIO_FALLIDO: ['LOGIN_FAILED'], BLOQUEO: ['LOGIN_FAILED', 'LOCKED'], CIERRE_SESION: ['LOGOUT'], SEGURIDAD: ['PASSWORD_RESET'] };
      let n = 0;
      for (const a of D.all('audit').filter(a => a.entity === 'users' && MAP[a.action] && !done.has(a.id))) {
        for (const ev of MAP[a.action]) { const evx = ev === 'LOGIN_FAILED' && /segundo factor/i.test(a.detail || '') ? 'MFA_FAILED' : ev; const u = D.get('users', a.entity_id) || {}; D.insert('access_log', { at: a.at, user_id: a.entity_id, user_name: a.user, role: a.role, event: evx, ip: A.clientIp, device: DEVICES[0], session_id: null, result: ['LOGIN_OK', 'LOGOUT', 'PASSWORD_RESET'].includes(evx) ? 'OK' : 'DENIED', detail: evx === 'LOCKED' ? `Cuenta de ${u.email || a.user} bloqueada tras 5 intentos` : a.detail, src_audit_id: a.id }, { silent: true }); n++; }
      }
      return n;
    },
    /** historia de un registro: cambios (y estados, si es un pedido) en orden */
    history(entity, id) {
      if (!G.can('aud.record_history.view')) G.fail('RN-AUD-09', `Tu rol (${G.roleName()}) no tiene el permiso aud.record_history.view.`);
      const all = D.all('audit'); const rows = [];
      all.forEach((a, i) => { if (a.entity === entity && a.entity_id === id) rows.push(Object.assign({ _i: i, op: opOf(a) }, a)); });
      return rows.sort((a, b) => String(a.at).localeCompare(String(b.at)) || a._i - b._i);
    },
    historyPanel(entity, id) {
      const box = h('div', { class: 'stack' });
      if (!G.can('aud.record_history.view')) { box.appendChild(notice(`RN-AUD-09: tu rol (${G.roleName()}) no ve la historia de los registros.`, 'info')); return box; }
      const items = A.history(entity, id).map(a => ({ at: a.at, kind: 'change', a }));
      if (entity === 'sales_orders') { const o = D.get('sales_orders', id); for (const x of (o && o.history) || []) items.push({ at: x.at, kind: 'state', x }); }
      for (const l of D.where('access_log', l => l.entity === entity && l.entity_id === id)) items.push({ at: l.at, kind: 'access', l });
      items.sort((a, b) => String(a.at).localeCompare(String(b.at)));
      if (!items.length) { box.appendChild(h('p', { class: 'muted small' }, 'Sin cambios registrados desde la puesta en marcha.')); return box; }
      const showPII = canPII();
      box.appendChild(h('div', { class: 'timeline' }, items.map(it => h('div', { class: 'tl-item' },
        h('span', { class: 'when' }, F.date(it.at).slice(0, 5) + ' ' + String(it.at).slice(11, 16)),
        h('span', { class: 'dot', style: it.kind === 'access' ? 'background:var(--warn)' : it.kind === 'state' ? 'background:var(--info)' : '' }),
        h('div', { class: 'small', style: 'min-width:0' },
          it.kind === 'change' ? [h('div', { class: 'row', style: 'gap:6px' }, opBadge(it.a), h('b', null, it.a.user), h('span', { class: 'muted' }, G.roleName(it.a.role))), diffList(it.a, showPII), it.a.detail && opOf(it.a) !== 'UPDATE' ? h('div', { class: 'muted' }, it.a.detail) : null]
            : it.kind === 'state' ? [h('b', null, it.x.user), ` cambió el estado: ${it.x.from ? G.ui.statusLabel(it.x.from) : 'nuevo'} → ${G.ui.statusLabel(it.x.to)}`, it.x.reason ? h('div', { class: 'muted' }, it.x.reason) : null]
              : [evBadge(it.l.event), ' ', h('b', null, it.l.user_name), h('div', { class: 'muted' }, it.l.detail)])))));
      box.appendChild(h('p', { class: 'small muted' }, 'Horas en America/Lima (RN-AUD-11).'));
      return box;
    },
    /* ---------- exportaciones (RN-AUD-05, RN-AUD-06) ---------- */
    REPORTS: {
      order_contacts: { name: 'Contactos de clientes por pedido (nombre, celular y dirección)', personal: true, rows: f => D.where('sales_orders', o => o.created_at.slice(0, 10) >= f.from && o.created_at.slice(0, 10) <= f.to && (!f.brand || o.brand_id === f.brand)).map(o => { const c = D.get('customers', o.customer_id) || {}; const ad = D.get('customer_addresses', o.address_id) || {}; return { pedido: o.number, fecha: o.created_at.slice(0, 10), marca: G.brandName(o.brand_id), cliente: c.full_name, celular: o.contact_phone || c.phone, direccion: ad.address_line || '' }; }) },
      customers: { name: 'Clientes con teléfono y correo', personal: true, rows: f => D.where('customers', c => c.status === 'ACTIVE' && c.phone && (!f.optin || c.marketing_opt_in)).map(c => ({ cliente: c.full_name, documento: c.doc_number || '', celular: c.phone, correo: c.email || '', acepta_marketing: c.marketing_opt_in ? 'Sí' : 'No' })) },
      employees: { name: 'Trabajadores con documento y celular', personal: true, rows: () => D.all('employees').map(e => ({ documento: `${e.doc_type} ${e.doc_number}`, nombre: e.full_name, cargo: e.position, celular: e.phone || '', estado: e.status })) },
      orders: { name: 'Pedidos (sin datos personales)', personal: false, rows: f => D.where('sales_orders', o => o.created_at.slice(0, 10) >= f.from && o.created_at.slice(0, 10) <= f.to && (!f.brand || o.brand_id === f.brand)).map(o => ({ pedido: o.number, fecha: o.created_at.slice(0, 10), marca: G.brandName(o.brand_id), canal: G.channelName(o.channel), estado: o.status, total: o.final_total ?? o.estimated_total })) },
      payments: { name: 'Cobros', personal: false, rows: f => D.where('payments', p => String(p.paid_at).slice(0, 10) >= f.from && String(p.paid_at).slice(0, 10) <= f.to && (!f.brand || p.brand_id === f.brand)).map(p => ({ cobro: p.number, fecha: String(p.paid_at).slice(0, 10), medio: G.pmName(p.payment_method_id), monto: p.amount, operacion: p.reference || '' })) },
      documents: { name: 'Comprobantes emitidos (sin datos del adquiriente)', personal: false, rows: f => D.where('sales_documents', d => d.issue_date >= f.from && d.issue_date <= f.to && (!f.brand || d.brand_id === f.brand)).map(d => ({ comprobante: d.full_number, fecha: d.issue_date, tipo: G.docTypeName(d.doc_type), subtotal: d.subtotal, igv: d.igv, total: d.total, sunat: d.sunat_status })) },
      change_log: { name: 'Bitácora de cambios', personal: false, rows: f => D.where('audit', a => String(a.at).slice(0, 10) >= f.from && String(a.at).slice(0, 10) <= f.to).map(a => ({ fecha: a.at, usuario: a.user, operacion: opOf(a), tabla: a.entity, registro: a.entity_id })) },
    },
    needsApproval(rep, n) { return rep.personal && (n > (G.param('aud_export_personal_data_rows') ?? 500) || !canPII()); },
    requestExport({ report, filters = {}, format = 'CSV', reason, fromModule }) {
      if (!G.can('aud.export.request') && !fromModule) G.fail('RN-AUD-05', `Tu rol (${G.roleName()}) no tiene el permiso aud.export.request.`);
      const rep = A.REPORTS[report]; if (!rep) G.fail('RN-AUD-05', 'Reporte no encontrado.');
      if (!reason || String(reason).trim().length < 10) G.fail('RN-AUD-05', 'Indica el motivo de la exportación (al menos 10 caracteres).');
      const f = Object.assign({ from: G.date.month(G.TODAY), to: G.TODAY }, filters);
      const n = rep.rows(f).length; const need = A.needsApproval(rep, n);
      const now = G.date.now(); const number = D.next('EXP', 'EXP-', 4);
      const x = D.insert('data_exports', { number, report, report_name: rep.name, filters: f, format, rows_count: n, contains_personal_data: rep.personal, reason: reason.trim(), status: need ? 'PENDING_APPROVAL' : 'READY', requested_by_id: G.ctx.userId(), requested_by: G.ctx.userName(), requested_role: G.ctx.role, requested_at: now, source_module: fromModule || 'AUD', approved_by: null, approved_at: null, link_expires_at: need ? null : addH(now, G.param('aud_export_link_hours') ?? 24), file_name: `${number}-${report}.${format.toLowerCase()}`, watermark: `${G.ctx.userName()} · ${F.datetime(now)} · ${number}`, downloads: [] });
      G.events.emit('export.requested', { export_id: x.id, number, personal: rep.personal, rows: n });
      const notify = (o) => (G.int && G.int.notify ? G.int.notify(o) : G.notify(o));
      if (need) for (const u of D.where('users', u => u.status === 'ACTIVE' && G.can('aud.export.approve', u.role) && u.id !== x.requested_by_id && !u.platform)) notify({ user_id: u.id, type: 'APPROVALS', severity: 'INFO', title: `Exportación ${number} por aprobar`, body: `${x.requested_by} pidió «${rep.name}» (${F.num(n)} filas con datos personales): ${x.reason}`, ref: { screen: 'AUD-05' }, module: 'AUD' });
      else { G.events.emit('export.ready', { export_id: x.id }); }
      return x;
    },
    approveExport(id) {
      const x = D.get('data_exports', id);
      if (!G.can('aud.export.approve')) G.fail('RN-AUD-06', `Aprobar exportaciones exige el permiso aud.export.approve (tu rol: ${G.roleName()}).`);
      if (x.requested_by_id === G.ctx.userId()) G.fail('RN-AUD-06', 'Quien solicita una exportación no la aprueba: pide la aprobación a otra persona.');
      if (x.status !== 'PENDING_APPROVAL') G.fail('RN-AUD-06', 'La exportación no está pendiente de aprobación.');
      const now = G.date.now();
      D.update('data_exports', id, { status: 'READY', approved_by: G.ctx.userName(), approved_by_id: G.ctx.userId(), approved_at: now, link_expires_at: addH(now, G.param('aud_export_link_hours') ?? 24) });
      G.events.emit('export.ready', { export_id: id });
      (G.int && G.int.notify ? G.int.notify : G.notify)({ user_id: x.requested_by_id, type: 'EXPORTS', severity: 'OK', title: `Exportación ${x.number} aprobada`, body: `Descárgala antes del ${F.datetime(addH(now, G.param('aud_export_link_hours') ?? 24))}.`, ref: { screen: 'AUD-05' }, module: 'AUD' });
      return D.get('data_exports', id);
    },
    rejectExport(id, reason) {
      if (!G.can('aud.export.approve')) G.fail('RN-AUD-06', `Tu rol (${G.roleName()}) no tiene el permiso aud.export.approve.`);
      if (!reason || reason.trim().length < 10) G.fail('RN-AUD-06', 'Indica el motivo del rechazo (al menos 10 caracteres).');
      const x = D.get('data_exports', id); if (x.requested_by_id === G.ctx.userId()) G.fail('RN-AUD-06', 'Quien solicita no resuelve su propia exportación.');
      D.update('data_exports', id, { status: 'REJECTED', rejected_by: G.ctx.userName(), rejected_at: G.date.now(), reject_reason: reason });
      return D.get('data_exports', id);
    },
    downloadExport(id, { at } = {}) {
      const x = D.get('data_exports', id); const now = at || G.date.now();
      if (x.status === 'PENDING_APPROVAL') G.fail('RN-AUD-06', `La exportación ${x.number} tiene ${F.num(x.rows_count)} filas con datos personales: necesita la aprobación de otra persona con aud.export.approve antes de descargarse.`);
      if (x.status === 'REJECTED') G.fail('RN-AUD-06', `La exportación ${x.number} fue rechazada: ${x.reject_reason}.`);
      if (x.status === 'EXPIRED' || (x.link_expires_at && now > x.link_expires_at)) { if (x.status !== 'EXPIRED') D.update('data_exports', id, { status: 'EXPIRED' }, { silent: true }); G.fail('RN-AUD-05', `El enlace de ${x.number} venció el ${F.datetime(x.link_expires_at)}: solicita la exportación de nuevo.`); }
      if (x.requested_by_id !== G.ctx.userId() && !['GERENTE', 'ADMIN_SISTEMA'].includes(G.ctx.role)) G.fail('RN-AUD-05', 'Solo quien la solicitó descarga la exportación.');
      D.update('data_exports', id, { downloads: (x.downloads || []).concat([{ at: now, by: G.ctx.userName() }]) }, { silent: true });
      if (x.contains_personal_data) A.log('EXPORT_DOWNLOADED', { entity: 'data_exports', entity_id: id, detail: `${x.number} · ${x.report_name} · ${F.num(x.rows_count)} filas` });
      const rows = A.REPORTS[x.report].rows(x.filters);
      const cols = rows.length ? Object.keys(rows[0]) : [];
      const csv = [`# Exportado por ${x.watermark} · Motivo: ${x.reason}`, `# Uso interno de AGROPECUARIA DON GUANDO SAC · Ley 29733 de Protección de Datos Personales`, cols.join(';'), ...rows.map(r => cols.map(c => String(r[c] ?? '').replace(/;/g, ',')).join(';'))].join('\n');
      return { csv, rows: rows.length, file: x.file_name, expires_at: x.link_expires_at, url: `https://files.aycha.pe/aycha-dg-exports/${x.file_name}?X-Amz-Expires=${(G.param('aud_export_link_hours') ?? 24) * 3600}` };
    },
    /* ---------- revisión de accesos (RN-AUD-10) ---------- */
    lastLogin(u, idx) { const l = idx ? idx[u.id] : D.where('access_log', x => x.user_id === u.id && x.event === 'LOGIN_OK').map(x => x.at).sort().pop(); return [u.last_login, l].filter(Boolean).sort().pop() || null; },
    /** aud_inactive_users */
    inactiveUsers(days = G.param('seg_inactive_user_days') ?? 60) { const idx = loginIdx(); return D.where('users', u => u.status === 'ACTIVE').filter(u => { const l = A.lastLogin(u, idx); return !l || G.date.diff(G.TODAY, l.slice(0, 10)) >= days; }); },
    reviewItems() {
      const idx = loginIdx(); const lim = G.param('seg_inactive_user_days') ?? 60;
      return D.where('users', u => u.status !== 'INACTIVE').map(u => {
        const l = A.lastLogin(u, idx); const days = l ? G.date.diff(G.TODAY, l.slice(0, 10)) : null; const flags = [];
        if (['GERENTE', 'ADMIN_SISTEMA', 'CONTADORA', 'ADMINISTRACION'].includes(u.role) && !u.twofa_enabled) flags.push('Rol sensible sin segundo factor');
        if (u.role === 'SOPORTE_PLATAFORMA' && u.status === 'ACTIVE') flags.push('Acceso de soporte permanente: debe ser temporal (OPS)');
        if (u.role === 'VENDEDORA' && !(u.brands || []).length) flags.push('Vendedora sin restricción de marca');
        if (u.status === 'LOCKED') flags.push('Cuenta bloqueada');
        if (!u.employee_id && !u.platform && u.role !== 'CLIENTE_B2B') flags.push('Sin trabajador vinculado');
        if (u.employee_id && (D.get('employees', u.employee_id) || {}).status === 'INACTIVE') flags.push('Trabajador cesado con usuario vigente');
        const proposal = (days === null || days >= lim) || flags.includes('Trabajador cesado con usuario vigente') ? 'DEACTIVATE' : flags.length ? 'CHANGE' : 'KEEP';
        return { user_id: u.id, name: u.name, email: u.email, role: u.role, brands: u.brands || [], sites: u.sites || [], status: u.status, last_login: l, days_inactive: days, flags, proposal, decision: proposal, note: '' };
      });
    },
    quarterOf(d) { const m = Number(d.slice(5, 7)); return `${d.slice(0, 4)}-T${Math.ceil(m / 3)}`; },
    startReview() {
      if (!G.can('aud.access_review.run')) G.fail('RN-AUD-10', `Tu rol (${G.roleName()}) no tiene el permiso aud.access_review.run.`);
      const q = A.quarterOf(G.TODAY); const ex = D.find('access_reviews', r => r.quarter === q); if (ex) return ex;
      const qs = `${G.TODAY.slice(0, 4)}-${U.pad((Number(q.slice(-1)) - 1) * 3 + 1, 2)}-01`;
      const r = D.insert('access_reviews', { number: 'RA-' + q, quarter: q, status: 'OPEN', opened_at: G.date.now(), due_date: G.date.add(G.date.addMonths(qs, 3), -1), reviewer: null, items: null, findings: null });
      G.events.emit('access_review.due', { review_id: r.id, quarter: q });
      return r;
    },
    closeReview(id, { decisions = {}, findings = '' } = {}) {
      if (!G.can('aud.access_review.run')) G.fail('RN-AUD-10', `Tu rol (${G.roleName()}) no tiene el permiso aud.access_review.run.`);
      const r = D.get('access_reviews', id); if (r.status !== 'OPEN') G.fail('RN-AUD-10', 'La revisión ya está cerrada.');
      const items = A.reviewItems().map(it => Object.assign(it, decisions[it.user_id] || {}));
      const deact = [];
      for (const it of items.filter(i => i.decision === 'DEACTIVATE')) { if (it.user_id === G.ctx.userId()) continue; D.update('users', it.user_id, { status: 'INACTIVE', deactivated_at: G.date.now(), deactivated_reason: `Revisión de accesos ${r.quarter}: ${it.flags.join('; ') || `sin ingreso hace ${it.days_inactive} días`}` }); deact.push(it.user_id); }
      const auto = `${items.length} usuarios revisados; ${deact.length} desactivado(s); ${items.filter(i => i.decision === 'CHANGE').length} con cambios de rol o alcance pendientes.`;
      D.update('access_reviews', id, { status: 'COMPLETED', closed_at: G.date.now(), reviewer: G.ctx.userName(), reviewer_id: G.ctx.userId(), items, deactivated: deact, findings: [auto, findings].filter(Boolean).join(' ') });
      return D.get('access_reviews', id);
    },
    /* ---------- retención y depuración (RN-AUD-08) ---------- */
    CATS: {
      CHANGE_LOG: { name: 'Auditoría de cambios', table: 'audit', at: x => x.at, keep: () => true },
      ACCESS_LOG: { name: 'Bitácora de accesos', table: 'access_log', at: x => x.at, keep: () => true },
      EXPORTS: { name: 'Exportaciones', table: 'data_exports', at: x => x.requested_at, keep: () => true },
      NOTIFICATIONS: { name: 'Notificaciones leídas', table: 'notifications', at: x => x.at, keep: x => !x.read_at },
      WEBHOOKS: { name: 'Webhooks recibidos', table: 'webhook_events', at: x => x.received_at, keep: x => x.status === 'FAILED' },
      OUTBOX: { name: 'Mensajes salientes', table: 'outbox_messages', at: x => x.created_at, keep: x => !['SENT', 'CANCELLED'].includes(x.status) },
      DOMAIN_EVENTS: { name: 'Eventos de dominio', table: 'domain_events', at: x => x.at, keep: () => false },
      RECORDINGS: { name: 'Grabaciones de llamadas', table: 'call_recordings', at: x => x.created_at, keep: () => false },
      FILES: { name: 'Archivos eliminados', table: 'file_attachments', at: x => x.deleted_at, keep: x => x.status !== 'DELETED' },
    },
    policy(cat) { return D.find('audit_retention_policies', p => p.category === cat); },
    cutoff(cat) { const p = A.policy(cat); if (!p) return null; return p.unit === 'DAYS' ? G.date.add(G.TODAY, -p.months) : G.date.addMonths(G.TODAY, -p.months); },
    eligible(cat) { const c = A.CATS[cat]; const cut = A.cutoff(cat); if (!c || !cut) return []; return D.all(c.table).filter(x => { const t = c.at(x); return t && String(t).slice(0, 10) < cut && !c.keep(x); }); },
    setPolicy(cat, { months, archive, reason }) {
      if (!G.can('aud.retention.manage')) G.fail('RN-AUD-08', `Tu rol (${G.roleName()}) no tiene el permiso aud.retention.manage.`);
      const min = (G.param('aud_retention_years') ?? 5) * 12;
      if (['CHANGE_LOG', 'ACCESS_LOG'].includes(cat) && Number(months) < min) G.fail('RN-AUD-08', `La auditoría de cambios y la bitácora de accesos se conservan al menos ${min} meses (${G.param('aud_retention_years') ?? 5} años).`);
      if (!(Number(months) > 0)) G.fail('RN-AUD-08', 'El plazo debe ser mayor que cero.');
      if (!reason || reason.trim().length < 10) G.fail('RN-AUD-08', 'Cambiar una política de retención exige motivo (al menos 10 caracteres).');
      const p = A.policy(cat); D.update('audit_retention_policies', p.id, { months: Number(months), archive_before_purge: !!archive, reason, updated_by: G.ctx.userName() });
      return A.policy(cat);
    },
    runPurge(cat) {
      if (!G.can('aud.retention.manage')) G.fail('RN-AUD-08', `Tu rol (${G.roleName()}) no tiene el permiso aud.retention.manage.`);
      const c = A.CATS[cat]; const p = A.policy(cat); const started = G.date.now();
      const rows = A.eligible(cat); const ids = new Set(rows.map(x => x.id));
      const archive = p.archive_before_purge && rows.length ? `s3://aycha-dg-archive/${G.ctx.tenant}/${cat.toLowerCase()}/${G.TODAY}.jsonl.gz.enc` : null;
      const hash = rows.length ? (G.int && G.int.sha256 ? G.int.sha256(JSON.stringify(rows)) : String(rows.length)) : null;
      if (rows.length) D.t[c.table] = D.raw(c.table).filter(x => !ids.has(x.id));
      D.touch();
      const run = D.insert('audit_purge_runs', { number: D.next('DEP', 'DEP-', 4), category: cat, cutoff_date: A.cutoff(cat), archived_rows: archive ? rows.length : 0, purged_rows: rows.length, archive_file: archive, archive_sha256: hash, status: 'COMPLETED', started_at: started, finished_at: G.date.now(), run_by: G.ctx.userName() }, { silent: true });
      G.events.emit('purge.completed', { run_id: run.id, category: cat, purged: rows.length });
      return run;
    },
  };
  const addH = (s, n) => new Date(new Date(String(s).slice(0, 19) + 'Z').getTime() + n * 3600000).toISOString().slice(0, 19);
  const loginIdx = () => { A.normalize(); const m = {}; for (const x of D.all('access_log')) if (x.event === 'LOGIN_OK' && (!m[x.user_id] || x.at > m[x.user_id])) m[x.user_id] = x.at; return m; };

  // 403 por permiso o por módulo apagado → bitácora de accesos (RN-AUD-04)
  const origRequire = G.require;
  G.require = function (perm, fn) { if (!G.can(perm) && !G._seeding) A.log('PERMISSION_DENIED', { detail: `Sin el permiso ${perm}` }); return origRequire(perm, fn); };
  const origAssertMod = G.assertMod;
  G.assertMod = function (code) { try { return origAssertMod(code); } catch (e) { if (!G._seeding) A.log('MODULE_DISABLED', { detail: `Módulo ${code} apagado (RN-PLT-07)` }); throw e; } };
  const origGo = G.go;
  G.go = function (code, params) { const sc = G.screens[code]; if (code !== 'HOME' && sc && !G.screenVisible(sc) && !G._seeding) A.log('PERMISSION_DENIED', { detail: `Pantalla ${code} · ${sc.name}` }); return origGo(code, params); };

  /* =====================================================================
     Semilla (orden 16): historia de cambios, accesos, exportaciones,
     políticas, corridas de depuración y revisiones
     ===================================================================== */
  // al final de la siembra: normaliza la bitácora que escribieron otros módulos (SEG) con sus columnas
  G.seed(89, function seedAUDnorm() { A.normalize(); }, 'AUD normaliza bitácora');
  G.seed(16, function seedAUD() {
    const ins = (t, row) => D.insert(t, row, { silent: true });
    const r = U.rng(160016);
    // respaldo sin MAE (build aislado): la vendedora de campaña sin ingreso hace 90 días que usa CA-AUD-06 (mismos datos que siembra MAE)
    if (!D.get('users', 'us-fcampos')) {
      if (!D.get('employees', 'em-48820155')) ins('employees', { id: 'em-48820155', doc_type: 'DNI', doc_number: '48820155', full_name: 'Fiorella Campos Ruiz', position: 'Vendedora de campaña', establishment_id: 'es-L1', cost_center_id: 'cc-VEN-M4', hire_date: '2026-05-04', phone: '+51981220455', email: 'fcampos@donguando.pe', monthly_salary: 1500, status: 'ACTIVE', terminated_on: null, termination_reason: null });
      ins('users', { id: 'us-fcampos', employee_id: 'em-48820155', name: 'Fiorella Campos Ruiz', email: 'fcampos@donguando.pe', role: 'VENDEDORA', brands: ['br-M4'], sites: [], status: 'ACTIVE', twofa_enabled: false, last_login: G.date.add(G.TODAY, -90) + 'T10:12' });
    }
    const users = D.all('users');
    const byRole = role => users.filter(u => u.role === role && u.status === 'ACTIVE');
    const one = role => byRole(role)[0] || {};
    const sec = () => U.pad(Math.floor(r() * 60), 2);
    const tm = (d, h0 = 8, h1 = 20) => `${d}T${U.pad(h0 + Math.floor(r() * (h1 - h0)), 2)}:${sec()}:${sec()}`;
    const AU = (at, u, action, entity, id, detail, before, after) => D.ensure('audit').push({ id: 'aud-s' + (++A._sc), tenant: 'DG', at, user: u.name, role: u.role, action, entity, entity_id: id, detail, before: mask(before || null), after: mask(after || null) });
    A._sc = 0;
    const admin = one('ADMIN_SISTEMA'), ger = one('GERENTE'), adm = one('ADMINISTRACION'), cont = one('CONTADORA'), sup = one('SUPERVISORA_VENTAS'), rrhh = one('RRHH'), mkt = one('MARKETING'), coord = one('COORDINADOR_DELIVERY');
    const vend = byRole('VENDEDORA').filter(u => u.id !== 'us-fcampos');
    // puesta en marcha: altas de usuarios (contraseña enmascarada) y módulos
    users.filter(u => u.employee_id && u.status === 'ACTIVE').slice(0, 12).forEach((u, i) => AU(`2026-04-0${1 + (i % 5)}T10:${U.pad(10 + i, 2)}:00`, admin, 'CREAR', 'users', u.id, u.email, null, { name: u.name, email: u.email, role: u.role, brands: u.brands, status: 'ACTIVE', pwd_hash: 'pbkdf2$310000$' + (i * 7919).toString(36), totp_secret: u.twofa_enabled ? 'JBSWY3DPEHPK3PXP' : null }));
    AU('2026-10-01T09:00:00', admin, 'EDITAR', 'tenant_modules', 'tm-TEL', 'enabled', { enabled: true }, { enabled: false, reason: 'Incluido y desactivado por decisión de gerencia (activar más adelante)' });
    AU('2026-09-12T16:40:00', admin, 'EDITAR', 'brands', 'br-M5', 'primary_color', { primary_color: '#1F5C7A' }, { primary_color: '#2A6A8C' });
    AU('2026-09-12T16:42:00', admin, 'EDITAR', 'brands', 'br-M5', 'whatsapp_display_name', { whatsapp_display_name: 'Gourmet DG' }, { whatsapp_display_name: 'Marca 5' });
    // parámetros
    [['ped_weight_tolerance_pct', 8, 10, 'Ajuste tras revisar reclamos de cuy entero (peso nominal 0,9 kg)', ger, '2026-09-03T11:20:00'], ['aud_export_personal_data_rows', 1000, 500, 'D-AUD-04: se baja el umbral por la Ley 29733', ger, '2026-09-05T09:10:00'], ['mae_fx_max_fallback_days', 3, 7, 'D-MAE-02: criterio provisional de la contadora', cont, '2026-09-08T15:00:00'], ['int_outbox_max_attempts', 5, 8, 'Más reintentos por límites de WhatsApp en campañas', admin, '2026-09-20T10:30:00']]
      .forEach(([k, b, a, why, u, at]) => AU(at, u, 'PARAMETRO', 'parameters', k, `${k}: ${b} → ${a} · ${why}`, { value: b }, { value: a, reason: why }));
    // períodos: cierre de agosto y reapertura de julio
    AU('2026-08-20T17:10:00', cont, 'EDITAR', 'accounting_periods', 'pe-2026-07', 'status', { status: 'CLOSED' }, { status: 'OPEN', reason: 'Reapertura: factura de compra de empaques recibida tarde (F001-3321)' });
    AU('2026-08-21T12:05:00', cont, 'EDITAR', 'accounting_periods', 'pe-2026-07', 'status', { status: 'OPEN' }, { status: 'CLOSED' });
    AU('2026-09-15T18:00:00', cont, 'EDITAR', 'accounting_periods', 'pe-2026-08', 'status', { status: 'OPEN' }, { status: 'CLOSED', closed_by: cont.name });
    // tipo de cambio corregido
    AU('2026-09-15T11:25:00', cont, 'EDITAR', 'exchange_rates', 'fx-2026-09-15', 'buy, sell, edit_reason', { sell: R(((D.get('exchange_rates', 'fx-2026-09-15') || {}).sell || 3.4) + 0.004, 3) }, { sell: (D.get('exchange_rates', 'fx-2026-09-15') || {}).sell, edit_reason: 'SUNAT publicó una corrección del tipo de cambio venta a las 11:20' });
    // trabajadores cesados y usuarios desactivados
    AU('2026-08-31T20:05:00', rrhh, 'EDITAR', 'employees', 'em-46281937', 'status, terminated_on, termination_reason', { status: 'ACTIVE', terminated_on: null }, { status: 'INACTIVE', terminated_on: '2026-08-31', termination_reason: 'Renuncia voluntaria' });
    AU('2026-08-31T20:05:01', rrhh, 'EDITAR', 'users', 'us-rmena', 'status, deactivated_at, deactivated_reason', { status: 'ACTIVE' }, { status: 'INACTIVE', deactivated_reason: 'RN-MAE-02: cese del trabajador (Renuncia voluntaria)' });
    AU('2026-09-30T18:30:00', rrhh, 'EDITAR', 'employees', 'em-47719320', 'status, terminated_on, termination_reason', { status: 'ACTIVE', terminated_on: null }, { status: 'INACTIVE', terminated_on: '2026-09-30', termination_reason: 'Término de contrato' });
    // medios de pago y comisiones
    AU('2026-09-28T10:00:00', adm, 'CREAR', 'payment_method_fees', 'pmf-MP-2', 'Mercado Pago 3,99 % desde 01/10', null, D.get('payment_method_fees', 'pmf-MP-2'));
    AU('2026-09-28T10:02:00', adm, 'CREAR', 'payment_method_fees', 'pmf-MP-3', 'Mercado Pago 3,49 % desde 01/11', null, D.get('payment_method_fees', 'pmf-MP-3'));
    AU('2026-09-28T10:05:00', adm, 'EDITAR', 'payment_methods', 'pm-CARD', 'settlement_days', { settlement_days: 3 }, { settlement_days: 2 });
    // precios
    D.where('price_list_items', x => x.list_id === 'pl-DG-PUB').slice(0, 6).forEach((x, i) => AU(`2026-09-${U.pad(10 + i * 3, 2)}T09:${U.pad(15 + i, 2)}:00`, adm, 'EDITAR', 'price_list_items', x.id, 'price', { price: R(x.price - 2) }, { price: x.price }));
    // pedidos: cambios de vendedoras y supervisora
    const os = D.where('sales_orders', o => o.created_at.slice(0, 10) >= G.date.add(G.TODAY, -8) && o.seller_id).slice(0, 60);
    os.forEach((o, i) => {
      const u = users.find(x => x.id === o.seller_id) || vend[0]; const base = o.created_at.slice(0, 16);
      const t = k => `${base.slice(0, 13)}:${U.pad(Math.min(59, Number(base.slice(14, 16)) + k * 3), 2)}:${sec()}`;
      AU(t(1), u, 'EDITAR', 'sales_orders', o.id, 'notes', { notes: null }, { notes: o.notes || 'Tocar el timbre del 2.º piso' });
      if (i % 2 === 0) AU(t(2), u, 'EDITAR', 'sales_orders', o.id, 'contact_phone', { contact_phone: (D.get('customers', o.customer_id) || {}).phone }, { contact_phone: o.contact_phone });
      if (i % 3 === 0) AU(t(4), u, 'EDITAR', 'sales_orders', o.id, 'slot_id, slot_from, slot_to', { slot_from: '14:00', slot_to: '18:00' }, { slot_from: o.slot_from || '09:00', slot_to: o.slot_to || '13:00' });
      if (i % 5 === 0) AU(t(6), sup, 'EDITAR', 'sales_orders', o.id, 'discount_status', { discount_status: 'PENDING' }, { discount_status: 'APPROVED' });
      AU(t(7), u, 'EDITAR', 'sales_orders', o.id, 'status', { status: 'DRAFT' }, { status: 'CONFIRMED' });
    });
    // clientes: celular y dirección
    D.where('customers', c => c.customer_type === 'PERSON').slice(0, 25).forEach((c, i) => AU(tm(G.date.add(G.TODAY, -(i % 9))), vend[i % vend.length], 'EDITAR', 'customers', c.id, 'phone', { phone: '+519' + U.pad(Math.floor(r() * 99999999), 8) }, { phone: c.phone }));
    D.where('customers', c => c.customer_type === 'RESTAURANT').slice(0, 4).forEach((c, i) => AU(tm(G.date.add(G.TODAY, -i - 2)), sup, 'EDITAR', 'customers', c.id, 'payment_terms_days', { payment_terms_days: 7 }, { payment_terms_days: 15 }));
    // integraciones: rotación de credencial (enmascarada)
    AU('2026-09-01T11:20:00', admin, 'CREDENCIAL', 'integration_credentials', 'mp-token', 'Rotación de access_token: v1 (••••9921) revocada, v2 (••••3456) vigente', null, null);
    AU('2026-09-01T11:20:01', admin, 'EDITAR', 'integration_credentials', 'mp-token', 'secret_enc, last4', { secret_enc: 'enc:v1:QUJD', last4: '9921' }, { secret_enc: 'enc:v1:REVG', last4: '3456' });
    // cobros revertidos y conciliación
    D.where('payments', p => p.payment_method_id === 'pm-YAPE').slice(-3).forEach((p, i) => AU(tm(G.date.add(G.TODAY, -i - 1)), adm, 'EDITAR', 'payments', p.id, 'reconciliation_status', { reconciliation_status: 'PENDING' }, { reconciliation_status: 'MATCHED' }));
    D.ensure('audit').sort((a, b) => String(a.at).localeCompare(String(b.at)));

    /* bitácora de accesos */
    const IPS = { 'es-L1': '190.235.14.22', 'es-L2': '179.6.201.90' };
    const ipOf = u => u.role === 'REPARTIDOR' ? '179.7.' + (40 + (u.id.length % 30)) + '.' + (11 + u.id.length) : u.role === 'SOPORTE_PLATAFORMA' ? '200.48.225.130' : u.role === 'CONTADORA' ? '181.65.12.40' : IPS[(u.sites || [])[0]] || IPS['es-L1'];
    const devOf = u => ['REPARTIDOR', 'PREPARADOR', 'VISITADOR_CONSIGNACION'].includes(u.role) ? DEVICES[3] : u.role === 'GERENTE' ? (r() < 0.4 ? DEVICES[4] : DEVICES[0]) : DEVICES[Math.floor(r() * 2)];
    const L = (at, u, event, o = {}) => ins('access_log', Object.assign({ at, user_id: u.id, user_name: u.name, role: u.role, event, ip: ipOf(u), device: devOf(u), session_id: 'ses-' + Math.floor(r() * 1e6).toString(36), result: ['PERMISSION_DENIED', 'MODULE_DISABLED', 'LOGIN_FAILED', 'MFA_FAILED', 'LOCKED'].includes(event) ? 'DENIED' : 'OK', detail: '' }, o));
    const active = users.filter(u => u.status === 'ACTIVE' && u.id !== 'us-fcampos' && u.role !== 'CLIENTE_B2B');
    for (let k = 20; k >= 0; k--) {
      const d = G.date.add(G.TODAY, -k); const wd = G.date.parse(d).getUTCDay();
      for (const u of active) {
        if (wd === 0 && !['GERENTE', 'REPARTIDOR'].includes(u.role)) continue;
        if (u.role === 'AUDITOR' && k % 7) continue; if (u.role === 'SOPORTE_PLATAFORMA' && k !== 3) continue;
        if (r() < 0.12) continue;
        const at = `${d}T0${7 + Math.floor(r() * 3)}:${sec()}:${sec()}`;
        L(at, u, 'LOGIN_OK', { detail: u.twofa_enabled ? 'Contraseña correcta' : 'Inicio de sesión' });
        if (u.twofa_enabled) L(at.slice(0, 17) + U.pad(Math.min(59, Number(at.slice(17)) + 9), 2), u, 'MFA_OK', { detail: 'Código TOTP correcto' });
        if (r() < 0.3) L(`${d}T${17 + Math.floor(r() * 3)}:${sec()}:${sec()}`, u, 'LOGOUT', { detail: 'Cierre de sesión' });
      }
    }
    const fc = users.find(u => u.id === 'us-fcampos'); if (fc) L(G.date.add(G.TODAY, -90) + 'T10:12:00', fc, 'LOGIN_OK', { detail: 'Inicio de sesión' });
    // CA-AUD-05: 5 intentos fallidos desde 190.42.10.5 y bloqueo
    const betty = users.find(u => u.name.startsWith('Betty')) || vend[1];
    // si SEG (siembra 12) ya registró este bloqueo en access_log, no se duplica el incidente
    if (!D.find('access_log', l => l.user_id === betty.id && l.ip === '190.42.10.5' && l.event === 'LOCKED')) {
      for (let k = 0; k < 5; k++) L(`2026-10-08T22:4${k}:1${k}`, betty, 'LOGIN_FAILED', { ip: '190.42.10.5', device: 'Chrome 118 · Windows 10', detail: `Contraseña incorrecta (intento ${k + 1} de 5)` });
      L('2026-10-08T22:44:20', betty, 'LOCKED', { ip: '190.42.10.5', device: 'Chrome 118 · Windows 10', detail: 'Cuenta bloqueada tras 5 intentos fallidos' });
    }
    L('2026-10-09T08:05:00', admin, 'UNLOCKED', { detail: `Cuenta de ${betty.name} desbloqueada tras confirmar por teléfono que no fue ella`, entity: 'users', entity_id: betty.id });
    L('2026-10-09T08:06:30', admin, 'PASSWORD_RESET', { detail: `Restablecimiento de contraseña de ${betty.name}`, entity: 'users', entity_id: betty.id });
    // otros eventos de control
    const kev = one('PRACTICANTE_CONTABLE'), caj = one('CAJERO');
    L(G.date.add(G.TODAY, -2) + 'T11:20:00', kev, 'PERMISSION_DENIED', { detail: 'Pantalla CNT-08 · Cierre contable (sin permiso cnt.period.close)' });
    L(G.date.add(G.TODAY, -2) + 'T11:21:10', kev, 'PERMISSION_DENIED', { detail: 'Sin el permiso fac.document.void' });
    L(G.date.add(G.TODAY, -1) + 'T16:02:00', vend[0], 'PERMISSION_DENIED', { detail: 'Sin el permiso ped.discount.approve' });
    L(G.date.add(G.TODAY, -6) + 'T12:30:00', caj, 'PERMISSION_DENIED', { detail: 'Sin el permiso caj.payment.reverse' });
    for (let k = 0; k < 3; k++) L(G.date.add(G.TODAY, -k - 1) + 'T10:1' + k + ':00', sup, 'MODULE_DISABLED', { detail: 'Módulo TEL apagado (RN-PLT-07) · intento de abrir la central de llamadas' });
    L('2026-08-31T20:05:02', rrhh, 'SESSION_REVOKED', { detail: 'Sesión de Ronald Mena Cáceres cerrada por cese (RN-SEG-18)', entity: 'users', entity_id: 'us-rmena' });
    D.where('file_attachments', f => f.classification === 'PERSONAL_DATA').slice(0, 2).forEach((f, i) => L(G.date.add(G.TODAY, -i - 3) + 'T15:10:00', rrhh, 'FILE_DOWNLOADED', { entity: 'file_attachments', entity_id: f.id, detail: `${f.file_name} · Datos personales · enlace de 10 min` }));
    D.where('file_attachments', f => f.classification === 'CONFIDENTIAL').slice(0, 2).forEach((f, i) => L(G.date.add(G.TODAY, -i - 1) + 'T12:40:00', adm, 'FILE_DOWNLOADED', { entity: 'file_attachments', entity_id: f.id, detail: `${f.file_name} · Confidencial · enlace de 10 min` }));
    L('2026-09-18T15:30:00', sup, 'RECORDING_PLAYED', { detail: 'Grabación de llamada del piloto de telefonía (cliente cu-0042, 3 min 12 s)' });
    L('2026-09-18T15:36:00', ger, 'RECORDING_PLAYED', { detail: 'Grabación de llamada del piloto de telefonía (reclamo por peso de cuy)' });
    L(G.date.add(G.TODAY, -1) + 'T09:40:00', admin, 'OUTBOX_RETRY', { detail: 'Reintento manual de un mensaje de confirmación: WhatsApp de Marca 2 recuperó la calidad' });
    L(G.date.add(G.TODAY, -4) + 'T17:00:00', one('AUDITOR'), 'AUDIT_VIEWED', { detail: 'AUD-01 filtrado por usuario: Ana Torres Lazo' });
    L(G.date.add(G.TODAY, -2) + 'T10:15:00', ger, 'SENSITIVE_VIEW', { detail: 'Datos personales sin enmascarar en AUD-01 (celulares de clientes)' });

    /* exportaciones */
    const EX = (o) => { const n = D.next('EXP', 'EXP-', 4); return ins('data_exports', Object.assign({ number: n, format: 'CSV', downloads: [], file_name: `${n}-${o.report}.${(o.format || 'CSV').toLowerCase()}`, watermark: `${o.requested_by} · ${F.datetime(o.requested_at)} · ${n}`, source_module: 'AUD' }, o)); };
    const cnt = (rep, f) => A.REPORTS[rep].rows(f).length;
    let x = EX({ report: 'payments', report_name: A.REPORTS.payments.name, filters: { from: '2026-09-01', to: '2026-09-30' }, rows_count: cnt('payments', { from: '2026-09-01', to: '2026-09-30' }), contains_personal_data: false, reason: 'Conciliación de cobros de setiembre para el cierre', status: 'READY', requested_by_id: cont.id, requested_by: cont.name, requested_role: 'CONTADORA', requested_at: '2026-10-02T09:12:00', approved_by: null, link_expires_at: '2026-10-03T09:12:00', format: 'XLSX' });
    x.downloads.push({ at: '2026-10-02T09:13:10', by: cont.name });
    x = EX({ report: 'documents', report_name: A.REPORTS.documents.name, filters: { from: '2026-09-01', to: '2026-09-30' }, rows_count: cnt('documents', { from: '2026-09-01', to: '2026-09-30' }), contains_personal_data: false, reason: 'Registro de ventas (PLE) de setiembre', status: 'EXPIRED', requested_by_id: cont.id, requested_by: cont.name, requested_role: 'CONTADORA', requested_at: '2026-10-03T15:00:00', link_expires_at: '2026-10-04T15:00:00' });
    x = EX({ report: 'employees', report_name: A.REPORTS.employees.name, filters: {}, rows_count: cnt('employees', {}), contains_personal_data: true, reason: 'Actualizar el seguro complementario de riesgo (SCTR)', status: 'READY', requested_by_id: rrhh.id, requested_by: rrhh.name, requested_role: 'RRHH', requested_at: G.date.add(G.TODAY, -3) + 'T15:00:00', link_expires_at: G.date.add(G.TODAY, -2) + 'T15:00:00' });
    x.downloads.push({ at: G.date.add(G.TODAY, -3) + 'T15:02:00', by: rrhh.name }); L(G.date.add(G.TODAY, -3) + 'T15:02:00', rrhh, 'EXPORT_DOWNLOADED', { entity: 'data_exports', entity_id: x.id, detail: `${x.number} · ${x.report_name} · ${x.rows_count} filas` });
    const fsep = { from: '2026-09-01', to: '2026-09-30' };
    x = EX({ report: 'order_contacts', report_name: A.REPORTS.order_contacts.name, filters: fsep, rows_count: cnt('order_contacts', fsep), contains_personal_data: true, reason: 'Encuesta de satisfacción de clientes de setiembre por WhatsApp', status: 'READY', requested_by_id: cont.id, requested_by: cont.name, requested_role: 'CONTADORA', requested_at: G.date.add(G.TODAY, -1) + 'T10:00:00', approved_by: ger.name, approved_by_id: ger.id, approved_at: G.date.add(G.TODAY, -1) + 'T11:30:00', link_expires_at: G.date.add(G.TODAY, 0) + 'T11:30:00' });
    const fq = { from: '2026-09-01', to: G.TODAY };
    EX({ report: 'order_contacts', report_name: A.REPORTS.order_contacts.name, filters: fq, rows_count: cnt('order_contacts', fq), contains_personal_data: true, reason: 'Campaña de reactivación de clientes con cuy entero para Navidad', status: 'PENDING_APPROVAL', requested_by_id: sup.id, requested_by: sup.name, requested_role: 'SUPERVISORA_VENTAS', requested_at: G.TODAY + 'T09:05:00', link_expires_at: null });
    EX({ report: 'customers', report_name: A.REPORTS.customers.name, filters: {}, rows_count: cnt('customers', {}), contains_personal_data: true, reason: 'Base para agencia de publicidad externa', status: 'REJECTED', requested_by_id: mkt.id, requested_by: mkt.name, requested_role: 'MARKETING', requested_at: G.date.add(G.TODAY, -5) + 'T12:00:00', rejected_by: ger.name, rejected_at: G.date.add(G.TODAY, -5) + 'T16:20:00', reject_reason: 'No se comparten datos personales con terceros sin contrato de encargo (Ley 29733)', source_module: 'CMP' });
    EX({ report: 'orders', report_name: A.REPORTS.orders.name, filters: { from: '2026-10-01', to: G.TODAY }, rows_count: cnt('orders', { from: '2026-10-01', to: G.TODAY }), contains_personal_data: false, reason: 'Ventas de octubre por canal para la reunión semanal', status: 'READY', requested_by_id: coord.id || ger.id, requested_by: ger.name, requested_role: 'GERENTE', requested_at: G.TODAY + 'T08:15:00', link_expires_at: addH(G.TODAY + 'T08:15:00', 24) });

    /* políticas de retención */
    [['CHANGE_LOG', 60, true, 'MONTHS'], ['ACCESS_LOG', 60, true, 'MONTHS'], ['EXPORTS', 12, true, 'MONTHS'], ['NOTIFICATIONS', 90, false, 'DAYS'], ['WEBHOOKS', 6, true, 'MONTHS'], ['OUTBOX', 6, false, 'MONTHS'], ['DOMAIN_EVENTS', 12, true, 'MONTHS'], ['RECORDINGS', 12, true, 'MONTHS'], ['FILES', 1, true, 'MONTHS']]
      .forEach(([c, m, a, unit]) => ins('audit_retention_policies', { id: 'arp-' + c, category: c, months: m, unit, archive_before_purge: a, reason: c === 'RECORDINGS' ? 'D-AUD-02: 12 meses, validar con abogado de datos personales' : c === 'CHANGE_LOG' || c === 'ACCESS_LOG' ? 'D-AUD-01: 5 años (a confirmar por la contadora)' : 'Puesta en marcha', updated_by: admin.name }));
    [['2026-07-01', 'NOTIFICATIONS', 0, 214], ['2026-07-01', 'WEBHOOKS', 0, 0], ['2026-08-01', 'NOTIFICATIONS', 0, 388], ['2026-08-01', 'OUTBOX', 0, 1260], ['2026-09-01', 'NOTIFICATIONS', 0, 412], ['2026-09-01', 'OUTBOX', 0, 1730], ['2026-09-01', 'WEBHOOKS', 2210, 2210], ['2026-10-01', 'NOTIFICATIONS', 0, 455], ['2026-10-01', 'OUTBOX', 0, 1904], ['2026-10-01', 'WEBHOOKS', 1980, 1980]]
      .forEach(([d, c, arch, pur], k) => ins('audit_purge_runs', { number: D.next('DEP', 'DEP-', 4), category: c, cutoff_date: c === 'NOTIFICATIONS' ? G.date.add(d, -90) : G.date.addMonths(d, -6), archived_rows: arch, purged_rows: pur, archive_file: arch ? `s3://aycha-dg-archive/DG/${c.toLowerCase()}/${d}.jsonl.gz.enc` : null, archive_sha256: arch ? (G.int ? G.int.sha256(c + d) : null) : null, status: 'COMPLETED', started_at: d + 'T03:00:00', finished_at: d + 'T03:0' + (1 + k % 8) + ':20', run_by: 'Mantenimiento programado' }));

    /* revisiones trimestrales */
    const snap = (q) => users.filter(u => u.status !== 'INACTIVE' && u.id !== 'us-fcampos').map(u => ({ user_id: u.id, name: u.name, role: u.role, decision: 'KEEP', flags: [] }));
    ins('access_reviews', { id: 'ar-2026-T2', number: 'RA-2026-T2', quarter: '2026-T2', status: 'COMPLETED', opened_at: '2026-04-01T08:00:00', due_date: '2026-06-30', closed_at: '2026-04-14T17:30:00', reviewer: ger.name, reviewer_id: ger.id, items: snap(), deactivated: [], findings: 'Puesta en marcha: se confirmaron roles y alcance por marca de las vendedoras.' });
    ins('access_reviews', { id: 'ar-2026-T3', number: 'RA-2026-T3', quarter: '2026-T3', status: 'COMPLETED', opened_at: '2026-07-01T08:00:00', due_date: '2026-09-30', closed_at: '2026-07-21T12:10:00', reviewer: ger.name, reviewer_id: ger.id, items: snap(), deactivated: [], findings: 'Se pidió activar segundo factor a administración; soporte de Intelectalab solo con acceso temporal.' });
    ins('access_reviews', { id: 'ar-2026-T4', number: 'RA-2026-T4', quarter: '2026-T4', status: 'OPEN', opened_at: '2026-10-01T08:00:00', due_date: '2026-12-31', reviewer: null, items: null, findings: null });
  }, 'AUD bitácoras');

  /* =====================================================================
     Pantallas
     ===================================================================== */
  const wrap = fn => { try { return fn(); } catch (e) { toast(e.message, 'bad'); return null; } };
  const sel = (options, value, onChange, label) => { const s = h('select', { class: 'input', attrs: { 'aria-label': label || 'Elegir' } }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, l))); s.addEventListener('change', () => onChange(s.value)); return s; };
  const dateIn = (v, onChange, label) => { const i = h('input', { class: 'input', type: 'date', value: v || '', attrs: { 'aria-label': label } }); i.addEventListener('change', () => onChange(i.value)); return i; };
  const ENT_NAMES = { sales_orders: 'Pedidos', customers: 'Clientes', brands: 'Marcas', parameters: 'Parámetros', sales_documents: 'Comprobantes', payments: 'Cobros', employees: 'Trabajadores', users: 'Usuarios', exchange_rates: 'Tipo de cambio', payment_methods: 'Medios de pago', payment_method_fees: 'Comisiones', price_list_items: 'Precios', accounting_periods: 'Períodos contables', tenant_modules: 'Módulos', integration_credentials: 'Credenciales', integration_connectors: 'Conectores', data_exports: 'Exportaciones' };
  const entName = e => ENT_NAMES[e] || e;
  const recLabel = (e, id) => { const r = D.get(e, id); if (!r) return id; return r.number || r.full_number || r.code || r.full_name || r.name || r.key || r.email || r.date || id; };
  const piiState = { reveal: false };
  const shown = (k, v) => { if (v === '***') return '***'; if (v === null || v === undefined) return '—'; if (typeof v === 'object') return JSON.stringify(v).slice(0, 160); const s = String(v); return PII[k] && !piiState.reveal ? maskPII(k, s) : s; };
  function diffList(a, showPII) {
    const b = a.before || {}, af = a.after || {};
    const keys = opOf(a) === 'INSERT' ? Object.keys(af).filter(k => !['id', 'tenant', 'created_at', 'lines', 'history'].includes(k)).slice(0, 12) : [...new Set([...Object.keys(b), ...Object.keys(af)])];
    if (!keys.length) return null;
    const prevReveal = piiState.reveal; if (showPII === false) piiState.reveal = false;
    const out = h('div', { class: 'small', style: 'display:grid;grid-template-columns:minmax(80px,auto) minmax(0,1fr);gap:2px 8px;margin-top:2px' }, keys.map(k => [h('span', { class: 'muted mono' }, k), h('span', { style: 'min-width:0;overflow-wrap:anywhere' }, opOf(a) === 'INSERT' ? shown(k, af[k]) : [h('span', { style: 'text-decoration:line-through;color:var(--muted)' }, shown(k, b[k])), ' → ', h('b', null, shown(k, af[k]))])]));
    piiState.reveal = prevReveal;
    return out;
  }
  const piiToggle = () => h('label', { class: 'check small' }, (() => { const i = h('input', { type: 'checkbox', checked: piiState.reveal }); i.addEventListener('change', () => { if (i.checked && !canPII()) { i.checked = false; toast(`Ver datos personales sin enmascarar exige aud.export.personal_data (tu rol: ${G.roleName()}).`, 'warn'); return; } piiState.reveal = i.checked; if (i.checked) A.log('SENSITIVE_VIEW', { detail: `Datos personales sin enmascarar en ${G.nav.current}` }); G.refresh(); }); return i; })(), h('span', null, 'Mostrar datos personales'));

  /* ---------- AUD-01 Consulta de cambios ---------- */
  const q1 = { entity: '', user: '', action: '', from: G.date.add(G.TODAY, -30), to: G.TODAY, id: '' };
  function renderChanges(el) {
    const body = page(el, { code: 'AUD-01', title: 'Consulta de cambios', sub: 'Quién cambió qué y cuándo: operación, antes y después campo por campo, en hora de Lima. No se modifica ni se borra (RN-AUD-02).' });
    if (!G.can('aud.change_log.view')) { body.appendChild(notice([`RN-AUD-09: la consulta completa de cambios es solo para administración del sistema, gerencia y auditoría. `, btn('Ver la historia de un registro (AUD-02)', () => G.go('AUD-02'), { sm: true })], 'warn')); return; }
    const all = D.all('audit');
    const users = [...new Set(all.map(a => a.user))].sort(); const ents = [...new Set(all.map(a => a.entity))].sort(); const acts = [...new Set(all.map(a => opOf(a)))].sort();
    body.appendChild(h('div', { class: 'grid c3' },
      sel([['', 'Tabla: todas'], ...ents.map(e => [e, `${entName(e)} (${e})`])], q1.entity, v => { q1.entity = v; G.refresh(); }, 'Tabla'),
      sel([['', 'Usuario: todos'], ...users.map(u => [u, u])], q1.user, v => { q1.user = v; if (v) A.log('AUDIT_VIEWED', { detail: `AUD-01 filtrado por usuario: ${v}` }); G.refresh(); }, 'Usuario'),
      sel([['', 'Operación: todas'], ...acts.map(o => [o, (OPL[o] || [o])[0]])], q1.action, v => { q1.action = v; G.refresh(); }, 'Operación'),
      dateIn(q1.from, v => { q1.from = v; G.refresh(); }, 'Desde'), dateIn(q1.to, v => { q1.to = v; G.refresh(); }, 'Hasta'),
      (() => { const i = h('input', { class: 'input', placeholder: 'Id o número del registro', value: q1.id, attrs: { 'aria-label': 'Registro' } }); i.addEventListener('change', () => { q1.id = i.value.trim(); G.refresh(); }); return i; })()));
    const rows = all.filter(a => (!q1.entity || a.entity === q1.entity) && (!q1.user || a.user === q1.user) && (!q1.action || opOf(a) === q1.action) && String(a.at).slice(0, 10) >= (q1.from || '0') && String(a.at).slice(0, 10) <= (q1.to || '9') && (!q1.id || a.entity_id === q1.id || String(recLabel(a.entity, a.entity_id)) === q1.id)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    body.appendChild(kpis([{ label: 'Cambios en el filtro', value: F.num(rows.length) }, { label: 'Usuarios distintos', value: F.num(new Set(rows.map(a => a.user)).size) }, { label: 'Tablas', value: F.num(new Set(rows.map(a => a.entity)).size) }, { label: 'Hoy', value: F.num(rows.filter(a => String(a.at).slice(0, 10) === G.TODAY).length) }]));
    body.appendChild(h('div', { class: 'row between' }, piiToggle(), h('span', { class: 'small muted' }, 'Secretos siempre como *** (RN-AUD-07)')));
    body.appendChild(table({ id: 'aud01', rows, onRow: a => changeDrawer(a), search: true, searchText: a => JSON.stringify([a.before, a.after, a.detail]),
      columns: [
        { key: 'at', label: 'Fecha y hora (Lima)', render: a => F.datetime(a.at) + ':' + String(a.at).slice(17, 19) },
        { key: 'user', label: 'Usuario', render: a => h('div', null, a.user, h('div', { class: 'small muted' }, G.roleName(a.role))) },
        { key: 'op', label: 'Operación', value: a => opOf(a), render: a => opBadge(a) },
        { key: 'entity', label: 'Tabla', value: a => entName(a.entity) },
        { key: 'entity_id', label: 'Registro', mono: true, value: a => String(recLabel(a.entity, a.entity_id)) },
        { key: 'chg', label: 'Antes → después', sort: false, render: a => diffList(a) || h('span', { class: 'small muted' }, mask(a.detail)) },
      ] }));
  }
  function changeDrawer(a) {
    drawer(`${(OPL[opOf(a)] || [opOf(a)])[0]} · ${entName(a.entity)}`, bd => {
      bd.appendChild(dl([['Fecha y hora', `${F.datetime(a.at)}:${String(a.at).slice(17, 19)} (America/Lima)`], ['Usuario', `${a.user} · ${G.roleName(a.role)}`], ['Operación', opBadge(a)], ['Tabla', `${entName(a.entity)} (${a.entity})`], ['Registro', `${recLabel(a.entity, a.entity_id)} (${a.entity_id})`], ['Detalle', mask(a.detail)]]));
      bd.appendChild(h('h3', null, 'Campo por campo'));
      bd.appendChild(diffList(a) || h('p', { class: 'muted' }, 'Sin valores registrados.'));
      bd.appendChild(h('div', { class: 'row', style: 'margin-top:10px' }, btn('Ver historia del registro', () => G.go('AUD-02', { entity: a.entity, id: a.entity_id }), { sm: true })));
    }, { code: 'AUD-01', wide: true });
  }

  /* ---------- AUD-02 Historia del registro ---------- */
  const q2 = { entity: 'sales_orders', id: null, q: '' };
  function renderHistory(el, p = {}) {
    if (p.entity) { q2.entity = p.entity; q2.id = p.id; }
    const body = page(el, { code: 'AUD-02', title: 'Historia del registro', sub: 'La pestaña «Historia» de cualquier ficha: línea de tiempo de cambios y accesos del registro, según tus permisos (RN-AUD-09).' });
    const PICK = { sales_orders: o => `${o.number} · ${G.custName(o.customer_id)}`, customers: c => c.trade_name || c.full_name, brands: b => b.name, sales_documents: d => d.full_number, employees: e => e.full_name, exchange_rates: x => `${F.date(x.date)} · ${x.currency}`, payment_methods: x => x.name, users: u => `${u.name} · ${u.email}`, accounting_periods: x => G.date.monthName(x.period) };
    const touched = new Set(D.all('audit').filter(a => a.entity === q2.entity).map(a => a.entity_id));
    const recs = q2.entity === 'parameters' ? [...touched].map(k => ({ id: k, key: k })) : D.all(q2.entity).filter(r => touched.has(r.id) || r.id === q2.id).slice(-300);
    if (!q2.id || !recs.some(r => r.id === q2.id)) { const withAudit = recs.filter(r => touched.has(r.id)); q2.id = (withAudit[withAudit.length - 1] || recs[0] || {}).id; }
    body.appendChild(h('div', { class: 'grid c2' },
      sel(Object.keys(PICK).concat(['parameters']).map(e => [e, entName(e)]), q2.entity, v => { q2.entity = v; q2.id = null; G.refresh(); }, 'Tipo de registro'),
      sel(recs.map(r => [r.id, q2.entity === 'parameters' ? r.key : (PICK[q2.entity] || (x => x.id))(r)]), q2.id, v => { q2.id = v; G.refresh(); }, 'Registro')));
    body.appendChild(h('p', { class: 'small muted' }, `Se listan los registros de ${entName(q2.entity).toLowerCase()} con cambios auditados. Desde cualquier ficha se abre con G.aud.historyPanel.`));
    if (!q2.id) { body.appendChild(G.ui.empty('No hay registros con historia.')); return; }
    const r = D.get(q2.entity, q2.id);
    const grid = h('div', { class: 'grid side-r' });
    grid.appendChild(card('Historia · ' + (r ? recLabel(q2.entity, q2.id) : q2.id), h('div', { class: 'stack' }, piiToggle(), A.historyPanel(q2.entity, q2.id))));
    grid.appendChild(card('Registro actual', r ? dl(Object.entries(r).filter(([k, v]) => !['lines', 'history', 'reservations', 'tenant', 'payment_ids', 'allocations', 'polygon'].includes(k) && typeof v !== 'object').slice(0, 16).map(([k, v]) => [k, String(shown(k, maskVal(k, v)))])) : h('p', { class: 'muted' }, 'Parámetro: ver PLT-10.')));
    body.appendChild(grid);
  }

  /* ---------- AUD-03 Bitácora de accesos ---------- */
  const q3 = { event: '', user: '', ip: '', from: G.date.add(G.TODAY, -14), to: G.TODAY };
  function renderAccess(el) {
    const body = page(el, { code: 'AUD-03', title: 'Bitácora de accesos', sub: 'Ingresos correctos y fallidos, segundo factor, bloqueos, cierres, recuperaciones y 403 por usuario, IP y dispositivo. Solo inserción (RN-AUD-03).' });
    if (!G.can('aud.access_log.view')) { body.appendChild(notice(`RN-AUD-09: tu rol (${G.roleName()}) no consulta la bitácora de accesos.`, 'warn')); return; }
    A.syncAuth();
    const all = D.all('access_log').filter(x => !SENSITIVE.includes(x.event));
    const rows = all.filter(x => (!q3.event || x.event === q3.event) && (!q3.user || x.user_id === q3.user) && (!q3.ip || String(x.ip).startsWith(q3.ip)) && x.at.slice(0, 10) >= q3.from && x.at.slice(0, 10) <= q3.to).sort((a, b) => b.at.localeCompare(a.at));
    const k3 = G.kpi('KPI-AUD-03', { from: G.date.add(G.TODAY, -6), to: G.TODAY });
    const wk = all.filter(x => x.at.slice(0, 10) >= G.date.add(G.TODAY, -6));
    body.appendChild(kpis([
      { label: 'Ingresos hoy', value: F.num(all.filter(x => x.event === 'LOGIN_OK' && x.at.slice(0, 10) === G.TODAY).length) },
      { label: 'Ingresos fallidos (7 días)', value: F.num(wk.filter(x => x.event === 'LOGIN_FAILED' || x.event === 'MFA_FAILED').length), tone: 'warn' },
      { label: 'Bloqueos (7 días)', value: F.num(wk.filter(x => x.event === 'LOCKED').length), tone: wk.some(x => x.event === 'LOCKED') ? 'bad' : '' },
      { label: 'Accesos denegados (7 días)', value: F.num(k3 ? k3.value : 0), sub: 'KPI-AUD-03', tone: k3 && k3.value > 5 ? 'warn' : '' },
    ]));
    const uOpts = [...new Map(all.map(x => [x.user_id, x.user_name])).entries()].sort((a, b) => String(a[1]).localeCompare(b[1]));
    body.appendChild(h('div', { class: 'grid c3' },
      sel([['', 'Evento: todos'], ...Object.entries(EVENTS).filter(([k]) => !SENSITIVE.includes(k)).map(([k, v]) => [k, v[0]])], q3.event, v => { q3.event = v; G.refresh(); }, 'Evento'),
      sel([['', 'Usuario: todos'], ...uOpts], q3.user, v => { q3.user = v; if (v) A.log('AUDIT_VIEWED', { detail: `AUD-03 filtrado por usuario: ${G.userName(v)}` }); G.refresh(); }, 'Usuario'),
      (() => { const i = h('input', { class: 'input', placeholder: 'IP (p. ej. 190.42.10.5)', value: q3.ip, attrs: { 'aria-label': 'IP' } }); i.addEventListener('change', () => { q3.ip = i.value.trim(); G.refresh(); }); return i; })(),
      dateIn(q3.from, v => { q3.from = v; G.refresh(); }, 'Desde'), dateIn(q3.to, v => { q3.to = v; G.refresh(); }, 'Hasta')));
    body.appendChild(table({ id: 'aud03', rows, columns: [
      { key: 'at', label: 'Fecha y hora (Lima)', render: x => F.datetime(x.at) + ':' + x.at.slice(17, 19) },
      { key: 'user_name', label: 'Usuario', render: x => h('div', null, x.user_name, h('div', { class: 'small muted' }, G.roleName(x.role))) },
      { key: 'event', label: 'Evento', render: x => evBadge(x.event) },
      { key: 'ip', label: 'IP', mono: true }, { key: 'device', label: 'Dispositivo' }, { key: 'session_id', label: 'Sesión', mono: true },
      { key: 'detail', label: 'Detalle', render: x => h('span', { class: 'small' }, x.detail) }] }));
    // 403 por usuario y semana
    const den = D.all('access_log').filter(x => ['PERMISSION_DENIED', 'MODULE_DISABLED'].includes(x.event));
    const wkOf = d => { const dt = G.date.parse(d); const day = (dt.getUTCDay() + 6) % 7; return G.date.add(d.slice(0, 10), -day); };
    const grp = U.groupBy(den, x => x.user_id + '|' + wkOf(x.at.slice(0, 10)));
    body.appendChild(card('Accesos denegados por usuario y semana (KPI-AUD-03)', table({ id: 'aud03w', search: false, pageSize: 10, rows: Object.entries(grp).map(([k, xs]) => ({ user: xs[0].user_name, role: xs[0].role, week: k.split('|')[1], n: xs.length, perm: xs.filter(x => x.event === 'PERMISSION_DENIED').length, mod: xs.filter(x => x.event === 'MODULE_DISABLED').length })).sort((a, b) => b.week.localeCompare(a.week) || b.n - a.n),
      columns: [{ key: 'week', label: 'Semana del', render: x => F.date(x.week) }, { key: 'user', label: 'Usuario' }, { key: 'role', label: 'Rol', value: x => G.roleName(x.role) }, { key: 'perm', label: 'Sin permiso', align: 'r' }, { key: 'mod', label: 'Módulo apagado', align: 'r' }, { key: 'n', label: 'Total', align: 'r' }] }), { flush: true }));
  }

  /* ---------- AUD-04 Accesos a datos sensibles ---------- */
  function renderSensitive(el) {
    const body = page(el, { code: 'AUD-04', title: 'Accesos a datos sensibles', sub: 'Descargas de archivos confidenciales, grabaciones reproducidas, exportaciones con datos personales y vistas sin enmascarar, por usuario y fecha (Ley 29733).' });
    if (!G.can('aud.access_log.view')) { body.appendChild(notice(`RN-AUD-09: tu rol (${G.roleName()}) no consulta los accesos a datos sensibles.`, 'warn')); return; }
    A.normalize();
    const rows = D.where('access_log', x => SENSITIVE.includes(x.event)).sort((a, b) => b.at.localeCompare(a.at));
    const by = U.groupBy(rows, 'event');
    body.appendChild(kpis(SENSITIVE.map(e => ({ label: EVENTS[e][0], value: F.num((by[e] || []).length), sub: 'desde la puesta en marcha' }))));
    const grid = h('div', { class: 'grid side-r' });
    grid.appendChild(table({ id: 'aud04', rows, columns: [{ key: 'at', label: 'Fecha y hora (Lima)', render: x => F.datetime(x.at) }, { key: 'user_name', label: 'Usuario', render: x => h('div', null, x.user_name, h('div', { class: 'small muted' }, G.roleName(x.role))) }, { key: 'event', label: 'Tipo', render: x => evBadge(x.event) }, { key: 'detail', label: 'Qué', render: x => h('span', { class: 'small' }, x.detail) }, { key: 'ip', label: 'IP', mono: true }],
      filters: [{ key: 'event', label: 'Tipo', options: SENSITIVE.map(e => [e, EVENTS[e][0]]) }, { key: 'user_id', label: 'Usuario', options: [...new Map(rows.map(x => [x.user_id, x.user_name])).entries()] }],
      onRow: x => { if (x.user_id) A.log('AUDIT_VIEWED', { detail: `AUD-04 detalle de ${x.user_name}` }); drawer(EVENTS[x.event][0], bd => bd.appendChild(dl([['Fecha y hora', F.datetime(x.at)], ['Usuario', `${x.user_name} · ${G.roleName(x.role)}`], ['IP', x.ip], ['Dispositivo', x.device], ['Registro', x.entity ? `${entName(x.entity)} · ${recLabel(x.entity, x.entity_id)}` : '—'], ['Detalle', x.detail]])), { code: 'AUD-04' }); } }));
    const byUser = U.groupBy(rows, 'user_name');
    grid.appendChild(card('Por usuario', chart.hbar({ items: Object.entries(byUser).map(([u, xs]) => ({ label: u, value: xs.length, tone: xs.length > 3 ? 'warn' : '' })).sort((a, b) => b.value - a.value), format: v => F.num(v) })));
    body.appendChild(grid);
  }

  /* ---------- AUD-05 Exportaciones ---------- */
  const q5 = { scope: 'mine' };
  function renderExports(el) {
    const me = G.ctx.userId();
    const canReq = G.can('aud.export.request'), canApp = G.can('aud.export.approve');
    const body = page(el, { code: 'AUD-05', title: 'Exportaciones', sub: `Solicita exportaciones con motivo; las que tienen datos personales de más de ${G.param('aud_export_personal_data_rows') ?? 500} filas necesitan la aprobación de otra persona (RN-AUD-06). El enlace dura ${G.param('aud_export_link_hours') ?? 24} horas y el archivo lleva marca de agua.`, actions: canReq ? [{ label: 'Solicitar exportación', kind: 'primary', icon: '+', onClick: () => reqDlg() }] : [] });
    const all = D.all('data_exports').sort((a, b) => b.requested_at.localeCompare(a.requested_at));
    const pend = all.filter(x => x.status === 'PENDING_APPROVAL');
    const k1 = G.kpi('KPI-AUD-01');
    body.appendChild(kpis([{ label: 'Por aprobar', value: F.num(pend.length), tone: pend.length ? 'warn' : '' }, { label: 'Con datos personales (mes)', value: F.num(k1 ? k1.value : 0), sub: 'KPI-AUD-01 · listas para descargar' }, { label: 'Mis exportaciones', value: F.num(all.filter(x => x.requested_by_id === me).length) }, { label: 'Rechazadas', value: F.num(all.filter(x => x.status === 'REJECTED').length) }]));
    body.appendChild(notice('D-AUD-04: umbral provisional de 500 filas.', 'info'));
    const opts = [['mine', 'Mis exportaciones']]; if (canApp) opts.push(['pending', `Por aprobar (${pend.filter(x => x.requested_by_id !== me).length})`]); if (['GERENTE', 'ADMIN_SISTEMA', 'AUDITOR'].includes(G.ctx.role)) opts.push(['all', 'Todas']);
    if (!opts.some(o => o[0] === q5.scope)) q5.scope = 'mine';
    body.appendChild(pills(opts, q5.scope, v => { q5.scope = v; G.refresh(); }));
    const rows = q5.scope === 'mine' ? all.filter(x => x.requested_by_id === me) : q5.scope === 'pending' ? pend.filter(x => x.requested_by_id !== me) : all;
    const EST = { PENDING_APPROVAL: ['Por aprobar', 'warn'], READY: ['Lista', 'ok'], REJECTED: ['Rechazada', 'bad'], EXPIRED: ['Enlace vencido', ''] };
    body.appendChild(table({ id: 'aud05' + q5.scope, rows, onRow: x => expDrawer(x), empty: q5.scope === 'mine' ? 'No has solicitado exportaciones.' : 'Nada pendiente.',
      columns: [
        { key: 'number', label: 'N.º', mono: true }, { key: 'requested_at', label: 'Solicitada', render: x => F.datetime(x.requested_at) }, { key: 'requested_by', label: 'Solicitante' },
        { key: 'report_name', label: 'Reporte' }, { key: 'rows_count', label: 'Filas', align: 'r', render: x => F.num(x.rows_count) },
        { key: 'contains_personal_data', label: 'Datos personales', render: x => x.contains_personal_data ? badge('Sí', 'warn') : 'No' },
        { key: 'reason', label: 'Motivo', render: x => h('span', { class: 'small' }, x.reason) },
        { key: 'status', label: 'Estado', render: x => { const s = x.status === 'READY' && x.link_expires_at && G.date.now() > x.link_expires_at ? 'EXPIRED' : x.status; return badge(EST[s][0], EST[s][1]); } },
      ],
      actions: x => [x.status === 'PENDING_APPROVAL' && canApp && x.requested_by_id !== me ? btn('Aprobar', () => wrap(() => { A.approveExport(x.id); toast(`${x.number} aprobada: el solicitante tiene 24 horas para descargarla`, 'ok'); G.refresh(); }), { sm: true, kind: 'primary' }) : null, x.status === 'READY' && (x.requested_by_id === me || ['GERENTE', 'ADMIN_SISTEMA'].includes(G.ctx.role)) ? btn('Descargar', () => dl0(x), { sm: true }) : null].filter(Boolean) }));
    function dl0(x) {
      wrap(() => {
        const r = A.downloadExport(x.id);
        modal(`Descarga ${x.number}`, bd => {
          bd.appendChild(dl([['Archivo', r.file], ['Filas', F.num(r.rows)], ['Enlace válido hasta', F.datetime(r.expires_at)], ['Marca de agua', x.watermark]]));
          bd.appendChild(h('pre', { class: 'mono small', style: 'white-space:pre-wrap;max-height:200px;overflow:auto;border:1px solid var(--line);border-radius:6px;padding:8px' }, r.csv.split('\n').slice(0, 8).join('\n') + (r.rows > 6 ? '\n…' : '')));
          bd.appendChild(btn('Guardar archivo', () => { try { const a = h('a', { href: URL.createObjectURL(new Blob([r.csv], { type: 'text/csv' })), download: r.file.replace(/\.xlsx$/, '.csv') }); document.body.appendChild(a); a.click(); a.remove(); } catch (e) { } }, { kind: 'primary', sm: true }));
        });
        G.refresh();
      });
    }
    function expDrawer(x) {
      drawer(`Exportación ${x.number}`, (bd, close) => {
        bd.appendChild(dl([['Reporte', x.report_name], ['Filtros', Object.entries(x.filters || {}).map(([k, v]) => `${k}: ${k === 'brand' ? G.brandName(v) : v}`).join(' · ') || '—'], ['Formato', x.format], ['Filas', F.num(x.rows_count)], ['Datos personales', x.contains_personal_data ? 'Sí' : 'No'], ['Motivo', x.reason], ['Solicitante', `${x.requested_by} · ${G.roleName(x.requested_role)} · ${F.datetime(x.requested_at)}`], ['Origen', x.source_module], ['Aprobada por', x.approved_by ? `${x.approved_by} · ${F.datetime(x.approved_at)}` : '—'], x.reject_reason ? ['Rechazo', `${x.rejected_by}: ${x.reject_reason}`] : null, ['Enlace hasta', F.datetime(x.link_expires_at)], ['Archivo', x.file_name], ['Marca de agua', x.watermark], ['Descargas', (x.downloads || []).map(d => `${d.by} ${F.datetime(d.at)}`).join('; ') || 'Ninguna']]));
        const row = h('div', { class: 'row', style: 'margin-top:10px' });
        if (x.status === 'PENDING_APPROVAL' && canApp && x.requested_by_id !== me) { row.appendChild(btn('Aprobar', () => wrap(() => { A.approveExport(x.id); close(); toast('Exportación aprobada', 'ok'); G.refresh(); }), { kind: 'primary', sm: true })); row.appendChild(btn('Rechazar', () => modal('Rechazar ' + x.number, (b2, c2) => b2.appendChild(form({ id: 'aud05rej', fields: [{ key: 'reason', label: 'Motivo', type: 'textarea', required: true }], submitLabel: 'Rechazar', onCancel: c2, onSubmit: v => { A.rejectExport(x.id, v.reason); c2(); close(); toast('Exportación rechazada', 'ok'); G.refresh(); return true; } }))), { kind: 'danger', sm: true })); }
        if (x.status === 'PENDING_APPROVAL' && x.requested_by_id === me) row.appendChild(notice('Quien solicita no aprueba: espera la aprobación de gerencia o del administrador (RN-AUD-06).', 'info'));
        row.appendChild(btn('Descargar', () => { close(); dl0(x); }, { sm: true }));
        bd.appendChild(row);
      }, { code: 'AUD-05' });
    }
    function reqDlg() {
      drawer('Solicitar exportación', (bd, close) => {
        const info = h('div');
        const upd = vals => { G.ui.clear(info); const rep = A.REPORTS[vals.report]; if (!rep) return; const n = rep.rows({ from: vals.from, to: vals.to, brand: vals.brand || null }).length; info.appendChild(notice(`${F.num(n)} filas${rep.personal ? ' con datos personales' : ''}. ${A.needsApproval(rep, n) ? 'Necesitará la aprobación de otra persona (RN-AUD-06).' : 'Se genera al instante.'}`, A.needsApproval(rep, n) ? 'warn' : 'ok')); };
        const vals0 = { report: 'orders', from: G.date.month(G.TODAY), to: G.TODAY, format: 'CSV' };
        bd.appendChild(form({ id: 'aud05new', fields: [
          { key: 'report', label: 'Reporte', type: 'select', options: Object.entries(A.REPORTS).map(([k, v]) => [k, v.name + (v.personal ? ' · datos personales' : '')]), required: true, span: 2, onChange: (v, vals) => upd(vals) },
          { key: 'from', label: 'Desde', type: 'date', required: true, onChange: (v, vals) => upd(vals) }, { key: 'to', label: 'Hasta', type: 'date', required: true, onChange: (v, vals) => upd(vals) },
          { key: 'brand', label: 'Marca', type: 'select', options: D.all('brands').map(b => [b.id, G.brandName(b.id)]), onChange: (v, vals) => upd(vals) }, { key: 'format', label: 'Formato', type: 'select', options: [['CSV', 'CSV'], ['XLSX', 'Excel (XLSX)']], required: true },
          { key: 'reason', label: 'Motivo', type: 'textarea', required: true },
        ], values: vals0, submitLabel: 'Solicitar', onCancel: close,
          onSubmit: v => { const x = A.requestExport({ report: v.report, filters: { from: v.from, to: v.to, brand: v.brand || null }, format: v.format, reason: v.reason }); close(); toast(x.status === 'READY' ? `${x.number} lista para descargar (24 horas)` : `${x.number} enviada a aprobación`, 'ok'); G.refresh(); return true; } }));
        bd.appendChild(info); upd(vals0);
      }, { code: 'AUD-05' });
    }
  }

  /* ---------- AUD-06 Políticas de retención ---------- */
  function renderRetention(el) {
    const canM = G.can('aud.retention.manage');
    const body = page(el, { code: 'AUD-06', title: 'Políticas de retención', sub: `Cuánto se conserva cada categoría y si se archiva antes de depurar. Cambios y accesos: ${G.param('aud_retention_years') ?? 5} años como mínimo (RN-AUD-08).` });
    body.appendChild(notice('D-AUD-01: 5 años a confirmar por la contadora. D-AUD-02: grabaciones 12 meses, solo supervisora de ventas y gerencia. D-AUD-03: archivo en bucket separado con bloqueo de escritura.', 'info'));
    const rows = D.all('audit_retention_policies').map(p => Object.assign({}, p, { eligible: A.eligible(p.category).length, total: D.all(A.CATS[p.category].table).length }));
    body.appendChild(table({ id: 'aud06', rows, search: false,
      columns: [
        { key: 'category', label: 'Categoría', value: p => A.CATS[p.category].name },
        { key: 'months', label: 'Conservación', render: p => p.unit === 'DAYS' ? `${p.months} días` : p.months >= 12 && p.months % 12 === 0 ? `${p.months / 12} año(s)` : `${p.months} meses` },
        { key: 'archive_before_purge', label: 'Archiva antes', render: p => p.archive_before_purge ? badge('Sí, cifrado', 'ok') : 'No' },
        { key: 'cut', label: 'Fecha de corte', value: p => A.cutoff(p.category), render: p => F.date(A.cutoff(p.category)) },
        { key: 'total', label: 'Filas actuales', align: 'r', render: p => F.num(p.total) },
        { key: 'eligible', label: 'Para depurar', align: 'r', render: p => p.eligible ? h('b', { style: 'color:var(--warn)' }, F.num(p.eligible)) : '0' },
        { key: 'reason', label: 'Motivo', render: p => h('span', { class: 'small' }, p.reason) },
      ],
      actions: p => canM ? [btn('Editar', () => editDlg(p), { sm: true, kind: 'ghost' }), p.eligible ? btn('Depurar ahora', () => G.ui.confirm({ title: 'Depurar ' + A.CATS[p.category].name.toLowerCase(), message: `Se ${p.archive_before_purge ? 'archivarán y ' : ''}depurarán ${p.eligible} fila(s) anteriores al ${F.date(A.cutoff(p.category))}. Queda registrado en AUD-07.`, confirmLabel: 'Depurar', danger: true, onConfirm: () => wrap(() => { const r = A.runPurge(p.category); toast(`${r.number}: ${r.purged_rows} fila(s) depuradas`, 'ok'); G.go('AUD-07'); }) }), { sm: true }) : null].filter(Boolean) : [] }));
    // enmascarado
    const demo = { name: 'Ana Torres Lazo', phone: '+51991203711', doc_number: '40124371', email: 'atorres@donguando.pe', pwd_hash: 'pbkdf2$310000$9a8b…', totp_secret: 'JBSWY3DPEHPK3PXP', secret_enc: 'enc:v1:Q0FTSA==', api_key: 'AIzaSyD-…' };
    body.appendChild(card('Enmascarado de datos sensibles', h('div', { class: 'grid c2' },
      h('div', { class: 'stack' }, h('p', { class: 'small' }, 'Secretos (contraseñas, TOTP, credenciales cifradas, tokens, huellas de dispositivos) se reemplazan por *** antes de grabar la auditoría (RN-AUD-07). Datos personales (celular, documento, correo, dirección) se muestran enmascarados a quien no tiene aud.export.personal_data; verlos sin máscara queda en AUD-04.'), dl(Object.entries(demo).map(([k, v]) => [k, `${String(v)}`]))),
      h('div', { class: 'stack' }, h('b', { class: 'small' }, 'Así queda en la auditoría y en pantalla'), dl(Object.entries(mask(demo)).map(([k, v]) => [k, v === '***' ? '***' : String(PII[k] ? maskPII(k, v) : v)]))))));
    function editDlg(p) {
      drawer('Retención · ' + A.CATS[p.category].name, (bd, close) => bd.appendChild(form({ id: 'aud06e', fields: [{ key: 'months', label: p.unit === 'DAYS' ? 'Días' : 'Meses', type: 'number', min: 1, required: true }, { key: 'archive', label: 'Archivar (comprimido y cifrado) antes de depurar', type: 'checkbox' }, { key: 'reason', label: 'Motivo del cambio', type: 'textarea', required: true }], values: { months: p.months, archive: p.archive_before_purge }, onCancel: close, submitLabel: 'Guardar',
        onSubmit: v => { A.setPolicy(p.category, v); close(); toast('Política actualizada', 'ok'); G.refresh(); return true; } })), { code: 'AUD-06' });
    }
  }

  /* ---------- AUD-07 Corridas de depuración ---------- */
  function renderPurges(el) {
    const canM = G.can('aud.retention.manage');
    const body = page(el, { code: 'AUD-07', title: 'Corridas de depuración', sub: 'Cada corrida de archivo y depuración con su categoría, fecha de corte, filas archivadas y depuradas, archivo generado y resultado. Solo inserción.', actions: canM ? [{ label: 'Ejecutar todas las vencidas', kind: 'primary', onClick: () => wrap(() => { let n = 0; for (const c of Object.keys(A.CATS)) if (A.policy(c) && A.eligible(c).length) { A.runPurge(c); n++; } toast(n ? `${n} corrida(s) ejecutadas` : 'No hay filas vencidas para depurar', n ? 'ok' : 'info'); G.refresh(); }) }] : [] });
    const rows = D.all('audit_purge_runs').sort((a, b) => b.started_at.localeCompare(a.started_at));
    body.appendChild(kpis([{ label: 'Corridas', value: F.num(rows.length) }, { label: 'Filas depuradas', value: F.num(U.sum(rows, r => r.purged_rows)) }, { label: 'Filas archivadas', value: F.num(U.sum(rows, r => r.archived_rows)) }, { label: 'Pendiente de depurar', value: F.num(U.sum(Object.keys(A.CATS).filter(c => A.policy(c)), c => A.eligible(c).length)), tone: 'warn' }]));
    body.appendChild(table({ id: 'aud07', rows, columns: [
      { key: 'number', label: 'N.º', mono: true }, { key: 'started_at', label: 'Inicio', render: r => F.datetime(r.started_at) }, { key: 'category', label: 'Categoría', value: r => (A.CATS[r.category] || {}).name || r.category },
      { key: 'cutoff_date', label: 'Corte', render: r => F.date(r.cutoff_date) }, { key: 'archived_rows', label: 'Archivadas', align: 'r', render: r => F.num(r.archived_rows) }, { key: 'purged_rows', label: 'Depuradas', align: 'r', render: r => F.num(r.purged_rows) },
      { key: 'archive_file', label: 'Archivo', render: r => r.archive_file ? h('span', { class: 'mono small', style: 'word-break:break-all' }, r.archive_file) : '—' }, { key: 'run_by', label: 'Ejecutó' }, { key: 'status', label: 'Resultado', render: r => G.ui.status(r.status) }],
      filters: [{ key: 'category', label: 'Categoría', options: Object.entries(A.CATS).map(([k, v]) => [k, v.name]) }] }));
  }

  /* ---------- AUD-08 Revisión de accesos ---------- */
  const decisions = {};
  function renderReview(el) {
    const canR = G.can('aud.access_review.run');
    const q = A.quarterOf(G.TODAY);
    const cur = D.find('access_reviews', r => r.quarter === q);
    const body = page(el, { code: 'AUD-08', title: 'Revisión de accesos', sub: `Revisión trimestral de usuarios, roles, alcance y último ingreso. Sin ingreso en ${G.param('seg_inactive_user_days') ?? 60} días se propone desactivar (RN-AUD-10).`, actions: !cur && canR ? [{ label: 'Iniciar revisión de ' + q, kind: 'primary', onClick: () => wrap(() => { A.startReview(); G.refresh(); }) }] : [] });
    const k2 = G.kpi('KPI-AUD-02', { from: '2026-01-01', to: G.TODAY });
    body.appendChild(kpis([{ label: 'Revisión en curso', value: cur ? cur.number : '—', sub: cur ? (cur.status === 'OPEN' ? `vence ${F.date(cur.due_date)}` : 'cerrada') : 'no iniciada' }, { label: 'Revisiones a tiempo', value: k2 ? F.pct(k2.value, 0) : '—', sub: 'KPI-AUD-02 · meta 100 %', tone: k2 && k2.value < 100 ? 'warn' : 'ok' }, { label: 'Usuarios inactivos', value: F.num(A.inactiveUsers().length), sub: `≥ ${G.param('seg_inactive_user_days') ?? 60} días sin ingreso`, tone: A.inactiveUsers().length ? 'warn' : '' }]));
    if (cur && cur.status === 'OPEN') {
      const items = A.reviewItems();
      for (const it of items) if (decisions[it.user_id]) Object.assign(it, decisions[it.user_id]);
      body.appendChild(card(`${cur.number} · abierta el ${F.date(cur.opened_at)}`, h('div', { class: 'stack' },
        table({ id: 'aud08', rows: items, pageSize: 40, columns: [
          { key: 'name', label: 'Usuario', render: it => h('div', null, h('b', null, it.name), h('div', { class: 'small muted' }, it.email)) },
          { key: 'role', label: 'Rol', value: it => G.roleName(it.role) },
          { key: 'scope', label: 'Alcance', value: it => [(it.brands.length ? it.brands.map(G.brandName).join(', ') : 'Todas las marcas'), (it.sites.length ? it.sites.map(G.siteName).join(', ') : 'Todos los locales')].join(' · ') },
          { key: 'last_login', label: 'Último ingreso', render: it => it.last_login ? h('span', { style: it.days_inactive >= (G.param('seg_inactive_user_days') ?? 60) ? 'color:var(--bad);font-weight:700' : '' }, `${F.date(it.last_login)} (${F.days(it.days_inactive)})`) : 'Nunca' },
          { key: 'flags', label: 'Hallazgos', render: it => it.flags.length ? h('div', { class: 'small', style: 'color:var(--warn)' }, it.flags.join('; ')) : '—' },
          { key: 'proposal', label: 'Propuesta', render: it => badge({ KEEP: 'Mantener', CHANGE: 'Cambiar', DEACTIVATE: 'Desactivar' }[it.proposal], { KEEP: 'ok', CHANGE: 'warn', DEACTIVATE: 'bad' }[it.proposal]) },
          { key: 'decision', label: 'Decisión', sort: false, render: it => canR ? sel([['KEEP', 'Mantener'], ['CHANGE', 'Cambiar'], ['DEACTIVATE', 'Desactivar']], it.decision, v => { decisions[it.user_id] = Object.assign(decisions[it.user_id] || {}, { decision: v }); }, 'Decisión') : it.decision },
        ] }),
        canR ? form({ id: 'aud08close', fields: [{ key: 'findings', label: 'Hallazgos y acuerdos', type: 'textarea', required: true }], values: { findings: '' }, submitLabel: 'Cerrar la revisión', onSubmit: v => { const r = A.closeReview(cur.id, { decisions, findings: v.findings }); for (const k of Object.keys(decisions)) delete decisions[k]; toast(`${r.number} cerrada: ${r.items.length} revisados, ${r.deactivated.length} desactivado(s)`, 'ok'); G.refresh(); return true; } }) : notice(`Tu rol (${G.roleName()}) no tiene el permiso aud.access_review.run.`, 'info'))));
    }
    const past = D.all('access_reviews').filter(r => r.status === 'COMPLETED').sort((a, b) => b.quarter.localeCompare(a.quarter));
    body.appendChild(card('Revisiones cerradas', table({ id: 'aud08p', rows: past, search: false, onRow: r => drawer(r.number, bd => { bd.appendChild(dl([['Trimestre', r.quarter], ['Abierta', F.datetime(r.opened_at)], ['Cerrada', F.datetime(r.closed_at)], ['Revisor', r.reviewer], ['Hallazgos', r.findings], ['Desactivados', (r.deactivated || []).map(G.userName).join(', ') || 'Ninguno']])); bd.appendChild(table({ id: 'aud08pi', search: false, rows: r.items || [], columns: [{ key: 'name', label: 'Usuario' }, { key: 'role', label: 'Rol', value: i => G.roleName(i.role) }, { key: 'decision', label: 'Decisión', value: i => ({ KEEP: 'Mantener', CHANGE: 'Cambiar', DEACTIVATE: 'Desactivar' })[i.decision] }] })); }, { code: 'AUD-08', wide: true }),
      columns: [{ key: 'number', label: 'Revisión', mono: true }, { key: 'closed_at', label: 'Cerrada', render: r => F.date(r.closed_at) }, { key: 'reviewer', label: 'Revisor' }, { key: 'n', label: 'Revisados', align: 'r', value: r => (r.items || []).length }, { key: 'd', label: 'Desactivados', align: 'r', value: r => (r.deactivated || []).length }, { key: 'ontime', label: 'A tiempo', render: r => r.closed_at.slice(0, 10) <= r.due_date ? badge('Sí', 'ok') : badge('Tarde', 'bad') }, { key: 'findings', label: 'Hallazgos', render: r => h('span', { class: 'small' }, r.findings) }] }), { flush: true }));
  }

  /* =====================================================================
     Registro, indicadores, ganchos y pruebas
     ===================================================================== */
  const SP = G.SPEC.AUD.screens; const nm = c => (SP.find(s => s[0] === c) || [c, c])[1];
  G.register({ code: 'AUD', name: 'Auditoría', phase: 0, group: 'Plataforma', screens: [
    { code: 'AUD-01', name: nm('AUD-01'), render: renderChanges }, { code: 'AUD-02', name: nm('AUD-02'), render: renderHistory },
    { code: 'AUD-03', name: nm('AUD-03'), render: renderAccess }, { code: 'AUD-04', name: nm('AUD-04'), render: renderSensitive },
    { code: 'AUD-05', name: nm('AUD-05'), render: renderExports }, { code: 'AUD-06', name: nm('AUD-06'), render: renderRetention },
    { code: 'AUD-07', name: nm('AUD-07'), render: renderPurges }, { code: 'AUD-08', name: nm('AUD-08'), render: renderReview },
  ] });

  G.kpiCalc['KPI-AUD-01'] = ({ from, to }) => D.where('data_exports', x => x.contains_personal_data && x.status === 'READY' && x.requested_at.slice(0, 10) >= from && x.requested_at.slice(0, 10) <= to).length;
  G.kpiCalc['KPI-AUD-02'] = ({ to }) => { const done = D.where('access_reviews', r => r.status === 'COMPLETED'); const quarters = []; for (let m = '2026-04-01'; m <= to; m = G.date.addMonths(m, 3)) { const end = G.date.add(G.date.addMonths(m, 3), -1); const q = A.quarterOf(m); if (end <= to || done.some(r => r.quarter === q)) quarters.push({ q, end }); } const ok = quarters.filter(({ q, end }) => done.some(r => r.quarter === q && r.closed_at.slice(0, 10) <= end)).length; return { value: quarters.length ? R(ok / quarters.length * 100, 1) : 100, numerator: ok, denominator: quarters.length }; };
  G.kpiCalc['KPI-AUD-03'] = ({ from, to }) => { A.normalize(); const xs = D.where('access_log', x => ['PERMISSION_DENIED', 'MODULE_DISABLED'].includes(x.event) && x.at.slice(0, 10) >= from && x.at.slice(0, 10) <= to); return { value: xs.length, numerator: xs.length, denominator: new Set(xs.map(x => x.user_id)).size }; };

  G.alertProviders.push(() => {
    const out = [];
    if (G.can('aud.export.approve')) { const me = G.ctx.userId(); const p = D.where('data_exports', x => x.status === 'PENDING_APPROVAL' && x.requested_by_id !== me); if (p.length) out.push({ module: 'AUD', title: `${p.length} exportación(es) por aprobar`, detail: p.map(x => `${x.number} · ${x.requested_by}`).join(', '), tone: 'warn', go: () => G.go('AUD-05') }); }
    if (G.can('aud.access_review.run')) { const q = A.quarterOf(G.TODAY); const r = D.find('access_reviews', x => x.quarter === q); if (!r || r.status === 'OPEN') out.push({ module: 'AUD', title: `Revisión de accesos ${q} pendiente`, detail: `${A.inactiveUsers().length} usuario(s) sin ingreso reciente`, tone: 'info', go: () => G.go('AUD-08') }); }
    return out;
  });
  G.searchProviders.push(q => { const s = q.toUpperCase(); return D.all('data_exports').filter(x => x.number === s).map(x => ({ label: x.number, sub: 'Exportación · ' + x.report_name, go: () => G.go('AUD-05') })); });

  const assert = (c, m) => { if (!c) throw new Error(m); };
  const throwsRule = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e; throw new Error(`Se esperaba ${code} y salió: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code}`); };
  const asRole = async (role, fn) => { const prev = G.ctx.role; try { G.ctx.role = role; return await fn(); } finally { G.ctx.role = prev; } };
  G.tests.push({ module: 'AUD', name: 'CA-AUD-01: el administrador renombra «Marca 2» a «Marca Dos» y la gerente ve el UPDATE con el nombre anterior, el nuevo, el usuario y la hora de Lima', fn: async () => {
    const old = D.get('brands', 'br-M2').name;
    await asRole('ADMIN_SISTEMA', () => D.update('brands', 'br-M2', { name: 'Marca Dos' }));
    await asRole('GERENTE', () => {
      const hs = A.history('brands', 'br-M2'); const x = hs[hs.length - 1];
      assert(x && x.op === 'UPDATE' && x.before.name === old && x.after.name === 'Marca Dos', 'Falta el UPDATE con antes y después');
      assert(x.user === D.find('users', u => u.role === 'ADMIN_SISTEMA').name && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(x.at), 'Falta el usuario o la hora');
      const panel = A.historyPanel('brands', 'br-M2'); assert(/Marca Dos/.test(panel.textContent) && /America\/Lima/.test(panel.textContent), 'La historia no muestra el cambio en hora de Lima');
    });
  } });
  G.tests.push({ module: 'AUD', name: 'CA-AUD-02: un pedido cambiado 3 veces por la vendedora y 1 por la supervisora muestra los 4 cambios en orden en su «Historia»', fn: async () => {
    const o = D.where('sales_orders', x => x.status === 'CONFIRMED' && x.brand_id === 'br-DG')[0];
    const n0 = A.history('sales_orders', o.id).length;
    await asRole('VENDEDORA', () => { D.update('sales_orders', o.id, { notes: 'Cuy bien limpio' }); D.update('sales_orders', o.id, { contact_phone: '+51987111222' }); D.update('sales_orders', o.id, { notes: 'Cuy bien limpio, sin cabeza' }); });
    await asRole('SUPERVISORA_VENTAS', () => D.update('sales_orders', o.id, { discount_status: 'APPROVED' }));
    await asRole('SUPERVISORA_VENTAS', () => {
      const hs = A.history('sales_orders', o.id).slice(n0);
      assert(hs.length === 4, 'Deben verse 4 cambios y hay ' + hs.length);
      const vend = D.find('users', u => u.role === 'VENDEDORA' && u.status === 'ACTIVE').name, supn = D.find('users', u => u.role === 'SUPERVISORA_VENTAS').name;
      assert(hs.slice(0, 3).every(x => x.user === vend) && hs[3].user === supn, 'Los usuarios no coinciden');
      assert(hs[0].after.notes === 'Cuy bien limpio' && hs[1].after.contact_phone === '+51987111222' && hs[2].before.notes === 'Cuy bien limpio' && hs[3].after.discount_status === 'APPROVED', 'No se ve qué cambió en cada uno');
    });
  } });
  G.tests.push({ module: 'AUD', name: 'CA-AUD-03: la vendedora pide exportar más de 500 contactos con teléfono: no descarga sin aprobación (RN-AUD-06), no se aprueba a sí misma; aprobada por la gerente, el enlace dura 24 horas', fn: async () => {
    const x = await asRole('VENDEDORA', () => A.requestExport({ report: 'order_contacts', filters: { from: '2026-09-01', to: G.TODAY }, reason: 'Campaña de cuy para Navidad por WhatsApp', fromModule: 'CRM' }));
    assert(x.rows_count >= 1200 && x.contains_personal_data && x.status === 'PENDING_APPROVAL', `Debe quedar por aprobar (filas ${x.rows_count})`);
    await asRole('VENDEDORA', () => { throwsRule(() => A.downloadExport(x.id), 'RN-AUD-06'); throwsRule(() => A.approveExport(x.id), 'RN-AUD-06'); });
    const prev = G.can; G.can = (p, r) => p === 'aud.export.approve' ? true : prev(p, r);
    try { await asRole('VENDEDORA', () => throwsRule(() => A.approveExport(x.id), 'RN-AUD-06')); } finally { G.can = prev; }
    const ok = await asRole('GERENTE', () => A.approveExport(x.id));
    const hrs = (new Date(ok.link_expires_at + 'Z') - new Date(ok.approved_at.slice(0, 19) + 'Z')) / 3600000;
    assert(ok.status === 'READY' && Math.round(hrs) === 24, 'El enlace debe durar 24 horas');
    const d = await asRole('VENDEDORA', () => A.downloadExport(x.id)); assert(d.rows === x.rows_count && /Exportado por/.test(d.csv), 'Falta la marca de agua');
    assert(D.find('access_log', l => l.event === 'EXPORT_DOWNLOADED' && l.entity_id === x.id), 'La descarga debe quedar en la bitácora');
    throwsRule(() => A.downloadExport(x.id, { at: G.date.add(G.TODAY, 2) + 'T12:00:00' }), 'RN-AUD-05');
  } });
  G.tests.push({ module: 'AUD', name: 'CA-AUD-04: al dar de alta un usuario con contraseña, la auditoría muestra el hash como ***', fn: async () => {
    const u = await asRole('ADMIN_SISTEMA', () => D.insert('users', { name: 'Usuario de prueba', email: 'prueba@donguando.pe', role: 'CAJERO', brands: [], sites: [], status: 'ACTIVE', pwd_hash: 'pbkdf2$310000$c2FsdA$h4sh', totp_secret: 'JBSWY3DPEHPK3PXP' }));
    const a = D.all('audit').filter(x => x.entity === 'users' && x.entity_id === u.id).pop();
    assert(a && a.after && a.after.pwd_hash === '***' && a.after.totp_secret === '***' && a.after.email === 'prueba@donguando.pe', 'El hash debe verse como ***');
    assert(!JSON.stringify(D.raw('audit')).includes('c2FsdA$h4sh'), 'El hash quedó en la auditoría');
    await asRole('ADMIN_SISTEMA', () => D.update('users', u.id, { pwd_hash: 'pbkdf2$nuevo' }));
    const b = D.all('audit').filter(x => x.entity_id === u.id).pop(); assert(b.before.pwd_hash === '***' && b.after.pwd_hash === '***', 'El cambio de contraseña también se enmascara');
  } });
  G.tests.push({ module: 'AUD', name: 'CA-AUD-05: 5 intentos fallidos de una vendedora desde 190.42.10.5 se ven como 5 LOGIN_FAILED con la IP y el LOCKED posterior', fn: async () => {
    const betty = D.find('users', u => u.name.startsWith('Betty'));
    const xs = D.where('access_log', l => l.user_id === betty.id && l.ip === '190.42.10.5').sort((a, b) => a.at.localeCompare(b.at));
    const fails = xs.filter(l => l.event === 'LOGIN_FAILED'), lock = xs.find(l => l.event === 'LOCKED');
    assert(fails.length === 5 && lock && lock.at >= fails[4].at && xs.indexOf(lock) > xs.indexOf(fails[4]), 'Faltan los 5 LOGIN_FAILED y el LOCKED posterior');
    // en vivo, con el inicio de sesión del núcleo
    const carla = D.find('users', u => u.name.startsWith('Carla'));
    A.clientIp = '190.42.10.5';
    try { for (let i = 0; i < 5; i++) { try { G.auth.check(carla.email, 'clave-equivocada'); } catch (e) { } } A.syncAuth(); } finally { A.clientIp = '190.235.14.22'; }
    const ys = D.where('access_log', l => l.user_id === carla.id && l.ip === '190.42.10.5');
    assert(ys.filter(l => l.event === 'LOGIN_FAILED').length === 5 && ys.filter(l => l.event === 'LOCKED').length === 1, `En vivo: ${ys.map(l => l.event).join(', ')}`);
    assert(D.get('users', carla.id).status === 'LOCKED', 'La cuenta debe quedar bloqueada');
  } });
  G.tests.push({ module: 'AUD', name: 'CA-AUD-06: la revisión de octubre propone desactivar a la vendedora sin ingreso hace 90 días y al cerrarla quedan los revisados y desactivados', fn: async () => {
    const fc = D.find('users', u => u.id === 'us-fcampos');
    const it = A.reviewItems().find(i => i.user_id === fc.id);
    assert(it && it.days_inactive === 90 && it.proposal === 'DEACTIVATE', 'La vendedora inactiva debe proponerse para desactivar');
    assert(A.inactiveUsers().some(u => u.id === fc.id), 'aud_inactive_users debe incluirla');
    const rv = D.find('access_reviews', r => r.quarter === '2026-T4' && r.status === 'OPEN');
    await asRole('VENDEDORA', () => throwsRule(() => A.closeReview(rv.id, {}), 'RN-AUD-10'));
    const r = await asRole('GERENTE', () => A.closeReview(rv.id, { findings: 'Se desactiva la vendedora de campaña.' }));
    assert(r.status === 'COMPLETED' && r.items.length >= 30 && r.deactivated.includes(fc.id) && D.get('users', fc.id).status === 'INACTIVE' && r.reviewer, 'La revisión debe quedar cerrada con revisados y desactivados');
    assert(G.kpi('KPI-AUD-02', { from: '2026-01-01', to: G.TODAY }).value === 100, 'KPI-AUD-02 debe ser 100 %');
  } });
})();
