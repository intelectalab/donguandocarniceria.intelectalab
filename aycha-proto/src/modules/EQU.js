/* =====================================================================
   EQU · Equipos, calibración y mantenimiento (fase 2)
   Maestro con QR, calibración obligatoria de balanzas (RN-EQU-01/02/03/10/12),
   bloqueo de equipos fuera de servicio (RN-EQU-04/05), costo de órdenes
   (RN-EQU-06), planes preventivos (RN-EQU-07), avisos (RN-EQU-08), carga por
   hora sugerida (RN-EQU-09) y punto de temperatura de cámaras (RN-EQU-11).
   Expone G.equ.scaleUsable(id), G.equ.assertUsable(id), G.equ.assertScaleForSale(id).
   ===================================================================== */
(function () {
  const { h, btn, badge, status, page, card, table, kpis, dl, notice, drawer, modal, toast, tabs, form } = G.ui;
  const U = G.util, F = G.fmt;
  const R = (n, d = 2) => U.round(n, d);
  const nowIso = () => G.date.now().slice(0, 16);
  const hoursBetween = (a, b) => Math.max(0, (Date.parse(String(b).slice(0, 19)) - Date.parse(String(a).slice(0, 19))) / 3600000);

  const CATS = [['SEALER', 'Empacadora al vacío'], ['STOVE', 'Cocina u horno'], ['POT', 'Marmita u olla'], ['SCALE', 'Balanza'], ['COLD_ROOM', 'Cámara de frío'], ['FREEZER', 'Congeladora'], ['GRINDER', 'Moledora o cutter'], ['STUFFER', 'Embutidora'], ['SAW', 'Sierra'], ['SLICER', 'Rebanadora'], ['LABEL_PRINTER', 'Impresora de etiquetas'], ['THERMOMETER', 'Termómetro'], ['OTHER', 'Otro']];
  const catName = c => (CATS.find(x => x[0] === c) || [c, c])[1];
  const MY = { PASS: ['Conforme', 'ok'], FAIL: ['No conforme', 'bad'], PREVENTIVE: ['Preventiva', 'info'], CORRECTIVE: ['Correctiva', 'warn'], USABLE: ['Apta', 'ok'], BLOCKED_CAL: ['Calibración vencida', 'bad'], EXPIRING: ['Por vencer', 'warn'], OVERDUE: ['Vencido', 'bad'], DUE: ['Toca', 'warn'], OK: ['Al día', 'ok'] };
  const sb = s => MY[s] ? badge(MY[s][0], MY[s][1]) : status(s);
  const eq = id => G.db.get('equipment', id);
  const eqLabel = e => e ? `${e.code} · ${e.name}` : '—';
  const findEq = code => { const c = String(code || '').trim().toUpperCase(); return c ? G.db.find('equipment', e => e.code.toUpperCase() === c || String(e.qr_code || '').toUpperCase() === c || ('EQ-' + e.code).toUpperCase() === c) : null; };
  const run = (fn, ok) => { try { const r = fn(); if (ok) toast(ok, 'ok'); G.refresh(); return r; } catch (e) { toast(e.message, 'bad'); return null; } };

  /* ---------- dominio ---------- */
  const calsOf = id => G.db.where('equipment_calibrations', c => c.equipment_id === id).sort((a, b) => b.calibrated_on.localeCompare(a.calibrated_on) || b.created_at.localeCompare(a.created_at));
  /** calibración PASS vigente a la fecha */
  const validCal = (id, date = G.TODAY) => calsOf(id).find(c => c.result === 'PASS' && c.calibrated_on <= date && c.valid_until >= date) || null;
  const lastCal = id => calsOf(id)[0] || null;
  const openCorrectives = id => G.db.where('maintenance_orders', o => o.equipment_id === id && o.kind === 'CORRECTIVE' && ['OPEN', 'IN_PROGRESS'].includes(o.status));
  /** motivo por el que el equipo no se puede usar (o null) */
  function whyNot(e, date = G.TODAY) {
    if (!e) return { rule: 'RN-EQU-04', msg: 'Equipo no encontrado.' };
    if (e.status === 'RETIRED') return { rule: 'RN-EQU-04', msg: `${e.code} está dado de baja y no se usa.` };
    if (e.status === 'OUT_OF_SERVICE') { const oc = openCorrectives(e.id)[0]; return { rule: 'RN-EQU-04', msg: `${e.code} está fuera de servicio${oc ? ` por la orden correctiva ${oc.number} (${oc.description})` : e.oos_reason === 'CALIBRATION' ? ' por calibración no conforme' : ''}.` }; }
    if (e.requires_calibration && !validCal(e.id, date)) { const l = lastCal(e.id); return { rule: 'RN-EQU-03', msg: `${e.code} exige calibración y no tiene una calibración conforme vigente al ${F.date(date)}${l ? ` (la última venció el ${F.date(l.valid_until)}${l.result === 'FAIL' ? ', resultado no conforme' : ''})` : ''}. Registra la calibración en EQU-03.` }; }
    return null;
  }
  /** assert_equipment_usable(equipo, fecha) */
  function assertUsable(id, date = G.TODAY) { const w = whyNot(eq(id), date); if (w) G.fail(w.rule, w.msg); return true; }
  const usable = (id, date) => !whyNot(eq(id), date);
  /** una balanza con calibración vencida no se usa para pesar ventas */
  function scaleUsable(id, date = G.TODAY) { const e = eq(id); return !!e && e.category === 'SCALE' && !whyNot(e, date); }
  function assertScaleForSale(id, date = G.TODAY) { const e = eq(id); if (!e || e.category !== 'SCALE') G.fail('RN-EQU-03', 'Elige una balanza registrada en EQU.'); const w = whyNot(e, date); if (w) G.fail(w.rule, w.msg.replace('no se usa.', 'no se usa para pesar ventas.') + (w.rule === 'RN-EQU-03' ? ' No se puede pesar ventas con ella.' : '')); return true; }
  /** balanza de un lote producido o recibido (CA-EQU-01) */
  function assignScaleToLot(lotId, eqId, date = G.TODAY) {
    const l = G.db.get('lots', lotId); if (!l) G.fail('RN-EQU-03', 'Lote no encontrado.');
    const e = eq(eqId); if (!e || e.category !== 'SCALE') G.fail('RN-EQU-03', 'Elige una balanza.');
    assertUsable(eqId, date);
    l.scale_equipment_id = eqId; l.weighed_on = date; G.db.touch();
    G.audit('EDITAR', 'lots', l.id, `Balanza ${e.code} registrada para el lote ${l.code}`);
    return l;
  }
  /** horas de uso en una orden de producción (RN-EQU-03/04); se guardan en production_order_equipment de PRO */
  function useInProduction({ equipment_id, production_order_id, order_ref, hours, date = G.TODAY, seed }) {
    const e = eq(equipment_id); if (!e) G.fail('RN-EQU-04', 'Elige el equipo.');
    if (!seed) { G.assertMod('EQU'); assertUsable(e.id, date); }
    const hrs = Number(hours); if (!(hrs > 0)) G.fail('RN-EQU-04', 'Las horas deben ser mayores que cero.');
    const po = production_order_id ? G.db.get('production_orders', production_order_id) : null;
    const row = G.db.insert('production_order_equipment', { order_id: po ? po.id : null, order_ref: po ? po.number : (order_ref || null), equipment_id: e.id, hours: R(hrs, 2), hourly_rate: e.hourly_rate, cost: R(hrs * e.hourly_rate), used_on: date, source: 'EQU', recorded_by: seed ? null : G.ctx.userId() }, { silent: !!seed });
    e.hour_meter = R((e.hour_meter || 0) + hrs, 1); G.db.touch();
    return row;
  }
  function meterReading(id, value, o = {}) {
    const e = eq(id); if (!e) G.fail('RN-EQU-07', 'Elige el equipo.');
    const v = Number(value); if (!(v >= 0)) G.fail('RN-EQU-07', 'Indica la lectura del horómetro.');
    if (v < (e.hour_meter || 0) - 0.05 && !o.seed) G.fail('RN-EQU-07', `La lectura (${F.num(v, 1)} h) es menor que la acumulada (${F.num(e.hour_meter, 1)} h).`);
    e.meter_readings = (e.meter_readings || []).concat({ at: o.at || nowIso(), hours: R(v, 1), by: o.by || G.ctx.userName() });
    e.hour_meter = R(v, 1); G.db.touch();
    return e;
  }
  /** RN-EQU-01 y RN-EQU-11 al crear o editar un equipo */
  function saveEquipment(v, existing) {
    if (!G.can('equ.equipment.manage')) G.fail('RN-EQU-01', 'Crear o editar equipos exige el permiso equ.equipment.manage.');
    if (!String(v.code || '').trim() || !String(v.name || '').trim()) G.fail('RN-EQU-01', 'Código y nombre son obligatorios.');
    if (G.db.find('equipment', e => e.code === v.code.trim().toUpperCase() && (!existing || e.id !== existing.id))) G.fail('RN-EQU-01', `El código ${v.code} ya existe.`);
    if (v.category === 'SCALE' && !v.requires_calibration) G.fail('RN-EQU-01', 'Toda balanza exige calibración: marca «Exige calibración».');
    const row = { code: v.code.trim().toUpperCase(), name: v.name.trim(), category: v.category, establishment_id: v.establishment_id, warehouse_id: v.warehouse_id || null, brand_name: v.brand_name || null, model: v.model || null, serial_number: v.serial_number || null, purchase_date: v.purchase_date || null, purchase_cost: v.purchase_cost === '' || v.purchase_cost == null ? null : Number(v.purchase_cost), useful_life_months: v.useful_life_months ? Number(v.useful_life_months) : null, hourly_rate: Number(v.hourly_rate || 0), power_kw: v.power_kw === '' || v.power_kw == null ? null : Number(v.power_kw), capacity: v.capacity || null, requires_calibration: !!v.requires_calibration, status: v.status || 'ACTIVE', cost_center_id: v.establishment_id === 'es-L2' ? 'cc-PROD-L2' : 'cc-PROD-L1' };
    if (['COLD_ROOM', 'FREEZER'].includes(row.category) && row.status === 'ACTIVE') {
      const pt = G.db.find('temperature_points', p => p.status === 'ACTIVE' && ((existing && p.equipment_id === existing.id) || (row.warehouse_id && p.warehouse_id === row.warehouse_id)));
      if (!pt) G.fail('RN-EQU-11', `Toda cámara y congeladora necesita su punto de temperatura en CAL-04 antes de quedar activa. Créalo y vuelve a guardar (o guarda el equipo como fuera de servicio).`);
    }
    let e;
    if (existing) e = G.db.update('equipment', existing.id, row);
    else e = G.db.insert('equipment', Object.assign(row, { qr_code: 'EQ-' + row.code, hour_meter: 0, meter_readings: [] }));
    if (['COLD_ROOM', 'FREEZER'].includes(e.category)) { const pt = G.db.find('temperature_points', p => !p.equipment_id && e.warehouse_id && p.warehouse_id === e.warehouse_id); if (pt) G.db.update('temperature_points', pt.id, { equipment_id: e.id }, { silent: true }); }
    return e;
  }
  /** RN-EQU-02, RN-EQU-10, RN-EQU-12 (solo inserción) */
  function recordCalibration(d, o = {}) {
    if (!o.seed) { G.assertMod('EQU'); if (!G.can('equ.calibration.record')) G.fail('RN-EQU-02', 'Registrar calibraciones exige el permiso equ.calibration.record.'); }
    const e = eq(d.equipment_id); if (!e) G.fail('RN-EQU-02', 'Elige el equipo.');
    if (!String(d.certificate_number || '').trim()) G.fail('RN-EQU-02', 'La calibración exige el número de certificado.');
    if (!String(d.certificate_url || '').trim()) G.fail('RN-EQU-02', 'La calibración exige el archivo del certificado.');
    if (!d.calibrated_on || !d.valid_until || d.valid_until <= d.calibrated_on) G.fail('RN-EQU-02', 'La vigencia debe ser posterior a la fecha de calibración.');
    if (!['PASS', 'FAIL'].includes(d.result)) G.fail('RN-EQU-02', 'Indica el resultado.');
    const c = G.db.insert('equipment_calibrations', { equipment_id: e.id, calibrated_on: d.calibrated_on, valid_until: d.valid_until, provider_supplier_id: d.provider_supplier_id || null, provider_name: d.provider_name || null, certificate_number: d.certificate_number.trim(), certificate_url: d.certificate_url.trim(), max_error_g: d.max_error_g === '' || d.max_error_g == null ? null : Number(d.max_error_g), result: d.result, cost: Number(d.cost || 0), notes: d.notes || null, recorded_by: o.seed ? 'Silvia Ramos Tello' : G.ctx.userName() }, { silent: !!o.seed });
    if (c.result === 'FAIL') { G.db.update('equipment', e.id, { status: 'OUT_OF_SERVICE', oos_reason: 'CALIBRATION', oos_since: c.calibrated_on }, { silent: !!o.seed }); if (!o.seed) G.events.emit('equipment.out_of_service', { equipment_id: e.id, code: e.code, reason: 'Calibración no conforme' }); }
    else if (e.status === 'OUT_OF_SERVICE' && e.oos_reason === 'CALIBRATION' && !openCorrectives(e.id).length) G.db.update('equipment', e.id, { status: 'ACTIVE', oos_reason: null, oos_since: null }, { silent: !!o.seed });
    return c;
  }
  function openOrder(d, o = {}) {
    if (!o.seed) G.assertMod('EQU');
    const e = eq(d.equipment_id); if (!e) G.fail('RN-EQU-05', 'Escanea o elige el equipo.');
    if (!String(d.description || '').trim()) G.fail('RN-EQU-05', d.kind === 'CORRECTIVE' ? 'Describe la falla.' : 'Describe la actividad.');
    if (!o.seed && d.kind !== 'CORRECTIVE' && !G.can('equ.maintenance.manage')) G.fail('RN-EQU-06', 'Abrir órdenes preventivas exige el permiso equ.maintenance.manage.');
    const at = d.reported_at || nowIso();
    const m = G.db.insert('maintenance_orders', { number: d.number || G.db.next('OM', 'OM-', 4), equipment_id: e.id, kind: d.kind || 'CORRECTIVE', plan_id: d.plan_id || null, reported_at: at, reported_by: d.reported_by || G.ctx.userId(), description: d.description.trim(), photo_url: d.photo_url || null, urgency: d.urgency || 'NORMAL', diagnosis: d.diagnosis || null, started_at: d.started_at || null, finished_at: d.finished_at || null, downtime_hours: d.downtime_hours ?? null, labor_hours: d.labor_hours || 0, labor_cost: d.labor_cost || 0, parts: d.parts || [], parts_cost: d.parts_cost || 0, external_cost: d.external_cost || 0, total_cost: R((d.labor_cost || 0) + (d.parts_cost || 0) + (d.external_cost || 0)), external_supplier_id: d.external_supplier_id || null, cost_center_id: e.cost_center_id || (e.establishment_id === 'es-L2' ? 'cc-PROD-L2' : 'cc-PROD-L1'), status: d.status || 'OPEN', due_on: d.due_on || null, void_reason: null }, { silent: !!o.seed });
    // RN-EQU-05: una correctiva abierta deja el equipo fuera de servicio
    if (m.kind === 'CORRECTIVE' && ['OPEN', 'IN_PROGRESS'].includes(m.status)) {
      if (e.status !== 'OUT_OF_SERVICE') G.db.update('equipment', e.id, { status: 'OUT_OF_SERVICE', oos_reason: 'CORRECTIVE', oos_since: at }, { silent: !!o.seed });
      if (!o.seed) { G.events.emit('equipment.out_of_service', { equipment_id: e.id, code: e.code, order: m.number }); G.notify({ role: 'JEFE_PRODUCCION', title: `${e.code} fuera de servicio`, body: `${m.number}: ${m.description}`, tone: 'bad', module: 'EQU', ref: { screen: 'EQU-06', id: m.id } }); }
    }
    return m;
  }
  function startOrder(id) { const m = G.db.get('maintenance_orders', id); if (m.status !== 'OPEN') G.fail('RN-EQU-06', 'La orden no está abierta.'); return G.db.update('maintenance_orders', id, { status: 'IN_PROGRESS', started_at: nowIso() }); }
  /** RN-EQU-06: costo = mano de obra + repuestos + servicio externo, al centro de costo del local */
  function finishOrder(id, d = {}, o = {}) {
    const m = G.db.get('maintenance_orders', id); if (!m) G.fail('RN-EQU-06', 'Orden no encontrada.');
    if (!o.seed && !G.can('equ.maintenance.manage')) G.fail('RN-EQU-06', 'Cerrar y costear órdenes exige el permiso equ.maintenance.manage.');
    if (!['OPEN', 'IN_PROGRESS'].includes(m.status)) G.fail('RN-EQU-06', `La orden ${m.number} ya está ${G.ui.statusLabel(m.status).toLowerCase()}.`);
    const labor = Number(d.labor_cost ?? m.labor_cost ?? 0), ext = Number(d.external_cost ?? m.external_cost ?? 0);
    const parts = d.parts || m.parts || [];
    const partsCost = d.parts_cost != null ? Number(d.parts_cost) : R(U.sum(parts, p => p.qty * p.unit_cost));
    if ([labor, ext, partsCost].some(x => !(x >= 0))) G.fail('RN-EQU-06', 'Los costos no pueden ser negativos.');
    if (ext > 0 && !d.external_supplier_id && !m.external_supplier_id) G.fail('RN-EQU-06', 'El servicio externo necesita el proveedor (compra en COM o gasto en GAS).');
    const fin = d.finished_at || nowIso();
    const down = d.downtime_hours != null && d.downtime_hours !== '' ? Number(d.downtime_hours) : m.kind === 'CORRECTIVE' ? R(hoursBetween(m.reported_at, fin), 1) : R(hoursBetween(m.started_at || fin, fin), 1);
    const r = G.db.update('maintenance_orders', id, { status: 'DONE', finished_at: fin, started_at: m.started_at || d.started_at || m.reported_at, diagnosis: d.diagnosis || m.diagnosis, labor_cost: R(labor), labor_hours: Number(d.labor_hours || m.labor_hours || 0), parts, parts_cost: R(partsCost), external_cost: R(ext), external_supplier_id: d.external_supplier_id || m.external_supplier_id || null, total_cost: R(labor + partsCost + ext), downtime_hours: down }, { silent: !!o.seed });
    const e = eq(m.equipment_id);
    if (m.kind === 'CORRECTIVE' && e.status === 'OUT_OF_SERVICE' && !openCorrectives(e.id).length && e.oos_reason !== 'CALIBRATION') G.db.update('equipment', e.id, { status: 'ACTIVE', oos_reason: null, oos_since: null }, { silent: !!o.seed });
    if (m.plan_id) { const p = G.db.get('maintenance_plans', m.plan_id); if (p) G.db.update('maintenance_plans', p.id, { last_done_on: fin.slice(0, 10), next_due_on: p.frequency_days ? G.date.add(fin.slice(0, 10), p.frequency_days) : p.next_due_on, next_due_hours: p.frequency_hours ? R((e.hour_meter || 0) + p.frequency_hours, 1) : p.next_due_hours }, { silent: !!o.seed }); }
    return r;
  }
  function reportFailure(d) {
    if (!G.can('equ.failure.report') && !G.can('equ.maintenance.manage')) G.fail('RN-EQU-05', 'Reportar fallas exige el permiso equ.failure.report.');
    const e = eq(d.equipment_id) || findEq(d.code); if (!e) G.fail('RN-EQU-05', 'Escanea el QR o elige el equipo.');
    const prev = openCorrectives(e.id)[0];
    if (prev) { G.db.update('maintenance_orders', prev.id, { description: prev.description + ' · Nuevo reporte: ' + d.description }); return prev; }
    return openOrder({ equipment_id: e.id, kind: 'CORRECTIVE', description: d.description, photo_url: d.photo_url, urgency: d.urgency });
  }
  /** estado del plan a la fecha: OK, DUE (toca) u OVERDUE (> equ_preventive_overdue_days) */
  function planState(p, date = G.TODAY) {
    const e = eq(p.equipment_id) || {};
    const byDate = p.next_due_on ? G.date.diff(date, p.next_due_on) : -999;
    const byHours = p.next_due_hours != null ? (e.hour_meter || 0) - p.next_due_hours : -999;
    const od = G.param('equ_preventive_overdue_days') ?? 7;
    if (byDate > od) return 'OVERDUE';
    if (byDate >= 0 || byHours >= 0) return 'DUE';
    return 'OK';
  }
  /** RN-EQU-07: crea las órdenes preventivas que tocan por fecha u horas */
  function runPlans(date = G.TODAY, o = {}) {
    const out = [];
    for (const p of G.db.where('maintenance_plans', x => x.status === 'ACTIVE')) {
      if (planState(p, date) === 'OK') continue;
      if (G.db.find('maintenance_orders', m => m.plan_id === p.id && ['OPEN', 'IN_PROGRESS'].includes(m.status))) continue;
      out.push(openOrder({ equipment_id: p.equipment_id, kind: 'PREVENTIVE', plan_id: p.id, description: p.activity, due_on: p.next_due_on, reported_at: o.at }, o));
    }
    return out;
  }
  /** RN-EQU-09: (costo / vida útil + mantenimiento promedio mensual) / horas de uso promedio mensual */
  function suggestedRate(e) {
    if (!e.purchase_cost || !e.useful_life_months) return null;
    const from = G.date.add(G.TODAY, -90);
    const maint = U.sum(G.db.where('maintenance_orders', m => m.equipment_id === e.id && m.status === 'DONE' && (m.finished_at || '') >= from), m => m.total_cost) / 3;
    const hours = U.sum(G.db.where('production_order_equipment', u => u.equipment_id === e.id && (u.used_on || '') >= from), u => u.hours) / 3;
    if (!(hours > 0)) return null;
    return R((e.purchase_cost / e.useful_life_months + maint) / hours, 2);
  }

  G.equ = { scaleUsable, assertUsable, assertScaleForSale, usable, whyNot, assignScaleToLot, useInProduction, recordCalibration, openOrder, finishOrder, reportFailure, runPlans, planState, suggestedRate, validCal, saveEquipment, findEq };

  /* =====================================================================
     Datos de ejemplo (orden 44, después de CAL)
     ===================================================================== */
  G.seed(44, function seedEQU() {
    const r = U.rng(4402);
    const ins = (t, row) => G.db.insert(t, row, { silent: true });
    const frio = G.db.find('suppliers', s => /FRÍO TOTAL/.test(s.legal_name));
    // [código, nombre, categoría, local, almacén, marca, modelo, compra, costo, vida meses, S/ por hora, kW, capacidad, calibra, horas]
    const E = [
      ['BAL-L1-01', 'Balanza de mostrador etiquetadora', 'SCALE', 'es-L1', 'wh-MOS-L1', 'Digi', 'SM-120', '2024-03-10', 6800, 84, 0.8, 0.05, '30 kg × 2 g', true, 0],
      ['BAL-L1-02', 'Balanza de preparación de pedidos', 'SCALE', 'es-L1', null, 'Ohaus', 'Defender 3000', '2023-06-15', 2400, 84, 0.4, 0.02, '15 kg × 1 g', true, 0],
      ['BAL-L1-03', 'Balanza de plataforma de recepción', 'SCALE', 'es-L1', null, 'Ohaus', 'Defender 5000', '2023-06-15', 3900, 96, 0.5, 0.02, '150 kg × 20 g', true, 0],
      ['BAL-L2-01', 'Balanza de producción', 'SCALE', 'es-L2', null, 'Ohaus', 'Ranger 3000', '2024-01-20', 3100, 84, 0.5, 0.02, '30 kg × 1 g', true, 0],
      ['BAL-L2-02', 'Balanza de plataforma de recepción', 'SCALE', 'es-L2', null, 'Henkel', 'PL-300', '2023-09-01', 2900, 96, 0.4, 0.02, '300 kg × 50 g', true, 0],
      ['SEL-L1-01', 'Empacadora al vacío de campana', 'SEALER', 'es-L1', null, 'Henkelman', 'Boxer 42', '2023-08-01', 14500, 96, 3.2, 0.75, 'Barra de 42 cm', false, 1820],
      ['SEL-L2-01', 'Empacadora al vacío de doble cámara', 'SEALER', 'es-L2', null, 'Henkelman', 'Falcon 2-60', '2024-05-12', 32800, 120, 5.6, 1.5, '2 barras de 60 cm', false, 1210],
      ['CUT-L2-01', 'Cutter de 20 L', 'GRINDER', 'es-L2', null, 'Talsa', 'K20', '2024-02-05', 21500, 120, 6.4, 3.0, '20 L', false, 640],
      ['EMB-L2-01', 'Embutidora hidráulica de 15 L', 'STUFFER', 'es-L2', null, 'Talsa', 'H15', '2024-02-05', 12800, 120, 3.8, 0.75, '15 L', false, 710],
      ['AHU-L2-01', 'Ahumador y horno de cocción', 'STOVE', 'es-L2', null, 'Ahumadores Perú', 'AH-100', '2023-11-20', 18900, 120, 5.1, 6.0, '100 kg por carga', false, 980],
      ['MAR-L2-01', 'Marmita de 100 L', 'POT', 'es-L2', null, 'Inoxpro', 'MV-100', '2023-04-10', 9600, 120, 2.9, 0, '100 L a gas', false, 1430],
      ['MAR-L2-02', 'Marmita de 50 L', 'POT', 'es-L2', null, 'Inoxpro', 'MV-50', '2024-07-01', 6200, 120, 2.1, 0, '50 L a gas', false, 560],
      ['TOS-L2-01', 'Tostadora de café de 5 kg', 'OTHER', 'es-L2', null, 'Tostadoras Andinas', 'TA-5', '2024-09-15', 23800, 120, 7.4, 2.2, '5 kg por batch', false, 455],
      ['MOC-L2-01', 'Molino de café', 'GRINDER', 'es-L2', null, 'Mahlkönig', 'EK43', '2024-09-15', 9900, 120, 2.6, 1.3, '1,2 kg/min', false, 210],
      ['REB-L2-01', 'Rebanadora de jamón', 'SLICER', 'es-L2', null, 'Berkel', 'Pro Line 300', '2024-03-01', 7400, 120, 1.9, 0.3, 'Cuchilla de 300 mm', false, 390],
      ['SIE-L1-01', 'Sierra de hueso', 'SAW', 'es-L1', null, 'Skymsen', 'SFL-320', '2023-08-01', 8600, 96, 2.8, 1.1, 'Cinta 2,82 m', false, 1640],
      ['MOL-L1-01', 'Moledora de carne', 'GRINDER', 'es-L1', null, 'Skymsen', 'PSEE-22', '2023-08-01', 4300, 96, 1.6, 1.1, '250 kg/h', false, 990],
      ['CAM-L1', 'Cámara de frío Local 1', 'COLD_ROOM', 'es-L1', 'wh-CAM-L1', 'Frío Total', 'CF-12', '2023-05-01', 26500, 144, 1.2, 3.5, '12 m³', false, 0],
      ['CNG-L1', 'Congeladora Local 1', 'FREEZER', 'es-L1', 'wh-CNG-L1', 'Metalfrío', 'HF-55', '2023-05-01', 5800, 120, 0.4, 0.6, '550 L', false, 0],
      ['EXH-L1', 'Exhibidora refrigerada del mostrador', 'COLD_ROOM', 'es-L1', 'wh-MOS-L1', 'Imbera', 'VR-2', '2024-03-10', 9800, 120, 0.6, 0.8, '2 m lineales', false, 0],
      ['CAM-Q-L1', 'Cámara de cuarentena Local 1', 'COLD_ROOM', 'es-L1', 'wh-CUA-L1', 'Frío Total', 'CF-4', '2025-01-15', 12800, 144, 0.6, 1.2, '4 m³', false, 0],
      ['CAM-L2', 'Cámara de frío Local 2', 'COLD_ROOM', 'es-L2', 'wh-CAM-L2', 'Frío Total', 'CF-20', '2023-04-01', 38500, 144, 1.6, 5.0, '20 m³', false, 0],
      ['CNG-L2', 'Congeladora Local 2', 'FREEZER', 'es-L2', 'wh-CNG-L2', 'Frío Total', 'TC-8', '2023-04-01', 21500, 144, 1.0, 3.2, 'Túnel 8 m³', false, 0],
      ['IMP-L1-01', 'Impresora de etiquetas ZPL 100 × 50 mm', 'LABEL_PRINTER', 'es-L1', null, 'Zebra', 'ZD421', '2025-02-01', 2300, 60, 0.3, 0.05, '100 × 50 mm', false, 0],
      ['IMP-L2-01', 'Impresora de etiquetas ZPL 100 × 50 mm', 'LABEL_PRINTER', 'es-L2', null, 'Zebra', 'ZD421', '2025-02-01', 2300, 60, 0.3, 0.05, '100 × 50 mm', false, 0],
      ['TER-L1-01', 'Termómetro punzón digital', 'THERMOMETER', 'es-L1', null, 'Testo', '104', '2025-03-01', 520, 36, 0, 0, '−50 a 250 °C', true, 0],
      ['TER-L2-01', 'Termómetro de núcleo y marmita', 'THERMOMETER', 'es-L2', null, 'Testo', '108', '2025-03-01', 480, 36, 0, 0, '−50 a 300 °C', true, 0],
    ];
    for (const [code, name, cat, est, wh, br, mo, pd, cost, life, rate, kw, cap, cal, hrs] of E) {
      ins('equipment', { id: 'eq-' + code, code, name, category: cat, establishment_id: est, warehouse_id: wh, brand_name: br, model: mo, serial_number: br.slice(0, 3).toUpperCase() + '-' + (100000 + Math.floor(r() * 899999)), purchase_date: pd, purchase_cost: cost, useful_life_months: life, hourly_rate: rate, power_kw: kw, capacity: cap, requires_calibration: cal, cost_center_id: est === 'es-L2' ? 'cc-PROD-L2' : 'cc-PROD-L1', qr_code: 'EQ-' + code, status: 'ACTIVE', hour_meter: hrs, meter_readings: hrs ? [{ at: '2026-10-01T07:00', hours: R(hrs - 60 - Math.floor(r() * 30), 1), by: 'Óscar Lazo Villa' }] : [], manual_url: `manuales/${code}.pdf`, photos: [`equipos/${code}.jpg`] });
    }
    // RN-EQU-11: cada cámara y congeladora queda enlazada a su punto de temperatura de CAL
    for (const p of G.db.all('temperature_points')) { const e = G.db.find('equipment', x => ['COLD_ROOM', 'FREEZER'].includes(x.category) && x.warehouse_id && x.warehouse_id === p.warehouse_id && !(x.code === 'EXH-L1' && p.point_type !== 'DISPLAY')); if (e && !p.equipment_id) p.equipment_id = e.id; }
    const tMar = G.db.find('temperature_points', p => p.code === 'TP-MAR-L2'); if (tMar) tMar.equipment_id = 'eq-MAR-L2-01';
    const tNuc = G.db.find('temperature_points', p => p.code === 'TP-NUC-L2'); if (tNuc) tNuc.equipment_id = 'eq-AHU-L2-01';
    // NC de la cámara del Local 1 (CAL) enlazada al equipo
    const nc14 = G.db.find('nonconformities', n => n.number === 'NC-2026-014'); if (nc14) nc14.equipment_id = 'eq-CAM-L1';
    const nc12 = G.db.find('nonconformities', n => n.number === 'NC-2026-012'); if (nc12) nc12.equipment_id = 'eq-SEL-L1-01';

    /* --- calibraciones (D-EQU-01: cada 6 meses con proveedor que entrega certificado) --- */
    const LAB = 'Metrología y Balanzas del Perú SAC (laboratorio acreditado INACAL)';
    let n = 90;
    const CAL = [
      ['BAL-L1-01', '2026-02-12', '2026-08-12', 'PASS', 1.0], ['BAL-L1-01', '2026-08-14', '2027-02-14', 'PASS', 1.0],
      ['BAL-L1-02', '2025-09-28', '2026-03-28', 'PASS', 0.5], ['BAL-L1-02', '2026-03-30', '2026-09-30', 'PASS', 0.5],
      ['BAL-L1-03', '2025-10-18', '2026-04-18', 'PASS', 20], ['BAL-L1-03', '2026-04-20', '2026-10-20', 'PASS', 20],
      ['BAL-L2-01', '2026-03-05', '2026-09-05', 'PASS', 1.0], ['BAL-L2-01', '2026-09-03', '2027-03-03', 'PASS', 0.5],
      ['BAL-L2-02', '2026-01-22', '2026-07-22', 'FAIL', 150], ['BAL-L2-02', '2026-07-24', '2027-01-24', 'PASS', 40],
      ['TER-L1-01', '2026-03-01', '2027-03-01', 'PASS', null], ['TER-L2-01', '2026-03-01', '2026-10-22', 'PASS', null],
    ];
    for (const [code, on, until, res, err] of CAL) { n++; recordCalibration({ equipment_id: 'eq-' + code, calibrated_on: on, valid_until: until, provider_name: LAB, certificate_number: `CC-2026-${String(n).padStart(3, '0')}`.replace('2026-0', on.slice(0, 4) + '-0'), certificate_url: `certificados/CC-${code}-${on}.pdf`, max_error_g: err, result: res, cost: code.startsWith('TER') ? 60 : 180, notes: res === 'FAIL' ? 'Error fuera de la clase III; se ajustó y recalibró' : null }, { seed: true }); }
    const e22 = G.db.get('equipment', 'eq-BAL-L2-02'); Object.assign(e22, { status: 'ACTIVE', oos_reason: null, oos_since: null });

    /* --- planes preventivos --- */
    const PL = [
      ['SEL-L1-01', 'Cambio de aceite de la bomba de vacío', null, 250, null, 1950, 'Aceite de bomba 1 L', 'Víctor Apaza'],
      ['SEL-L2-01', 'Cambio de aceite de la bomba y revisión de barras', null, 250, null, 1300, 'Aceite de bomba 2 L, teflón de barra', 'Nilda Poma'],
      ['CUT-L2-01', 'Afilado y balanceo de cuchillas', null, 80, null, 690, 'Juego de cuchillas', 'Nilda Poma'],
      ['EMB-L2-01', 'Revisión de pistón y empaquetaduras', 60, null, '2026-10-20', null, 'Kit de empaquetaduras', 'Nilda Poma'],
      ['AHU-L2-01', 'Limpieza de ductos y revisión de quemadores', 60, null, '2026-09-30', null, 'Boquillas de quemador', 'Teodoro Mayta'],
      ['MAR-L2-01', 'Revisión de válvula de seguridad y quemador', 90, null, '2026-11-15', null, null, 'Rosa Inga'],
      ['TOS-L2-01', 'Limpieza de cascarilla y ciclón', null, 40, null, 470, null, 'Teodoro Mayta'],
      ['CAM-L1', 'Limpieza de condensador y revisión de gas', 30, null, '2026-10-10', null, 'Filtro deshidratador', 'Frío Total (externo)'],
      ['CAM-L2', 'Limpieza de condensador y revisión de gas', 30, null, '2026-10-25', null, 'Filtro deshidratador', 'Frío Total (externo)'],
      ['SIE-L1-01', 'Cambio de cinta y limpieza de poleas', 45, null, '2026-10-28', null, 'Cinta de sierra 2,82 m', 'Víctor Apaza'],
    ];
    const emp = name => (G.db.find('employees', e => e.full_name.startsWith(name.split(' (')[0])) || {}).id || null;
    for (const [code, act, fd, fh, nd, nh, parts, resp] of PL) ins('maintenance_plans', { id: 'mp-' + code, equipment_id: 'eq-' + code, activity: act, frequency_days: fd, frequency_hours: fh, next_due_on: nd, next_due_hours: nh, responsible_employee_id: emp(resp), responsible_name: resp, expected_parts: parts, status: 'ACTIVE' });

    /* --- órdenes de mantenimiento (setiembre y octubre) --- */
    const O = [
      ['OM-0024', 'MAR-L2-01', 'PREVENTIVE', 'mp-MAR-L2-01', 'Revisión de válvula de seguridad y quemador', '2026-08-17T08:00', '2026-08-17T11:00', 3, 60, [['Empaquetadura de válvula', 1, 35]], 0, null],
      ['OM-0025', 'SEL-L2-01', 'PREVENTIVE', 'mp-SEL-L2-01', 'Cambio de aceite de la bomba y revisión de barras', '2026-09-08T07:00', '2026-09-08T09:00', 2, 40, [['Aceite de bomba de vacío 2 L', 1, 120], ['Teflón de barra', 2, 18]], 0, null],
      ['OM-0026', 'CUT-L2-01', 'CORRECTIVE', null, 'Cuchilla con golpe; vibración al girar', '2026-09-15T10:20', '2026-09-16T16:00', null, 60, [['Cuchilla de cutter', 1, 380]], 0, null],
      ['OM-0027', 'SEL-L1-01', 'CORRECTIVE', null, 'Fugas de vacío: resistencia de sellado gastada', '2026-09-28T11:30', '2026-09-30T16:00', null, 80, [['Resistencia de sellado 42 cm', 1, 145]], 0, null],
      ['OM-0028', 'CAM-L1', 'PREVENTIVE', 'mp-CAM-L1', 'Limpieza de condensador y revisión de gas', '2026-09-10T15:00', '2026-09-10T17:00', 2, 0, [], 220, 'frio'],
      ['OM-0029', 'TOS-L2-01', 'PREVENTIVE', 'mp-TOS-L2-01', 'Limpieza de cascarilla y ciclón', '2026-10-02T07:00', '2026-10-02T08:30', 1.5, 30, [], 0, null],
      ['OM-0030', 'CUT-L2-01', 'PREVENTIVE', 'mp-CUT-L2-01', 'Afilado y balanceo de cuchillas', '2026-10-03T07:00', '2026-10-03T09:00', 2, 40, [], 90, 'frio'],
      ['OM-0031', 'CAM-L1', 'CORRECTIVE', null, 'Compresor no enfría: la cámara llegó a 7,8 °C', '2026-10-06T12:50', '2026-10-06T17:50', null, 0, [['Relé de arranque del compresor', 1, 220]], 380, 'frio'],
    ];
    for (const [num, code, kind, plan, desc, at, fin, down, labor, parts, ext, sup] of O) {
      const m = openOrder({ number: num, equipment_id: 'eq-' + code, kind, plan_id: plan, description: desc, reported_at: at, reported_by: G.db.find('users', u => u.role === 'JEFE_PRODUCCION').id, started_at: at }, { seed: true });
      finishOrder(m.id, { finished_at: fin, labor_cost: labor, labor_hours: labor / 20, parts: parts.map(([d, q, c]) => ({ description: d, qty: q, unit_cost: c })), external_cost: ext, external_supplier_id: sup === 'frio' && frio ? frio.id : null, downtime_hours: down, diagnosis: kind === 'CORRECTIVE' ? 'Pieza dañada; se reemplazó y se probó' : 'Actividad del plan realizada' }, { seed: true });
    }
    G.db.get('maintenance_plans', 'mp-CAM-L1').next_due_on = '2026-10-10';
    // correctiva abierta hoy: moledora del Local 1 fuera de servicio
    openOrder({ number: 'OM-0032', equipment_id: 'eq-MOL-L1-01', kind: 'CORRECTIVE', description: 'Ruido fuerte en el motor y se detiene con carga', reported_at: G.TODAY + 'T08:40', reported_by: G.db.find('users', u => u.role === 'OPERARIO_PRODUCCION' && (u.sites || []).includes('es-L1')).id, urgency: 'HIGH' }, { seed: true });
    // preventiva vencida > 7 días (ahumador) y la del día (cámara 1)
    runPlans(G.TODAY, { seed: true, at: G.TODAY + 'T06:00' });
    G.db.seq['DG:OM'] = Math.max(G.db.seq['DG:OM'] || 0, 32 + G.db.where('maintenance_orders', m => !/^OM-00(2|3[0-2])/.test(m.number)).length);

    /* --- uso de equipos por orden de producción (octubre) --- */
    const USE = [['EMB-L2-01', 2.5], ['CUT-L2-01', 1.5], ['AHU-L2-01', 4], ['MAR-L2-01', 3], ['SEL-L2-01', 2], ['TOS-L2-01', 1.5], ['SEL-L1-01', 1.5], ['SIE-L1-01', 2], ['REB-L2-01', 1]];
    let op = 380;
    for (let d = '2026-09-11'; d <= G.TODAY; d = G.date.add(d, 1)) {
      if (G.date.parse(d).getUTCDay() === 0) continue;
      op++;
      for (const [code, hrs] of USE) if (r() < 0.75) useInProduction({ equipment_id: 'eq-' + code, order_ref: 'OP01-0' + op, hours: R(hrs * (0.7 + r() * 0.6), 1), date: d, seed: true });
    }
    for (const e of G.db.all('equipment')) { const base = (E.find(x => x[0] === e.code) || [])[14] || 0; if (base) e.hour_meter = R(base + U.sum(G.db.where('production_order_equipment', u => u.equipment_id === e.id), u => u.hours), 1); }
  }, 'equipos');

  /* =====================================================================
     Pantallas
     ===================================================================== */
  const siteOpts = () => G.db.all('establishments').map(e => [e.id, e.short || e.name]);
  const eqOpts = pred => G.db.where('equipment', pred || (() => true)).sort(U.by('code')).map(e => [e.id, eqLabel(e)]);
  function calState(e, date = G.TODAY) {
    if (!e.requires_calibration) return { st: 'NOT_APPLICABLE', days: null };
    const v = validCal(e.id, date); const l = lastCal(e.id);
    if (!v) return { st: 'BLOCKED_CAL', days: l ? G.date.diff(l.valid_until, date) : null, cal: l };
    const days = G.date.diff(v.valid_until, date);
    return { st: days <= 30 ? 'EXPIRING' : 'USABLE', days, cal: v };
  }
  const useBadge = e => { const w = whyNot(e); return w ? badge(w.rule === 'RN-EQU-03' ? 'Calibración vencida' : 'No usar', 'bad') : badge('Apto', 'ok'); };

  /* ---------- EQU-01 Equipos ---------- */
  function rEQU01(el) {
    const body = page(el, { code: 'EQU-01', title: 'Equipos', sub: 'Maestro de equipos de los 2 locales con su QR, categoría, almacén asociado y estado. Un equipo fuera de servicio o con calibración vencida no se usa (RN-EQU-03, RN-EQU-04).', actions: [{ label: 'Nuevo equipo', kind: 'primary', icon: '+', onClick: () => G.require('equ.equipment.manage', () => editEq(null)) }] });
    const rows = G.scope.filter(G.db.all('equipment'));
    const scales = rows.filter(e => e.category === 'SCALE' && e.status !== 'RETIRED');
    body.appendChild(kpis([{ label: 'Equipos', value: rows.filter(e => e.status !== 'RETIRED').length }, { label: 'Fuera de servicio', value: rows.filter(e => e.status === 'OUT_OF_SERVICE').length, tone: rows.some(e => e.status === 'OUT_OF_SERVICE') ? 'bad' : 'ok', onClick: () => G.go('EQU-06') }, { label: 'Balanzas no aptas', value: scales.filter(e => !scaleUsable(e.id)).length, sub: `de ${scales.length} balanzas`, tone: scales.some(e => !scaleUsable(e.id)) ? 'bad' : 'ok', onClick: () => G.go('EQU-04') }, { label: 'Valor de compra', value: F.money(U.sum(rows, e => e.purchase_cost || 0), 0) }]));
    body.appendChild(table({ id: 'equ01', columns: [
      { key: 'code', label: 'Código', mono: true }, { key: 'qr', label: 'QR', sort: false, render: e => h('span', { title: e.qr_code, style: 'display:inline-block;width:34px' }, G.ui.qr(e.qr_code, 34)) }, { key: 'name', label: 'Equipo' }, { key: 'category', label: 'Categoría', value: e => catName(e.category) },
      { key: 'site', label: 'Local', value: e => G.siteName(e.establishment_id) }, { key: 'wh', label: 'Almacén', value: e => e.warehouse_id ? G.whName(e.warehouse_id) : '—' }, { key: 'brand_name', label: 'Marca' }, { key: 'model', label: 'Modelo' }, { key: 'serial_number', label: 'Serie', mono: true },
      { key: 'use', label: 'Uso', render: e => useBadge(e), value: e => whyNot(e) ? 'NO' : 'SI' }, { key: 'status', label: 'Estado', render: e => status(e.status) }],
      rows, filters: [{ key: 'category', label: 'Categoría', options: CATS }, { key: 'establishment_id', label: 'Local', options: siteOpts() }, { key: 'status', label: 'Estado', options: [['ACTIVE', 'Activo'], ['OUT_OF_SERVICE', 'Fuera de servicio'], ['RETIRED', 'De baja']] }],
      onRow: e => G.go('EQU-02', { id: e.id }), actions: e => [btn('QR', () => showQr(e), { sm: true, kind: 'ghost' })] }));
  }
  function showQr(e) {
    modal(`QR de ${e.code}`, b => b.appendChild(h('div', { class: 'stack', style: 'align-items:center;text-align:center' }, G.ui.qr(e.qr_code, 180), h('b', { class: 'mono' }, e.qr_code), h('div', null, e.name), h('div', { class: 'small muted' }, `${G.siteName(e.establishment_id)} · escanéalo para reportar una falla (EQU-07) o ver la ficha`))), [{ label: 'Imprimir', kind: 'primary', onClick: () => { G.print(); return false; } }]);
  }
  function editEq(e) {
    drawer(e ? 'Editar ' + e.code : 'Nuevo equipo', (b, close) => b.appendChild(form({ id: 'equ01-f', values: e || { category: 'SEALER', establishment_id: 'es-L1', status: 'ACTIVE', hourly_rate: 0 }, fields: [
      { key: 'code', label: 'Código', required: true, placeholder: 'SEL-L1-02' }, { key: 'name', label: 'Nombre', required: true }, { key: 'category', label: 'Categoría', type: 'select', options: CATS, required: true }, { key: 'establishment_id', label: 'Local', type: 'select', options: siteOpts(), required: true },
      { key: 'warehouse_id', label: 'Almacén (cámaras y congeladoras)', type: 'select', options: G.ui.opts('warehouses', w => w.name) }, { key: 'requires_calibration', label: 'Exige calibración (toda balanza, RN-EQU-01)', type: 'checkbox' },
      { key: 'brand_name', label: 'Marca' }, { key: 'model', label: 'Modelo' }, { key: 'serial_number', label: 'Serie' }, { key: 'capacity', label: 'Capacidad' },
      { key: 'purchase_date', label: 'Fecha de compra', type: 'date' }, { key: 'purchase_cost', label: 'Costo de compra', type: 'money', min: 0 }, { key: 'useful_life_months', label: 'Vida útil (meses)', type: 'number', min: 1 }, { key: 'power_kw', label: 'Potencia (kW)', type: 'number', min: 0 },
      { key: 'hourly_rate', label: 'Carga por hora S/ (RN-EQU-09)', type: 'money', min: 0 }, { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activo'], ['OUT_OF_SERVICE', 'Fuera de servicio'], ['RETIRED', 'De baja']], required: true }],
      onCancel: close, onSubmit: v => { const r = saveEquipment(v, e); close(); toast(`Equipo ${r.code} guardado`, 'ok'); G.refresh(); return true; } })), { code: 'EQU-01' });
  }

  /* ---------- EQU-02 Ficha ---------- */
  function rEQU02(el, params) {
    const all = G.scope.filter(G.db.all('equipment')).sort(U.by('code'));
    const e = eq(params.id) || all[0];
    const body = page(el, { code: 'EQU-02', title: 'Ficha del equipo', sub: 'Datos de compra, vida útil, carga por hora y potencia; historial de calibraciones, mantenimientos, fallas, horas de uso y costo acumulado.', actions: e ? [{ label: 'Editar', onClick: () => G.require('equ.equipment.manage', () => editEq(e)) }, { label: 'Reportar falla', kind: 'danger', onClick: () => G.go('EQU-07', { id: e.id }) }] : [] });
    const sel = h('select', { class: 'input', style: 'max-width:420px', attrs: { 'aria-label': 'Equipo' } }, all.map(x => h('option', { value: x.id, selected: e && x.id === e.id }, eqLabel(x))));
    sel.addEventListener('change', () => G.go('EQU-02', { id: sel.value }));
    body.appendChild(h('div', { class: 'row' }, sel));
    if (!e) { body.appendChild(G.ui.empty('No hay equipos.')); return; }
    const w = whyNot(e);
    body.appendChild(w ? notice([h('b', null, w.rule + ': '), w.msg], 'bad') : notice(`${e.code} está apto para usarse hoy.`, 'ok'));
    const orders = G.db.where('maintenance_orders', m => m.equipment_id === e.id).sort(U.by('reported_at', -1));
    const usage = G.db.where('production_order_equipment', u => u.equipment_id === e.id).sort(U.by('used_on', -1));
    const sug = suggestedRate(e);
    const totalMaint = U.sum(orders.filter(m => m.status === 'DONE'), m => m.total_cost);
    const totalCal = U.sum(calsOf(e.id), c => c.cost);
    body.appendChild(kpis([{ label: 'Horas acumuladas', value: F.num(e.hour_meter, 1) + ' h' }, { label: 'Costo de mantenimiento', value: F.money(totalMaint), sub: `${orders.filter(m => m.status === 'DONE').length} órdenes cerradas` }, { label: 'Costo de calibraciones', value: F.money(totalCal) }, { label: 'Horas fuera de servicio', value: F.num(U.sum(orders, m => m.downtime_hours || (m.kind === 'CORRECTIVE' && m.status !== 'DONE' ? hoursBetween(m.reported_at, G.date.now()) : 0)), 1) + ' h' }, { label: 'Carga por hora', value: F.money(e.hourly_rate), sub: sug != null ? `sugerida ${F.money(sug)}` : 'sin uso suficiente para sugerir' }]));
    const g = h('div', { class: 'grid side-r' });
    g.appendChild(card('Datos', dl([['Código', e.code], ['Nombre', e.name], ['Categoría', catName(e.category)], ['Local', G.siteName(e.establishment_id)], ['Almacén', e.warehouse_id ? G.whName(e.warehouse_id) : null], ['Marca y modelo', `${e.brand_name || ''} ${e.model || ''}`], ['Serie', e.serial_number], ['Capacidad', e.capacity], ['Potencia', e.power_kw != null ? F.num(e.power_kw, 2) + ' kW' : null], ['Compra', `${F.date(e.purchase_date)} · ${F.money(e.purchase_cost)}`], ['Vida útil', e.useful_life_months ? e.useful_life_months + ' meses' : null], ['Centro de costo', G.ccName(e.cost_center_id)], ['Exige calibración', e.requires_calibration ? 'Sí' : 'No'], ['Punto de temperatura', (G.db.find('temperature_points', p => p.equipment_id === e.id) || {}).name], ['Manual', e.manual_url], ['Estado', status(e.status)]])));
    g.appendChild(card('QR del equipo', h('div', { class: 'stack', style: 'align-items:center' }, G.ui.qr(e.qr_code, 140), h('span', { class: 'mono' }, e.qr_code), sug != null && G.can('equ.equipment.manage') ? btn(`Aplicar carga sugerida ${F.money(sug)}`, () => run(() => G.db.update('equipment', e.id, { hourly_rate: sug }), 'Carga por hora actualizada'), { sm: true }) : null, h('div', { class: 'small muted', style: 'text-align:center' }, 'RN-EQU-09: (costo / vida útil + mantenimiento mensual) / horas de uso mensuales; la fija el jefe de producción.'))));
    body.appendChild(g);
    body.appendChild(tabs([
      { key: 'cal', label: 'Calibraciones', count: calsOf(e.id).length, render: p => p.appendChild(e.requires_calibration ? table({ id: 'equ02-cal', search: false, columns: calCols(false), rows: calsOf(e.id) }) : G.ui.empty('Este equipo no exige calibración.')) },
      { key: 'mnt', label: 'Mantenimientos y fallas', count: orders.length, render: p => p.appendChild(table({ id: 'equ02-om', search: false, columns: omCols(false), rows: orders, onRow: m => openOM(m) })) },
      { key: 'use', label: 'Horas de uso', count: usage.length, render: p => { p.appendChild(table({ id: 'equ02-use', search: false, columns: [{ key: 'used_on', label: 'Fecha', render: u => F.date(u.used_on) }, { key: 'ord', label: 'Orden', mono: true, value: u => u.order_ref || (G.db.get('production_orders', u.order_id) || {}).number }, { key: 'hours', label: 'Horas', align: 'r', render: u => F.num(u.hours, 1) }, { key: 'hourly_rate', label: 'S/ por hora', align: 'r', render: u => F.money(u.hourly_rate) }, { key: 'cost', label: 'Costo cargado', align: 'r', render: u => F.money(u.cost) }], rows: usage })); if ((e.meter_readings || []).length) p.appendChild(card('Lecturas de horómetro', h('div', { class: 'timeline' }, e.meter_readings.slice().reverse().map(m => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, F.datetime(m.at)), h('span', { class: 'dot' }), h('span', null, F.num(m.hours, 1) + ' h · ' + m.by)))))); } },
    ]));
  }

  /* ---------- EQU-03 Calibraciones ---------- */
  const calCols = withEq => [withEq ? { key: 'eq', label: 'Equipo', value: c => eqLabel(eq(c.equipment_id)) } : null, { key: 'calibrated_on', label: 'Calibrado', render: c => F.date(c.calibrated_on) }, { key: 'valid_until', label: 'Vigente hasta', render: c => F.date(c.valid_until) }, { key: 'prov', label: 'Proveedor', value: c => c.provider_name || (c.provider_supplier_id ? G.supName(c.provider_supplier_id) : '—') }, { key: 'certificate_number', label: 'Certificado', mono: true }, { key: 'certificate_url', label: 'Archivo' }, { key: 'max_error_g', label: 'Error máx. (g)', align: 'r', render: c => c.max_error_g == null ? '—' : F.num(c.max_error_g, 1) }, { key: 'result', label: 'Resultado', render: c => sb(c.result) }, { key: 'cost', label: 'Costo', align: 'r', render: c => F.money(c.cost) }].filter(Boolean);
  function rEQU03(el, params) {
    const body = page(el, { code: 'EQU-03', title: 'Calibraciones', sub: 'Registro con fecha, vigencia, proveedor, número y archivo del certificado, error máximo, resultado y costo. Son de solo inserción: un error se corrige registrando otra (RN-EQU-12).', actions: [{ label: 'Registrar calibración', kind: 'primary', icon: '+', onClick: () => G.require('equ.calibration.record', () => calDrawer(params.id)) }] });
    const rows = G.db.all('equipment_calibrations').filter(c => G.scope.ok(eq(c.equipment_id))).sort((a, b) => b.calibrated_on.localeCompare(a.calibrated_on));
    const y = rows.filter(c => c.calibrated_on >= '2026-01-01');
    body.appendChild(kpis([{ label: 'Calibraciones del año', value: y.length }, { label: 'No conformes', value: y.filter(c => c.result === 'FAIL').length, tone: 'bad' }, { label: 'Costo del año', value: F.money(U.sum(y, c => c.cost)) }, { label: 'Vigencia sugerida de balanzas', value: `${G.param('equ_scale_calibration_months')} meses`, sub: 'equ_scale_calibration_months · D-EQU-01' }]));
    body.appendChild(table({ id: 'equ03', columns: calCols(true), rows, filters: [{ key: 'result', label: 'Resultado', options: [['PASS', 'Conforme'], ['FAIL', 'No conforme']] }], onRow: c => G.go('EQU-02', { id: c.equipment_id }) }));
    if (params.new) setTimeout(() => G.require('equ.calibration.record', () => calDrawer(params.id)), 0);
  }
  function calDrawer(eqId) {
    drawer('Registrar calibración', (b, close) => {
      const info = h('div');
      const months = G.param('equ_scale_calibration_months') ?? 6;
      const f = form({ id: 'equ03-f', values: { equipment_id: eqId || '', calibrated_on: G.TODAY, valid_until: G.date.add(G.date.addMonths(G.TODAY, months), G.date.parse(G.TODAY).getUTCDate() - 2), result: 'PASS', provider_name: 'Metrología y Balanzas del Perú SAC (laboratorio acreditado INACAL)', cost: 180 }, fields: [
        { key: 'equipment_id', label: 'Equipo', type: 'select', required: true, options: eqOpts(e => e.requires_calibration && e.status !== 'RETIRED'), onChange: () => upd() },
        { key: 'calibrated_on', label: 'Fecha de calibración', type: 'date', required: true, onChange: (v, vals, api) => { api.set('valid_until', G.date.add(G.date.addMonths(v, months), G.date.parse(v).getUTCDate() - 2)); upd(); } }, { key: 'valid_until', label: 'Vigente hasta', type: 'date', required: true, onChange: () => upd() },
        { key: 'provider_name', label: 'Proveedor', required: true, span: 2 }, { key: 'certificate_number', label: 'N.º de certificado', help: 'Obligatorio (RN-EQU-02)' }, { key: 'certificate_url', label: 'Archivo del certificado', help: 'Obligatorio (RN-EQU-02)' },
        { key: 'max_error_g', label: 'Error máximo encontrado (g)', type: 'number' }, { key: 'result', label: 'Resultado', type: 'select', options: [['PASS', 'Conforme'], ['FAIL', 'No conforme']], required: true, onChange: () => upd() }, { key: 'cost', label: 'Costo', type: 'money', min: 0 }, { key: 'notes', label: 'Notas', type: 'textarea' }],
        onCancel: close, onSubmit: v => { const c = recordCalibration(v); close(); toast(c.result === 'PASS' ? `Calibración ${c.certificate_number} registrada: ${eq(c.equipment_id).code} vuelve a poder usarse hasta el ${F.date(c.valid_until)}` : `Calibración no conforme: ${eq(c.equipment_id).code} queda fuera de servicio (RN-EQU-10)`, c.result === 'PASS' ? 'ok' : 'bad'); G.refresh(); return true; } });
      function upd() { const v = f.api.values; const e = eq(v.equipment_id); G.ui.clear(info); if (!e) return; const s = calState(e); info.appendChild(notice(`${e.code}: ${s.st === 'BLOCKED_CAL' ? 'hoy NO se puede usar (calibración vencida)' : 'calibración vigente hasta ' + F.date(s.cal.valid_until)}. ${v.result === 'FAIL' ? 'Un resultado no conforme lo deja fuera de servicio (RN-EQU-10).' : 'Con esta calibración conforme quedará apto hasta el ' + F.date(v.valid_until) + '.'}`, v.result === 'FAIL' ? 'bad' : 'info')); }
      b.append(f, info); upd();
    }, { code: 'EQU-03' });
  }

  /* ---------- EQU-04 Calendario de calibraciones ---------- */
  function rEQU04(el) {
    const body = page(el, { code: 'EQU-04', title: 'Calendario de calibraciones', sub: `Balanzas y termómetros vencidos, por vencer en 30 días y vigentes. Se avisa ${G.param('equ_calibration_alert_days')} días antes (RN-EQU-08); una balanza vencida no pesa ventas ni lotes (RN-EQU-03).` });
    const rows = G.scope.filter(G.db.where('equipment', e => e.requires_calibration && e.status !== 'RETIRED')).map(e => Object.assign({ cs: calState(e) }, e)).sort((a, b) => (a.cs.days ?? -999) - (b.cs.days ?? -999));
    const alertD = G.param('equ_calibration_alert_days') ?? 15;
    body.appendChild(kpis([{ label: 'Vencidas o bloqueadas', value: rows.filter(e => e.cs.st === 'BLOCKED_CAL').length, tone: 'bad' }, { label: 'Vencen en 30 días', value: rows.filter(e => e.cs.st === 'EXPIRING').length, tone: 'warn' }, { label: `Con aviso (≤ ${alertD} días)`, value: rows.filter(e => e.cs.st === 'EXPIRING' && e.cs.days <= alertD).length }, { label: 'Balanzas con calibración vigente', value: F.pct((G.kpi('KPI-EQU-02') || {}).value), sub: 'KPI-EQU-02 · meta 100 %' }]));
    body.appendChild(table({ id: 'equ04', columns: [
      { key: 'code', label: 'Equipo', mono: true }, { key: 'name', label: 'Nombre' }, { key: 'category', label: 'Categoría', value: e => catName(e.category) }, { key: 'site', label: 'Local', value: e => G.siteName(e.establishment_id) },
      { key: 'vu', label: 'Vigente hasta', render: e => F.date(e.cs.cal && e.cs.cal.valid_until), value: e => e.cs.cal ? e.cs.cal.valid_until : '' }, { key: 'days', label: 'Días', align: 'r', render: e => e.cs.days == null ? '—' : h('b', { style: e.cs.days < 0 ? 'color:var(--bad)' : e.cs.days <= 30 ? 'color:var(--warn)' : '' }, e.cs.days), value: e => e.cs.days ?? -999 },
      { key: 'cert', label: 'Certificado', mono: true, value: e => (e.cs.cal || {}).certificate_number }, { key: 'st', label: 'Estado', render: e => sb(e.cs.st), value: e => e.cs.st }],
      rows, filters: [{ key: 'st', label: 'Estado', options: [['BLOCKED_CAL', 'Vencida'], ['EXPIRING', 'Por vencer'], ['USABLE', 'Vigente']], value: e => e.cs.st }],
      onRow: e => G.go('EQU-02', { id: e.id }), actions: e => [btn('Calibrar', () => G.go('EQU-03', { id: e.id, new: 1 }), { sm: true, kind: e.cs.st === 'BLOCKED_CAL' ? 'primary' : '' })] }));
    const months = []; for (let i = 0; i < 6; i++) months.push(G.date.addMonths(G.TODAY, i));
    body.appendChild(card('Vencimientos de los próximos 6 meses', G.ui.chart.bar({ labels: months.map(m => G.date.monthName(m)), series: [{ name: 'Calibraciones que vencen', values: months.map(m => rows.filter(e => e.cs.cal && G.date.month(e.cs.cal.valid_until) === m && e.cs.st !== 'BLOCKED_CAL').length) }], format: v => F.num(v) })));
  }

  /* ---------- EQU-05 Planes preventivos ---------- */
  function rEQU05(el) {
    const body = page(el, { code: 'EQU-05', title: 'Planes preventivos', sub: `Actividad, frecuencia en días u horas de uso, responsable y repuestos esperados. Al llegar la fecha o las horas se crea la orden; con más de ${G.param('equ_preventive_overdue_days')} días de atraso se avisa al jefe de producción (RN-EQU-07).`, actions: [{ label: 'Generar órdenes que tocan', icon: '⟳', onClick: () => G.require('equ.maintenance.manage', () => run(() => { const o = runPlans(); toast(o.length ? `${o.length} orden(es) preventiva(s) creada(s): ${o.map(x => x.number).join(', ')}` : 'No hay planes pendientes sin orden', o.length ? 'ok' : 'info'); })) }, { label: 'Nuevo plan', kind: 'primary', icon: '+', onClick: () => G.require('equ.maintenance.manage', () => planDrawer(null)) }] });
    const rows = G.db.all('maintenance_plans').filter(p => G.scope.ok(eq(p.equipment_id)));
    body.appendChild(kpis([{ label: 'Planes activos', value: rows.filter(p => p.status === 'ACTIVE').length }, { label: 'Tocan ahora', value: rows.filter(p => planState(p) === 'DUE').length, tone: 'warn' }, { label: 'Vencidos (aviso al jefe)', value: rows.filter(p => planState(p) === 'OVERDUE').length, tone: 'bad' }, { label: 'Cumplimiento del preventivo', value: F.pct((G.kpi('KPI-EQU-04') || {}).value), sub: 'KPI-EQU-04' }]));
    body.appendChild(table({ id: 'equ05', columns: [
      { key: 'eq', label: 'Equipo', value: p => eqLabel(eq(p.equipment_id)) }, { key: 'activity', label: 'Actividad' }, { key: 'fr', label: 'Frecuencia', value: p => p.frequency_days ? `Cada ${p.frequency_days} días` : `Cada ${F.num(p.frequency_hours)} h de uso` },
      { key: 'next', label: 'Próxima', value: p => p.next_due_on ? F.date(p.next_due_on) : `a las ${F.num(p.next_due_hours)} h (lleva ${F.num((eq(p.equipment_id) || {}).hour_meter, 1)} h)` }, { key: 'responsible_name', label: 'Responsable' }, { key: 'expected_parts', label: 'Repuestos esperados' },
      { key: 'om', label: 'Orden abierta', mono: true, value: p => (G.db.find('maintenance_orders', m => m.plan_id === p.id && ['OPEN', 'IN_PROGRESS'].includes(m.status)) || {}).number || '' }, { key: 'st', label: 'Estado', render: p => sb(planState(p)), value: p => planState(p) }],
      rows, filters: [{ key: 'st', label: 'Estado', options: [['OK', 'Al día'], ['DUE', 'Toca'], ['OVERDUE', 'Vencido']], value: p => planState(p) }], onRow: p => G.require('equ.maintenance.manage', () => planDrawer(p)) }));
  }
  function planDrawer(p) {
    drawer(p ? 'Editar plan' : 'Nuevo plan preventivo', (b, close) => b.appendChild(form({ id: 'equ05-f', values: p || { status: 'ACTIVE', next_due_on: G.date.add(G.TODAY, 30) }, fields: [
      { key: 'equipment_id', label: 'Equipo', type: 'select', options: eqOpts(e => e.status !== 'RETIRED'), required: true }, { key: 'activity', label: 'Actividad', required: true, span: 2 },
      { key: 'frequency_days', label: 'Cada N días', type: 'number', min: 1 }, { key: 'frequency_hours', label: 'O cada N horas de uso', type: 'number', min: 1 }, { key: 'next_due_on', label: 'Próxima fecha', type: 'date' }, { key: 'next_due_hours', label: 'Próximo horómetro', type: 'number' },
      { key: 'responsible_name', label: 'Responsable', required: true }, { key: 'expected_parts', label: 'Repuestos esperados' }, { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']], required: true }],
      onCancel: close, onSubmit: v => { if (!v.frequency_days && !v.frequency_hours) return 'Indica la frecuencia en días o en horas de uso.'; const row = { equipment_id: v.equipment_id, activity: v.activity, frequency_days: v.frequency_days || null, frequency_hours: v.frequency_hours || null, next_due_on: v.next_due_on || null, next_due_hours: v.next_due_hours === '' ? null : v.next_due_hours ?? null, responsible_name: v.responsible_name, expected_parts: v.expected_parts || null, status: v.status }; if (p) G.db.update('maintenance_plans', p.id, row); else G.db.insert('maintenance_plans', row); close(); toast('Plan guardado', 'ok'); G.refresh(); return true; } })), { code: 'EQU-05' });
  }

  /* ---------- EQU-06 Órdenes de mantenimiento ---------- */
  const omCols = withEq => [{ key: 'number', label: 'N.º', mono: true }, withEq ? { key: 'eq', label: 'Equipo', value: m => eqLabel(eq(m.equipment_id)) } : null, { key: 'kind', label: 'Tipo', render: m => sb(m.kind), value: m => m.kind }, { key: 'description', label: 'Descripción' }, { key: 'reported_at', label: 'Reportada', render: m => F.datetime(m.reported_at) }, { key: 'finished_at', label: 'Terminada', render: m => F.datetime(m.finished_at) }, { key: 'downtime_hours', label: 'Fuera de servicio', align: 'r', value: m => m.downtime_hours != null ? F.num(m.downtime_hours, 1) + ' h' : m.kind === 'CORRECTIVE' && m.status !== 'DONE' ? F.num(hoursBetween(m.reported_at, G.date.now()), 1) + ' h…' : '—' }, { key: 'total_cost', label: 'Costo', align: 'r', render: m => F.money(m.total_cost) }, { key: 'status', label: 'Estado', render: m => status(m.status), value: m => m.status }].filter(Boolean);
  function rEQU06(el, params) {
    const body = page(el, { code: 'EQU-06', title: 'Órdenes de mantenimiento', sub: 'Preventivas (desde el plan) o correctivas (desde una falla): diagnóstico, repuestos, horas, servicio externo, costo y tiempo fuera de servicio. Costo = mano de obra + repuestos + servicio externo al centro de costo del local (RN-EQU-06).', actions: [{ label: 'Nueva orden', kind: 'primary', icon: '+', onClick: () => G.require('equ.maintenance.manage', () => newOM()) }] });
    const rows = G.db.all('maintenance_orders').filter(m => G.scope.ok(eq(m.equipment_id))).sort(U.by('reported_at', -1));
    const open = rows.filter(m => ['OPEN', 'IN_PROGRESS'].includes(m.status));
    body.appendChild(kpis([{ label: 'Abiertas', value: open.length, tone: open.length ? 'warn' : 'ok' }, { label: 'Correctivas abiertas', value: open.filter(m => m.kind === 'CORRECTIVE').length, tone: open.some(m => m.kind === 'CORRECTIVE') ? 'bad' : '' }, { label: 'Costo del mes', value: F.money((G.kpi('KPI-EQU-03') || {}).value), sub: 'KPI-EQU-03' }, { label: 'Disponibilidad del mes', value: F.pct((G.kpi('KPI-EQU-01') || {}).value), sub: 'KPI-EQU-01' }]));
    body.appendChild(table({ id: 'equ06', columns: omCols(true), rows, filters: [{ key: 'kind', label: 'Tipo', options: [['PREVENTIVE', 'Preventiva'], ['CORRECTIVE', 'Correctiva']] }, { key: 'status', label: 'Estado', options: [['OPEN', 'Abierta'], ['IN_PROGRESS', 'En proceso'], ['DONE', 'Hecha'], ['VOIDED', 'Anulada']] }], onRow: m => openOM(m) }));
    if (params.id) setTimeout(() => { const m = G.db.get('maintenance_orders', params.id); if (m) openOM(m); }, 0);
  }
  function newOM() {
    drawer('Nueva orden de mantenimiento', (b, close) => b.appendChild(form({ id: 'equ06-new', values: { kind: 'CORRECTIVE' }, fields: [{ key: 'equipment_id', label: 'Equipo', type: 'select', options: eqOpts(e => e.status !== 'RETIRED'), required: true }, { key: 'kind', label: 'Tipo', type: 'select', options: [['CORRECTIVE', 'Correctiva (deja el equipo fuera de servicio)'], ['PREVENTIVE', 'Preventiva']], required: true }, { key: 'description', label: 'Descripción', type: 'textarea', required: true }],
      onCancel: close, onSubmit: v => { const m = openOrder(v); close(); toast(`Orden ${m.number} abierta${m.kind === 'CORRECTIVE' ? `: ${eq(m.equipment_id).code} queda fuera de servicio (RN-EQU-05)` : ''}`, m.kind === 'CORRECTIVE' ? 'warn' : 'ok'); G.refresh(); openOM(m); return true; } })), { code: 'EQU-06' });
  }
  function openOM(m) {
    m = G.db.get('maintenance_orders', m.id); const e = eq(m.equipment_id);
    drawer(`Orden ${m.number} · ${e.code}`, (b, close) => {
      const reopen = () => { close(); G.refresh(); openOM(m); };
      if (m.status === 'OPEN') b.appendChild(h('div', { class: 'row' }, btn('Iniciar trabajo', () => { if (run(() => startOrder(m.id), 'Orden en proceso')) reopen(); }, { sm: true, kind: 'primary', disabled: !G.can('equ.maintenance.manage') }), btn('Anular', () => modal('Anular ' + m.number, (mb, mc) => mb.appendChild(form({ id: 'equ06-void', fields: [{ key: 'reason', label: 'Motivo', type: 'textarea', required: true }], submitLabel: 'Anular', onCancel: mc, onSubmit: v => { G.db.update('maintenance_orders', m.id, { status: 'VOIDED', void_reason: v.reason }); if (m.kind === 'CORRECTIVE' && !openCorrectives(e.id).length && e.status === 'OUT_OF_SERVICE' && e.oos_reason !== 'CALIBRATION') G.db.update('equipment', e.id, { status: 'ACTIVE', oos_reason: null }); mc(); reopen(); return true; } }))), { sm: true, kind: 'ghost', disabled: !G.can('equ.maintenance.manage') })));
      b.appendChild(dl([['Equipo', `${eqLabel(e)} · ${G.siteName(e.establishment_id)}`], ['Estado del equipo', status(e.status)], ['Tipo', sb(m.kind)], ['Plan', m.plan_id ? (G.db.get('maintenance_plans', m.plan_id) || {}).activity : null], ['Descripción', m.description], ['Urgencia', m.urgency === 'HIGH' ? 'Alta' : 'Normal'], ['Foto', m.photo_url], ['Reportada', `${F.datetime(m.reported_at)} · ${G.userShort(m.reported_by)}`], ['Inicio', F.datetime(m.started_at)], ['Fin', F.datetime(m.finished_at)], ['Diagnóstico', m.diagnosis], ['Tiempo fuera de servicio', m.downtime_hours != null ? F.num(m.downtime_hours, 1) + ' h' : null], ['Centro de costo', G.ccName(m.cost_center_id)], ['Estado', status(m.status)]]));
      if (m.status === 'DONE' || m.parts.length) b.appendChild(card('Costo (RN-EQU-06)', h('div', null, table({ id: 'equ06-parts', search: false, columns: [{ key: 'description', label: 'Repuesto' }, { key: 'qty', label: 'Cant.', align: 'r' }, { key: 'unit_cost', label: 'Costo unit.', align: 'r', render: p => F.money(p.unit_cost) }, { key: 't', label: 'Total', align: 'r', value: p => F.money(p.qty * p.unit_cost) }], rows: m.parts }), dl([['Mano de obra', F.money(m.labor_cost)], ['Repuestos', F.money(m.parts_cost)], ['Servicio externo', `${F.money(m.external_cost)}${m.external_supplier_id ? ' · ' + G.supName(m.external_supplier_id) : ''}`], ['Total', h('b', null, F.money(m.total_cost))]]))));
      if (['OPEN', 'IN_PROGRESS'].includes(m.status)) {
        const parts = (m.parts || []).slice();
        const tot = h('div', { class: 'notice info' });
        const partsBox = h('div');
        const vals = { labor_cost: m.labor_cost || 0, external_cost: m.external_cost || 0 };
        const drawTot = () => { const pc = U.sum(parts, p => p.qty * p.unit_cost); G.ui.clear(tot).appendChild(h('span', null, `Mano de obra ${F.money(vals.labor_cost)} + repuestos ${F.money(pc)} + servicio externo ${F.money(vals.external_cost)} = `, h('b', null, F.money(Number(vals.labor_cost || 0) + pc + Number(vals.external_cost || 0))))); };
        const drawParts = () => { G.ui.clear(partsBox); partsBox.appendChild(table({ id: 'equ06-np', search: false, columns: [{ key: 'description', label: 'Repuesto' }, { key: 'qty', label: 'Cant.', align: 'r' }, { key: 'unit_cost', label: 'Costo unit.', align: 'r', render: p => F.money(p.unit_cost) }], rows: parts, actions: p => [btn('Quitar', () => { parts.splice(parts.indexOf(p), 1); drawParts(); drawTot(); }, { sm: true, kind: 'ghost' })], empty: 'Sin repuestos.' })); const d = h('input', { class: 'input', placeholder: 'Repuesto (sale de ALM)', attrs: { 'aria-label': 'Repuesto' } }), q = h('input', { class: 'input', type: 'number', value: 1, style: 'max-width:80px', attrs: { 'aria-label': 'Cantidad' } }), c = h('input', { class: 'input', type: 'number', step: '0.01', placeholder: 'S/', style: 'max-width:110px', attrs: { 'aria-label': 'Costo unitario' } }); partsBox.appendChild(h('div', { class: 'row', style: 'margin-top:6px' }, d, q, c, btn('Agregar', () => { if (!d.value || !(Number(c.value) >= 0) || !(Number(q.value) > 0)) return toast('Completa repuesto, cantidad y costo.', 'warn'); parts.push({ description: d.value, qty: Number(q.value), unit_cost: Number(c.value) }); drawParts(); drawTot(); }, { sm: true }))); };
        drawParts();
        b.appendChild(card('Cerrar y costear', h('div', null, partsBox, form({ id: 'equ06-fin', values: { labor_cost: m.labor_cost || 0, external_cost: 0, diagnosis: m.diagnosis || '' }, fields: [{ key: 'diagnosis', label: 'Diagnóstico y trabajo hecho', type: 'textarea', required: true }, { key: 'labor_cost', label: 'Mano de obra S/', type: 'money', min: 0, onChange: v => { vals.labor_cost = v || 0; drawTot(); } }, { key: 'external_cost', label: 'Servicio externo S/', type: 'money', min: 0, onChange: v => { vals.external_cost = v || 0; drawTot(); } }, { key: 'external_supplier_id', label: 'Proveedor del servicio', type: 'select', options: G.ui.opts('suppliers', s => s.trade_name || s.legal_name, s => ['SERVICES', 'INPUTS', 'PACKAGING'].includes(s.supplier_type)) }, { key: 'downtime_hours', label: 'Horas fuera de servicio (vacío = calculado)', type: 'number', min: 0 }],
          submitLabel: 'Cerrar orden', onSubmit: v => { const r2 = finishOrder(m.id, { diagnosis: v.diagnosis, labor_cost: v.labor_cost, external_cost: v.external_cost, external_supplier_id: v.external_supplier_id, downtime_hours: v.downtime_hours, parts }); toast(`Orden ${r2.number} cerrada: ${F.money(r2.total_cost)} a ${G.ccName(r2.cost_center_id)}${eq(e.id).status === 'ACTIVE' ? `; ${e.code} vuelve a ACTIVO` : ''}`, 'ok'); reopen(); return true; } }), tot)));
        drawTot();
      }
    }, { code: 'EQU-06', wide: true });
  }

  /* ---------- EQU-07 Reporte de falla (celular) ---------- */
  function rEQU07(el, params) {
    const body = page(el, { code: 'EQU-07', title: 'Reporte de falla', sub: 'Desde el celular: escaneo del QR, descripción y foto. Crea la orden correctiva y deja el equipo fuera de servicio (RN-EQU-05).' });
    const st = { eq: params.id || '' };
    const phone = h('div', { class: 'phone' }); const scr = h('div', { class: 'phone-screen', style: 'padding:14px;gap:10px' }); phone.appendChild(scr);
    const draw = () => {
      G.ui.clear(scr);
      const e = eq(st.eq);
      scr.appendChild(h('div', { class: 'row between' }, h('b', null, 'Reportar falla'), h('span', { class: 'small muted' }, G.ctx.userName())));
      const code = h('input', { class: 'input', placeholder: 'Escanea o escribe el código (EQ-SEL-L1-01)', attrs: { 'aria-label': 'Código del equipo' } });
      scr.appendChild(h('div', { class: 'row' }, code, btn('Buscar', () => { const f = findEq(code.value); if (!f) return toast('Código no reconocido', 'warn'); st.eq = f.id; draw(); }, { sm: true })));
      const sel = h('select', { class: 'input', attrs: { 'aria-label': 'Equipo' } }, h('option', { value: '' }, 'o elige el equipo…'), eqOpts(x => x.status !== 'RETIRED' && (G.ctx.site === 'ALL' || x.establishment_id === G.ctx.site)).map(([v, l]) => h('option', { value: v, selected: v === st.eq }, l)));
      sel.addEventListener('change', () => { st.eq = sel.value; draw(); }); scr.appendChild(sel);
      if (e) {
        scr.appendChild(h('div', { class: 'card', style: 'padding:10px' }, h('div', { class: 'row' }, G.ui.qr(e.qr_code, 56), h('div', null, h('b', null, e.code), h('div', { class: 'small' }, e.name), h('div', { class: 'small muted' }, G.siteName(e.establishment_id)), status(e.status)))));
        const oc = openCorrectives(e.id)[0];
        if (oc) scr.appendChild(notice(`Ya hay una orden abierta (${oc.number}); tu reporte se agrega a ella.`, 'warn'));
        const desc = h('textarea', { class: 'input', placeholder: '¿Qué pasa? (ruido, no enfría, no sella…)', attrs: { 'aria-label': 'Descripción' } });
        const urg = G.ui.pills([['NORMAL', 'Normal'], ['HIGH', 'Urgente: para la producción']], st.urg || 'NORMAL', v => { st.urg = v; draw(); });
        const photo = h('input', { class: 'input', type: 'file', attrs: { accept: 'image/*', capture: 'environment', 'aria-label': 'Foto' } });
        scr.append(h('label', { class: 'small' }, 'Descripción'), desc, urg, h('label', { class: 'small' }, 'Foto'), photo,
          btn('Enviar reporte', () => { try { const m = reportFailure({ equipment_id: e.id, description: desc.value.trim(), urgency: st.urg || 'NORMAL', photo_url: photo.files && photo.files[0] ? 'fallas/' + photo.files[0].name : null }); if (!desc.value.trim()) return; toast(`Reporte enviado: orden ${m.number}; ${e.code} fuera de servicio`, 'ok'); st.eq = ''; G.refresh(); } catch (er) { toast(er.message, 'bad'); } }, { kind: 'danger' }));
      }
    };
    draw();
    const mine = G.db.where('maintenance_orders', m => m.kind === 'CORRECTIVE').filter(m => G.scope.ok(eq(m.equipment_id))).sort(U.by('reported_at', -1)).slice(0, 12);
    const g = h('div', { class: 'grid c2' }, phone, card('Últimos reportes de falla', table({ id: 'equ07', search: false, columns: [{ key: 'number', label: 'Orden', mono: true }, { key: 'eq', label: 'Equipo', value: m => eq(m.equipment_id).code }, { key: 'reported_at', label: 'Reportada', render: m => F.datetime(m.reported_at) }, { key: 'by', label: 'Reportó', value: m => G.userShort(m.reported_by) }, { key: 'status', label: 'Estado', render: m => status(m.status) }], rows: mine, onRow: m => G.go('EQU-06', { id: m.id }) }), { flush: true }));
    body.appendChild(g);
  }

  /* ---------- EQU-08 Uso ---------- */
  function rEQU08(el) {
    const body = page(el, { code: 'EQU-08', title: 'Uso del equipo', sub: 'Horas por orden de producción (PRO-09) y lecturas de horómetro. Solo se registran equipos aptos: ni fuera de servicio (RN-EQU-04) ni con calibración vencida (RN-EQU-03).', actions: [{ label: 'Lectura de horómetro', onClick: () => meterDrawer() }, { label: 'Registrar horas', kind: 'primary', icon: '+', onClick: () => useDrawer() }] });
    const from = G.date.month(G.TODAY);
    const rows = G.db.where('production_order_equipment', u => u.equipment_id && (u.used_on || '') >= G.date.add(G.TODAY, -30)).filter(u => G.scope.ok(eq(u.equipment_id))).sort(U.by('used_on', -1));
    const mrows = rows.filter(u => u.used_on >= from);
    body.appendChild(kpis([{ label: 'Horas del mes', value: F.num(U.sum(mrows, u => u.hours), 1) + ' h' }, { label: 'Costo de equipos cargado', value: F.money(U.sum(mrows, u => u.cost)), sub: 'entra al costo de las órdenes (PRO)' }, { label: 'Órdenes con equipos', value: new Set(mrows.map(u => u.order_ref || u.order_id)).size }, { label: 'Equipos usados', value: new Set(mrows.map(u => u.equipment_id)).size }]));
    const byEq = U.groupBy(mrows, 'equipment_id');
    body.appendChild(card('Horas del mes por equipo', G.ui.chart.hbar({ items: Object.entries(byEq).map(([id, us]) => ({ label: eq(id).code, value: R(U.sum(us, u => u.hours), 1) })).sort((a, b) => b.value - a.value), format: v => F.num(v, 1) + ' h' })));
    body.appendChild(table({ id: 'equ08', columns: [{ key: 'used_on', label: 'Fecha', render: u => F.date(u.used_on) }, { key: 'ord', label: 'Orden', mono: true, value: u => u.order_ref || (G.db.get('production_orders', u.order_id) || {}).number }, { key: 'eq', label: 'Equipo', value: u => eqLabel(eq(u.equipment_id)) }, { key: 'hours', label: 'Horas', align: 'r', render: u => F.num(u.hours, 1) }, { key: 'hourly_rate', label: 'S/ por hora', align: 'r', render: u => F.money(u.hourly_rate) }, { key: 'cost', label: 'Costo', align: 'r', render: u => F.money(u.cost) }],
      rows, filters: [{ key: 'eq', label: 'Equipo', options: [...new Set(rows.map(u => u.equipment_id))].map(id => [eq(id).code, eq(id).code]), value: u => eq(u.equipment_id).code }] }));
  }
  function useDrawer() {
    drawer('Registrar horas de uso', (b, close) => {
      const info = h('div');
      const pos = G.db.where('production_orders', o => ['RELEASED', 'IN_PROGRESS', 'PLANNED'].includes(o.status)).map(o => [o.id, o.number]);
      const f = form({ id: 'equ08-f', values: { used_on: G.TODAY }, fields: [{ key: 'equipment_id', label: 'Equipo', type: 'select', options: eqOpts(e => e.status !== 'RETIRED' && !['COLD_ROOM', 'FREEZER', 'LABEL_PRINTER'].includes(e.category)), required: true, onChange: () => upd() }, pos.length ? { key: 'production_order_id', label: 'Orden de producción', type: 'select', options: pos } : null, { key: 'order_ref', label: 'Referencia de la orden', placeholder: 'OP01-0420' }, { key: 'hours', label: 'Horas', type: 'number', min: 0.1, required: true }, { key: 'used_on', label: 'Fecha', type: 'date', required: true }].filter(Boolean),
        onCancel: close, onSubmit: v => { if (!v.production_order_id && !v.order_ref) return 'Indica la orden de producción.'; const u = useInProduction({ equipment_id: v.equipment_id, production_order_id: v.production_order_id || null, order_ref: v.order_ref, hours: v.hours, date: v.used_on }); close(); toast(`${F.num(u.hours, 1)} h registradas: ${F.money(u.cost)} al costo de la orden`, 'ok'); G.refresh(); return true; } });
      function upd() { const e = eq(f.api.values.equipment_id); G.ui.clear(info); if (!e) return; const w = whyNot(e); info.appendChild(notice(w ? `${w.rule}: ${w.msg}` : `${e.code} apto · ${F.money(e.hourly_rate)} por hora · horómetro ${F.num(e.hour_meter, 1)} h`, w ? 'bad' : 'ok')); }
      b.append(f, info); upd();
    }, { code: 'EQU-08' });
  }
  function meterDrawer() {
    drawer('Lectura de horómetro', (b, close) => b.appendChild(form({ id: 'equ08-m', fields: [{ key: 'equipment_id', label: 'Equipo', type: 'select', options: eqOpts(e => (e.hour_meter || 0) > 0), required: true }, { key: 'hours', label: 'Lectura (h)', type: 'number', min: 0, required: true }],
      onCancel: close, onSubmit: v => { const e = meterReading(v.equipment_id, v.hours); const due = G.db.where('maintenance_plans', p => p.equipment_id === e.id && p.frequency_hours && planState(p) !== 'OK'); close(); toast(`Horómetro de ${e.code}: ${F.num(e.hour_meter, 1)} h${due.length ? ' · toca el preventivo «' + due[0].activity + '» (RN-EQU-07)' : ''}`, due.length ? 'warn' : 'ok'); G.refresh(); return true; } })), { code: 'EQU-08' });
  }

  /* ---------- EQU-09 Tablero ---------- */
  function rEQU09(el) {
    const body = page(el, { code: 'EQU-09', title: 'Tablero de equipos', sub: 'Indicadores KPI-EQU-01 a KPI-EQU-04 del mes en curso, por equipo y local.' });
    const k = c => G.kpi(c) || {};
    body.appendChild(kpis([
      { label: 'KPI-EQU-01 · Disponibilidad', value: F.pct(k('KPI-EQU-01').value, 2), sub: `${F.num(k('KPI-EQU-01').numerator, 0)} h fuera de servicio`, onClick: () => G.go('EQU-06') },
      { label: 'KPI-EQU-02 · Balanzas con calibración vigente', value: F.pct(k('KPI-EQU-02').value), sub: `${k('KPI-EQU-02').numerator} de ${k('KPI-EQU-02').denominator} · meta 100 %`, tone: k('KPI-EQU-02').value === 100 ? 'ok' : 'bad', onClick: () => G.go('EQU-04') },
      { label: 'KPI-EQU-03 · Costo de mantenimiento', value: F.money(k('KPI-EQU-03').value), onClick: () => G.go('EQU-06') },
      { label: 'KPI-EQU-04 · Cumplimiento del preventivo', value: F.pct(k('KPI-EQU-04').value), sub: `${k('KPI-EQU-04').numerator ?? 0} de ${k('KPI-EQU-04').denominator ?? 0} a tiempo`, onClick: () => G.go('EQU-05') },
    ]));
    const p = { from: G.date.month(G.TODAY), to: G.TODAY };
    const eqs = G.scope.filter(G.db.where('equipment', e => e.status !== 'RETIRED'));
    const av = eqs.map(e => ({ e, a: availability([e], p) })).filter(x => x.a.down > 0).sort((a, b) => a.a.pct - b.a.pct);
    const g = h('div', { class: 'grid c2' });
    g.appendChild(card('Disponibilidad por equipo (con paradas en el mes)', av.length ? G.ui.chart.hbar({ items: av.map(x => ({ label: x.e.code, value: x.a.pct, tone: x.a.pct < 98 ? 'bad' : 'warn' })), format: v => F.pct(v, 1) }) : G.ui.empty('Sin paradas en el mes.')));
    const costBy = {}; for (const m of G.db.where('maintenance_orders', m => m.status === 'DONE' && (m.finished_at || '').slice(0, 10) >= p.from)) { const e = eq(m.equipment_id); if (!G.scope.ok(e)) continue; const s = G.siteName(e.establishment_id); costBy[s] = (costBy[s] || 0) + m.total_cost; }
    g.appendChild(card('Costo de mantenimiento del mes por local', G.ui.chart.hbar({ items: Object.entries(costBy).map(([l, v]) => ({ label: l, value: R(v) })), format: v => F.money(v) })));
    const last6 = []; for (let i = 5; i >= 0; i--) last6.push(G.date.addMonths(G.TODAY, -i));
    g.appendChild(card('Costo de mantenimiento por mes', G.ui.chart.bar({ labels: last6.map(m => G.date.monthName(m)), series: [{ name: 'Preventivo', values: last6.map(m => R(U.sum(G.db.where('maintenance_orders', o => o.status === 'DONE' && o.kind === 'PREVENTIVE' && G.date.month(o.finished_at || '') === m), o => o.total_cost))) }, { name: 'Correctivo', values: last6.map(m => R(U.sum(G.db.where('maintenance_orders', o => o.status === 'DONE' && o.kind === 'CORRECTIVE' && G.date.month(o.finished_at || '') === m), o => o.total_cost))) }], stacked: true, format: v => F.money(v) })));
    const sc = eqs.filter(e => e.category === 'SCALE');
    g.appendChild(card('Balanzas', table({ id: 'equ09-sc', search: false, columns: [{ key: 'code', label: 'Balanza', mono: true }, { key: 'site', label: 'Local', value: e => G.siteName(e.establishment_id) }, { key: 'vu', label: 'Vigente hasta', value: e => F.date((validCal(e.id) || lastCal(e.id) || {}).valid_until) }, { key: 'u', label: 'Pesa ventas', render: e => scaleUsable(e.id) ? badge('Sí', 'ok') : badge('No (RN-EQU-03)', 'bad') }], rows: sc, onRow: e => G.go('EQU-02', { id: e.id }) }), { flush: true }));
    body.appendChild(g);
  }

  /* ---------- registro ---------- */
  const S = G.SPEC.EQU;
  const nameOf = c => (S.screens.find(s => s[0] === c) || [c, c])[1];
  const RENDER = { 'EQU-01': rEQU01, 'EQU-02': rEQU02, 'EQU-03': rEQU03, 'EQU-04': rEQU04, 'EQU-05': rEQU05, 'EQU-06': rEQU06, 'EQU-07': rEQU07, 'EQU-08': rEQU08, 'EQU-09': rEQU09 };
  G.register({ code: 'EQU', name: 'Equipos y mantenimiento', phase: 2, group: 'Producción y calidad', screens: Object.keys(RENDER).map(code => ({ code, name: nameOf(code), render: RENDER[code] })) });

  /* ---------- indicadores ---------- */
  /** horas fuera de servicio de un conjunto de equipos en el período */
  function availability(eqs, p) {
    const ids = new Set(eqs.map(e => e.id));
    const from = p.from + 'T00:00', to = (p.to >= G.TODAY ? G.date.now().slice(0, 16) : p.to + 'T23:59');
    const span = Math.max(1, hoursBetween(from, to));
    let down = 0;
    for (const m of G.db.where('maintenance_orders', x => ids.has(x.equipment_id) && x.status !== 'VOIDED')) {
      if (m.kind === 'CORRECTIVE') { const a = m.reported_at > from ? m.reported_at : from; const bEnd = m.finished_at || to; const b = bEnd < to ? bEnd : to; if (b > a) down += m.status === 'DONE' && m.downtime_hours != null && m.reported_at >= from && (m.finished_at || '') <= to ? m.downtime_hours : hoursBetween(a, b); }
      else if (m.status === 'DONE' && m.downtime_hours && (m.finished_at || '') >= from && (m.finished_at || '') <= to) down += m.downtime_hours;
    }
    const total = span * eqs.length;
    return { pct: total ? R((total - down) / total * 100, 2) : null, down: R(down, 1), total: R(total, 1) };
  }
  const siteEq = p => G.db.where('equipment', e => e.status !== 'RETIRED' && (!p.site || e.establishment_id === p.site));
  G.kpiCalc['KPI-EQU-01'] = p => { const a = availability(siteEq(p), p); return { value: a.pct, numerator: a.down, denominator: a.total }; };
  G.kpiCalc['KPI-EQU-02'] = p => { const sc = siteEq(p).filter(e => e.category === 'SCALE' && e.status === 'ACTIVE'); const ok = sc.filter(e => validCal(e.id, p.to || G.TODAY)).length; return { value: sc.length ? R(ok / sc.length * 100, 1) : null, numerator: ok, denominator: sc.length }; };
  G.kpiCalc['KPI-EQU-03'] = p => { const ids = new Set(siteEq(p).map(e => e.id)); return R(U.sum(G.db.where('maintenance_orders', m => m.status === 'DONE' && ids.has(m.equipment_id) && (m.finished_at || '').slice(0, 10) >= p.from && (m.finished_at || '').slice(0, 10) <= p.to), m => m.total_cost)); };
  G.kpiCalc['KPI-EQU-04'] = p => { const ids = new Set(siteEq(p).map(e => e.id)); const prev = G.db.where('maintenance_orders', m => m.kind === 'PREVENTIVE' && ids.has(m.equipment_id) && m.status !== 'VOIDED' && ((m.due_on || (m.reported_at || '').slice(0, 10)) >= p.from) && ((m.due_on || (m.reported_at || '').slice(0, 10)) <= p.to)); const onTime = prev.filter(m => m.status === 'DONE' && (m.finished_at || '').slice(0, 10) <= G.date.add(m.due_on || m.reported_at.slice(0, 10), G.param('equ_preventive_overdue_days') ?? 7)).length; return { value: prev.length ? R(onTime / prev.length * 100, 1) : null, numerator: onTime, denominator: prev.length }; };

  /* ---------- alertas, búsqueda y escáner ---------- */
  G.alertProviders.push(() => {
    if (!G.modOn('EQU') || !G.canSee('EQU')) return [];
    const out = [];
    const sc = G.db.where('equipment', e => e.category === 'SCALE' && e.status !== 'RETIRED' && !scaleUsable(e.id));
    if (sc.length) out.push({ module: 'EQU', title: `${sc.length} balanza(s) no aptas para pesar`, detail: sc.map(e => e.code).join(', ') + ' (RN-EQU-03)', tone: 'bad', go: () => G.go('EQU-04') });
    const ad = G.param('equ_calibration_alert_days') ?? 15;
    const exp = G.db.where('equipment', e => e.requires_calibration && e.status !== 'RETIRED').filter(e => { const v = validCal(e.id); return v && G.date.diff(v.valid_until, G.TODAY) <= ad; });
    if (exp.length) out.push({ module: 'EQU', title: `${exp.length} calibración(es) vencen en ${ad} días o menos`, detail: exp.map(e => `${e.code} (${F.date(validCal(e.id).valid_until)})`).join(', ') + ' (RN-EQU-08)', tone: 'warn', go: () => G.go('EQU-04') });
    const oos = G.db.where('equipment', e => e.status === 'OUT_OF_SERVICE');
    if (oos.length) out.push({ module: 'EQU', title: `${oos.length} equipo(s) fuera de servicio`, detail: oos.map(e => e.code).join(', '), tone: 'warn', go: () => G.go('EQU-06') });
    const od = G.db.where('maintenance_plans', p => p.status === 'ACTIVE' && planState(p) === 'OVERDUE');
    if (od.length) out.push({ module: 'EQU', title: `${od.length} preventivo(s) con más de ${G.param('equ_preventive_overdue_days')} días de atraso`, detail: od.map(p => `${eq(p.equipment_id).code}: ${p.activity}`).join(' · ') + ' (RN-EQU-07)', tone: 'warn', go: () => G.go('EQU-05') });
    return out;
  });
  G.searchProviders.push(q => { const s = q.toLowerCase(); return G.db.where('equipment', e => e.code.toLowerCase().includes(s) || e.name.toLowerCase().includes(s)).slice(0, 5).map(e => ({ label: e.code, sub: 'Equipo · ' + e.name, go: () => G.go('EQU-02', { id: e.id }) })).concat(G.db.where('maintenance_orders', m => m.number.toLowerCase() === s).map(m => ({ label: m.number, sub: 'Orden de mantenimiento', go: () => G.go('EQU-06', { id: m.id }) }))); });
  G.scanHandlers.push(code => { const e = findEq(code); if (e) return () => G.go('EQU-02', { id: e.id }); const m = G.db.find('maintenance_orders', x => x.number === code); return m ? () => G.go('EQU-06', { id: m.id }) : null; });

  /* =====================================================================
     Pruebas de aceptación (una por CA-EQU)
     ===================================================================== */
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (!String(e.message).startsWith(code)) throw new Error(`Se esperaba ${code} y salió: ${e.message}`); return e; } throw new Error(`Se esperaba el rechazo ${code} y la operación pasó.`); };
  const byCode = c => G.db.find('equipment', e => e.code === c);
  G.tests.push({ module: 'EQU', name: 'CA-EQU-01: BAL-L1-02 con calibración vencida el 30/09/2026 no se registra el 10/10/2026 como balanza de un lote producido (RN-EQU-03)', fn: async () => {
    const b = byCode('BAL-L1-02'); const last = lastCal(b.id);
    if (!last || last.valid_until !== '2026-09-30') throw new Error('BAL-L1-02 debe vencer el 30/09/2026.');
    const l = G.db.find('lots', x => x.code === 'CH-2026-0412') || G.db.find('lots', x => x.origin === 'PRODUCTION');
    expectFail(() => G.equ.assignScaleToLot(l.id, b.id, '2026-10-10'), 'RN-EQU-03');
    if (G.equ.scaleUsable(b.id, '2026-10-10')) throw new Error('scaleUsable debió dar falso.');
    expectFail(() => G.equ.assertScaleForSale(b.id, '2026-10-10'), 'RN-EQU-03');
  } });
  G.tests.push({ module: 'EQU', name: 'CA-EQU-02: calibración PASS del 10/10/2026 con certificado CC-2026-118 hasta el 09/04/2027 → BAL-L1-02 vuelve a poder usarse', fn: async () => {
    const b = byCode('BAL-L1-02');
    G.equ.recordCalibration({ equipment_id: b.id, calibrated_on: '2026-10-10', valid_until: '2027-04-09', certificate_number: 'CC-2026-118', certificate_url: 'certificados/CC-2026-118.pdf', provider_name: 'Metrología y Balanzas del Perú SAC', max_error_g: 0.5, result: 'PASS', cost: 180 });
    if (!G.equ.scaleUsable(b.id, '2026-10-10')) throw new Error('Debió quedar apta.');
    const l = G.db.find('lots', x => x.code === 'CH-2026-0412') || G.db.find('lots', x => x.origin === 'PRODUCTION');
    G.equ.assignScaleToLot(l.id, b.id, '2026-10-10');
    if (G.db.get('lots', l.id).scale_equipment_id !== b.id) throw new Error('No se registró la balanza en el lote.');
  } });
  G.tests.push({ module: 'EQU', name: 'CA-EQU-03: correctiva de SEL-L1-01 la deja fuera de servicio (RN-EQU-04); al cerrar con S/ 80 + S/ 145 + S/ 0 cuesta S/ 225 y vuelve a ACTIVE', fn: async () => {
    const s = byCode('SEL-L1-01'); if (s.status !== 'ACTIVE') throw new Error('SEL-L1-01 debe empezar activa.');
    const m = G.equ.openOrder({ equipment_id: s.id, kind: 'CORRECTIVE', description: 'Falla de la resistencia de sellado' });
    if (G.db.get('equipment', s.id).status !== 'OUT_OF_SERVICE') throw new Error('Debió quedar OUT_OF_SERVICE.');
    expectFail(() => G.equ.useInProduction({ equipment_id: s.id, order_ref: 'OP01-0420', hours: 1 }), 'RN-EQU-04');
    const r = G.equ.finishOrder(m.id, { labor_cost: 80, parts: [{ description: 'Resistencia de sellado 42 cm', qty: 1, unit_cost: 145 }], external_cost: 0, diagnosis: 'Resistencia quemada' });
    if (r.total_cost !== 225) throw new Error('Costo esperado S/ 225; salió ' + r.total_cost);
    if (r.cost_center_id !== 'cc-PROD-L1') throw new Error('El costo debe ir al centro de costo del Local 1.');
    if (G.db.get('equipment', s.id).status !== 'ACTIVE') throw new Error('Debió volver a ACTIVE.');
  } });
  G.tests.push({ module: 'EQU', name: 'CA-EQU-04: una calibración sin número de certificado se rechaza con RN-EQU-02', fn: async () => {
    const b = byCode('BAL-L2-01'); const n0 = G.db.all('equipment_calibrations').length;
    expectFail(() => G.equ.recordCalibration({ equipment_id: b.id, calibrated_on: '2026-10-10', valid_until: '2027-04-09', certificate_number: '', certificate_url: 'certificados/x.pdf', result: 'PASS' }), 'RN-EQU-02');
    if (G.db.all('equipment_calibrations').length !== n0) throw new Error('No debió guardarse.');
  } });
  G.tests.push({ module: 'EQU', name: 'CA-EQU-05: una balanza registrada sin exigir calibración se rechaza con RN-EQU-01', fn: async () => {
    expectFail(() => G.equ.saveEquipment({ code: 'BAL-L1-09', name: 'Balanza de prueba', category: 'SCALE', establishment_id: 'es-L1', requires_calibration: false, status: 'ACTIVE' }), 'RN-EQU-01');
    if (byCode('BAL-L1-09')) throw new Error('No debió crearse.');
  } });
})();
