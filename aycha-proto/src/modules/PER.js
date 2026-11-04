/* =====================================================================
   PER · Personal (fase 3) · docs/fase-3/modulos/PER-personal.md
   Puestos, asignaciones con centro de costo, condiciones de pago, turnos de
   los 2 locales y del reparto, marcación por GPS o QR rotativo, asistencia
   diaria, permisos y vacaciones, adelantos, comisiones de vendedoras sobre
   lo cobrado sin IGV, bonos por entrega, pagos al personal, supervisión de
   alertas de control e intercambio con Ayni HR (la planilla legal queda fuera).
   ===================================================================== */
(function () {
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, modal, toast } = G.ui;
  const U = G.util;
  const R = (n, d = 2) => U.round(n, d);
  const P = G.per = {};

  /* ------------------------------------------------------------------
     Etiquetas
     ------------------------------------------------------------------ */
  const AREAS = [['PRODUCTION', 'Producción'], ['QUALITY', 'Calidad'], ['WAREHOUSE', 'Almacén y preparación'], ['DELIVERY', 'Reparto'], ['SALES', 'Ventas'], ['MARKETING', 'Marketing'], ['ADMIN', 'Administración'], ['FINANCE', 'Finanzas'], ['HR', 'RR. HH.'], ['OTHER', 'Otro']];
  const SCHEMES = [['MONTHLY', 'Sueldo mensual'], ['DAILY', 'Jornal diario'], ['HOURLY', 'Tarifa por hora']];
  const SOURCES = [['AYNI_HR', 'Ayni HR (API)'], ['ACCOUNTANT_FILE', 'Archivo del contador'], ['NONE', 'Sin planilla (externo)']];
  const DAYST = { PRESENT: ['Presente', 'ok'], LATE: ['Tardanza', 'warn'], ABSENT: ['Falta', 'bad'], LEAVE: ['Permiso', 'info'], REST: ['Descanso', ''], HOLIDAY: ['Feriado', ''] };
  const ADVST = { REQUESTED: ['Solicitado', 'warn'], APPROVED: ['Aprobado', 'info'], REJECTED: ['Rechazado', 'bad'], PAID: ['Pagado', 'ok'], DEDUCTED: ['Descontado', ''], CANCELLED: ['Anulado', ''] };
  const PAYST = { DRAFT: ['Borrador', ''], APPROVED: ['Aprobado', 'info'], PAID: ['Pagado', 'ok'], HELD: ['Retenido', 'bad'], VOIDED: ['Anulado', ''] };
  const CONCEPTS = [['COMMISSION', 'Comisiones'], ['DELIVERY_BONUS', 'Bono por entrega'], ['WAGE', 'Jornales'], ['BONUS', 'Bono'], ['ADVANCE_DEDUCTION', 'Descuento de adelanto'], ['FINE_DEDUCTION', 'Descuento de multa'], ['OTHER_DEDUCTION', 'Otro descuento']];
  const DEDUCT = ['ADVANCE_DEDUCTION', 'FINE_DEDUCTION', 'OTHER_DEDUCTION'];
  const SV_SRC = [['CRM_CONTROL_ALERT', 'Alerta de control CRM'], ['TEL_CALL', 'Llamada (TEL)'], ['FLO_ALERT', 'Alerta de flota'], ['FLO_FINE', 'Multa de tránsito'], ['ATTENDANCE', 'Asistencia'], ['OTHER', 'Otro']];
  const SV_ACT = [['OBSERVATION', 'Observación'], ['VERBAL_WARNING', 'Llamada de atención verbal'], ['WRITTEN_WARNING', 'Llamada de atención escrita'], ['TRAINING', 'Capacitación'], ['NO_ACTION', 'Sin acción']];
  const LEAVE_T = [['VACATION', 'Vacaciones'], ['PERMISSION', 'Permiso personal'], ['MEDICAL', 'Descanso médico']];
  const MARK_T = [['IN', 'Entrada'], ['BREAK_OUT', 'Salida a refrigerio'], ['BREAK_IN', 'Regreso de refrigerio'], ['OUT', 'Salida']];
  /* pestañas como hijo de una grilla: min-width 0 para que la tabla ancha haga scroll propio y no desborde a 390 px */
  const tabs0 = items => { const t = G.ui.tabs(items); t.style.minWidth = '0'; return t; };
  const lbl = (l, v) => (l.find(x => x[0] === v) || [v, v || '—'])[1];
  const bd = (map, s) => badge((map[s] || [s])[0], (map[s] || [, ''])[1]);
  P.HOLIDAYS = ['2026-07-28', '2026-07-29', '2026-08-06', '2026-08-30', '2026-10-08', '2026-11-01', '2026-12-08', '2026-12-09', '2026-12-25'];
  const isHoliday = d => P.HOLIDAYS.includes(d) || !!G.db.find('calendar_holidays', x => x.date === d);

  /* ------------------------------------------------------------------
     Trabajadores, asignaciones y condiciones (RN-PER-01/02/19)
     ------------------------------------------------------------------ */
  const emp = id => G.db.get('employees', id);
  const empName = id => (emp(id) || {}).full_name || '—';
  P.empName = empName;
  P.userOf = empId => G.db.find('users', u => u.employee_id === empId);
  P.empOfUser = uid => (G.db.get('users', uid) || {}).employee_id || null;
  P.myEmp = () => P.empOfUser(G.ctx.userId());
  P.canSalary = () => G.can('per.employee.view_salary') || G.ctx.role === 'RRHH';
  const money = (v, own) => P.canSalary() || own ? G.fmt.money(v) : 'Reservado (Ley 29733)';
  P.assignments = (empId, date = G.TODAY) => G.db.where('employee_assignments', a => a.employee_id === empId && a.valid_from <= date && (!a.valid_to || a.valid_to >= date));
  P.primary = (empId, date = G.TODAY) => { const as = P.assignments(empId, date); return as.find(a => a.is_primary) || as[0] || null; };
  P.position = (empId, date) => { const a = P.primary(empId, date); return a ? G.db.get('job_positions', a.position_id) : null; };
  P.area = (empId, date) => (P.position(empId, date) || {}).area || 'OTHER';
  P.site = (empId, date) => (P.primary(empId, date) || {}).establishment_id || (emp(empId) || {}).establishment_id;
  P.supervisor = (empId, date) => (P.primary(empId, date) || {}).supervisor_employee_id || null;
  P.staff = (date = G.TODAY) => G.db.where('employees', e => e.status === 'ACTIVE' && P.primary(e.id, date));
  P.setAssignments = function (empId, rows, valid_from) {
    if (!rows.length) G.fail('RN-PER-01', 'Un trabajador activo tiene al menos una asignación con puesto y local.');
    const pct = R(U.sum(rows, r => Number(r.allocation_pct) || 0), 2);
    if (Math.abs(pct - 100) > 0.001) G.fail('RN-PER-01', `Las asignaciones a centros de costo suman ${G.fmt.num(pct, 2)} % y deben sumar 100 % en cada fecha.`);
    if (rows.some(r => !r.position_id || !r.establishment_id || !r.cost_center_id)) G.fail('RN-PER-01', 'Cada asignación lleva puesto, local y centro de costo.');
    if (rows.filter(r => r.is_primary).length !== 1) G.fail('RN-PER-01', 'Marca exactamente una asignación como principal (puesto y local principal).');
    if (!valid_from) G.fail('RN-PER-01', 'Indica desde cuándo rige.');
    for (const a of G.db.where('employee_assignments', a => a.employee_id === empId && (!a.valid_to || a.valid_to >= valid_from))) {
      if (a.valid_from >= valid_from) G.db.update('employee_assignments', a.id, { valid_to: G.date.add(a.valid_from, -1), superseded: true });
      else G.db.update('employee_assignments', a.id, { valid_to: G.date.add(valid_from, -1) });
    }
    return rows.map(r => G.db.insert('employee_assignments', { employee_id: empId, position_id: r.position_id, establishment_id: r.establishment_id, cost_center_id: r.cost_center_id, supervisor_employee_id: r.supervisor_employee_id || null, allocation_pct: Number(r.allocation_pct), is_primary: !!r.is_primary, valid_from, valid_to: null }));
  };
  P.termAt = (empId, date = G.TODAY) => G.db.find('employment_terms', t => t.employee_id === empId && t.valid_from <= date && (!t.valid_to || t.valid_to >= date));
  P.monthlyPay = function (empId, date = G.TODAY) {
    const t = P.termAt(empId, date); if (!t) return Number((emp(empId) || {}).monthly_salary) || 0;
    return t.pay_scheme === 'MONTHLY' ? Number(t.monthly_amount) || 0 : t.pay_scheme === 'DAILY' ? R((t.daily_rate || 0) * 26) : R((t.hourly_rate || 0) * 208);
  };
  P.addTerm = function (d, { closePrevious = false } = {}) {
    if (!d.employee_id || !d.pay_scheme || !d.valid_from) G.fail('RN-PER-02', 'Trabajador, forma de pago y vigencia son obligatorios.');
    const amt = { MONTHLY: 'monthly_amount', DAILY: 'daily_rate', HOURLY: 'hourly_rate' }[d.pay_scheme];
    if (!(Number(d[amt]) >= 0) || d[amt] === '' || d[amt] == null) G.fail('RN-PER-02', `Indica el monto de ${lbl(SCHEMES, d.pay_scheme).toLowerCase()}.`);
    if (d.valid_to && d.valid_to < d.valid_from) G.fail('RN-PER-02', 'La vigencia termina antes de empezar.');
    const end = d.valid_to || '9999-12-31';
    const clash = G.db.where('employment_terms', t => t.employee_id === d.employee_id && t.valid_from <= end && (t.valid_to || '9999-12-31') >= d.valid_from);
    if (clash.length) {
      const open = clash.length === 1 && !clash[0].valid_to && clash[0].valid_from < d.valid_from;
      if (closePrevious && open) G.db.update('employment_terms', clash[0].id, { valid_to: G.date.add(d.valid_from, -1) });
      else G.fail('RN-PER-02', `Las condiciones se traslapan con la vigente desde el ${G.fmt.date(clash[0].valid_from)}${clash[0].valid_to ? ' hasta el ' + G.fmt.date(clash[0].valid_to) : ''}. Ciérrala el día anterior.`);
    }
    return G.db.insert('employment_terms', { employee_id: d.employee_id, pay_scheme: d.pay_scheme, monthly_amount: d.pay_scheme === 'MONTHLY' ? Number(d.monthly_amount) : null, daily_rate: d.pay_scheme === 'DAILY' ? Number(d.daily_rate) : null, hourly_rate: d.pay_scheme === 'HOURLY' ? Number(d.hourly_rate) : null, payroll_source: d.payroll_source || G.param('per_payroll_source') || 'AYNI_HR', external_ref: d.external_ref || null, valid_from: d.valid_from, valid_to: d.valid_to || null });
  };

  /* ------------------------------------------------------------------
     Tiempo (las marcas son locales: 'YYYY-MM-DDTHH:MM[:SS]')
     ------------------------------------------------------------------ */
  const toSec = s => Date.parse(String(s).slice(0, 19).padEnd(19, ':00').slice(0, 19) + 'Z') / 1000;
  const fromSec = n => new Date(n * 1000).toISOString().slice(0, 19);
  const hm = s => String(s || '').slice(11, 16);
  const minOf = t => { const [a, b] = String(t).split(':').map(Number); return a * 60 + b; };
  P.toSec = toSec; P.fromSec = fromSec;
  /** RN-PER-07: tardanza = entrada − inicio del turno − tolerancia, si es positiva */
  P.lateMinutes = (shiftStart, markTime, tol = Number(G.param('per_late_tolerance_minutes') ?? 10)) => Math.max(0, minOf(markTime) - minOf(shiftStart) - tol);
  const shiftTol = s => s && s.late_tolerance_minutes != null ? s.late_tolerance_minutes : Number(G.param('per_late_tolerance_minutes') ?? 10);
  const shiftLen = s => { let a = minOf(s.start_time), b = minOf(s.end_time); if (b <= a) b += 1440; return b - a - (s.break_minutes || 0); };

  /* ------------------------------------------------------------------
     Turnos y programación (RN-PER-08)
     ------------------------------------------------------------------ */
  P.planOf = (empId, date) => G.db.find('shift_assignments', s => s.employee_id === empId && s.work_date === date && s.status !== 'CANCELLED');
  P.setPlan = function (empId, date, { shift_id, status = 'PLANNED', note } = {}) {
    if (G.period.isClosed(date)) G.fail('RN-PLT-05', 'El período está cerrado.');
    const cur = P.planOf(empId, date);
    if (cur && cur.shift_id === shift_id && cur.status === status) return cur;
    if (cur) G.db.update('shift_assignments', cur.id, { status: cur.shift_id !== shift_id && status === 'PLANNED' ? 'CANCELLED' : 'CANCELLED', note: note || 'Cambio de programación' });
    if (status === 'CANCELLED') return null;
    const sh = shift_id || (cur && cur.shift_id);
    if (!sh) G.fail('RN-PER-07', 'Elige el turno.');
    return G.db.insert('shift_assignments', { employee_id: empId, shift_id: sh, work_date: date, status: cur && status === 'PLANNED' && cur.shift_id !== sh ? 'SWAPPED' : status, overtime_authorized_minutes: 0, overtime_authorized_by: null, note: note || null });
  };
  P.authorizeOvertime = function (saId, minutes, { user_id } = {}) {
    const uid = user_id || G.ctx.userId();
    if (!G.can('per.attendance.approve', (G.db.get('users', uid) || {}).role)) G.fail('RN-PER-08', 'Autorizar horas extra requiere per.attendance.approve (supervisor).');
    const sa = G.db.get('shift_assignments', saId);
    if (P.empOfUser(uid) === sa.employee_id) G.fail('RN-PER-08', 'Nadie autoriza sus propias horas extra.');
    G.db.update('shift_assignments', saId, { overtime_authorized_minutes: Math.max(0, Math.round(Number(minutes) || 0)), overtime_authorized_by: uid });
    return P.consolidate(sa.employee_id, sa.work_date);
  };

  /* ------------------------------------------------------------------
     QR rotativo del local (RN-PER-04)
     ------------------------------------------------------------------ */
  const fnv = s => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return x.toString(36).toUpperCase().padStart(7, '0'); };
  P.qrToken = function (site, at = G.date.now()) {
    const rot = Number(G.param('per_qr_rotation_seconds') ?? 60);
    const b = Math.floor(toSec(at) / rot) * rot;
    const hash = (G.db.get('establishments', site) || {}).code + '-' + fnv(`${G.ctx.tenant}|${site}|${b}|aycha`);
    return G.db.find('establishment_qr_tokens', t => t.token_hash === hash) || G.db.insert('establishment_qr_tokens', { establishment_id: site, token_hash: hash, valid_from: fromSec(b), valid_to: fromSec(b + rot) }, { silent: true });
  };

  /* ------------------------------------------------------------------
     Marcación (RN-PER-03/04/05/06) y consolidado diario (RN-PER-07/08)
     ------------------------------------------------------------------ */
  P.mark = function (d) {
    if (d.offline_uuid) { const dup = G.db.find('attendance_marks', m => m.offline_uuid === d.offline_uuid); if (dup) return dup; }
    const e = emp(d.employee_id); if (!e) G.fail('RN-PER-01', 'Trabajador no encontrado.');
    const at = d.at || G.date.now();
    const site = d.establishment_id || P.site(e.id, at.slice(0, 10));
    const est = G.db.get('establishments', site);
    const row = { employee_id: e.id, establishment_id: site, mark_type: d.mark_type || 'IN', marked_at: at.slice(0, 19), method: d.method, lat: d.lat ?? null, lng: d.lng ?? null, distance_m: null, qr_token_id: null, device_id: d.device_id || null, photo_url: d.photo_url || null, is_valid: true, invalid_reason: null, manual_reason: null, approved_by_employee_id: null, offline_uuid: d.offline_uuid || null };
    if (d.method === 'GEO') {
      if (d.lat == null || d.lng == null) G.fail('RN-PER-03', 'La marcación por GPS necesita la ubicación del celular.');
      const dist = R(G.geo.km([d.lat, d.lng], [est.lat, est.lng]) * 1000, 1); const rad = Number(G.param('per_geofence_radius_m') ?? 100);
      row.distance_m = dist;
      if (dist > rad) { row.is_valid = false; row.invalid_reason = `RN-PER-03: marcación a ${G.fmt.num(dist, 0)} m de ${est.short}; el radio permitido es ${rad} m.`; }
    } else if (d.method === 'QR') {
      const code = String(d.qr_token || '').trim().toUpperCase();
      const tk = G.db.find('establishment_qr_tokens', t => t.token_hash === code);
      if (!tk) G.fail('RN-PER-04', 'El código QR no corresponde a ningún local.');
      if (tk.establishment_id !== site) G.fail('RN-PER-04', `El QR es de ${G.siteName(tk.establishment_id)} y el trabajador marca en ${G.siteName(site)}.`);
      const s = toSec(at);
      if (s < toSec(tk.valid_from) || s > toSec(tk.valid_to)) G.fail('RN-PER-04', `El QR leído venció a las ${hm(tk.valid_to)} (hace ${Math.round((s - toSec(tk.valid_to)) / 60)} min); el código cambia cada ${G.param('per_qr_rotation_seconds')} segundos. Lee el QR vigente en la pantalla del local.`);
      row.qr_token_id = tk.id;
    } else if (d.method === 'MANUAL') {
      if (!String(d.manual_reason || '').trim()) G.fail('RN-PER-05', 'La marcación manual exige motivo.');
      if (!d.approved_by_employee_id) G.fail('RN-PER-05', 'La marcación manual la aprueba un supervisor.');
      if (d.approved_by_employee_id === e.id) G.fail('RN-PER-05', 'La marcación manual la aprueba una persona distinta del trabajador.');
      row.manual_reason = d.manual_reason; row.approved_by_employee_id = d.approved_by_employee_id;
    } else G.fail('RN-PER-03', 'Método de marcación no válido.');
    const m = G.db.insert('attendance_marks', row, { silent: G._seeding });
    if (!G._seeding) { G.events.emit('attendance.marked', { mark_id: m.id, employee_id: e.id, mark_type: m.mark_type, valid: m.is_valid }); P.consolidate(e.id, at.slice(0, 10)); }
    return m;
  };
  P.leaveOn = (empId, date) => G.db.find('leave_requests', l => l.employee_id === empId && l.status === 'APPROVED' && l.date_from <= date && l.date_to >= date);
  /** consolida el día del trabajador a partir de sus marcaciones válidas */
  P.consolidate = function (empId, date) {
    const sa = G.db.find('shift_assignments', s => s.employee_id === empId && s.work_date === date && ['PLANNED', 'SWAPPED', 'REST'].includes(s.status));
    const sh = sa && sa.status !== 'REST' ? G.db.get('shifts', sa.shift_id) : null;
    const lim = sh && sh.crosses_midnight ? G.date.add(date, 1) + 'T12:00' : date + 'T23:59:59';
    const ms = G.db.where('attendance_marks', m => m.employee_id === empId && m.is_valid && m.marked_at >= date + 'T00:00' && m.marked_at <= lim).sort(U.by('marked_at'));
    const ins = ms.filter(m => m.mark_type === 'IN'), outs = ms.filter(m => m.mark_type === 'OUT');
    const cur = G.db.find('attendance_days', a => a.employee_id === empId && a.work_date === date);
    const row = { employee_id: empId, work_date: date, shift_assignment_id: sa ? sa.id : null, first_in: ins.length ? ins[0].marked_at : null, last_out: outs.length ? outs[outs.length - 1].marked_at : null, worked_minutes: 0, late_minutes: 0, overtime_minutes: 0, unauthorized_minutes: 0 };
    if (row.first_in && row.last_out && row.last_out > row.first_in) {
      const bo = ms.find(m => m.mark_type === 'BREAK_OUT'), bi = ms.find(m => m.mark_type === 'BREAK_IN');
      const brk = bo && bi && bi.marked_at > bo.marked_at ? (toSec(bi.marked_at) - toSec(bo.marked_at)) / 60 : (sh ? sh.break_minutes : 0);
      row.worked_minutes = Math.max(0, Math.round((toSec(row.last_out) - toSec(row.first_in)) / 60 - brk));
    }
    if (sh && row.first_in) row.late_minutes = P.lateMinutes(sh.start_time, hm(row.first_in), shiftTol(sh));
    if (sh && row.last_out) {
      const endS = toSec((sh.crosses_midnight ? G.date.add(date, 1) : date) + 'T' + sh.end_time);
      const extra = Math.max(0, Math.round((toSec(row.last_out) - endS) / 60));
      const auth = Math.min(extra, sa.overtime_authorized_minutes || 0);
      row.overtime_minutes = auth; row.unauthorized_minutes = extra - auth;
    }
    let status;
    if (P.leaveOn(empId, date)) status = 'LEAVE';
    else if (row.first_in) status = row.late_minutes > 0 ? 'LATE' : 'PRESENT';
    else if (isHoliday(date)) status = 'HOLIDAY';
    else if (!sa || sa.status === 'REST') status = 'REST';
    else if (date < G.TODAY) status = 'ABSENT';
    else return cur || null;
    if (cur && cur.justification_approved && ['LATE', 'ABSENT'].includes(status)) status = status === 'ABSENT' ? 'LEAVE' : 'PRESENT';
    row.status = status;
    if (cur) return G.db.update('attendance_days', cur.id, row, { silent: true });
    return G.db.insert('attendance_days', row, { silent: true });
  };
  P.justify = function (dayId, { text, approver_user_id }) {
    const d = G.db.get('attendance_days', dayId);
    if (!String(text || '').trim()) G.fail('RN-PER-05', 'La justificación exige el motivo.');
    const uid = approver_user_id || G.ctx.userId();
    if (!G.can('per.attendance.approve', (G.db.get('users', uid) || {}).role)) G.fail('RN-PER-05', 'Aprobar justificaciones requiere per.attendance.approve.');
    if (P.empOfUser(uid) === d.employee_id) G.fail('RN-PER-05', 'La justificación la aprueba una persona distinta del trabajador.');
    G.db.update('attendance_days', dayId, { justification: text, approved_by: uid, justification_approved: true });
    return P.consolidate(d.employee_id, d.work_date);
  };
  /* permisos y vacaciones */
  P.requestLeave = function (d) {
    if (!d.employee_id || !d.date_from || !d.date_to || !d.leave_type) G.fail('RN-PER-05', 'Trabajador, tipo y fechas son obligatorios.');
    if (d.date_to < d.date_from) G.fail('RN-PER-05', 'La fecha final es anterior a la inicial.');
    if (G.db.find('leave_requests', l => l.employee_id === d.employee_id && ['REQUESTED', 'APPROVED'].includes(l.status) && l.date_from <= d.date_to && l.date_to >= d.date_from)) G.fail('RN-PER-05', 'Ya hay un permiso o vacaciones en esas fechas.');
    return G.db.insert('leave_requests', { employee_id: d.employee_id, leave_type: d.leave_type, date_from: d.date_from, date_to: d.date_to, days: G.date.diff(d.date_to, d.date_from) + 1, reason: d.reason || '', status: 'REQUESTED', requested_by: d.requested_by || G.ctx.userId(), approved_by: null });
  };
  P.decideLeave = function (id, approve, { user_id, note } = {}) {
    const l = G.db.get('leave_requests', id); const uid = user_id || G.ctx.userId();
    if (l.status !== 'REQUESTED') G.fail('RN-PER-05', 'La solicitud ya fue resuelta.');
    if (uid === l.requested_by || P.empOfUser(uid) === l.employee_id) G.fail('RN-PER-05', 'Quien pide el permiso no lo aprueba.');
    if (!G.can('per.attendance.approve', (G.db.get('users', uid) || {}).role)) G.fail('RN-PER-05', 'Requiere per.attendance.approve.');
    G.db.update('leave_requests', id, { status: approve ? 'APPROVED' : 'REJECTED', approved_by: uid, decided_at: G.date.now(), decision_note: note || null });
    if (approve) for (let d = l.date_from; d <= l.date_to && d <= G.TODAY; d = G.date.add(d, 1)) P.consolidate(l.employee_id, d);
    return G.db.get('leave_requests', id);
  };

  /* ------------------------------------------------------------------
     Adelantos (RN-PER-09)
     ------------------------------------------------------------------ */
  P.advanceMax = (empId, date = G.TODAY) => R(P.monthlyPay(empId, date) * Number(G.param('per_advance_max_pct') ?? 30) / 100);
  P.requestAdvance = function (d) {
    const max = P.advanceMax(d.employee_id, d.requested_on || G.TODAY);
    if (!(Number(d.amount) > 0)) G.fail('RN-PER-09', 'El monto del adelanto debe ser mayor que cero.');
    if (Number(d.amount) > max) G.fail('RN-PER-09', `El adelanto de ${G.fmt.money(d.amount)} supera el ${G.param('per_advance_max_pct')} % de la remuneración mensual (${G.fmt.money(P.monthlyPay(d.employee_id))}): máximo ${G.fmt.money(max)}.`);
    const open = G.db.find('salary_advances', a => a.employee_id === d.employee_id && ['REQUESTED', 'APPROVED', 'PAID'].includes(a.status));
    if (open) G.fail('RN-PER-09', `${empName(d.employee_id)} ya tiene un adelanto abierto (${G.fmt.money(open.amount)}, ${ADVST[open.status][0].toLowerCase()}).`);
    if (!String(d.reason || '').trim()) G.fail('RN-PER-09', 'Indica el motivo del adelanto.');
    return G.db.insert('salary_advances', { employee_id: d.employee_id, requested_by: d.requested_by || G.ctx.userId(), requested_on: d.requested_on || G.TODAY, amount: R(Number(d.amount)), reason: d.reason, status: 'REQUESTED', approved_by: null, approved_at: null, deduct_period: d.deduct_period || G.date.month(G.TODAY), payment_id: null });
  };
  P.decideAdvance = function (id, approve, { user_id, note } = {}) {
    const a = G.db.get('salary_advances', id); const uid = user_id || G.ctx.userId();
    if (a.status !== 'REQUESTED') G.fail('RN-PER-09', 'El adelanto ya fue resuelto.');
    if (uid === a.requested_by || P.empOfUser(uid) === a.employee_id) G.fail('RN-PER-09', 'Lo aprueba una persona distinta de quien lo pide.');
    if (!G.can('per.advance.approve', (G.db.get('users', uid) || {}).role)) G.fail('RN-PER-09', 'Aprobar adelantos requiere per.advance.approve.');
    return G.db.update('salary_advances', id, { status: approve ? 'APPROVED' : 'REJECTED', approved_by: uid, approved_at: G.date.now(), decision_note: note || null });
  };
  P.payAdvance = function (id, { cash_account_id = 'ca-BCP-CTE', reference } = {}) {
    const a = G.db.get('salary_advances', id);
    if (a.status !== 'APPROVED') G.fail('RN-PER-09', 'Solo se paga un adelanto aprobado.');
    return G.db.update('salary_advances', id, { status: 'PAID', paid_at: G.date.now(), cash_account_id, payment_reference: reference || null });
  };

  /* ------------------------------------------------------------------
     Comisiones sobre lo cobrado y bonos por entrega (RN-PER-10…15)
     ------------------------------------------------------------------ */
  P.closeDate = p => G.date.add(G.date.addMonths(G.date.month(p), 1), Number(G.param('per_commission_close_day') ?? 5) - 1);
  P.periodClosed = p => G.TODAY > P.closeDate(p);
  /** RN-PER-15: lo que llega después del cierre entra al período abierto */
  P.periodFor = (eventDate, processedAt = G.TODAY) => { const p = G.date.month(eventDate); return processedAt > P.closeDate(p) ? G.date.month(processedAt) : p; };
  P.planFor = function (type, { brand_id, channel, date }) {
    const ps = G.db.where('commission_plans', x => x.plan_type === type && x.status === 'ACTIVE' && x.valid_from <= date && (!x.valid_to || x.valid_to >= date) && (!x.brand_id || x.brand_id === brand_id) && (!x.channel || x.channel === channel));
    return ps.sort((a, b) => ((b.brand_id ? 2 : 0) + (b.channel ? 1 : 0)) - ((a.brand_id ? 2 : 0) + (a.channel ? 1 : 0)))[0] || null;
  };
  /* fac_igv_rate viene como 0.18 en la spec y el núcleo lo divide otra vez entre 100 (FAC lo corrige; sin FAC no): se normaliza aquí */
  const igvRate = () => { const v = Number(G.param('fac_igv_rate') ?? 0.18); return v > 1 ? v / 100 : v; };
  P.base = amount => G.param('per_commission_base') === 'GROSS' ? R(amount) : R(amount / (1 + igvRate()));
  function rateFor(plan, empId, period, base) {
    const tiers = Array.isArray(plan.tiers) ? plan.tiers : [];
    if (!tiers.length) return Number(plan.rate_pct) || 0;
    const acc = U.sum(G.db.where('commission_entries', c => c.employee_id === empId && c.plan_id === plan.id && c.period === period), c => c.base_amount) + base;
    let r = Number(plan.rate_pct) || 0; for (const t of tiers.slice().sort((a, b) => a.from - b.from)) if (acc >= t.from) r = t.rate_pct; return r;
  }
  /** procesa un cobro confirmado: una comisión por asignación y plan (RN-PER-10/11) */
  P.onPaymentConfirmed = function ({ payment_id }, { processedAt } = {}) {
    const p = G.db.get('payments', payment_id); if (!p || p.status !== 'CONFIRMED') return [];
    const out = [];
    (p.allocations || []).forEach((a, i) => {
      if (!a.order_id || !(a.amount > 0)) return;
      const o = G.db.get('sales_orders', a.order_id); if (!o || !o.seller_id) return;
      const empId = P.empOfUser(o.seller_id); if (!empId) return;
      const date = (p.paid_at || G.TODAY).slice(0, 10);
      const plan = P.planFor('SELLER_COLLECTED', { brand_id: o.brand_id, channel: o.channel, date }); if (!plan) return;
      const allocId = a.id || `${p.id}#${i}`;
      if (G.db.find('commission_entries', c => c.payment_allocation_id === allocId && c.plan_id === plan.id && c.source_type === 'PAYMENT_ALLOCATION')) return; // RN-PER-11
      const period = P.periodFor(date, processedAt || G.TODAY);
      const base = P.base(a.amount); const rate = rateFor(plan, empId, period, base);
      const e = G.db.insert('commission_entries', { plan_id: plan.id, employee_id: empId, source_type: 'PAYMENT_ALLOCATION', payment_allocation_id: allocId, payment_id: p.id, order_id: o.id, brand_id: o.brand_id, delivery_stop_id: null, period, base_amount: base, rate_pct: rate, amount: R(base * rate / 100), earned_at: (p.paid_at || G.date.now()).slice(0, 16), reversal_of: null, reason: null }, { silent: true });
      if (!G._seeding) G.events.emit('commission.earned', { entry_id: e.id, employee_id: empId, amount: e.amount });
      out.push(e);
    });
    return out;
  };
  /** RN-PER-12: reverso en negativo en el período abierto; el período pagado no se edita */
  P.onPaymentReversed = function ({ payment_id, reason }) {
    const out = [];
    for (const c of G.db.where('commission_entries', c => c.payment_id === payment_id && c.source_type === 'PAYMENT_ALLOCATION')) {
      if (G.db.find('commission_entries', x => x.reversal_of === c.id)) continue;
      const e = G.db.insert('commission_entries', { plan_id: c.plan_id, employee_id: c.employee_id, source_type: 'REVERSAL', payment_allocation_id: c.payment_allocation_id, payment_id, order_id: c.order_id, brand_id: c.brand_id, period: P.periodFor(G.TODAY), base_amount: -c.base_amount, rate_pct: c.rate_pct, amount: -c.amount, earned_at: G.date.now(), reversal_of: c.id, reason: reason || 'Cobro revertido en CAJ' }, { silent: true });
      G.events.emit('commission.reversed', { entry_id: e.id, employee_id: c.employee_id, amount: e.amount });
      out.push(e);
    }
    return out;
  };
  /** RN-PER-13: bono por pedido entregado al repartidor de la parada; uno por pedido y repartidor */
  P.onOrderDelivered = function ({ order_id }, { processedAt } = {}) {
    const o = G.db.get('sales_orders', order_id); if (!o || !['DELIVERED', 'CLOSED'].includes(o.status) || o.fulfillment === 'PICKUP') return null;
    const stop = G.db.find('delivery_stops', s => s.order_id === o.id && s.status === 'DELIVERED');
    const route = stop && G.db.get('delivery_routes', stop.route_id);
    const driver = (route && route.driver_user_id) || o.driver_user_id; if (!driver) return null;
    const empId = P.empOfUser(driver); if (!empId) return null;
    const date = (o.delivered_at || G.TODAY).slice(0, 10);
    const plan = P.planFor('DRIVER_DELIVERY', { brand_id: o.brand_id, channel: o.channel, date }); if (!plan) return null;
    if (G.db.find('commission_entries', c => c.order_id === o.id && c.employee_id === empId && c.source_type === 'DELIVERY')) return null;
    const amt = plan.per_delivery_amount != null ? Number(plan.per_delivery_amount) : Number(G.param('per_delivery_bonus_amount') ?? 1.5);
    return G.db.insert('commission_entries', { plan_id: plan.id, employee_id: empId, source_type: 'DELIVERY', payment_allocation_id: null, order_id: o.id, brand_id: o.brand_id, delivery_stop_id: stop ? stop.id : null, period: P.periodFor(date, processedAt || G.TODAY), base_amount: 0, rate_pct: null, amount: amt, earned_at: (o.delivered_at || G.date.now()).slice(0, 16), reversal_of: null, reason: null }, { silent: true });
  };
  P.processPayments = function (period) {
    const to = G.date.add(G.date.addMonths(period, 1), -1); let n = 0;
    for (const p of G.db.where('payments', p => p.status === 'CONFIRMED' && (p.paid_at || '').slice(0, 10) >= period && (p.paid_at || '').slice(0, 10) <= to)) n += P.onPaymentConfirmed({ payment_id: p.id }).length;
    return n;
  };
  P.processDeliveries = function (period) {
    const to = G.date.add(G.date.addMonths(period, 1), -1); let n = 0;
    for (const o of G.db.where('sales_orders', o => ['DELIVERED', 'CLOSED'].includes(o.status) && (o.delivered_at || '').slice(0, 10) >= period && (o.delivered_at || '').slice(0, 10) <= to)) if (P.onOrderDelivered({ order_id: o.id })) n++;
    return n;
  };
  P.entries = (period, empId) => G.db.where('commission_entries', c => c.period === period && (!empId || c.employee_id === empId));
  const planType = c => (G.db.get('commission_plans', c.plan_id) || {}).plan_type;
  P.totals = function (period, empId) {
    const es = P.entries(period, empId);
    const com = es.filter(c => planType(c) === 'SELLER_COLLECTED'), bon = es.filter(c => planType(c) === 'DRIVER_DELIVERY');
    return { commission: R(U.sum(com.filter(c => c.source_type !== 'REVERSAL'), c => c.amount)), reversals: R(U.sum(com.filter(c => c.source_type === 'REVERSAL'), c => c.amount)), net: R(U.sum(com, c => c.amount)), base: R(U.sum(com, c => c.base_amount)), bonus: R(U.sum(bon, c => c.amount)), deliveries: bon.filter(c => c.source_type === 'DELIVERY').length, n: es.length };
  };

  /* ------------------------------------------------------------------
     Alertas de control y supervisión (RN-PER-16/20)
     ------------------------------------------------------------------ */
  P.linkControlAlerts = function () {
    let n = 0;
    for (const a of G.db.all('control_alerts')) {
      if (G.db.find('supervision_actions', s => s.control_alert_id === a.id)) continue;
      const empId = P.empOfUser(a.user_id); if (!empId) continue;
      G.db.insert('supervision_actions', { employee_id: empId, supervisor_employee_id: P.supervisor(empId), source: a.source_type === 'CALL_TRANSCRIPT' ? 'TEL_CALL' : 'CRM_CONTROL_ALERT', source_ref_id: a.id, control_alert_id: a.id, severity: a.severity, summary: `${a.matched_text}${a.excerpt ? ' · «' + a.excerpt + '»' : ''}`, action: null, action_note: null, action_by: null, action_at: null, status: ['DISMISSED', 'CONFIRMED'].includes(a.status) && a.reviewed_at ? 'OPEN' : 'OPEN', raised_at: a.created_at }, { silent: G._seeding });
      n++;
    }
    return n;
  };
  P.recordAction = function (id, { action, note }) {
    if (!G.can('per.supervision.manage')) G.fail('RN-PER-16', 'Registrar acciones requiere per.supervision.manage.');
    const s = G.db.get('supervision_actions', id);
    if (s.status === 'CLOSED') G.fail('RN-PER-16', 'La acción ya está registrada y no se borra; registra una nueva observación si hace falta.');
    if (!action) G.fail('RN-PER-16', 'Elige la acción tomada.');
    if (action !== 'NO_ACTION' && !String(note || '').trim()) G.fail('RN-PER-16', 'Describe la acción tomada.');
    return G.db.update('supervision_actions', id, { action, action_note: note || null, action_by: G.ctx.userId(), action_at: G.date.now(), status: 'CLOSED' });
  };
  /** alertas graves abiertas de un trabajador: supervisión abierta HIGH o control_alerts abiertas HIGH (si CRM existe) */
  P.openGraveAlerts = function (empId) {
    const u = P.userOf(empId);
    const sv = G.db.where('supervision_actions', s => s.employee_id === empId && s.status === 'OPEN' && s.severity === 'HIGH');
    const ca = u ? G.db.where('control_alerts', a => a.user_id === u.id && a.severity === 'HIGH' && ['OPEN', 'UNDER_REVIEW'].includes(a.status) && !sv.some(s => s.control_alert_id === a.id)) : [];
    return sv.length + ca.length;
  };
  /** alertas graves confirmadas del período (penalidad sobre la comisión) */
  P.confirmedAlerts = function (empId, period) {
    const to = G.date.add(G.date.addMonths(period, 1), -1); const u = P.userOf(empId);
    const sv = G.db.where('supervision_actions', s => s.employee_id === empId && s.status === 'CLOSED' && s.severity === 'HIGH' && ['VERBAL_WARNING', 'WRITTEN_WARNING'].includes(s.action) && (s.raised_at || s.created_at || '').slice(0, 10) >= period && (s.raised_at || s.created_at || '').slice(0, 10) <= to);
    const ca = u ? G.db.where('control_alerts', a => a.user_id === u.id && a.severity === 'HIGH' && a.status === 'CONFIRMED' && (a.created_at || '').slice(0, 10) >= period && (a.created_at || '').slice(0, 10) <= to && !sv.some(s => s.control_alert_id === a.id)) : [];
    return sv.length + ca.length;
  };
  P.penaltyPct = function (empId, period, plan) { const n = P.confirmedAlerts(empId, period); const pct = Number((plan || {}).alert_penalty_pct ?? 10); return Math.min(50, n * pct); };

  /* ------------------------------------------------------------------
     Pagos al personal (RN-PER-14/20)
     ------------------------------------------------------------------ */
  P.savePayout = function (d) {
    const gross = R(Number(d.gross_amount) || 0), ded = R(Number(d.deductions_amount) || 0), net = R(Number(d.net_amount));
    if (gross < 0 || ded < 0) G.fail('RN-PER-14', 'Bruto y descuentos no son negativos.');
    if (Math.abs(net - R(gross - ded)) > 0.004) G.fail('RN-PER-14', `El neto debe ser bruto − descuentos: ${G.fmt.money(gross)} − ${G.fmt.money(ded)} = ${G.fmt.money(R(gross - ded))}, no ${G.fmt.money(net)}.`);
    if (G.db.find('staff_payouts', p => p.employee_id === d.employee_id && p.period === d.period && p.payout_type === d.payout_type && p.status !== 'VOIDED')) G.fail('RN-PER-14', `${empName(d.employee_id)} ya tiene un pago de ${G.date.monthName(d.period)} de ese tipo.`);
    const pay = G.db.insert('staff_payouts', { employee_id: d.employee_id, period: d.period, payout_type: d.payout_type, gross_amount: gross, deductions_amount: ded, net_amount: net, status: d.status || 'DRAFT', held_reason: d.held_reason || null, approved_by: null, approved_at: null, cash_account_id: null, paid_at: null, payment_reference: null }, { silent: G._seeding });
    for (const l of d.lines || []) G.db.insert('staff_payout_lines', { payout_id: pay.id, concept: l.concept, amount: R(l.amount), ref_type: l.ref_type || null, ref_id: l.ref_id || null, note: l.note || null }, { silent: true });
    return pay;
  };
  P.linesOf = id => G.db.where('staff_payout_lines', l => l.payout_id === id);
  /** arma las liquidaciones del período: comisiones netas, bonos, jornales, adelantos, multas y penalidad */
  P.buildPayout = function (empId, period) {
    const to = G.date.add(G.date.addMonths(period, 1), -1);
    const t = P.totals(period, empId); const lines = [];
    if (t.net) lines.push({ concept: 'COMMISSION', amount: Math.max(0, t.net), note: `${G.fmt.money(t.base)} cobrados sin IGV${t.reversals ? `; reversos ${G.fmt.money(t.reversals)}` : ''}` });
    if (t.bonus) lines.push({ concept: 'DELIVERY_BONUS', amount: t.bonus, note: `${t.deliveries} entregas` });
    const term = P.termAt(empId, to);
    if (term && term.pay_scheme === 'DAILY') { const days = G.db.where('attendance_days', a => a.employee_id === empId && a.work_date >= period && a.work_date <= to && ['PRESENT', 'LATE'].includes(a.status)).length; if (days) lines.push({ concept: 'WAGE', amount: R(days * term.daily_rate), note: `${days} jornales × ${G.fmt.money(term.daily_rate)}` }); }
    for (const a of G.db.where('salary_advances', a => a.employee_id === empId && ['APPROVED', 'PAID'].includes(a.status) && a.deduct_period === period)) lines.push({ concept: 'ADVANCE_DEDUCTION', amount: a.amount, ref_type: 'salary_advance', ref_id: a.id, note: 'Adelanto del ' + G.fmt.date(a.requested_on) });
    for (const f of G.db.where('traffic_fines', f => f.employee_id === empId && f.deduct_from_payout && !f.deducted_payout_id && (f.fine_date || f.created_at || '').slice(0, 10) <= to)) lines.push({ concept: 'FINE_DEDUCTION', amount: f.amount, ref_type: 'traffic_fine', ref_id: f.id, note: 'Multa de tránsito (FLO)' });
    if (t.net > 0) { const plan = P.planFor('SELLER_COLLECTED', { date: to }); const pp = P.penaltyPct(empId, period, plan); if (pp) lines.push({ concept: 'OTHER_DEDUCTION', amount: R(t.net * pp / 100), note: `Penalidad ${pp} % por ${P.confirmedAlerts(empId, period)} alerta(s) de control grave(s) confirmada(s)` }); }
    const gross = R(U.sum(lines.filter(l => !DEDUCT.includes(l.concept)), l => l.amount)), ded = R(U.sum(lines.filter(l => DEDUCT.includes(l.concept)), l => l.amount));
    const kinds = new Set(lines.filter(l => !DEDUCT.includes(l.concept)).map(l => l.concept));
    const type = kinds.size > 1 ? 'MIXED' : kinds.has('COMMISSION') ? 'COMMISSIONS' : kinds.has('WAGE') ? 'WAGES' : 'BONUS';
    return { employee_id: empId, period, payout_type: type, gross_amount: gross, deductions_amount: ded, net_amount: R(gross - ded), lines };
  };
  P.generatePayouts = function (period) {
    const ids = new Set([...P.entries(period).map(c => c.employee_id), ...G.db.where('employment_terms', t => t.pay_scheme === 'DAILY' && t.valid_from <= G.date.add(G.date.addMonths(period, 1), -1) && (!t.valid_to || t.valid_to >= period)).map(t => t.employee_id)]);
    const out = [];
    for (const id of ids) {
      if (G.db.find('staff_payouts', p => p.employee_id === id && p.period === period && p.status !== 'VOIDED')) continue;
      const d = P.buildPayout(id, period); if (!d.lines.length) continue;
      const hasCom = d.lines.some(l => l.concept === 'COMMISSION');
      if (hasCom && G.param('per_block_commission_on_open_alerts') !== false && P.openGraveAlerts(id)) { d.status = 'HELD'; d.held_reason = `RN-PER-20: ${P.openGraveAlerts(id)} alerta(s) de control grave(s) abierta(s); se retiene hasta su revisión.`; }
      out.push(P.savePayout(d));
    }
    return out;
  };
  P.releaseHold = function (id, note) {
    const p = G.db.get('staff_payouts', id);
    if (p.status !== 'HELD') G.fail('RN-PER-20', 'El pago no está retenido.');
    if (P.openGraveAlerts(p.employee_id)) G.fail('RN-PER-20', `${empName(p.employee_id)} aún tiene alertas graves abiertas: registra la acción en PER-13 antes de liberar el pago.`);
    return G.db.update('staff_payouts', id, { status: 'DRAFT', held_reason: (p.held_reason || '') + ' · Liberado: ' + (note || 'alertas revisadas') });
  };
  P.approvePayout = function (id, { user_id } = {}) {
    const p = G.db.get('staff_payouts', id); const uid = user_id || G.ctx.userId();
    if (!G.can('per.payout.approve', (G.db.get('users', uid) || {}).role)) G.fail('RN-PER-14', 'Aprobar pagos al personal requiere per.payout.approve.');
    if (p.status === 'HELD') G.fail('RN-PER-20', 'El pago está retenido por alertas de control graves abiertas.');
    if (p.status !== 'DRAFT') G.fail('RN-PER-14', 'Solo se aprueba un pago en borrador.');
    if (P.empOfUser(uid) === p.employee_id) G.fail('RN-PER-14', 'Nadie aprueba su propio pago.');
    G.db.update('staff_payouts', id, { status: 'APPROVED', approved_by: uid, approved_at: G.date.now() });
    G.events.emit('payout.approved', { payout_id: id, employee_id: p.employee_id, period: p.period, net_amount: p.net_amount, gross_amount: p.gross_amount });
    return G.db.get('staff_payouts', id);
  };
  P.payPayout = function (id, { cash_account_id = 'ca-BCP-CTE', reference } = {}) {
    const p = G.db.get('staff_payouts', id);
    if (p.status !== 'APPROVED') G.fail('RN-PER-14', 'No se paga sin aprobación.');
    if (!reference) G.fail('RN-CAJ-02', 'Indica el número de operación de la transferencia.');
    G.db.update('staff_payouts', id, { status: 'PAID', cash_account_id, paid_at: G.date.now(), payment_reference: reference });
    for (const l of P.linesOf(id)) { if (l.ref_type === 'salary_advance') G.db.update('salary_advances', l.ref_id, { status: 'DEDUCTED' }, { silent: true }); if (l.ref_type === 'traffic_fine') G.db.update('traffic_fines', l.ref_id, { deducted_payout_id: id }, { silent: true }); }
    return G.db.get('staff_payouts', id);
  };

  /* ------------------------------------------------------------------
     Costo de personal (RN-PER-17) e intercambio con Ayni HR (RN-PER-18)
     ------------------------------------------------------------------ */
  P.importOf = period => G.db.find('payroll_exchanges', x => x.period === period && x.direction === 'IMPORT_COST' && x.status === 'DONE');
  /** filas de costo del mes: planilla importada (o estimada si aún no se importa), comisiones y bonos */
  P.costRows = function (period, { estimate = true } = {}) {
    const out = []; const imp = P.importOf(period);
    if (imp) for (const l of G.db.where('payroll_cost_lines', l => l.exchange_id === imp.id)) { const cc = G.db.get('cost_centers', l.cost_center_id) || {}; out.push({ kind: 'PAYROLL', employee_id: l.employee_id, cost_center_id: l.cost_center_id, area: P.area(l.employee_id, period), establishment_id: cc.establishment_id || P.site(l.employee_id, period), brand_id: cc.brand_id || null, amount: l.total_cost, ref: l.id }); }
    else if (estimate) {
      const to = G.date.add(G.date.addMonths(period, 1), -1); const end = to > G.TODAY ? G.TODAY : to; const f = (G.date.diff(end, period) + 1) / (G.date.diff(to, period) + 1);
      for (const e of P.staff(end)) { const t = P.termAt(e.id, end); if (t && t.payroll_source === 'NONE') continue; const m = P.monthlyPay(e.id, end) * 1.215 * f; for (const a of P.assignments(e.id, end)) { const cc = G.db.get('cost_centers', a.cost_center_id) || {}; out.push({ kind: 'PAYROLL_EST', employee_id: e.id, cost_center_id: a.cost_center_id, area: P.area(e.id, end), establishment_id: cc.establishment_id || a.establishment_id, brand_id: cc.brand_id || null, amount: R(m * a.allocation_pct / 100) }); } }
    }
    for (const c of P.entries(period)) { const a = P.primary(c.employee_id, period) || {}; const cc = G.db.get('cost_centers', a.cost_center_id) || {}; out.push({ kind: planType(c) === 'DRIVER_DELIVERY' ? 'BONUS' : 'COMMISSION', employee_id: c.employee_id, cost_center_id: a.cost_center_id, area: P.area(c.employee_id, period), establishment_id: cc.establishment_id || a.establishment_id, brand_id: c.brand_id || cc.brand_id || null, amount: c.amount, ref: c.id }); }
    return out;
  };
  P.costPerOrderValue = (cost, orders) => orders ? R(cost / orders) : 0;
  P.costPerOrder = function (period, { site } = {}) {
    const to = G.date.add(G.date.addMonths(period, 1), -1);
    const cost = R(U.sum(P.costRows(period).filter(r => ['SALES', 'WAREHOUSE', 'DELIVERY'].includes(r.area) && (!site || r.establishment_id === site)), r => r.amount));
    const orders = G.sales.orders({ from: period, to, site }).length;
    return { value: P.costPerOrderValue(cost, orders), numerator: cost, denominator: orders };
  };
  /** PayrollProvider: Ayni HR (API simulada) o archivo del contador */
  P.providers = {
    AYNI_HR: { name: 'Ayni HR (API)', costFor(empId, period) { const g = P.monthlyPay(empId, G.date.add(G.date.addMonths(period, 1), -1)); return { gross_salary: R(g), employer_contributions: R(g * 0.09), provisions: R(g * 0.125) }; } },
    ACCOUNTANT_FILE: { name: 'Archivo del contador (Excel/CSV)', costFor(empId, period) { const g = P.monthlyPay(empId, G.date.add(G.date.addMonths(period, 1), -1)); return { gross_salary: R(g), employer_contributions: R(g * 0.09), provisions: R(g * 0.125) }; } },
  };
  P.importCost = function (period, provider = G.param('per_payroll_source') || 'AYNI_HR') {
    if (!G.can('per.payroll.exchange')) G.fail('RN-PER-18', 'Importar la planilla requiere per.payroll.exchange.');
    const prov = P.providers[provider]; if (!prov) G.fail('RN-PER-18', 'Proveedor de planilla no válido.');
    const to = G.date.add(G.date.addMonths(period, 1), -1);
    for (const x of G.db.where('payroll_exchanges', x => x.period === period && x.direction === 'IMPORT_COST' && x.status === 'DONE')) G.db.update('payroll_exchanges', x.id, { status: 'SUPERSEDED' });
    const ex = G.db.insert('payroll_exchanges', { period, direction: 'IMPORT_COST', provider, file_url: provider === 'ACCOUNTANT_FILE' ? `planilla-${period.slice(0, 7)}.xlsx` : null, status: 'PENDING', total_amount: 0, row_count: 0, error_message: null, processed_at: null }, { silent: G._seeding });
    let tot = 0, n = 0;
    for (const e of P.staff(to)) {
      const t = P.termAt(e.id, to); if (!t || t.payroll_source === 'NONE') continue;
      const c = prov.costFor(e.id, period);
      for (const a of P.assignments(e.id, to)) { const k = a.allocation_pct / 100; const row = { exchange_id: ex.id, employee_id: e.id, cost_center_id: a.cost_center_id, gross_salary: R(c.gross_salary * k), employer_contributions: R(c.employer_contributions * k), provisions: R(c.provisions * k) }; row.total_cost = R(row.gross_salary + row.employer_contributions + row.provisions); G.db.insert('payroll_cost_lines', row, { silent: true }); tot += row.total_cost; n++; }
    }
    return G.db.update('payroll_exchanges', ex.id, { status: 'DONE', total_amount: R(tot), row_count: n, processed_at: G.date.now() }, { silent: G._seeding });
  };
  P.variables = function (period) {
    const to = G.date.add(G.date.addMonths(period, 1), -1);
    return P.staff(to).map(e => {
      const ds = G.db.where('attendance_days', a => a.employee_id === e.id && a.work_date >= period && a.work_date <= to);
      const t = P.totals(period, e.id);
      const adv = U.sum(G.db.where('salary_advances', a => a.employee_id === e.id && ['APPROVED', 'PAID', 'DEDUCTED'].includes(a.status) && a.deduct_period === period), a => a.amount);
      return { employee_id: e.id, dni: e.doc_number, name: e.full_name, worked: ds.filter(d => ['PRESENT', 'LATE'].includes(d.status)).length, absences: ds.filter(d => d.status === 'ABSENT').length, leave: ds.filter(d => d.status === 'LEAVE').length, late: U.sum(ds, d => d.late_minutes), overtime: U.sum(ds, d => d.overtime_minutes), commissions: t.net, bonuses: t.bonus, deductions: R(adv) };
    });
  };
  P.exportVariables = function (period, provider = G.param('per_payroll_source') || 'AYNI_HR') {
    if (!G.can('per.payroll.exchange')) G.fail('RN-PER-18', 'Exportar variables requiere per.payroll.exchange.');
    const rows = P.variables(period);
    for (const x of G.db.where('payroll_exchanges', x => x.period === period && x.direction === 'EXPORT_VARIABLES' && x.status === 'DONE')) G.db.update('payroll_exchanges', x.id, { status: 'SUPERSEDED' });
    const ex = G.db.insert('payroll_exchanges', { period, direction: 'EXPORT_VARIABLES', provider, file_url: provider === 'ACCOUNTANT_FILE' ? `variables-${period.slice(0, 7)}.csv` : null, status: 'DONE', total_amount: R(U.sum(rows, r => r.commissions + r.bonuses)), row_count: rows.length, error_message: null, processed_at: G.date.now() }, { silent: G._seeding });
    if (!G._seeding) G.events.emit('payroll.exported', { exchange_id: ex.id, period, provider, rows: rows.length });
    return { exchange: ex, rows };
  };

  /* eventos que consume PER */
  G.events.on('payment.confirmed', p => P.onPaymentConfirmed(p));
  G.events.on('payment.reversed', p => P.onPaymentReversed(p));
  G.events.on('order.delivered', p => P.onOrderDelivered(p));
  G.events.on('control_alert.raised', () => P.linkControlAlerts());

  /* ------------------------------------------------------------------
     Indicadores
     ------------------------------------------------------------------ */
  const months = p => { const out = []; for (let m = G.date.month(p.from || G.TODAY); m <= (p.to || G.TODAY); m = G.date.addMonths(m, 1)) out.push(m); return out; };
  G.kpiCalc['KPI-PER-01'] = p => { const r = months(p).map(m => P.costPerOrder(m, { site: p.site })); const c = U.sum(r, x => x.numerator), o = U.sum(r, x => x.denominator); return { value: P.costPerOrderValue(c, o), numerator: R(c), denominator: o }; };
  G.kpiCalc['KPI-PER-02'] = p => R(U.sum(months(p).flatMap(m => P.costRows(m)).filter(r => (!p.site || r.establishment_id === p.site) && (!p.brand || r.brand_id === p.brand)), r => r.amount));
  G.kpiCalc['KPI-PER-03'] = p => R(U.sum(months(p), m => P.totals(m).net));
  G.kpiCalc['KPI-PER-04'] = p => R(U.sum(months(p), m => P.totals(m).bonus));
  const daysIn = p => G.db.where('attendance_days', a => a.work_date >= (p.from || '0000') && a.work_date <= (p.to || '9999') && (!p.site || P.site(a.employee_id, a.work_date) === p.site));
  G.kpiCalc['KPI-PER-05'] = p => { const ds = daysIn(p); const sch = ds.filter(d => ['PRESENT', 'LATE', 'ABSENT'].includes(d.status)); const w = sch.filter(d => d.status !== 'ABSENT'); return { value: sch.length ? R(w.length / sch.length * 100, 1) : 0, numerator: w.length, denominator: sch.length }; };
  G.kpiCalc['KPI-PER-06'] = p => { const ds = daysIn(p).filter(d => d.shift_assignment_id); const n = new Set(ds.map(d => d.employee_id)).size; const s = U.sum(ds, d => d.late_minutes); return { value: n ? R(s / n, 1) : 0, numerator: s, denominator: n }; };
  G.kpiCalc['KPI-PER-07'] = p => R(U.sum(daysIn(p), d => d.overtime_minutes) / 60, 1);
  G.kpiCalc['KPI-PER-08'] = p => { const t = months(p).map(m => P.totals(m)); const c = U.sum(t, x => x.net), b = U.sum(t, x => x.base); return { value: b ? R(c / b * 100, 2) : 0, numerator: R(c), denominator: R(b) }; };
  G.kpiCalc['KPI-PER-09'] = p => { const es = months(p).flatMap(m => P.entries(m)).filter(c => c.source_type === 'DELIVERY' && c.earned_at.slice(0, 10) >= (p.from || '0000') && c.earned_at.slice(0, 10) <= (p.to || '9999')); const dr = new Set(es.map(c => c.employee_id)).size; return { value: dr ? R(es.length / dr, 1) : 0, numerator: es.length, denominator: dr }; };

  G.alertProviders.push(() => {
    const out = [];
    const adv = G.db.where('salary_advances', a => a.status === 'REQUESTED');
    if (adv.length) out.push({ module: 'PER', title: `${adv.length} adelanto(s) por aprobar`, detail: adv.map(a => `${empName(a.employee_id)} ${G.fmt.money(a.amount)}`).join(' · '), tone: 'warn', go: () => G.go('PER-09') });
    const held = G.db.where('staff_payouts', p => p.status === 'HELD');
    if (held.length) out.push({ module: 'PER', title: `${held.length} pago(s) de comisiones retenido(s)`, detail: 'RN-PER-20: alertas de control graves abiertas', tone: 'bad', go: () => G.go('PER-12') });
    const sv = G.db.where('supervision_actions', s => s.status === 'OPEN');
    if (sv.length) out.push({ module: 'PER', title: `${sv.length} alerta(s) de control sin acción registrada`, detail: 'Supervisión (RN-PER-16)', tone: 'warn', go: () => G.go('PER-13') });
    const inv = G.db.where('attendance_marks', m => !m.is_valid && m.marked_at.slice(0, 10) >= G.date.add(G.TODAY, -2));
    if (inv.length) out.push({ module: 'PER', title: `${inv.length} marcación(es) inválida(s) recientes`, detail: 'Fuera del radio del local (RN-PER-03)', tone: 'info', go: () => G.go('PER-08') });
    return out;
  });
  G.searchProviders.push(q => { const s = q.toLowerCase(); return G.db.where('employees', e => e.full_name.toLowerCase().includes(s) || e.doc_number === q).slice(0, 5).map(e => ({ label: e.full_name, sub: `${(P.position(e.id) || {}).name || e.position} · ${G.siteName(P.site(e.id))}`, go: () => { G.go('PER-02'); setTimeout(() => openEmp(e.id), 30); } })); });

  /* ------------------------------------------------------------------
     Interfaz común
     ------------------------------------------------------------------ */
  const empOpts = (pred = () => true) => P.staff().filter(pred).sort(U.by('full_name')).map(e => [e.id, e.full_name]);
  const posOpts = () => G.db.where('job_positions', p => p.status === 'ACTIVE').sort(U.by('name')).map(p => [p.id, p.name]);
  const ccOpts = () => G.db.where('cost_centers', c => c.status === 'ACTIVE').map(c => [c.id, `${c.code} · ${c.name}`]);
  const siteOpts = () => G.db.all('establishments').map(s => [s.id, s.short || s.name]);
  const shiftOpts = site => G.db.where('shifts', s => s.status === 'ACTIVE' && (!site || s.establishment_id === site)).map(s => [s.id, `${s.code} · ${s.start_time}–${s.end_time}`]);
  const periodPills = (st, onChange) => G.ui.pills([['2026-09-01', 'Setiembre 2026'], ['2026-10-01', 'Octubre 2026']], st, onChange);
  const run = (fn, ok, after) => { try { const r = fn(); toast(typeof ok === 'function' ? ok(r) : ok, 'ok'); if (after) after(); G.refresh(); return r; } catch (e) { toast(e.message, 'bad'); return false; } };
  const ask = (title, fields, onOk, opts = {}) => modal(title, b => b.appendChild(h('div', { class: 'form-grid' }, fields.map(f => h('div', { class: 'field' + (f.span2 || f.type === 'textarea' ? ' span2' : '') }, h('label', { attrs: { for: 'per-q-' + f.key } }, f.label),
    f.type === 'select' ? h('select', { class: 'input', id: 'per-q-' + f.key }, (f.options || []).map(([v, l]) => h('option', { value: v, selected: String(f.value) === String(v) }, l))) : f.type === 'textarea' ? h('textarea', { class: 'input', id: 'per-q-' + f.key }, f.value || '') : h('input', { class: 'input', id: 'per-q-' + f.key, type: f.type || 'text', value: f.value ?? '', attrs: { step: 'any' } }), f.help ? h('div', { class: 'help' }, f.help) : null)))),
  [{ label: 'Cancelar' }, { label: opts.ok || 'Guardar', kind: 'primary', onClick: () => { const v = {}; for (const f of fields) { const x = document.getElementById('per-q-' + f.key).value; v[f.key] = f.type === 'number' ? (x === '' ? '' : Number(x)) : x; } try { onOk(v); toast(opts.done || 'Guardado', 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); return false; } } }], { wide: opts.wide });

  /* ------------------------------------------------------------------
     PER-01 Puestos y funciones
     ------------------------------------------------------------------ */
  function s01(el) {
    const can = G.can('per.employee.manage');
    G.ui.crud(el, {
      code: 'PER-01', title: 'Puestos y funciones', sub: 'Puesto con área, local, funciones, rol del sistema sugerido y forma de pago habitual.', table: 'job_positions', canCreate: can, canEdit: can, createLabel: 'Nuevo puesto',
      rows: () => G.db.all('job_positions').sort(U.by('code')),
      kpis: () => { const ps = G.db.all('job_positions'); return [{ label: 'Puestos activos', value: ps.filter(p => p.status === 'ACTIVE').length }, { label: 'Trabajadores asignados', value: P.staff().length }, { label: 'Pago por jornal', value: ps.filter(p => p.pay_scheme === 'DAILY').length }, { label: 'Áreas', value: new Set(ps.map(p => p.area)).size }]; },
      columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Puesto' }, { key: 'area', label: 'Área', value: p => lbl(AREAS, p.area) }, { key: 'site', label: 'Local', value: p => p.establishment_id ? G.siteName(p.establishment_id) : 'Ambos' }, { key: 'role', label: 'Rol sugerido', value: p => p.default_role ? G.roleName(p.default_role) : '—' }, { key: 'pay_scheme', label: 'Pago', value: p => lbl(SCHEMES, p.pay_scheme) }, { key: 'n', label: 'Personas', align: 'r', value: p => P.staff().filter(e => (P.position(e.id) || {}).id === p.id).length }, { key: 'f', label: 'Funciones', value: p => (p.functions || []).length }, { key: 'status', label: 'Estado', render: p => G.ui.status(p.status) }],
      fields: [{ key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nombre del puesto', required: true }, { key: 'area', label: 'Área', type: 'select', options: AREAS, required: true }, { key: 'establishment_id', label: 'Local (vacío = ambos)', type: 'select', options: siteOpts }, { key: 'default_role', label: 'Rol del sistema sugerido', type: 'select', options: G.ROLES }, { key: 'pay_scheme', label: 'Forma de pago habitual', type: 'select', options: SCHEMES, required: true }, { key: 'functions_text', label: 'Funciones (una por línea)', type: 'textarea', required: true }, { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']], required: true }],
      defaults: () => ({ status: 'ACTIVE', pay_scheme: 'MONTHLY' }),
      beforeSave: (v, r) => { if (G.db.find('job_positions', p => p.code === v.code && (!r || p.id !== r.id))) return { code: 'Ya existe ese código.' }; },
      afterSave: row => G.db.update('job_positions', row.id, { functions: String(row.functions_text || '').split('\n').map(s => s.trim()).filter(Boolean) }, { silent: true }),
      detail: p => h('div', { class: 'stack' }, dl([['Área', lbl(AREAS, p.area)], ['Local', p.establishment_id ? G.siteName(p.establishment_id) : 'Ambos'], ['Rol sugerido', p.default_role ? G.roleName(p.default_role) : '—'], ['Forma de pago', lbl(SCHEMES, p.pay_scheme)]]), card('Funciones', h('ol', { style: 'margin:0;padding-left:20px' }, (p.functions || []).map(f => h('li', null, f)))), card('Personas en el puesto', h('div', { class: 'stack small' }, P.staff().filter(e => (P.position(e.id) || {}).id === p.id).map(e => h('div', null, `${e.full_name} · ${G.siteName(P.site(e.id))}`))))),
    });
  }

  /* ------------------------------------------------------------------
     PER-02 Ficha del trabajador
     ------------------------------------------------------------------ */
  function s02(el) {
    const own = !P.canSalary() && G.ctx.role !== 'GERENTE';
    const rows = P.staff().filter(e => !own || G.canDo('PER', 'E') || e.id === P.myEmp() || P.supervisor(e.id) === P.myEmp());
    const body = page(el, { code: 'PER-02', title: 'Ficha del trabajador', sub: 'Amplía el trabajador de MAE: puesto, local principal, centros de costo con %, usuario del sistema, supervisor y estado. Los datos personales y remuneraciones solo los ven RR. HH., gerencia y administración (Ley 29733).' });
    const byArea = U.groupBy(rows, e => P.area(e.id));
    body.appendChild(kpis([{ label: 'Trabajadores activos', value: rows.length }, { label: 'Local 1', value: rows.filter(e => P.site(e.id) === 'es-L1').length }, { label: 'Local 2', value: rows.filter(e => P.site(e.id) === 'es-L2').length }, { label: 'Con más de un centro de costo', value: rows.filter(e => P.assignments(e.id).length > 1).length }, { label: 'Sin usuario del sistema', value: rows.filter(e => !P.userOf(e.id)).length }, { label: 'Áreas', value: Object.keys(byArea).length }]));
    if (!P.canSalary()) body.appendChild(notice('RN-PER-19: tu rol no ve remuneraciones ni datos personales; ves solo lo tuyo y el puesto de tu equipo.', 'info'));
    body.appendChild(table({ id: 'per02', rows, onRow: e => openEmp(e.id), columns: [
      { key: 'full_name', label: 'Trabajador' }, { key: 'doc', label: 'DNI', mono: true, value: e => P.canSalary() || e.id === P.myEmp() ? e.doc_number : '••••' + String(e.doc_number).slice(-2) },
      { key: 'pos', label: 'Puesto', value: e => (P.position(e.id) || {}).name }, { key: 'area', label: 'Área', value: e => lbl(AREAS, P.area(e.id)) }, { key: 'site', label: 'Local', value: e => G.siteName(P.site(e.id)) },
      { key: 'cc', label: 'Centros de costo', value: e => P.assignments(e.id).map(a => `${(G.db.get('cost_centers', a.cost_center_id) || {}).code} ${G.fmt.num(a.allocation_pct, 0)} %`).join(' · ') },
      { key: 'sup', label: 'Supervisor', value: e => empName(P.supervisor(e.id)) }, { key: 'user', label: 'Usuario', value: e => { const u = P.userOf(e.id); return u ? G.roleName(u.role) : '—'; } },
      { key: 'status', label: 'Estado', render: e => G.ui.status(e.status) },
    ], filters: [{ key: 'area', label: 'Área', options: AREAS, value: e => P.area(e.id) }, { key: 'site', label: 'Local', options: siteOpts(), value: e => P.site(e.id) }] }));
  }
  function openEmp(id) {
    const e = emp(id); const mine = id === P.myEmp();
    drawer(e.full_name, (b, close) => {
      const as = P.assignments(id); const t = P.termAt(id); const u = P.userOf(id);
      if (G.can('per.employee.manage')) b.appendChild(h('div', { class: 'row' }, btn('Cambiar asignaciones', () => { close(); editAssign(id); }, { kind: 'primary', sm: true }), btn('Nueva condición de pago', () => { close(); G.go('PER-03', { emp: id }); }, { sm: true })));
      b.appendChild(h('div', { class: 'grid c2' }, dl([['Puesto', (P.position(id) || {}).name], ['Área', lbl(AREAS, P.area(id))], ['Local principal', G.siteName(P.site(id))], ['Supervisor', empName(P.supervisor(id))], ['Usuario del sistema', u ? `${u.email} · ${G.roleName(u.role)}` : 'Sin usuario'], ['Ingreso', G.fmt.date(e.hire_date)], ['Estado', G.ui.status(e.status)]]),
        dl([['DNI', P.canSalary() || mine ? e.doc_number : 'Reservado (Ley 29733)'], ['Celular', P.canSalary() || mine ? e.phone : 'Reservado'], ['Forma de pago', t ? lbl(SCHEMES, t.pay_scheme) : '—'], ['Remuneración', t ? money(P.monthlyPay(id), mine) + (t.pay_scheme !== 'MONTHLY' ? ' (equivalente mensual)' : '') : '—'], ['Fuente de planilla', t ? lbl(SOURCES, t.payroll_source) : '—'], ['Adelanto máximo', money(P.advanceMax(id), mine)]])));
      b.appendChild(card('Asignaciones vigentes (RN-PER-01)', table({ id: 'per02a-' + id, search: false, rows: as, columns: [{ key: 'p', label: 'Puesto', value: a => (G.db.get('job_positions', a.position_id) || {}).name }, { key: 's', label: 'Local', value: a => G.siteName(a.establishment_id) }, { key: 'cc', label: 'Centro de costo', value: a => G.ccName(a.cost_center_id) }, { key: 'allocation_pct', label: '%', align: 'r' }, { key: 'pr', label: 'Principal', value: a => a.is_primary ? 'Sí' : '' }, { key: 'valid_from', label: 'Desde', render: a => G.fmt.date(a.valid_from) }] })));
      const ds = G.db.where('attendance_days', a => a.employee_id === id && a.work_date >= G.date.month(G.TODAY));
      const tt = P.totals(G.date.month(G.TODAY), id);
      b.appendChild(h('div', { class: 'grid c2' }, card('Asistencia del mes', dl([['Días trabajados', ds.filter(d => ['PRESENT', 'LATE'].includes(d.status)).length], ['Tardanzas', `${ds.filter(d => d.late_minutes > 0).length} (${U.sum(ds, d => d.late_minutes)} min)`], ['Faltas', ds.filter(d => d.status === 'ABSENT').length], ['Horas extra autorizadas', G.fmt.num(U.sum(ds, d => d.overtime_minutes) / 60, 1)]])),
        card('Comisiones y bonos del mes', dl([['Comisión neta', money(tt.net, mine)], ['Bonos por entrega', money(tt.bonus, mine) + ` (${tt.deliveries} entregas)`], ['Alertas graves abiertas', P.openGraveAlerts(id)]]))));
      const hist = G.db.where('employee_assignments', a => a.employee_id === id && a.valid_to);
      if (hist.length) b.appendChild(card('Historial de asignaciones', h('div', { class: 'small stack' }, hist.map(a => h('div', null, `${G.fmt.date(a.valid_from)} – ${G.fmt.date(a.valid_to)} · ${(G.db.get('job_positions', a.position_id) || {}).name} · ${(G.db.get('cost_centers', a.cost_center_id) || {}).code} ${a.allocation_pct} %`)))));
    }, { wide: true, code: 'PER-02' });
  }
  function editAssign(id) {
    const cur = P.assignments(id).map(a => ({ position_id: a.position_id, establishment_id: a.establishment_id, cost_center_id: a.cost_center_id, supervisor_employee_id: a.supervisor_employee_id, allocation_pct: a.allocation_pct, is_primary: a.is_primary }));
    const rows = cur.length ? cur : [{ allocation_pct: 100, is_primary: true }];
    drawer('Asignaciones · ' + empName(id), (b, close) => {
      const box = h('div', { class: 'stack' }); const from = h('input', { class: 'input', type: 'date', id: 'per-as-from', value: G.TODAY });
      const sumBox = h('div');
      const draw = () => {
        G.ui.clear(box);
        rows.forEach((r, i) => {
          const sel = (k, opts) => { const s = h('select', { class: 'input', attrs: { 'aria-label': k } }, h('option', { value: '' }, '—'), opts.map(([v, l]) => h('option', { value: v, selected: r[k] === v }, l))); s.addEventListener('change', () => { r[k] = s.value; }); return s; };
          const pc = h('input', { class: 'input', type: 'number', value: r.allocation_pct, attrs: { 'aria-label': '%' } }); pc.addEventListener('input', () => { r.allocation_pct = Number(pc.value); upd(); });
          const pr = h('input', { type: 'checkbox', checked: !!r.is_primary, attrs: { 'aria-label': 'Principal' } }); pr.addEventListener('change', () => { rows.forEach(x => x.is_primary = false); r.is_primary = pr.checked; draw(); });
          box.appendChild(card(`Asignación ${i + 1}`, h('div', { class: 'form-grid' }, h('div', { class: 'field' }, h('label', null, 'Puesto'), sel('position_id', posOpts())), h('div', { class: 'field' }, h('label', null, 'Local'), sel('establishment_id', siteOpts())), h('div', { class: 'field' }, h('label', null, 'Centro de costo'), sel('cost_center_id', ccOpts())), h('div', { class: 'field' }, h('label', null, 'Supervisor'), sel('supervisor_employee_id', empOpts(x => x.id !== id))), h('div', { class: 'field' }, h('label', null, '% del costo'), pc), h('label', { class: 'check' }, pr, h('span', null, 'Principal')), btn('Quitar', () => { rows.splice(i, 1); draw(); }, { sm: true, kind: 'ghost' }))));
        });
        upd();
      };
      const upd = () => { G.ui.clear(sumBox); const s = R(U.sum(rows, r => Number(r.allocation_pct) || 0)); sumBox.appendChild(notice(`Suma ${G.fmt.num(s, 2)} %${Math.abs(s - 100) > 0.001 ? ' · RN-PER-01: debe sumar 100 %' : ''}`, Math.abs(s - 100) > 0.001 ? 'bad' : 'ok')); };
      draw();
      b.append(h('div', { class: 'field' }, h('label', { attrs: { for: 'per-as-from' } }, 'Rige desde'), from), box, sumBox, h('div', { class: 'row' }, btn('Agregar asignación', () => { rows.push({ allocation_pct: 0 }); draw(); }, { sm: true }), btn('Guardar', () => run(() => P.setAssignments(id, rows, from.value), 'Asignaciones guardadas', close), { kind: 'primary', sm: true })));
    }, { wide: true, code: 'PER-02' });
  }

  /* ------------------------------------------------------------------
     PER-03 Condiciones de pago
     ------------------------------------------------------------------ */
  function s03(el, params) {
    const can = G.can('per.employee.manage');
    const vis = P.canSalary() || G.ctx.role === 'GERENTE';
    const rows = G.db.all('employment_terms').filter(t => vis || t.employee_id === P.myEmp()).sort((a, b) => empName(a.employee_id).localeCompare(empName(b.employee_id)) || b.valid_from.localeCompare(a.valid_from));
    const body = page(el, { code: 'PER-03', title: 'Condiciones de pago', sub: 'Sueldo mensual, jornal o tarifa por hora con vigencia sin traslapes (RN-PER-02) y fuente de planilla: Ayni HR o archivo del contador. La planilla legal no se calcula aquí.', actions: can ? [{ label: 'Nueva condición', kind: 'primary', icon: '+', onClick: () => newTerm(params.emp) }] : [] });
    const cur = rows.filter(t => t.valid_from <= G.TODAY && (!t.valid_to || t.valid_to >= G.TODAY));
    body.appendChild(kpis([{ label: 'Vigentes', value: cur.length }, { label: 'Mensuales', value: cur.filter(t => t.pay_scheme === 'MONTHLY').length }, { label: 'Jornal o por hora', value: cur.filter(t => t.pay_scheme !== 'MONTHLY').length }, { label: 'Planilla mensual equivalente', value: vis ? G.fmt.money(R(U.sum(cur, t => P.monthlyPay(t.employee_id)))) : 'Reservado' }, { label: 'Fuente por defecto', value: lbl(SOURCES, G.param('per_payroll_source')) }]));
    if (!vis) body.appendChild(notice('RN-PER-19: solo ves tus propias condiciones.', 'info'));
    body.appendChild(table({ id: 'per03', rows, columns: [
      { key: 'e', label: 'Trabajador', value: t => empName(t.employee_id) }, { key: 'pay_scheme', label: 'Forma', value: t => lbl(SCHEMES, t.pay_scheme) },
      { key: 'amt', label: 'Monto', align: 'r', value: t => t.monthly_amount ?? t.daily_rate ?? t.hourly_rate, render: t => vis || t.employee_id === P.myEmp() ? G.fmt.money(t.monthly_amount ?? t.daily_rate ?? t.hourly_rate) + { MONTHLY: '/mes', DAILY: '/día', HOURLY: '/hora' }[t.pay_scheme] : 'Reservado' },
      { key: 'payroll_source', label: 'Fuente', value: t => lbl(SOURCES, t.payroll_source) }, { key: 'external_ref', label: 'Ref. Ayni HR', mono: true },
      { key: 'valid_from', label: 'Desde', render: t => G.fmt.date(t.valid_from) }, { key: 'valid_to', label: 'Hasta', render: t => t.valid_to ? G.fmt.date(t.valid_to) : 'vigente' },
      { key: 'st', label: 'Estado', render: t => t.valid_from > G.TODAY ? badge('Futura', 'info') : t.valid_to && t.valid_to < G.TODAY ? badge('Histórica', '') : badge('Vigente', 'ok') },
    ], filters: [{ key: 'pay_scheme', label: 'Forma', options: SCHEMES }, { key: 'payroll_source', label: 'Fuente', options: SOURCES }] }));
    if (params.emp && can) setTimeout(() => newTerm(params.emp), 20);
  }
  function newTerm(empId) {
    drawer('Nueva condición de pago', (b, close) => b.appendChild(G.ui.form({ id: 'per03', values: { employee_id: empId || '', pay_scheme: 'MONTHLY', payroll_source: G.param('per_payroll_source'), valid_from: G.date.addMonths(G.date.month(G.TODAY), 1), closePrevious: true }, fields: [
      { key: 'employee_id', label: 'Trabajador', type: 'select', options: empOpts(), required: true }, { key: 'pay_scheme', label: 'Forma de pago', type: 'select', options: SCHEMES, required: true },
      { key: 'monthly_amount', label: 'Sueldo mensual S/', type: 'money', min: 0 }, { key: 'daily_rate', label: 'Jornal diario S/', type: 'money', min: 0 }, { key: 'hourly_rate', label: 'Tarifa por hora S/', type: 'money', min: 0 },
      { key: 'payroll_source', label: 'Fuente de planilla', type: 'select', options: SOURCES, required: true }, { key: 'external_ref', label: 'Código en Ayni HR' },
      { key: 'valid_from', label: 'Rige desde', type: 'date', required: true }, { key: 'valid_to', label: 'Hasta (opcional)', type: 'date' },
      { key: 'closePrevious', label: 'Cerrar la condición vigente el día anterior', type: 'checkbox', span: 2 },
    ], onCancel: close, onSubmit: v => { P.addTerm(v, { closePrevious: v.closePrevious }); close(); toast('Condición registrada', 'ok'); G.refresh(); return true; } })), { code: 'PER-03' });
  }

  /* ------------------------------------------------------------------
     PER-04 Turnos por local
     ------------------------------------------------------------------ */
  function s04(el) {
    const can = G.can('per.employee.manage') || G.canDo('PER', 'E');
    G.ui.crud(el, {
      code: 'PER-04', title: 'Turnos por local', sub: `Hora de entrada y salida, refrigerio, tolerancia (por defecto ${G.param('per_late_tolerance_minutes')} min, RN-PER-07) y si cruza la medianoche.`, table: 'shifts', canCreate: can, canEdit: can, createLabel: 'Nuevo turno',
      rows: () => G.db.all('shifts').sort((a, b) => a.establishment_id.localeCompare(b.establishment_id) || a.start_time.localeCompare(b.start_time)),
      columns: [{ key: 'site', label: 'Local', value: s => G.siteName(s.establishment_id) }, { key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Turno' }, { key: 'start_time', label: 'Entrada' }, { key: 'end_time', label: 'Salida' }, { key: 'break_minutes', label: 'Refrigerio', align: 'r', render: s => s.break_minutes + ' min' }, { key: 'len', label: 'Horas efectivas', align: 'r', value: s => R(shiftLen(s) / 60, 2) }, { key: 'tol', label: 'Tolerancia', align: 'r', value: s => shiftTol(s) + ' min' }, { key: 'crosses_midnight', label: 'Cruza medianoche', value: s => s.crosses_midnight ? 'Sí' : '' }, { key: 'n', label: 'Programados esta semana', align: 'r', value: s => G.db.where('shift_assignments', a => a.shift_id === s.id && a.work_date >= G.date.add(G.TODAY, -5) && a.work_date <= G.date.add(G.TODAY, 1) && a.status !== 'CANCELLED').length }, { key: 'status', label: 'Estado', render: s => G.ui.status(s.status) }],
      filters: [{ key: 'establishment_id', label: 'Local', options: siteOpts() }],
      fields: [{ key: 'establishment_id', label: 'Local', type: 'select', options: siteOpts, required: true }, { key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nombre', required: true }, { key: 'start_time', label: 'Entrada', type: 'time', required: true }, { key: 'end_time', label: 'Salida', type: 'time', required: true }, { key: 'break_minutes', label: 'Refrigerio (min)', type: 'number', min: 0, required: true }, { key: 'late_tolerance_minutes', label: 'Tolerancia propia (vacío = parámetro)', type: 'number', min: 0 }, { key: 'crosses_midnight', label: 'Cruza la medianoche', type: 'checkbox' }, { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']], required: true }],
      defaults: () => ({ status: 'ACTIVE', break_minutes: 60, establishment_id: 'es-L1' }),
      beforeSave: (v, r) => { if (G.db.find('shifts', s => s.establishment_id === v.establishment_id && s.code === v.code && (!r || s.id !== r.id))) return { code: 'Ya existe ese código en el local.' }; const cross = minOf(v.end_time) <= minOf(v.start_time); if (cross && !v.crosses_midnight) return 'La salida es anterior a la entrada: marca «Cruza la medianoche».'; if (!cross && v.crosses_midnight) return 'El turno no cruza la medianoche con esas horas.'; if (v.late_tolerance_minutes === '') v.late_tolerance_minutes = null; },
    });
  }

  /* ------------------------------------------------------------------
     PER-05 Programación de turnos
     ------------------------------------------------------------------ */
  const S05 = { site: 'es-L1', week: null };
  const monday = d => G.date.add(d, -((G.date.parse(d).getUTCDay() + 6) % 7));
  function s05(el) {
    S05.week = S05.week || monday(G.TODAY);
    const days = [0, 1, 2, 3, 4, 5, 6].map(i => G.date.add(S05.week, i));
    const canE = G.can('per.attendance.approve') || G.can('per.employee.manage');
    const body = page(el, { code: 'PER-05', title: 'Programación de turnos', sub: 'Semana por local y trabajador: turnos, descansos, cambios de turno, feriados y horas extra autorizadas antes de trabajarlas (RN-PER-08).', actions: [btn('‹ Semana anterior', () => { S05.week = G.date.add(S05.week, -7); G.refresh(); }, { kind: 'ghost' }), btn('Semana siguiente ›', () => { S05.week = G.date.add(S05.week, 7); G.refresh(); }, { kind: 'ghost' })] });
    body.appendChild(h('div', { class: 'row' }, G.ui.pills(siteOpts(), S05.site, v => { S05.site = v; G.refresh(); }), h('b', null, `Semana del ${G.fmt.date(days[0])} al ${G.fmt.date(days[6])}`),
      canE ? btn('Copiar semana anterior', () => run(() => { let n = 0; for (const e of staffAt(S05.site)) for (const d of days) { if (P.planOf(e.id, d)) continue; const prev = P.planOf(e.id, G.date.add(d, -7)); if (prev) { P.setPlan(e.id, d, { shift_id: prev.shift_id, status: prev.status === 'SWAPPED' ? 'PLANNED' : prev.status }); n++; } } return n; }, n => `${n} turnos copiados`), { sm: true }) : null));
    const emps = staffAt(S05.site);
    const plans = G.db.where('shift_assignments', s => s.work_date >= days[0] && s.work_date <= days[6] && s.status !== 'CANCELLED');
    const pm = new Map(plans.map(s => [s.employee_id + '|' + s.work_date, s]));
    const tb = h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Trabajador'), days.map(d => h('th', { class: 'c' }, ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'][days.indexOf(d)] + ' ' + d.slice(8), isHoliday(d) ? h('div', { class: 'small', style: 'color:var(--bad)' }, 'Feriado') : null)), h('th', { class: 'r' }, 'Horas'))));
    const tbody = h('tbody');
    for (const e of emps) {
      let mins = 0;
      const cells = days.map(d => {
        const s = pm.get(e.id + '|' + d); const sh = s && G.db.get('shifts', s.shift_id); const lv = P.leaveOn(e.id, d);
        if (s && s.status !== 'REST' && sh) mins += shiftLen(sh) + (s.overtime_authorized_minutes || 0);
        const txt = lv ? lbl(LEAVE_T, lv.leave_type) : !s ? '—' : s.status === 'REST' ? 'Descanso' : sh ? sh.code : '?';
        const tone = lv ? 'info' : !s ? '' : s.status === 'REST' ? '' : s.status === 'SWAPPED' ? 'warn' : isHoliday(d) ? 'bad' : 'ok';
        return h('td', { class: 'c', style: canE ? 'cursor:pointer' : null, on: canE ? { click: () => editCell(e, d, s) } : null }, badge(txt, tone), s && s.overtime_authorized_minutes ? h('div', { class: 'small muted' }, `+${s.overtime_authorized_minutes} min HE`) : null);
      });
      tbody.appendChild(h('tr', null, h('td', null, h('div', null, e.full_name), h('div', { class: 'small muted' }, (P.position(e.id) || {}).name)), cells, h('td', { class: 'r num' }, G.fmt.num(mins / 60, 1))));
    }
    tb.appendChild(tbody);
    body.appendChild(card(`${emps.length} trabajadores · ${G.siteName(S05.site)}`, h('div', { class: 'tbl-wrap' }, tb), { flush: true }));
    body.appendChild(h('div', { class: 'grid c2' }, card('Cobertura por día', G.ui.chart.bar({ labels: days.map(d => d.slice(8)), series: [{ name: 'Programados', values: days.map(d => emps.filter(e => { const s = pm.get(e.id + '|' + d); return s && s.status !== 'REST' && !P.leaveOn(e.id, d); }).length) }] })),
      card('Leyenda', h('div', { class: 'stack small' }, h('div', null, badge('MAN', 'ok'), ' turno programado'), h('div', null, badge('MAN', 'warn'), ' cambio de turno'), h('div', null, badge('MAN', 'bad'), ' turno en feriado'), h('div', null, badge('Vacaciones', 'info'), ' permiso o vacaciones aprobadas'), h('p', { class: 'muted' }, 'Las horas extra solo se pagan si el supervisor las autoriza antes (RN-PER-08); sin autorización se registran como tiempo no autorizado.')))));
  }
  function staffAt(site) { return P.staff().filter(e => P.site(e.id) === site && G.db.find('shift_assignments', s => s.employee_id === e.id)).sort((a, b) => lbl(AREAS, P.area(a.id)).localeCompare(lbl(AREAS, P.area(b.id))) || a.full_name.localeCompare(b.full_name)); }
  function editCell(e, d, s) {
    ask(`${e.full_name} · ${G.fmt.date(d)}`, [
      { key: 'shift_id', label: 'Turno', type: 'select', options: shiftOpts(), value: s ? s.shift_id : '' },
      { key: 'status', label: 'Estado', type: 'select', options: [['PLANNED', 'Programado'], ['REST', 'Descanso'], ['CANCELLED', 'Sin turno']], value: s ? (s.status === 'SWAPPED' ? 'PLANNED' : s.status) : 'PLANNED' },
      { key: 'ot', label: 'Horas extra autorizadas (min)', type: 'number', value: s ? s.overtime_authorized_minutes : 0, help: 'RN-PER-08: se autorizan antes de trabajarlas.' },
      { key: 'note', label: 'Motivo del cambio', type: 'textarea' },
    ], v => { const sa = P.setPlan(e.id, d, { shift_id: v.shift_id, status: v.status, note: v.note }); if (sa && Number(v.ot) !== (sa.overtime_authorized_minutes || 0)) P.authorizeOvertime(sa.id, v.ot); if (d <= G.TODAY) P.consolidate(e.id, d); }, { done: 'Programación actualizada' });
  }

  /* ------------------------------------------------------------------
     PER-06 App · Marcación
     ------------------------------------------------------------------ */
  const S06 = { emp: null, loc: 'IN_SITE', offline: false, queue: [] };
  function s06(el) {
    const me = P.myEmp();
    if (!S06.emp || (!G.can('per.employee.manage') && G.ctx.role !== 'GERENTE')) S06.emp = me || (P.staff()[0] || {}).id;
    const e = emp(S06.emp); const site = P.site(e.id); const est = G.db.get('establishments', site);
    const body = page(el, { code: 'PER-06', title: 'App · Marcación', sub: `Entrada, salida y refrigerio con GPS (radio ${G.param('per_geofence_radius_m')} m) o con el QR del local; foto opcional; guarda sin conexión y envía al recuperar señal.` });
    if (G.can('per.employee.manage') || G.ctx.role === 'GERENTE') { const s = h('select', { class: 'input', id: 'per06-emp', style: 'max-width:340px' }, empOpts().map(([v, l]) => h('option', { value: v, selected: v === S06.emp }, l))); s.addEventListener('change', () => { S06.emp = s.value; G.refresh(); }); body.appendChild(h('div', { class: 'row' }, h('label', { class: 'small muted', attrs: { for: 'per06-emp' } }, 'Simular el celular de'), s)); }
    const LOC = { IN_SITE: ['En el local', 0.00011], DOOR: ['En la puerta (≈ 60 m)', 0.00054], FAR: ['A 250 m del local', 0.002248], ROUTE: ['En ruta (Miraflores)', null] };
    const pos = () => S06.loc === 'ROUTE' ? [-12.1211, -77.0297] : [est.lat + LOC[S06.loc][1], est.lng];
    const today = G.db.where('attendance_marks', m => m.employee_id === e.id && m.marked_at.slice(0, 10) === G.TODAY).sort(U.by('marked_at'));
    const sa = P.planOf(e.id, G.TODAY); const sh = sa && sa.status !== 'REST' ? G.db.get('shifts', sa.shift_id) : null;
    const doMark = (method, type, extra = {}) => {
      const d = Object.assign({ employee_id: e.id, establishment_id: site, mark_type: type, method, at: G.date.now(), device_id: 'cel-' + e.doc_number.slice(-4), offline_uuid: 'off-' + G.util.token(10) }, extra);
      if (method === 'GEO') { const [lat, lng] = pos(); d.lat = lat; d.lng = lng; }
      if (S06.offline) { S06.queue.push(d); toast('Sin conexión: marcación guardada en el celular', 'warn'); G.refresh(); return; }
      run(() => P.mark(d), m => m.is_valid ? `${lbl(MARK_T, type)} registrada a las ${hm(m.marked_at)}` : m.invalid_reason);
    };
    const scr = h('div', { class: 'phone-screen' });
    const inner = h('div', { class: 'stack', style: 'padding:14px' });
    scr.append(h('div', { style: 'padding:14px;background:var(--primary);color:var(--primary-ink)' }, h('b', null, 'Marcación'), h('div', { class: 'small' }, `${e.full_name} · ${est.short}`), h('div', { class: 'small' }, sh ? `Turno ${sh.code} ${sh.start_time}–${sh.end_time}` : sa && sa.status === 'REST' ? 'Hoy es tu descanso' : 'Sin turno hoy')), inner);
    inner.appendChild(h('div', { class: 'row between' }, h('span', { class: 'small' }, S06.offline ? badge('Sin conexión', 'bad') : badge('En línea', 'ok')), btn(S06.offline ? 'Recuperar señal' : 'Simular sin señal', () => { S06.offline = !S06.offline; if (!S06.offline && S06.queue.length) { let n = 0, bad = 0; for (const q of S06.queue.splice(0)) { try { P.mark(q); P.mark(q); n++; } catch (err) { bad++; toast(err.message, 'bad'); } } toast(`${n} marcación(es) sincronizada(s) sin duplicar (offline_uuid)${bad ? `; ${bad} rechazada(s)` : ''}`, 'ok'); } G.refresh(); }, { sm: true, kind: 'ghost' })));
    if (S06.queue.length) inner.appendChild(notice(`${S06.queue.length} marcación(es) en cola en el celular.`, 'warn'));
    const locSel = h('select', { class: 'input', id: 'per06-loc' }, Object.entries(LOC).map(([k, v]) => h('option', { value: k, selected: k === S06.loc }, v[0])));
    locSel.addEventListener('change', () => { S06.loc = locSel.value; G.refresh(); });
    const [la, ln] = pos(); const dist = R(G.geo.km([la, ln], [est.lat, est.lng]) * 1000, 0);
    inner.append(h('div', { class: 'field' }, h('label', { attrs: { for: 'per06-loc' } }, 'Ubicación del celular (simulada)'), locSel, h('div', { class: 'help' }, `A ${G.fmt.num(dist, 0)} m de ${est.short} · ${dist <= G.param('per_geofence_radius_m') ? 'dentro del radio' : 'fuera del radio'}`)));
    inner.appendChild(h('b', { class: 'small' }, 'Marcar por GPS'));
    inner.appendChild(h('div', { class: 'grid c2', style: 'gap:8px' }, MARK_T.map(([t, l]) => btn(l, () => doMark('GEO', t), { kind: t === 'IN' ? 'primary' : t === 'OUT' ? 'accent' : '' }))));
    inner.appendChild(h('b', { class: 'small' }, 'Marcar con el QR del local'));
    const qin = h('input', { class: 'input mono', id: 'per06-qr', placeholder: 'Código leído', attrs: { 'aria-label': 'Código QR' } });
    const qtype = h('select', { class: 'input', attrs: { 'aria-label': 'Tipo' } }, MARK_T.map(([v, l]) => h('option', { value: v }, l)));
    inner.append(h('div', { class: 'row' }, btn('Leer QR vigente', () => { qin.value = P.qrToken(site).token_hash; }, { sm: true }), btn('Leer QR de hace 3 min', () => { qin.value = P.qrToken(site, fromSec(toSec(G.date.now()) - 180)).token_hash; }, { sm: true, kind: 'ghost' })), qin, qtype, btn('Enviar marcación QR', () => doMark('QR', qtype.value, { qr_token: qin.value }), { kind: 'primary' }));
    inner.appendChild(h('div', { class: 'stack', style: 'gap:4px' }, h('b', { class: 'small' }, 'Hoy'), today.length ? today.map(m => h('div', { class: 'row between small', style: 'border-bottom:1px solid var(--line);padding:3px 0' }, h('span', null, `${hm(m.marked_at)} · ${lbl(MARK_T, m.mark_type)} · ${m.method === 'GEO' ? 'GPS ' + G.fmt.num(m.distance_m, 0) + ' m' : m.method === 'QR' ? 'QR' : 'Manual'}`), m.is_valid ? badge('Válida', 'ok') : badge('Inválida', 'bad'))) : h('span', { class: 'muted small' }, 'Sin marcaciones hoy.')));
    const day = G.db.find('attendance_days', a => a.employee_id === e.id && a.work_date === G.TODAY);
    body.appendChild(h('div', { class: 'grid c2' }, h('div', { class: 'phone' }, scr), h('div', { class: 'stack' },
      card('Consolidado de hoy', day ? dl([['Estado', bd(DAYST, day.status)], ['Entrada', hm(day.first_in) || '—'], ['Salida', hm(day.last_out) || '—'], ['Tardanza', day.late_minutes + ' min'], ['Trabajado', G.fmt.num(day.worked_minutes / 60, 2) + ' h'], ['Horas extra autorizadas', day.overtime_minutes + ' min'], ['Tiempo no autorizado', day.unauthorized_minutes + ' min']]) : h('p', { class: 'muted' }, 'Aún sin entrada registrada.')),
      card('Reglas', h('div', { class: 'stack small' }, h('p', null, `RN-PER-03: por GPS solo vale dentro de ${G.param('per_geofence_radius_m')} m del local; fuera se guarda inválida con su distancia.`), h('p', null, `RN-PER-04: el QR del local cambia cada ${G.param('per_qr_rotation_seconds')} s; un código vencido se rechaza.`), h('p', null, 'RN-PER-06: las marcaciones no se editan ni borran; un error se corrige con una marcación manual con motivo, aprobada por otra persona (PER-08).'), h('p', null, 'D-PER-04: QR en los locales y GPS para repartidores y visitadores.'))))));
  }

  /* ------------------------------------------------------------------
     PER-07 QR del local
     ------------------------------------------------------------------ */
  const S07 = { site: 'es-L1' };
  function s07(el) {
    const body = page(el, { code: 'PER-07', title: 'QR del local', sub: `Pantalla de la tablet del local: muestra un QR que cambia cada ${G.param('per_qr_rotation_seconds')} segundos para marcar asistencia (RN-PER-04).` });
    body.appendChild(G.ui.pills(siteOpts(), S07.site, v => { S07.site = v; G.refresh(); }));
    const box = h('div', { class: 'stack', style: 'align-items:center;justify-items:center;text-align:center' });
    const cnt = h('div', { class: 'small muted' });
    let tk = null;
    const draw = () => { tk = P.qrToken(S07.site); G.ui.clear(box); box.append(h('h2', { style: 'margin:0' }, (G.db.get('establishments', S07.site) || {}).name), G.ui.qr(`AYCHA-ASIST|${tk.token_hash}`, 240), h('div', { class: 'mono', style: 'font-size:1.4rem;letter-spacing:2px' }, tk.token_hash), h('div', { class: 'small' }, `Vigente de ${hm(tk.valid_from)}:${tk.valid_from.slice(17, 19)} a ${hm(tk.valid_to)}:${tk.valid_to.slice(17, 19)}`), cnt); };
    draw();
    const tick = () => { if (!box.isConnected) { clearInterval(iv); return; } const left = Math.max(0, Math.round(toSec(tk.valid_to) - toSec(G.date.now()))); cnt.textContent = `Cambia en ${left} s`; if (left <= 0) draw(); };
    const iv = setInterval(tick, 1000); tick();
    const recent = G.db.where('attendance_marks', m => m.establishment_id === S07.site && m.method === 'QR').sort(U.by('marked_at', -1)).slice(0, 12);
    body.appendChild(h('div', { class: 'grid c2' }, card('Código del local', box), card('Últimas marcaciones con QR', table({ id: 'per07', search: false, pageSize: 12, rows: recent, columns: [{ key: 'marked_at', label: 'Hora', render: m => G.fmt.datetime(m.marked_at) }, { key: 'e', label: 'Trabajador', value: m => empName(m.employee_id) }, { key: 't', label: 'Tipo', value: m => lbl(MARK_T, m.mark_type) }, { key: 'tok', label: 'Código', mono: true, value: m => (G.db.get('establishment_qr_tokens', m.qr_token_id) || {}).token_hash }] }))));
  }

  /* ------------------------------------------------------------------
     PER-08 Asistencia diaria (+ marcaciones, permisos y vacaciones)
     ------------------------------------------------------------------ */
  const S08 = { date: G.TODAY };
  function s08(el) {
    const canA = G.can('per.attendance.approve');
    const body = page(el, { code: 'PER-08', title: 'Asistencia diaria', sub: `Consolidado por día: entrada, salida, minutos trabajados, tardanza (tolerancia ${G.param('per_late_tolerance_minutes')} min), horas extra autorizadas, faltas y permisos; justificación y aprobación.` });
    const din = h('input', { class: 'input', type: 'date', value: S08.date, id: 'per08-d', style: 'max-width:180px' }); din.addEventListener('change', () => { S08.date = din.value; G.refresh(); });
    body.appendChild(h('div', { class: 'row' }, btn('‹', () => { S08.date = G.date.add(S08.date, -1); G.refresh(); }, { sm: true }), din, btn('›', () => { S08.date = G.date.add(S08.date, 1); G.refresh(); }, { sm: true, disabled: S08.date >= G.TODAY }), btn('Consolidar el día', () => run(() => { let n = 0; for (const e of P.staff(S08.date)) if (P.consolidate(e.id, S08.date)) n++; return n; }, n => `${n} trabajadores consolidados`), { sm: true }), isHoliday(S08.date) ? badge('Feriado', 'bad') : null));
    const rows = G.db.where('attendance_days', a => a.work_date === S08.date).filter(a => G.ctx.site === 'ALL' || P.site(a.employee_id, a.work_date) === G.ctx.site);
    const k = st => rows.filter(a => a.status === st).length;
    body.appendChild(kpis([{ label: 'Presentes', value: k('PRESENT') + k('LATE'), tone: 'ok' }, { label: 'Tardanzas', value: k('LATE'), sub: U.sum(rows, a => a.late_minutes) + ' min', tone: k('LATE') ? 'warn' : '' }, { label: 'Faltas', value: k('ABSENT'), tone: k('ABSENT') ? 'bad' : '' }, { label: 'Permisos', value: k('LEAVE') }, { label: 'Horas extra autorizadas', value: G.fmt.num(U.sum(rows, a => a.overtime_minutes) / 60, 1) + ' h' }, { label: 'Tiempo no autorizado', value: U.sum(rows, a => a.unauthorized_minutes) + ' min', tone: U.sum(rows, a => a.unauthorized_minutes) ? 'warn' : '' }]));
    body.appendChild(tabs0([
      { key: 'd', label: 'Consolidado', render: p => p.appendChild(table({ id: 'per08d', rows, onRow: a => dayDetail(a), columns: [
        { key: 'e', label: 'Trabajador', value: a => empName(a.employee_id) }, { key: 'sh', label: 'Turno', value: a => { const s = a.shift_assignment_id && G.db.get('shift_assignments', a.shift_assignment_id); const sh = s && G.db.get('shifts', s.shift_id); return sh ? `${sh.code} ${sh.start_time}–${sh.end_time}` : '—'; } },
        { key: 'first_in', label: 'Entrada', render: a => hm(a.first_in) || '—' }, { key: 'last_out', label: 'Salida', render: a => hm(a.last_out) || (a.first_in ? 'en turno' : '—') },
        { key: 'worked_minutes', label: 'Trabajado', align: 'r', render: a => G.fmt.num(a.worked_minutes / 60, 2) + ' h' }, { key: 'late_minutes', label: 'Tardanza', align: 'r', render: a => a.late_minutes ? a.late_minutes + ' min' : '—' },
        { key: 'overtime_minutes', label: 'HE autorizadas', align: 'r', render: a => a.overtime_minutes ? a.overtime_minutes + ' min' : '—' }, { key: 'unauthorized_minutes', label: 'No autorizado', align: 'r', render: a => a.unauthorized_minutes ? a.unauthorized_minutes + ' min' : '—' },
        { key: 'status', label: 'Estado', render: a => h('span', null, bd(DAYST, a.status), a.justification ? badge('Justificado', 'info') : null) },
      ], actions: a => canA && ['LATE', 'ABSENT'].includes(a.status) && !a.justification ? [btn('Justificar', () => ask(`Justificar · ${empName(a.employee_id)}`, [{ key: 'text', label: 'Justificación', type: 'textarea' }], v => P.justify(a.id, { text: v.text }), { done: 'Justificación aprobada' }), { sm: true })] : [],
        filters: [{ key: 'status', label: 'Estado', options: Object.entries(DAYST).map(([k2, v]) => [k2, v[0]]) }] })) },
      { key: 'm', label: 'Marcaciones', render: p => { const ms = G.db.where('attendance_marks', m => m.marked_at.slice(0, 10) === S08.date).sort(U.by('marked_at', -1)); p.appendChild(h('div', { class: 'row', style: 'margin-bottom:8px' }, canA ? btn('Marcación manual (RN-PER-05)', () => manualMark(), { sm: true, kind: 'primary' }) : null, h('span', { class: 'small muted' }, 'Las marcaciones son de solo inserción (RN-PER-06).'))); p.appendChild(table({ id: 'per08m', rows: ms, columns: [{ key: 'marked_at', label: 'Hora', render: m => hm(m.marked_at) }, { key: 'e', label: 'Trabajador', value: m => empName(m.employee_id) }, { key: 'mark_type', label: 'Tipo', value: m => lbl(MARK_T, m.mark_type) }, { key: 'method', label: 'Método', value: m => ({ GEO: 'GPS', QR: 'QR', MANUAL: 'Manual' })[m.method] }, { key: 'distance_m', label: 'Distancia', align: 'r', render: m => m.distance_m != null ? G.fmt.num(m.distance_m, 0) + ' m' : '—' }, { key: 'v', label: 'Validez', render: m => m.is_valid ? badge('Válida', 'ok') : badge('Inválida', 'bad') }, { key: 'why', label: 'Detalle', value: m => m.invalid_reason || m.manual_reason || (m.offline_uuid && m.offline_uuid.startsWith('off-') ? 'Enviada sin conexión' : '') }], filters: [{ key: 'method', label: 'Método', options: [['GEO', 'GPS'], ['QR', 'QR'], ['MANUAL', 'Manual']] }] })); } },
      { key: 'l', label: 'Permisos y vacaciones', render: p => leaves(p, canA) },
      { key: 's', label: 'Resumen del mes', render: p => monthSummary(p) },
    ]));
  }
  function dayDetail(a) {
    drawer(`${empName(a.employee_id)} · ${G.fmt.date(a.work_date)}`, b => {
      const ms = G.db.where('attendance_marks', m => m.employee_id === a.employee_id && m.marked_at.slice(0, 10) === a.work_date).sort(U.by('marked_at'));
      b.appendChild(dl([['Estado', bd(DAYST, a.status)], ['Entrada', hm(a.first_in) || '—'], ['Salida', hm(a.last_out) || '—'], ['Trabajado', G.fmt.num(a.worked_minutes / 60, 2) + ' h'], ['Tardanza (RN-PER-07)', a.late_minutes + ' min'], ['Horas extra autorizadas', a.overtime_minutes + ' min'], ['No autorizado (RN-PER-08)', a.unauthorized_minutes + ' min'], ['Justificación', a.justification ? `${a.justification} · aprobó ${G.userName(a.approved_by)}` : '—']]));
      b.appendChild(card('Marcaciones', h('div', { class: 'timeline' }, ms.map(m => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, hm(m.marked_at)), h('span', { class: 'dot' }), h('div', null, h('b', null, lbl(MARK_T, m.mark_type)), ' ', m.is_valid ? '' : badge('Inválida', 'bad'), h('div', { class: 'small muted' }, [m.method, m.distance_m != null ? G.fmt.num(m.distance_m, 0) + ' m' : null, m.invalid_reason, m.manual_reason].filter(Boolean).join(' · '))))))));
    }, { code: 'PER-08' });
  }
  function manualMark() {
    ask('Marcación manual', [
      { key: 'employee_id', label: 'Trabajador', type: 'select', options: empOpts() }, { key: 'mark_type', label: 'Tipo', type: 'select', options: MARK_T },
      { key: 'time', label: 'Hora', type: 'time', value: '08:00' }, { key: 'manual_reason', label: 'Motivo (RN-PER-05)', type: 'textarea' },
    ], v => P.mark({ employee_id: v.employee_id, mark_type: v.mark_type, method: 'MANUAL', at: S08.date + 'T' + v.time + ':00', manual_reason: v.manual_reason, approved_by_employee_id: P.myEmp() || P.empOfUser((G.db.find('users', u => u.role === 'RRHH') || {}).id) }), { done: 'Marcación manual registrada' });
  }
  function leaves(p, canA) {
    const ls = G.db.all('leave_requests').sort(U.by('date_from', -1));
    p.appendChild(h('div', { class: 'row', style: 'margin-bottom:8px' }, btn('Solicitar permiso o vacaciones', () => ask('Solicitud', [{ key: 'employee_id', label: 'Trabajador', type: 'select', options: empOpts(), value: P.myEmp() }, { key: 'leave_type', label: 'Tipo', type: 'select', options: LEAVE_T }, { key: 'date_from', label: 'Desde', type: 'date', value: G.date.add(G.TODAY, 7) }, { key: 'date_to', label: 'Hasta', type: 'date', value: G.date.add(G.TODAY, 7) }, { key: 'reason', label: 'Motivo', type: 'textarea' }], v => P.requestLeave(v), { done: 'Solicitud registrada' }), { sm: true, kind: 'primary' })));
    p.appendChild(table({ id: 'per08l', rows: ls, columns: [{ key: 'e', label: 'Trabajador', value: l => empName(l.employee_id) }, { key: 'leave_type', label: 'Tipo', value: l => lbl(LEAVE_T, l.leave_type) }, { key: 'date_from', label: 'Desde', render: l => G.fmt.date(l.date_from) }, { key: 'date_to', label: 'Hasta', render: l => G.fmt.date(l.date_to) }, { key: 'days', label: 'Días', align: 'r' }, { key: 'reason', label: 'Motivo' }, { key: 'status', label: 'Estado', render: l => bd({ REQUESTED: ['Solicitado', 'warn'], APPROVED: ['Aprobado', 'ok'], REJECTED: ['Rechazado', 'bad'] }, l.status) }, { key: 'ap', label: 'Resolvió', value: l => l.approved_by ? G.userShort(l.approved_by) : '' }],
      actions: l => canA && l.status === 'REQUESTED' ? [btn('Aprobar', () => run(() => P.decideLeave(l.id, true), 'Aprobado'), { sm: true, kind: 'primary' }), btn('Rechazar', () => run(() => P.decideLeave(l.id, false), 'Rechazado'), { sm: true, kind: 'danger' })] : [] }));
  }
  function monthSummary(p) {
    const m = G.date.month(S08.date), to = G.date.add(G.date.addMonths(m, 1), -1);
    const ds = G.db.where('attendance_days', a => a.work_date >= m && a.work_date <= to);
    const g = U.groupBy(ds, 'employee_id');
    const rows = Object.entries(g).map(([id, l]) => ({ id, worked: l.filter(d => ['PRESENT', 'LATE'].includes(d.status)).length, late: l.filter(d => d.late_minutes > 0).length, lateMin: U.sum(l, d => d.late_minutes), abs: l.filter(d => d.status === 'ABSENT').length, leave: l.filter(d => d.status === 'LEAVE').length, ot: U.sum(l, d => d.overtime_minutes), un: U.sum(l, d => d.unauthorized_minutes) }));
    const k5 = G.kpi('KPI-PER-05', { from: m, to }) || {}, k6 = G.kpi('KPI-PER-06', { from: m, to }) || {};
    p.appendChild(kpis([{ label: 'Asistencia (KPI-PER-05)', value: G.fmt.pct(k5.value), sub: `${k5.numerator} de ${k5.denominator} días programados` }, { label: 'Tardanza promedio (KPI-PER-06)', value: G.fmt.num(k6.value, 1) + ' min', sub: 'por trabajador con turno' }, { label: 'Horas extra autorizadas (KPI-PER-07)', value: G.fmt.num((G.kpi('KPI-PER-07', { from: m, to }) || {}).value, 1) + ' h' }]));
    p.appendChild(table({ id: 'per08s', rows, columns: [{ key: 'e', label: 'Trabajador', value: r => empName(r.id) }, { key: 'worked', label: 'Días trabajados', align: 'r' }, { key: 'late', label: 'Tardanzas', align: 'r' }, { key: 'lateMin', label: 'Min. tardanza', align: 'r' }, { key: 'abs', label: 'Faltas', align: 'r' }, { key: 'leave', label: 'Permisos', align: 'r' }, { key: 'ot', label: 'HE (min)', align: 'r' }, { key: 'un', label: 'No autorizado (min)', align: 'r' }] }));
  }

  /* ------------------------------------------------------------------
     PER-09 Adelantos
     ------------------------------------------------------------------ */
  function s09(el) {
    const canA = G.can('per.advance.approve'); const vis = P.canSalary() || G.ctx.role === 'GERENTE';
    const rows = G.db.all('salary_advances').filter(a => vis || a.employee_id === P.myEmp()).sort(U.by('requested_on', -1));
    const body = page(el, { code: 'PER-09', title: 'Adelantos', sub: `Solicitud, aprobación por otra persona, pago y período de descuento; máximo ${G.param('per_advance_max_pct')} % de la remuneración y un adelanto abierto por trabajador (RN-PER-09).`, actions: [{ label: 'Solicitar adelanto', kind: 'primary', icon: '+', onClick: () => newAdvance() }] });
    const open = rows.filter(a => ['REQUESTED', 'APPROVED', 'PAID'].includes(a.status));
    body.appendChild(kpis([{ label: 'Por aprobar', value: rows.filter(a => a.status === 'REQUESTED').length, tone: 'warn' }, { label: 'Abiertos (por descontar)', value: open.length, sub: vis ? G.fmt.money(R(U.sum(open, a => a.amount))) : '' }, { label: 'Descontados en el año', value: rows.filter(a => a.status === 'DEDUCTED').length }, { label: 'Rechazados', value: rows.filter(a => a.status === 'REJECTED').length }]));
    body.appendChild(table({ id: 'per09', rows, columns: [
      { key: 'e', label: 'Trabajador', value: a => empName(a.employee_id) }, { key: 'requested_on', label: 'Solicitado', render: a => G.fmt.date(a.requested_on) }, { key: 'amount', label: 'Monto', align: 'r', render: a => money(a.amount, a.employee_id === P.myEmp()) },
      { key: 'max', label: 'Máximo', align: 'r', value: a => P.advanceMax(a.employee_id, a.requested_on), render: a => money(P.advanceMax(a.employee_id, a.requested_on), a.employee_id === P.myEmp()) }, { key: 'reason', label: 'Motivo' },
      { key: 'deduct_period', label: 'Se descuenta en', value: a => G.date.monthName(a.deduct_period) }, { key: 'by', label: 'Pidió / aprobó', value: a => `${G.userShort(a.requested_by)}${a.approved_by ? ' / ' + G.userShort(a.approved_by) : ''}` },
      { key: 'status', label: 'Estado', render: a => bd(ADVST, a.status) },
    ], actions: a => [canA && a.status === 'REQUESTED' ? btn('Aprobar', () => run(() => P.decideAdvance(a.id, true), 'Adelanto aprobado'), { sm: true, kind: 'primary' }) : null, canA && a.status === 'REQUESTED' ? btn('Rechazar', () => run(() => P.decideAdvance(a.id, false), 'Adelanto rechazado'), { sm: true, kind: 'danger' }) : null, G.can('per.payout.approve') && a.status === 'APPROVED' ? btn('Pagar', () => run(() => P.payAdvance(a.id, { reference: 'TR-' + a.id.slice(-5) }), 'Adelanto pagado (CAJ)'), { sm: true, kind: 'accent' }) : null].filter(Boolean), filters: [{ key: 'status', label: 'Estado', options: Object.entries(ADVST).map(([k, v]) => [k, v[0]]) }] }));
  }
  function newAdvance() {
    const def = P.myEmp() || (P.staff()[0] || {}).id;
    drawer('Solicitar adelanto', (b, close) => {
      const info = h('div');
      const upd = v => { G.ui.clear(info); if (v.employee_id) info.appendChild(notice(`Remuneración ${money(P.monthlyPay(v.employee_id), v.employee_id === P.myEmp())} · máximo ${money(P.advanceMax(v.employee_id), v.employee_id === P.myEmp())} (${G.param('per_advance_max_pct')} %)${Number(v.amount) > P.advanceMax(v.employee_id) ? ' · RN-PER-09: el monto supera el máximo' : ''}`, Number(v.amount) > P.advanceMax(v.employee_id) ? 'bad' : 'info')); };
      const f = G.ui.form({ id: 'per09', values: { employee_id: def, deduct_period: G.date.month(G.TODAY) }, fields: [{ key: 'employee_id', label: 'Trabajador', type: 'select', options: empOpts(), required: true, onChange: (x, v) => upd(v) }, { key: 'amount', label: 'Monto S/', type: 'money', min: 0, required: true, onChange: (x, v) => upd(v) }, { key: 'deduct_period', label: 'Se descuenta en', type: 'select', options: [[G.date.month(G.TODAY), G.date.monthName(G.TODAY)], [G.date.addMonths(G.date.month(G.TODAY), 1), G.date.monthName(G.date.addMonths(G.TODAY, 1))]], required: true }, { key: 'reason', label: 'Motivo', type: 'textarea', required: true }], onCancel: close, onSubmit: v => { P.requestAdvance(v); close(); toast('Adelanto solicitado', 'ok'); G.refresh(); return true; } });
      b.append(info, f); upd(f.api.values);
    }, { code: 'PER-09' });
  }

  /* ------------------------------------------------------------------
     PER-10 Planes de comisión y bono
     ------------------------------------------------------------------ */
  function s10(el) {
    const can = G.can('per.commission.manage');
    G.ui.crud(el, {
      code: 'PER-10', title: 'Planes de comisión y bono', sub: `Comisión de vendedoras sobre lo cobrado sin IGV (per_commission_base = ${G.param('per_commission_base')}) o bono por entrega para repartidores; marca, canal, porcentaje o monto, tramos y vigencia. D-PER-02: 2 % para todas las marcas, tramos opcionales.`, table: 'commission_plans', canCreate: can, canEdit: can, createLabel: 'Nuevo plan',
      rows: () => G.db.all('commission_plans').sort(U.by('code')),
      kpis: () => { const t = P.totals(G.date.month(G.TODAY)); return [{ label: 'Planes activos', value: G.db.where('commission_plans', p => p.status === 'ACTIVE').length }, { label: 'Comisión neta del mes', value: G.fmt.money(t.net) }, { label: 'Bonos del mes', value: G.fmt.money(t.bonus), sub: `${t.deliveries} entregas` }, { label: 'Bono por entrega (parámetro)', value: G.fmt.money(G.param('per_delivery_bonus_amount')) }]; },
      columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Plan' }, { key: 'plan_type', label: 'Tipo', value: p => p.plan_type === 'SELLER_COLLECTED' ? 'Comisión sobre cobrado' : 'Bono por entrega' }, { key: 'b', label: 'Marca', value: p => p.brand_id ? G.brandName(p.brand_id) : 'Todas' }, { key: 'channel', label: 'Canal', value: p => p.channel ? G.channelName(p.channel) : 'Todos' }, { key: 'rate', label: '% o monto', align: 'r', value: p => p.plan_type === 'SELLER_COLLECTED' ? G.fmt.num(p.rate_pct, 2) + ' %' : G.fmt.money(p.per_delivery_amount) }, { key: 'tiers', label: 'Tramos', value: p => (p.tiers || []).map(t => `≥${G.fmt.num(t.from, 0)}: ${t.rate_pct} %`).join(' · ') || '—' }, { key: 'pen', label: 'Penalidad por alerta', align: 'r', value: p => p.plan_type === 'SELLER_COLLECTED' ? (p.alert_penalty_pct ?? 10) + ' %' : '—' }, { key: 'valid_from', label: 'Vigencia', value: p => `${G.fmt.date(p.valid_from)} – ${p.valid_to ? G.fmt.date(p.valid_to) : 'sin fin'}` }, { key: 'status', label: 'Estado', render: p => G.ui.status(p.status) }],
      fields: [{ key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nombre', required: true }, { key: 'plan_type', label: 'Tipo', type: 'select', options: [['SELLER_COLLECTED', 'Comisión sobre lo cobrado (vendedoras)'], ['DRIVER_DELIVERY', 'Bono por entrega (repartidores)']], required: true }, { key: 'brand_id', label: 'Marca (vacío = todas)', type: 'select', options: () => G.db.all('brands').map(b => [b.id, G.brandName(b.id)]) }, { key: 'channel', label: 'Canal (vacío = todos)', type: 'select', options: G.CHANNELS }, { key: 'rate_pct', label: '% sobre lo cobrado sin IGV', type: 'number', min: 0, max: 100 }, { key: 'per_delivery_amount', label: 'Monto por entrega S/', type: 'money', min: 0 }, { key: 'tiers_text', label: 'Tramos (desde S/;%) uno por línea', type: 'textarea', help: 'Ejemplo: 15000;2.5 — sobre la base cobrada del mes.' }, { key: 'alert_penalty_pct', label: 'Penalidad por alerta grave confirmada (%)', type: 'number', min: 0, max: 50, help: 'Se descuenta de la comisión del mes (máx. 50 %). Valor provisional hasta que gerencia lo confirme.' }, { key: 'valid_from', label: 'Desde', type: 'date', required: true }, { key: 'valid_to', label: 'Hasta', type: 'date' }, { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']], required: true }],
      defaults: () => ({ status: 'ACTIVE', plan_type: 'SELLER_COLLECTED', rate_pct: 2, alert_penalty_pct: 10, valid_from: G.date.addMonths(G.date.month(G.TODAY), 1) }),
      beforeSave: (v, r) => { if (G.db.find('commission_plans', p => p.code === v.code && (!r || p.id !== r.id))) return { code: 'Ya existe ese código.' }; if (v.plan_type === 'SELLER_COLLECTED' && !(Number(v.rate_pct) > 0)) return 'RN-PER-10: indica el porcentaje de comisión.'; if (v.plan_type === 'DRIVER_DELIVERY' && !(Number(v.per_delivery_amount) > 0)) return 'RN-PER-13: indica el monto por entrega.'; },
      afterSave: row => G.db.update('commission_plans', row.id, { tiers: String(row.tiers_text || '').split('\n').map(l => l.split(';').map(Number)).filter(x => x.length === 2 && x[0] >= 0 && x[1] >= 0).map(([from, rate_pct]) => ({ from, rate_pct })), rate_pct: row.rate_pct === '' ? null : Number(row.rate_pct), per_delivery_amount: row.per_delivery_amount === '' ? null : Number(row.per_delivery_amount), brand_id: row.brand_id || null, channel: row.channel || null }, { silent: true }),
    });
  }

  /* ------------------------------------------------------------------
     PER-11 Comisiones y bonos del período
     ------------------------------------------------------------------ */
  const S11 = { period: '2026-10-01' };
  function s11(el) {
    const per = S11.period; const closed = P.periodClosed(per); const can = G.can('per.commission.manage');
    const body = page(el, { code: 'PER-11', title: 'Comisiones y bonos del período', sub: 'Detalle por cobro asignado o entrega, reversos, totales por persona y estado de cierre (RN-PER-15). La comisión se calcula sobre lo cobrado sin IGV, nunca sobre pedidos sin cobrar.' });
    body.appendChild(h('div', { class: 'row' }, periodPills(per, v => { S11.period = v; G.refresh(); }), badge(closed ? `Cerrado el ${G.fmt.date(P.closeDate(per))}` : `Abierto · cierra el ${G.fmt.date(P.closeDate(per))}`, closed ? '' : 'info'),
      can ? btn('Procesar cobros pendientes', () => run(() => P.processPayments(per), n => n ? `${n} comisiones nuevas` : 'Sin cobros pendientes: cada asignación ya tiene su comisión (RN-PER-11)'), { sm: true }) : null,
      can ? btn('Procesar entregas', () => run(() => P.processDeliveries(per), n => n ? `${n} bonos nuevos` : 'Sin entregas pendientes de bono'), { sm: true }) : null));
    const es = P.entries(per);
    const g = U.groupBy(es, 'employee_id');
    const rows = Object.keys(g).map(id => Object.assign({ id, alerts: P.openGraveAlerts(id), conf: P.confirmedAlerts(id, per) }, P.totals(per, id))).sort((a, b) => (b.net + b.bonus) - (a.net + a.bonus));
    const t = P.totals(per);
    body.appendChild(kpis([{ label: 'Comisiones netas (KPI-PER-03)', value: G.fmt.money(t.net), sub: `sobre ${G.fmt.money(t.base)} cobrados sin IGV` }, { label: 'Reversos', value: G.fmt.money(t.reversals), tone: t.reversals ? 'warn' : '' }, { label: 'Bonos por entrega (KPI-PER-04)', value: G.fmt.money(t.bonus), sub: `${t.deliveries} entregas × ${G.fmt.money(G.param('per_delivery_bonus_amount'))}` }, { label: 'Comisión / cobrado (KPI-PER-08)', value: G.fmt.pct(t.base ? t.net / t.base * 100 : 0, 2) }, { label: 'Con alertas graves abiertas', value: rows.filter(r => r.alerts).length, tone: rows.some(r => r.alerts) ? 'bad' : '' }]));
    body.appendChild(table({ id: 'per11', rows, onRow: r => ledger(r.id, per), columns: [
      { key: 'e', label: 'Persona', value: r => empName(r.id) }, { key: 'pos', label: 'Puesto', value: r => (P.position(r.id) || {}).name },
      { key: 'base', label: 'Cobrado sin IGV', align: 'r', render: r => r.base ? G.fmt.money(r.base) : '—' }, { key: 'commission', label: 'Comisión', align: 'r', render: r => r.commission ? G.fmt.money(r.commission) : '—' },
      { key: 'reversals', label: 'Reversos', align: 'r', render: r => r.reversals ? G.fmt.money(r.reversals) : '—' }, { key: 'deliveries', label: 'Entregas', align: 'r' }, { key: 'bonus', label: 'Bono', align: 'r', render: r => r.bonus ? G.fmt.money(r.bonus) : '—' },
      { key: 'tot', label: 'Total', align: 'r', value: r => R(r.net + r.bonus), render: r => h('b', null, G.fmt.money(R(r.net + r.bonus))) },
      { key: 'alerts', label: 'Control', render: r => r.alerts ? badge(`${r.alerts} grave(s) abierta(s) · RN-PER-20`, 'bad') : r.conf ? badge(`${r.conf} confirmada(s) · penalidad`, 'warn') : badge('Sin alertas', 'ok') },
    ], footer: ['Total', '', { v: G.fmt.money(t.base), align: 'r' }, { v: G.fmt.money(t.commission), align: 'r' }, { v: G.fmt.money(t.reversals), align: 'r' }, { v: t.deliveries, align: 'r' }, { v: G.fmt.money(t.bonus), align: 'r' }, { v: G.fmt.money(R(t.net + t.bonus)), align: 'r' }, ''] }));
    const byB = U.groupBy(es.filter(c => planType(c) === 'SELLER_COLLECTED'), 'brand_id');
    body.appendChild(card('Comisión por marca', G.ui.chart.hbar({ items: Object.entries(byB).map(([b, l]) => ({ label: G.brandName(b), value: R(U.sum(l, c => c.amount)) })).sort((a, b) => b.value - a.value), format: v => G.fmt.money(v) })));
  }
  function ledger(id, per) {
    const es = P.entries(per, id).sort(U.by('earned_at', -1));
    drawer(`${empName(id)} · ${G.date.monthName(per)}`, b => {
      const t = P.totals(per, id);
      b.appendChild(dl([['Comisión', G.fmt.money(t.commission)], ['Reversos', G.fmt.money(t.reversals)], ['Bonos', `${G.fmt.money(t.bonus)} (${t.deliveries} entregas)`], ['Alertas graves abiertas', P.openGraveAlerts(id)], ['Alertas graves confirmadas en el mes', P.confirmedAlerts(id, per)]]));
      b.appendChild(notice('Libro de solo inserción (RN-PER-12): un cobro revertido genera una línea negativa en el período abierto.', 'info'));
      b.appendChild(table({ id: 'per11l-' + id, rows: es, columns: [{ key: 'earned_at', label: 'Fecha', render: c => G.fmt.datetime(c.earned_at) }, { key: 'source_type', label: 'Origen', value: c => ({ PAYMENT_ALLOCATION: 'Cobro', DELIVERY: 'Entrega', ADJUSTMENT: 'Ajuste', REVERSAL: 'Reverso' })[c.source_type] }, { key: 'o', label: 'Pedido', mono: true, value: c => (G.db.get('sales_orders', c.order_id) || {}).number }, { key: 'p', label: 'Cobro', mono: true, value: c => (G.db.get('payments', c.payment_id) || {}).number || '—' }, { key: 'b', label: 'Marca', value: c => G.brandName(c.brand_id) }, { key: 'base_amount', label: 'Base', align: 'r', render: c => c.base_amount ? G.fmt.num(c.base_amount, 2) : '—' }, { key: 'rate_pct', label: '%', align: 'r', render: c => c.rate_pct != null ? G.fmt.num(c.rate_pct, 2) : '—' }, { key: 'amount', label: 'Importe', align: 'r', render: c => G.fmt.money(c.amount) }, { key: 'reason', label: 'Motivo' }] }));
    }, { wide: true, code: 'PER-11' });
  }

  /* ------------------------------------------------------------------
     PER-12 Pagos al personal
     ------------------------------------------------------------------ */
  const S12 = { period: '2026-09-01' };
  function s12(el) {
    const per = S12.period; const canA = G.can('per.payout.approve');
    const vis = P.canSalary() || G.ctx.role === 'GERENTE';
    const rows = G.db.where('staff_payouts', p => p.period === per && (vis || p.employee_id === P.myEmp())).sort((a, b) => empName(a.employee_id).localeCompare(empName(b.employee_id)));
    const body = page(el, { code: 'PER-12', title: 'Pagos al personal', sub: 'Liquidación por persona y período: comisiones, bonos, jornales, adelantos, multas y penalidades; neto = bruto − descuentos, aprobación y pago (RN-PER-14). Las comisiones con alertas graves abiertas quedan retenidas (RN-PER-20).', actions: canA || G.can('per.commission.manage') ? [{ label: `Generar liquidaciones de ${G.date.monthName(per)}`, kind: 'primary', onClick: () => run(() => P.generatePayouts(per), r => r.length ? `${r.length} liquidaciones generadas${r.some(x => x.status === 'HELD') ? '; ' + r.filter(x => x.status === 'HELD').length + ' retenida(s) por RN-PER-20' : ''}` : 'Todas las personas del período ya tienen su liquidación') }, { label: 'Pago manual', onClick: () => manualPayout(per) }] : [] });
    body.appendChild(h('div', { class: 'row' }, periodPills(per, v => { S12.period = v; G.refresh(); }), !P.periodClosed(per) ? notice(`El período cierra el ${G.fmt.date(P.closeDate(per))} (RN-PER-15): lo generado ahora puede cambiar.`, 'warn') : null));
    const sum = st => R(U.sum(rows.filter(p => st.includes(p.status)), p => p.net_amount));
    body.appendChild(kpis([{ label: 'Borradores', value: rows.filter(p => p.status === 'DRAFT').length, sub: G.fmt.money(sum(['DRAFT'])) }, { label: 'Aprobados por pagar', value: rows.filter(p => p.status === 'APPROVED').length, sub: G.fmt.money(sum(['APPROVED'])) }, { label: 'Pagados', value: rows.filter(p => p.status === 'PAID').length, sub: G.fmt.money(sum(['PAID'])), tone: 'ok' }, { label: 'Retenidos (RN-PER-20)', value: rows.filter(p => p.status === 'HELD').length, sub: G.fmt.money(sum(['HELD'])), tone: rows.some(p => p.status === 'HELD') ? 'bad' : '' }]));
    body.appendChild(table({ id: 'per12', rows, onRow: p => openPayout(p.id), columns: [
      { key: 'e', label: 'Persona', value: p => empName(p.employee_id) }, { key: 'payout_type', label: 'Tipo', value: p => ({ COMMISSIONS: 'Comisiones', WAGES: 'Jornales', BONUS: 'Bonos', MIXED: 'Mixto' })[p.payout_type] },
      { key: 'gross_amount', label: 'Bruto', align: 'r', render: p => money(p.gross_amount, p.employee_id === P.myEmp()) }, { key: 'deductions_amount', label: 'Descuentos', align: 'r', render: p => money(p.deductions_amount, p.employee_id === P.myEmp()) }, { key: 'net_amount', label: 'Neto', align: 'r', render: p => h('b', null, money(p.net_amount, p.employee_id === P.myEmp())) },
      { key: 'status', label: 'Estado', render: p => bd(PAYST, p.status) }, { key: 'held_reason', label: 'Detalle', value: p => p.status === 'HELD' ? p.held_reason : p.status === 'PAID' ? `${G.fmt.date(p.paid_at)} · ${p.payment_reference}` : '' },
    ], actions: p => [canA && p.status === 'DRAFT' ? btn('Aprobar', () => run(() => P.approvePayout(p.id), 'Pago aprobado'), { sm: true, kind: 'primary' }) : null, canA && p.status === 'APPROVED' ? btn('Pagar', () => run(() => P.payPayout(p.id, { reference: 'TR-' + G.util.token(6).toUpperCase() }), 'Pago registrado (CAJ)'), { sm: true, kind: 'accent' }) : null, p.status === 'HELD' && G.can('per.supervision.manage') ? btn('Liberar', () => run(() => P.releaseHold(p.id, 'Revisado por supervisión'), 'Pago liberado'), { sm: true }) : null].filter(Boolean), filters: [{ key: 'status', label: 'Estado', options: Object.entries(PAYST).map(([k, v]) => [k, v[0]]) }] }));
  }
  function openPayout(id) {
    const p = G.db.get('staff_payouts', id);
    drawer(`Pago · ${empName(p.employee_id)} · ${G.date.monthName(p.period)}`, b => {
      if (p.status === 'HELD') b.appendChild(notice(p.held_reason, 'bad'));
      b.appendChild(dl([['Estado', bd(PAYST, p.status)], ['Bruto', G.fmt.money(p.gross_amount)], ['Descuentos', G.fmt.money(p.deductions_amount)], ['Neto (bruto − descuentos)', G.fmt.money(p.net_amount)], p.approved_by ? ['Aprobó', `${G.userName(p.approved_by)} · ${G.fmt.datetime(p.approved_at)}`] : null, p.paid_at ? ['Pagado', `${G.fmt.datetime(p.paid_at)} · ${(G.db.get('cash_accounts', p.cash_account_id) || {}).name || ''} · ${p.payment_reference}`] : null]));
      b.appendChild(table({ id: 'per12l-' + id, search: false, rows: P.linesOf(id), columns: [{ key: 'concept', label: 'Concepto', value: l => lbl(CONCEPTS, l.concept) }, { key: 'note', label: 'Detalle' }, { key: 'amount', label: 'Importe', align: 'r', render: l => (DEDUCT.includes(l.concept) ? '− ' : '') + G.fmt.money(l.amount) }] }));
    }, { code: 'PER-12' });
  }
  function manualPayout(per) {
    ask('Pago manual al personal', [{ key: 'employee_id', label: 'Trabajador', type: 'select', options: empOpts() }, { key: 'payout_type', label: 'Tipo', type: 'select', options: [['BONUS', 'Bono'], ['WAGES', 'Jornales'], ['MIXED', 'Mixto']] }, { key: 'gross_amount', label: 'Bruto S/', type: 'number' }, { key: 'deductions_amount', label: 'Descuentos S/', type: 'number', value: 0 }, { key: 'net_amount', label: 'Neto S/', type: 'number', help: 'RN-PER-14: debe ser bruto − descuentos.' }, { key: 'note', label: 'Concepto', type: 'textarea' }],
      v => P.savePayout(Object.assign({}, v, { period: per, lines: [{ concept: v.payout_type === 'WAGES' ? 'WAGE' : 'BONUS', amount: v.gross_amount, note: v.note }].concat(Number(v.deductions_amount) ? [{ concept: 'OTHER_DEDUCTION', amount: v.deductions_amount, note: 'Descuento' }] : []) })), { done: 'Pago registrado en borrador' });
  }

  /* ------------------------------------------------------------------
     PER-13 Supervisión
     ------------------------------------------------------------------ */
  function s13(el) {
    const can = G.can('per.supervision.manage');
    const rows = G.db.all('supervision_actions').sort((a, b) => (a.status === 'OPEN' ? 0 : 1) - (b.status === 'OPEN' ? 0 : 1) || String(b.raised_at || b.created_at).localeCompare(String(a.raised_at || a.created_at)));
    const unlinked = G.db.where('control_alerts', a => !G.db.find('supervision_actions', s => s.control_alert_id === a.id)).length;
    const body = page(el, { code: 'PER-13', title: 'Supervisión', sub: 'Alertas de control (CRM, TEL, FLO y asistencia) vinculadas al trabajador y a su supervisor, con la acción tomada; nada se borra (RN-PER-16).', actions: [G.modOn('CRM') && G.db.all('control_alerts').length ? btn(`Vincular alertas del CRM (${unlinked})`, () => run(() => P.linkControlAlerts(), n => `${n} alertas vinculadas`), { kind: 'primary' }) : null, can ? { label: 'Registrar caso', onClick: () => newCase() } : null].filter(Boolean) });
    if (!G.db.all('control_alerts').length) body.appendChild(notice('Las alertas de control del CRM se vinculan aquí cuando CRM las emite (control_alert.raised); este registro incluye además casos de asistencia y flota.', 'info'));
    body.appendChild(kpis([{ label: 'Abiertas', value: rows.filter(s => s.status === 'OPEN').length, tone: 'warn' }, { label: 'Graves abiertas', value: rows.filter(s => s.status === 'OPEN' && s.severity === 'HIGH').length, tone: 'bad', sub: 'retienen comisiones (RN-PER-20)' }, { label: 'Cerradas este mes', value: rows.filter(s => s.status === 'CLOSED' && (s.action_at || '') >= G.date.month(G.TODAY)).length }, { label: 'Llamadas de atención', value: rows.filter(s => ['VERBAL_WARNING', 'WRITTEN_WARNING'].includes(s.action)).length }]));
    body.appendChild(table({ id: 'per13', rows, onRow: s => detailCase(s), columns: [
      { key: 'raised_at', label: 'Fecha', render: s => G.fmt.date(s.raised_at || s.created_at) }, { key: 'e', label: 'Trabajador', value: s => empName(s.employee_id) }, { key: 'sup', label: 'Supervisor', value: s => empName(s.supervisor_employee_id) },
      { key: 'source', label: 'Origen', value: s => lbl(SV_SRC, s.source) }, { key: 'severity', label: 'Gravedad', render: s => badge({ LOW: 'Leve', MEDIUM: 'Media', HIGH: 'Grave' }[s.severity], { LOW: '', MEDIUM: 'warn', HIGH: 'bad' }[s.severity]) }, { key: 'summary', label: 'Resumen' },
      { key: 'action', label: 'Acción', value: s => s.action ? lbl(SV_ACT, s.action) : '—' }, { key: 'status', label: 'Estado', render: s => s.status === 'OPEN' ? badge('Abierta', 'warn') : badge('Cerrada', 'ok') },
    ], actions: s => can && s.status === 'OPEN' ? [btn('Registrar acción', () => ask(`Acción · ${empName(s.employee_id)}`, [{ key: 'action', label: 'Acción tomada', type: 'select', options: SV_ACT }, { key: 'note', label: 'Detalle', type: 'textarea' }], v => P.recordAction(s.id, v), { done: 'Acción registrada' }), { sm: true, kind: 'primary' })] : [],
      filters: [{ key: 'status', label: 'Estado', options: [['OPEN', 'Abierta'], ['CLOSED', 'Cerrada']] }, { key: 'source', label: 'Origen', options: SV_SRC }, { key: 'severity', label: 'Gravedad', options: [['LOW', 'Leve'], ['MEDIUM', 'Media'], ['HIGH', 'Grave']] }] }));
  }
  function detailCase(s) {
    drawer('Caso de supervisión', b => {
      const ca = s.control_alert_id && G.db.get('control_alerts', s.control_alert_id);
      b.appendChild(dl([['Trabajador', empName(s.employee_id)], ['Supervisor', empName(s.supervisor_employee_id)], ['Origen', lbl(SV_SRC, s.source)], ['Gravedad', s.severity], ['Resumen', s.summary], ca ? ['Alerta CRM', `${ca.matched_text} · ${ca.status}`] : null, ['Acción', s.action ? `${lbl(SV_ACT, s.action)} · ${s.action_note || ''}` : 'Pendiente'], s.action_by ? ['Registró', `${G.userName(s.action_by)} · ${G.fmt.datetime(s.action_at)}`] : null]));
      if (ca && ca.conversation_id && G.screens['CRM-02']) b.appendChild(btn('Abrir conversación', () => G.go('CRM-02', { id: ca.conversation_id }), { sm: true }));
    }, { code: 'PER-13' });
  }
  function newCase() {
    ask('Registrar caso', [{ key: 'employee_id', label: 'Trabajador', type: 'select', options: empOpts() }, { key: 'source', label: 'Origen', type: 'select', options: SV_SRC.filter(x => !['CRM_CONTROL_ALERT', 'TEL_CALL'].includes(x[0])) }, { key: 'severity', label: 'Gravedad', type: 'select', options: [['LOW', 'Leve'], ['MEDIUM', 'Media'], ['HIGH', 'Grave']] }, { key: 'summary', label: 'Qué pasó', type: 'textarea' }],
      v => { if (!v.summary) G.fail('RN-PER-16', 'Describe el caso.'); return G.db.insert('supervision_actions', { employee_id: v.employee_id, supervisor_employee_id: P.supervisor(v.employee_id), source: v.source, source_ref_id: null, control_alert_id: null, severity: v.severity, summary: v.summary, action: null, status: 'OPEN', raised_at: G.date.now() }); }, { done: 'Caso registrado' });
  }

  /* ------------------------------------------------------------------
     PER-14 Costo de personal
     ------------------------------------------------------------------ */
  const S14 = { period: '2026-09-01' };
  function s14(el) {
    const per = S14.period; const vis = P.canSalary() || G.ctx.role === 'GERENTE' || G.ctx.role === 'CONTADORA' || G.ctx.role === 'AUDITOR';
    const body = page(el, { code: 'PER-14', title: 'Costo de personal', sub: 'Por área, local, marca y por pedido entregado, con la planilla importada de Ayni HR, comisiones y bonos (RN-PER-17).' });
    body.appendChild(h('div', { class: 'row' }, periodPills(per, v => { S14.period = v; G.refresh(); }), P.importOf(per) ? badge(`Planilla importada de ${lbl(SOURCES, P.importOf(per).provider)}`, 'ok') : badge('Planilla aún no importada: costo estimado con las condiciones vigentes a la fecha', 'warn')));
    if (!vis) { body.appendChild(notice('RN-PER-19: el costo por persona es reservado; solo ves los totales.', 'info')); }
    const rows = P.costRows(per).filter(r => G.ctx.site === 'ALL' || r.establishment_id === G.ctx.site);
    const cpo = P.costPerOrder(per, { site: G.ctx.site !== 'ALL' ? G.ctx.site : null });
    const tot = R(U.sum(rows, r => r.amount));
    body.appendChild(kpis([{ label: 'Costo de personal por pedido (KPI-PER-01)', value: G.fmt.money(cpo.value), sub: `${G.fmt.money(cpo.numerator)} ventas, preparación y reparto / ${cpo.denominator} entregados` }, { label: 'Costo total del mes (KPI-PER-02)', value: G.fmt.money(tot) }, { label: 'Planilla', value: G.fmt.money(R(U.sum(rows.filter(r => r.kind.startsWith('PAYROLL')), r => r.amount))) }, { label: 'Comisiones', value: G.fmt.money(R(U.sum(rows.filter(r => r.kind === 'COMMISSION'), r => r.amount))) }, { label: 'Bonos por entrega', value: G.fmt.money(R(U.sum(rows.filter(r => r.kind === 'BONUS'), r => r.amount))) }]));
    const agg = (f) => { const g = U.groupBy(rows, f); return Object.entries(g).map(([k, l]) => ({ k, payroll: R(U.sum(l.filter(r => r.kind.startsWith('PAYROLL')), r => r.amount)), com: R(U.sum(l.filter(r => r.kind === 'COMMISSION'), r => r.amount)), bon: R(U.sum(l.filter(r => r.kind === 'BONUS'), r => r.amount)), tot: R(U.sum(l, r => r.amount)), n: new Set(l.map(r => r.employee_id)).size })).sort((a, b) => b.tot - a.tot); };
    const cols = lab => [{ key: 'k', label: lab }, { key: 'n', label: 'Personas', align: 'r' }, { key: 'payroll', label: 'Planilla', align: 'r', render: r => G.fmt.money(r.payroll) }, { key: 'com', label: 'Comisiones', align: 'r', render: r => G.fmt.money(r.com) }, { key: 'bon', label: 'Bonos', align: 'r', render: r => G.fmt.money(r.bon) }, { key: 'tot', label: 'Total', align: 'r', render: r => h('b', null, G.fmt.money(r.tot)) }, { key: 'pct', label: '%', align: 'r', value: r => tot ? r.tot / tot * 100 : 0, render: r => G.fmt.pct(tot ? r.tot / tot * 100 : 0) }];
    const areas = agg(r => lbl(AREAS, r.area));
    body.appendChild(h('div', { class: 'grid c2' }, card('Por área', G.ui.chart.hbar({ items: areas.map(a => ({ label: a.k, value: a.tot })), format: v => G.fmt.money(v, 0) })), card('Por pedido entregado y local', table({ id: 'per14o', search: false, rows: G.db.all('establishments').map(s => Object.assign({ s: s.short }, P.costPerOrder(per, { site: s.id }))), columns: [{ key: 's', label: 'Local' }, { key: 'numerator', label: 'Costo ventas, prep. y reparto', align: 'r', render: r => G.fmt.money(r.numerator) }, { key: 'denominator', label: 'Pedidos entregados', align: 'r' }, { key: 'value', label: 'Costo por pedido', align: 'r', render: r => h('b', null, G.fmt.money(r.value)) }] }))));
    body.appendChild(tabs0([
      { key: 'a', label: 'Por área', render: p => p.appendChild(table({ id: 'per14a', search: false, rows: areas, columns: cols('Área') })) },
      { key: 's', label: 'Por local', render: p => p.appendChild(table({ id: 'per14s', search: false, rows: agg(r => G.siteName(r.establishment_id)), columns: cols('Local') })) },
      { key: 'b', label: 'Por marca', render: p => p.appendChild(table({ id: 'per14b', search: false, rows: agg(r => r.brand_id ? G.brandName(r.brand_id) : 'Compartido (sin marca)'), columns: cols('Marca') })) },
      { key: 'c', label: 'Por centro de costo', render: p => p.appendChild(table({ id: 'per14c', rows: agg(r => G.ccName(r.cost_center_id)), columns: cols('Centro de costo') })) },
      vis ? { key: 'e', label: 'Por persona', render: p => p.appendChild(table({ id: 'per14e', rows: agg(r => empName(r.employee_id)), columns: cols('Persona') })) } : null,
    ].filter(Boolean)));
  }

  /* ------------------------------------------------------------------
     PER-15 Intercambio con Ayni HR
     ------------------------------------------------------------------ */
  const S15 = { period: '2026-10-01' };
  function s15(el) {
    const can = G.can('per.payroll.exchange'); const prov = G.param('per_payroll_source'); const per = S15.period;
    const body = page(el, { code: 'PER-15', title: 'Intercambio con Ayni HR', sub: 'Importa el costo de planilla del mes y exporta asistencia y conceptos variables a Ayni HR, o genera el archivo para el contador. PLAME, T-Registro, CTS, gratificaciones y boletas viven en Ayni HR (RN-PER-18).', actions: can ? [btn('Cambiar fuente', () => ask('Fuente de planilla (per_payroll_source)', [{ key: 'v', label: 'Fuente', type: 'select', options: SOURCES.filter(s => s[0] !== 'NONE'), value: prov }, { key: 'r', label: 'Motivo', type: 'textarea' }], v => G.setParam('per_payroll_source', v.v, v.r), { done: 'Fuente actualizada' }), { kind: 'ghost' })] : [] });
    body.appendChild(h('div', { class: 'row' }, periodPills(per, v => { S15.period = v; G.refresh(); }), badge('Fuente: ' + lbl(SOURCES, prov), 'info'),
      can ? btn(`Importar costo de ${G.date.monthName(per)}`, () => run(() => P.importCost(per, prov), x => `Costo importado: ${x.row_count} líneas · ${G.fmt.money(x.total_amount)}`), { kind: 'primary', sm: true }) : null,
      can ? btn(`Exportar variables de ${G.date.monthName(per)}`, () => run(() => P.exportVariables(per, prov), x => `${x.rows.length} trabajadores exportados${prov === 'ACCOUNTANT_FILE' ? ' a ' + x.exchange.file_url : ' a Ayni HR'}`), { sm: true }) : null));
    if (!P.periodClosed(per)) body.appendChild(notice(`El mes no está cerrado: las comisiones de ${G.date.monthName(per)} cierran el ${G.fmt.date(P.closeDate(per))} (RN-PER-15).`, 'warn'));
    const xs = G.db.all('payroll_exchanges').sort(U.by('created_at', -1));
    body.appendChild(card('Intercambios', table({ id: 'per15x', rows: xs, columns: [{ key: 'period', label: 'Mes', value: x => G.date.monthName(x.period) }, { key: 'direction', label: 'Sentido', value: x => x.direction === 'IMPORT_COST' ? 'Importación de costo' : 'Exportación de variables' }, { key: 'provider', label: 'Proveedor', value: x => lbl(SOURCES, x.provider) }, { key: 'file_url', label: 'Archivo', mono: true }, { key: 'row_count', label: 'Filas', align: 'r' }, { key: 'total_amount', label: 'Total', align: 'r', render: x => G.fmt.money(x.total_amount) }, { key: 'processed_at', label: 'Procesado', render: x => G.fmt.datetime(x.processed_at) }, { key: 'status', label: 'Estado', render: x => G.ui.status(x.status) }], onRow: x => x.direction === 'IMPORT_COST' && drawer('Costo importado ' + G.date.monthName(x.period), b => b.appendChild(table({ id: 'per15l-' + x.id, rows: G.db.where('payroll_cost_lines', l => l.exchange_id === x.id), columns: [{ key: 'e', label: 'Trabajador', value: l => empName(l.employee_id) }, { key: 'cc', label: 'CC', value: l => (G.db.get('cost_centers', l.cost_center_id) || {}).code }, { key: 'gross_salary', label: 'Remuneración', align: 'r', render: l => money(l.gross_salary) }, { key: 'employer_contributions', label: 'EsSalud', align: 'r', render: l => money(l.employer_contributions) }, { key: 'provisions', label: 'Provisiones', align: 'r', render: l => money(l.provisions) }, { key: 'total_cost', label: 'Costo', align: 'r', render: l => money(l.total_cost) }] })), { wide: true, code: 'PER-15' }) })));
    const vars = P.variables(per);
    body.appendChild(card(`Vista previa de variables · ${G.date.monthName(per)}`, table({ id: 'per15v', rows: vars, columns: [{ key: 'dni', label: 'DNI', mono: true, value: v => P.canSalary() ? v.dni : '••••' + v.dni.slice(-2) }, { key: 'name', label: 'Trabajador' }, { key: 'worked', label: 'Días trab.', align: 'r' }, { key: 'absences', label: 'Faltas', align: 'r' }, { key: 'leave', label: 'Permisos', align: 'r' }, { key: 'late', label: 'Min. tardanza', align: 'r' }, { key: 'overtime', label: 'HE aut. (min)', align: 'r' }, { key: 'commissions', label: 'Comisiones', align: 'r', render: v => money(v.commissions) }, { key: 'bonuses', label: 'Bonos', align: 'r', render: v => money(v.bonuses) }, { key: 'deductions', label: 'Descuentos', align: 'r', render: v => money(v.deductions) }] })));
    body.appendChild(notice('D-PER-03: comisiones y bonos se exportan a Ayni HR como conceptos variables; la contadora confirma su tratamiento remunerativo.', 'info'));
  }

  /* ------------------------------------------------------------------
     Registro
     ------------------------------------------------------------------ */
  const sp = G.SPEC.PER.screens; const nm = c => (sp.find(s => s[0] === c) || [, c])[1];
  G.register({ code: 'PER', name: 'Personal', phase: 3, group: 'Personas', screens: [
    { code: 'PER-01', name: nm('PER-01'), render: s01 }, { code: 'PER-02', name: nm('PER-02'), render: s02 }, { code: 'PER-03', name: nm('PER-03'), render: s03 }, { code: 'PER-04', name: nm('PER-04'), render: s04 }, { code: 'PER-05', name: nm('PER-05'), render: s05 },
    { code: 'PER-06', name: nm('PER-06'), render: s06 }, { code: 'PER-07', name: nm('PER-07'), render: s07 }, { code: 'PER-08', name: nm('PER-08'), render: s08 }, { code: 'PER-09', name: nm('PER-09'), render: s09 }, { code: 'PER-10', name: nm('PER-10'), render: s10 },
    { code: 'PER-11', name: nm('PER-11'), render: s11 }, { code: 'PER-12', name: nm('PER-12'), render: s12 }, { code: 'PER-13', name: nm('PER-13'), render: s13 }, { code: 'PER-14', name: nm('PER-14'), render: s14 }, { code: 'PER-15', name: nm('PER-15'), render: s15 },
  ] });

  /* ------------------------------------------------------------------
     Datos de ejemplo
     ------------------------------------------------------------------ */
  G.seed(66, function seedPersonal() {
    const r = U.rng(66066);
    const ins = (t, row) => G.db.insert(t, row, { silent: true });
    const usr = n => G.db.find('users', u => u.name.startsWith(n));
    const eid = n => { const u = usr(n); if (u) return u.employee_id; const e = G.db.find('employees', x => x.full_name.startsWith(n)); return e ? e.id : null; };
    // puestos
    const POS = [
      ['GER', 'Gerente general', 'ADMIN', 'es-L1', 'GERENTE', ['Dirige la operación de las 5 marcas', 'Aprueba gastos de nivel 3 y presupuesto', 'Revisa indicadores semanales']],
      ['ADM', 'Jefa de administración', 'ADMIN', null, 'ADMINISTRACION', ['Paga proveedores y personal', 'Controla la caja chica y las rendiciones', 'Arma el presupuesto anual']],
      ['SIS', 'Administrador del sistema', 'ADMIN', null, 'ADMIN_SISTEMA', ['Usuarios, permisos y parámetros', 'Integraciones (WhatsApp, WooCommerce, OSE)']],
      ['SUPV', 'Supervisora de ventas', 'SALES', 'es-L1', 'SUPERVISORA_VENTAS', ['Reasigna chats y revisa alertas de control', 'Aprueba descuentos y gastos de nivel 1', 'Capacita a las vendedoras']],
      ['VEN', 'Vendedora', 'SALES', 'es-L1', 'VENDEDORA', ['Atiende WhatsApp y redes de sus marcas', 'Registra pedidos con datos completos', 'Confirma el cobro y el comprobante']],
      ['CAJ', 'Cajero de mostrador', 'SALES', 'es-L1', 'CAJERO', ['Vende en mostrador con balanza', 'Arqueo de caja']],
      ['ALM', 'Almacenero', 'WAREHOUSE', null, 'ALMACENERO', ['Recepción con control de calidad mínimo', 'Transferencias y conteos', 'FEFO y mermas']],
      ['PREP', 'Preparador de pedidos', 'WAREHOUSE', 'es-L1', 'PREPARADOR', ['Arma pedidos con escaneo', 'Pesa y embolsa', 'Verifica la carga']],
      ['COOR', 'Coordinador de delivery', 'DELIVERY', 'es-L1', 'COORDINADOR_DELIVERY', ['Arma rutas y asigna vehículos', 'Contrata empresas de delivery', 'Aprueba gastos de reparto de nivel 1']],
      ['REP', 'Repartidor', 'DELIVERY', null, 'REPARTIDOR', ['Entrega con prueba de entrega', 'Cobra contra entrega y liquida su caja', 'Registra combustible y peajes']],
      ['REPE', 'Repartidor eventual (jornal)', 'DELIVERY', 'es-L2', 'REPARTIDOR', ['Cubre la ruta de Lurín', 'Moto alquilada']],
      ['MKT', 'Analista de marketing', 'MARKETING', null, 'MARKETING', ['Campañas en Google, Meta y TikTok', 'Coordina creadores de contenido', 'Mide el costo por pedido']],
      ['JPRO', 'Jefe de producción', 'PRODUCTION', 'es-L2', 'JEFE_PRODUCCION', ['Planifica la producción diaria', 'Controla rendimientos y mermas']],
      ['OPE', 'Operario de producción', 'PRODUCTION', null, 'OPERARIO_PRODUCCION', ['Beneficio, despiece y cortes', 'Registra consumos']],
      ['EMP', 'Operario de empaque', 'PRODUCTION', 'es-L2', null, ['Envasado al vacío y etiquetado']],
      ['LIM', 'Limpieza y desinfección', 'PRODUCTION', 'es-L2', null, ['Limpieza nocturna de la planta', 'Registro de desinfección']],
      ['CAL', 'Responsable de calidad', 'QUALITY', 'es-L2', 'CALIDAD', ['Libera lotes', 'Controla temperaturas']],
      ['COM', 'Asistente de compras', 'ADMIN', null, 'COMPRAS', ['Órdenes de compra', 'Seguimiento a proveedores']],
      ['CONT', 'Contadora', 'FINANCE', null, 'CONTADORA', ['Cierre contable mensual', 'SIRE y libros electrónicos']],
      ['PRAC', 'Practicante contable', 'FINANCE', null, 'PRACTICANTE_CONTABLE', ['Clasifica comprobantes', 'Concilia bancos']],
      ['VIS', 'Visitador de consignación', 'SALES', null, 'VISITADOR_CONSIGNACION', ['Visita puntos de consignación', 'Liquida ventas en consignación']],
      ['RRHH', 'Asistente de RR. HH.', 'HR', null, 'RRHH', ['Asistencia y turnos', 'Comisiones, bonos y adelantos', 'Intercambio con Ayni HR']],
      ['AUD', 'Auditoría externa', 'FINANCE', null, 'AUDITOR', ['Revisión anual (servicio externo)']],
    ];
    const PID = {};
    for (const [code, name, area, est, role, fns] of POS) PID[code] = ins('job_positions', { id: 'jp-' + code, code, name, area, establishment_id: est, functions: fns, functions_text: fns.join('\n'), default_role: role, pay_scheme: code === 'REPE' ? 'DAILY' : code === 'EMP' ? 'HOURLY' : 'MONTHLY', status: 'ACTIVE' }).id;
    const ROSA = eid('Rosa Quispe'), CARMEN = eid('Carmen'), PATRICIA = eid('Patricia'), RAUL = eid('Raúl'), OSCAR = eid('Óscar'), MIGUEL = eid('Miguel');
    // [nombre, puesto, [[cc, pct]], supervisor]
    const A = [
      ['Rosa Quispe', 'GER', [['ADM', 100]], null], ['Luis Ccahuana', 'SIS', [['ADM', 100]], ROSA], ['Carmen Huamán', 'ADM', [['ADM', 70], ['FIN', 30]], ROSA], ['Patricia León', 'SUPV', [['VEN-DG', 40], ['VEN-M2', 15], ['VEN-M3', 15], ['VEN-M4', 15], ['VEN-M5', 15]], ROSA],
      ['Ana Torres', 'VEN', [['VEN-DG', 100]], PATRICIA], ['Betty Ramos', 'VEN', [['VEN-DG', 100]], PATRICIA], ['Carla Núñez', 'VEN', [['VEN-M2', 50], ['VEN-M3', 50]], PATRICIA], ['Diana Flores', 'VEN', [['VEN-M4', 50], ['VEN-M5', 50]], PATRICIA], ['Elena Vargas', 'VEN', [['VEN-DG', 50], ['VEN-M5', 50]], PATRICIA],
      ['Jorge Salas', 'CAJ', [['VEN-MOS', 100]], PATRICIA], ['Miguel Torres', 'ALM', [['ALM-L1', 100]], CARMEN], ['Iván Rojas', 'ALM', [['ALM-L2', 100]], OSCAR], ['Sonia Mamani', 'PREP', [['ALM-L1', 100]], MIGUEL], ['Willy Huanca', 'PREP', [['ALM-L1', 100]], MIGUEL],
      ['Raúl Chávez', 'COOR', [['DEL', 100]], ROSA], ['Pedro Condori', 'REP', [['DEL', 100]], RAUL], ['Hugo Ticona', 'REP', [['DEL', 100]], RAUL], ['Julio Choque', 'REPE', [['DEL', 100]], RAUL],
      ['Lucía Paredes', 'MKT', [['MKT-DG', 60], ['MKT-M2', 10], ['MKT-M3', 10], ['MKT-M4', 10], ['MKT-M5', 10]], ROSA], ['Óscar Lazo', 'JPRO', [['PROD-L2', 100]], ROSA], ['Nilda Poma', 'OPE', [['PROD-L2', 100]], OSCAR], ['Víctor Apaza', 'OPE', [['PROD-L1', 100]], OSCAR],
      ['Silvia Ramos', 'CAL', [['CAL', 100]], ROSA], ['Diego Flores', 'COM', [['ADM', 100]], CARMEN], ['CPC Marisol', 'CONT', [['FIN', 100]], ROSA], ['Kevin Huerta', 'PRAC', [['FIN', 100]], null], ['Andrea Cusi', 'PRAC', [['FIN', 100]], null], ['Marco Villa', 'VIS', [['VEN-DG', 100]], PATRICIA],
      ['Gabriela Soto', 'RRHH', [['RRHH', 100]], CARMEN], ['Auditor externo', 'AUD', [['FIN', 100]], null], ['Teodoro Mayta', 'EMP', [['PROD-L2', 100]], OSCAR], ['Rosa Inga', 'OPE', [['PROD-L2', 100]], OSCAR], ['Felipe Ñahui', 'ALM', [['ALM-L1', 100]], MIGUEL], ['Lidia Vilca', 'LIM', [['PROD-L2', 100]], OSCAR],
    ];
    const MARISOL = eid('CPC Marisol');
    for (const [n, pos, ccs, sup] of A) {
      const id = eid(n); if (!id) continue; const e = G.db.get('employees', id);
      const site = (G.db.get('job_positions', PID[pos]) || {}).establishment_id || e.establishment_id;
      ccs.forEach(([cc, pct], i) => ins('employee_assignments', { employee_id: id, position_id: PID[pos], establishment_id: site, cost_center_id: 'cc-' + cc, supervisor_employee_id: sup || (pos === 'PRAC' ? MARISOL : null), allocation_pct: pct, is_primary: i === 0, valid_from: e.hire_date, valid_to: null }));
      // condiciones de pago
      const ref = 'AYNI-' + e.doc_number.slice(-5);
      if (n === 'Julio Choque') { ins('employment_terms', { employee_id: id, pay_scheme: 'MONTHLY', monthly_amount: 1400, payroll_source: 'AYNI_HR', external_ref: ref, valid_from: e.hire_date, valid_to: '2026-06-30' }); ins('employment_terms', { employee_id: id, pay_scheme: 'DAILY', daily_rate: 62, payroll_source: 'AYNI_HR', external_ref: ref, valid_from: '2026-07-01', valid_to: null }); }
      else if (n === 'Teodoro Mayta') ins('employment_terms', { employee_id: id, pay_scheme: 'HOURLY', hourly_rate: 6.2, payroll_source: 'AYNI_HR', external_ref: ref, valid_from: e.hire_date, valid_to: null });
      else if (n === 'Ana Torres') { ins('employment_terms', { employee_id: id, pay_scheme: 'MONTHLY', monthly_amount: 1400, payroll_source: 'AYNI_HR', external_ref: ref, valid_from: e.hire_date, valid_to: '2026-03-31' }); ins('employment_terms', { employee_id: id, pay_scheme: 'MONTHLY', monthly_amount: 1500, payroll_source: 'AYNI_HR', external_ref: ref, valid_from: '2026-04-01', valid_to: null }); }
      else ins('employment_terms', { employee_id: id, pay_scheme: 'MONTHLY', monthly_amount: pos === 'AUD' ? 0 : e.monthly_salary, payroll_source: pos === 'AUD' ? 'NONE' : pos === 'PRAC' ? 'ACCOUNTANT_FILE' : 'AYNI_HR', external_ref: pos === 'AUD' ? null : ref, valid_from: e.hire_date, valid_to: null });
    }
    // turnos
    const SH = [['es-L1', 'MAN', 'Mañana', '08:00', '17:00', 60, false], ['es-L1', 'TAR', 'Tarde', '11:00', '20:00', 60, false], ['es-L1', 'MOS', 'Mostrador', '09:00', '18:00', 60, false], ['es-L1', 'ADM', 'Oficina', '08:30', '17:30', 60, false], ['es-L1', 'REP', 'Reparto Surco', '08:30', '17:30', 45, false],
      ['es-L2', 'PRD', 'Producción', '06:00', '15:00', 60, false], ['es-L2', 'REP2', 'Reparto Lurín', '08:00', '17:00', 45, false], ['es-L2', 'ADM2', 'Oficina Lurín', '07:30', '16:30', 60, false], ['es-L2', 'NOC', 'Limpieza nocturna', '22:00', '06:00', 30, true]];
    const SID = {};
    for (const [est, code, name, a, b, brk, cross] of SH) SID[code] = ins('shifts', { id: `sh-${code}`, establishment_id: est, code, name, start_time: a, end_time: b, break_minutes: brk, crosses_midnight: cross, late_tolerance_minutes: null, status: 'ACTIVE' }).id;
    const shiftFor = { 'Patricia León': 'MAN', 'Ana Torres': 'MAN|TAR', 'Betty Ramos': 'TAR|MAN', 'Carla Núñez': 'MAN', 'Diana Flores': 'TAR', 'Elena Vargas': 'MAN', 'Jorge Salas': 'MOS', 'Miguel Torres': 'MAN', 'Iván Rojas': 'PRD', 'Sonia Mamani': 'MAN', 'Willy Huanca': 'TAR', 'Raúl Chávez': 'REP', 'Pedro Condori': 'REP', 'Hugo Ticona': 'REP', 'Julio Choque': 'REP2', 'Lucía Paredes': 'ADM', 'Óscar Lazo': 'PRD', 'Nilda Poma': 'PRD', 'Víctor Apaza': 'MAN', 'Silvia Ramos': 'ADM2', 'Diego Flores': 'ADM', 'Kevin Huerta': 'ADM', 'Andrea Cusi': 'ADM', 'Marco Villa': 'ADM', 'Gabriela Soto': 'ADM', 'Carmen Huamán': 'ADM', 'Teodoro Mayta': 'PRD', 'Rosa Inga': 'PRD', 'Felipe Ñahui': 'MAN', 'Lidia Vilca': 'NOC' };
    const office = ['ADM', 'ADM2'];
    // permisos y vacaciones
    const LV = [['Betty Ramos', 'VACATION', '2026-09-21', '2026-09-26', 'Vacaciones programadas', 'APPROVED'], ['Willy Huanca', 'MEDICAL', '2026-10-06', '2026-10-06', 'Descanso médico (gastroenteritis)', 'APPROVED'], ['Diana Flores', 'VACATION', '2026-10-19', '2026-10-24', 'Viaje familiar a Cusco', 'REQUESTED'], ['Nilda Poma', 'PERMISSION', '2026-10-12', '2026-10-12', 'Trámite en RENIEC', 'REQUESTED']];
    const RRHHU = (usr('Gabriela') || {}).id;
    for (const [n, t, a, b, why, st] of LV) ins('leave_requests', { employee_id: eid(n), leave_type: t, date_from: a, date_to: b, days: G.date.diff(b, a) + 1, reason: why, status: st, requested_by: (P.userOf(eid(n)) || {}).id || RRHHU, approved_by: st === 'APPROVED' ? RRHHU : null, decided_at: st === 'APPROVED' ? G.date.add(a, -5) + 'T10:00' : null });
    // programación 01/09 – 18/10 y asistencia hasta hoy
    const WEEK0 = '2026-08-31';
    const absent = new Set(['Hugo Ticona|2026-09-14', 'Felipe Ñahui|2026-09-28', 'Willy Huanca|2026-10-02']);
    for (const [n, codes] of Object.entries(shiftFor)) {
      const id = eid(n); if (!id) continue;
      for (let d = '2026-09-01'; d <= '2026-10-18'; d = G.date.add(d, 1)) {
        const dow = G.date.parse(d).getUTCDay(); const wk = Math.floor(G.date.diff(d, WEEK0) / 7);
        const opts = codes.split('|'); const code = opts[wk % opts.length];
        const rest = n === 'Elena Vargas' ? dow === 3 : n === 'Lidia Vilca' ? dow === 6 : dow === 0;
        const hol = isHoliday(d) && office.includes(code);
        const sa = ins('shift_assignments', { employee_id: id, shift_id: SID[code], work_date: d, status: rest ? 'REST' : 'PLANNED', overtime_authorized_minutes: !rest && ['REP', 'REP2'].includes(code) && dow === 5 ? 60 : 0, overtime_authorized_by: !rest && ['REP', 'REP2'].includes(code) && dow === 5 ? (usr('Raúl') || {}).id : null });
        if (d > G.TODAY) continue;
        const sh = G.db.get('shifts', SID[code]);
        if (rest) { ins('attendance_days', { employee_id: id, work_date: d, shift_assignment_id: sa.id, first_in: null, last_out: null, worked_minutes: 0, late_minutes: 0, overtime_minutes: 0, unauthorized_minutes: 0, status: 'REST' }); continue; }
        if (hol) { ins('attendance_days', { employee_id: id, work_date: d, shift_assignment_id: sa.id, first_in: null, last_out: null, worked_minutes: 0, late_minutes: 0, overtime_minutes: 0, unauthorized_minutes: 0, status: 'HOLIDAY' }); continue; }
        const lv = G.db.find('leave_requests', l => l.employee_id === id && l.status === 'APPROVED' && l.date_from <= d && l.date_to >= d);
        if (lv) { ins('attendance_days', { employee_id: id, work_date: d, shift_assignment_id: sa.id, first_in: null, last_out: null, worked_minutes: 0, late_minutes: 0, overtime_minutes: 0, unauthorized_minutes: 0, status: 'LEAVE', justification: lbl(LEAVE_T, lv.leave_type) }); continue; }
        if (absent.has(n + '|' + d)) { ins('attendance_days', { employee_id: id, work_date: d, shift_assignment_id: sa.id, first_in: null, last_out: null, worked_minutes: 0, late_minutes: 0, overtime_minutes: 0, unauthorized_minutes: 0, status: 'ABSENT', justification: n === 'Felipe Ñahui' ? 'Avisó por WhatsApp a las 10:00: emergencia familiar' : null, justification_approved: n === 'Felipe Ñahui' ? true : false, approved_by: n === 'Felipe Ñahui' ? RRHHU : null }); if (n === 'Felipe Ñahui') G.db.t.attendance_days[G.db.t.attendance_days.length - 1].status = 'LEAVE'; continue; }
        const late = r() < (n === 'Hugo Ticona' ? 0.25 : 0.07);
        const inOff = late ? U.int(r, 12, 34) : -U.int(r, 0, 12);
        const outOff = ['REP', 'REP2'].includes(code) ? U.int(r, -5, dow === 5 ? 75 : 35) : U.int(r, 0, 25);
        const base = toSec(d + 'T' + sh.start_time);
        const endBase = toSec((sh.crosses_midnight ? G.date.add(d, 1) : d) + 'T' + sh.end_time);
        const tin = fromSec(base + inOff * 60).slice(0, 16), tout = fromSec(endBase + outOff * 60).slice(0, 16);
        const isToday = d === G.TODAY; const inMark = isToday ? sh.start_time <= '09:00' : true;
        if (d >= '2026-10-01') {
          if (!inMark) continue;
          const geo = ['REP', 'REP2'].includes(code); const est = G.db.get('establishments', sh.establishment_id);
          const mk = (type, at) => { const m = { employee_id: id, establishment_id: sh.establishment_id, mark_type: type, marked_at: at + ':' + U.pad(U.int(r, 0, 59), 2), method: geo ? 'GEO' : 'QR', lat: geo ? est.lat + (r() - 0.5) * 0.0008 : null, lng: geo ? est.lng + (r() - 0.5) * 0.0008 : null, distance_m: null, qr_token_id: null, device_id: 'cel-' + G.db.get('employees', id).doc_number.slice(-4), is_valid: true, invalid_reason: null, manual_reason: null, approved_by_employee_id: null, offline_uuid: 'seed-' + id.slice(-6) + '-' + at.replace(/\D/g, '') + type }; if (geo) m.distance_m = R(G.geo.km([m.lat, m.lng], [est.lat, est.lng]) * 1000, 1); else { const tk = P.qrToken(sh.establishment_id, m.marked_at); m.qr_token_id = tk.id; } ins('attendance_marks', m); };
          if (n === 'Pedro Condori' && d === '2026-10-07') { ins('attendance_marks', { employee_id: id, establishment_id: sh.establishment_id, mark_type: 'IN', marked_at: d + 'T08:24:10', method: 'MANUAL', is_valid: true, manual_reason: 'Se le descargó el celular; marcó en la tablet del coordinador', approved_by_employee_id: RAUL, offline_uuid: 'seed-man-1' }); }
          else mk('IN', tin);
          if (n === 'Julio Choque' && d === '2026-10-09') { const est = G.db.get('establishments', 'es-L2'); ins('attendance_marks', { employee_id: id, establishment_id: 'es-L2', mark_type: 'IN', marked_at: d + 'T07:41:05', method: 'GEO', lat: est.lat + 0.002248, lng: est.lng, distance_m: 250, is_valid: false, invalid_reason: `RN-PER-03: marcación a 250 m de ${est.short}; el radio permitido es 100 m.`, device_id: 'cel-julio', offline_uuid: 'seed-inv-1' }); }
          if (!isToday) mk('OUT', tout);
          P.consolidate(id, d);
        } else {
          const row = { employee_id: id, work_date: d, shift_assignment_id: sa.id, first_in: tin, last_out: tout, worked_minutes: Math.round((toSec(tout) - toSec(tin)) / 60 - sh.break_minutes), late_minutes: P.lateMinutes(sh.start_time, hm(tin), shiftTol(sh)), overtime_minutes: 0, unauthorized_minutes: 0 };
          const extra = Math.max(0, Math.round((toSec(tout) - endBase) / 60)); row.overtime_minutes = Math.min(extra, sa.overtime_authorized_minutes); row.unauthorized_minutes = extra - row.overtime_minutes;
          row.status = row.late_minutes > 0 ? 'LATE' : 'PRESENT'; ins('attendance_days', row);
        }
      }
    }
    // planes de comisión y bono
    ins('commission_plans', { id: 'cp-VEN-2', code: 'COM-VEN-2', name: 'Comisión vendedoras 2 % sobre lo cobrado', plan_type: 'SELLER_COLLECTED', brand_id: null, channel: null, rate_pct: 2, per_delivery_amount: null, tiers: [], tiers_text: '', alert_penalty_pct: 10, valid_from: '2026-01-01', valid_to: null, status: 'ACTIVE' });
    ins('commission_plans', { id: 'cp-VEN-TR', code: 'COM-VEN-TRAMOS', name: 'Comisión con tramos (propuesta 2027)', plan_type: 'SELLER_COLLECTED', brand_id: null, channel: null, rate_pct: 2, per_delivery_amount: null, tiers: [{ from: 15000, rate_pct: 2.5 }, { from: 25000, rate_pct: 3 }], tiers_text: '15000;2.5\n25000;3', alert_penalty_pct: 10, valid_from: '2027-01-01', valid_to: null, status: 'INACTIVE' });
    ins('commission_plans', { id: 'cp-REP-150', code: 'BON-REP-150', name: 'Bono por entrega S/ 1,50', plan_type: 'DRIVER_DELIVERY', brand_id: null, channel: null, rate_pct: null, per_delivery_amount: 1.5, tiers: [], tiers_text: '', valid_from: '2026-01-01', valid_to: null, status: 'ACTIVE' });
    // comisiones (cobros procesados al momento del cobro) y bonos por entrega
    for (const p of G.db.all('payments').slice().sort(U.by('paid_at'))) P.onPaymentConfirmed({ payment_id: p.id }, { processedAt: (p.paid_at || G.TODAY).slice(0, 10) });
    for (const o of G.db.where('sales_orders', o => ['DELIVERED', 'CLOSED'].includes(o.status) && o.delivered_at)) P.onOrderDelivered({ order_id: o.id }, { processedAt: o.delivered_at.slice(0, 10) });
    // supervisión: alertas del CRM si existen; si no, casos de ejemplo
    P.linkControlAlerts();
    const SV = [['Betty Ramos', 'CRM_CONTROL_ALERT', 'HIGH', 'Pidió al cliente pagar por Yape a un número personal («yapéame a mi número»)', null, null, '2026-10-08T16:20'], ['Elena Vargas', 'CRM_CONTROL_ALERT', 'HIGH', 'Prometió 20 % de descuento sin aprobación de la supervisora', 'WRITTEN_WARNING', 'Se revisó la conversación; llamada de atención escrita y se anuló el descuento', '2026-09-17T11:05'],
      ['Carla Núñez', 'CRM_CONTROL_ALERT', 'MEDIUM', 'Demoró 48 min en responder un chat con pedido de restaurante', 'OBSERVATION', 'Coincidió con caída de WhatsApp Business; se reforzó la cobertura', '2026-10-03T13:40'], ['Ana Torres', 'CRM_CONTROL_ALERT', 'LOW', 'Lenguaje informal con un cliente B2B', 'NO_ACTION', null, '2026-09-22T10:15'],
      ['Pedro Condori', 'FLO_FINE', 'MEDIUM', 'Papeleta por estacionar en zona rígida (BXR-871)', 'VERBAL_WARNING', 'Se le explicó la política de estacionamiento; multa a cargo de la empresa por esta vez', '2026-09-18T18:00'], ['Hugo Ticona', 'ATTENDANCE', 'MEDIUM', '3 tardanzas en la semana del 05/10', null, null, '2026-10-09T09:00']];
    for (const [n, src, sev, sum, act, note, at] of SV) { const id = eid(n); ins('supervision_actions', { employee_id: id, supervisor_employee_id: P.supervisor(id), source: src, source_ref_id: null, control_alert_id: null, severity: sev, summary: sum, action: act, action_note: note, action_by: act ? (usr('Patricia') || {}).id : null, action_at: act ? G.date.add(at.slice(0, 10), 1) + 'T10:00' : null, status: act ? 'CLOSED' : 'OPEN', raised_at: at }); }
    // adelantos
    const ADV = [['Hugo Ticona', 300, '2026-09-10', 'Pago de matrícula escolar', 'DEDUCTED', '2026-09-01'], ['Sonia Mamani', 400, '2026-10-02', 'Reparación de su cocina', 'PAID', '2026-10-01'], ['Ana Torres', 450, '2026-10-09', 'Medicinas para su madre', 'REQUESTED', '2026-10-01'], ['Teodoro Mayta', 600, '2026-09-25', 'Compra de terreno', 'REJECTED', '2026-10-01']];
    for (const [n, amt, on, why, st, per] of ADV) { const id = eid(n); ins('salary_advances', { employee_id: id, requested_by: (P.userOf(id) || {}).id || RRHHU, requested_on: on, amount: amt, reason: why, status: st, approved_by: st === 'REQUESTED' ? null : (usr('Rosa Quispe') || {}).id, approved_at: st === 'REQUESTED' ? null : G.date.add(on, 1) + 'T12:00', deduct_period: per, payment_id: null, paid_at: ['PAID', 'DEDUCTED'].includes(st) ? G.date.add(on, 1) + 'T16:00' : null, decision_note: st === 'REJECTED' ? 'RN-PER-09: supera el 30 % de su remuneración' : null }); }
    // planilla importada de agosto y setiembre; variables de setiembre exportadas
    for (const per of ['2026-08-01', '2026-09-01']) { const x = P.importCost(per, 'AYNI_HR'); x.processed_at = G.date.add(G.date.addMonths(per, 1), 3) + 'T17:30'; x.created_at = x.processed_at; }
    const ev = P.exportVariables('2026-09-01', 'AYNI_HR'); ev.exchange.processed_at = '2026-10-06T09:15'; ev.exchange.created_at = ev.exchange.processed_at;
    // pagos de setiembre (comisiones cerradas el 05/10)
    const pays = P.generatePayouts('2026-09-01');
    for (const p of pays) {
      if (p.status === 'HELD') continue;
      p.status = 'PAID'; p.approved_by = (usr('Rosa Quispe') || {}).id; p.approved_at = '2026-10-06T10:00'; p.cash_account_id = 'ca-BCP-CTE'; p.paid_at = '2026-10-07T11:30'; p.payment_reference = 'TR-' + U.int(r, 100000, 999999);
      for (const l of P.linesOf(p.id)) if (l.ref_type === 'salary_advance') G.db.get('salary_advances', l.ref_id).status = 'DEDUCTED';
    }
  }, 'personal');

  /* ------------------------------------------------------------------
     Pruebas de aceptación (CA-PER-01 … 09)
     ------------------------------------------------------------------ */
  const T = (name, fn) => G.tests.push({ module: 'PER', name, fn });
  const expectRule = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e; throw new Error(`Se esperaba ${code} y salió: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code} y la operación pasó.`); };
  const newEmp = (name, salary = 1200, role) => {
    const e = G.db.insert('employees', { doc_type: 'DNI', doc_number: '7' + String(Math.floor(1e7 * Math.random())).padStart(7, '0'), full_name: name, position: 'Prueba', establishment_id: 'es-L1', hire_date: '2026-01-01', status: 'ACTIVE', monthly_salary: salary }, { silent: true });
    G.db.insert('employee_assignments', { employee_id: e.id, position_id: role === 'REPARTIDOR' ? 'jp-REP' : 'jp-PREP', establishment_id: 'es-L1', cost_center_id: role === 'REPARTIDOR' ? 'cc-DEL' : 'cc-ALM-L1', allocation_pct: 100, is_primary: true, valid_from: '2026-01-01' }, { silent: true });
    G.db.insert('employment_terms', { employee_id: e.id, pay_scheme: 'MONTHLY', monthly_amount: salary, payroll_source: 'AYNI_HR', valid_from: '2026-01-01', valid_to: null }, { silent: true });
    let u = null; if (role) u = G.db.insert('users', { name, email: 'test@donguando.pe', role, employee_id: e.id, brands: ['br-DG'], sites: ['es-L1'], status: 'ACTIVE' }, { silent: true });
    return { e, u };
  };
  const order = (seller, extra = {}) => G.db.insert('sales_orders', Object.assign({ number: 'P-T' + G.util.token(5), brand_id: 'br-DG', establishment_id: 'es-L1', channel: 'WHATSAPP', customer_id: 'cu-0001', seller_id: seller, fulfillment: 'DELIVERY', status: 'DELIVERED', estimated_total: 100, final_total: 100, paid_amount: 0, lines: [], history: [] }, extra), { silent: true });
  T('CA-PER-01: 2 % sobre S/ 11 800 cobrados con IGV da S/ 200; revertir un cobro de S/ 590 registra −S/ 10 en el período abierto', () => {
    const seller = G.db.find('users', u => u.role === 'VENDEDORA');
    const o1 = order(seller.id), o2 = order(seller.id);
    const p1 = G.pay.register({ customer_id: 'cu-0001', payment_method_id: 'pm-YAPE', amount: 11210, reference: 'OP-T1', allocations: [{ order_id: o1.id, amount: 11210 }], brand_id: 'br-DG', establishment_id: 'es-L1' });
    const p2 = G.pay.register({ customer_id: 'cu-0001', payment_method_id: 'pm-YAPE', amount: 590, reference: 'OP-T2', allocations: [{ order_id: o2.id, amount: 590 }], brand_id: 'br-DG', establishment_id: 'es-L1' });
    const es = G.db.where('commission_entries', c => [p1.id, p2.id].includes(c.payment_id));
    const base = R(U.sum(es, c => c.base_amount)), tot = R(U.sum(es, c => c.amount));
    if (base !== 10000 || tot !== 200) throw new Error(`Base ${base} y comisión ${tot}; se esperaba 10 000 y 200`);
    G.events.emit('payment.reversed', { payment_id: p2.id, reason: 'Yape rechazado por el banco' });
    const rev = G.db.find('commission_entries', c => c.payment_id === p2.id && c.source_type === 'REVERSAL');
    if (!rev || rev.amount !== -10) throw new Error('Reverso esperado −10 y salió ' + (rev && rev.amount));
    if (rev.period !== P.periodFor(G.TODAY) || P.periodClosed(rev.period)) throw new Error('El reverso no quedó en el período abierto');
  });
  T('CA-PER-02: repartidor con 220 entregados y 6 no entregados recibe S/ 330 de bono', () => {
    const { e, u } = newEmp('Repartidor de prueba', 1400, 'REPARTIDOR');
    for (let i = 0; i < 226; i++) order(null, { driver_user_id: u.id, status: i < 220 ? 'DELIVERED' : 'NOT_DELIVERED', delivered_at: i < 220 ? '2026-10-0' + (1 + i % 9) + 'T12:00' : null });
    P.processDeliveries('2026-10-01');
    const t = P.totals('2026-10-01', e.id);
    if (t.deliveries !== 220 || t.bonus !== 330) throw new Error(`Entregas ${t.deliveries} y bono ${t.bonus}`);
    P.processDeliveries('2026-10-01');
    if (P.totals('2026-10-01', e.id).bonus !== 330) throw new Error('Se duplicó el bono (uno por pedido y repartidor)');
  });
  T('CA-PER-03: marcación por GPS a 250 m queda inválida con su distancia y no cuenta como entrada', () => {
    const { e } = newEmp('Trabajador GPS');
    const est = G.db.get('establishments', 'es-L1');
    const m = P.mark({ employee_id: e.id, establishment_id: 'es-L1', mark_type: 'IN', method: 'GEO', lat: est.lat + 0.002248, lng: est.lng, at: G.TODAY + 'T08:01:00' });
    if (m.is_valid) throw new Error('Debía quedar inválida');
    if (Math.abs(m.distance_m - 250) > 2) throw new Error('Distancia ' + m.distance_m);
    const d = P.consolidate(e.id, G.TODAY);
    if (d && d.first_in) throw new Error('La marcación inválida contó como entrada');
  });
  T('CA-PER-04: QR generado hace 3 minutos se rechaza con RN-PER-04', () => {
    const { e } = newEmp('Trabajador QR');
    const now = G.TODAY + 'T09:10:00';
    const old = P.qrToken('es-L1', fromSec(toSec(now) - 180));
    expectRule(() => P.mark({ employee_id: e.id, establishment_id: 'es-L1', mark_type: 'IN', method: 'QR', qr_token: old.token_hash, at: now }), 'RN-PER-04');
    const ok = P.qrToken('es-L1', now);
    const m = P.mark({ employee_id: e.id, establishment_id: 'es-L1', mark_type: 'IN', method: 'QR', qr_token: ok.token_hash, at: now });
    if (!m.is_valid) throw new Error('El QR vigente debía aceptarse');
  });
  T('CA-PER-05: sueldo S/ 1 200 y adelanto de S/ 500 (máximo S/ 360) se rechaza con RN-PER-09', () => {
    const { e } = newEmp('Trabajador adelanto', 1200);
    if (P.advanceMax(e.id) !== 360) throw new Error('Máximo esperado 360 y salió ' + P.advanceMax(e.id));
    expectRule(() => P.requestAdvance({ employee_id: e.id, amount: 500, reason: 'Urgencia' }), 'RN-PER-09');
    P.requestAdvance({ employee_id: e.id, amount: 360, reason: 'Urgencia' });
  });
  T('CA-PER-06: turno de las 08:00 con 10 min de tolerancia y marcación a las 08:17 da 7 min de tardanza', () => {
    if (P.lateMinutes('08:00', '08:17', 10) !== 7) throw new Error('Cálculo puro distinto de 7');
    const { e } = newEmp('Trabajador tardanza');
    const sh = G.db.insert('shifts', { establishment_id: 'es-L1', code: 'T08', name: 'Prueba 08:00', start_time: '08:00', end_time: '17:00', break_minutes: 60, crosses_midnight: false, late_tolerance_minutes: 10, status: 'ACTIVE' }, { silent: true });
    G.db.insert('shift_assignments', { employee_id: e.id, shift_id: sh.id, work_date: '2026-10-09', status: 'PLANNED', overtime_authorized_minutes: 0 }, { silent: true });
    P.mark({ employee_id: e.id, establishment_id: 'es-L1', mark_type: 'IN', method: 'QR', qr_token: P.qrToken('es-L1', '2026-10-09T08:17:00').token_hash, at: '2026-10-09T08:17:00' });
    const d = P.consolidate(e.id, '2026-10-09');
    if (d.late_minutes !== 7 || d.status !== 'LATE') throw new Error(`Tardanza ${d.late_minutes} (${d.status})`);
  });
  T('CA-PER-07: S/ 38 000 de costo de ventas, preparación y reparto con 1 000 pedidos entregados da S/ 38,00 por pedido', () => {
    if (P.costPerOrderValue(38000, 1000) !== 38) throw new Error('Costo por pedido distinto de 38');
    const k = P.costPerOrder('2026-09-01');
    if (!(k.denominator > 0 && k.numerator > 0 && Math.abs(k.value - k.numerator / k.denominator) < 0.01)) throw new Error('KPI-PER-01 inconsistente');
  });
  T('CA-PER-08: el mismo cobro procesado dos veces por payment.confirmed deja una sola comisión por asignación y plan', () => {
    const seller = G.db.find('users', u => u.role === 'VENDEDORA');
    const o = order(seller.id);
    const p = G.pay.register({ customer_id: 'cu-0001', payment_method_id: 'pm-PLIN', amount: 236, reference: 'OP-T3', allocations: [{ order_id: o.id, amount: 236 }], brand_id: 'br-DG', establishment_id: 'es-L1' });
    P.onPaymentConfirmed({ payment_id: p.id }); G.events.emit('payment.confirmed', { payment_id: p.id });
    const n = G.db.where('commission_entries', c => c.payment_id === p.id && c.source_type === 'PAYMENT_ALLOCATION').length;
    if (n !== 1) throw new Error(n + ' comisiones para la misma asignación');
  });
  T('CA-PER-09: pago con bruto S/ 530, descuentos S/ 200 y neto S/ 350 se rechaza con RN-PER-14', () => {
    const { e } = newEmp('Trabajador pago');
    expectRule(() => P.savePayout({ employee_id: e.id, period: '2026-10-01', payout_type: 'MIXED', gross_amount: 530, deductions_amount: 200, net_amount: 350 }), 'RN-PER-14');
    const p = P.savePayout({ employee_id: e.id, period: '2026-10-01', payout_type: 'MIXED', gross_amount: 530, deductions_amount: 200, net_amount: 330 });
    expectRule(() => P.payPayout(p.id, { reference: 'X' }), 'RN-PER-14');
  });
})();
