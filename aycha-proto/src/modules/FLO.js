/* =====================================================================
   FLO · Flota avanzada (fase 3) · docs/fase-3/modulos/FLO-flota-avanzada.md
   GPS continuo desde la app Android (RN-FLO-01/02/03/18/19), jornadas y km
   reales (RN-FLO-04/05), combustible y rendimiento (RN-FLO-06/07/08/17),
   mantenimiento por km y fecha (RN-FLO-09/10/11), documentos y licencias
   (RN-FLO-12/13), multas (RN-FLO-15), costo total (RN-FLO-16), temperatura de
   vehículos refrigerados (RN-FLO-14) y bandeja de alertas (RN-FLO-20).
   Tablas: vehicle_profiles, vehicle_trips, vehicle_positions (solo inserción),
   vehicle_odometer_readings, fuel_loads, vehicle_maintenance_plans,
   vehicle_maintenances, vehicle_documents, traffic_fines, vehicle_costs,
   vehicle_temperature_readings (solo inserción), fleet_alerts.
   Expone G.flo.* (assertVehicleOperable y assertOdometer los usa DEL).
   ===================================================================== */
(function () {
  const { h, btn, badge, card, table, kpis, dl, notice, drawer, modal, toast, tabs, form, pills } = G.ui;
  const page = (el, o) => { const b = G.ui.page(el, o); b.classList.add('flo-body'); return b; };
  const U = G.util, F = G.fmt;
  const R = (n, d = 2) => U.round(n, d);
  const FLO = G.flo = {};

  /* ------------------------------------------------------------------
     Tiempo, parámetros y utilidades
     ------------------------------------------------------------------ */
  const LIVE_AT = G.TODAY + 'T11:40:00';           // reloj de la demo del mapa en vivo
  const tms = s => { s = String(s || ''); if (s.length === 10) s += 'T00:00'; if (s.length === 16) s += ':00'; return Date.parse(s.slice(0, 19) + 'Z'); };
  const tadd = (s, sec) => new Date(tms(s) + sec * 1000).toISOString().slice(0, 19);
  const mins = (a, b) => (tms(b) - tms(a)) / 60000;
  const hm = s => s ? String(s).slice(11, 16) : '—';
  const dow = d => G.date.parse(d).getUTCDay();
  const monthEnd = m => G.date.add(G.date.addMonths(m, 1), -1);
  const workDays = (from, to) => { let n = 0; for (let d = from; d <= to; d = G.date.add(d, 1)) if (dow(d) !== 0) n++; return n; };
  const prm = (k, d) => { const v = G.param(k); return v === undefined || v === null || v === '' ? d : v; };
  const num = (k, d) => Number(prm(k, d));
  const docAlertDays = () => { let v = prm('flo_doc_alert_days', [30, 15, 7]); if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = [30, 15, 7]; } } return (Array.isArray(v) ? v : [30, 15, 7]).map(Number).sort((a, b) => b - a); };
  const run = (fn, ok) => { try { const r = fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 'ok'); G.refresh(); return r; } catch (e) { toast(e.message, 'bad'); return null; } };
  const seeding = () => !!G._seeding;
  const LAT_KM = 111.19, LNG_KM = 108.7;
  const legKm = (a, b) => G.geo.km(a, b);

  /* ---------- índices en memoria (tablas grandes: posiciones y temperaturas) ---------- */
  const _cache = {};
  function index(table, keyFn, sortKey) {
    const arr = G.db.raw(table); const ck = table + '|' + keyFn.name + '|' + (sortKey || '');
    const c = _cache[ck];
    if (c && c.ref === arr && c.n === arr.length && c.ten === G.ctx.tenant) return c.m;
    const m = new Map();
    for (const r of arr) { if (r.tenant && r.tenant !== G.ctx.tenant) continue; const k = keyFn(r); let l = m.get(k); if (!l) m.set(k, l = []); l.push(r); }
    if (sortKey) for (const l of m.values()) l.sort((a, b) => a[sortKey] < b[sortKey] ? -1 : a[sortKey] > b[sortKey] ? 1 : 0);
    _cache[ck] = { ref: arr, n: arr.length, ten: G.ctx.tenant, m };
    return m;
  }
  const byTrip = r => r.trip_id; const byVeh = r => r.vehicle_id; const posKey = r => r.vehicle_id + '|' + r.recorded_at;
  const positionsOf = tripId => index('vehicle_positions', byTrip, 'recorded_at').get(tripId) || [];
  const tempsOfVeh = vid => index('vehicle_temperature_readings', byVeh, 'read_at').get(vid) || [];

  /* ------------------------------------------------------------------
     Catálogos y etiquetas
     ------------------------------------------------------------------ */
  const VTYPE = { MOTO: 'Moto', VAN: 'Furgoneta', CAR: 'Auto', TRUCK: 'Camión' };
  const OWN = { OWN: 'Propio', RENTED: 'Alquilado', THIRD: 'Tercero (empresa de delivery)' };
  const DOCS = [['SOAT', 'SOAT', 'VEHICLE', true], ['TECH_INSPECTION', 'Revisión técnica', 'VEHICLE', true], ['PROPERTY_CARD', 'Tarjeta de propiedad (TIVE)', 'VEHICLE', false], ['RENTAL_CONTRACT', 'Contrato de alquiler', 'VEHICLE', true], ['INSURANCE_POLICY', 'Póliza de seguro vehicular', 'VEHICLE', false], ['DRIVER_LICENSE', 'Licencia de conducir', 'EMPLOYEE', true]];
  const docName = t => (DOCS.find(d => d[0] === t) || [t, t])[1];
  const ALERT_T = [['FUEL_EFFICIENCY', 'Rendimiento'], ['MAINTENANCE', 'Mantenimiento'], ['DOCUMENT', 'Documento'], ['TEMPERATURE', 'Temperatura'], ['GPS_SILENT', 'GPS silencioso'], ['ODOMETER', 'Odómetro y km'], ['SPEED', 'Velocidad']];
  const alertName = t => (ALERT_T.find(a => a[0] === t) || [t, t])[1];
  const COST_T = [['RENT', 'Alquiler'], ['TOLL', 'Peaje'], ['PARKING', 'Cochera y estacionamiento'], ['INSURANCE', 'Seguro'], ['TAX', 'Impuesto vehicular'], ['WASH', 'Lavado y desinfección'], ['TIRES', 'Llantas'], ['OTHER', 'Otro']];
  const costName = t => (COST_T.find(a => a[0] === t) || [t, t])[1];
  const ST = {
    OPEN: ['Abierta', 'info'], CLOSED: ['Cerrada', ''], PLANNED: ['Programada', 'info'], CANCELLED: ['Anulada', 'bad'], ACK: ['En atención', 'warn'],
    ACTIVE: ['Activo', 'ok'], IN_MAINTENANCE: ['En mantenimiento', 'warn'], INACTIVE: ['Inactivo', 'bad'], DONE: ['Hecha', 'ok'], IN_PROGRESS: ['En taller', 'warn'],
    VOIDED: ['Anulado', 'bad'], PENDING: ['Pendiente', 'warn'], PAID: ['Pagada', 'ok'], APPEALED: ['Apelada', 'info'], REPLACED: ['Reemplazado', ''],
    OK: ['Al día', 'ok'], DUE_SOON: ['Próximo', 'warn'], OVERDUE: ['Vencido', 'bad'], OVERDUE_BLOCK: ['Bloquea (RN-FLO-11)', 'bad'],
    EXPIRED: ['Vencido', 'bad'], D7: ['Vence ≤ 7 días', 'bad'], D15: ['Vence ≤ 15 días', 'warn'], D30: ['Vence ≤ 30 días', 'info'], VALID: ['Vigente', 'ok'], NO_EXPIRY: ['Sin vencimiento', ''],
    LOW: ['Bajo el esperado', 'bad'], NA: ['Sin cálculo', ''], RELEASED: ['Liberado', 'ok'], REJECTED: ['Rechazado', 'bad'], PREVENTIVE: ['Preventivo', 'info'], CORRECTIVE: ['Correctivo', 'warn'],
    MOVING: ['En movimiento', 'ok'], STOPPED: ['Detenido', 'info'], SILENT: ['GPS silencioso', 'warn'], BLOCKED: ['Bloqueado', 'bad'], IDLE: ['Sin jornada', ''],
  };
  const sb = s => ST[s] ? badge(ST[s][0], ST[s][1]) : G.ui.status(s);
  FLO.LABELS = ST;

  /* ------------------------------------------------------------------
     Vehículos, fichas y conductores
     ------------------------------------------------------------------ */
  const veh = id => G.db.get('vehicles', id);
  const DEF_KMPG = { MOTO: 70, VAN: 30, CAR: 38, TRUCK: 16 };
  const DEF_TANK = { MOTO: 3, VAN: 18, CAR: 11.5, TRUCK: 40 };
  function prof(vid) {
    const p = (index('vehicle_profiles', byVeh).get(vid) || [])[0];
    if (p) return p;
    const v = veh(vid) || {};
    return { vehicle_id: vid, internal_code: v.plate || '—', make: null, model: null, year: null, tank_capacity_gal: DEF_TANK[v.vehicle_type] || 10, expected_km_per_gal: DEF_KMPG[v.vehicle_type] || 40, temp_min_c: v.refrigerated ? 0 : null, temp_max_c: v.refrigerated ? 4 : null, gps_source: 'APP_ANDROID', op_status: 'ACTIVE', _virtual: true };
  }
  const code = vid => prof(vid).internal_code || (veh(vid) || {}).plate || '—';
  const vLabel = vid => { const v = veh(vid); return v ? `${code(vid)} · ${v.plate}` : '—'; };
  const tracked = v => v && ['OWN', 'RENTED'].includes(v.ownership); // D-FLO-04
  const fleet = () => G.db.where('vehicles', v => v.status !== 'RETIRED' && tracked(v)).sort((a, b) => code(a.id).localeCompare(code(b.id)));
  const scopedFleet = () => fleet().filter(v => G.scope.ok(v));
  const vOk = row => G.scope.ok(veh(row.vehicle_id) || { establishment_id: row.establishment_id });
  const vehOpts = pred => fleet().filter(pred || (() => true)).map(v => [v.id, `${vLabel(v.id)} · ${VTYPE[v.vehicle_type] || v.vehicle_type}${v.ownership === 'RENTED' ? ' alquilado' : ''}`]);
  const user = id => G.db.get('users', id);
  const empOfUser = uid => (user(uid) || {}).employee_id || null;
  const userOfEmp = eid => G.db.find('users', u => u.employee_id === eid);
  const drivers = () => G.db.where('users', u => u.status === 'ACTIVE' && (u.role === 'REPARTIDOR' || FLO.licenseOf(u.employee_id)));
  const driverOpts = () => drivers().map(u => [u.id, u.name]);
  const sitePt = id => { const e = G.db.get('establishments', id) || {}; return [e.lat || -12.1385, e.lng || -76.9905]; };
  function orderPt(o) {
    const a = o.address_id && G.db.get('customer_addresses', o.address_id);
    if (a && a.lat != null) return [a.lat, a.lng];
    const z = o.zone_id && G.db.get('delivery_zones', o.zone_id);
    if (z && z.lat != null) { let x = 0; for (const c of String(o.id)) x = (x * 31 + c.charCodeAt(0)) % 997; return [z.lat + (x % 13 - 6) * 0.0011, z.lng + (x % 7 - 3) * 0.0014]; }
    return null;
  }
  FLO.prof = prof; FLO.code = code; FLO.vLabel = vLabel;

  /* ------------------------------------------------------------------
     Odómetro (RN-FLO-04)
     ------------------------------------------------------------------ */
  const readingsOf = vid => G.db.where('vehicle_odometer_readings', x => x.vehicle_id === vid).sort((a, b) => a.read_at < b.read_at ? -1 : a.read_at > b.read_at ? 1 : 0);
  function lastReading(vid, at) { let best = null; for (const x of G.db.all('vehicle_odometer_readings')) if (x.vehicle_id === vid && (!at || x.read_at <= at) && (!best || x.read_at >= best.read_at)) best = x; return best; }
  function nextReading(vid, at) { let best = null; for (const x of G.db.all('vehicle_odometer_readings')) if (x.vehicle_id === vid && x.read_at > at && x.source !== 'RESET' && (!best || x.read_at < best.read_at)) best = x; return best; }
  FLO.currentOdo = vid => { const l = lastReading(vid); return l ? l.km : ((veh(vid) || {}).odometer_km || 0); };
  FLO.lastReading = lastReading;
  /** RN-FLO-04: el odómetro nunca baja respecto de la última lectura (jornada, carga o mantenimiento) */
  FLO.assertOdometer = function (vid, km, at) {
    const v = veh(vid); const k = Number(km);
    if (!(k >= 0)) G.fail('RN-FLO-04', 'Indica la lectura del odómetro en km.');
    const t = at || (seeding() ? LIVE_AT : FLO.clock());
    const last = lastReading(vid, t);
    if (last && k < last.km) G.fail('RN-FLO-04', `El odómetro de ${v ? v.plate : vid} no puede bajar: la última lectura es ${F.num(last.km)} km (${srcName(last.source)} del ${F.datetime(last.read_at)}) y registras ${F.num(k)} km. Si se cambió el tablero, regístralo en FLO-04 con motivo.`);
    const nx = nextReading(vid, t);
    if (nx && k > nx.km) G.fail('RN-FLO-04', `Hay una lectura posterior de ${F.num(nx.km)} km (${F.datetime(nx.read_at)}): una lectura anterior no puede marcar más.`);
    return true;
  };
  const SRC = { INITIAL: 'Lectura inicial', TRIP_START: 'Inicio de jornada', TRIP_END: 'Cierre de jornada', FUEL: 'Carga de combustible', MAINTENANCE: 'Mantenimiento', RESET: 'Cambio de tablero', MANUAL: 'Lectura manual' };
  const srcName = s => SRC[s] || s;
  function addReading(vid, km, at, source, source_id, extra = {}) {
    const row = G.db.insert('vehicle_odometer_readings', Object.assign({ vehicle_id: vid, read_at: at, km: Math.round(Number(km)), source, source_id: source_id || null, recorded_by: seeding() ? null : G.ctx.userId() }, extra), { silent: true });
    const v = veh(vid); const last = lastReading(vid);
    if (v && last && last.id === row.id) G.db.update('vehicles', vid, { odometer_km: row.km }, { silent: true });
    return row;
  }
  /** cambio de tablero (flo.odometer.reset): la nueva lectura reemplaza la base */
  FLO.resetOdometer = function (vid, { km, reason, at } = {}) {
    if (!G.can('flo.odometer.reset')) G.fail('RN-FLO-04', 'Registrar un cambio de tablero exige el permiso flo.odometer.reset (gerencia).');
    if (!String(reason || '').trim()) G.fail('RN-FLO-04', 'El cambio de tablero exige motivo.');
    const k = Number(km); if (!(k >= 0)) G.fail('RN-FLO-04', 'Indica la lectura del tablero nuevo.');
    const prev = FLO.currentOdo(vid);
    return addReading(vid, k, at || FLO.clock(), 'RESET', null, { reason: reason.trim(), previous_km: prev });
  };

  /* ------------------------------------------------------------------
     Documentos y licencias (RN-FLO-12/13)
     ------------------------------------------------------------------ */
  const docsOf = (pred) => G.db.where('vehicle_documents', d => d.status === 'ACTIVE' && pred(d));
  FLO.vehicleDoc = (vid, type) => docsOf(d => d.vehicle_id === vid && d.doc_type === type).sort(U.by('expires_on', -1))[0] || null;
  FLO.licenseOf = eid => eid ? (docsOf(d => d.employee_id === eid && d.doc_type === 'DRIVER_LICENSE').sort(U.by('expires_on', -1))[0] || null) : null;
  FLO.docState = function (d, date = G.TODAY) {
    if (!d || !d.expires_on) return 'NO_EXPIRY';
    const days = G.date.diff(d.expires_on, date);
    const [a, b, c] = docAlertDays();
    return days < 0 ? 'EXPIRED' : days <= (c ?? 7) ? 'D7' : days <= (b ?? 15) ? 'D15' : days <= (a ?? 30) ? 'D30' : 'VALID';
  };
  FLO.saveDocument = function (d, o = {}) {
    if (!o.seed && !G.can('flo.document.manage')) G.fail('RN-FLO-13', 'Registrar documentos exige el permiso flo.document.manage (coordinador de delivery o RR. HH.).');
    const def = DOCS.find(x => x[0] === d.doc_type); if (!def) G.fail('RN-FLO-13', 'Elige el tipo de documento.');
    if (def[2] === 'EMPLOYEE' && !d.employee_id) G.fail('RN-FLO-13', 'La licencia de conducir pertenece a un trabajador: elige al conductor.');
    if (def[2] === 'VEHICLE' && !d.vehicle_id) G.fail('RN-FLO-13', `${def[1]} pertenece a un vehículo: elige el vehículo.`);
    if (def[3] && !d.expires_on) G.fail('RN-FLO-13', `${def[1]} exige fecha de vencimiento.`);
    if (d.issued_on && d.expires_on && d.expires_on <= d.issued_on) G.fail('RN-FLO-13', 'El vencimiento debe ser posterior a la emisión.');
    if (!String(d.number || '').trim()) G.fail('RN-FLO-13', 'Indica el número del documento.');
    const owner = def[2] === 'EMPLOYEE' ? { employee_id: d.employee_id, vehicle_id: null } : { vehicle_id: d.vehicle_id, employee_id: null };
    const prev = docsOf(x => x.doc_type === d.doc_type && (owner.vehicle_id ? x.vehicle_id === owner.vehicle_id : x.employee_id === owner.employee_id));
    const row = G.db.insert('vehicle_documents', Object.assign(owner, { doc_type: d.doc_type, number: String(d.number).trim(), issuer: d.issuer || null, license_class: d.license_class || null, issued_on: d.issued_on || null, expires_on: d.expires_on || null, file_url: d.file_url || null, status: 'ACTIVE', replaces_id: prev[0] ? prev[0].id : null, notes: d.notes || null }), { silent: !!o.seed });
    for (const p of prev) G.db.update('vehicle_documents', p.id, { status: 'REPLACED', replaced_by_id: row.id }, { silent: true });
    syncVehicleDocs(owner.vehicle_id);
    if (!o.seed) { FLO.closeAlertsFor('DOCUMENT', prev.map(p => 'doc:' + p.id), `Renovado con ${row.number} (vence ${F.date(row.expires_on)})`); FLO.scan(); }
    return row;
  };
  /** FLO mantiene sincronizados vehicles.soat_expires_on y tech_inspection_expires_on (los lee DEL) */
  function syncVehicleDocs(vid) {
    if (!vid || !veh(vid)) return;
    const s = FLO.vehicleDoc(vid, 'SOAT'), t = FLO.vehicleDoc(vid, 'TECH_INSPECTION');
    const patch = {}; if (s) { patch.soat_expires_on = s.expires_on; patch.soat_policy_no = s.number; } if (t) patch.tech_inspection_expires_on = t.expires_on;
    if (Object.keys(patch).length) G.db.update('vehicles', vid, patch, { silent: true });
  }
  /** RN-FLO-12: un conductor con licencia vencida no inicia jornada */
  FLO.assertDriverLicense = function (uid, date = G.TODAY) {
    const u = user(uid); if (!u) G.fail('RN-FLO-12', 'Elige al conductor.');
    const l = FLO.licenseOf(u.employee_id);
    if (!l) G.fail('RN-FLO-12', `${u.name} no tiene licencia de conducir registrada en FLO-09: no inicia jornada.`);
    if (l.expires_on < date) G.fail('RN-FLO-12', `La licencia ${l.number} de ${u.name} venció el ${F.date(l.expires_on)}: no inicia jornada hasta renovarla (FLO-09).`);
    return l;
  };
  FLO.assert_driver_license_valid = FLO.assertDriverLicense;

  /* ------------------------------------------------------------------
     Mantenimiento (RN-FLO-09/10)
     ------------------------------------------------------------------ */
  const plansOf = vid => G.db.where('vehicle_maintenance_plans', p => p.vehicle_id === vid && p.status === 'ACTIVE');
  FLO.planState = function (p, date = G.TODAY) {
    const cur = FLO.currentOdo(p.vehicle_id);
    const kmLeft = p.next_due_km != null ? p.next_due_km - cur : null;
    const daysLeft = p.next_due_on ? G.date.diff(p.next_due_on, date) : null;
    const blk = num('flo_maint_overdue_block_km', 1000), ak = num('flo_maint_alert_km', 500), ad = num('flo_maint_alert_days', 7);
    let st = 'OK';
    if ((kmLeft != null && kmLeft <= ak) || (daysLeft != null && daysLeft <= ad)) st = 'DUE_SOON';
    if ((kmLeft != null && kmLeft < 0) || (daysLeft != null && daysLeft < 0)) st = 'OVERDUE';
    if (kmLeft != null && kmLeft < -blk) st = 'OVERDUE_BLOCK';
    return { st, kmLeft, daysLeft, cur, alertKm: p.next_due_km != null ? p.next_due_km - ak : null, alertOn: p.next_due_on ? G.date.add(p.next_due_on, -ad) : null };
  };
  FLO.savePlan = function (d, existing) {
    if (!seeding() && !G.can('flo.maintenance.manage')) G.fail('RN-FLO-09', 'Los planes de mantenimiento exigen el permiso flo.maintenance.manage.');
    if (!d.vehicle_id) G.fail('RN-FLO-09', 'Elige el vehículo.');
    if (!String(d.task || '').trim()) G.fail('RN-FLO-09', 'Indica la tarea (cambio de aceite, llantas, frenos…).');
    const ik = d.interval_km ? Number(d.interval_km) : null, id_ = d.interval_days ? Number(d.interval_days) : null;
    if (!(ik > 0) && !(id_ > 0)) G.fail('RN-FLO-09', 'El plan necesita intervalo por km, por días o ambos.');
    const lk = d.last_done_km === '' || d.last_done_km == null ? null : Number(d.last_done_km);
    const row = { vehicle_id: d.vehicle_id, task: d.task.trim(), interval_km: ik, interval_days: id_, last_done_km: lk, last_done_on: d.last_done_on || null, next_due_km: ik && lk != null ? lk + ik : (d.next_due_km ? Number(d.next_due_km) : null), next_due_on: id_ && d.last_done_on ? G.date.add(d.last_done_on, id_) : (d.next_due_on || null), status: d.status || 'ACTIVE', notes: d.notes || null };
    if (ik && row.next_due_km == null) row.next_due_km = FLO.currentOdo(d.vehicle_id) + ik;
    if (id_ && !row.next_due_on) row.next_due_on = G.date.add(G.TODAY, id_);
    return existing ? G.db.update('vehicle_maintenance_plans', existing.id, row) : G.db.insert('vehicle_maintenance_plans', Object.assign({ code: G.db.next('PMV', 'PM-', 3) }, row), { silent: seeding() });
  };
  const maintsOf = vid => G.db.where('vehicle_maintenances', m => m.vehicle_id === vid);
  const openMaints = vid => maintsOf(vid).filter(m => ['OPEN', 'IN_PROGRESS'].includes(m.status));
  FLO.openMaintenance = function (d, o = {}) {
    if (!o.seed) { G.assertMod('FLO'); if (!G.can('flo.maintenance.manage')) G.fail('RN-FLO-09', 'Las órdenes de mantenimiento exigen el permiso flo.maintenance.manage.'); }
    const v = veh(d.vehicle_id); if (!v) G.fail('RN-FLO-09', 'Elige el vehículo.');
    if (!String(d.description || '').trim()) G.fail('RN-FLO-09', 'Describe el trabajo o la falla.');
    const plan = d.plan_id ? G.db.get('vehicle_maintenance_plans', d.plan_id) : null;
    if (d.kind === 'PREVENTIVE' && !plan) G.fail('RN-FLO-10', 'Un mantenimiento preventivo sale de un plan (FLO-07).');
    const m = G.db.insert('vehicle_maintenances', { number: d.number || G.db.next('MV', 'MV-', 4), vehicle_id: v.id, plan_id: plan ? plan.id : null, kind: d.kind || 'CORRECTIVE', description: d.description.trim(), workshop_supplier_id: d.workshop_supplier_id || null, workshop_name: d.workshop_name || (d.workshop_supplier_id ? G.supName(d.workshop_supplier_id) : null), opened_on: d.opened_on || G.TODAY, in_workshop: d.in_workshop !== false, due_km: plan ? plan.next_due_km : null, due_on: plan ? plan.next_due_on : null, odometer_km: null, done_on: null, days_out_of_service: null, parts: [], parts_amount: 0, labor_amount: 0, total_amount: 0, doc_type: null, doc_number: null, expense_id: null, on_time: null, status: d.status || 'IN_PROGRESS', opened_by: o.seed ? null : G.ctx.userId() }, { silent: !!o.seed });
    if (m.in_workshop) setOpStatus(v.id, 'IN_MAINTENANCE');
    return m;
  };
  function setOpStatus(vid, st) { const p = prof(vid); if (!p._virtual) G.db.update('vehicle_profiles', p.id, { op_status: st }, { silent: true }); }
  /** RN-FLO-10: al cerrar un preventivo el plan se mueve; RN-FLO-17: el comprobante se registra una sola vez como gasto */
  FLO.closeMaintenance = function (id, d = {}, o = {}) {
    const m = G.db.get('vehicle_maintenances', id); if (!m) G.fail('RN-FLO-10', 'Orden no encontrada.');
    if (!o.seed && !G.can('flo.maintenance.manage')) G.fail('RN-FLO-10', 'Cerrar órdenes exige el permiso flo.maintenance.manage.');
    if (!['OPEN', 'IN_PROGRESS'].includes(m.status)) G.fail('RN-FLO-10', `La orden ${m.number} ya está ${(ST[m.status] || [m.status])[0].toLowerCase()}.`);
    const done_on = d.done_on || G.TODAY; const at = done_on + 'T17:30:00';
    const odo = Number(d.odometer_km); if (!(odo > 0)) G.fail('RN-FLO-04', 'Indica el odómetro del servicio.');
    if (!o.seed) { G.period.assertOpen(done_on); }
    FLO.assertOdometer(m.vehicle_id, odo, at);
    const parts = (d.parts || m.parts || []).map(p => ({ description: p.description, qty: Number(p.qty), unit_cost: Number(p.unit_cost) }));
    const pa = R(U.sum(parts, p => p.qty * p.unit_cost)), la = R(Number(d.labor_amount || 0));
    if (pa < 0 || la < 0) G.fail('RN-FLO-16', 'Los importes no pueden ser negativos.');
    const total = R(pa + la);
    const out = d.days_out_of_service != null && d.days_out_of_service !== '' ? Number(d.days_out_of_service) : Math.max(0, G.date.diff(done_on, m.opened_on));
    const onTime = m.kind === 'PREVENTIVE' ? ((m.due_on ? done_on <= m.due_on : true) && (m.due_km != null ? odo <= m.due_km : true)) : null;
    G.db.update('vehicle_maintenances', id, { status: 'DONE', done_on, odometer_km: Math.round(odo), parts, parts_amount: pa, labor_amount: la, total_amount: total, days_out_of_service: out, doc_type: d.doc_type || null, doc_number: d.doc_number || null, workshop_supplier_id: d.workshop_supplier_id || m.workshop_supplier_id, workshop_name: d.workshop_supplier_id ? G.supName(d.workshop_supplier_id) : m.workshop_name, on_time: onTime, closed_by: o.seed ? null : G.ctx.userId() }, { silent: !!o.seed });
    addReading(m.vehicle_id, odo, at, 'MAINTENANCE', id);
    if (m.plan_id) {
      const p = G.db.get('vehicle_maintenance_plans', m.plan_id);
      if (p) G.db.update('vehicle_maintenance_plans', p.id, { last_done_km: Math.round(odo), last_done_on: done_on, next_due_km: p.interval_km ? Math.round(odo) + p.interval_km : null, next_due_on: p.interval_days ? G.date.add(done_on, p.interval_days) : null }, { silent: !!o.seed });
      if (!o.seed) FLO.closeAlertsFor('MAINTENANCE', ['plan:' + m.plan_id], `Hecho en ${m.number}`);
    }
    if (d.expense_id) FLO.linkExpense('vehicle_maintenances', id, d.expense_id);
    else if (d.create_expense) { const e = makeExpense({ kind: 'MAINT', vehicle_id: m.vehicle_id, amount: total, date: done_on, supplier_id: d.workshop_supplier_id || m.workshop_supplier_id, doc_type: d.doc_type, doc_number: d.doc_number, description: `${m.number} · ${m.description} · ${(veh(m.vehicle_id) || {}).plate}`, odometer: odo }); G.db.update('vehicle_maintenances', id, { expense_id: e.id }, { silent: true }); }
    if (!openMaints(m.vehicle_id).some(x => x.in_workshop)) setOpStatus(m.vehicle_id, 'ACTIVE');
    return G.db.get('vehicle_maintenances', id);
  };

  /* ------------------------------------------------------------------
     Vehículo operable (RN-FLO-11) · la usa DEL al asignar rutas
     ------------------------------------------------------------------ */
  FLO.whyNotOperable = function (vid, date = G.TODAY) {
    const v = veh(vid); const out = [];
    if (!v) return [{ rule: 'RN-FLO-11', msg: 'Vehículo no encontrado.' }];
    const p = prof(vid);
    if (v.status !== 'ACTIVE' || p.op_status === 'INACTIVE') out.push({ rule: 'RN-FLO-11', kind: 'INACTIVE', msg: `${v.plate} está inactivo.` });
    if (p.op_status === 'IN_MAINTENANCE') { const m = openMaints(vid)[0]; out.push({ rule: 'RN-FLO-11', kind: 'MAINT', msg: `${v.plate} está en mantenimiento${m ? ` (${m.number}: ${m.description})` : ''}.` }); }
    const soat = FLO.vehicleDoc(vid, 'SOAT'); const soatExp = soat ? soat.expires_on : v.soat_expires_on;
    if (!soatExp) out.push({ rule: 'RN-FLO-11', kind: 'SOAT', msg: `${v.plate} no tiene SOAT registrado.` });
    else if (soatExp < date) out.push({ rule: 'RN-FLO-11', kind: 'SOAT', msg: `El SOAT de ${v.plate} venció el ${F.date(soatExp)}.` });
    const rt = FLO.vehicleDoc(vid, 'TECH_INSPECTION'); const rtExp = rt ? rt.expires_on : v.tech_inspection_expires_on;
    if (rtExp && rtExp < date) out.push({ rule: 'RN-FLO-11', kind: 'RT', msg: `La revisión técnica de ${v.plate} venció el ${F.date(rtExp)}.` });
    for (const pl of plansOf(vid)) { const s = FLO.planState(pl, date); if (s.st === 'OVERDUE_BLOCK') out.push({ rule: 'RN-FLO-11', kind: 'PLAN', msg: `«${pl.task}» de ${v.plate} está vencido por ${F.num(-s.kmLeft)} km (más de ${F.num(num('flo_maint_overdue_block_km', 1000))} km).` }); }
    return out;
  };
  FLO.assertVehicleOperable = function (vid, date = G.TODAY) {
    const w = FLO.whyNotOperable(vid, date);
    if (w.length) G.fail('RN-FLO-11', `${w.map(x => x.msg).join(' ')} No se asigna a una ruta ni abre jornada el ${F.date(date)}.`);
    return true;
  };
  FLO.assert_vehicle_operable = FLO.assertVehicleOperable;
  /** asignación a una ruta de DEL (o jornada programada si DEL no está) */
  FLO.assignToRoute = function ({ vehicle_id, date = G.TODAY, driver_user_id, route_id } = {}) {
    if (!seeding()) G.assertMod('FLO');
    const v = veh(vehicle_id); if (!v) G.fail('RN-FLO-11', 'Elige el vehículo.');
    if (!tracked(v)) G.fail('RN-FLO-11', 'D-FLO-04: los vehículos de empresas de delivery no se rastrean en FLO.');
    FLO.assertVehicleOperable(v.id, date);
    if (route_id && G.del && typeof G.del.assign === 'function' && G.db.get('delivery_routes', route_id)) return G.del.assign(route_id, { vehicle_id: v.id, driver_user_id, mode: v.ownership });
    if (driver_user_id) FLO.assertDriverLicense(driver_user_id, date);
    const dup = G.db.find('vehicle_trips', t => t.vehicle_id === v.id && t.trip_date === date && ['PLANNED', 'OPEN'].includes(t.status));
    if (dup) return dup;
    return G.db.insert('vehicle_trips', { number: G.db.next('JR', 'JR-', 6), vehicle_id: v.id, driver_user_id: driver_user_id || null, driver_employee_id: driver_user_id ? empOfUser(driver_user_id) : null, establishment_id: v.establishment_id, trip_date: date, status: 'PLANNED', route_ref: route_id || null, started_at: null, ended_at: null });
  };

  /* ------------------------------------------------------------------
     Jornadas (RN-FLO-02/04/05/11/12)
     ------------------------------------------------------------------ */
  FLO.openTrip = vid => G.db.find('vehicle_trips', t => t.vehicle_id === vid && t.status === 'OPEN');
  FLO.openTripOfDriver = uid => G.db.find('vehicle_trips', t => t.driver_user_id === uid && t.status === 'OPEN');
  const CHECK = [['lights', 'Luces delanteras, de freno y direccionales'], ['tires', 'Llantas (presión y desgaste)'], ['brakes', 'Frenos'], ['thermal_box', 'Caja térmica limpia y cerrada'], ['documents', 'SOAT y tarjeta de propiedad a bordo']];
  FLO.CHECKLIST = CHECK;
  const checkItems = v => CHECK.filter(c => c[0] !== 'thermal_box' || v.vehicle_type === 'MOTO' || v.refrigerated);
  FLO.startTrip = function (d, o = {}) {
    if (!o.seed) G.assertMod('FLO');
    const v = veh(d.vehicle_id); if (!v) G.fail('RN-FLO-02', 'Elige el vehículo.');
    if (!tracked(v)) G.fail('RN-FLO-02', 'D-FLO-04: los repartidores de empresas de delivery no usan la app; solo se rastrean vehículos propios y alquilados.');
    const at = d.at || (o.seed ? null : FLO.clock()); const date = at.slice(0, 10);
    const ot = FLO.openTrip(v.id); if (ot) G.fail('RN-FLO-02', `${v.plate} ya tiene la jornada ${ot.number} abierta desde ${F.datetime(ot.started_at)}: un vehículo tiene una sola jornada abierta a la vez.`);
    const uid = d.driver_user_id; const od = FLO.openTripOfDriver(uid); if (od) G.fail('RN-FLO-02', `${G.userName(uid)} ya tiene abierta la jornada ${od.number} con ${(veh(od.vehicle_id) || {}).plate}.`);
    FLO.assertDriverLicense(uid, date);
    FLO.assertVehicleOperable(v.id, date);
    if (!o.seed && !d.photo) G.fail('RN-FLO-04', 'Toma la foto del tablero con el odómetro para iniciar la jornada.');
    const items = checkItems(v); const ch = d.checklist || {};
    const miss = items.filter(c => ch[c[0]] === undefined || ch[c[0]] === null || ch[c[0]] === '');
    if (!o.seed && miss.length) G.fail('RN-FLO-02', `Completa el checklist: ${miss.map(c => c[1].toLowerCase()).join(', ')}.`);
    const bad = items.filter(c => ch[c[0]] === false || ch[c[0]] === 'NO');
    if (!o.seed && bad.length && !String(d.notes || '').trim()) G.fail('RN-FLO-02', `Marcaste con observación: ${bad.map(c => c[1].toLowerCase()).join(', ')}. Describe la observación para el coordinador.`);
    FLO.assertOdometer(v.id, d.odometer, at);
    const route = G.db.find('delivery_routes', r => r.vehicle_id === v.id && r.route_date === date && r.status !== 'CANCELLED');
    const planned = G.db.find('vehicle_trips', t => t.vehicle_id === v.id && t.trip_date === date && t.status === 'PLANNED');
    const row = { number: planned ? planned.number : (d.number || G.db.next('JR', 'JR-', 6)), vehicle_id: v.id, driver_user_id: uid, driver_employee_id: empOfUser(uid), establishment_id: v.establishment_id, trip_date: date, started_at: at, ended_at: null, odometer_start: Math.round(Number(d.odometer)), odometer_end: null, km_odometer: null, km_gps: null, km_diff_pct: null, deliveries: null, start_photo: d.photo || null, end_photo: null, checklist_start: ch, checklist_end: null, notes: d.notes || null, status: 'OPEN', route_ref: route ? route.code : (planned ? planned.route_ref : null), source: d.source || 'APP' };
    const t = planned ? G.db.update('vehicle_trips', planned.id, row, { silent: !!o.seed }) : G.db.insert('vehicle_trips', row, { silent: !!o.seed });
    addReading(v.id, row.odometer_start, at, 'TRIP_START', t.id);
    if (!o.seed && bad.length) G.notify({ role: 'COORDINADOR_DELIVERY', title: `Checklist con observación · ${v.plate}`, body: `${G.userName(uid)}: ${bad.map(c => c[1]).join(', ')} · ${d.notes}`, tone: 'warn', module: 'FLO', ref: { screen: 'FLO-03', id: t.id } });
    return t;
  };
  FLO.gpsKm = function (pts) { let k = 0; for (let i = 1; i < pts.length; i++) k += legKm([pts[i - 1].lat, pts[i - 1].lng], [pts[i].lat, pts[i].lng]); return R(k, 1); };
  const delivOf = (uid, date) => G.db.where('sales_orders', o => o.driver_user_id === uid && o.delivery_date === date && o.fulfillment === 'DELIVERY');
  FLO.deliveriesOf = t => delivOf(t.driver_user_id, t.trip_date).filter(o => ['DELIVERED', 'CLOSED'].includes(o.status)).length;
  FLO.endTrip = function (id, d = {}, o = {}) {
    const t = G.db.get('vehicle_trips', id); if (!t) G.fail('RN-FLO-02', 'Jornada no encontrada.');
    if (t.status !== 'OPEN') G.fail('RN-FLO-02', `La jornada ${t.number} no está abierta.`);
    const at = d.at || FLO.clock();
    if (!o.seed && !d.photo) G.fail('RN-FLO-04', 'Toma la foto del tablero para cerrar la jornada.');
    const km = Math.round(Number(d.odometer));
    if (!(km >= t.odometer_start)) G.fail('RN-FLO-04', `El odómetro final (${F.num(km)} km) no puede ser menor que el inicial (${F.num(t.odometer_start)} km).`);
    FLO.assertOdometer(t.vehicle_id, km, at);
    const kmO = km - t.odometer_start, kmG = FLO.gpsKm(positionsOf(t.id));
    const diff = kmG > 0 ? R((kmO - kmG) / kmG * 100, 1) : null;
    G.db.update('vehicle_trips', id, { status: 'CLOSED', ended_at: at, odometer_end: km, km_odometer: kmO, km_gps: kmG, km_diff_pct: diff, deliveries: FLO.deliveriesOf(t), end_photo: d.photo || null, checklist_end: d.checklist || null, end_notes: d.notes || null }, { silent: !!o.seed });
    addReading(t.vehicle_id, km, at, 'TRIP_END', id);
    checkKmDiff(G.db.get('vehicle_trips', id), at);
    if (!o.seed) FLO.closeAlertsFor('GPS_SILENT', ['trip:' + id], 'Jornada cerrada');
    return G.db.get('vehicle_trips', id);
  };
  /** RN-FLO-05: km por odómetro frente a km por GPS */
  function checkKmDiff(t, at) {
    const tol = num('flo_km_gps_tolerance_pct', 15);
    if (t.km_diff_pct == null || Math.abs(t.km_diff_pct) <= tol) return null;
    return FLO.raise({ type: 'ODOMETER', vehicle_id: t.vehicle_id, origin: 'trip:' + t.id, employee_id: t.driver_employee_id, at, severity: 'warn', title: `Km de odómetro y GPS difieren ${F.pct(Math.abs(t.km_diff_pct))} (${t.number})`, detail: `RN-FLO-05: odómetro ${F.num(t.km_odometer)} km, GPS ${F.num(t.km_gps, 1)} km en la jornada del ${F.date(t.trip_date)}; la tolerancia es ${tol} %.` });
  }

  /* ------------------------------------------------------------------
     Posiciones GPS (RN-FLO-01/02/03/18/19)
     ------------------------------------------------------------------ */
  let _clockC = null;
  FLO.clock = function () {
    const arr = G.db.raw('vehicle_positions');
    if (!_clockC || _clockC.ref !== arr || _clockC.n !== arr.length) { let mx = LIVE_AT; for (const p of arr) if (p.recorded_at > mx && p.recorded_at.startsWith(G.TODAY)) mx = p.recorded_at; _clockC = { ref: arr, n: arr.length, v: mx }; }
    return _clockC.v;
  };
  FLO.recordPosition = function (d, o = {}) {
    const v = veh(d.vehicle_id); if (!v) G.fail('RN-FLO-02', 'Vehículo no encontrado.');
    const at = String(d.recorded_at || '').slice(0, 19); if (at.length < 16) G.fail('RN-FLO-01', 'Cada posición lleva su hora.');
    const ex = (index('vehicle_positions', posKey).get(v.id + '|' + at) || [])[0];
    if (ex) return { row: ex, duplicate: true };
    const t = G.db.find('vehicle_trips', x => x.vehicle_id === v.id && x.started_at && x.started_at <= at && (x.status === 'OPEN' || (x.ended_at && x.ended_at >= at)));
    if (!t) G.fail('RN-FLO-02', `${v.plate} no tiene una jornada abierta a las ${hm(at)} del ${F.date(at)}: fuera de la jornada no se rastrea.`);
    if (d.lat == null || d.lng == null) G.fail('RN-FLO-01', 'La posición necesita latitud y longitud.');
    const row = G.db.insert('vehicle_positions', { vehicle_id: v.id, trip_id: t.id, recorded_at: at, lat: Number(d.lat), lng: Number(d.lng), speed_kmh: R(Number(d.speed_kmh || 0), 1), heading: d.heading ?? null, accuracy_m: d.accuracy_m ?? 8, source: d.source || 'APP', received_at: d.received_at || at }, { silent: true });
    if (!o.seed) { checkSpeed(t, row); if (row.recorded_at >= FLO.clock()) FLO.closeAlertsFor('GPS_SILENT', ['trip:' + t.id], 'Volvió a enviar posición'); }
    return { row, duplicate: false };
  };
  /** subida en lote desde la app sin conexión: un reenvío no duplica (RN-FLO-01) */
  FLO.recordBatch = function (list) {
    const out = { inserted: 0, duplicates: 0, rejected: [] };
    for (const p of list.slice().sort((a, b) => a.recorded_at < b.recorded_at ? -1 : 1)) { try { const r = FLO.recordPosition(Object.assign({ source: 'BATCH' }, p)); if (r.duplicate) out.duplicates++; else out.inserted++; } catch (e) { out.rejected.push(e.message); } }
    return out;
  };
  /** RN-FLO-19: más de flo_speed_limit_kmh por más de 1 minuto */
  function checkSpeed(t, row) {
    const lim = num('flo_speed_limit_kmh', 80);
    if (!(row.speed_kmh > lim)) return null;
    const ps = positionsOf(t.id); let i = ps.findIndex(p => p.id === row.id); if (i < 0) return null;
    let j = i; while (j > 0 && ps[j - 1].speed_kmh > lim) j--;
    const dur = mins(ps[j].recorded_at, row.recorded_at);
    if (dur < 1) return null;
    const mx = Math.max(...ps.slice(j, i + 1).map(p => p.speed_kmh));
    const prev = G.db.find('fleet_alerts', a => a.vehicle_id === t.vehicle_id && a.alert_type === 'SPEED' && a.origin === 'trip:' + t.id && a.status !== 'CLOSED');
    if (prev && prev.episode_start === ps[j].recorded_at) { G.db.update('fleet_alerts', prev.id, { last_at: row.recorded_at, max_value: Math.max(prev.max_value || 0, mx), detail: speedDetail(t, ps[j].recorded_at, row.recorded_at, mx, lim) }, { silent: true }); return prev; }
    const r = FLO.raise({ type: 'SPEED', vehicle_id: t.vehicle_id, origin: 'trip:' + t.id, employee_id: t.driver_employee_id, at: row.recorded_at, severity: 'bad', title: `Exceso de velocidad: ${F.num(mx)} km/h (${t.number})`, detail: speedDetail(t, ps[j].recorded_at, row.recorded_at, mx, lim), extra: { episode_start: ps[j].recorded_at, max_value: mx } });
    if (!r.created) G.db.update('fleet_alerts', r.alert.id, { episode_start: ps[j].recorded_at, max_value: Math.max(r.alert.max_value || 0, mx) }, { silent: true });
    return r.alert;
  }
  const speedDetail = (t, a, b, mx, lim) => `RN-FLO-19: más de ${lim} km/h entre ${hm(a)} y ${hm(b)} (${F.num(mins(a, b), 1)} min, máx. ${F.num(mx)} km/h) · ${G.userName(t.driver_user_id)}.`;
  FLO.lastPos = t => { const ps = positionsOf(t.id); return ps[ps.length - 1] || null; };
  FLO.silentMinutes = t => { const lp = FLO.lastPos(t); return R(mins(lp ? lp.recorded_at : t.started_at, FLO.clock()), 0); };

  /* ------------------------------------------------------------------
     Temperatura (RN-FLO-03/14)
     ------------------------------------------------------------------ */
  const tempRange = vid => { const p = prof(vid); const v = veh(vid) || {}; if (!v.refrigerated && p.temp_min_c == null && p.temp_max_c == null) return null; return p.temp_mode === 'FROZEN' ? { min: null, max: p.temp_max_c ?? -18 } : { min: p.temp_min_c ?? 0, max: p.temp_max_c ?? 4 }; };
  FLO.tempRange = tempRange;
  const inRange = (rg, c) => !rg || ((rg.min == null || c >= rg.min) && (rg.max == null || c <= rg.max));
  FLO.recordTemp = function (d, o = {}) {
    const v = veh(d.vehicle_id); if (!v) G.fail('RN-FLO-14', 'Elige el vehículo.');
    const rg = tempRange(v.id); if (!rg) G.fail('RN-FLO-14', `${v.plate} no es refrigerado (D-FLO-01): configura su rango de temperatura en la ficha (FLO-04).`);
    const at = String(d.read_at || '').slice(0, 19); const c = Number(d.temp_c);
    if (!isFinite(c)) G.fail('RN-FLO-14', 'Indica la temperatura en °C.');
    const t = G.db.find('vehicle_trips', x => x.vehicle_id === v.id && x.started_at && x.started_at <= at && (x.status === 'OPEN' || (x.ended_at && x.ended_at >= at)));
    const row = G.db.insert('vehicle_temperature_readings', { vehicle_id: v.id, trip_id: t ? t.id : null, read_at: at, temp_c: R(c, 1), in_range: inRange(rg, c), range_min: rg.min, range_max: rg.max, sensor_id: prof(v.id).temp_sensor_id || null, source: d.source || 'SENSOR' }, { silent: true });
    if (!o.seed) checkExcursion(v.id, t, row);
    return row;
  };
  /** excursiones: lecturas seguidas fuera de rango; duración hasta la siguiente lectura en rango (o la última) */
  FLO.excursions = function (vid, from, to) {
    const rs = tempsOfVeh(vid).filter(x => (!from || x.read_at >= from) && (!to || x.read_at <= to + 'T23:59:59'));
    const out = []; let cur = null;
    for (const x of rs) {
      if (!x.in_range) { if (!cur || cur.trip_id !== x.trip_id) { if (cur) out.push(cur); cur = { vehicle_id: vid, trip_id: x.trip_id, start: x.read_at, end: x.read_at, max: x.temp_c, min: x.temp_c, n: 1, open: true }; } else { cur.end = x.read_at; cur.n++; cur.max = Math.max(cur.max, x.temp_c); cur.min = Math.min(cur.min, x.temp_c); } }
      else if (cur) { if (cur.trip_id === x.trip_id) { cur.end = x.read_at; cur.open = false; } out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
    for (const e of out) e.minutes = R(mins(e.start, e.end), 0);
    return out;
  };
  function checkExcursion(vid, t, row) {
    if (row.in_range || !t) return null;
    const lim = num('flo_temp_excursion_minutes', 15);
    const ex = FLO.excursions(vid, t.started_at.slice(0, 10), t.trip_date).filter(e => e.trip_id === t.id).pop();
    if (!ex || !(ex.minutes > lim)) return null;
    const rg = tempRange(vid);
    const affected = delivOf(t.driver_user_id, t.trip_date).filter(o => !['CANCELLED'].includes(o.status) && (!o.delivered_at || o.delivered_at >= ex.start.slice(0, 16)));
    const prev = G.db.find('fleet_alerts', a => a.vehicle_id === vid && a.alert_type === 'TEMPERATURE' && a.origin === 'trip:' + t.id && a.status !== 'CLOSED');
    const r = FLO.raise({ type: 'TEMPERATURE', vehicle_id: vid, origin: 'trip:' + t.id, employee_id: t.driver_employee_id, at: row.read_at, severity: 'bad', title: `Temperatura fuera de rango ${F.num(ex.minutes)} min · ${(veh(vid) || {}).plate}`, detail: `RN-FLO-14: ${F.num(ex.min, 1)} a ${F.num(ex.max, 1)} °C desde las ${hm(ex.start)} (rango ${rg.min ?? '—'} a ${rg.max} °C, límite ${lim} min). ${affected.length} pedido(s) de la ruta pasan a revisión de calidad.`, extra: { excursion_start: ex.start, max_value: ex.max } });
    const reviews = (r.alert.order_reviews || []).slice(); const have = new Set(reviews.map(x => x.order_id));
    for (const o of affected) if (!have.has(o.id)) reviews.push({ order_id: o.id, number: o.number, status: 'PENDING', decided_by: null, decided_at: null, note: null });
    G.db.update('fleet_alerts', r.alert.id, { order_reviews: reviews, excursion_minutes: ex.minutes }, { silent: true });
    if (!prev && !seeding()) {
      if (G.cal && typeof G.cal.createNC === 'function' && G.modOn('CAL')) { try { const nc = G.cal.createNC({ source: 'PROCESS', severity: 'MAJOR', description: `Cadena de frío: ${(veh(vid) || {}).plate} a ${F.num(ex.max, 1)} °C por ${F.num(ex.minutes)} min en la jornada ${t.number}; pedidos ${affected.map(o => o.number).join(', ') || '—'} en revisión (FLO).`, establishment_id: t.establishment_id }); G.db.update('fleet_alerts', r.alert.id, { nc_id: nc.id, nc_number: nc.number }, { silent: true }); } catch (e) { if (!(e instanceof G.RuleError)) console.warn(e); } }
      G.notify({ role: 'CALIDAD', title: `Revisar pedidos por temperatura · ${(veh(vid) || {}).plate}`, body: `${affected.length} pedido(s) de ${t.number}`, tone: 'bad', module: 'FLO', ref: { screen: 'FLO-14', id: r.alert.id } });
    }
    return G.db.get('fleet_alerts', r.alert.id);
  }
  FLO.reviewOrder = function (alertId, orderId, decision, note) {
    if (!G.can('flo.live.view') && !['CALIDAD', 'GERENTE'].includes(G.ctx.role)) G.fail('RN-FLO-14', 'Revisar pedidos por temperatura corresponde a calidad o al coordinador.');
    const a = G.db.get('fleet_alerts', alertId); if (!a) G.fail('RN-FLO-14', 'Alerta no encontrada.');
    if (!['RELEASED', 'REJECTED'].includes(decision)) G.fail('RN-FLO-14', 'Elige liberar o rechazar.');
    if (decision === 'REJECTED' && !String(note || '').trim()) G.fail('RN-FLO-14', 'Rechazar un pedido exige el motivo (reclamo o reposición en CAL).');
    const rv = (a.order_reviews || []).map(x => x.order_id === orderId ? Object.assign({}, x, { status: decision, decided_by: G.ctx.userId(), decided_at: G.date.now(), note: note || null }) : x);
    return G.db.update('fleet_alerts', alertId, { order_reviews: rv });
  };

  /* ------------------------------------------------------------------
     Alertas (RN-FLO-20) y barrido periódico (documentos, mantenimiento, GPS)
     ------------------------------------------------------------------ */
  FLO.raise = function ({ type, vehicle_id, origin, title, detail, severity = 'warn', employee_id = null, at, extra = {} }) {
    const ex = G.db.find('fleet_alerts', a => a.vehicle_id === vehicle_id && a.alert_type === type && a.origin === origin && a.status !== 'CLOSED');
    const when = at || (seeding() ? LIVE_AT : FLO.clock());
    if (ex) { G.db.update('fleet_alerts', ex.id, Object.assign({ occurrences: (ex.occurrences || 1) + 1, last_at: when, detail, title, severity }, extra), { silent: true }); return { alert: ex, created: false }; }
    const a = G.db.insert('fleet_alerts', Object.assign({ number: G.db.next('AF', 'AF-', 4), alert_type: type, vehicle_id, employee_id, origin, title, detail, severity, first_at: when, last_at: when, occurrences: 1, status: 'OPEN', ack_by: null, ack_at: null, ack_note: null, closed_by: null, closed_at: null, resolution: null, order_reviews: [] }, extra), { silent: true });
    if (!seeding() && severity === 'bad') G.notify({ role: 'COORDINADOR_DELIVERY', title: `${alertName(type)} · ${(veh(vehicle_id) || {}).plate || ''}`, body: title, tone: 'bad', module: 'FLO', ref: { screen: 'FLO-14', id: a.id } });
    return { alert: a, created: true };
  };
  FLO.closeAlertsFor = function (type, origins, resolution) {
    for (const a of G.db.where('fleet_alerts', a => a.alert_type === type && origins.includes(a.origin) && a.status !== 'CLOSED')) G.db.update('fleet_alerts', a.id, { status: 'CLOSED', closed_at: seeding() ? LIVE_AT : G.date.now(), closed_by: seeding() ? null : G.ctx.userId(), resolution: resolution + ' (cierre automático)' }, { silent: true });
  };
  FLO.ackAlert = function (id, note) {
    const a = G.db.get('fleet_alerts', id); if (!a || a.status !== 'OPEN') G.fail('RN-FLO-20', 'Solo se atiende una alerta abierta.');
    if (!String(note || '').trim()) G.fail('RN-FLO-20', 'Indica qué acción se tomó.');
    return G.db.update('fleet_alerts', id, { status: 'ACK', ack_by: G.ctx.userId(), ack_at: G.date.now(), ack_note: note.trim() });
  };
  FLO.closeAlert = function (id, resolution) {
    const a = G.db.get('fleet_alerts', id); if (!a || a.status === 'CLOSED') G.fail('RN-FLO-20', 'La alerta ya está cerrada.');
    if (!String(resolution || '').trim()) G.fail('RN-FLO-20', 'Cerrar la alerta exige la resolución.');
    if (a.alert_type === 'TEMPERATURE' && (a.order_reviews || []).some(x => x.status === 'PENDING')) G.fail('RN-FLO-14', `Quedan ${(a.order_reviews || []).filter(x => x.status === 'PENDING').length} pedido(s) por revisar: libéralos o recházalos antes de cerrar.`);
    return G.db.update('fleet_alerts', id, { status: 'CLOSED', closed_by: G.ctx.userId(), closed_at: G.date.now(), resolution: resolution.trim() });
  };
  /** barrido: documentos (RN-FLO-13), mantenimiento (RN-FLO-09/11) y GPS silencioso (RN-FLO-18) */
  FLO.scan = function () {
    const out = [];
    const [a30] = docAlertDays();
    for (const d of G.db.where('vehicle_documents', x => x.status === 'ACTIVE' && x.expires_on)) {
      const st = FLO.docState(d); if (!['EXPIRED', 'D7', 'D15', 'D30'].includes(st)) continue;
      const v = d.vehicle_id ? veh(d.vehicle_id) : null; if (d.vehicle_id && (!v || !tracked(v) || v.status === 'RETIRED')) continue;
      const owner = v ? v.plate : G.userName((userOfEmp(d.employee_id) || {}).id) || ((G.db.get('employees', d.employee_id) || {}).full_name);
      const days = G.date.diff(d.expires_on, G.TODAY);
      out.push(FLO.raise({ type: 'DOCUMENT', vehicle_id: d.vehicle_id || null, employee_id: d.employee_id || null, origin: 'doc:' + d.id, severity: st === 'EXPIRED' || st === 'D7' ? 'bad' : st === 'D15' ? 'warn' : 'info', title: `${docName(d.doc_type)} ${st === 'EXPIRED' ? 'vencido' : 'por vencer'} · ${owner}`, detail: `RN-FLO-13: ${d.number} ${st === 'EXPIRED' ? `venció el ${F.date(d.expires_on)} (hace ${-days} días)` : `vence el ${F.date(d.expires_on)} (en ${days} días; avisos a ${docAlertDays().join(', ')} días)`}.${st === 'EXPIRED' && ['SOAT', 'TECH_INSPECTION'].includes(d.doc_type) ? ' El vehículo no sale (RN-FLO-11).' : st === 'EXPIRED' && d.doc_type === 'DRIVER_LICENSE' ? ' No inicia jornada (RN-FLO-12).' : ''}` }).alert);
      void a30;
    }
    for (const p of G.db.where('vehicle_maintenance_plans', x => x.status === 'ACTIVE')) {
      const v = veh(p.vehicle_id); if (!v || !tracked(v)) continue;
      const s = FLO.planState(p); if (s.st === 'OK') continue;
      const why = [s.kmLeft != null ? (s.kmLeft < 0 ? `pasado por ${F.num(-s.kmLeft)} km` : `faltan ${F.num(s.kmLeft)} km`) : null, s.daysLeft != null ? (s.daysLeft < 0 ? `vencido hace ${-s.daysLeft} días` : `faltan ${s.daysLeft} días`) : null].filter(Boolean).join(' · ');
      out.push(FLO.raise({ type: 'MAINTENANCE', vehicle_id: v.id, origin: 'plan:' + p.id, severity: s.st === 'DUE_SOON' ? 'warn' : 'bad', title: `${p.task} ${s.st === 'DUE_SOON' ? 'próximo' : 'vencido'} · ${v.plate}`, detail: `RN-FLO-09: próximo a ${p.next_due_km != null ? F.num(p.next_due_km) + ' km' : '—'} o el ${F.date(p.next_due_on)}; ${why}.${s.st === 'OVERDUE_BLOCK' ? ' Bloquea el vehículo (RN-FLO-11).' : ''}` }).alert);
    }
    const lim = num('flo_gps_silent_minutes', 10);
    for (const t of G.db.where('vehicle_trips', x => x.status === 'OPEN')) {
      const m = FLO.silentMinutes(t); if (m <= lim) continue;
      const lp = FLO.lastPos(t);
      out.push(FLO.raise({ type: 'GPS_SILENT', vehicle_id: t.vehicle_id, employee_id: t.driver_employee_id, origin: 'trip:' + t.id, severity: 'warn', title: `GPS silencioso ${F.num(m)} min · ${(veh(t.vehicle_id) || {}).plate}`, detail: `RN-FLO-18: sin posición desde las ${hm(lp ? lp.recorded_at : t.started_at)} en la jornada ${t.number} (${G.userName(t.driver_user_id)}); el límite es ${lim} min.` }).alert);
    }
    return out;
  };

  /* ------------------------------------------------------------------
     Combustible y rendimiento (RN-FLO-06/07/08/17)
     ------------------------------------------------------------------ */
  const loadsOf = vid => G.db.where('fuel_loads', f => f.vehicle_id === vid && f.status !== 'VOIDED').sort((a, b) => a.loaded_at < b.loaded_at ? -1 : a.loaded_at > b.loaded_at ? 1 : 0);
  /** RN-FLO-06: km desde la carga llena anterior / galones cargados desde ella (sin incluirla, incluida la actual) */
  function efficiencyAt(vid, at, odo, gal, full, selfId) {
    if (!full) return { km_since_full: null, gallons_since_full: null, km_per_gal: null };
    const prior = loadsOf(vid).filter(f => f.id !== selfId && f.loaded_at < at);
    let k = prior.length - 1; while (k >= 0 && !prior[k].full_tank) k--;
    if (k < 0) return { km_since_full: null, gallons_since_full: null, km_per_gal: null };
    const base = prior[k]; const g = R(U.sum(prior.slice(k + 1), f => f.gallons) + gal, 3); const km = odo - base.odometer_km;
    return { km_since_full: km, gallons_since_full: g, km_per_gal: g > 0 && km > 0 ? R(km / g, 1) : null, base_load_id: base.id };
  }
  FLO.efficiencyPreview = (vid, at, odo, gal, full) => efficiencyAt(vid, at, Number(odo), Number(gal), full);
  FLO.lowThreshold = vid => R(prof(vid).expected_km_per_gal * (1 - num('flo_fuel_efficiency_tolerance_pct', 15) / 100), 1);
  FLO.validateFuel = function (d) {
    const v = veh(d.vehicle_id); if (!v) G.fail('RN-FLO-08', 'Elige el vehículo.');
    const gal = Number(d.gallons), price = Number(d.price_per_gal);
    if (!(gal > 0)) G.fail('RN-FLO-08', 'Indica los galones cargados.');
    const cap = prof(v.id).tank_capacity_gal, fac = num('flo_tank_overfill_factor', 1.05);
    if (cap && gal > R(cap * fac, 3)) G.fail('RN-FLO-08', `${F.num(gal, 3)} galones superan el tanque de ${v.plate}: capacidad ${F.num(cap, 2)} gal × ${F.num(fac, 2)} = ${F.num(cap * fac, 3)} gal. Revisa el vale.`);
    if (!(price > 0)) G.fail('RN-FLO-17', 'Indica el precio por galón.');
    const at = String(d.loaded_at || '').slice(0, 19); if (at.length < 16) G.fail('RN-FLO-04', 'Indica la fecha y hora de la carga.');
    FLO.assertOdometer(v.id, d.odometer_km, at);
    if (d.voucher_no) { const dup = G.db.find('fuel_loads', f => f.status !== 'VOIDED' && f.vehicle_id === v.id && f.voucher_no && String(f.voucher_no).toUpperCase() === String(d.voucher_no).toUpperCase() && f.id !== d.id); if (dup) G.fail('RN-FLO-17', `El vale ${d.voucher_no} ya está registrado en la carga ${dup.number}.`); }
    return { v, gal, price, at };
  };
  FLO.registerFuel = function (d, o = {}) {
    if (!o.seed) G.assertMod('FLO');
    const { v, gal, price, at } = FLO.validateFuel(d);
    if (!o.seed) G.period.assertOpen(at.slice(0, 10));
    const odo = Math.round(Number(d.odometer_km)); const full = d.full_tank !== false && d.full_tank !== 'NO';
    const ef = efficiencyAt(v.id, at, odo, gal, full);
    const trip = G.db.find('vehicle_trips', t => t.vehicle_id === v.id && t.started_at && t.started_at <= at && (t.status === 'OPEN' || (t.ended_at && t.ended_at >= at)));
    const uid = d.driver_user_id || (trip ? trip.driver_user_id : null);
    const row = G.db.insert('fuel_loads', Object.assign({ number: d.number || G.db.next('CG', 'CG-', 5), vehicle_id: v.id, trip_id: trip ? trip.id : null, driver_user_id: uid, employee_id: uid ? empOfUser(uid) : null, loaded_at: at, odometer_km: odo, gallons: R(gal, 3), price_per_gal: R(price, 3), amount: R(d.amount != null && d.amount !== '' ? Number(d.amount) : gal * price), full_tank: full, fuel_type: v.fuel_type, station_supplier_id: d.station_supplier_id || null, station_name: d.station_name || (d.station_supplier_id ? G.supName(d.station_supplier_id) : null), voucher_no: d.voucher_no || null, photo: d.photo || null, source: d.source || 'WEB', doc_type: d.doc_type || null, doc_number: d.doc_number || null, expense_id: null, status: 'ACTIVE', efficiency_status: 'NA', recorded_by: o.seed ? null : G.ctx.userId() }, ef), { silent: !!o.seed });
    addReading(v.id, odo, at, 'FUEL', row.id);
    applyEfficiencyAlert(row);
    if (d.expense_id) FLO.linkExpense('fuel_loads', row.id, d.expense_id);
    else if (d.create_expense) { const e = makeExpense({ kind: 'FUEL', vehicle_id: v.id, amount: row.amount, date: at.slice(0, 10), supplier_id: row.station_supplier_id, doc_type: d.doc_type || 'INVOICE', doc_series: d.doc_series, doc_number: d.doc_number, description: `Combustible ${row.number} · ${v.plate} · ${F.num(gal, 3)} gal`, gallons: gal, odometer: odo, voucher: row.voucher_no, employee_id: row.employee_id, photo: row.photo }); G.db.update('fuel_loads', row.id, { expense_id: e.id }, { silent: true }); }
    return G.db.get('fuel_loads', row.id);
  };
  function applyEfficiencyAlert(row) {
    if (row.km_per_gal == null) { G.db.update('fuel_loads', row.id, { efficiency_status: 'NA' }, { silent: true }); return null; }
    const thr = FLO.lowThreshold(row.vehicle_id), exp = prof(row.vehicle_id).expected_km_per_gal;
    const low = row.km_per_gal < thr;
    G.db.update('fuel_loads', row.id, { efficiency_status: low ? 'LOW' : 'OK', expected_km_per_gal: exp }, { silent: true });
    if (!low) return null;
    return FLO.raise({ type: 'FUEL_EFFICIENCY', vehicle_id: row.vehicle_id, origin: 'kmpg', employee_id: row.employee_id, at: row.loaded_at, severity: 'bad', title: `Rendimiento ${F.num(row.km_per_gal, 1)} km/gal · ${(veh(row.vehicle_id) || {}).plate}`, detail: `RN-FLO-07: ${F.num(row.km_since_full)} km / ${F.num(row.gallons_since_full, 3)} gal en la carga ${row.number}; esperado ${F.num(exp)} km/gal, mínimo ${F.num(thr, 1)} (tolerancia ${num('flo_fuel_efficiency_tolerance_pct', 15)} %).`, extra: { last_ref: row.id } }).alert;
  }
  /** recalcula rendimientos de un vehículo (tras anular una carga) */
  FLO.recalcEfficiency = function (vid) {
    for (const f of loadsOf(vid)) { const ef = efficiencyAt(vid, f.loaded_at, f.odometer_km, f.gallons, f.full_tank, f.id); G.db.update('fuel_loads', f.id, Object.assign(ef, { efficiency_status: ef.km_per_gal == null ? 'NA' : ef.km_per_gal < FLO.lowThreshold(vid) ? 'LOW' : 'OK' }), { silent: true }); }
  };
  FLO.voidFuel = function (id, reason) {
    if (!G.can('flo.fuel.manage')) G.fail('RN-FLO-17', 'Corregir cargas exige el permiso flo.fuel.manage.');
    if (!String(reason || '').trim()) G.fail('RN-FLO-17', 'Anular una carga exige motivo (no se borra).');
    const f = G.db.get('fuel_loads', id); if (!f || f.status === 'VOIDED') G.fail('RN-FLO-17', 'La carga ya está anulada.');
    G.db.update('fuel_loads', id, { status: 'VOIDED', void_reason: reason.trim(), voided_at: G.date.now(), voided_by: G.ctx.userId() });
    FLO.recalcEfficiency(f.vehicle_id);
    return G.db.get('fuel_loads', id);
  };

  /* ---------- gasto en GAS y enlace único (RN-FLO-17) ---------- */
  const LINKED = ['fuel_loads', 'vehicle_maintenances', 'vehicle_costs', 'traffic_fines'];
  FLO.linkedTo = expId => { for (const t of LINKED) { const r = G.db.find(t, x => x.expense_id === expId && x.status !== 'VOIDED'); if (r) return { table: t, row: r }; } return null; };
  FLO.linkExpense = function (table, id, expId) {
    const row = G.db.get(table, id); const e = G.db.get('expenses', expId);
    if (!row || !e) G.fail('RN-FLO-17', 'Gasto no encontrado.');
    if (row.expense_id && row.expense_id !== expId) G.fail('RN-FLO-17', `${row.number || row.ballot_number || 'El registro'} ya está enlazado al gasto ${(G.db.get('expenses', row.expense_id) || {}).number}.`);
    const l = FLO.linkedTo(expId); if (l && !(l.table === table && l.row.id === id)) G.fail('RN-FLO-17', `El gasto ${e.number} ya está enlazado a ${l.row.number || l.row.ballot_number || l.row.id}: cada comprobante se registra una sola vez como gasto.`);
    if (['VOIDED', 'REJECTED'].includes(e.status)) G.fail('RN-FLO-17', `El gasto ${e.number} está ${e.status === 'VOIDED' ? 'anulado' : 'rechazado'}.`);
    return G.db.update(table, id, { expense_id: expId }, { silent: seeding() });
  };
  const CAT = { FUEL: 'gc-DEL-COMB', MAINT: 'gc-DEL-MANT', FINE: 'gc-DEL-MULTA', RENT: 'gc-DEL-ALQ', TOLL: 'gc-DEL-PEAJE', PARKING: 'gc-DEL-PEAJE', INSURANCE: 'gc-DEL-SOAT', TAX: 'gc-DEL-SOAT', WASH: 'gc-DEL-MANT', TIRES: 'gc-DEL-MANT', OTHER: 'gc-DEL-MANT' };
  function makeExpense(x) {
    const v = veh(x.vehicle_id) || {}; const date = x.date || G.TODAY; G.period.assertOpen(date);
    const cat = G.db.get('expense_categories', CAT[x.kind] || 'gc-DEL-MANT') ? (CAT[x.kind] || 'gc-DEL-MANT') : null;
    const dt = x.doc_type || 'INVOICE';
    const d = { establishment_id: v.establishment_id || 'es-L1', cost_center_id: 'cc-DEL', brand_id: 'br-DG', category_id: cat, supplier_id: x.supplier_id || null, doc_type: dt, doc_series: x.doc_series || null, doc_number: x.doc_number || null, issue_date: date, currency: 'PEN', total: R(x.amount), igv: dt === 'INVOICE' ? R(x.amount - x.amount / 1.18) : 0, other_taxes: 0, vehicle_id: v.id || null, employee_id: x.employee_id || null, fuel_gallons: x.gallons || null, fuel_voucher_no: x.voucher || null, odometer_km: x.odometer || null, description: x.description, receipt_file_id: x.photo ? 'fa-flo-' + U.token(6) : null, receipt_photo: x.photo ? { name: x.photo, taken_at: G.date.now() } : null, pay_source: 'PAYABLE', source_module: 'FLO' };
    if (G.gas && typeof G.gas.create === 'function' && cat) return G.gas.create(d, { submit: false });
    return G.db.insert('expenses', Object.assign(d, { number: G.db.next('GAS', 'GS-', 6), amount_pen: R(x.amount), net_pen: R(dt === 'INVOICE' ? x.amount / 1.18 : x.amount), status: 'DRAFT', created_by: G.ctx.userId(), history: [{ at: G.date.now(), action: 'Registrado desde FLO (sin GAS en este armado)', user: G.ctx.userName() }] }));
  }
  FLO.makeExpense = makeExpense;
  /** gastos de GAS candidatos a enlazar (mismo vehículo, categoría, sin enlace) */
  FLO.expenseCandidates = function (kind, vid) {
    const cat = CAT[kind];
    return G.db.where('expenses', e => e.vehicle_id === vid && (!cat || e.category_id === cat || (kind === 'MAINT' && e.category_id === 'gc-DEL-MANT')) && !['VOIDED', 'REJECTED'].includes(e.status) && !FLO.linkedTo(e.id)).sort(U.by('issue_date', -1));
  };

  /* ------------------------------------------------------------------
     Multas (RN-FLO-15) y otros costos
     ------------------------------------------------------------------ */
  const ENTITIES = [['SAT', 'SAT Lima'], ['PNP', 'Policía Nacional (PNP)'], ['ATU', 'ATU'], ['MUNI', 'Municipalidad distrital'], ['SUTRAN', 'SUTRAN']];
  FLO.driverAt = (vid, date) => { const t = G.db.find('vehicle_trips', x => x.vehicle_id === vid && x.trip_date === date && x.driver_user_id); return t ? t.driver_user_id : null; };
  FLO.fineDue = (f, on = G.TODAY) => (f.early_discount_until && on <= f.early_discount_until && f.early_discount_pct) ? R(f.amount * (1 - f.early_discount_pct / 100)) : f.amount;
  FLO.saveFine = function (d, o = {}) {
    if (!o.seed && !G.can('flo.fine.manage')) G.fail('RN-FLO-15', 'Registrar multas exige el permiso flo.fine.manage.');
    if (!String(d.ballot_number || '').trim()) G.fail('RN-FLO-15', 'Indica el número de papeleta.');
    if (G.db.find('traffic_fines', f => f.ballot_number === d.ballot_number.trim() && f.status !== 'VOIDED')) G.fail('RN-FLO-15', `La papeleta ${d.ballot_number} ya está registrada.`);
    if (!d.vehicle_id || !d.fine_date || !(Number(d.amount) > 0) || !String(d.infraction || '').trim()) G.fail('RN-FLO-15', 'Vehículo, fecha, infracción e importe son obligatorios.');
    const uid = d.driver_user_id || FLO.driverAt(d.vehicle_id, d.fine_date);
    return G.db.insert('traffic_fines', { ballot_number: d.ballot_number.trim(), fine_date: d.fine_date, entity: d.entity || 'SAT', infraction_code: d.infraction_code || null, infraction: d.infraction.trim(), vehicle_id: d.vehicle_id, driver_user_id: uid || null, employee_id: uid ? empOfUser(uid) : (d.employee_id || null), amount: R(Number(d.amount)), early_discount_pct: Number(d.early_discount_pct || 0), early_discount_until: d.early_discount_until || null, discount_amount: 0, paid_amount: null, paid_on: null, status: 'PENDING', charged_to_driver: false, deduct_from_payout: false, acknowledgment_signed: false, acknowledgment_file: null, hr_approved_by: null, hr_approved_at: null, deducted_payout_id: null, expense_id: null, notes: d.notes || null, appeal_note: null }, { silent: !!o.seed });
  };
  FLO.payFine = function (id, { paid_on = G.TODAY, create_expense, expense_id } = {}, o = {}) {
    const f = G.db.get('traffic_fines', id); if (!f || f.status !== 'PENDING') G.fail('RN-FLO-15', 'Solo se paga una multa pendiente.');
    if (!o.seed) { if (!G.can('flo.fine.manage')) G.fail('RN-FLO-15', 'Pagar multas exige el permiso flo.fine.manage.'); G.period.assertOpen(paid_on); }
    const due = FLO.fineDue(f, paid_on);
    G.db.update('traffic_fines', id, { status: 'PAID', paid_on, paid_amount: due, discount_amount: R(f.amount - due) }, { silent: !!o.seed });
    if (expense_id) FLO.linkExpense('traffic_fines', id, expense_id);
    else if (create_expense) { const e = makeExpense({ kind: 'FINE', vehicle_id: f.vehicle_id, amount: due, date: paid_on, doc_type: 'SIMPLE_RECEIPT', doc_number: f.ballot_number, description: `Multa ${f.ballot_number} · ${f.infraction} · ${(veh(f.vehicle_id) || {}).plate}` }); G.db.update('traffic_fines', id, { expense_id: e.id }, { silent: true }); }
    return G.db.get('traffic_fines', id);
  };
  /** RN-FLO-15 y D-FLO-03: descuento al conductor solo con acta firmada y aprobación de RR. HH.; una sola vez */
  FLO.chargeFineToDriver = function (id, { acknowledgment_file, hr_user_id } = {}, o = {}) {
    const f = G.db.get('traffic_fines', id); if (!f) G.fail('RN-FLO-15', 'Multa no encontrada.');
    if (f.charged_to_driver || f.deducted_payout_id) G.fail('RN-FLO-15', `La multa ${f.ballot_number} ya se descontó al conductor: no se descuenta más de una vez.`);
    if (['VOIDED', 'APPEALED'].includes(f.status)) G.fail('RN-FLO-15', `La multa ${f.ballot_number} está ${(ST[f.status] || [f.status])[0].toLowerCase()}.`);
    if (!f.employee_id) G.fail('RN-FLO-15', 'La multa no tiene conductor identificado.');
    if (!String(acknowledgment_file || '').trim()) G.fail('RN-FLO-15', 'El descuento exige el acta de reconocimiento firmada por el conductor (adjúntala).');
    const hr = user(hr_user_id || (o.seed ? null : G.ctx.userId()));
    if (!hr || !['RRHH', 'GERENTE'].includes(hr.role)) G.fail('RN-FLO-15', 'D-FLO-03: el descuento lo aprueba RR. HH. (o gerencia).');
    G.db.update('traffic_fines', id, { charged_to_driver: true, deduct_from_payout: true, acknowledgment_signed: true, acknowledgment_file: acknowledgment_file.trim(), hr_approved_by: hr.id, hr_approved_at: o.seed ? (o.at || null) : G.date.now() }, { silent: !!o.seed });
    return G.db.get('traffic_fines', id);
  };
  FLO.saveCost = function (d, o = {}) {
    if (!o.seed && !G.can('flo.fuel.manage') && !G.can('flo.maintenance.manage')) G.fail('RN-FLO-16', 'Registrar costos del vehículo corresponde al coordinador o a administración.');
    if (!d.vehicle_id || !d.cost_type || !d.cost_date || !(Number(d.amount) > 0)) G.fail('RN-FLO-16', 'Vehículo, tipo, fecha e importe son obligatorios.');
    if (!o.seed) G.period.assertOpen(d.cost_date);
    const row = G.db.insert('vehicle_costs', { vehicle_id: d.vehicle_id, cost_type: d.cost_type, cost_date: d.cost_date, period: d.period ? G.date.month(d.period) : G.date.month(d.cost_date), amount: R(Number(d.amount)), supplier_id: d.supplier_id || null, doc_type: d.doc_type || null, doc_number: d.doc_number || null, notes: d.notes || null, expense_id: null, status: 'ACTIVE' }, { silent: !!o.seed });
    if (d.expense_id) FLO.linkExpense('vehicle_costs', row.id, d.expense_id);
    else if (d.create_expense) { const e = makeExpense({ kind: d.cost_type, vehicle_id: d.vehicle_id, amount: row.amount, date: d.cost_date, supplier_id: d.supplier_id, doc_type: d.doc_type, doc_number: d.doc_number, description: `${costName(d.cost_type)} · ${(veh(d.vehicle_id) || {}).plate}${d.notes ? ' · ' + d.notes : ''}` }); G.db.update('vehicle_costs', row.id, { expense_id: e.id }, { silent: true }); }
    return G.db.get('vehicle_costs', row.id);
  };

  /* ------------------------------------------------------------------
     Costo total del vehículo (RN-FLO-16) · vista vehicle_monthly_cost_v
     ------------------------------------------------------------------ */
  FLO.costFormula = function (c) {
    const total = R((c.fuel || 0) + (c.maint || 0) + (c.fines || 0) + (c.rent || 0) + (c.tolls || 0) + (c.insurance || 0) + (c.other || 0) + (c.deprec || 0) + (c.driver || 0));
    return { total, per_km: c.km > 0 ? R(total / c.km, 2) : null, per_delivery: c.deliveries > 0 ? R(total / c.deliveries, 2) : null };
  };
  const tripsIn = (vid, from, to, closedOnly = true) => G.db.where('vehicle_trips', t => t.vehicle_id === vid && t.trip_date >= from && t.trip_date <= to && (closedOnly ? t.status === 'CLOSED' : ['OPEN', 'CLOSED'].includes(t.status)));
  FLO.monthlyCost = function (vid, month) {
    const v = veh(vid); const p = prof(vid); const from = G.date.month(month); const end = monthEnd(from); const to = end > G.TODAY ? G.TODAY : end;
    const inP = d => d && String(d).slice(0, 10) >= from && String(d).slice(0, 10) <= to;
    const c = { vehicle_id: vid, month: from };
    c.fuel = R(U.sum(G.db.where('fuel_loads', f => f.vehicle_id === vid && f.status !== 'VOIDED' && f.source !== 'BASELINE' && inP(f.loaded_at)), f => f.amount));
    c.maint = R(U.sum(G.db.where('vehicle_maintenances', m => m.vehicle_id === vid && m.status === 'DONE' && inP(m.done_on)), m => m.total_amount));
    c.fines = R(U.sum(G.db.where('traffic_fines', f => f.vehicle_id === vid && !f.charged_to_driver && !['VOIDED', 'APPEALED'].includes(f.status) && inP(f.fine_date)), f => f.paid_amount ?? FLO.fineDue(f)));
    const vc = G.db.where('vehicle_costs', x => x.vehicle_id === vid && x.status !== 'VOIDED' && (x.period || G.date.month(x.cost_date)) === from && (x.cost_date <= to || x.cost_type === 'RENT'));
    const s = types => R(U.sum(vc.filter(x => types.includes(x.cost_type)), x => x.amount));
    const trips = tripsIn(vid, from, to);
    c.rent = s(['RENT']); c.rent_accrued = false;
    if (v && v.ownership === 'RENTED' && !c.rent && v.rental_daily_rate) { c.rent = R(v.rental_daily_rate * trips.length); c.rent_accrued = true; }
    c.tolls = s(['TOLL', 'PARKING']); c.insurance = s(['INSURANCE', 'TAX']); c.other = s(['WASH', 'TIRES', 'OTHER']);
    const daysIn = G.date.diff(end, from) + 1, elapsed = G.date.diff(to, from) + 1;
    c.deprec = v && v.ownership === 'OWN' && p.purchase_cost && p.useful_life_months ? R((p.purchase_cost - (p.residual_value || 0)) / p.useful_life_months * (elapsed / daysIn)) : 0;
    const wd = workDays(from, end); const byDrv = U.groupBy(trips, 'driver_user_id');
    c.driver = R(U.sum(Object.entries(byDrv), ([uid, ts]) => { const emp = G.db.get('employees', empOfUser(uid)); return emp && emp.monthly_salary ? emp.monthly_salary / wd * ts.length : 0; }));
    c.km = U.sum(trips, t => t.km_odometer || 0); c.deliveries = U.sum(trips, t => t.deliveries || 0); c.days = trips.length;
    Object.assign(c, FLO.costFormula(c));
    return c;
  };
  FLO.vehicle_monthly_cost_v = (month, site) => fleet().filter(v => !site || v.establishment_id === site).map(v => FLO.monthlyCost(v.id, month));
  /** comparativo propio, alquilado y tercero por zona: el costo del vehículo se reparte a sus entregas por distancia al local */
  FLO.compareByZone = function (month) {
    const from = G.date.month(month), end = monthEnd(from), to = end > G.TODAY ? G.TODAY : end;
    const rows = {}; const add = (z, mode, cost, n) => { const r = rows[z] || (rows[z] = { zone_id: z, OWN: { cost: 0, n: 0 }, RENTED: { cost: 0, n: 0 } }); r[mode].cost += cost; r[mode].n += n; };
    for (const v of fleet().filter(x => G.scope.ok(x))) {
      const mc = FLO.monthlyCost(v.id, from); if (!mc.total) continue;
      const site = sitePt(v.establishment_id); const items = [];
      for (const t of tripsIn(v.id, from, to)) for (const o of delivOf(t.driver_user_id, t.trip_date).filter(x => ['DELIVERED', 'CLOSED'].includes(x.status))) { const z = G.db.get('delivery_zones', o.zone_id); if (!z) continue; items.push({ z: z.id, w: Math.max(1, G.geo.km(site, [z.lat, z.lng])) }); }
      const W = U.sum(items, i => i.w); if (!W) continue;
      for (const i of items) add(i.z, v.ownership, mc.total * i.w / W, 1);
    }
    const out = Object.values(rows).map(r => {
      const rate = carrierRate(r.zone_id, to);
      return { zone_id: r.zone_id, own_n: r.OWN.n, own_cpd: r.OWN.n ? R(r.OWN.cost / r.OWN.n) : null, rent_n: r.RENTED.n, rent_cpd: r.RENTED.n ? R(r.RENTED.cost / r.RENTED.n) : null, third_cpd: rate };
    });
    for (const r of out) { const opts = [['Propio', r.own_cpd], ['Alquilado', r.rent_cpd], ['Tercero', r.third_cpd]].filter(x => x[1] != null).sort((a, b) => a[1] - b[1]); r.best = opts[0] ? opts[0][0] : null; }
    return out.sort((a, b) => (b.own_n + b.rent_n) - (a.own_n + a.rent_n));
  };
  function carrierRate(zone, date) {
    const rs = G.db.where('carrier_rates', x => x.status !== 'VOIDED' && x.rate_basis !== 'PER_KG' && x.valid_from <= date && (!x.valid_to || x.valid_to >= date));
    const z = rs.find(x => x.zone_id === zone) || rs.find(x => !x.zone_id);
    return z ? R(z.amount) : null;
  }
  FLO.carrierRate = carrierRate;

  /* =====================================================================
     Datos de ejemplo (orden 62, fase 3) · deterministas
     ===================================================================== */
  /** recorrido simulado: legs en «L» por calles, con desvío para ajustar km (aprox. a la trama urbana) */
  function buildPath(site, stops, targetKm) {
    let st = stops.slice();
    const mk = (list, e) => { const pts = [{ p: site, stop: false }]; let prev = site; const all = list.concat([null]); for (const s of all) { const B = s ? s.pt : site; const sg = Math.sign(B[0] - prev[0]) || 1; const eDeg = (e || 0) / LAT_KM; if (eDeg) { pts.push({ p: [B[0] + sg * eDeg, prev[1]] }); pts.push({ p: [B[0] + sg * eDeg, B[1]] }); } else pts.push({ p: [B[0], prev[1]] }); pts.push({ p: B, stop: !!s, ref: s && s.ref }); prev = B; } return pts; };
    const len = pts => { let k = 0; for (let i = 1; i < pts.length; i++) k += legKm(pts[i - 1].p, pts[i].p); return k; };
    let pts = mk(st, 0);
    if (targetKm) {
      while (len(pts) > targetKm && st.length > 1) { let far = 0, fd = -1; st.forEach((s, i) => { const d = G.geo.km(site, s.pt); if (d > fd) { fd = d; far = i; } }); st.splice(far, 1); pts = mk(st, 0); }
      const X = targetKm - len(pts); if (X > 0) pts = mk(st, X / (2 * (st.length + 1)));
    }
    return pts;
  }
  function simulate({ path, start, speed, until, dwellMin, r }) {
    const out = []; let t = start; let seg = 0, pos = 0; let dwell = 0; let cur = path[0].p;
    const segLen = []; for (let i = 1; i < path.length; i++) segLen.push(legKm(path[i - 1].p, path[i].p));
    out.push({ t, lat: cur[0], lng: cur[1], speed: 0 });
    while (seg < segLen.length) {
      t = tadd(t, 30); if (until && t > until) break;
      if (dwell > 0) { dwell--; out.push({ t, lat: cur[0], lng: cur[1], speed: 0 }); continue; }
      const v = speed * (0.82 + r() * 0.36); let d = v * 30 / 3600;
      while (d > 0 && seg < segLen.length) {
        const rem = segLen[seg] - pos;
        if (d < rem) { pos += d; d = 0; }
        else { d -= rem; seg++; pos = 0; if (seg <= segLen.length && path[seg].stop) { dwell = Math.round((dwellMin[0] + r() * (dwellMin[1] - dwellMin[0])) * 2); d = 0; } }
      }
      if (seg >= segLen.length) cur = path[path.length - 1].p;
      else { const A = path[seg].p, B = path[seg + 1].p, f = segLen[seg] ? pos / segLen[seg] : 0; cur = [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f]; }
      out.push({ t, lat: R(cur[0], 6), lng: R(cur[1], 6), speed: dwell > 0 ? 0 : R(v, 1) });
    }
    return out;
  }
  const kmOf = sim => { let k = 0; for (let i = 1; i < sim.length; i++) k += legKm([sim[i - 1].lat, sim[i - 1].lng], [sim[i].lat, sim[i].lng]); return k; };
  FLO._sim = { buildPath, simulate, kmOf };

  G.seed(62, function seedFLO() {
    const r = U.rng(6262);
    const ins = (t, row) => G.db.insert(t, row, { silent: true });
    const usr = p => G.db.find('users', u => u.name.startsWith(p));
    const PED = usr('Pedro Condori'), HUG = usr('Hugo Ticona'), JUL = usr('Julio Choque'), RAU = usr('Raúl Chávez'), RH = usr('Gabriela Soto');
    if (!PED || !HUG || !JUL || !G.db.get('vehicles', 've-MTA-123')) return;
    const rental = G.db.find('suppliers', s => s.supplier_type === 'VEHICLE_RENTAL');
    const sup = id => G.db.get('suppliers', id) ? id : null;
    const gasExp = (cat, vid, date) => G.db.find('expenses', e => e.category_id === 'gc-' + cat && e.vehicle_id === vid && e.issue_date === date && !['VOIDED', 'REJECTED'].includes(e.status));
    // auto alquilado por días (D-FLO-01): SOAT vencido el 05/10/2026
    if (!G.db.get('vehicles', 've-BKZ-512')) ins('vehicles', { id: 've-BKZ-512', plate: 'BKZ-512', vehicle_type: 'CAR', ownership: 'RENTED', provider_id: rental ? rental.id : null, establishment_id: 'es-L1', capacity_kg: 350, refrigerated: false, status: 'ACTIVE', fuel_type: 'GASOLINE', soat_policy_no: 'SOAT-88131', soat_expires_on: '2026-10-05', tech_inspection_expires_on: '2027-03-14', odometer_km: 41230, rental_daily_rate: 90, driver_user_id: null, created_from: 'FLO' });
    // fichas técnicas
    const PF = [
      ['ve-MTA-123', 'MOT-01', 'Honda', 'CB 190R', 2024, 'Rojo', 3.0, 70, null, null, null, '2024-02-10', 9600, 0, 60, 'GPS de la app Android (Pedro)', null],
      ['ve-MTB-456', 'MOT-02', 'Honda', 'CB 190R', 2023, 'Negro', 3.0, 70, null, null, null, '2023-05-20', 8900, 0, 60, 'GPS de la app Android', null],
      ['ve-BXR-871', 'FUR-01', 'Hyundai', 'H-1 furgón con equipo de frío', 2022, 'Blanco', 18, 30, 0, 4, 'CHILLED', '2022-08-15', 96000, 16000, 96, 'GPS de la app Android (Hugo)', 'TS-BXR-01 (sensor Bluetooth en la caja)'],
      ['ve-MTC-789', 'MOT-03', 'Bajaj', 'Pulsar NS 200', 2025, 'Azul', 3.2, 68, null, null, null, null, null, null, null, 'GPS de la app Android (Julio)', null],
      ['ve-BKZ-512', 'AUT-01', 'Toyota', 'Yaris sedán', 2021, 'Plata', 11.5, 38, null, null, null, null, null, null, null, 'GPS de la app Android', null],
    ];
    for (const [vid, ic, mk, mo, yr, col, tank, kmpg, tmin, tmax, tmode, pd, pc, res, life, gps, sensor] of PF) if (G.db.get('vehicles', vid) && !G.db.find('vehicle_profiles', p => p.vehicle_id === vid)) ins('vehicle_profiles', { id: 'vp-' + vid.slice(3), vehicle_id: vid, internal_code: ic, make: mk, model: mo, year: yr, color: col, tank_capacity_gal: tank, expected_km_per_gal: kmpg, temp_min_c: tmin, temp_max_c: tmax, temp_mode: tmode, gps_source: 'APP_ANDROID', gps_device_id: gps, temp_sensor_id: sensor, purchase_date: pd, purchase_cost: pc, residual_value: res, useful_life_months: life, op_status: 'ACTIVE', notes: vid === 've-BXR-871' ? 'Único vehículo refrigerado (D-FLO-01): rango 0 a 4 °C' : null });

    /* --- jornadas: quién maneja qué cada día hábil --- */
    const days = []; for (let d = '2026-09-01'; d <= G.TODAY; d = G.date.add(d, 1)) if (dow(d) !== 0) days.push(d);
    const assign = [];
    for (const d of days) {
      assign.push({ vid: ['2026-09-12', '2026-10-06'].includes(d) ? 've-MTB-456' : 've-MTA-123', uid: PED.id, date: d });
      assign.push({ vid: d === '2026-09-19' ? 've-MTB-456' : 've-BXR-871', uid: HUG.id, date: d });
      assign.push({ vid: 've-MTC-789', uid: JUL.id, date: d });
    }
    const ordBy = new Map();
    for (const o of G.db.all('sales_orders')) { if (!o.driver_user_id || o.fulfillment !== 'DELIVERY' || o.delivery_date < '2026-09-01') continue; const k = o.driver_user_id + '|' + o.delivery_date; let l = ordBy.get(k); if (!l) ordBy.set(k, l = []); l.push(o); }
    const stopsFor = (uid, d, site) => {
      let list = (ordBy.get(uid + '|' + d) || []).filter(o => ['DELIVERED', 'CLOSED', 'IN_ROUTE'].includes(o.status)).map(o => ({ pt: orderPt(o), ref: o.id, o })).filter(s => s.pt);
      const out = []; let cur = site; // vecino más cercano (hoy: primero lo entregado y luego lo que sigue en ruta)
      const nn = arr => { while (arr.length) { let bi = 0, bd = 1e9; arr.forEach((s, i) => { const x = G.geo.km(cur, s.pt); if (x < bd) { bd = x; bi = i; } }); const s = arr.splice(bi, 1)[0]; out.push(s); cur = s.pt; } };
      if (d === G.TODAY) { nn(list.filter(s => s.o.status !== 'IN_ROUTE')); nn(list.filter(s => s.o.status === 'IN_ROUTE')); } else nn(list);
      return out;
    };
    const KM = { 've-MTA-123': [48, 72], 've-MTB-456': [42, 62], 've-BXR-871': [85, 125], 've-MTC-789': [36, 56] };
    const SPEED = { MOTO: 24, VAN: 21 };
    const TSTART = { 've-MTA-123': '08:12', 've-BXR-871': '08:27', 've-MTC-789': '08:41', 've-MTB-456': '08:20' };
    const SILENT = { 've-MTC-789': G.TODAY + 'T11:22:00' };
    const POSDAYS = ['2026-10-08', '2026-10-09'];
    const allTrips = [], allLoads = [], allReadings = [], allPos = [], tripOf = {};
    const odoAt = {}; // vid → [{date, end}]
    for (const vid of ['ve-MTA-123', 've-BXR-871', 've-MTC-789', 've-MTB-456']) {
      const v = G.db.get('vehicles', vid); if (!v) continue; const pf = prof(vid);
      const A = assign.filter(a => a.vid === vid); const TD = A.map(a => a.date); const drv = d => A.find(a => a.date === d).uid;
      const site = sitePt(v.establishment_id); const speed = SPEED[v.vehicle_type] || 22;
      // hoy (jornada abierta)
      let todaySim = null, todayKm = 0;
      if (TD.includes(G.TODAY)) {
        const sts = stopsFor(drv(G.TODAY), G.TODAY, site); const path = buildPath(site, sts, null);
        let pl = 0; for (let i = 1; i < path.length; i++) pl += legKm(path[i - 1].p, path[i].p);
        const avail = Math.max(1, (mins(G.TODAY + 'T' + TSTART[vid] + ':00', G.TODAY + 'T16:30:00') - sts.length * 5.5) / 60);
        todaySim = simulate({ path, start: G.TODAY + 'T' + TSTART[vid] + ':00', speed: Math.max(11, Math.min(speed, pl / avail)), until: SILENT[vid] || LIVE_AT, dwellMin: [4, 7], r }); todayKm = kmOf(todaySim) * 1.03;
      }
      const kmUntil = at => kmOf(todaySim.filter(p => p.t <= at)) * 1.03;
      // anclas: cargas de combustible del vehículo registradas en GAS (vales del grifo)
      const anchors = []; const used = new Set();
      for (const e of G.db.where('expenses', e => e.category_id === 'gc-DEL-COMB' && e.vehicle_id === vid && ['SUBMITTED', 'APPROVED', 'PAID', 'DRAFT'].includes(e.status) && e.fuel_gallons > 0 && e.issue_date >= '2026-09-01').sort(U.by('issue_date'))) {
        let day = TD.filter(d => d <= e.issue_date && !used.has(d)).pop(); if (!day || G.date.diff(e.issue_date, day) > 2) day = TD.find(d => d >= e.issue_date && !used.has(d)); if (!day) continue;
        if (anchors.length && day <= anchors[anchors.length - 1].day) continue;
        used.add(day); anchors.push({ day, gallons: e.fuel_gallons, price: R(e.total / e.fuel_gallons, 3), expense: e, voucher: e.fuel_voucher_no, station: e.supplier_id, uid: drv(day) });
      }
      const km = new Map(); const synth = !anchors.length;
      const fFor = i => (vid === 've-MTA-123' && i === 4) ? 0.78 : (vid === 've-BXR-871' && anchors[i] && anchors[i].day >= '2026-10-05' && !anchors.slice(0, i).some(a => a.day >= '2026-10-05')) ? 0.79 : U.between(r, 0.93, 1.06);
      if (!synth) {
        let prev = -1;
        anchors.forEach((a, i) => {
          const j = TD.indexOf(a.day); const span = TD.slice(prev + 1, j + 1).filter(d => d !== G.TODAY);
          a.f = fFor(i); const K = a.gallons * pf.expected_km_per_gal * a.f; let fixed = 0;
          if (a.day === G.TODAY) { a.at = G.TODAY + 'T09:30:00'; fixed = kmUntil(a.at); a.partial = fixed; }
          const ws = span.map(() => U.between(r, 0.8, 1.2)); const sw = U.sum(ws) || 1;
          span.forEach((d, k) => km.set(d, Math.max(15, Math.round((K - fixed) * ws[k] / sw))));
          prev = j;
        });
      }
      for (const d of TD) if (d !== G.TODAY && !km.has(d)) km.set(d, U.int(r, KM[vid][0], KM[vid][1]));
      if (synth) {
        let acc = 0, n = 0;
        TD.forEach(d => { if (d === G.TODAY) return; acc += km.get(d); n++; if (n % 3 === 0 || (vid === 've-MTB-456' && d === TD.filter(x => x !== G.TODAY).pop())) { const f = U.between(r, 0.93, 1.05); anchors.push({ day: d, gallons: R(acc / (pf.expected_km_per_gal * f), 3), price: v.fuel_type === 'DIESEL' ? R(U.between(r, 16.0, 16.6), 2) : R(U.between(r, 17.1, 17.8), 2), f, uid: drv(d), synth: true }); acc = 0; } });
      }
      // días con detalle GPS (08 y 09/10): recorrido ajustado a los km del día
      const posDay = {};
      for (const d of POSDAYS) if (TD.includes(d)) {
        const fd = (vid === 've-MTC-789' && d === '2026-10-08') ? 1.31 : U.between(r, 1.0, 1.03);
        const path = buildPath(site, stopsFor(drv(d), d, site), km.get(d) / fd);
        let pl = 0; for (let i = 1; i < path.length; i++) pl += legKm(path[i - 1].p, path[i].p);
        const nst = path.filter(p => p.stop).length; const avail = (9 * 60 - nst * 5.5) / 60;
        const sim = simulate({ path, start: d + 'T' + TSTART[vid] + ':00', speed: Math.max(11, Math.min(30, pl / Math.max(avail, 1))), until: null, dwellMin: [4, 7], r });
        if (vid === 've-MTA-123' && d === '2026-10-09') { const mv = sim.map((p, i) => [p, i]).filter(([p]) => p.speed > 0); const k0 = mv[Math.floor(mv.length * 0.42)][1]; [84, 87, 91, 89, 86].forEach((s, k) => { if (sim[k0 + k]) sim[k0 + k].speed = s; }); }
        posDay[d] = { sim, gps: kmOf(sim) };
        if (fd > 1.2) km.set(d, Math.round(posDay[d].gps * fd)); // jornada con km de odómetro muy por encima del GPS (RN-FLO-05)
      }
      // línea de tiempo del odómetro
      const total = U.sum([...km.values()]) + todayKm;
      let odo = Math.round((v.odometer_km || 10000) - total);
      const base = { vehicle_id: vid, read_at: '2026-08-31T18:00:00', km: odo, source: 'INITIAL', source_id: null, notes: 'Lectura inicial al activar FLO' };
      allReadings.push(base);
      allLoads.push({ vehicle_id: vid, loaded_at: '2026-08-31T18:10:00', odometer_km: odo, gallons: R(pf.tank_capacity_gal * 0.82, 3), price_per_gal: v.fuel_type === 'DIESEL' ? 16.3 : 17.4, full_tank: true, source: 'BASELINE', station_name: 'Línea base (tanque lleno al activar FLO)', driver_user_id: null, voucher_no: null, expense_id: null });
      odoAt[vid] = [];
      for (const d of TD) {
        const uid = drv(d); const ords = ordBy.get(uid + '|' + d) || []; const dlv = ords.filter(o => ['DELIVERED', 'CLOSED'].includes(o.status)).length;
        const t = { vehicle_id: vid, driver_user_id: uid, driver_employee_id: empOfUser(uid), establishment_id: v.establishment_id, trip_date: d, source: 'APP', start_photo: `tablero/${v.plate}-${d}-ini.jpg`, checklist_start: { lights: true, tires: true, brakes: true, thermal_box: true, documents: true }, route_ref: G.db.find('delivery_routes', x => x.vehicle_id === vid && x.route_date === d) ? G.db.find('delivery_routes', x => x.vehicle_id === vid && x.route_date === d).code : null };
        if (d === G.TODAY) {
          Object.assign(t, { started_at: todaySim[0].t, ended_at: null, odometer_start: odo, status: 'OPEN', deliveries: null, sim: todaySim });
          allTrips.push(t); allReadings.push({ vehicle_id: vid, read_at: t.started_at, km: odo, source: 'TRIP_START', trip: t });
          for (const a of anchors.filter(a => a.day === d)) allLoads.push({ vehicle_id: vid, loaded_at: a.at, odometer_km: odo + Math.round(a.partial), gallons: a.gallons, price_per_gal: a.price, full_tank: true, source: 'APP', driver_user_id: uid, voucher_no: a.voucher || null, station_supplier_id: a.station || null, expense_id: a.expense ? a.expense.id : null, trip: t });
          continue;
        }
        const pd = posDay[d]; const kmd = km.get(d);
        const st = pd ? pd.sim[0].t : d + 'T' + TSTART[vid] + ':00'; const en = pd ? pd.sim[pd.sim.length - 1].t : d + 'T' + U.pad(17 + U.int(r, 0, 1), 2) + ':' + U.pad(U.int(r, 0, 55), 2) + ':00';
        const gps = pd ? R(pd.gps, 1) : R(kmd / U.between(r, 1.0, 1.07), 1);
        Object.assign(t, { started_at: st, ended_at: en, odometer_start: odo, odometer_end: odo + kmd, km_odometer: kmd, km_gps: gps, km_diff_pct: R((kmd - gps) / gps * 100, 1), deliveries: dlv, end_photo: `tablero/${v.plate}-${d}-fin.jpg`, checklist_end: { lights: true, tires: true, brakes: true, thermal_box: true, documents: true }, status: 'CLOSED', sim: pd ? pd.sim : null });
        allTrips.push(t);
        allReadings.push({ vehicle_id: vid, read_at: st, km: odo, source: 'TRIP_START', trip: t }); allReadings.push({ vehicle_id: vid, read_at: en, km: odo + kmd, source: 'TRIP_END', trip: t });
        odo += kmd; odoAt[vid].push({ date: d, end: odo });
        anchors.filter(a => a.day === d).forEach((a, k) => allLoads.push({ vehicle_id: vid, loaded_at: tadd(en, 600 + k * 60), odometer_km: odo, gallons: a.gallons, price_per_gal: a.price, full_tank: !(vid === 've-MTC-789' && anchors.indexOf(a) % 6 === 3), source: r() < 0.7 ? 'APP' : 'WEB', driver_user_id: uid, voucher_no: a.voucher || ('V-' + U.int(r, 30000, 39999)), station_supplier_id: a.station || null, expense_id: a.expense ? a.expense.id : null, trip: t }));
      }
    }
    // inserción en orden cronológico (correlativos coherentes)
    allTrips.sort((a, b) => a.started_at < b.started_at ? -1 : 1);
    for (const t of allTrips) { const sim = t.sim; delete t.sim; const row = ins('vehicle_trips', Object.assign({ number: G.db.next('JR', 'JR-', 6) }, t)); t.row = row; tripOf[t.vehicle_id + '|' + t.trip_date] = row; if (sim) for (const p of sim) allPos.push({ vehicle_id: t.vehicle_id, trip_id: row.id, recorded_at: p.t, lat: p.lat, lng: p.lng, speed_kmh: p.speed, heading: null, accuracy_m: 6 + Math.floor(r() * 9), source: 'APP', received_at: p.t }); }
    for (const p of allPos) ins('vehicle_positions', p);
    allReadings.sort((a, b) => a.read_at < b.read_at ? -1 : 1);
    for (const x of allReadings) ins('vehicle_odometer_readings', { vehicle_id: x.vehicle_id, read_at: x.read_at, km: x.km, source: x.source, source_id: x.trip ? x.trip.row.id : null, notes: x.notes || null, recorded_by: null });
    allLoads.sort((a, b) => a.loaded_at < b.loaded_at ? -1 : 1);
    for (const l of allLoads) {
      const v = veh(l.vehicle_id); const t = l.trip ? l.trip.row : null; delete l.trip;
      const row = ins('fuel_loads', Object.assign({ number: G.db.next('CG', 'CG-', 5), trip_id: t ? t.id : null, employee_id: l.driver_user_id ? empOfUser(l.driver_user_id) : null, amount: R(l.gallons * l.price_per_gal), fuel_type: v.fuel_type, station_name: l.station_name || (l.station_supplier_id ? G.supName(l.station_supplier_id) : (v.establishment_id === 'es-L2' ? 'Grifo Lurín' : 'Grifo Benavides')), photo: l.source === 'BASELINE' ? null : `vales/${l.voucher_no || 'carga'}.jpg`, doc_type: l.expense_id ? 'INVOICE' : null, doc_number: l.expense_id ? ((G.db.get('expenses', l.expense_id) || {}).doc_series || '') + '-' + ((G.db.get('expenses', l.expense_id) || {}).doc_number || '') : null, status: 'ACTIVE', efficiency_status: 'NA', recorded_by: null }, l));
      if (l.source !== 'BASELINE') ins('vehicle_odometer_readings', { vehicle_id: l.vehicle_id, read_at: l.loaded_at, km: l.odometer_km, source: 'FUEL', source_id: row.id, recorded_by: null });
    }
    for (const vid of Object.keys(odoAt)) FLO.recalcEfficiency(vid);
    // velocidades del 09/10 (MTA-123) y temperatura de la furgoneta
    for (const vid of Object.keys(odoAt)) { const v = veh(vid); const last = lastReading(vid); if (last) v.odometer_km = last.km; }
    const van = veh('ve-BXR-871');
    if (van) for (const tr of allTrips.filter(t => t.vehicle_id === van.id)) {
      const row = tr.row; const endAt = row.ended_at || LIVE_AT;
      for (let t = tadd(row.started_at, 120); t <= endAt; t = tadd(t, 300)) {
        const hh = t.slice(11, 16); let c = 2.4 + r() * 1.1 + (r() < 0.12 ? 0.9 : 0);
        if (row.trip_date === '2026-09-17' && hh >= '14:10' && hh <= '14:30') c = 5.2 + r() * 1.2;
        if (row.trip_date === '2026-10-09' && hh >= '10:40' && hh <= '11:00') c = 5.4 + r() * 1.4;
        c = Math.min(c, 3.95 + (c > 4.5 ? 9 : 0));
        ins('vehicle_temperature_readings', { vehicle_id: van.id, trip_id: row.id, read_at: t, temp_c: R(c, 1), in_range: c >= 0 && c <= 4, range_min: 0, range_max: 4, sensor_id: 'TS-BXR-01', source: 'SENSOR' });
      }
    }

    /* --- alertas sembradas desde los datos --- */
    const lowLoads = G.db.where('fuel_loads', f => f.efficiency_status === 'LOW').sort(U.by('loaded_at'));
    for (const f of lowLoads) { const a = applyEfficiencyAlert(f); if (a && f.loaded_at < '2026-10-01') G.db.update('fleet_alerts', a.id, { status: 'CLOSED', ack_by: RAU && RAU.id, ack_at: tadd(f.loaded_at, 3600 * 20), ack_note: 'Se revisó con el conductor: carga en otro grifo y llanta baja', closed_by: RAU && RAU.id, closed_at: tadd(f.loaded_at, 3600 * 48), resolution: 'Se calibró la presión de llantas y se limpió el filtro de aire; la carga siguiente volvió al rango' }, { silent: true }); }
    for (const ex of (van ? FLO.excursions(van.id, '2026-09-01', G.TODAY) : [])) {
      if (!(ex.minutes > num('flo_temp_excursion_minutes', 15))) continue;
      const t = G.db.get('vehicle_trips', ex.trip_id);
      const aff = delivOf(t.driver_user_id, t.trip_date).filter(o => o.status !== 'CANCELLED' && (!o.delivered_at || o.delivered_at >= ex.start.slice(0, 16)));
      const past = ex.start < '2026-10-01';
      const a = FLO.raise({ type: 'TEMPERATURE', vehicle_id: van.id, origin: 'trip:' + t.id, employee_id: t.driver_employee_id, at: ex.end, severity: 'bad', title: `Temperatura fuera de rango ${F.num(ex.minutes)} min · ${van.plate}`, detail: `RN-FLO-14: ${F.num(ex.min, 1)} a ${F.num(ex.max, 1)} °C desde las ${hm(ex.start)} (rango 0 a 4 °C, límite ${num('flo_temp_excursion_minutes', 15)} min). ${aff.length} pedido(s) de la ruta pasan a revisión de calidad.`, extra: { excursion_start: ex.start, excursion_minutes: ex.minutes, max_value: ex.max } }).alert;
      const rv = aff.map((o, i) => ({ order_id: o.id, number: o.number, status: past ? 'RELEASED' : (i < 2 ? 'RELEASED' : 'PENDING'), decided_by: past || i < 2 ? (usr('Silvia Ramos') || {}).id || null : null, decided_at: past || i < 2 ? tadd(ex.end, 5400) : null, note: past || i < 2 ? 'Producto a 3 °C al recibir; cliente conforme' : null }));
      G.db.update('fleet_alerts', a.id, Object.assign({ order_reviews: rv }, past ? { status: 'CLOSED', closed_at: tadd(ex.end, 3600 * 26), closed_by: RAU && RAU.id, resolution: 'Burlete de la puerta trasera cambiado; pedidos revisados y liberados' } : { status: 'ACK', ack_by: RAU && RAU.id, ack_at: tadd(ex.end, 1200), ack_note: 'Se pidió a Hugo no abrir la puerta en cada parada; calidad revisa los pedidos' }), { silent: true });
    }
    const t9 = tripOf['ve-MTA-123|2026-10-09'];
    if (t9) { const ps = positionsOf(t9.id); const fast = ps.filter(p => p.speed_kmh > 80); if (fast.length >= 2) { const a = FLO.raise({ type: 'SPEED', vehicle_id: t9.vehicle_id, origin: 'trip:' + t9.id, employee_id: t9.driver_employee_id, at: fast[fast.length - 1].recorded_at, severity: 'bad', title: `Exceso de velocidad: ${F.num(Math.max(...fast.map(p => p.speed_kmh)))} km/h (${t9.number})`, detail: speedDetail(t9, fast[0].recorded_at, fast[fast.length - 1].recorded_at, Math.max(...fast.map(p => p.speed_kmh)), 80), extra: { episode_start: fast[0].recorded_at, max_value: Math.max(...fast.map(p => p.speed_kmh)) } }).alert; G.db.update('fleet_alerts', a.id, { status: 'ACK', ack_by: RAU && RAU.id, ack_at: '2026-10-09T18:10:00', ack_note: 'Conversado con Pedro: tramo de la Panamericana Sur' }, { silent: true }); } }
    for (const t of G.db.where('vehicle_trips', x => x.status === 'CLOSED' && Math.abs(x.km_diff_pct || 0) > num('flo_km_gps_tolerance_pct', 15))) checkKmDiff(t, t.ended_at);

    /* --- documentos (RN-FLO-13) --- */
    const D = (d) => FLO.saveDocument(d, { seed: true });
    for (const v of G.db.all('vehicles').filter(tracked)) {
      D({ doc_type: 'SOAT', vehicle_id: v.id, number: v.soat_policy_no || 'SOAT-' + v.plate, issuer: v.vehicle_type === 'MOTO' ? 'La Positiva Seguros' : 'Rímac Seguros', issued_on: G.date.add(v.soat_expires_on || G.TODAY, -365), expires_on: v.soat_expires_on || G.date.add(G.TODAY, 200), file_url: `docs/soat-${v.plate}.pdf` });
      if (v.tech_inspection_expires_on) D({ doc_type: 'TECH_INSPECTION', vehicle_id: v.id, number: 'CITV-' + U.pad(U.int(r, 100000, 999999), 6), issuer: 'Revisiones Técnicas del Perú SAC', issued_on: G.date.add(v.tech_inspection_expires_on, -365), expires_on: v.tech_inspection_expires_on, file_url: `docs/rt-${v.plate}.pdf` });
      if (v.ownership === 'OWN') D({ doc_type: 'PROPERTY_CARD', vehicle_id: v.id, number: 'TIVE-' + U.pad(U.int(r, 1000000, 9999999), 7), issuer: 'SUNARP', issued_on: (prof(v.id).purchase_date || '2023-01-01'), expires_on: null, file_url: `docs/tive-${v.plate}.pdf` });
      else D({ doc_type: 'RENTAL_CONTRACT', vehicle_id: v.id, number: 'CA-' + v.plate, issuer: rental ? rental.trade_name : 'Arrendador', issued_on: v.id === 've-BKZ-512' ? '2026-10-01' : '2026-01-02', expires_on: v.id === 've-BKZ-512' ? '2026-10-31' : '2026-12-31', file_url: `docs/contrato-${v.plate}.pdf`, notes: `Tarifa diaria ${F.money(v.rental_daily_rate)}` });
    }
    if (van) D({ doc_type: 'INSURANCE_POLICY', vehicle_id: van.id, number: 'POL-VEH-2026-4471', issuer: 'Rímac Seguros', issued_on: '2026-03-01', expires_on: '2027-02-28', file_url: 'docs/poliza-BXR-871.pdf' });
    for (const [u, n, cls, exp] of [[PED, 'Q40123000', 'B-IIc', '2028-03-15'], [HUG, 'Q40124371', 'A-IIb', '2027-06-20'], [JUL, 'Q40125742', 'B-IIc', '2026-10-22'], [RAU, 'Q40119145', 'A-I', '2029-01-10']]) if (u) D({ doc_type: 'DRIVER_LICENSE', employee_id: u.employee_id, number: n, license_class: cls, issuer: 'MTC', issued_on: G.date.add(exp, -365 * 5), expires_on: exp, file_url: `docs/licencia-${n}.pdf` });

    /* --- planes y órdenes de mantenimiento --- */
    const cur = vid => FLO.currentOdo(vid);
    const odoTs = (vid, ts) => (lastReading(vid, ts) || readingsOf(vid)[0] || { km: cur(vid) }).km;
    const endOn = (vid, d) => odoTs(vid, d + 'T23:59:59');
    const PL = (vid, task, ik, idays, lastKm, lastOn, notes) => G.db.get('vehicles', vid) ? FLO.savePlan({ vehicle_id: vid, task, interval_km: ik, interval_days: idays, last_done_km: lastKm, last_done_on: lastOn, notes }) : null;
    const pMTAoil = PL('ve-MTA-123', 'Cambio de aceite y filtro', 3000, 90, endOn('ve-MTA-123', '2026-08-31') - 600, '2026-06-17');
    PL('ve-MTA-123', 'Kit de arrastre (cadena, piñón y catalina)', 10000, null, cur('ve-MTA-123') - 9620, '2026-02-20');
    PL('ve-MTA-123', 'Pastillas de freno', 6000, 180, cur('ve-MTA-123') - 2600, '2026-07-15');
    PL('ve-MTA-123', 'Llantas delantera y posterior', 12000, null, cur('ve-MTA-123') - 7100, '2026-05-02');
    const pMTBoil = PL('ve-MTB-456', 'Cambio de aceite y filtro', 3000, 90, cur('ve-MTB-456') - 2200, '2026-06-25');
    const pMTBbrk = PL('ve-MTB-456', 'Pastillas de freno', 6000, 180, cur('ve-MTB-456') - 2800, '2026-06-25');
    const pVANoil = PL('ve-BXR-871', 'Cambio de aceite y filtros (5 000 km)', 5000, 120, endOn('ve-BXR-871', '2026-08-31') - 2700, '2026-06-07');
    PL('ve-BXR-871', 'Revisión de frenos y suspensión', 15000, 365, cur('ve-BXR-871') - 14720, '2025-12-12');
    const pVANfrio = PL('ve-BXR-871', 'Mantenimiento del equipo de frío', null, 90, null, '2026-06-22');
    PL('ve-BXR-871', 'Cambio de llantas', 40000, null, cur('ve-BXR-871') - 21000, '2025-11-08');
    PL('ve-MTC-789', 'Revisión del arrendador (aceite y ajustes)', 2500, null, cur('ve-MTC-789') - 1900, '2026-09-20');
    PL('ve-BKZ-512', 'Cambio de aceite y filtro', 5000, 180, 40100, '2026-08-10');
    const taller = sup('su-GAS-TALLER'), frio = (G.db.find('suppliers', s => /FRÍO TOTAL/.test(s.legal_name)) || {}).id || null;
    const MV = (vid, plan, kind, desc, opened, done, wsup, wname, parts, labor, docT, docN, exp, out) => {
      if (!G.db.get('vehicles', vid)) return null;
      const m = FLO.openMaintenance({ vehicle_id: vid, plan_id: plan ? plan.id : null, kind, description: desc, opened_on: opened, workshop_supplier_id: wsup, workshop_name: wname || (wsup ? G.supName(wsup) : null), in_workshop: true }, { seed: true });
      if (!done) return m;
      return FLO.closeMaintenance(m.id, { done_on: done, odometer_km: odoTs(vid, done + 'T17:30:00'), parts: parts.map(([d, q, c]) => ({ description: d, qty: q, unit_cost: c })), labor_amount: labor, days_out_of_service: out, doc_type: docT, doc_number: docN, workshop_supplier_id: wsup, expense_id: exp ? exp.id : null }, { seed: true });
    };
    // el aceite de MTA vencía el 15/09: se hizo el 12/09 (a tiempo)
    if (pMTAoil) G.db.update('vehicle_maintenance_plans', pMTAoil.id, { next_due_on: '2026-09-15', next_due_km: endOn('ve-MTA-123', '2026-09-11') + 180 }, { silent: true });
    MV('ve-MTA-123', pMTAoil, 'PREVENTIVE', 'Cambio de aceite 20W-50 y filtro', '2026-09-12', '2026-09-12', taller, 'Taller Motos Surco', [['Aceite 20W-50 (1 L)', 1, 38], ['Filtro de aceite', 1, 22]], 35, 'RECEIPT', 'B001-3381', null, 0);
    MV('ve-MTB-456', null, 'CORRECTIVE', 'Cambio de pastillas, cadena y aceite (frenado deficiente)', '2026-09-11', '2026-09-11', taller, 'Taller Motos Surco', [['Pastillas de freno delanteras', 1, 65], ['Kit de cadena', 1, 145], ['Aceite 20W-50 (1 L)', 1, 38]], 32, 'INVOICE', 'F001-2207', gasExp('DEL-MANT', 've-MTB-456', '2026-09-11'), 1);
    if (pVANfrio) G.db.update('vehicle_maintenance_plans', pVANfrio.id, { next_due_on: '2026-09-20' }, { silent: true });
    MV('ve-BXR-871', pVANfrio, 'PREVENTIVE', 'Mantenimiento del equipo de frío: limpieza de condensador y carga de gas', '2026-09-19', '2026-09-19', frio, 'Frío Total', [['Gas refrigerante R-404A (kg)', 1.5, 60], ['Filtro deshidratador', 1, 45]], 120, 'INVOICE', 'F002-0918', null, 1);
    if (pVANoil) G.db.update('vehicle_maintenance_plans', pVANoil.id, { next_due_on: '2026-10-05', next_due_km: odoTs('ve-BXR-871', '2026-10-03T17:30:00') + 240 }, { silent: true });
    MV('ve-BXR-871', pVANoil, 'PREVENTIVE', 'Cambio de aceite 15W-40, filtros de aceite, aire y combustible', '2026-10-03', '2026-10-03', null, 'Lubricentro Los Próceres', [['Aceite 15W-40 (1 L)', 6, 32], ['Filtro de aceite', 1, 48], ['Filtro de aire', 1, 65], ['Filtro de combustible', 1, 70]], 60, 'INVOICE', 'F001-11842', null, 0);
    MV('ve-MTA-123', null, 'CORRECTIVE', 'Parchado de llanta y cámara posterior nueva', '2026-10-06', '2026-10-06', taller, 'Taller Motos Surco', [['Cámara 3.00-17', 1, 55]], 90, 'INVOICE', 'F001-2291', gasExp('DEL-MANT', 've-MTA-123', '2026-10-06'), 1);
    if (pMTBoil) G.db.update('vehicle_maintenance_plans', pMTBoil.id, { next_due_on: '2026-09-23' }, { silent: true });
    MV('ve-MTB-456', pMTBoil, 'PREVENTIVE', 'Cambio de aceite vencido por fecha y revisión del embrague', '2026-10-09', null, taller, 'Taller Motos Surco', [], 0, null, null, null, null);
    void pMTBbrk;

    /* --- multas (RN-FLO-15) --- */
    const F1 = FLO.saveFine({ ballot_number: 'SAT-2026-0918-4471', fine_date: '2026-09-18', entity: 'SAT', infraction_code: 'G-40', infraction: 'Estacionar en zona rígida', vehicle_id: 've-BXR-871', driver_user_id: PED.id, amount: 220, notes: 'Conducía Pedro Condori en el reparto de la tarde (apoyo)' }, { seed: true });
    FLO.payFine(F1.id, { paid_on: '2026-09-18', expense_id: (gasExp('DEL-MULTA', 've-BXR-871', '2026-09-18') || {}).id }, { seed: true });
    FLO.saveFine({ ballot_number: 'PNP-T-2026-118205', fine_date: '2026-10-02', entity: 'PNP', infraction_code: 'M-20', infraction: 'Exceso de velocidad en vía urbana', vehicle_id: 've-MTA-123', amount: 462, early_discount_pct: 50, early_discount_until: '2026-10-09' }, { seed: true });
    const F3 = FLO.saveFine({ ballot_number: 'ATU-2026-55210', fine_date: '2026-09-25', entity: 'ATU', infraction_code: 'G-28', infraction: 'No respetar la señal de PARE', vehicle_id: 've-MTC-789', amount: 330, early_discount_pct: 83, early_discount_until: '2026-09-30' }, { seed: true });
    FLO.payFine(F3.id, { paid_on: '2026-10-03' }, { seed: true });
    if (RH) FLO.chargeFineToDriver(F3.id, { acknowledgment_file: 'actas/acta-ATU-2026-55210-firmada.pdf', hr_user_id: RH.id }, { seed: true, at: '2026-10-05T10:20:00' });
    const F4 = FLO.saveFine({ ballot_number: 'MSB-2026-07731', fine_date: '2026-10-05', entity: 'MUNI', infraction_code: 'Ord. 412', infraction: 'Estacionar sobre la vereda (Municipalidad de San Borja)', vehicle_id: 've-MTC-789', amount: 86 }, { seed: true });
    G.db.update('traffic_fines', F4.id, { status: 'APPEALED', appeal_note: 'Descargo presentado: el pedido se entregó con la moto en el estacionamiento del edificio (foto con hora)' }, { silent: true });

    /* --- otros costos --- */
    const C = d => FLO.saveCost(d, { seed: true });
    const rentExp = G.db.where('expenses', e => e.category_id === 'gc-DEL-ALQ' && e.vehicle_id === 've-MTC-789' && !['VOIDED', 'REJECTED'].includes(e.status));
    if (rentExp.length) for (const e of rentExp) C({ vehicle_id: 've-MTC-789', cost_type: 'RENT', cost_date: e.issue_date, period: G.date.addMonths(e.issue_date, -1), amount: e.total, supplier_id: e.supplier_id, doc_type: 'INVOICE', doc_number: [e.doc_series, e.doc_number].filter(Boolean).join('-'), notes: `Alquiler de ${G.date.monthName(G.date.addMonths(e.issue_date, -1))} (tarifa diaria S/ 45)`, expense_id: e.id });
    else for (const d of ['2026-09-02', '2026-10-02']) C({ vehicle_id: 've-MTC-789', cost_type: 'RENT', cost_date: d, period: G.date.addMonths(d, -1), amount: 1380.6, supplier_id: rental && rental.id, doc_type: 'INVOICE', notes: 'Alquiler del mes anterior (26 días × S/ 45 + IGV)' });
    const tolls = G.db.where('expenses', e => e.category_id === 'gc-DEL-PEAJE' && e.vehicle_id === 've-BXR-871' && !['VOIDED', 'REJECTED'].includes(e.status));
    if (tolls.length) for (const e of tolls) C({ vehicle_id: 've-BXR-871', cost_type: 'TOLL', cost_date: e.issue_date, amount: e.total, supplier_id: e.supplier_id, doc_type: 'TICKET', doc_number: [e.doc_series, e.doc_number].filter(Boolean).join('-'), notes: 'Peaje Panamericana Sur (Surco–Lurín)', expense_id: e.id });
    else for (let d = '2026-09-02'; d <= G.TODAY; d = G.date.add(d, 2)) if (dow(d) !== 0) C({ vehicle_id: 've-BXR-871', cost_type: 'TOLL', cost_date: d, amount: 7.5, doc_type: 'TICKET', notes: 'Peaje Panamericana Sur (Surco–Lurín)' });
    for (const m of ['2026-09-01', '2026-10-01']) {
      C({ vehicle_id: 've-BXR-871', cost_type: 'PARKING', cost_date: m, amount: 180, doc_type: 'SIMPLE_RECEIPT', doc_number: 'R-' + m.slice(5, 7), notes: 'Cochera nocturna de la furgoneta (Av. Los Próceres)' });
      C({ vehicle_id: 've-MTA-123', cost_type: 'PARKING', cost_date: m, amount: 60, doc_type: 'SIMPLE_RECEIPT', notes: 'Cochera de motos' });
      C({ vehicle_id: 've-MTB-456', cost_type: 'PARKING', cost_date: m, amount: 60, doc_type: 'SIMPLE_RECEIPT', notes: 'Cochera de motos' });
      C({ vehicle_id: 've-BXR-871', cost_type: 'INSURANCE', cost_date: G.date.add(m, 4), amount: 210, supplier_id: null, doc_type: 'INVOICE', doc_number: 'F750-' + U.int(r, 100000, 999999), notes: 'Seguro vehicular Rímac (cuota mensual)' });
    }
    for (let d = '2026-09-05'; d <= G.TODAY; d = G.date.add(d, 7)) C({ vehicle_id: 've-BXR-871', cost_type: 'WASH', cost_date: d, amount: 35, doc_type: 'RECEIPT', notes: 'Lavado y desinfección de la caja térmica' });
    C({ vehicle_id: 've-MTA-123', cost_type: 'TIRES', cost_date: '2026-09-24', amount: 48, doc_type: 'RECEIPT', notes: 'Válvula y balanceo de llanta posterior' });

    /* --- barrido de alertas al cierre de la siembra --- */
    FLO.scan();
  }, 'flota');

  /* =====================================================================
     Pantallas
     ===================================================================== */
  const S = { site: 'ALL', mode: 'ALL', month: G.date.month(G.TODAY) };
  const siteOpts = () => G.db.all('establishments').map(e => [e.id, e.short || e.name]);
  const MONTHS = () => [[G.date.addMonths(G.TODAY, -1), G.date.monthName(G.date.addMonths(G.TODAY, -1))], [G.date.month(G.TODAY), G.date.monthName(G.TODAY) + ' (al ' + F.date(G.TODAY).slice(0, 5) + ')']];
  const userOpts = () => G.db.where('users', u => u.status === 'ACTIVE').map(u => [u.id, u.name]);
  const expLabel = id => { const e = id && G.db.get('expenses', id); return e ? h('span', null, h('span', { class: 'mono' }, e.number), ' ', G.ui.status(e.status)) : badge('Sin gasto', 'warn'); };
  const vehBadge = vid => { const w = FLO.whyNotOperable(vid); return w.length ? badge('Bloqueado', 'bad') : sb(prof(vid).op_status || 'ACTIVE'); };
  const kmpgTone = (k, vid) => k == null ? '' : k < FLO.lowThreshold(vid) ? 'bad' : k < prof(vid).expected_km_per_gal ? 'warn' : 'ok';
  const fileInput = (label, onPick) => { const i = h('input', { class: 'input', type: 'file', attrs: { accept: 'image/*,application/pdf', 'aria-label': label } }); i.addEventListener('change', () => onPick(i.files && i.files[0] ? i.files[0].name : '')); return i; };
  function liveState(t) {
    if (!t) return 'IDLE';
    if (FLO.silentMinutes(t) > num('flo_gps_silent_minutes', 10)) return 'SILENT';
    const lp = FLO.lastPos(t); return lp && lp.speed_kmh > 0 ? 'MOVING' : 'STOPPED';
  }
  const nextStopOf = t => { const os = delivOf(t.driver_user_id, t.trip_date).filter(o => o.status === 'IN_ROUTE').sort((a, b) => (a.slot_from || '').localeCompare(b.slot_from || '') || a.number.localeCompare(b.number)); const lp = FLO.lastPos(t) || { lat: sitePt(t.establishment_id)[0], lng: sitePt(t.establishment_id)[1] }; let best = null, bd = 1e9; for (const o of os) { const p = orderPt(o); if (!p) continue; const d = G.geo.km([lp.lat, lp.lng], p); if (d < bd) { bd = d; best = o; } } return best ? { o: best, km: R(bd, 1), pending: os.length } : { o: null, km: null, pending: 0 }; };
  const lastTemp = vid => { const l = tempsOfVeh(vid); return l[l.length - 1] || null; };
  const openAlertsOf = vid => G.db.where('fleet_alerts', a => a.vehicle_id === vid && a.status !== 'CLOSED');
  const routeOf = t => { const r = G.db.find('delivery_routes', x => x.vehicle_id === t.vehicle_id && x.route_date === t.trip_date && x.status !== 'CANCELLED'); return r ? r.code : (t.route_ref || `Pedidos de ${G.userShort(t.driver_user_id)} (${delivOf(t.driver_user_id, t.trip_date).length})`); };

  /* ---------- FLO-01 Mapa en vivo ---------- */
  function rFLO01(el) {
    const body = page(el, { code: 'FLO-01', title: 'Mapa en vivo', sub: `Vehículos en jornada con su última posición, velocidad, ruta, próxima parada, temperatura y alertas. La app envía la posición cada ${num('flo_gps_interval_seconds', 30)} s (RN-FLO-01); sin señal por más de ${num('flo_gps_silent_minutes', 10)} min se alerta (RN-FLO-18). Hora de la demo: ${hm(FLO.clock())}.`, actions: [{ label: 'Revisar alertas ahora', icon: '⟳', onClick: () => run(() => FLO.scan(), r => `Barrido hecho: ${r.length} alerta(s) vigentes`) }, { label: 'App del conductor', kind: 'primary', onClick: () => G.go('FLO-15') }] });
    if (!G.can('flo.live.view') && !['AUDITOR'].includes(G.ctx.role)) { body.appendChild(notice('Ver el mapa en vivo y los recorridos exige el permiso flo.live.view (coordinador de delivery o gerencia).', 'warn')); }
    body.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' }, pills([['ALL', 'Todos los locales'], ...siteOpts()], S.site, v => { S.site = v; G.refresh(); }), pills([['ALL', 'Todas las modalidades'], ['OWN', 'Propios'], ['RENTED', 'Alquilados']], S.mode, v => { S.mode = v; G.refresh(); })));
    const vs = scopedFleet().filter(v => (S.site === 'ALL' || v.establishment_id === S.site) && (S.mode === 'ALL' || v.ownership === S.mode));
    const rows = vs.map(v => { const t = FLO.openTrip(v.id); return { v, t, st: t ? liveState(t) : (FLO.whyNotOperable(v.id).length ? 'BLOCKED' : 'IDLE'), lp: t ? FLO.lastPos(t) : null, ns: t ? nextStopOf(t) : null, temp: v.refrigerated ? lastTemp(v.id) : null, al: openAlertsOf(v.id) }; });
    const inTrip = rows.filter(x => x.t);
    body.appendChild(kpis([
      { label: 'En jornada', value: inTrip.length, sub: `de ${rows.length} vehículos rastreados (D-FLO-04)` },
      { label: 'Km GPS de hoy', value: F.num(U.sum(inTrip, x => FLO.gpsKm(positionsOf(x.t.id))), 1) + ' km' },
      { label: 'GPS silencioso', value: rows.filter(x => x.st === 'SILENT').length, tone: rows.some(x => x.st === 'SILENT') ? 'warn' : 'ok', onClick: () => G.go('FLO-14') },
      { label: 'Bloqueados (RN-FLO-11)', value: rows.filter(x => x.st === 'BLOCKED').length, tone: rows.some(x => x.st === 'BLOCKED') ? 'bad' : 'ok', onClick: () => G.go('FLO-09') },
      { label: 'Alertas abiertas', value: U.sum(rows, x => x.al.length), tone: rows.some(x => x.al.some(a => a.severity === 'bad')) ? 'bad' : '', onClick: () => G.go('FLO-14') },
    ]));
    const tone = { MOVING: 'ok', STOPPED: 'info', SILENT: 'warn' };
    const points = [], routes = [];
    for (const x of inTrip) {
      const ps = positionsOf(x.t.id); if (ps.length > 1) routes.push({ points: ps.filter((p, i) => i % 6 === 0 || i === ps.length - 1).map(p => [p.lat, p.lng]), tone: x.st === 'SILENT' ? 'warn' : 'info' });
      if (x.lp) points.push({ lat: x.lp.lat, lng: x.lp.lng, label: code(x.v.id).replace(/^(\w)\w+-0?/, '$1'), r: 10, tone: x.al.some(a => a.severity === 'bad' && ['TEMPERATURE', 'SPEED'].includes(a.alert_type)) ? 'bad' : tone[x.st], title: `${vLabel(x.v.id)} · ${G.userName(x.t.driver_user_id)} · ${hm(x.lp.recorded_at)} · ${F.num(x.lp.speed_kmh)} km/h`, onClick: () => liveDrawer(x.v.id) });
      if (x.ns && x.ns.o) { const p = orderPt(x.ns.o); if (p) points.push({ lat: p[0], lng: p[1], r: 4, tone: 'muted', title: `Próxima parada de ${code(x.v.id)}: ${x.ns.o.number}` }); }
    }
    const g = h('div', { class: 'grid side-r' });
    g.appendChild(card('Posiciones de hoy', G.ui.map({ points, routes, height: 380, legend: 'Verde: en movimiento · azul: detenido · ámbar: GPS silencioso · rojo: alerta de temperatura o velocidad. Cuadros: locales.' })));
    g.appendChild(card('Sin jornada abierta', h('div', { class: 'stack' }, rows.filter(x => !x.t).length ? rows.filter(x => !x.t).map(x => { const w = FLO.whyNotOperable(x.v.id); return h('div', { class: 'stack', style: 'gap:2px;padding:6px 0;border-bottom:1px solid var(--line)' }, h('div', { class: 'row between' }, h('b', null, vLabel(x.v.id)), w.length ? badge('Bloqueado', 'bad') : badge('Disponible', 'ok')), h('div', { class: 'small muted' }, w.length ? w.map(z => z.msg).join(' ') : `${VTYPE[x.v.vehicle_type]} ${OWN[x.v.ownership].toLowerCase()} · ${G.siteName(x.v.establishment_id)}`)); }) : G.ui.empty('Todos los vehículos operables están en jornada.'))));
    body.appendChild(g);
    body.appendChild(table({ id: 'flo01', columns: [
      { key: 'v', label: 'Vehículo', value: x => vLabel(x.v.id) }, { key: 'd', label: 'Conductor', value: x => x.t ? G.userShort(x.t.driver_user_id) : '—' }, { key: 'm', label: 'Modalidad', value: x => OWN[x.v.ownership] },
      { key: 'lp', label: 'Última posición', value: x => x.lp ? x.lp.recorded_at : '', render: x => x.lp ? `${hm(x.lp.recorded_at)} · hace ${F.num(FLO.silentMinutes(x.t))} min` : '—' },
      { key: 'sp', label: 'Velocidad', align: 'r', value: x => x.lp ? x.lp.speed_kmh : null, render: x => x.lp ? F.num(x.lp.speed_kmh) + ' km/h' : '—' },
      { key: 'r', label: 'Ruta asignada', value: x => x.t ? routeOf(x.t) : '—' },
      { key: 'ns', label: 'Próxima parada', value: x => x.ns && x.ns.o ? `${x.ns.o.number} · ${G.zoneName(x.ns.o.zone_id)} (${F.num(x.ns.km, 1)} km)` : x.t ? 'Sin pendientes' : '—' },
      { key: 'dl', label: 'Entregas', align: 'r', value: x => x.t ? `${FLO.deliveriesOf(x.t)} / ${delivOf(x.t.driver_user_id, x.t.trip_date).filter(o => o.status !== 'CANCELLED').length}` : '—' },
      { key: 'tp', label: 'Temperatura', value: x => x.temp ? x.temp.temp_c : null, render: x => x.temp ? badge(F.num(x.temp.temp_c, 1) + ' °C', x.temp.in_range ? 'ok' : 'bad') : '—' },
      { key: 'al', label: 'Alertas', align: 'r', value: x => x.al.length, render: x => x.al.length ? badge(String(x.al.length), x.al.some(a => a.severity === 'bad') ? 'bad' : 'warn') : '—' },
      { key: 'st', label: 'Estado', value: x => x.st, render: x => sb(x.st) }],
      rows, filters: [{ key: 'st', label: 'Estado', options: [['MOVING', 'En movimiento'], ['STOPPED', 'Detenido'], ['SILENT', 'GPS silencioso'], ['BLOCKED', 'Bloqueado'], ['IDLE', 'Sin jornada']], value: x => x.st }],
      onRow: x => liveDrawer(x.v.id) }));
  }
  function liveDrawer(vid) {
    const v = veh(vid); const t = FLO.openTrip(vid);
    drawer(`${vLabel(vid)} en vivo`, b => {
      if (!t) { b.appendChild(notice('Sin jornada abierta: fuera de la jornada no se rastrea (RN-FLO-02).', 'info')); }
      else {
        const lp = FLO.lastPos(t); const ns = nextStopOf(t); const tp = v.refrigerated ? lastTemp(vid) : null;
        b.appendChild(dl([['Jornada', `${t.number} · desde ${hm(t.started_at)}`], ['Conductor', G.userName(t.driver_user_id)], ['Odómetro inicial', F.num(t.odometer_start) + ' km'], ['Km GPS hasta ahora', F.num(FLO.gpsKm(positionsOf(t.id)), 1) + ' km'], ['Última posición', lp ? `${F.datetime(lp.recorded_at)} · ${F.num(lp.lat, 5)}, ${F.num(lp.lng, 5)} · ${F.num(lp.speed_kmh)} km/h · precisión ${lp.accuracy_m} m` : '—'], ['Estado', sb(liveState(t))], ['Ruta', routeOf(t)], ['Próxima parada', ns.o ? `${ns.o.number} · ${G.custName(ns.o.customer_id)} · ${G.zoneName(ns.o.zone_id)} · a ${F.num(ns.km, 1)} km (${ns.pending} pendientes)` : 'Sin pendientes'], ['Entregas hechas', FLO.deliveriesOf(t)], v.refrigerated ? ['Temperatura', tp ? `${F.num(tp.temp_c, 1)} °C a las ${hm(tp.read_at)} (rango ${FLO.tempRange(vid).min} a ${FLO.tempRange(vid).max} °C)` : 'Sin lecturas'] : null, ['Posiciones recibidas', F.num(positionsOf(t.id).length)]]));
      }
      const al = openAlertsOf(vid);
      if (al.length) b.appendChild(card('Alertas abiertas', h('div', { class: 'stack' }, al.map(a => h('div', null, sb(a.status), ' ', h('b', null, alertName(a.alert_type) + ': '), a.title)))));
      b.appendChild(h('div', { class: 'row' }, btn('Recorrido', () => G.go('FLO-02', { vid, date: G.TODAY }), { sm: true }), btn('Ficha', () => G.go('FLO-04', { id: vid }), { sm: true }), v.refrigerated ? btn('Temperatura', () => G.go('FLO-13', { vid, date: G.TODAY }), { sm: true }) : null));
    }, { code: 'FLO-01' });
  }

  /* ---------- FLO-02 Recorrido histórico ---------- */
  function stopsOfTrip(t) {
    const ps = positionsOf(t.id); const out = []; let s = null;
    const pts = delivOf(t.driver_user_id, t.trip_date).map(o => ({ o, p: orderPt(o) })).filter(x => x.p);
    for (const p of ps) {
      if (p.speed_kmh <= 1) { if (!s) s = { from: p.recorded_at, to: p.recorded_at, lat: p.lat, lng: p.lng }; else s.to = p.recorded_at; }
      else if (s) { out.push(s); s = null; }
    }
    if (s) out.push(s);
    return out.map(x => { x.minutes = R(mins(x.from, x.to) + 0.5, 0); let best = null, bd = 0.35; for (const y of pts) { const d = G.geo.km([x.lat, x.lng], y.p); if (d < bd) { bd = d; best = y.o; } } x.order = best; const site = sitePt(t.establishment_id); x.atSite = G.geo.km([x.lat, x.lng], site) < 0.3; x.kind = best ? 'Entrega' : x.atSite ? 'Local' : 'Detención'; return x; }).filter(x => x.minutes >= 2);
  }
  function rFLO02(el, params) {
    const st = S.rv = Object.assign(S.rv || { vid: 've-MTA-123', date: '2026-10-09', idx: null }, params.vid ? { vid: params.vid, date: params.date || G.TODAY, idx: null } : {});
    const body = page(el, { code: 'FLO-02', title: 'Recorrido histórico', sub: 'Reproduce el recorrido de un vehículo en una fecha con sus paradas, detenciones y velocidad. Las posiciones son de solo inserción (RN-FLO-03); en los datos de ejemplo hay detalle del 08, 09 y 10/10.' });
    const sel = h('select', { class: 'input', style: 'max-width:280px', attrs: { 'aria-label': 'Vehículo' } }, fleet().map(v => h('option', { value: v.id, selected: v.id === st.vid }, vLabel(v.id))));
    const dt = h('input', { class: 'input', type: 'date', value: st.date, style: 'max-width:170px', attrs: { 'aria-label': 'Fecha' } });
    sel.addEventListener('change', () => { st.vid = sel.value; st.idx = null; G.refresh(); }); dt.addEventListener('change', () => { st.date = dt.value; st.idx = null; G.refresh(); });
    const withPos = [...new Set(G.db.where('vehicle_trips', t => t.vehicle_id === st.vid && positionsOf(t.id).length).map(t => t.trip_date))].sort().reverse();
    body.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap' }, sel, dt, withPos.length ? h('span', { class: 'small muted' }, 'Fechas con detalle: ', ...withPos.slice(0, 6).map(d => btn(F.date(d).slice(0, 5), () => { st.date = d; st.idx = null; G.refresh(); }, { sm: true, kind: d === st.date ? 'primary' : 'ghost' }))) : null));
    const t = G.db.find('vehicle_trips', x => x.vehicle_id === st.vid && x.trip_date === st.date && ['OPEN', 'CLOSED'].includes(x.status));
    if (!t) { body.appendChild(G.ui.empty(`${vLabel(st.vid)} no tuvo jornada el ${F.date(st.date)}.`)); return; }
    const ps = positionsOf(t.id);
    if (!ps.length) { body.appendChild(notice(`La jornada ${t.number} existe (${F.num(t.km_odometer)} km por odómetro, ${F.num(t.km_gps, 1)} km GPS resumidos) pero sus posiciones detalladas no están en los datos de ejemplo. Elige una fecha con detalle.`, 'info')); return; }
    const stops = stopsOfTrip(t); const lim = num('flo_speed_limit_kmh', 80);
    const over = ps.filter(p => p.speed_kmh > lim);
    const moving = ps.filter(p => p.speed_kmh > 0);
    body.appendChild(kpis([{ label: 'Km GPS', value: F.num(FLO.gpsKm(ps), 1) + ' km', sub: t.km_odometer != null ? `odómetro ${F.num(t.km_odometer)} km (${F.pct(t.km_diff_pct)})` : 'jornada abierta' }, { label: 'Duración', value: `${hm(ps[0].recorded_at)} – ${hm(ps[ps.length - 1].recorded_at)}`, sub: `${F.num(mins(ps[0].recorded_at, ps[ps.length - 1].recorded_at) / 60, 1)} h` }, { label: 'Paradas de entrega', value: stops.filter(s => s.kind === 'Entrega').length, sub: `${stops.filter(s => s.kind === 'Detención').length} detenciones sin pedido` }, { label: 'Velocidad promedio en movimiento', value: F.num(moving.length ? U.sum(moving, p => p.speed_kmh) / moving.length : 0, 1) + ' km/h', sub: `máx. ${F.num(Math.max(0, ...ps.map(p => p.speed_kmh)))} km/h` }, { label: `Tiempo sobre ${lim} km/h`, value: F.num(over.length * 0.5, 1) + ' min', tone: over.length >= 2 ? 'bad' : 'ok', sub: 'RN-FLO-19' }]));
    if (st.idx == null || st.idx >= ps.length) st.idx = ps.length - 1;
    const box = h('div');
    const slider = h('input', { type: 'range', class: 'input', attrs: { min: 0, max: ps.length - 1, value: st.idx, 'aria-label': 'Momento del recorrido' }, style: 'width:100%' });
    const info = h('div', { class: 'small' });
    const draw = () => {
      const i = Number(st.idx); const p = ps[i];
      G.ui.clear(box);
      const pts = stops.map((s, k) => ({ lat: s.lat, lng: s.lng, label: s.kind === 'Entrega' ? k + 1 : null, r: s.kind === 'Entrega' ? 8 : 5, tone: s.kind === 'Entrega' ? 'info' : 'muted', title: `${s.kind} ${hm(s.from)}–${hm(s.to)} (${s.minutes} min)${s.order ? ' · ' + s.order.number : ''}` }));
      pts.push({ lat: p.lat, lng: p.lng, label: '●', r: 9, tone: p.speed_kmh > lim ? 'bad' : 'ok', title: `${hm(p.recorded_at)} · ${F.num(p.speed_kmh)} km/h` });
      box.appendChild(G.ui.map({ points: pts, routes: [{ points: ps.filter((x, k) => k % 4 === 0).map(x => [x.lat, x.lng]), tone: 'info' }, { points: ps.slice(0, i + 1).filter((x, k) => k % 3 === 0 || k === i).map(x => [x.lat, x.lng]), tone: 'ok' }], height: 360, legend: 'Azul: recorrido completo · verde: recorrido hasta el momento elegido · números: paradas de entrega.' }));
      G.ui.clear(info).append(h('b', null, F.datetime(p.recorded_at)), ` · ${F.num(p.speed_kmh)} km/h · ${F.num(FLO.gpsKm(ps.slice(0, i + 1)), 1)} km recorridos · posición ${i + 1} de ${ps.length}`);
    };
    slider.addEventListener('input', () => { st.idx = Number(slider.value); draw(); });
    let timer = null;
    const play = btn('Reproducir', () => {
      if (timer) { clearInterval(timer); timer = null; play.textContent = 'Reproducir'; return; }
      if (st.idx >= ps.length - 1) st.idx = 0; play.textContent = 'Pausa';
      timer = setInterval(() => { if (!box.isConnected) { clearInterval(timer); return; } st.idx = Math.min(ps.length - 1, st.idx + 8); slider.value = st.idx; draw(); if (st.idx >= ps.length - 1) { clearInterval(timer); timer = null; play.textContent = 'Reproducir'; } }, 120);
    }, { kind: 'primary', sm: true });
    body.appendChild(card(`${t.number} · ${vLabel(t.vehicle_id)} · ${G.userName(t.driver_user_id)}`, h('div', { class: 'stack' }, box, h('div', { class: 'row' }, play, slider), info)));
    draw();
    const buckets = []; for (let k = 0; k < ps.length; k += 30) { const sl = ps.slice(k, k + 30); buckets.push({ l: hm(sl[0].recorded_at), v: R(Math.max(...sl.map(p => p.speed_kmh)), 0) }); }
    const g = h('div', { class: 'grid c2' });
    g.appendChild(card('Velocidad máxima cada 15 min', G.ui.chart.line({ labels: buckets.map(b => b.l), series: [{ name: 'km/h', values: buckets.map(b => b.v) }], ref: lim, format: v => F.num(v) + ' km/h' })));
    g.appendChild(card('Paradas y detenciones', table({ id: 'flo02-st', search: false, pageSize: 12, columns: [{ key: 'from', label: 'Desde', render: s => hm(s.from) }, { key: 'to', label: 'Hasta', render: s => hm(s.to) }, { key: 'minutes', label: 'Min', align: 'r' }, { key: 'kind', label: 'Tipo', render: s => badge(s.kind, s.kind === 'Entrega' ? 'info' : s.kind === 'Local' ? '' : 'warn') }, { key: 'o', label: 'Pedido', value: s => s.order ? `${s.order.number} · ${G.custName(s.order.customer_id)}` : '—' }], rows: stops, onRow: s => { st.idx = ps.findIndex(p => p.recorded_at === s.from); slider.value = st.idx; draw(); } }), { flush: true }));
    body.appendChild(g);
  }

  /* ---------- FLO-03 Jornadas y km reales ---------- */
  function rFLO03(el, params) {
    const body = page(el, { code: 'FLO-03', title: 'Jornadas y km reales', sub: `Por vehículo y día: odómetro inicial y final, km reales (final − inicial), km por GPS, entregas y km por entrega. Si odómetro y GPS difieren más de ${num('flo_km_gps_tolerance_pct', 15)} % se alerta (RN-FLO-05).` });
    const mpills = pills(MONTHS(), S.month, v => { S.month = v; G.refresh(); }); body.appendChild(mpills);
    const from = S.month, to = monthEnd(from);
    const rows = G.db.where('vehicle_trips', t => t.trip_date >= from && t.trip_date <= to && t.status !== 'CANCELLED').filter(vOk).sort((a, b) => b.trip_date.localeCompare(a.trip_date) || code(a.vehicle_id).localeCompare(code(b.vehicle_id)));
    const closed = rows.filter(t => t.status === 'CLOSED'); const k1 = G.kpi('KPI-FLO-01', { from, to: to > G.TODAY ? G.TODAY : to }) || {};
    const tol = num('flo_km_gps_tolerance_pct', 15);
    body.appendChild(kpis([{ label: 'Jornadas', value: rows.length, sub: `${rows.filter(t => t.status === 'OPEN').length} abiertas` }, { label: 'Km reales', value: F.num(U.sum(closed, t => t.km_odometer)) + ' km' }, { label: 'Entregas', value: F.num(U.sum(closed, t => t.deliveries)) }, { label: 'KPI-FLO-01 · Km por entrega', value: F.num(k1.value, 2), sub: 'reemplaza a KPI-DEL-09 con FLO activo' }, { label: `Diferencia > ${tol} %`, value: closed.filter(t => Math.abs(t.km_diff_pct || 0) > tol).length, tone: closed.some(t => Math.abs(t.km_diff_pct || 0) > tol) ? 'warn' : 'ok' }]));
    const days = []; for (let d = from; d <= (to > G.TODAY ? G.TODAY : to); d = G.date.add(d, 1)) if (dow(d) !== 0) days.push(d);
    const vs = scopedFleet().filter(v => rows.some(t => t.vehicle_id === v.id));
    body.appendChild(card('Km reales por día', G.ui.chart.bar({ labels: days.map(d => d.slice(8, 10)), series: vs.map(v => ({ name: code(v.id), values: days.map(d => { const t = closed.find(x => x.vehicle_id === v.id && x.trip_date === d); return t ? t.km_odometer : 0; }) })), stacked: true, format: v => F.num(v) + ' km' })));
    body.appendChild(table({ id: 'flo03', columns: [
      { key: 'trip_date', label: 'Fecha', render: t => F.date(t.trip_date) }, { key: 'number', label: 'Jornada', mono: true }, { key: 'v', label: 'Vehículo', value: t => vLabel(t.vehicle_id) }, { key: 'd', label: 'Conductor', value: t => G.userShort(t.driver_user_id) },
      { key: 'h', label: 'Horario', value: t => `${hm(t.started_at)}–${hm(t.ended_at)}` }, { key: 'odometer_start', label: 'Odóm. inicial', align: 'r', render: t => F.num(t.odometer_start) }, { key: 'odometer_end', label: 'Odóm. final', align: 'r', render: t => F.num(t.odometer_end) },
      { key: 'km_odometer', label: 'Km odómetro', align: 'r', render: t => F.num(t.km_odometer) }, { key: 'km_gps', label: 'Km GPS', align: 'r', render: t => t.status === 'OPEN' ? F.num(FLO.gpsKm(positionsOf(t.id)), 1) + '…' : F.num(t.km_gps, 1) },
      { key: 'km_diff_pct', label: 'Dif.', align: 'r', render: t => t.km_diff_pct == null ? '—' : badge(F.pct(t.km_diff_pct), Math.abs(t.km_diff_pct) > tol ? 'bad' : 'ok') },
      { key: 'deliveries', label: 'Entregas', align: 'r', render: t => t.status === 'OPEN' ? FLO.deliveriesOf(t) + '…' : F.num(t.deliveries) }, { key: 'kpe', label: 'Km/entrega', align: 'r', value: t => t.deliveries ? R(t.km_odometer / t.deliveries, 2) : null, render: t => t.deliveries ? F.num(t.km_odometer / t.deliveries, 2) : '—' },
      { key: 'status', label: 'Estado', render: t => sb(t.status) }],
      rows, filters: [{ key: 'vehicle_id', label: 'Vehículo', options: vs.map(v => [v.id, vLabel(v.id)]) }, { key: 'driver_user_id', label: 'Conductor', options: driverOpts() }, { key: 'status', label: 'Estado', options: [['OPEN', 'Abierta'], ['CLOSED', 'Cerrada'], ['PLANNED', 'Programada']] }, { key: 'dif', label: 'Diferencia', options: [['SI', `> ${tol} %`], ['NO', 'Dentro de tolerancia']], value: t => Math.abs(t.km_diff_pct || 0) > tol ? 'SI' : 'NO' }],
      onRow: t => tripDrawer(t.id) }));
    if (params.id) setTimeout(() => tripDrawer(params.id), 0);
  }
  function tripDrawer(id) {
    const t = G.db.get('vehicle_trips', id); if (!t) return;
    drawer(`Jornada ${t.number}`, (b, close) => {
      const v = veh(t.vehicle_id);
      b.appendChild(dl([['Vehículo', vLabel(t.vehicle_id)], ['Conductor', G.userName(t.driver_user_id)], ['Fecha', F.date(t.trip_date)], ['Inicio', `${F.datetime(t.started_at)} · ${F.num(t.odometer_start)} km · foto ${t.start_photo || '—'}`], ['Cierre', t.ended_at ? `${F.datetime(t.ended_at)} · ${F.num(t.odometer_end)} km · foto ${t.end_photo || '—'}` : 'Abierta'], ['Km por odómetro', F.num(t.km_odometer)], ['Km por GPS', t.status === 'OPEN' ? F.num(FLO.gpsKm(positionsOf(t.id)), 1) + ' (en curso)' : F.num(t.km_gps, 1)], ['Diferencia', t.km_diff_pct == null ? '—' : F.pct(t.km_diff_pct)], ['Entregas', t.status === 'OPEN' ? FLO.deliveriesOf(t) : t.deliveries], ['Ruta', routeOf(t)], ['Posiciones', F.num(positionsOf(t.id).length)], ['Observaciones', [t.notes, t.end_notes].filter(Boolean).join(' · ')], ['Estado', sb(t.status)]]));
      const items = checkItems(v || {});
      b.appendChild(card('Checklist', table({ id: 'flo03-ch', search: false, columns: [{ key: 'l', label: 'Punto' }, { key: 's', label: 'Inicio', render: x => x.s === undefined ? '—' : x.s ? badge('Conforme', 'ok') : badge('Observado', 'bad') }, { key: 'e', label: 'Cierre', render: x => x.e === undefined ? '—' : x.e ? badge('Conforme', 'ok') : badge('Observado', 'bad') }], rows: items.map(([k, l]) => ({ l, s: (t.checklist_start || {})[k], e: (t.checklist_end || {})[k] })) }), { flush: true }));
      const rd = G.db.where('vehicle_odometer_readings', x => x.vehicle_id === t.vehicle_id && x.read_at >= (t.started_at || '') && x.read_at <= (t.ended_at || '9999')).sort(U.by('read_at'));
      b.appendChild(card('Lecturas de odómetro de la jornada', h('div', { class: 'timeline' }, rd.map(x => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, hm(x.read_at)), h('span', { class: 'dot' }), h('span', null, `${F.num(x.km)} km · ${srcName(x.source)}`))))));
      const al = G.db.where('fleet_alerts', a => a.origin === 'trip:' + t.id);
      if (al.length) b.appendChild(card('Alertas de la jornada', h('div', { class: 'stack' }, al.map(a => h('div', null, sb(a.status), ' ', a.title)))));
      const row = h('div', { class: 'row' });
      if (positionsOf(t.id).length) row.appendChild(btn('Ver recorrido', () => { close(); G.go('FLO-02', { vid: t.vehicle_id, date: t.trip_date }); }, { sm: true }));
      if (t.status === 'OPEN' && (G.can('flo.live.view') || G.can('flo.trip.operate'))) row.appendChild(btn('Cerrar jornada', () => closeTripModal(t, () => { close(); G.refresh(); }), { sm: true, kind: 'primary' }));
      b.appendChild(row);
    }, { code: 'FLO-03', wide: true });
  }
  function closeTripModal(t, done) {
    const v = veh(t.vehicle_id); const sug = Math.round(t.odometer_start + FLO.gpsKm(positionsOf(t.id)) * 1.04);
    modal(`Cerrar ${t.number} · ${v.plate}`, (b, close) => {
      const st = { photo: '' };
      b.appendChild(form({ id: 'flo-close', values: { odometer: Math.max(sug, FLO.currentOdo(t.vehicle_id)) }, fields: [{ key: 'odometer', label: 'Odómetro final (km)', type: 'number', required: true, help: `Inicial ${F.num(t.odometer_start)} km · GPS ${F.num(FLO.gpsKm(positionsOf(t.id)), 1)} km` }, { key: 'notes', label: 'Observaciones', type: 'textarea' }],
        submitLabel: 'Cerrar jornada', onCancel: close, onSubmit: vals => { const r = FLO.endTrip(t.id, { odometer: vals.odometer, photo: st.photo || `tablero/${v.plate}-${t.trip_date}-fin.jpg`, notes: vals.notes, checklist: { lights: true, tires: true, brakes: true, thermal_box: true, documents: true } }); close(); toast(`Jornada cerrada: ${F.num(r.km_odometer)} km reales, ${F.num(r.km_gps, 1)} km GPS (${F.pct(r.km_diff_pct)})`, Math.abs(r.km_diff_pct || 0) > num('flo_km_gps_tolerance_pct', 15) ? 'warn' : 'ok'); done && done(); return true; } }));
      b.appendChild(h('label', { class: 'small' }, 'Foto del tablero'), fileInput('Foto del tablero', n => { st.photo = n; }));
    });
  }

  /* ---------- FLO-04 Ficha del vehículo ---------- */
  function rFLO04(el, params) {
    const all = scopedFleet(); const vid = params.id && veh(params.id) ? params.id : (S.v4 && veh(S.v4) ? S.v4 : (all[0] || {}).id); S.v4 = vid;
    const v = veh(vid);
    const body = page(el, { code: 'FLO-04', title: 'Ficha del vehículo', sub: 'Marca, modelo, año, combustible, tanque, rendimiento esperado, rango de temperatura, GPS o sensor, odómetro actual, modalidad y proveedor; con su historial de jornadas, cargas, mantenimientos, documentos, multas y costos.', actions: [{ label: 'Nuevo vehículo', icon: '+', onClick: () => G.require('flo.maintenance.manage', () => vehicleDrawer(null)) }].concat(v ? [{ label: 'Editar ficha', onClick: () => G.require('flo.maintenance.manage', () => vehicleDrawer(v)) }, { label: 'Asignar a ruta', kind: 'primary', onClick: () => assignModal(v) }] : []) });
    const sel = h('select', { class: 'input', style: 'max-width:360px', attrs: { 'aria-label': 'Vehículo' } }, all.map(x => h('option', { value: x.id, selected: x.id === vid }, `${vLabel(x.id)} · ${VTYPE[x.vehicle_type]}`)));
    sel.addEventListener('change', () => G.go('FLO-04', { id: sel.value }));
    body.appendChild(h('div', { class: 'row' }, sel));
    if (!v) { body.appendChild(G.ui.empty('No hay vehículos propios ni alquilados.')); return; }
    const p = prof(vid); const w = FLO.whyNotOperable(vid);
    body.appendChild(w.length ? notice([h('b', null, 'RN-FLO-11: '), w.map(x => x.msg).join(' '), ' No se asigna a rutas ni abre jornada.'], 'bad') : notice(`${v.plate} está operable hoy.`, 'ok'));
    const m = FLO.monthlyCost(vid, G.date.month(G.TODAY));
    const lf = loadsOf(vid).filter(f => f.km_per_gal != null); const lastK = lf[lf.length - 1];
    body.appendChild(kpis([{ label: 'Odómetro actual', value: F.num(FLO.currentOdo(vid)) + ' km' }, { label: 'Rendimiento última carga llena', value: lastK ? F.num(lastK.km_per_gal, 1) + ' km/gal' : '—', sub: `esperado ${F.num(p.expected_km_per_gal)} km/gal`, tone: lastK ? kmpgTone(lastK.km_per_gal, vid) : '' }, { label: 'Km del mes', value: F.num(m.km) + ' km', sub: `${m.days} jornadas · ${m.deliveries} entregas` }, G.can('flo.cost.view') ? { label: 'Costo por km del mes', value: m.per_km != null ? F.money(m.per_km) : '—', sub: `total ${F.money(m.total)}`, onClick: () => G.go('FLO-12') } : null, { label: 'Alertas abiertas', value: openAlertsOf(vid).length, tone: openAlertsOf(vid).length ? 'warn' : 'ok', onClick: () => G.go('FLO-14') }].filter(Boolean)));
    const g = h('div', { class: 'grid c2' });
    const rg = FLO.tempRange(vid);
    g.appendChild(card('Datos técnicos', dl([['Código interno', p.internal_code], ['Placa', v.plate], ['Tipo', VTYPE[v.vehicle_type] || v.vehicle_type], ['Marca y modelo', `${p.make || ''} ${p.model || ''}`.trim()], ['Año y color', [p.year, p.color].filter(Boolean).join(' · ')], ['Combustible', { GASOLINE: 'Gasohol', DIESEL: 'Diésel', GLP: 'GLP', GNV: 'GNV' }[v.fuel_type] || v.fuel_type], ['Capacidad del tanque', F.num(p.tank_capacity_gal, 2) + ' gal'], ['Rendimiento esperado', F.num(p.expected_km_per_gal) + ' km/gal'], ['Capacidad de carga', F.num(v.capacity_kg) + ' kg'], ['Refrigerado', v.refrigerated ? `Sí · ${rg ? (rg.min ?? '—') + ' a ' + rg.max + ' °C' : ''}` : 'No (D-FLO-01)'], ['GPS', p.gps_device_id || 'App Android (D-FLO-02)'], ['Sensor de temperatura', p.temp_sensor_id], ['Estado operativo', vehBadge(vid)]])));
    g.appendChild(card('Modalidad y valor', dl([['Modalidad', OWN[v.ownership]], ['Proveedor', v.provider_id ? G.supName(v.provider_id) : null], ['Tarifa diaria de alquiler', v.rental_daily_rate ? F.money(v.rental_daily_rate) : null], ['Local', G.siteName(v.establishment_id)], ['Compra', p.purchase_cost ? `${F.date(p.purchase_date)} · ${F.money(p.purchase_cost)}` : null], ['Vida útil y residual', p.useful_life_months ? `${p.useful_life_months} meses · ${F.money(p.residual_value || 0)}` : null], ['Depreciación mensual', p.useful_life_months && v.ownership === 'OWN' ? F.money((p.purchase_cost - (p.residual_value || 0)) / p.useful_life_months) : null], ['SOAT vence', F.date(v.soat_expires_on)], ['Revisión técnica vence', F.date(v.tech_inspection_expires_on)]].concat([['Cambio de tablero', h('div', { class: 'row' }, btn('Registrar cambio de tablero', () => G.require('flo.odometer.reset', () => resetModal(v)), { sm: true, kind: 'ghost' }))], ['Estado', h('div', { class: 'row' }, ['ACTIVE', 'INACTIVE'].map(s => btn(s === 'ACTIVE' ? 'Activar' : 'Inactivar', () => G.require('flo.maintenance.manage', () => run(() => { if (s === 'ACTIVE' && openMaints(vid).some(x => x.in_workshop)) G.fail('RN-FLO-11', 'Tiene una orden de mantenimiento en taller abierta: ciérrala en FLO-08.'); setOpStatus(vid, s); }, 'Estado operativo actualizado')), { sm: true, kind: (p.op_status || 'ACTIVE') === s ? 'primary' : 'ghost', disabled: p._virtual })))]]))));
    body.appendChild(g);
    const trips = G.db.where('vehicle_trips', t => t.vehicle_id === vid).sort(U.by('trip_date', -1));
    const tb = tabs([
      { key: 'odo', label: 'Odómetro', count: readingsOf(vid).length, render: pn => pn.appendChild(table({ id: 'flo04-odo', search: false, columns: [{ key: 'read_at', label: 'Fecha', render: x => F.datetime(x.read_at) }, { key: 'km', label: 'Km', align: 'r', render: x => F.num(x.km) }, { key: 'source', label: 'Origen', value: x => srcName(x.source) }, { key: 'reason', label: 'Motivo', value: x => x.reason ? `${x.reason} (antes ${F.num(x.previous_km)} km)` : x.notes || '' }], rows: readingsOf(vid).slice().reverse() })) },
      { key: 'trp', label: 'Jornadas', count: trips.length, render: pn => pn.appendChild(table({ id: 'flo04-trp', search: false, columns: [{ key: 'trip_date', label: 'Fecha', render: t => F.date(t.trip_date) }, { key: 'number', label: 'Jornada', mono: true }, { key: 'd', label: 'Conductor', value: t => G.userShort(t.driver_user_id) }, { key: 'km_odometer', label: 'Km', align: 'r', render: t => F.num(t.km_odometer) }, { key: 'deliveries', label: 'Entregas', align: 'r' }, { key: 'status', label: 'Estado', render: t => sb(t.status) }], rows: trips, onRow: t => tripDrawer(t.id) })) },
      { key: 'ful', label: 'Cargas', count: loadsOf(vid).length, render: pn => pn.appendChild(table({ id: 'flo04-ful', search: false, columns: fuelCols(false), rows: loadsOf(vid).slice().reverse(), onRow: f => fuelDrawer(f.id) })) },
      { key: 'mnt', label: 'Mantenimiento', count: maintsOf(vid).length, render: pn => { pn.appendChild(table({ id: 'flo04-pl', search: false, columns: planCols(false), rows: plansOf(vid), onRow: x => planDrawer(x) })); pn.appendChild(table({ id: 'flo04-mv', search: false, columns: maintCols(false), rows: maintsOf(vid).sort(U.by('opened_on', -1)), onRow: x => maintDrawer(x.id) })); } },
      { key: 'doc', label: 'Documentos', count: G.db.where('vehicle_documents', d => d.vehicle_id === vid).length, render: pn => pn.appendChild(table({ id: 'flo04-doc', search: false, columns: docCols(false), rows: G.db.where('vehicle_documents', d => d.vehicle_id === vid).sort(U.by('expires_on', -1)) })) },
      { key: 'fin', label: 'Multas', count: G.db.where('traffic_fines', f => f.vehicle_id === vid).length, render: pn => pn.appendChild(table({ id: 'flo04-fin', search: false, columns: fineCols(false), rows: G.db.where('traffic_fines', f => f.vehicle_id === vid), onRow: f => fineDrawer(f.id) })) },
      { key: 'cst', label: 'Otros costos', count: G.db.where('vehicle_costs', c => c.vehicle_id === vid).length, render: pn => pn.appendChild(table({ id: 'flo04-cst', search: false, columns: costCols(false), rows: G.db.where('vehicle_costs', c => c.vehicle_id === vid).sort(U.by('cost_date', -1)) })) },
    ]);
    tb.style.minWidth = '0'; body.appendChild(tb);
  }
  function assignModal(v) {
    modal(`Asignar ${v.plate} a una ruta`, (b, close) => b.appendChild(form({ id: 'flo04-as', values: { date: G.TODAY }, fields: [{ key: 'date', label: 'Fecha de la ruta', type: 'date', required: true }, { key: 'driver_user_id', label: 'Conductor', type: 'select', options: driverOpts() }, { key: 'route_id', label: 'Ruta de DEL (opcional)', type: 'select', options: G.db.where('delivery_routes', r => r.route_date >= G.TODAY && ['PLANNED', 'SCHEDULED'].includes(r.status)).map(r => [r.id, r.code]) }],
      submitLabel: 'Asignar', onCancel: close, onSubmit: vals => { const r = FLO.assignToRoute({ vehicle_id: v.id, date: vals.date, driver_user_id: vals.driver_user_id || null, route_id: vals.route_id || null }); close(); toast(`${v.plate} asignado${r && r.number ? ' · jornada programada ' + r.number : ''}`, 'ok'); G.refresh(); return true; } })));
  }
  function resetModal(v) {
    modal(`Cambio de tablero · ${v.plate}`, (b, close) => b.appendChild(form({ id: 'flo04-rs', fields: [{ key: 'km', label: 'Lectura del tablero nuevo (km)', type: 'number', min: 0, required: true }, { key: 'reason', label: 'Motivo', type: 'textarea', required: true, placeholder: 'Tablero dañado; reemplazo en taller con factura…' }],
      submitLabel: 'Registrar', onCancel: close, onSubmit: vals => { FLO.resetOdometer(v.id, vals); close(); toast('Cambio de tablero registrado (RN-FLO-04)', 'ok'); G.refresh(); return true; } })));
  }
  /** alta o edición de vehículo y ficha (D-FLO-01) */
  FLO.saveVehicle = function (d, existing) {
    const plate = String(d.plate || '').trim().toUpperCase(); if (!/^[A-Z0-9]{2,3}-?[0-9]{3,4}$/.test(plate)) G.fail('RN-FLO-13', 'Indica una placa válida (p. ej. MTA-123).');
    if (G.db.find('vehicles', x => x.plate === plate && (!existing || x.id !== existing.id))) G.fail('RN-FLO-13', `La placa ${plate} ya existe.`);
    if (!existing && !d.soat_expires_on) G.fail('RN-FLO-13', 'El SOAT exige fecha de vencimiento.');
    if (!(Number(d.tank_capacity_gal) > 0) || !(Number(d.expected_km_per_gal) > 0)) G.fail('RN-FLO-08', 'Capacidad del tanque y rendimiento esperado son obligatorios.');
    const vrow = { plate, vehicle_type: d.vehicle_type || 'MOTO', ownership: d.ownership || 'OWN', provider_id: d.provider_id || null, establishment_id: d.establishment_id || 'es-L1', capacity_kg: Number(d.capacity_kg || 0), refrigerated: !!d.refrigerated, status: 'ACTIVE', fuel_type: d.fuel_type || 'GASOLINE', rental_daily_rate: d.rental_daily_rate ? Number(d.rental_daily_rate) : null };
    let v;
    if (existing) v = G.db.update('vehicles', existing.id, vrow);
    else v = G.db.insert('vehicles', Object.assign({ id: 've-' + plate.replace(/[^A-Z0-9]/g, '-'), odometer_km: Number(d.odometer_km || 0), soat_expires_on: null, tech_inspection_expires_on: null, created_from: 'FLO' }, vrow));
    const prow = { vehicle_id: v.id, internal_code: d.internal_code || plate, make: d.make || null, model: d.model || null, year: d.year ? Number(d.year) : null, color: d.color || null, tank_capacity_gal: Number(d.tank_capacity_gal), expected_km_per_gal: Number(d.expected_km_per_gal), temp_min_c: d.refrigerated ? (d.temp_mode === 'FROZEN' ? null : Number(d.temp_min_c ?? 0)) : null, temp_max_c: d.refrigerated ? Number(d.temp_max_c ?? (d.temp_mode === 'FROZEN' ? -18 : 4)) : null, temp_mode: d.refrigerated ? (d.temp_mode || 'CHILLED') : null, gps_source: 'APP_ANDROID', gps_device_id: d.gps_device_id || null, temp_sensor_id: d.temp_sensor_id || null, purchase_date: d.purchase_date || null, purchase_cost: d.purchase_cost ? Number(d.purchase_cost) : null, residual_value: d.residual_value ? Number(d.residual_value) : 0, useful_life_months: d.useful_life_months ? Number(d.useful_life_months) : null };
    const p = G.db.find('vehicle_profiles', x => x.vehicle_id === v.id);
    if (p) G.db.update('vehicle_profiles', p.id, prow); else G.db.insert('vehicle_profiles', Object.assign({ op_status: 'ACTIVE' }, prow));
    if (!existing) {
      addReading(v.id, Number(d.odometer_km || 0), d.odometer_at || (G.TODAY + 'T07:00:00'), 'INITIAL', null, { notes: 'Alta del vehículo' });
      const was = G.ctx.role; const docs = [['SOAT', d.soat_expires_on, d.soat_number || 'SOAT-' + plate], ['TECH_INSPECTION', d.tech_inspection_expires_on, 'CITV-' + plate]];
      for (const [t, exp, n] of docs) if (exp) FLO.saveDocument({ doc_type: t, vehicle_id: v.id, number: n, expires_on: exp, issued_on: G.date.add(exp, -365) }, { seed: true });
      void was;
    }
    return veh(v.id);
  };
  function vehicleDrawer(v) {
    const p = v ? prof(v.id) : {};
    drawer(v ? `Editar ${v.plate}` : 'Nuevo vehículo', (b, close) => b.appendChild(form({ id: 'flo04-v', values: v ? Object.assign({}, v, p) : { vehicle_type: 'MOTO', ownership: 'OWN', establishment_id: 'es-L1', fuel_type: 'GASOLINE', tank_capacity_gal: 3, expected_km_per_gal: 70, odometer_km: 0, temp_min_c: 0, temp_max_c: 4 }, fields: [
      { key: 'plate', label: 'Placa', required: true }, { key: 'internal_code', label: 'Código interno', placeholder: 'MOT-04' }, { key: 'vehicle_type', label: 'Tipo', type: 'select', options: Object.entries(VTYPE), required: true }, { key: 'ownership', label: 'Modalidad', type: 'select', options: [['OWN', 'Propio'], ['RENTED', 'Alquilado']], required: true },
      { key: 'provider_id', label: 'Proveedor (alquiler)', type: 'select', options: G.ui.opts('suppliers', s => s.trade_name || s.legal_name, s => s.supplier_type === 'VEHICLE_RENTAL') }, { key: 'rental_daily_rate', label: 'Tarifa diaria S/', type: 'money', min: 0 }, { key: 'establishment_id', label: 'Local', type: 'select', options: siteOpts(), required: true }, { key: 'fuel_type', label: 'Combustible', type: 'select', options: [['GASOLINE', 'Gasohol'], ['DIESEL', 'Diésel'], ['GLP', 'GLP'], ['GNV', 'GNV']], required: true },
      { key: 'make', label: 'Marca' }, { key: 'model', label: 'Modelo' }, { key: 'year', label: 'Año', type: 'number' }, { key: 'color', label: 'Color' },
      { key: 'tank_capacity_gal', label: 'Capacidad del tanque (gal)', type: 'number', min: 0.5, required: true, help: 'Tope de carga = tanque × flo_tank_overfill_factor (RN-FLO-08)' }, { key: 'expected_km_per_gal', label: 'Rendimiento esperado (km/gal)', type: 'number', min: 1, required: true }, { key: 'capacity_kg', label: 'Capacidad de carga (kg)', type: 'number', min: 0 },
      { key: 'refrigerated', label: 'Refrigerado (D-FLO-01)', type: 'checkbox' }, { key: 'temp_mode', label: 'Cadena de frío', type: 'select', options: [['CHILLED', 'Refrigerado 0 a 4 °C'], ['FROZEN', 'Congelado −18 °C o menos']] }, { key: 'temp_min_c', label: 'Mínimo °C', type: 'number' }, { key: 'temp_max_c', label: 'Máximo °C', type: 'number' },
      { key: 'gps_device_id', label: 'Dispositivo GPS', placeholder: 'App Android del conductor' }, { key: 'temp_sensor_id', label: 'Sensor de temperatura' },
      { key: 'purchase_date', label: 'Fecha de compra', type: 'date' }, { key: 'purchase_cost', label: 'Costo de compra S/', type: 'money', min: 0 }, { key: 'residual_value', label: 'Valor residual S/', type: 'money', min: 0 }, { key: 'useful_life_months', label: 'Vida útil (meses)', type: 'number', min: 1 },
      v ? null : { key: 'odometer_km', label: 'Odómetro inicial (km)', type: 'number', min: 0, required: true }, v ? null : { key: 'soat_expires_on', label: 'SOAT vence', type: 'date', required: true, help: 'RN-FLO-13' }, v ? null : { key: 'tech_inspection_expires_on', label: 'Revisión técnica vence', type: 'date' }].filter(Boolean),
      onCancel: close, onSubmit: vals => { const r = FLO.saveVehicle(vals, v); close(); toast(`Vehículo ${r.plate} guardado`, 'ok'); G.go('FLO-04', { id: r.id }); return true; } })), { code: 'FLO-04', wide: true });
  }

  /* ---------- FLO-05 Cargas de combustible ---------- */
  const fuelCols = withV => [{ key: 'number', label: 'N.º', mono: true }, { key: 'loaded_at', label: 'Fecha', render: f => F.datetime(f.loaded_at) }, withV ? { key: 'v', label: 'Vehículo', value: f => vLabel(f.vehicle_id) } : null, { key: 'd', label: 'Conductor', value: f => f.driver_user_id ? G.userShort(f.driver_user_id) : '—' }, { key: 'odometer_km', label: 'Odómetro', align: 'r', render: f => F.num(f.odometer_km) }, { key: 'gallons', label: 'Galones', align: 'r', render: f => F.num(f.gallons, 3) }, { key: 'price_per_gal', label: 'S/ por gal', align: 'r', render: f => F.num(f.price_per_gal, 2) }, { key: 'amount', label: 'Importe', align: 'r', render: f => F.money(f.amount) }, { key: 'full_tank', label: 'Lleno', render: f => f.full_tank ? 'Sí' : 'No' }, { key: 'station_name', label: 'Grifo' }, { key: 'voucher_no', label: 'Vale', mono: true }, { key: 'km_per_gal', label: 'Km/gal', align: 'r', render: f => f.km_per_gal == null ? '—' : badge(F.num(f.km_per_gal, 1), kmpgTone(f.km_per_gal, f.vehicle_id)) }, { key: 'exp', label: 'Gasto (GAS)', value: f => f.source === 'BASELINE' ? 'Línea base' : f.expense_id ? (G.db.get('expenses', f.expense_id) || {}).number : 'Sin gasto', render: f => f.source === 'BASELINE' ? h('span', { class: 'muted small' }, 'Línea base') : expLabel(f.expense_id) }, { key: 'source', label: 'Origen', value: f => ({ APP: 'App', WEB: 'Web', BASELINE: 'Línea base' }[f.source] || f.source) }, { key: 'status', label: 'Estado', render: f => f.status === 'VOIDED' ? sb('VOIDED') : sb('ACTIVE'), value: f => f.status }].filter(Boolean);
  function rFLO05(el, params) {
    const body = page(el, { code: 'FLO-05', title: 'Cargas de combustible', sub: `Registro desde la app o la web con odómetro, galones, precio, importe, tanque lleno, grifo, vale y foto. Tope por carga: tanque × ${num('flo_tank_overfill_factor', 1.05)} (RN-FLO-08); cada carga con comprobante se registra una sola vez como gasto en GAS (RN-FLO-17).`, actions: [{ label: 'Registrar carga', kind: 'primary', icon: '+', onClick: () => G.require('flo.fuel.manage', () => fuelForm({})) }] });
    body.appendChild(pills(MONTHS(), S.month, v => { S.month = v; G.refresh(); }));
    const from = S.month, to = monthEnd(from);
    const rows = G.db.where('fuel_loads', f => f.loaded_at.slice(0, 10) >= from && f.loaded_at.slice(0, 10) <= to).filter(vOk).sort(U.by('loaded_at', -1));
    const act = rows.filter(f => f.status !== 'VOIDED');
    const gal = U.sum(act, f => f.gallons), amt = U.sum(act, f => f.amount);
    body.appendChild(kpis([{ label: 'Cargas', value: act.length, sub: `${act.filter(f => f.full_tank).length} con tanque lleno` }, { label: 'Galones', value: F.num(gal, 1) }, { label: 'Importe', value: F.money(amt) }, { label: 'Precio promedio', value: gal ? F.money(amt / gal) + '/gal' : '—' }, { label: 'Sin gasto enlazado', value: act.filter(f => !f.expense_id).length, tone: act.some(f => !f.expense_id) ? 'warn' : 'ok', sub: 'RN-FLO-17' }]));
    body.appendChild(table({ id: 'flo05', columns: fuelCols(true), rows, filters: [{ key: 'vehicle_id', label: 'Vehículo', options: scopedFleet().map(v => [v.id, vLabel(v.id)]) }, { key: 'ef', label: 'Rendimiento', options: [['LOW', 'Bajo el esperado'], ['OK', 'En rango'], ['NA', 'Sin cálculo']], value: f => f.efficiency_status }, { key: 'gx', label: 'Gasto', options: [['SI', 'Enlazado'], ['NO', 'Sin gasto']], value: f => f.expense_id ? 'SI' : 'NO' }, { key: 'source', label: 'Origen', options: [['APP', 'App'], ['WEB', 'Web']] }], onRow: f => fuelDrawer(f.id) }));
    if (params.id) setTimeout(() => fuelDrawer(params.id), 0);
  }
  function fuelForm(pre, after) {
    drawer('Registrar carga de combustible', (b, close) => {
      const info = h('div'); const st = { photo: '' };
      const v0 = pre.vehicle_id || (fleet()[0] || {}).id; const t0 = FLO.openTrip(v0);
      const f = form({ id: 'flo05-f', values: { vehicle_id: v0, loaded_at: (pre.at || FLO.clock()).slice(0, 16), odometer_km: FLO.currentOdo(v0) + (t0 ? Math.round(FLO.gpsKm(positionsOf(t0.id))) : 0), full_tank: true, price_per_gal: (veh(v0) || {}).fuel_type === 'DIESEL' ? 16.3 : 17.4, station_supplier_id: G.db.get('suppliers', 'su-GAS-GRIFO') ? 'su-GAS-GRIFO' : '', doc_type: 'INVOICE', create_expense: !!(G.gas) }, fields: [
        { key: 'vehicle_id', label: 'Vehículo', type: 'select', options: vehOpts(), required: true, onChange: (v, vals, api) => { api.set('odometer_km', FLO.currentOdo(v)); api.set('price_per_gal', (veh(v) || {}).fuel_type === 'DIESEL' ? 16.3 : 17.4); upd(); } },
        { key: 'loaded_at', label: 'Fecha y hora', type: 'datetime', required: true, onChange: () => upd() }, { key: 'odometer_km', label: 'Odómetro (km)', type: 'number', min: 0, required: true, onChange: () => upd() },
        { key: 'gallons', label: 'Galones', type: 'number', min: 0.01, required: true, onChange: () => upd() }, { key: 'price_per_gal', label: 'Precio por galón S/', type: 'money', min: 0.01, required: true, onChange: () => upd() }, { key: 'full_tank', label: 'Tanque lleno (cuenta para el rendimiento, RN-FLO-06)', type: 'checkbox', onChange: () => upd() },
        { key: 'station_supplier_id', label: 'Grifo', type: 'select', options: G.ui.opts('suppliers', s => s.trade_name || s.legal_name, s => /grifo|combust|estaci/i.test(s.legal_name + ' ' + (s.trade_name || ''))) }, { key: 'station_name', label: 'Grifo (si no está en la lista)' }, { key: 'voucher_no', label: 'N.º de vale' },
        { key: 'doc_type', label: 'Comprobante', type: 'select', options: [['INVOICE', 'Factura'], ['RECEIPT', 'Boleta'], ['TICKET', 'Ticket']] }, { key: 'doc_series', label: 'Serie', placeholder: 'F001' }, { key: 'doc_number', label: 'Número' },
        { key: 'create_expense', label: 'Registrar el gasto en GAS (una sola vez, RN-FLO-17)', type: 'checkbox', span: 2 }],
        onCancel: close, onSubmit: vals => { const r = FLO.registerFuel(Object.assign({}, vals, { photo: st.photo || null, source: pre.source || 'WEB', full_tank: !!vals.full_tank, loaded_at: vals.loaded_at + ':00' })); close(); toast(r.km_per_gal != null ? `Carga ${r.number}: ${F.num(r.km_per_gal, 1)} km/gal${r.efficiency_status === 'LOW' ? ' · alerta de rendimiento (RN-FLO-07)' : ''}` : `Carga ${r.number} registrada`, r.efficiency_status === 'LOW' ? 'warn' : 'ok'); G.refresh(); after && after(r); return true; } });
      function upd() {
        const v = f.api.values; G.ui.clear(info); const vh = veh(v.vehicle_id); if (!vh) return; const p = prof(vh.id);
        const gal = Number(v.gallons) || 0, pr = Number(v.price_per_gal) || 0; const cap = p.tank_capacity_gal * num('flo_tank_overfill_factor', 1.05);
        const lr = lastReading(vh.id, (v.loaded_at || '') + ':00');
        const ef = gal ? FLO.efficiencyPreview(vh.id, (v.loaded_at || '') + ':00', v.odometer_km, gal, !!v.full_tank) : {};
        info.appendChild(notice(h('div', { class: 'stack', style: 'gap:2px' }, h('span', null, `Importe: ${F.num(gal, 3)} gal × ${F.money(pr)} = `, h('b', null, F.money(gal * pr))), h('span', { style: gal > cap ? 'color:var(--bad)' : '' }, `Tope de ${vh.plate}: ${F.num(p.tank_capacity_gal, 2)} gal × ${F.num(num('flo_tank_overfill_factor', 1.05), 2)} = ${F.num(cap, 3)} gal${gal > cap ? ' · se rechazará (RN-FLO-08)' : ''}`), h('span', { style: lr && Number(v.odometer_km) < lr.km ? 'color:var(--bad)' : '' }, `Última lectura: ${lr ? F.num(lr.km) + ' km (' + srcName(lr.source) + ', ' + F.datetime(lr.read_at) + ')' : '—'}${lr && Number(v.odometer_km) < lr.km ? ' · el odómetro no puede bajar (RN-FLO-04)' : ''}`), ef.km_per_gal != null ? h('span', null, `Rendimiento: ${F.num(ef.km_since_full)} km / ${F.num(ef.gallons_since_full, 3)} gal = `, h('b', null, F.num(ef.km_per_gal, 1) + ' km/gal'), ` · esperado ${p.expected_km_per_gal}, mínimo ${F.num(FLO.lowThreshold(vh.id), 1)}${ef.km_per_gal < FLO.lowThreshold(vh.id) ? ' · generará alerta (RN-FLO-07)' : ''}`) : h('span', { class: 'muted' }, v.full_tank ? 'Sin carga llena anterior: no se calcula rendimiento.' : 'Carga parcial: el rendimiento se calcula en la próxima carga llena (RN-FLO-06).')), gal > cap || ef.km_per_gal != null && ef.km_per_gal < FLO.lowThreshold(vh.id) ? 'warn' : 'info'));
      }
      b.append(f, h('label', { class: 'small' }, 'Foto del vale'), fileInput('Foto del vale', n => { st.photo = n; }), info); upd();
    }, { code: 'FLO-05', wide: true });
  }
  function fuelDrawer(id) {
    const f = G.db.get('fuel_loads', id); if (!f) return;
    drawer(`Carga ${f.number}`, (b, close) => {
      const reopen = () => { close(); G.refresh(); fuelDrawer(id); };
      b.appendChild(dl([['Vehículo', vLabel(f.vehicle_id)], ['Conductor', f.driver_user_id ? G.userName(f.driver_user_id) : null], ['Fecha', F.datetime(f.loaded_at)], ['Odómetro', F.num(f.odometer_km) + ' km'], ['Galones', F.num(f.gallons, 3)], ['Precio', F.money(f.price_per_gal) + ' por galón'], ['Importe', F.money(f.amount)], ['Tanque lleno', f.full_tank ? 'Sí' : 'No'], ['Grifo', f.station_name], ['Vale', f.voucher_no], ['Comprobante', f.doc_number ? `${f.doc_type === 'INVOICE' ? 'Factura' : f.doc_type || ''} ${f.doc_number}` : null], ['Foto', f.photo], ['Jornada', f.trip_id ? (G.db.get('vehicle_trips', f.trip_id) || {}).number : null], ['Rendimiento (RN-FLO-06)', f.km_per_gal != null ? `${F.num(f.km_since_full)} km / ${F.num(f.gallons_since_full, 3)} gal = ${F.num(f.km_per_gal, 1)} km/gal (esperado ${prof(f.vehicle_id).expected_km_per_gal})` : f.full_tank ? 'Sin carga llena anterior' : 'Carga parcial'], ['Gasto en GAS', f.source === 'BASELINE' ? 'Línea base (no es gasto)' : expLabel(f.expense_id)], ['Origen', { APP: 'App del conductor', WEB: 'Web', BASELINE: 'Línea base' }[f.source]], ['Estado', f.status === 'VOIDED' ? `Anulada: ${f.void_reason}` : 'Vigente']]));
      if (f.status !== 'VOIDED' && f.source !== 'BASELINE' && !f.expense_id) {
        const cands = FLO.expenseCandidates('FUEL', f.vehicle_id).filter(e => Math.abs(G.date.diff(e.issue_date, f.loaded_at.slice(0, 10))) <= 3);
        b.appendChild(card('Gasto de la carga (RN-FLO-17)', h('div', { class: 'stack' }, cands.length ? table({ id: 'flo05-c', search: false, columns: [{ key: 'number', label: 'Gasto', mono: true }, { key: 'issue_date', label: 'Fecha', render: e => F.date(e.issue_date) }, { key: 'total', label: 'Total', align: 'r', render: e => F.money(e.total) }, { key: 'fuel_gallons', label: 'Gal', align: 'r', render: e => F.num(e.fuel_gallons, 3) }, { key: 'status', label: 'Estado', render: e => G.ui.status(e.status) }], rows: cands, actions: e => [btn('Enlazar', () => G.require('flo.fuel.manage', () => { if (run(() => FLO.linkExpense('fuel_loads', f.id, e.id), `Carga enlazada a ${e.number}`)) reopen(); }), { sm: true })] }) : h('div', { class: 'small muted' }, 'No hay gastos de combustible de este vehículo sin enlazar en ±3 días.'), btn('Registrar el gasto en GAS', () => G.require('flo.fuel.manage', () => { if (run(() => { const e = makeExpense({ kind: 'FUEL', vehicle_id: f.vehicle_id, amount: f.amount, date: f.loaded_at.slice(0, 10), supplier_id: f.station_supplier_id, doc_type: 'INVOICE', description: `Combustible ${f.number} · ${(veh(f.vehicle_id) || {}).plate} · ${F.num(f.gallons, 3)} gal`, gallons: f.gallons, odometer: f.odometer_km, voucher: f.voucher_no, employee_id: f.employee_id }); FLO.linkExpense('fuel_loads', f.id, e.id); return e; }, e => `Gasto ${e.number} creado en borrador y enlazado`)) reopen(); }), { sm: true, kind: 'primary' }))));
      }
      if (f.status !== 'VOIDED' && f.source !== 'BASELINE') b.appendChild(h('div', { class: 'row' }, btn('Anular carga', () => modal('Anular ' + f.number, (mb, mc) => mb.appendChild(form({ id: 'flo05-v', fields: [{ key: 'reason', label: 'Motivo', type: 'textarea', required: true }], submitLabel: 'Anular', onCancel: mc, onSubmit: v => { FLO.voidFuel(f.id, v.reason); mc(); reopen(); return true; } }))), { sm: true, kind: 'danger', disabled: !G.can('flo.fuel.manage') })));
    }, { code: 'FLO-05', wide: true });
  }

  /* ---------- FLO-06 Rendimiento de combustible ---------- */
  function rFLO06(el) {
    const body = page(el, { code: 'FLO-06', title: 'Rendimiento de combustible', sub: `Km por galón por vehículo y conductor frente al esperado, solo con cargas de tanque lleno (RN-FLO-06). Por debajo del esperado × (1 − ${num('flo_fuel_efficiency_tolerance_pct', 15)} %) se alerta (RN-FLO-07).` });
    body.appendChild(pills(MONTHS(), S.month, v => { S.month = v; G.refresh(); }));
    const from = S.month, to = monthEnd(from) > G.TODAY ? G.TODAY : monthEnd(from);
    const k2 = G.kpi('KPI-FLO-02', { from, to }) || {};
    const vs = scopedFleet();
    const per = vs.map(v => { const ls = loadsOf(v.id).filter(f => f.km_per_gal != null && f.loaded_at.slice(0, 10) >= from && f.loaded_at.slice(0, 10) <= to); const km = U.sum(ls, f => f.km_since_full), g = U.sum(ls, f => f.gallons_since_full); return { v, n: ls.length, km, g, kmpg: g ? R(km / g, 1) : null, exp: prof(v.id).expected_km_per_gal, thr: FLO.lowThreshold(v.id), low: ls.filter(f => f.efficiency_status === 'LOW').length }; }).filter(x => x.n);
    body.appendChild(kpis([{ label: 'KPI-FLO-02 · Rendimiento de la flota', value: F.num(k2.value, 1) + ' km/gal', sub: `${F.num(k2.numerator)} km / ${F.num(k2.denominator, 1)} gal · reemplaza a KPI-DEL-10` }, { label: 'Cargas llenas evaluadas', value: U.sum(per, x => x.n) }, { label: 'Bajo el mínimo', value: U.sum(per, x => x.low), tone: per.some(x => x.low) ? 'bad' : 'ok', onClick: () => G.go('FLO-14') }, { label: 'Alertas de rendimiento abiertas', value: G.db.where('fleet_alerts', a => a.alert_type === 'FUEL_EFFICIENCY' && a.status !== 'CLOSED').length }]));
    const g = h('div', { class: 'grid c2' });
    g.appendChild(card('Real frente al esperado', G.ui.chart.bar({ labels: per.map(x => code(x.v.id)), series: [{ name: 'Real km/gal', values: per.map(x => x.kmpg || 0) }, { name: 'Esperado', values: per.map(x => x.exp) }, { name: 'Mínimo (alerta)', values: per.map(x => x.thr) }], format: v => F.num(v, 1) + ' km/gal' })));
    const weeks = []; for (let d = G.date.add(G.TODAY, -42); d <= G.TODAY; d = G.date.add(d, 7)) weeks.push(d);
    g.appendChild(card('Tendencia semanal (6 semanas)', G.ui.chart.line({ labels: weeks.map(d => F.date(d).slice(0, 5)), series: vs.filter(v => loadsOf(v.id).some(f => f.km_per_gal != null)).map(v => ({ name: code(v.id), values: weeks.map(w => { const ls = loadsOf(v.id).filter(f => f.km_per_gal != null && f.loaded_at.slice(0, 10) >= w && f.loaded_at.slice(0, 10) < G.date.add(w, 7)); const g2 = U.sum(ls, f => f.gallons_since_full); return g2 ? R(U.sum(ls, f => f.km_since_full) / g2, 1) : null; }) })), format: v => F.num(v, 1) + ' km/gal' })));
    body.appendChild(g);
    body.appendChild(card('Por vehículo', table({ id: 'flo06-v', search: false, columns: [{ key: 'v', label: 'Vehículo', value: x => vLabel(x.v.id) }, { key: 'n', label: 'Cargas llenas', align: 'r' }, { key: 'km', label: 'Km', align: 'r', render: x => F.num(x.km) }, { key: 'g', label: 'Galones', align: 'r', render: x => F.num(x.g, 2) }, { key: 'kmpg', label: 'Real', align: 'r', render: x => badge(F.num(x.kmpg, 1), kmpgTone(x.kmpg, x.v.id)) }, { key: 'exp', label: 'Esperado', align: 'r' }, { key: 'thr', label: 'Mínimo', align: 'r', render: x => F.num(x.thr, 1) }, { key: 'dv', label: 'Desvío', align: 'r', value: x => x.kmpg ? R((x.kmpg - x.exp) / x.exp * 100, 1) : null, render: x => x.kmpg ? F.pct((x.kmpg - x.exp) / x.exp * 100) : '—' }, { key: 'low', label: 'Cargas bajas', align: 'r' }], rows: per, onRow: x => G.go('FLO-04', { id: x.v.id }) }), { flush: true }));
    const byD = {};
    for (const v of vs) for (const f of loadsOf(v.id).filter(f => f.km_per_gal != null && f.driver_user_id && f.loaded_at.slice(0, 10) >= from && f.loaded_at.slice(0, 10) <= to)) { const k = f.driver_user_id + '|' + v.id; const x = byD[k] || (byD[k] = { uid: f.driver_user_id, vid: v.id, km: 0, g: 0, n: 0 }); x.km += f.km_since_full; x.g += f.gallons_since_full; x.n++; }
    body.appendChild(card('Por conductor y vehículo', table({ id: 'flo06-d', search: false, columns: [{ key: 'uid', label: 'Conductor', value: x => G.userName(x.uid) }, { key: 'vid', label: 'Vehículo', value: x => vLabel(x.vid) }, { key: 'n', label: 'Cargas', align: 'r' }, { key: 'kmpg', label: 'Km/gal', align: 'r', value: x => R(x.km / x.g, 1), render: x => badge(F.num(x.km / x.g, 1), kmpgTone(x.km / x.g, x.vid)) }, { key: 'exp', label: 'Esperado', align: 'r', value: x => prof(x.vid).expected_km_per_gal }], rows: Object.values(byD) }), { flush: true }));
    body.appendChild(table({ id: 'flo06-low', columns: fuelCols(true).filter(c => ['number', 'loaded_at', 'v', 'd', 'gallons', 'km_per_gal', 'exp'].includes(c.key)), rows: G.db.where('fuel_loads', f => f.efficiency_status === 'LOW').filter(vOk).sort(U.by('loaded_at', -1)), empty: 'Sin cargas bajo el mínimo.', onRow: f => fuelDrawer(f.id) }));
  }

  /* ---------- FLO-07 Plan de mantenimiento ---------- */
  const planCols = withV => [{ key: 'code', label: 'Plan', mono: true }, withV ? { key: 'v', label: 'Vehículo', value: p => vLabel(p.vehicle_id) } : null, { key: 'task', label: 'Tarea' }, { key: 'iv', label: 'Intervalo', value: p => [p.interval_km ? `cada ${F.num(p.interval_km)} km` : null, p.interval_days ? `cada ${p.interval_days} días` : null].filter(Boolean).join(' o ') }, { key: 'last', label: 'Último hecho', value: p => [p.last_done_km != null ? F.num(p.last_done_km) + ' km' : null, p.last_done_on ? F.date(p.last_done_on) : null].filter(Boolean).join(' · ') }, { key: 'next', label: 'Próximo', value: p => [p.next_due_km != null ? F.num(p.next_due_km) + ' km' : null, p.next_due_on ? F.date(p.next_due_on) : null].filter(Boolean).join(' o ') }, { key: 'left', label: 'Falta', value: p => { const s = FLO.planState(p); return [s.kmLeft != null ? F.num(s.kmLeft) + ' km' : null, s.daysLeft != null ? s.daysLeft + ' d' : null].filter(Boolean).join(' · '); } }, { key: 'aviso', label: 'Aviso', value: p => { const s = FLO.planState(p); return [s.alertKm != null ? F.num(s.alertKm) + ' km' : null, s.alertOn ? F.date(s.alertOn) : null].filter(Boolean).join(' o '); } }, { key: 'om', label: 'Orden', mono: true, value: p => (G.db.find('vehicle_maintenances', m => m.plan_id === p.id && ['OPEN', 'IN_PROGRESS'].includes(m.status)) || {}).number || '' }, { key: 'st', label: 'Estado', value: p => FLO.planState(p).st, render: p => sb(FLO.planState(p).st) }].filter(Boolean);
  function rFLO07(el) {
    const body = page(el, { code: 'FLO-07', title: 'Plan de mantenimiento', sub: `Tareas por vehículo cada N km y/o N días; vence lo que ocurra primero y se avisa ${num('flo_maint_alert_km', 500)} km o ${num('flo_maint_alert_days', 7)} días antes (RN-FLO-09). Vencido por más de ${F.num(num('flo_maint_overdue_block_km', 1000))} km bloquea el vehículo (RN-FLO-11).`, actions: [{ label: 'Nuevo plan', kind: 'primary', icon: '+', onClick: () => G.require('flo.maintenance.manage', () => planDrawer(null)) }] });
    const rows = G.db.where('vehicle_maintenance_plans', p => p.status === 'ACTIVE').filter(vOk).sort((a, b) => { const o = { OVERDUE_BLOCK: 0, OVERDUE: 1, DUE_SOON: 2, OK: 3 }; return o[FLO.planState(a).st] - o[FLO.planState(b).st]; });
    const cnt = s => rows.filter(p => FLO.planState(p).st === s).length;
    const k5 = G.kpi('KPI-FLO-05') || {};
    body.appendChild(kpis([{ label: 'Planes activos', value: rows.length }, { label: 'Próximos', value: cnt('DUE_SOON'), tone: cnt('DUE_SOON') ? 'warn' : 'ok' }, { label: 'Vencidos', value: cnt('OVERDUE') + cnt('OVERDUE_BLOCK'), tone: cnt('OVERDUE') + cnt('OVERDUE_BLOCK') ? 'bad' : 'ok' }, { label: 'Bloquean el vehículo', value: cnt('OVERDUE_BLOCK'), tone: cnt('OVERDUE_BLOCK') ? 'bad' : 'ok' }, { label: 'KPI-FLO-05 · Preventivos a tiempo', value: F.pct(k5.value), sub: `${k5.numerator ?? 0} de ${k5.denominator ?? 0} del mes` }]));
    body.appendChild(table({ id: 'flo07', columns: planCols(true), rows, filters: [{ key: 'vehicle_id', label: 'Vehículo', options: scopedFleet().map(v => [v.id, vLabel(v.id)]) }, { key: 'st', label: 'Estado', options: [['OK', 'Al día'], ['DUE_SOON', 'Próximo'], ['OVERDUE', 'Vencido'], ['OVERDUE_BLOCK', 'Bloquea']], value: p => FLO.planState(p).st }], onRow: p => planDrawer(p), actions: p => FLO.planState(p).st !== 'OK' && !G.db.find('vehicle_maintenances', m => m.plan_id === p.id && ['OPEN', 'IN_PROGRESS'].includes(m.status)) ? [btn('Crear orden', () => G.require('flo.maintenance.manage', () => newMaint({ kind: 'PREVENTIVE', vehicle_id: p.vehicle_id, plan_id: p.id, description: p.task })), { sm: true, kind: 'primary' })] : [] }));
  }
  function planDrawer(p) {
    drawer(p ? `Plan ${p.code}` : 'Nuevo plan de mantenimiento', (b, close) => {
      if (p) { const s = FLO.planState(p); b.appendChild(notice(`${vLabel(p.vehicle_id)} · odómetro ${F.num(s.cur)} km · ${(ST[s.st] || [s.st])[0]}${s.kmLeft != null ? ` · faltan ${F.num(s.kmLeft)} km` : ''}${s.daysLeft != null ? ` · faltan ${s.daysLeft} días` : ''}`, ST[s.st][1] || 'info')); }
      b.appendChild(form({ id: 'flo07-f', values: p || { status: 'ACTIVE', interval_km: 3000, interval_days: 90, last_done_on: G.TODAY }, fields: [{ key: 'vehicle_id', label: 'Vehículo', type: 'select', options: vehOpts(), required: true }, { key: 'task', label: 'Tarea', required: true, span: 2, placeholder: 'Cambio de aceite y filtro' }, { key: 'interval_km', label: 'Cada N km', type: 'number', min: 1 }, { key: 'interval_days', label: 'Cada N días', type: 'number', min: 1 }, { key: 'last_done_km', label: 'Último hecho a (km)', type: 'number', min: 0 }, { key: 'last_done_on', label: 'Último hecho el', type: 'date' }, { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']], required: true }, { key: 'notes', label: 'Notas', type: 'textarea' }],
        onCancel: close, submitLabel: G.can('flo.maintenance.manage') ? 'Guardar' : false, onSubmit: v => { const r = FLO.savePlan(v, p); close(); toast(`Plan guardado: próximo a ${r.next_due_km != null ? F.num(r.next_due_km) + ' km' : '—'} o el ${F.date(r.next_due_on)}`, 'ok'); G.refresh(); return true; } }));
      if (p) b.appendChild(table({ id: 'flo07-h', search: false, columns: maintCols(false), rows: G.db.where('vehicle_maintenances', m => m.plan_id === p.id).sort(U.by('opened_on', -1)), empty: 'Sin órdenes de este plan.', onRow: m => maintDrawer(m.id) }));
    }, { code: 'FLO-07' });
  }

  /* ---------- FLO-08 Órdenes de mantenimiento ---------- */
  const maintCols = withV => [{ key: 'number', label: 'N.º', mono: true }, withV ? { key: 'v', label: 'Vehículo', value: m => vLabel(m.vehicle_id) } : null, { key: 'kind', label: 'Tipo', value: m => m.kind, render: m => sb(m.kind) }, { key: 'description', label: 'Trabajo' }, { key: 'workshop_name', label: 'Taller' }, { key: 'opened_on', label: 'Ingreso', render: m => F.date(m.opened_on) }, { key: 'done_on', label: 'Salida', render: m => F.date(m.done_on) }, { key: 'odometer_km', label: 'Odómetro', align: 'r', render: m => F.num(m.odometer_km) }, { key: 'days_out_of_service', label: 'Días fuera', align: 'r', render: m => m.days_out_of_service != null ? F.num(m.days_out_of_service) : m.status !== 'DONE' ? G.date.diff(G.TODAY, m.opened_on) + '…' : '—' }, { key: 'total_amount', label: 'Total', align: 'r', render: m => F.money(m.total_amount) }, { key: 'ot', label: 'A tiempo', value: m => m.on_time == null ? '' : m.on_time ? 'Sí' : 'No', render: m => m.on_time == null ? '—' : m.on_time ? badge('Sí', 'ok') : badge('No', 'bad') }, { key: 'exp', label: 'Gasto', value: m => m.expense_id ? 'SI' : 'NO', render: m => m.status === 'DONE' ? expLabel(m.expense_id) : '—' }, { key: 'status', label: 'Estado', render: m => sb(m.status) }].filter(Boolean);
  function rFLO08(el, params) {
    const body = page(el, { code: 'FLO-08', title: 'Órdenes de mantenimiento', sub: 'Preventivo (desde el plan) y correctivo: taller, odómetro, repuestos, mano de obra, días fuera de servicio y comprobante. Al cerrar un preventivo el plan se mueve (RN-FLO-10); el comprobante se registra una sola vez como gasto (RN-FLO-17).', actions: [{ label: 'Nueva orden', kind: 'primary', icon: '+', onClick: () => G.require('flo.maintenance.manage', () => newMaint({ kind: 'CORRECTIVE' })) }] });
    body.appendChild(pills(MONTHS(), S.month, v => { S.month = v; G.refresh(); }));
    const from = S.month, to = monthEnd(from);
    const rows = G.db.where('vehicle_maintenances', m => ['OPEN', 'IN_PROGRESS'].includes(m.status) || ((m.done_on || m.opened_on) >= from && (m.done_on || m.opened_on) <= to)).filter(vOk).sort(U.by('opened_on', -1));
    const done = rows.filter(m => m.status === 'DONE'); const k4 = G.kpi('KPI-FLO-04', { from, to: to > G.TODAY ? G.TODAY : to }) || {};
    body.appendChild(kpis([{ label: 'En taller', value: rows.filter(m => m.status !== 'DONE' && m.status !== 'VOIDED').length, tone: rows.some(m => ['OPEN', 'IN_PROGRESS'].includes(m.status)) ? 'warn' : 'ok' }, { label: 'Hechas en el mes', value: done.length, sub: `${done.filter(m => m.kind === 'PREVENTIVE').length} preventivas` }, { label: 'Costo del mes', value: F.money(U.sum(done, m => m.total_amount)) }, { label: 'Días fuera de servicio', value: F.num(U.sum(done, m => m.days_out_of_service || 0)) }, { label: 'KPI-FLO-04 · Mantenimiento por km', value: F.money(k4.value) }]));
    body.appendChild(table({ id: 'flo08', columns: maintCols(true), rows, filters: [{ key: 'vehicle_id', label: 'Vehículo', options: scopedFleet().map(v => [v.id, vLabel(v.id)]) }, { key: 'kind', label: 'Tipo', options: [['PREVENTIVE', 'Preventivo'], ['CORRECTIVE', 'Correctivo']] }, { key: 'status', label: 'Estado', options: [['IN_PROGRESS', 'En taller'], ['OPEN', 'Abierta'], ['DONE', 'Hecha'], ['VOIDED', 'Anulada']] }], onRow: m => maintDrawer(m.id) }));
    if (params.id) setTimeout(() => maintDrawer(params.id), 0);
  }
  function newMaint(pre) {
    drawer('Nueva orden de mantenimiento', (b, close) => b.appendChild(form({ id: 'flo08-n', values: Object.assign({ kind: 'CORRECTIVE', opened_on: G.TODAY, in_workshop: true, workshop_supplier_id: G.db.get('suppliers', 'su-GAS-TALLER') ? 'su-GAS-TALLER' : '' }, pre), fields: [{ key: 'vehicle_id', label: 'Vehículo', type: 'select', options: vehOpts(), required: true }, { key: 'kind', label: 'Tipo', type: 'select', options: [['CORRECTIVE', 'Correctivo'], ['PREVENTIVE', 'Preventivo (desde un plan)']], required: true }, { key: 'plan_id', label: 'Plan', type: 'select', options: G.db.where('vehicle_maintenance_plans', p => p.status === 'ACTIVE').map(p => [p.id, `${code(p.vehicle_id)} · ${p.task}`]) }, { key: 'description', label: 'Trabajo o falla', type: 'textarea', required: true }, { key: 'workshop_supplier_id', label: 'Taller', type: 'select', options: G.ui.opts('suppliers', s => s.trade_name || s.legal_name, s => ['SERVICES'].includes(s.supplier_type)) }, { key: 'workshop_name', label: 'Taller (si no está en la lista)' }, { key: 'opened_on', label: 'Ingreso', type: 'date', required: true }, { key: 'in_workshop', label: 'Queda en taller (el vehículo pasa a «en mantenimiento», RN-FLO-11)', type: 'checkbox', span: 2 }],
      onCancel: close, onSubmit: v => { const m = FLO.openMaintenance(Object.assign({}, v, { plan_id: v.kind === 'PREVENTIVE' ? v.plan_id : null, in_workshop: !!v.in_workshop })); close(); toast(`Orden ${m.number} abierta${m.in_workshop ? `: ${(veh(m.vehicle_id) || {}).plate} en mantenimiento` : ''}`, 'ok'); G.refresh(); maintDrawer(m.id); return true; } })), { code: 'FLO-08' });
  }
  function maintDrawer(id) {
    const m = G.db.get('vehicle_maintenances', id); if (!m) return;
    drawer(`Orden ${m.number} · ${code(m.vehicle_id)}`, (b, close) => {
      const reopen = () => { close(); G.refresh(); maintDrawer(id); };
      const plan = m.plan_id ? G.db.get('vehicle_maintenance_plans', m.plan_id) : null;
      b.appendChild(dl([['Vehículo', vLabel(m.vehicle_id)], ['Tipo', sb(m.kind)], ['Plan', plan ? `${plan.code} · ${plan.task}` : null], ['Vencía', m.due_km != null || m.due_on ? [m.due_km != null ? F.num(m.due_km) + ' km' : null, m.due_on ? F.date(m.due_on) : null].filter(Boolean).join(' o ') : null], ['Trabajo', m.description], ['Taller', m.workshop_name], ['Ingreso', F.date(m.opened_on)], ['Salida', F.date(m.done_on)], ['Odómetro', m.odometer_km ? F.num(m.odometer_km) + ' km' : null], ['Días fuera de servicio', m.days_out_of_service], ['Comprobante', m.doc_number ? `${m.doc_type === 'INVOICE' ? 'Factura' : m.doc_type === 'RECEIPT' ? 'Boleta' : m.doc_type || ''} ${m.doc_number}` : null], ['Gasto en GAS', m.status === 'DONE' ? expLabel(m.expense_id) : null], ['A tiempo', m.on_time == null ? null : m.on_time ? 'Sí' : 'No'], ['Estado', sb(m.status)]]));
      if (m.status === 'DONE') b.appendChild(card('Costo', h('div', null, table({ id: 'flo08-p', search: false, columns: [{ key: 'description', label: 'Repuesto' }, { key: 'qty', label: 'Cant.', align: 'r' }, { key: 'unit_cost', label: 'Unit.', align: 'r', render: p => F.money(p.unit_cost) }, { key: 't', label: 'Total', align: 'r', value: p => F.money(p.qty * p.unit_cost) }], rows: m.parts, empty: 'Sin repuestos.' }), dl([['Repuestos', F.money(m.parts_amount)], ['Mano de obra', F.money(m.labor_amount)], ['Total', h('b', null, F.money(m.total_amount))]]))));
      if (m.status === 'DONE' && !m.expense_id) { const c = FLO.expenseCandidates('MAINT', m.vehicle_id); b.appendChild(card('Gasto del mantenimiento (RN-FLO-17)', h('div', { class: 'stack' }, c.length ? table({ id: 'flo08-c', search: false, columns: [{ key: 'number', label: 'Gasto', mono: true }, { key: 'issue_date', label: 'Fecha', render: e => F.date(e.issue_date) }, { key: 'total', label: 'Total', align: 'r', render: e => F.money(e.total) }, { key: 'description', label: 'Descripción' }], rows: c, actions: e => [btn('Enlazar', () => { if (run(() => FLO.linkExpense('vehicle_maintenances', m.id, e.id), 'Gasto enlazado')) reopen(); }, { sm: true })] }) : null, btn('Registrar el gasto en GAS', () => { if (run(() => { const e = makeExpense({ kind: 'MAINT', vehicle_id: m.vehicle_id, amount: m.total_amount, date: m.done_on, supplier_id: m.workshop_supplier_id, doc_type: m.doc_type || 'INVOICE', doc_number: m.doc_number, description: `${m.number} · ${m.description}`, odometer: m.odometer_km }); FLO.linkExpense('vehicle_maintenances', m.id, e.id); return e; }, e => `Gasto ${e.number} creado y enlazado`)) reopen(); }, { sm: true, kind: 'primary', disabled: !G.can('flo.maintenance.manage') })))); }
      if (['OPEN', 'IN_PROGRESS'].includes(m.status)) {
        const parts = []; const tot = h('div', { class: 'notice info' }); const box = h('div'); const vals = { labor: 0 };
        const drawTot = () => { const pc = U.sum(parts, p => p.qty * p.unit_cost); G.ui.clear(tot).appendChild(h('span', null, `Repuestos ${F.money(pc)} + mano de obra ${F.money(vals.labor)} = `, h('b', null, F.money(pc + Number(vals.labor || 0))))); };
        const drawParts = () => { G.ui.clear(box); box.appendChild(table({ id: 'flo08-np', search: false, columns: [{ key: 'description', label: 'Repuesto' }, { key: 'qty', label: 'Cant.', align: 'r' }, { key: 'unit_cost', label: 'Unit.', align: 'r', render: p => F.money(p.unit_cost) }], rows: parts, empty: 'Agrega los repuestos.', actions: p => [btn('Quitar', () => { parts.splice(parts.indexOf(p), 1); drawParts(); drawTot(); }, { sm: true, kind: 'ghost' })] })); const d = h('input', { class: 'input', placeholder: 'Repuesto', attrs: { 'aria-label': 'Repuesto' } }), q = h('input', { class: 'input', type: 'number', value: 1, style: 'max-width:80px', attrs: { 'aria-label': 'Cantidad' } }), c = h('input', { class: 'input', type: 'number', step: '0.01', placeholder: 'S/', style: 'max-width:100px', attrs: { 'aria-label': 'Costo unitario' } }); box.appendChild(h('div', { class: 'row', style: 'margin-top:6px;flex-wrap:wrap' }, d, q, c, btn('Agregar', () => { if (!d.value || !(Number(q.value) > 0) || !(Number(c.value) >= 0) || c.value === '') return toast('Completa repuesto, cantidad y costo.', 'warn'); parts.push({ description: d.value, qty: Number(q.value), unit_cost: Number(c.value) }); drawParts(); drawTot(); }, { sm: true }))); };
        drawParts();
        b.appendChild(card('Cerrar orden', h('div', null, box, form({ id: 'flo08-c', values: { done_on: G.TODAY, odometer_km: FLO.currentOdo(m.vehicle_id), labor_amount: 0, doc_type: 'INVOICE', create_expense: !!G.gas }, fields: [{ key: 'done_on', label: 'Fecha de salida', type: 'date', required: true }, { key: 'odometer_km', label: 'Odómetro del servicio (km)', type: 'number', min: 0, required: true, help: 'RN-FLO-04: no menor que la última lectura' }, { key: 'labor_amount', label: 'Mano de obra S/', type: 'money', min: 0, onChange: v => { vals.labor = v || 0; drawTot(); } }, { key: 'days_out_of_service', label: 'Días fuera de servicio (vacío = calculado)', type: 'number', min: 0 }, { key: 'doc_type', label: 'Comprobante', type: 'select', options: [['INVOICE', 'Factura'], ['RECEIPT', 'Boleta'], ['FEES_RECEIPT', 'Recibo por honorarios']] }, { key: 'doc_number', label: 'Serie y número', placeholder: 'F001-2300' }, { key: 'workshop_supplier_id', label: 'Taller', type: 'select', options: G.ui.opts('suppliers', s => s.trade_name || s.legal_name, s => ['SERVICES'].includes(s.supplier_type)) }, { key: 'create_expense', label: 'Registrar el gasto en GAS (RN-FLO-17)', type: 'checkbox', span: 2 }],
          submitLabel: 'Cerrar orden', onSubmit: v => { const ds = String(v.doc_number || '').split('-'); const r = FLO.closeMaintenance(m.id, Object.assign({}, v, { parts, create_expense: !!v.create_expense, doc_series: ds.length > 1 ? ds[0] : null, doc_number: v.doc_number || null, workshop_supplier_id: v.workshop_supplier_id || m.workshop_supplier_id })); const p2 = r.plan_id ? G.db.get('vehicle_maintenance_plans', r.plan_id) : null; toast(`Orden ${r.number} cerrada: ${F.money(r.total_amount)}${p2 ? ` · próximo a ${p2.next_due_km != null ? F.num(p2.next_due_km) + ' km' : '—'} o el ${F.date(p2.next_due_on)} (RN-FLO-10)` : ''}`, 'ok'); reopen(); return true; } }), tot)));
        drawTot();
        b.appendChild(h('div', { class: 'row' }, btn('Anular orden', () => modal('Anular ' + m.number, (mb, mc) => mb.appendChild(form({ id: 'flo08-v', fields: [{ key: 'reason', label: 'Motivo', type: 'textarea', required: true }], submitLabel: 'Anular', onCancel: mc, onSubmit: v => { G.db.update('vehicle_maintenances', m.id, { status: 'VOIDED', void_reason: v.reason }); if (!openMaints(m.vehicle_id).some(x => x.in_workshop)) setOpStatus(m.vehicle_id, 'ACTIVE'); mc(); reopen(); return true; } }))), { sm: true, kind: 'danger', disabled: !G.can('flo.maintenance.manage') })));
      }
    }, { code: 'FLO-08', wide: true });
  }

  /* ---------- FLO-09 Documentos ---------- */
  const ownerOf = d => d.vehicle_id ? vLabel(d.vehicle_id) : ((userOfEmp(d.employee_id) || {}).name || (G.db.get('employees', d.employee_id) || {}).full_name || '—');
  const docCols = withOwner => [withOwner ? { key: 'own', label: 'Vehículo o conductor', value: ownerOf } : null, { key: 'doc_type', label: 'Documento', value: d => docName(d.doc_type) }, { key: 'number', label: 'Número', mono: true }, { key: 'issuer', label: 'Emisor' }, { key: 'license_class', label: 'Clase' }, { key: 'issued_on', label: 'Emisión', render: d => F.date(d.issued_on) }, { key: 'expires_on', label: 'Vence', render: d => F.date(d.expires_on) }, { key: 'days', label: 'Días', align: 'r', value: d => d.expires_on ? G.date.diff(d.expires_on, G.TODAY) : null, render: d => d.expires_on ? h('b', { style: G.date.diff(d.expires_on, G.TODAY) < 0 ? 'color:var(--bad)' : G.date.diff(d.expires_on, G.TODAY) <= 15 ? 'color:var(--warn)' : '' }, G.date.diff(d.expires_on, G.TODAY)) : '—' }, { key: 'file_url', label: 'Archivo' }, { key: 'sem', label: 'Semáforo', value: d => d.status === 'ACTIVE' ? FLO.docState(d) : d.status, render: d => d.status === 'ACTIVE' ? sb(FLO.docState(d)) : sb(d.status) }].filter(Boolean);
  function rFLO09(el) {
    const body = page(el, { code: 'FLO-09', title: 'Documentos', sub: `SOAT, revisión técnica, tarjeta de propiedad, contrato de alquiler y licencias de conducir con vencimiento, archivo y semáforo; avisos a ${docAlertDays().join(', ')} días (RN-FLO-13). Con SOAT o revisión técnica vencidos el vehículo no sale (RN-FLO-11); con licencia vencida el conductor no inicia jornada (RN-FLO-12).`, actions: [{ label: 'Registrar o renovar', kind: 'primary', icon: '+', onClick: () => G.require('flo.document.manage', () => docDrawer({})) }] });
    const rows = G.db.where('vehicle_documents', d => d.status === 'ACTIVE').filter(d => !d.vehicle_id || (G.scope.ok(veh(d.vehicle_id) || {}) && tracked(veh(d.vehicle_id))));
    const cnt = s => rows.filter(d => FLO.docState(d) === s).length; const k6 = G.kpi('KPI-FLO-06') || {};
    body.appendChild(kpis([{ label: 'KPI-FLO-06 · Documentos vencidos', value: k6.value ?? cnt('EXPIRED'), tone: cnt('EXPIRED') ? 'bad' : 'ok' }, { label: 'Vencen en 7 días', value: cnt('D7'), tone: cnt('D7') ? 'bad' : '' }, { label: 'Vencen en 15 días', value: cnt('D15'), tone: cnt('D15') ? 'warn' : '' }, { label: 'Vencen en 30 días', value: cnt('D30'), tone: cnt('D30') ? 'info' : '' }, { label: 'Vigentes', value: cnt('VALID') + cnt('NO_EXPIRY'), tone: 'ok' }]));
    const sorted = rows.slice().sort((a, b) => (a.expires_on || '9999') .localeCompare(b.expires_on || '9999'));
    body.appendChild(table({ id: 'flo09', columns: docCols(true), rows: sorted, filters: [{ key: 'doc_type', label: 'Documento', options: DOCS.map(d => [d[0], d[1]]) }, { key: 'sem', label: 'Semáforo', options: [['EXPIRED', 'Vencido'], ['D7', '≤ 7 días'], ['D15', '≤ 15 días'], ['D30', '≤ 30 días'], ['VALID', 'Vigente'], ['NO_EXPIRY', 'Sin vencimiento']], value: d => FLO.docState(d) }, { key: 'k', label: 'Pertenece a', options: [['V', 'Vehículo'], ['E', 'Conductor']], value: d => d.vehicle_id ? 'V' : 'E' }], onRow: d => docDetail(d), actions: d => d.expires_on ? [btn('Renovar', () => G.require('flo.document.manage', () => docDrawer({ doc_type: d.doc_type, vehicle_id: d.vehicle_id, employee_id: d.employee_id, issuer: d.issuer, license_class: d.license_class })), { sm: true, kind: ['EXPIRED', 'D7', 'D15'].includes(FLO.docState(d)) ? 'primary' : 'ghost' })] : [] }));
  }
  function docDetail(d) {
    drawer(`${docName(d.doc_type)} · ${ownerOf(d)}`, b => {
      b.appendChild(dl([['Documento', docName(d.doc_type)], ['Pertenece a', ownerOf(d)], ['Número', d.number], ['Emisor', d.issuer], ['Clase', d.license_class], ['Emisión', F.date(d.issued_on)], ['Vence', F.date(d.expires_on)], ['Archivo', d.file_url], ['Notas', d.notes], ['Semáforo', sb(FLO.docState(d))]]));
      const hist = G.db.where('vehicle_documents', x => x.doc_type === d.doc_type && (d.vehicle_id ? x.vehicle_id === d.vehicle_id : x.employee_id === d.employee_id)).sort(U.by('expires_on', -1));
      b.appendChild(card('Historial', table({ id: 'flo09-h', search: false, columns: docCols(false).filter(c => c.key !== 'days'), rows: hist }), { flush: true }));
    }, { code: 'FLO-09' });
  }
  function docDrawer(pre) {
    drawer('Registrar documento', (b, close) => {
      const st = { file: '' };
      b.appendChild(form({ id: 'flo09-f', values: Object.assign({ doc_type: 'SOAT', issued_on: G.TODAY, expires_on: G.date.add(G.TODAY, 365) }, pre), fields: [{ key: 'doc_type', label: 'Documento', type: 'select', options: DOCS.map(d => [d[0], d[1]]), required: true }, { key: 'vehicle_id', label: 'Vehículo (SOAT, revisión, tarjeta, contrato)', type: 'select', options: vehOpts() }, { key: 'employee_id', label: 'Conductor (licencia)', type: 'select', options: drivers().concat(G.db.where('users', u => u.role === 'COORDINADOR_DELIVERY')).filter((u, i, a) => a.indexOf(u) === i).map(u => [u.employee_id, u.name]) }, { key: 'number', label: 'Número', required: true }, { key: 'issuer', label: 'Emisor' }, { key: 'license_class', label: 'Clase (licencia)' }, { key: 'issued_on', label: 'Emisión', type: 'date' }, { key: 'expires_on', label: 'Vencimiento', type: 'date', help: 'Obligatorio para SOAT, revisión técnica, licencia y contrato (RN-FLO-13)' }, { key: 'notes', label: 'Notas', type: 'textarea' }],
        onCancel: close, onSubmit: v => { const def = DOCS.find(x => x[0] === v.doc_type); const r = FLO.saveDocument(Object.assign({}, v, { vehicle_id: def[2] === 'VEHICLE' ? v.vehicle_id : null, employee_id: def[2] === 'EMPLOYEE' ? v.employee_id : null, file_url: st.file || `docs/${v.doc_type.toLowerCase()}-${v.number}.pdf` })); close(); toast(`${docName(r.doc_type)} ${r.number} registrado${r.replaces_id ? ' (reemplaza al anterior)' : ''}`, 'ok'); G.refresh(); return true; } }));
      b.appendChild(h('label', { class: 'small' }, 'Archivo'), fileInput('Archivo del documento', n => { st.file = n ? 'docs/' + n : ''; }));
    }, { code: 'FLO-09' });
  }

  /* ---------- FLO-10 Multas ---------- */
  const fineCols = withV => [{ key: 'ballot_number', label: 'Papeleta', mono: true }, { key: 'fine_date', label: 'Fecha', render: f => F.date(f.fine_date) }, { key: 'entity', label: 'Entidad', value: f => (ENTITIES.find(e => e[0] === f.entity) || [f.entity, f.entity])[1] }, { key: 'infraction', label: 'Infracción', value: f => [f.infraction_code, f.infraction].filter(Boolean).join(' · ') }, withV ? { key: 'v', label: 'Vehículo', value: f => vLabel(f.vehicle_id) } : null, { key: 'd', label: 'Conductor', value: f => f.driver_user_id ? G.userShort(f.driver_user_id) : '—' }, { key: 'amount', label: 'Importe', align: 'r', render: f => F.money(f.amount) }, { key: 'pp', label: 'Pronto pago', value: f => f.early_discount_pct ? `${f.early_discount_pct} % hasta ${F.date(f.early_discount_until)}` : '—' }, { key: 'paid_amount', label: 'Pagado', align: 'r', render: f => f.paid_amount != null ? F.money(f.paid_amount) : '—' }, { key: 'charged_to_driver', label: 'A cargo de', value: f => f.charged_to_driver ? 'Conductor' : 'Empresa', render: f => f.charged_to_driver ? badge('Conductor (PER)', 'info') : 'Empresa' }, { key: 'status', label: 'Estado', render: f => sb(f.status) }].filter(Boolean);
  function rFLO10(el, params) {
    const body = page(el, { code: 'FLO-10', title: 'Multas', sub: 'Papeleta, fecha, entidad, infracción, conductor (sale de la jornada del día), importe, descuento por pronto pago, pago y descuento al conductor. El descuento exige el acta firmada y la aprobación de RR. HH. y genera la línea en el pago del personal (PER), una sola vez (RN-FLO-15, D-FLO-03).', actions: [{ label: 'Registrar multa', kind: 'primary', icon: '+', onClick: () => G.require('flo.fine.manage', () => fineForm()) }] });
    const rows = G.db.where('traffic_fines', f => f.status !== 'VOIDED').filter(vOk).sort(U.by('fine_date', -1)); const k9 = G.kpi('KPI-FLO-09') || {};
    body.appendChild(kpis([{ label: 'Pendientes de pago', value: rows.filter(f => f.status === 'PENDING').length, sub: F.money(U.sum(rows.filter(f => f.status === 'PENDING'), f => FLO.fineDue(f))), tone: rows.some(f => f.status === 'PENDING') ? 'warn' : 'ok' }, { label: 'Con pronto pago vigente', value: rows.filter(f => f.status === 'PENDING' && f.early_discount_until && f.early_discount_until >= G.TODAY).length }, { label: 'KPI-FLO-09 · A cargo de la empresa (mes)', value: F.money(k9.value) }, { label: 'Descontadas al conductor', value: rows.filter(f => f.charged_to_driver).length }, { label: 'Apeladas', value: rows.filter(f => f.status === 'APPEALED').length }]));
    body.appendChild(table({ id: 'flo10', columns: fineCols(true), rows, filters: [{ key: 'status', label: 'Estado', options: [['PENDING', 'Pendiente'], ['PAID', 'Pagada'], ['APPEALED', 'Apelada']] }, { key: 'vehicle_id', label: 'Vehículo', options: scopedFleet().map(v => [v.id, vLabel(v.id)]) }, { key: 'entity', label: 'Entidad', options: ENTITIES }], onRow: f => fineDrawer(f.id) }));
    if (params.id) setTimeout(() => fineDrawer(params.id), 0);
  }
  function fineForm() {
    drawer('Registrar multa', (b, close) => {
      const info = h('div');
      const f = form({ id: 'flo10-f', values: { fine_date: G.TODAY, entity: 'SAT', early_discount_pct: 0 }, fields: [{ key: 'ballot_number', label: 'N.º de papeleta', required: true }, { key: 'fine_date', label: 'Fecha', type: 'date', required: true, onChange: () => upd() }, { key: 'entity', label: 'Entidad', type: 'select', options: ENTITIES, required: true }, { key: 'infraction_code', label: 'Código', placeholder: 'G-40' }, { key: 'infraction', label: 'Infracción', required: true, span: 2 }, { key: 'vehicle_id', label: 'Vehículo', type: 'select', options: vehOpts(), required: true, onChange: () => upd() }, { key: 'driver_user_id', label: 'Conductor (vacío = el de la jornada)', type: 'select', options: driverOpts() }, { key: 'amount', label: 'Importe S/', type: 'money', min: 0.01, required: true, onChange: () => upd() }, { key: 'early_discount_pct', label: 'Descuento por pronto pago %', type: 'number', min: 0, max: 100, onChange: () => upd() }, { key: 'early_discount_until', label: 'Pronto pago hasta', type: 'date', onChange: () => upd() }, { key: 'notes', label: 'Notas', type: 'textarea' }],
        onCancel: close, onSubmit: v => { const r = FLO.saveFine(v); close(); toast(`Multa ${r.ballot_number} registrada${r.driver_user_id ? ' · conductor ' + G.userShort(r.driver_user_id) : ''}`, 'ok'); G.refresh(); return true; } });
      function upd() { const v = f.api.values; G.ui.clear(info); const d = v.vehicle_id && v.fine_date ? FLO.driverAt(v.vehicle_id, v.fine_date) : null; const a = Number(v.amount) || 0; const p = Number(v.early_discount_pct) || 0; info.appendChild(notice(`${d ? `Conductor de la jornada del ${F.date(v.fine_date)}: ${G.userName(d)}.` : 'No hay jornada de ese vehículo en esa fecha: elige al conductor.'} ${p ? `Con pronto pago hasta el ${F.date(v.early_discount_until)}: ${F.money(a * (1 - p / 100))} (ahorro ${F.money(a * p / 100)}).` : ''}`, 'info')); }
      b.append(f, info); upd();
    }, { code: 'FLO-10' });
  }
  function fineDrawer(id) {
    const f = G.db.get('traffic_fines', id); if (!f) return;
    drawer(`Multa ${f.ballot_number}`, (b, close) => {
      const reopen = () => { close(); G.refresh(); fineDrawer(id); };
      b.appendChild(dl([['Vehículo', vLabel(f.vehicle_id)], ['Conductor', f.driver_user_id ? G.userName(f.driver_user_id) : null], ['Fecha', F.date(f.fine_date)], ['Entidad', (ENTITIES.find(e => e[0] === f.entity) || [, f.entity])[1]], ['Infracción', [f.infraction_code, f.infraction].filter(Boolean).join(' · ')], ['Importe', F.money(f.amount)], ['Pronto pago', f.early_discount_pct ? `${f.early_discount_pct} % hasta ${F.date(f.early_discount_until)} → ${F.money(f.amount * (1 - f.early_discount_pct / 100))}` : null], ['A pagar hoy', f.status === 'PENDING' ? F.money(FLO.fineDue(f)) : null], ['Pagado', f.paid_amount != null ? `${F.money(f.paid_amount)} el ${F.date(f.paid_on)}` : null], ['Gasto en GAS', f.status === 'PAID' ? expLabel(f.expense_id) : null], ['A cargo de', f.charged_to_driver ? 'Conductor: descuento en el pago del personal (PER)' : 'Empresa'], ['Acta firmada', f.acknowledgment_file], ['Aprobó RR. HH.', f.hr_approved_by ? `${G.userName(f.hr_approved_by)} · ${F.datetime(f.hr_approved_at)}` : null], ['Descontado en liquidación', f.deducted_payout_id ? (G.db.get('staff_payouts', f.deducted_payout_id) || {}).number || f.deducted_payout_id : f.deduct_from_payout ? 'Pendiente de la próxima liquidación (PER)' : null], ['Apelación', f.appeal_note], ['Notas', f.notes], ['Estado', sb(f.status)]]));
      const row = h('div', { class: 'row', style: 'flex-wrap:wrap' });
      if (f.status === 'PENDING') {
        row.appendChild(btn(`Pagar ${F.money(FLO.fineDue(f))}`, () => G.require('flo.fine.manage', () => modal('Pagar multa ' + f.ballot_number, (mb, mc) => mb.appendChild(form({ id: 'flo10-p', values: { paid_on: G.TODAY, create_expense: !!G.gas }, fields: [{ key: 'paid_on', label: 'Fecha de pago', type: 'date', required: true, help: f.early_discount_until ? `Pronto pago hasta el ${F.date(f.early_discount_until)}` : null }, { key: 'create_expense', label: 'Registrar el gasto en GAS (RN-FLO-17)', type: 'checkbox' }], submitLabel: 'Registrar pago', onCancel: mc, onSubmit: v => { const r = FLO.payFine(f.id, { paid_on: v.paid_on, create_expense: !!v.create_expense }); mc(); toast(`Multa pagada: ${F.money(r.paid_amount)}${r.discount_amount ? ` (descuento ${F.money(r.discount_amount)})` : ''}`, 'ok'); reopen(); return true; } })))), { sm: true, kind: 'primary' }));
        row.appendChild(btn('Apelar', () => G.require('flo.fine.manage', () => modal('Apelar ' + f.ballot_number, (mb, mc) => mb.appendChild(form({ id: 'flo10-a', fields: [{ key: 'note', label: 'Descargo presentado', type: 'textarea', required: true }], submitLabel: 'Registrar apelación', onCancel: mc, onSubmit: v => { G.db.update('traffic_fines', f.id, { status: 'APPEALED', appeal_note: v.note }); mc(); reopen(); return true; } })))), { sm: true }));
      }
      if (f.status === 'APPEALED') row.appendChild(btn('Apelación rechazada: vuelve a pendiente', () => run(() => G.db.update('traffic_fines', f.id, { status: 'PENDING' }), 'Multa pendiente de pago') && reopen(), { sm: true }));
      if (!f.charged_to_driver && ['PENDING', 'PAID'].includes(f.status)) row.appendChild(btn('Descontar al conductor', () => modal('Descuento al conductor (RN-FLO-15)', (mb, mc) => { const st = { file: '' }; mb.appendChild(notice('D-FLO-03: por defecto no se descuenta; solo con acta de reconocimiento firmada y aprobación de RR. HH. Genera la línea FINE_DEDUCTION en la próxima liquidación (PER).', 'warn')); mb.appendChild(h('label', { class: 'small' }, 'Acta firmada (PDF o foto)')); mb.appendChild(fileInput('Acta firmada', n => { st.file = n ? 'actas/' + n : ''; })); mb.appendChild(btn(`Aprobar como ${G.roleName()}`, () => { if (run(() => FLO.chargeFineToDriver(f.id, { acknowledgment_file: st.file }), 'Descuento aprobado: irá en la próxima liquidación (PER)')) { mc(); reopen(); } }, { kind: 'primary' })); }), { sm: true }));
      row.appendChild(btn('Anular', () => G.require('flo.fine.manage', () => modal('Anular ' + f.ballot_number, (mb, mc) => mb.appendChild(form({ id: 'flo10-v', fields: [{ key: 'reason', label: 'Motivo', type: 'textarea', required: true }], submitLabel: 'Anular', onCancel: mc, onSubmit: v => { if (f.deducted_payout_id) return 'RN-FLO-15: ya se descontó en una liquidación; corrígelo con un reverso en PER.'; G.db.update('traffic_fines', f.id, { status: 'VOIDED', void_reason: v.reason }); mc(); reopen(); return true; } })))), { sm: true, kind: 'danger' }));
      b.appendChild(row);
    }, { code: 'FLO-10' });
  }

  /* ---------- FLO-11 Otros costos ---------- */
  const costCols = withV => [{ key: 'cost_date', label: 'Fecha', render: c => F.date(c.cost_date) }, withV ? { key: 'v', label: 'Vehículo', value: c => vLabel(c.vehicle_id) } : null, { key: 'cost_type', label: 'Tipo', value: c => costName(c.cost_type) }, { key: 'period', label: 'Mes del servicio', value: c => G.date.monthName(c.period || c.cost_date) }, { key: 'notes', label: 'Detalle' }, { key: 'sup', label: 'Proveedor', value: c => c.supplier_id ? G.supName(c.supplier_id) : '—' }, { key: 'doc', label: 'Comprobante', value: c => [c.doc_type ? ({ INVOICE: 'Factura', RECEIPT: 'Boleta', TICKET: 'Ticket', SIMPLE_RECEIPT: 'Recibo simple' }[c.doc_type] || c.doc_type) : null, c.doc_number].filter(Boolean).join(' ') }, { key: 'amount', label: 'Importe', align: 'r', render: c => F.money(c.amount) }, { key: 'exp', label: 'Gasto', value: c => c.expense_id ? 'SI' : 'NO', render: c => c.expense_id ? expLabel(c.expense_id) : h('span', { class: 'muted small' }, 'Sin gasto') }].filter(Boolean);
  function rFLO11(el) {
    const body = page(el, { code: 'FLO-11', title: 'Otros costos del vehículo', sub: 'Alquiler, peajes, cochera, seguros, impuesto vehicular, lavado y otros con su comprobante; entran al costo total del mes (RN-FLO-16) y se enlazan una sola vez a su gasto en GAS (RN-FLO-17).', actions: [{ label: 'Registrar costo', kind: 'primary', icon: '+', onClick: () => G.require('flo.fuel.manage', () => costForm()) }] });
    body.appendChild(pills(MONTHS(), S.month, v => { S.month = v; G.refresh(); }));
    const from = S.month, to = monthEnd(from);
    const rows = G.db.where('vehicle_costs', c => c.status !== 'VOIDED' && ((c.period || G.date.month(c.cost_date)) === from || (c.cost_date >= from && c.cost_date <= to))).filter(vOk).sort(U.by('cost_date', -1));
    const mrows = rows.filter(c => (c.period || G.date.month(c.cost_date)) === from);
    const byT = U.groupBy(mrows, 'cost_type');
    body.appendChild(kpis([{ label: 'Costos del mes', value: F.money(U.sum(mrows, c => c.amount)), sub: `${mrows.length} registros` }].concat(['RENT', 'TOLL', 'PARKING', 'INSURANCE'].map(t => ({ label: costName(t), value: F.money(U.sum(byT[t] || [], c => c.amount)) })))));
    body.appendChild(card('Por tipo y vehículo (mes del servicio)', G.ui.chart.bar({ labels: COST_T.filter(t => byT[t[0]]).map(t => t[1]), series: scopedFleet().filter(v => mrows.some(c => c.vehicle_id === v.id)).map(v => ({ name: code(v.id), values: COST_T.filter(t => byT[t[0]]).map(t => R(U.sum(byT[t[0]].filter(c => c.vehicle_id === v.id), c => c.amount))) })), stacked: true, format: v => F.money(v) })));
    body.appendChild(table({ id: 'flo11', columns: costCols(true), rows, filters: [{ key: 'cost_type', label: 'Tipo', options: COST_T }, { key: 'vehicle_id', label: 'Vehículo', options: scopedFleet().map(v => [v.id, vLabel(v.id)]) }, { key: 'exp', label: 'Gasto', options: [['SI', 'Enlazado'], ['NO', 'Sin gasto']], value: c => c.expense_id ? 'SI' : 'NO' }] }));
  }
  function costForm() {
    drawer('Registrar costo del vehículo', (b, close) => b.appendChild(form({ id: 'flo11-f', values: { cost_type: 'TOLL', cost_date: G.TODAY, doc_type: 'TICKET', create_expense: false }, fields: [{ key: 'vehicle_id', label: 'Vehículo', type: 'select', options: vehOpts(), required: true }, { key: 'cost_type', label: 'Tipo', type: 'select', options: COST_T, required: true }, { key: 'cost_date', label: 'Fecha del comprobante', type: 'date', required: true }, { key: 'period', label: 'Mes del servicio (vacío = el de la fecha)', type: 'date' }, { key: 'amount', label: 'Importe S/', type: 'money', min: 0.01, required: true }, { key: 'supplier_id', label: 'Proveedor', type: 'select', options: G.ui.opts('suppliers', s => s.trade_name || s.legal_name, s => ['SERVICES', 'VEHICLE_RENTAL'].includes(s.supplier_type)) }, { key: 'doc_type', label: 'Comprobante', type: 'select', options: [['INVOICE', 'Factura'], ['RECEIPT', 'Boleta'], ['TICKET', 'Ticket'], ['SIMPLE_RECEIPT', 'Recibo simple']] }, { key: 'doc_number', label: 'Número' }, { key: 'notes', label: 'Detalle', type: 'textarea' }, { key: 'create_expense', label: 'Registrar el gasto en GAS (RN-FLO-17)', type: 'checkbox', span: 2 }],
      onCancel: close, onSubmit: v => { const r = FLO.saveCost(Object.assign({}, v, { create_expense: !!v.create_expense })); close(); toast(`${costName(r.cost_type)} de ${F.money(r.amount)} registrado${r.expense_id ? ' con su gasto' : ''}`, 'ok'); G.refresh(); return true; } })), { code: 'FLO-11' });
  }

  /* ---------- FLO-12 Costo total y comparativo ---------- */
  function rFLO12(el) {
    const body = page(el, { code: 'FLO-12', title: 'Costo total y comparativo', sub: 'Costo mensual por vehículo = combustible + mantenimiento + multas a cargo de la empresa + alquiler + peajes y cochera + seguros e impuestos + otros + depreciación (propios) + costo del conductor; por km real y por entrega (RN-FLO-16). Comparativo propio, alquilado y tercero por zona.' });
    if (!G.can('flo.cost.view')) { body.appendChild(notice('Ver el costo total exige el permiso flo.cost.view (gerencia, administración o auditoría).', 'warn')); return; }
    body.appendChild(pills(MONTHS(), S.month, v => { S.month = v; G.refresh(); }));
    const rows = scopedFleet().map(v => Object.assign({ v }, FLO.monthlyCost(v.id, S.month))).filter(x => x.total > 0 || x.km > 0);
    const tot = FLO.costFormula({ fuel: U.sum(rows, x => x.fuel), maint: U.sum(rows, x => x.maint), fines: U.sum(rows, x => x.fines), rent: U.sum(rows, x => x.rent), tolls: U.sum(rows, x => x.tolls), insurance: U.sum(rows, x => x.insurance), other: U.sum(rows, x => x.other), deprec: U.sum(rows, x => x.deprec), driver: U.sum(rows, x => x.driver), km: U.sum(rows, x => x.km), deliveries: U.sum(rows, x => x.deliveries) });
    const to = monthEnd(S.month) > G.TODAY ? G.TODAY : monthEnd(S.month);
    const k10 = G.kpi('KPI-FLO-10', { from: S.month, to }) || {};
    body.appendChild(kpis([{ label: 'Costo total de la flota', value: F.money(tot.total), sub: `${F.num(U.sum(rows, x => x.km))} km · ${F.num(U.sum(rows, x => x.deliveries))} entregas` }, { label: 'KPI-FLO-03 · Costo por km', value: F.money(tot.per_km) }, { label: 'Costo por entrega (vehículo + conductor)', value: F.money(tot.per_delivery) }, { label: 'KPI-FLO-10 · Propio por entrega', value: F.money((k10.by || {}).OWN), sub: 'solo vehículo (sin conductor)' }, { label: 'KPI-FLO-10 · Alquilado por entrega', value: F.money((k10.by || {}).RENTED), sub: (k10.by || {}).THIRD != null ? `tercero ${F.money(k10.by.THIRD)}` : 'tercero: sin datos de DEL en este armado' }]));
    const m = x => h('span', { style: 'white-space:nowrap' }, F.money(x));
    body.appendChild(table({ id: 'flo12', search: false, columns: [{ key: 'v', label: 'Vehículo', value: x => vLabel(x.v.id) }, { key: 'o', label: 'Modalidad', value: x => OWN[x.v.ownership] }, { key: 'fuel', label: 'Combustible', align: 'r', render: x => m(x.fuel) }, { key: 'maint', label: 'Mantenim.', align: 'r', render: x => m(x.maint) }, { key: 'fines', label: 'Multas', align: 'r', render: x => m(x.fines) }, { key: 'rent', label: 'Alquiler', align: 'r', render: x => h('span', { title: x.rent_accrued ? 'Devengado: tarifa diaria × jornadas (sin factura aún)' : '' }, m(x.rent) + (x.rent_accrued ? ' *' : '')) }, { key: 'tolls', label: 'Peajes y cochera', align: 'r', render: x => m(x.tolls) }, { key: 'insurance', label: 'Seguros e imp.', align: 'r', render: x => m(x.insurance) }, { key: 'other', label: 'Otros', align: 'r', render: x => m(x.other) }, { key: 'deprec', label: 'Depreciación', align: 'r', render: x => m(x.deprec) }, { key: 'driver', label: 'Conductor', align: 'r', render: x => m(x.driver) }, { key: 'total', label: 'Total', align: 'r', render: x => h('b', null, m(x.total)) }, { key: 'km', label: 'Km reales', align: 'r', render: x => F.num(x.km) }, { key: 'deliveries', label: 'Entregas', align: 'r' }, { key: 'per_km', label: 'S/ por km', align: 'r', render: x => m(x.per_km) }, { key: 'per_delivery', label: 'S/ por entrega', align: 'r', render: x => m(x.per_delivery) }], rows, onRow: x => G.go('FLO-04', { id: x.v.id }), footer: ['Total', '', m(U.sum(rows, x => x.fuel)), m(U.sum(rows, x => x.maint)), m(U.sum(rows, x => x.fines)), m(U.sum(rows, x => x.rent)), m(U.sum(rows, x => x.tolls)), m(U.sum(rows, x => x.insurance)), m(U.sum(rows, x => x.other)), m(U.sum(rows, x => x.deprec)), m(U.sum(rows, x => x.driver)), h('b', null, m(tot.total)), F.num(U.sum(rows, x => x.km)), F.num(U.sum(rows, x => x.deliveries)), m(tot.per_km), m(tot.per_delivery)].map(v => ({ v, align: 'r' })) }));
    body.appendChild(h('div', { class: 'small muted' }, '* Alquiler devengado (tarifa diaria × jornadas) mientras llega la factura. Costo del conductor: sueldo del trabajador ÷ días hábiles del mes × jornadas en el vehículo (respaldo mientras PER no publique el costo del personal). Importes con IGV.'));
    const g = h('div', { class: 'grid c2' });
    const parts = [['fuel', 'Combustible'], ['maint', 'Mantenimiento'], ['rent', 'Alquiler'], ['tolls', 'Peajes y cochera'], ['insurance', 'Seguros'], ['other', 'Otros y multas'], ['deprec', 'Depreciación'], ['driver', 'Conductor']];
    g.appendChild(card('Composición del costo por vehículo', G.ui.chart.bar({ labels: rows.map(x => code(x.v.id)), series: parts.map(([k, n]) => ({ name: n, values: rows.map(x => R(k === 'other' ? x.other + x.fines : x[k])) })), stacked: true, format: v => F.money(v, 0) })));
    g.appendChild(card('Costo por km', G.ui.chart.hbar({ items: rows.filter(x => x.per_km != null).map(x => ({ label: vLabel(x.v.id), value: x.per_km, tone: x.per_km > (tot.per_km || 0) * 1.2 ? 'bad' : '' })), format: v => F.money(v) })));
    body.appendChild(g);
    const cz = FLO.compareByZone(S.month);
    body.appendChild(card('Comparativo por zona: costo del vehículo por entrega', h('div', null, table({ id: 'flo12-z', search: false, columns: [{ key: 'z', label: 'Zona', value: r => G.zoneName(r.zone_id) }, { key: 'own_n', label: 'Entregas propio', align: 'r' }, { key: 'own_cpd', label: 'Propio por entrega', align: 'r', render: r => F.money(r.own_cpd) }, { key: 'rent_n', label: 'Entregas alquilado', align: 'r' }, { key: 'rent_cpd', label: 'Alquilado por entrega', align: 'r', render: r => F.money(r.rent_cpd) }, { key: 'third_cpd', label: 'Tercero (tarifa DEL)', align: 'r', render: r => F.money(r.third_cpd) }, { key: 'best', label: 'Conviene', render: r => r.best ? badge(r.best, 'ok') : '—' }], rows: cz, empty: 'Sin entregas en el mes.' }), h('div', { class: 'small muted', style: 'padding:8px 12px' }, 'El costo de cada vehículo se reparte entre sus entregas según la distancia del local a la zona. Tercero: tarifa por entrega vigente de la empresa de delivery (carrier_rates de DEL); D-FLO-04: esos repartidores no usan la app.')), { flush: true }));
  }

  /* ---------- FLO-13 Temperatura de vehículos ---------- */
  function rFLO13(el, params) {
    const refr = scopedFleet().filter(v => FLO.tempRange(v.id));
    const st = S.tp = Object.assign(S.tp || { vid: (refr[0] || {}).id, date: '2026-10-09' }, params.vid ? { vid: params.vid, date: params.date || G.TODAY } : {});
    const body = page(el, { code: 'FLO-13', title: 'Temperatura de vehículos', sub: `Temperatura por jornada frente al rango permitido (por defecto 0 a 4 °C; congelado −18 °C o menos). Cada lectura fuera de rango queda marcada; si la excursión dura más de ${num('flo_temp_excursion_minutes', 15)} min se alerta y los pedidos de la ruta pasan a revisión de calidad (RN-FLO-14). Lecturas de solo inserción (RN-FLO-03).`, actions: [{ label: 'Registrar lectura', icon: '+', onClick: () => G.require('flo.live.view', () => tempForm(st.vid)) }] });
    if (!refr.length) { body.appendChild(G.ui.empty('No hay vehículos refrigerados (D-FLO-01: ninguno por defecto). Márcalo en la ficha del vehículo.')); return; }
    const sel = h('select', { class: 'input', style: 'max-width:300px', attrs: { 'aria-label': 'Vehículo refrigerado' } }, refr.map(v => h('option', { value: v.id, selected: v.id === st.vid }, vLabel(v.id))));
    const dt = h('input', { class: 'input', type: 'date', value: st.date, style: 'max-width:170px', attrs: { 'aria-label': 'Fecha' } });
    sel.addEventListener('change', () => { st.vid = sel.value; G.refresh(); }); dt.addEventListener('change', () => { st.date = dt.value; G.refresh(); });
    body.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap' }, sel, dt));
    const rg = FLO.tempRange(st.vid); const k7 = G.kpi('KPI-FLO-07') || {};
    const mex = FLO.excursions(st.vid, G.date.month(st.date), monthEnd(G.date.month(st.date)));
    const rs = tempsOfVeh(st.vid).filter(x => x.read_at.startsWith(st.date));
    body.appendChild(kpis([{ label: 'Lecturas del día', value: rs.length, sub: rs.length ? `${hm(rs[0].read_at)} a ${hm(rs[rs.length - 1].read_at)}` : '—' }, { label: 'Fuera de rango (día)', value: rs.filter(x => !x.in_range).length, tone: rs.some(x => !x.in_range) ? 'bad' : 'ok' }, { label: 'Máxima del día', value: rs.length ? F.num(Math.max(...rs.map(x => x.temp_c)), 1) + ' °C' : '—', sub: `rango ${rg.min ?? '—'} a ${rg.max} °C` }, { label: 'KPI-FLO-07 · Min fuera de rango (mes)', value: F.num(k7.value), tone: k7.value ? 'warn' : 'ok', sub: `${mex.length} excursión(es) de ${vLabel(st.vid)}` }]));
    if (rs.length) {
      const lbl = rs.map(x => hm(x.read_at)); const vals = rs.map(x => x.temp_c);
      body.appendChild(card(`Temperatura del ${F.date(st.date)} · ${vLabel(st.vid)}`, G.ui.chart.line({ labels: lbl, series: [{ name: 'Temperatura °C', values: vals }, { name: `Máximo ${rg.max} °C`, values: vals.map(() => rg.max), color: 'var(--bad)' }].concat(rg.min != null ? [{ name: `Mínimo ${rg.min} °C`, values: vals.map(() => rg.min), color: 'var(--info)' }] : []), min: Math.min(rg.min ?? rg.max - 6, ...vals) - 1, max: Math.max(rg.max + 3, ...vals) + 1, format: v => F.num(v, 1) + ' °C' })));
    } else body.appendChild(G.ui.empty('Sin lecturas ese día (el vehículo no tuvo jornada o el sensor no envió).'));
    const exRows = FLO.excursions(st.vid, G.date.add(G.TODAY, -45), G.TODAY).reverse().map(e => { const t = G.db.get('vehicle_trips', e.trip_id) || {}; const a = G.db.find('fleet_alerts', x => x.alert_type === 'TEMPERATURE' && x.origin === 'trip:' + e.trip_id); return Object.assign({ t, a }, e); });
    body.appendChild(card('Excursiones de los últimos 45 días', table({ id: 'flo13', search: false, columns: [{ key: 'start', label: 'Inicio', render: e => F.datetime(e.start) }, { key: 'end', label: 'Fin', render: e => hm(e.end) + (e.open ? ' (sigue)' : '') }, { key: 'minutes', label: 'Minutos', align: 'r', render: e => badge(F.num(e.minutes), e.minutes > num('flo_temp_excursion_minutes', 15) ? 'bad' : 'warn') }, { key: 'max', label: 'Máx. °C', align: 'r', render: e => F.num(e.max, 1) }, { key: 'trip', label: 'Jornada', mono: true, value: e => e.t.number }, { key: 'ped', label: 'Pedidos afectados', value: e => e.a ? (e.a.order_reviews || []).map(x => `${x.number} (${(ST[x.status] || [x.status])[0].toLowerCase()})`).join(', ') : 'Sin alerta (≤ límite)' }, { key: 'al', label: 'Alerta', value: e => e.a ? e.a.number : '—', render: e => e.a ? h('span', null, h('span', { class: 'mono' }, e.a.number), ' ', sb(e.a.status)) : '—' }], rows: exRows, empty: 'Sin excursiones.', onRow: e => { if (e.a) G.go('FLO-14', { id: e.a.id }); else { st.date = e.start.slice(0, 10); G.refresh(); } } }), { flush: true }));
  }
  function tempForm(vid) {
    drawer('Registrar lectura de temperatura', (b, close) => b.appendChild(form({ id: 'flo13-f', values: { vehicle_id: vid, read_at: FLO.clock().slice(0, 16) }, fields: [{ key: 'vehicle_id', label: 'Vehículo', type: 'select', options: vehOpts(v => FLO.tempRange(v.id)), required: true }, { key: 'read_at', label: 'Fecha y hora', type: 'datetime', required: true }, { key: 'temp_c', label: 'Temperatura °C', type: 'number', required: true }],
      onCancel: close, onSubmit: v => { const r = FLO.recordTemp({ vehicle_id: v.vehicle_id, read_at: v.read_at + ':00', temp_c: v.temp_c, source: 'MANUAL' }); close(); toast(r.in_range ? `Lectura ${F.num(r.temp_c, 1)} °C en rango` : `Lectura ${F.num(r.temp_c, 1)} °C fuera de rango (RN-FLO-14)`, r.in_range ? 'ok' : 'warn'); G.refresh(); return true; } })), { code: 'FLO-13' });
  }

  /* ---------- FLO-14 Alertas de flota ---------- */
  function rFLO14(el, params) {
    const body = page(el, { code: 'FLO-14', title: 'Alertas de flota', sub: 'Bandeja de alertas de rendimiento, mantenimiento, documentos, temperatura, GPS silencioso, odómetro y velocidad con atención y cierre. Solo hay una alerta abierta por vehículo, tipo y origen; las repeticiones se suman (RN-FLO-20).', actions: [{ label: 'Revisar ahora', icon: '⟳', onClick: () => run(() => FLO.scan(), r => `Barrido hecho: ${r.length} alerta(s) vigentes de documentos, mantenimiento y GPS`) }] });
    const rows = G.db.all('fleet_alerts').filter(a => !a.vehicle_id || G.scope.ok(veh(a.vehicle_id) || {})).sort((a, b) => (a.status === 'CLOSED') - (b.status === 'CLOSED') || b.last_at.localeCompare(a.last_at));
    const open = rows.filter(a => a.status !== 'CLOSED');
    body.appendChild(kpis(ALERT_T.map(([t, n]) => { const c = open.filter(a => a.alert_type === t); return { label: n, value: c.length, tone: c.some(a => a.severity === 'bad') ? 'bad' : c.length ? 'warn' : 'ok' }; })));
    body.appendChild(table({ id: 'flo14', columns: [{ key: 'number', label: 'N.º', mono: true }, { key: 'alert_type', label: 'Tipo', value: a => alertName(a.alert_type) }, { key: 'v', label: 'Vehículo o conductor', value: a => a.vehicle_id ? vLabel(a.vehicle_id) : ((userOfEmp(a.employee_id) || {}).name || '—') }, { key: 'title', label: 'Alerta' }, { key: 'severity', label: 'Nivel', render: a => badge({ bad: 'Alta', warn: 'Media', info: 'Baja' }[a.severity] || a.severity, a.severity) }, { key: 'occurrences', label: 'Veces', align: 'r' }, { key: 'first_at', label: 'Desde', render: a => F.datetime(a.first_at) }, { key: 'last_at', label: 'Última', render: a => F.datetime(a.last_at) }, { key: 'status', label: 'Estado', render: a => sb(a.status) }],
      rows, filters: [{ key: 'status', label: 'Estado', options: [['OPEN', 'Abierta'], ['ACK', 'En atención'], ['CLOSED', 'Cerrada']] }, { key: 'alert_type', label: 'Tipo', options: ALERT_T }, { key: 'vehicle_id', label: 'Vehículo', options: scopedFleet().map(v => [v.id, vLabel(v.id)]) }], onRow: a => alertDrawer(a.id) }));
    if (params.id) setTimeout(() => alertDrawer(params.id), 0);
  }
  function alertDrawer(id) {
    const a = G.db.get('fleet_alerts', id); if (!a) return;
    drawer(`Alerta ${a.number}`, (b, close) => {
      const reopen = () => { close(); G.refresh(); alertDrawer(id); };
      b.appendChild(notice([h('b', null, a.title), h('div', { class: 'small' }, a.detail)], a.severity === 'bad' ? 'bad' : a.severity === 'info' ? 'info' : 'warn'));
      b.appendChild(dl([['Tipo', alertName(a.alert_type)], ['Vehículo', a.vehicle_id ? vLabel(a.vehicle_id) : null], ['Conductor', a.employee_id ? ((userOfEmp(a.employee_id) || {}).name || (G.db.get('employees', a.employee_id) || {}).full_name) : null], ['Origen', a.origin], ['Repeticiones', a.occurrences], ['Primera', F.datetime(a.first_at)], ['Última', F.datetime(a.last_at)], ['Atención', a.ack_at ? `${G.userName(a.ack_by)} · ${F.datetime(a.ack_at)} · ${a.ack_note}` : null], ['No conformidad (CAL)', a.nc_number], ['Cierre', a.closed_at ? `${a.closed_by ? G.userName(a.closed_by) : 'Sistema'} · ${F.datetime(a.closed_at)} · ${a.resolution}` : null], ['Estado', sb(a.status)]]));
      if (a.alert_type === 'TEMPERATURE' && (a.order_reviews || []).length) b.appendChild(card('Pedidos en revisión de calidad (RN-FLO-14)', table({ id: 'flo14-o', search: false, columns: [{ key: 'number', label: 'Pedido', mono: true }, { key: 'c', label: 'Cliente', value: x => G.custName((G.db.get('sales_orders', x.order_id) || {}).customer_id) }, { key: 'status', label: 'Revisión', render: x => sb(x.status) }, { key: 'note', label: 'Nota' }], rows: a.order_reviews, actions: x => x.status === 'PENDING' && a.status !== 'CLOSED' ? [btn('Liberar', () => { if (run(() => FLO.reviewOrder(a.id, x.order_id, 'RELEASED', 'Producto revisado conforme'), `Pedido ${x.number} liberado`)) reopen(); }, { sm: true }), btn('Rechazar', () => modal(`Rechazar ${x.number}`, (mb, mc) => mb.appendChild(form({ id: 'flo14-r', fields: [{ key: 'note', label: 'Motivo (reclamo o reposición)', type: 'textarea', required: true }], submitLabel: 'Rechazar', onCancel: mc, onSubmit: v => { FLO.reviewOrder(a.id, x.order_id, 'REJECTED', v.note); mc(); reopen(); return true; } }))), { sm: true, kind: 'danger' })] : [] }), { flush: true }));
      const row = h('div', { class: 'row' });
      if (a.status === 'OPEN') row.appendChild(btn('Atender', () => modal('Atender ' + a.number, (mb, mc) => mb.appendChild(form({ id: 'flo14-a', fields: [{ key: 'note', label: 'Acción tomada', type: 'textarea', required: true }], submitLabel: 'Registrar', onCancel: mc, onSubmit: v => { FLO.ackAlert(a.id, v.note); mc(); reopen(); return true; } }))), { sm: true, kind: 'primary' }));
      if (a.status !== 'CLOSED') row.appendChild(btn('Cerrar', () => modal('Cerrar ' + a.number, (mb, mc) => mb.appendChild(form({ id: 'flo14-c', fields: [{ key: 'resolution', label: 'Resolución', type: 'textarea', required: true }], submitLabel: 'Cerrar alerta', onCancel: mc, onSubmit: v => { FLO.closeAlert(a.id, v.resolution); mc(); reopen(); return true; } }))), { sm: true }));
      const go = { FUEL_EFFICIENCY: ['FLO-06', {}], MAINTENANCE: ['FLO-07', {}], DOCUMENT: ['FLO-09', {}], TEMPERATURE: ['FLO-13', { vid: a.vehicle_id, date: (a.excursion_start || a.first_at).slice(0, 10) }], GPS_SILENT: ['FLO-01', {}], ODOMETER: ['FLO-03', { id: (a.origin || '').replace('trip:', '') }], SPEED: ['FLO-02', { vid: a.vehicle_id, date: (a.episode_start || a.first_at).slice(0, 10) }] }[a.alert_type];
      if (go) row.appendChild(btn('Ver origen', () => { close(); G.go(go[0], go[1]); }, { sm: true, kind: 'ghost' }));
      b.appendChild(row);
    }, { code: 'FLO-14', wide: true });
  }

  /* ---------- FLO-15 App · Jornada (marco .phone) ---------- */
  function rFLO15(el) {
    const body = page(el, { code: 'FLO-15', title: 'App · Jornada', sub: 'App Android del conductor: inicio y cierre de jornada con odómetro, foto del tablero y checklist (luces, llantas, caja térmica). Bloquea si hay documentos vencidos o mantenimiento vencido (RN-FLO-11/12). Durante la jornada envía la posición y registra cargas.' });
    const me = G.ctx.role === 'REPARTIDOR' ? G.ctx.userId() : null;
    const st = S.app = S.app || { uid: me || (G.db.find('users', u => u.role === 'REPARTIDOR') || {}).id, ck: {}, photo: '', vid: null };
    if (me) st.uid = me;
    const phone = h('div', { class: 'phone' }); const scr = h('div', { class: 'phone-screen', style: 'padding:14px;gap:10px' }); phone.appendChild(scr);
    const u = user(st.uid) || {};
    const lic = FLO.licenseOf(u.employee_id);
    const t = FLO.openTripOfDriver(st.uid);
    scr.appendChild(h('div', { class: 'row between' }, h('b', null, 'Aycha Reparto'), h('span', { class: 'small muted' }, `${(u.name || '').split(' ').slice(0, 2).join(' ')} · ${hm(FLO.clock())}`)));
    if (!me) { const s = h('select', { class: 'input', attrs: { 'aria-label': 'Conductor' } }, drivers().map(x => h('option', { value: x.id, selected: x.id === st.uid }, x.name))); s.addEventListener('change', () => { st.uid = s.value; st.vid = null; st.ck = {}; G.refresh(); }); scr.append(h('div', { class: 'small muted' }, 'Vista previa como:'), s); }
    scr.appendChild(lic ? notice(`Licencia ${lic.number} (${lic.license_class || '—'}) vence el ${F.date(lic.expires_on)}${lic.expires_on < G.TODAY ? ': VENCIDA (RN-FLO-12)' : G.date.diff(lic.expires_on, G.TODAY) <= 15 ? ` · faltan ${G.date.diff(lic.expires_on, G.TODAY)} días` : ''}`, lic.expires_on < G.TODAY ? 'bad' : G.date.diff(lic.expires_on, G.TODAY) <= 15 ? 'warn' : 'ok') : notice('Sin licencia registrada: no puede iniciar jornada (RN-FLO-12).', 'bad'));
    if (!t) {
      const usual = G.db.where('vehicle_trips', x => x.driver_user_id === st.uid).sort(U.by('trip_date', -1))[0];
      if (!st.vid || !veh(st.vid)) st.vid = usual ? usual.vehicle_id : (fleet()[0] || {}).id;
      const v = veh(st.vid);
      scr.appendChild(h('b', null, 'Iniciar jornada'));
      const vs = h('select', { class: 'input', attrs: { 'aria-label': 'Vehículo' } }, fleet().map(x => h('option', { value: x.id, selected: x.id === st.vid }, `${vLabel(x.id)}${FLO.openTrip(x.id) ? ' (en jornada)' : ''}`))); vs.addEventListener('change', () => { st.vid = vs.value; st.ck = {}; G.refresh(); });
      scr.appendChild(vs);
      const why = v ? FLO.whyNotOperable(v.id) : []; const ot = v ? FLO.openTrip(v.id) : null;
      if (why.length) scr.appendChild(notice([h('b', null, 'No puede salir (RN-FLO-11): '), why.map(w => w.msg).join(' ')], 'bad'));
      if (ot) scr.appendChild(notice(`${v.plate} ya tiene la jornada ${ot.number} abierta por ${G.userShort(ot.driver_user_id)} (RN-FLO-02).`, 'warn'));
      const odo = h('input', { class: 'input', type: 'number', value: v ? FLO.currentOdo(v.id) : '', attrs: { 'aria-label': 'Odómetro inicial' } });
      scr.append(h('label', { class: 'small' }, `Odómetro inicial (última lectura ${v ? F.num(FLO.currentOdo(v.id)) : '—'} km)`), odo, h('label', { class: 'small' }, 'Foto del tablero'), fileInput('Foto del tablero', n => { st.photo = n; }));
      scr.appendChild(h('b', { class: 'small' }, 'Checklist'));
      for (const [k, l] of checkItems(v || {})) scr.appendChild(h('div', { class: 'row between', style: 'gap:6px' }, h('span', { class: 'small' }, l), pills([['SI', 'Conforme'], ['NO', 'Observado']], st.ck[k] === true ? 'SI' : st.ck[k] === false ? 'NO' : '', x => { st.ck[k] = x === 'SI'; G.refresh(); })));
      const notes = h('textarea', { class: 'input', placeholder: 'Observaciones (obligatorio si algo está observado)', attrs: { 'aria-label': 'Observaciones' } });
      scr.appendChild(notes);
      scr.appendChild(btn('Iniciar jornada', () => { try { const r = FLO.startTrip({ vehicle_id: st.vid, driver_user_id: st.uid, odometer: odo.value === '' ? null : Number(odo.value), photo: st.photo || null, checklist: st.ck, notes: notes.value }); st.ck = {}; st.photo = ''; toast(`Jornada ${r.number} iniciada: la app enviará la posición cada ${num('flo_gps_interval_seconds', 30)} s`, 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); } }, { kind: 'primary', disabled: !G.can('flo.trip.operate') && !G.can('flo.live.view') }));
    } else {
      const v = veh(t.vehicle_id); const ps = positionsOf(t.id); const lp = ps[ps.length - 1]; const ns = nextStopOf(t);
      scr.appendChild(h('div', { class: 'card', style: 'padding:10px' }, h('div', { class: 'row between' }, h('b', null, `${t.number} · ${vLabel(v.id)}`), sb(liveState(t))), h('div', { class: 'small muted' }, `Desde ${hm(t.started_at)} · inicial ${F.num(t.odometer_start)} km · ${F.num(FLO.gpsKm(ps), 1)} km GPS · ${FLO.deliveriesOf(t)} entregas`), h('div', { class: 'small' }, ns.o ? `Próxima: ${ns.o.number} · ${G.zoneName(ns.o.zone_id)} (${F.num(ns.km, 1)} km)` : 'Sin entregas pendientes'), lp ? h('div', { class: 'small muted' }, `Última posición ${hm(lp.recorded_at)} · ${F.num(lp.speed_kmh)} km/h`) : null));
      const step = () => { const from = lp ? [lp.lat, lp.lng] : sitePt(t.establishment_id); const to = ns.o ? orderPt(ns.o) : sitePt(t.establishment_id); const d = G.geo.km(from, to); const adv = Math.min(1, 0.2 / Math.max(d, 0.001)); const at = tadd(lp && lp.recorded_at > FLO.clock() ? lp.recorded_at : FLO.clock(), num('flo_gps_interval_seconds', 30)); return { vehicle_id: v.id, recorded_at: at, lat: R(from[0] + (to[0] - from[0]) * adv, 6), lng: R(from[1] + (to[1] - from[1]) * adv, 6), speed_kmh: d < 0.05 ? 0 : 24 }; };
      scr.appendChild(h('div', { class: 'grid c2', style: 'gap:8px' }, btn('Enviar posición', () => run(() => FLO.recordPosition(step()), 'Posición enviada'), { sm: true }), btn('Subir sin señal', () => { const p0 = step(); const list = [0, 1, 2, 3].map(k => Object.assign({}, p0, { recorded_at: tadd(p0.recorded_at, k * 30) })); if (lp) list.push({ vehicle_id: v.id, recorded_at: lp.recorded_at, lat: lp.lat, lng: lp.lng, speed_kmh: lp.speed_kmh }); const r = FLO.recordBatch(list); toast(`${r.inserted} posiciones subidas; ${r.duplicates} reenviada(s) ignorada(s) (RN-FLO-01)`, 'ok'); G.refresh(); }, { sm: true })));
      scr.appendChild(h('div', { class: 'grid c2', style: 'gap:8px' }, btn('Registrar carga', () => G.require('flo.trip.operate', () => fuelForm({ vehicle_id: v.id, source: 'APP' }, () => G.refresh())), { sm: true }), v.refrigerated ? btn('Lectura de temperatura', () => tempForm(v.id), { sm: true }) : h('span')));
      scr.appendChild(h('b', null, 'Cerrar jornada'));
      const odo = h('input', { class: 'input', type: 'number', value: Math.max(FLO.currentOdo(v.id), Math.round(t.odometer_start + FLO.gpsKm(ps) * 1.04)), attrs: { 'aria-label': 'Odómetro final' } });
      scr.append(h('label', { class: 'small' }, 'Odómetro final'), odo, h('label', { class: 'small' }, 'Foto del tablero'), fileInput('Foto del tablero al cierre', n => { st.photo = n; }));
      for (const [k, l] of checkItems(v)) scr.appendChild(h('div', { class: 'row between', style: 'gap:6px' }, h('span', { class: 'small' }, l), pills([['SI', 'Conforme'], ['NO', 'Observado']], st.ck[k] === true ? 'SI' : st.ck[k] === false ? 'NO' : 'SI', x => { st.ck[k] = x === 'SI'; G.refresh(); })));
      scr.appendChild(btn('Cerrar jornada', () => { try { const ck = {}; for (const [k] of checkItems(v)) ck[k] = st.ck[k] !== false; const r = FLO.endTrip(t.id, { odometer: Number(odo.value), photo: st.photo || null, checklist: ck }); st.ck = {}; st.photo = ''; toast(`Jornada cerrada: ${F.num(r.km_odometer)} km reales · ${F.num(r.km_gps, 1)} km GPS`, 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); } }, { kind: 'danger' }));
    }
    const mine = G.db.where('vehicle_trips', x => x.driver_user_id === st.uid).sort(U.by('trip_date', -1)).slice(0, 10);
    const side = h('div', { class: 'stack' },
      card('Mis últimas jornadas', table({ id: 'flo15', search: false, pageSize: 10, columns: [{ key: 'trip_date', label: 'Fecha', render: x => F.date(x.trip_date) }, { key: 'v', label: 'Vehículo', value: x => code(x.vehicle_id) }, { key: 'km_odometer', label: 'Km', align: 'r', render: x => F.num(x.km_odometer) }, { key: 'deliveries', label: 'Entregas', align: 'r' }, { key: 'status', label: 'Estado', render: x => sb(x.status) }], rows: mine, onRow: x => tripDrawer(x.id) }), { flush: true }),
      card('Reglas de la app', h('ul', { class: 'small', style: 'margin:0;padding-left:18px' }, h('li', null, `Posición cada ${num('flo_gps_interval_seconds', 30)} s solo con jornada abierta; sin señal guarda y sube en lote sin duplicar (RN-FLO-01/02).`), h('li', null, 'El odómetro nunca baja (RN-FLO-04).'), h('li', null, 'No sale con SOAT o revisión vencidos, en mantenimiento o con un mantenimiento vencido por más de 1 000 km (RN-FLO-11).'), h('li', null, 'Licencia vencida: no inicia jornada (RN-FLO-12).'), h('li', null, 'D-FLO-04: los repartidores de empresas de delivery no usan la app.')))
    );
    body.appendChild(h('div', { class: 'grid c2' }, phone, side));
  }

  /* ---------- registro ---------- */
  const SP = G.SPEC && G.SPEC.FLO;
  const nameOf = c => ((SP && SP.screens.find(s => s[0] === c)) || [c, c])[1];
  const RENDER = { 'FLO-01': rFLO01, 'FLO-02': rFLO02, 'FLO-03': rFLO03, 'FLO-04': rFLO04, 'FLO-05': rFLO05, 'FLO-06': rFLO06, 'FLO-07': rFLO07, 'FLO-08': rFLO08, 'FLO-09': rFLO09, 'FLO-10': rFLO10, 'FLO-11': rFLO11, 'FLO-12': rFLO12, 'FLO-13': rFLO13, 'FLO-14': rFLO14, 'FLO-15': rFLO15 };
  G.register({ code: 'FLO', name: 'Flota avanzada', phase: 3, group: 'Logística y reparto', screens: Object.keys(RENDER).map(c => Object.assign({ code: c, name: nameOf(c), render: RENDER[c] }, c === 'FLO-15' ? { roles: ['REPARTIDOR', 'COORDINADOR_DELIVERY'] } : {})) });

  /* =====================================================================
     Indicadores (TAB)
     ===================================================================== */
  const K = G.kpiCalc;
  const fleetP = p => fleet().filter(v => !p.site || v.establishment_id === p.site);
  const closedTrips = p => { const ids = new Set(fleetP(p).map(v => v.id)); return G.db.where('vehicle_trips', t => ids.has(t.vehicle_id) && t.status === 'CLOSED' && t.trip_date >= p.from && t.trip_date <= p.to); };
  K['KPI-FLO-01'] = p => { const ts = closedTrips(p); const km = U.sum(ts, t => t.km_odometer || 0), n = U.sum(ts, t => t.deliveries || 0); return { value: n ? R(km / n, 2) : null, numerator: km, denominator: n }; };
  K['KPI-FLO-02'] = p => { const ids = new Set(fleetP(p).map(v => v.id)); const ls = G.db.where('fuel_loads', f => ids.has(f.vehicle_id) && f.status !== 'VOIDED' && f.km_per_gal != null && f.loaded_at.slice(0, 10) >= p.from && f.loaded_at.slice(0, 10) <= p.to); const km = U.sum(ls, f => f.km_since_full), g = R(U.sum(ls, f => f.gallons_since_full), 3); return { value: g ? R(km / g, 1) : null, numerator: km, denominator: g }; };
  const costsP = p => { const months = []; for (let m = G.date.month(p.from); m <= p.to; m = G.date.addMonths(m, 1)) months.push(m); return fleetP(p).flatMap(v => months.map(m => FLO.monthlyCost(v.id, m))); };
  K['KPI-FLO-03'] = p => { const cs = costsP(p); const t = U.sum(cs, c => c.total), km = U.sum(cs, c => c.km); return { value: km ? R(t / km, 2) : null, numerator: R(t), denominator: km }; };
  K['KPI-FLO-04'] = p => { const cs = costsP(p); const t = U.sum(cs, c => c.maint), km = U.sum(cs, c => c.km); return { value: km ? R(t / km, 3) : null, numerator: R(t), denominator: km }; };
  K['KPI-FLO-05'] = p => { const ids = new Set(fleetP(p).map(v => v.id)); const ms = G.db.where('vehicle_maintenances', m => ids.has(m.vehicle_id) && m.kind === 'PREVENTIVE' && m.status !== 'VOIDED' && m.due_on && m.due_on >= p.from && m.due_on <= p.to); const missed = G.db.where('vehicle_maintenance_plans', x => ids.has(x.vehicle_id) && x.status === 'ACTIVE' && x.next_due_on && x.next_due_on >= p.from && x.next_due_on <= p.to && x.next_due_on < G.TODAY && !G.db.find('vehicle_maintenances', m => m.plan_id === x.id && m.status !== 'VOIDED' && m.due_on === x.next_due_on)); const ok = ms.filter(m => m.status === 'DONE' && m.on_time).length; const den = ms.length + missed.length; return { value: den ? R(ok / den * 100, 1) : null, numerator: ok, denominator: den }; };
  K['KPI-FLO-06'] = p => { const at = p.to || G.TODAY; const vids = new Set(fleetP(p).filter(v => v.status === 'ACTIVE').map(v => v.id)); const emps = new Set(G.db.where('users', u => u.status === 'ACTIVE').map(u => u.employee_id)); const ds = G.db.where('vehicle_documents', d => d.status === 'ACTIVE' && d.expires_on && d.expires_on < at && (d.vehicle_id ? vids.has(d.vehicle_id) : emps.has(d.employee_id))); return { value: ds.length, numerator: ds.length, denominator: null }; };
  K['KPI-FLO-07'] = p => { let m = 0; for (const v of fleetP(p).filter(v => FLO.tempRange(v.id))) for (const e of FLO.excursions(v.id, p.from, p.to)) m += e.minutes; return R(m, 0); };
  K['KPI-FLO-08'] = p => { const vs = fleetP(p).filter(v => v.status === 'ACTIVE'); const to = p.to > G.TODAY ? G.TODAY : p.to; const wd = workDays(p.from, to); const ids = new Set(vs.map(v => v.id)); const days = new Set(G.db.where('vehicle_trips', t => ids.has(t.vehicle_id) && ['OPEN', 'CLOSED'].includes(t.status) && t.trip_date >= p.from && t.trip_date <= to).map(t => t.vehicle_id + '|' + t.trip_date)).size; const den = wd * vs.length; return { value: den ? R(days / den * 100, 1) : null, numerator: days, denominator: den }; };
  K['KPI-FLO-09'] = p => { const ids = new Set(fleetP(p).map(v => v.id)); return R(U.sum(G.db.where('traffic_fines', f => ids.has(f.vehicle_id) && f.status === 'PAID' && !f.charged_to_driver && f.paid_on >= p.from && f.paid_on <= p.to), f => f.paid_amount || 0)); };
  K['KPI-FLO-10'] = p => {
    const cs = costsP(p); const by = {}; const agg = { OWN: { c: 0, n: 0 }, RENTED: { c: 0, n: 0 } };
    for (const c of cs) { const v = veh(c.vehicle_id); if (!agg[v.ownership]) continue; agg[v.ownership].c += c.total - c.driver; agg[v.ownership].n += c.deliveries; }
    for (const k of Object.keys(agg)) by[k] = agg[k].n ? R(agg[k].c / agg[k].n, 2) : null;
    const carrier = G.db.where('delivery_costs', d => d.cost_type === 'CARRIER_FEE' && d.status !== 'VOIDED' && d.cost_date >= p.from && d.cost_date <= p.to); const carN = G.db.where('delivery_routes', r => r.mode === 'CARRIER' && r.route_date >= p.from && r.route_date <= p.to).reduce((s, r) => s + G.db.where('delivery_stops', x => x.route_id === r.id && x.status === 'DELIVERED').length, 0);
    by.THIRD = carN ? R(U.sum(carrier, d => d.amount) / carN, 2) : null;
    const tc = agg.OWN.c + agg.RENTED.c, tn = agg.OWN.n + agg.RENTED.n;
    return { value: tn ? R(tc / tn, 2) : null, numerator: R(tc), denominator: tn, by };
  };

  /* =====================================================================
     Alertas globales, búsqueda y escáner
     ===================================================================== */
  G.alertProviders.push(() => {
    if (!G.modOn('FLO') || !G.canSee('FLO')) return [];
    const open = G.db.where('fleet_alerts', a => a.status === 'OPEN'); const out = [];
    const grp = U.groupBy(open, 'alert_type');
    for (const [t, list] of Object.entries(grp)) out.push({ module: 'FLO', title: `${list.length} alerta(s) de flota: ${alertName(t).toLowerCase()}`, detail: list.slice(0, 3).map(a => a.title).join(' · '), tone: list.some(a => a.severity === 'bad') ? 'bad' : 'warn', go: () => G.go('FLO-14') });
    const blk = fleet().filter(v => FLO.whyNotOperable(v.id).length);
    if (blk.length) out.push({ module: 'FLO', title: `${blk.length} vehículo(s) bloqueado(s) (RN-FLO-11)`, detail: blk.map(v => `${v.plate}: ${FLO.whyNotOperable(v.id).map(w => w.msg).join(' ')}`).join(' · '), tone: 'bad', go: () => G.go('FLO-01') });
    return out;
  });
  G.searchProviders.push(q => {
    const s = String(q || '').toLowerCase().replace(/\s/g, ''); if (s.length < 2) return [];
    const out = [];
    for (const v of fleet()) if (v.plate.toLowerCase().replace('-', '').includes(s.replace('-', '')) || code(v.id).toLowerCase().includes(s)) out.push({ label: `${vLabel(v.id)}`, sub: `Vehículo · ${VTYPE[v.vehicle_type]} ${OWN[v.ownership].toLowerCase()} · FLO-04`, go: () => G.go('FLO-04', { id: v.id }) });
    for (const t of G.db.where('vehicle_trips', t => t.number.toLowerCase() === s).slice(0, 2)) out.push({ label: t.number, sub: `Jornada de ${vLabel(t.vehicle_id)} · ${F.date(t.trip_date)}`, go: () => G.go('FLO-03', { id: t.id }) });
    for (const f of G.db.where('fuel_loads', f => f.number.toLowerCase() === s || (f.voucher_no && f.voucher_no.toLowerCase() === s)).slice(0, 2)) out.push({ label: f.number, sub: `Carga de combustible · ${vLabel(f.vehicle_id)}`, go: () => G.go('FLO-05', { id: f.id }) });
    for (const m of G.db.where('vehicle_maintenances', m => m.number.toLowerCase() === s).slice(0, 2)) out.push({ label: m.number, sub: `Mantenimiento · ${vLabel(m.vehicle_id)}`, go: () => G.go('FLO-08', { id: m.id }) });
    for (const f of G.db.where('traffic_fines', f => f.ballot_number.toLowerCase().replace(/\s/g, '').includes(s)).slice(0, 3)) out.push({ label: f.ballot_number, sub: `Multa · ${vLabel(f.vehicle_id)} · ${F.money(f.amount)}`, go: () => G.go('FLO-10', { id: f.id }) });
    for (const a of G.db.where('fleet_alerts', a => a.number.toLowerCase() === s).slice(0, 1)) out.push({ label: a.number, sub: 'Alerta de flota · ' + a.title, go: () => G.go('FLO-14', { id: a.id }) });
    return out.slice(0, 8);
  });
  /** escaneo de placa (cámara o QR del parabrisas «VEH-MTA-123»), código interno, jornada, carga o papeleta */
  FLO.findVehicle = code0 => { const c = String(code0 || '').trim().toUpperCase().replace(/^VEH-/, ''); const n = c.replace(/[^A-Z0-9]/g, ''); return fleet().find(v => v.plate.replace(/[^A-Z0-9]/g, '') === n || code(v.id).toUpperCase() === c) || null; };
  G.scanHandlers.push(c => {
    const v = FLO.findVehicle(c); if (v) return () => G.go('FLO-04', { id: v.id });
    const t = G.db.find('vehicle_trips', x => x.number === c); if (t) return () => G.go('FLO-03', { id: t.id });
    const f = G.db.find('fuel_loads', x => x.number === c || (x.voucher_no && x.voucher_no.toUpperCase() === c)); if (f) return () => G.go('FLO-05', { id: f.id });
    const m = G.db.find('vehicle_maintenances', x => x.number === c); if (m) return () => G.go('FLO-08', { id: m.id });
    const fi = G.db.find('traffic_fines', x => x.ballot_number.toUpperCase() === c); if (fi) return () => G.go('FLO-10', { id: fi.id });
    return null;
  });

  /* =====================================================================
     Pruebas de aceptación (una por CA-FLO)
     ===================================================================== */
  const expectFail = (fn, rule) => { try { fn(); } catch (e) { if (!String(e.message).startsWith(rule)) throw new Error(`Se esperaba ${rule} y salió: ${e.message}`); return e; } throw new Error(`Se esperaba el rechazo ${rule} y la operación pasó.`); };
  const tv = (plate, o = {}) => FLO.saveVehicle(Object.assign({ plate, internal_code: 'PRB-' + plate.slice(-2), vehicle_type: 'MOTO', ownership: 'OWN', establishment_id: 'es-L1', fuel_type: 'GASOLINE', tank_capacity_gal: 3, expected_km_per_gal: 70, odometer_km: 10000, odometer_at: '2026-08-01T07:00:00', soat_expires_on: '2027-05-01' }, o));
  const T = (name, fn) => G.tests.push({ module: 'FLO', name, fn: async () => { const role = G.ctx.role; try { await fn(); } finally { G.ctx.role = role; } } });
  T('CA-FLO-01: MOT-01 (70 km/gal) con tanque lleno de 2,5 gal a 120 km de la carga llena anterior → 48 km/gal y alerta de rendimiento (48 < 59,5)', async () => {
    const v = FLO.findVehicle('MOT-01'); if (!v || prof(v.id).expected_km_per_gal !== 70) throw new Error('MOT-01 debe tener 70 km/gal esperados.');
    if (FLO.lowThreshold(v.id) !== 59.5) throw new Error('El mínimo debe ser 59,5 km/gal; salió ' + FLO.lowThreshold(v.id));
    const odo = FLO.currentOdo(v.id); const at = FLO.clock();
    const a = FLO.registerFuel({ vehicle_id: v.id, loaded_at: tadd(at, 60), odometer_km: odo + 5, gallons: 1.2, price_per_gal: 17.4, full_tank: true, voucher_no: 'V-CA01-A' });
    const n0 = G.db.where('fleet_alerts', x => x.vehicle_id === v.id && x.alert_type === 'FUEL_EFFICIENCY' && x.status !== 'CLOSED').length;
    const b = FLO.registerFuel({ vehicle_id: v.id, loaded_at: tadd(at, 7200), odometer_km: a.odometer_km + 120, gallons: 2.5, price_per_gal: 17.4, full_tank: true, voucher_no: 'V-CA01-B' });
    if (b.km_since_full !== 120 || b.gallons_since_full !== 2.5) throw new Error(`Se esperaban 120 km y 2,5 gal; salió ${b.km_since_full} km y ${b.gallons_since_full} gal.`);
    if (b.km_per_gal !== 48) throw new Error('Rendimiento esperado 48 km/gal; salió ' + b.km_per_gal);
    if (b.efficiency_status !== 'LOW') throw new Error('La carga debió quedar bajo el esperado.');
    const al = G.db.find('fleet_alerts', x => x.vehicle_id === v.id && x.alert_type === 'FUEL_EFFICIENCY' && x.status !== 'CLOSED');
    if (!al || !/48/.test(al.title)) throw new Error('No se creó la alerta de rendimiento con 48 km/gal.');
    if (G.db.where('fleet_alerts', x => x.vehicle_id === v.id && x.alert_type === 'FUEL_EFFICIENCY' && x.status !== 'CLOSED').length > Math.max(1, n0)) throw new Error('RN-FLO-20: debe haber una sola alerta abierta por vehículo, tipo y origen.');
  });
  T('CA-FLO-02: con última lectura de 15 350 km, una carga con 15 200 km se rechaza con RN-FLO-04', async () => {
    const v = tv('PRB-102', { odometer_km: 15350 });
    const n0 = G.db.all('fuel_loads').length;
    expectFail(() => FLO.registerFuel({ vehicle_id: v.id, loaded_at: G.TODAY + 'T10:00:00', odometer_km: 15200, gallons: 2, price_per_gal: 17.4, full_tank: true }), 'RN-FLO-04');
    if (G.db.all('fuel_loads').length !== n0) throw new Error('No debió guardarse la carga.');
    const ok = FLO.registerFuel({ vehicle_id: v.id, loaded_at: G.TODAY + 'T10:05:00', odometer_km: 15400, gallons: 2, price_per_gal: 17.4, full_tank: true });
    if (!ok || ok.odometer_km !== 15400) throw new Error('Una lectura mayor sí debe registrarse.');
  });
  T('CA-FLO-03: plan «cambio de aceite cada 3 000 km o 90 días» cerrado a 12 000 km el 01/09/2026 → próximo a 15 000 km o el 30/11/2026, aviso a 14 500 km', async () => {
    const v = tv('PRB-103', { odometer_km: 11800 });
    const p = FLO.savePlan({ vehicle_id: v.id, task: 'Cambio de aceite', interval_km: 3000, interval_days: 90, last_done_km: 9000, last_done_on: '2026-06-03' });
    const m = FLO.openMaintenance({ vehicle_id: v.id, kind: 'PREVENTIVE', plan_id: p.id, description: 'Cambio de aceite', opened_on: '2026-09-01', in_workshop: true });
    if (prof(v.id).op_status !== 'IN_MAINTENANCE') throw new Error('En taller el vehículo debe quedar en mantenimiento.');
    FLO.closeMaintenance(m.id, { done_on: '2026-09-01', odometer_km: 12000, parts: [{ description: 'Aceite 20W-50', qty: 1, unit_cost: 38 }], labor_amount: 30 });
    const p2 = G.db.get('vehicle_maintenance_plans', p.id); const s = FLO.planState(p2);
    if (p2.next_due_km !== 15000) throw new Error('Próximo km esperado 15 000; salió ' + p2.next_due_km);
    if (p2.next_due_on !== '2026-11-30') throw new Error('Próxima fecha esperada 30/11/2026; salió ' + p2.next_due_on);
    if (s.alertKm !== 14500) throw new Error('El aviso debe salir a 14 500 km; salió ' + s.alertKm);
    if (prof(v.id).op_status !== 'ACTIVE') throw new Error('Al cerrar debe volver a activo.');
    if (G.db.get('vehicle_maintenances', m.id).total_amount !== 68) throw new Error('El total debe ser S/ 68.');
  });
  T('CA-FLO-04: un auto con SOAT vencido el 05/10/2026 asignado a una ruta del 10/10/2026 se rechaza con RN-FLO-11', async () => {
    const v = FLO.findVehicle('BKZ-512'); if (!v || v.vehicle_type !== 'CAR') throw new Error('Falta el auto BKZ-512 de los datos de ejemplo.');
    if (FLO.vehicleDoc(v.id, 'SOAT').expires_on !== '2026-10-05') throw new Error('El SOAT de BKZ-512 debe vencer el 05/10/2026.');
    G.ctx.role = 'COORDINADOR_DELIVERY';
    const e = expectFail(() => FLO.assignToRoute({ vehicle_id: v.id, date: '2026-10-10', driver_user_id: (G.db.find('users', u => u.role === 'COORDINADOR_DELIVERY') || {}).id }), 'RN-FLO-11');
    if (!/SOAT/.test(e.message)) throw new Error('El mensaje debe mencionar el SOAT: ' + e.message);
    expectFail(() => FLO.assertVehicleOperable(v.id, '2026-10-10'), 'RN-FLO-11');
    FLO.assertVehicleOperable(v.id, '2026-10-04');
  });
  T('CA-FLO-05: furgón refrigerado (0 a 4 °C) con lecturas de 6 °C durante 20 minutos → alerta de temperatura y pedidos de su ruta en revisión', async () => {
    const v = FLO.findVehicle('FUR-01'); const t = FLO.openTrip(v.id); if (!t) throw new Error('FUR-01 debe estar en jornada hoy.');
    const rg = FLO.tempRange(v.id); if (rg.min !== 0 || rg.max !== 4) throw new Error('El rango debe ser 0 a 4 °C.');
    const t0 = tadd(FLO.clock(), 60);
    for (let k = 0; k <= 4; k++) FLO.recordTemp({ vehicle_id: v.id, read_at: tadd(t0, k * 300), temp_c: 6 });
    const marked = tempsOfVeh(v.id).filter(x => x.read_at >= t0 && !x.in_range).length; if (marked !== 5) throw new Error('Las 5 lecturas deben quedar marcadas fuera de rango.');
    const a = G.db.find('fleet_alerts', x => x.vehicle_id === v.id && x.alert_type === 'TEMPERATURE' && x.origin === 'trip:' + t.id && x.status !== 'CLOSED');
    if (!a) throw new Error('No se generó la alerta de temperatura.');
    if (a.excursion_minutes !== 20) throw new Error('La excursión debe durar 20 min; salió ' + a.excursion_minutes);
    const route = delivOf(t.driver_user_id, t.trip_date).filter(o => o.status === 'IN_ROUTE');
    if (!route.length) throw new Error('La ruta debe tener pedidos en ruta.');
    const pend = new Set((a.order_reviews || []).filter(x => x.status === 'PENDING').map(x => x.order_id));
    if (route.some(o => !pend.has(o.id))) throw new Error('Todos los pedidos en ruta deben pasar a revisión.');
    expectFail(() => FLO.closeAlert(a.id, 'Revisado'), 'RN-FLO-14');
  });
  T('CA-FLO-06: moto propia con S/ 600 + 150 + 90 + 160 + 1 500 en 2 500 km y 600 entregas → S/ 1,00 por km y S/ 4,17 por entrega', async () => {
    const r = FLO.costFormula({ fuel: 600, maint: 150, other: 90, deprec: 160, driver: 1500, km: 2500, deliveries: 600 });
    if (r.total !== 2500) throw new Error('Costo total esperado S/ 2 500; salió ' + r.total);
    if (r.per_km !== 1) throw new Error('Costo por km esperado S/ 1,00; salió ' + r.per_km);
    if (r.per_delivery !== 4.17) throw new Error('Costo por entrega esperado S/ 4,17; salió ' + r.per_delivery);
    const m = FLO.monthlyCost('ve-MTA-123', '2026-09-01');
    if (!(m.km > 0 && m.total > 0) || Math.abs(m.total - FLO.costFormula(m).total) > 0.01) throw new Error('El costo mensual de MOT-01 debe sumar sus componentes (RN-FLO-16).');
    if (m.deprec !== 160) throw new Error('La depreciación mensual de MOT-01 debe ser S/ 160; salió ' + m.deprec);
  });
  T('CA-FLO-07: una moto sin jornada abierta que envía una posición se rechaza con RN-FLO-02', async () => {
    const v = FLO.findVehicle('MOT-02'); if (FLO.openTrip(v.id)) throw new Error('MOT-02 no debe tener jornada abierta.');
    const n0 = G.db.all('vehicle_positions').length;
    expectFail(() => FLO.recordPosition({ vehicle_id: v.id, recorded_at: tadd(FLO.clock(), 30), lat: -12.14, lng: -76.99, speed_kmh: 20 }), 'RN-FLO-02');
    if (G.db.all('vehicle_positions').length !== n0) throw new Error('No debió guardarse la posición.');
    const m = FLO.findVehicle('MOT-01'); const t = FLO.openTrip(m.id); const lp = FLO.lastPos(t);
    const p = { vehicle_id: m.id, recorded_at: tadd(FLO.clock(), 30), lat: lp.lat, lng: lp.lng, speed_kmh: 18 };
    const r = FLO.recordBatch([p, p, { vehicle_id: m.id, recorded_at: lp.recorded_at, lat: lp.lat, lng: lp.lng }]);
    if (r.inserted !== 1 || r.duplicates !== 2) throw new Error(`RN-FLO-01: un reenvío no duplica (insertadas ${r.inserted}, duplicadas ${r.duplicates}).`);
  });
  T('CA-FLO-08: con tanque de 3 galones, una carga de 3,5 galones se rechaza con RN-FLO-08', async () => {
    const v = FLO.findVehicle('MOT-02'); if (prof(v.id).tank_capacity_gal !== 3) throw new Error('MOT-02 debe tener tanque de 3 gal.');
    const n0 = G.db.all('fuel_loads').length;
    expectFail(() => FLO.registerFuel({ vehicle_id: v.id, loaded_at: G.TODAY + 'T10:00:00', odometer_km: FLO.currentOdo(v.id) + 10, gallons: 3.5, price_per_gal: 17.4, full_tank: true }), 'RN-FLO-08');
    if (G.db.all('fuel_loads').length !== n0) throw new Error('No debió guardarse.');
  });
  T('CA-FLO-09: un conductor con licencia vencida que intenta iniciar jornada se rechaza con RN-FLO-12', async () => {
    const v = tv('PRB-109', { odometer_km: 5000 });
    const u = G.db.find('users', x => x.name.startsWith('Pedro Condori'));
    FLO.saveDocument({ doc_type: 'DRIVER_LICENSE', employee_id: u.employee_id, number: 'Q40123000-V', license_class: 'B-IIc', issued_on: '2021-10-01', expires_on: '2026-10-01' }, { seed: true });
    const t = FLO.openTripOfDriver(u.id); if (t) FLO.endTrip(t.id, { odometer: FLO.currentOdo(t.vehicle_id) + 5, photo: 'x.jpg' });
    G.ctx.role = 'REPARTIDOR';
    expectFail(() => FLO.startTrip({ vehicle_id: v.id, driver_user_id: u.id, odometer: 5000, photo: 'tablero.jpg', checklist: { lights: true, tires: true, brakes: true, thermal_box: true, documents: true } }), 'RN-FLO-12');
    if (FLO.openTrip(v.id)) throw new Error('No debió abrirse la jornada.');
  });
})();
