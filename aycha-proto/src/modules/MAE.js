/* =====================================================================
   MAE · Maestros comunes (MAE-01 … MAE-10)
   Trabajadores (alta, baja con motivo y vínculo con su usuario), medios de
   pago y sus comisiones por vigencia, tipo de cambio diario (carga SUNAT
   simulada y regla del último publicado), unidades y conversiones,
   catálogos SUNAT, ubigeo y entidades financieras (globales, solo lectura).
   Expone G.mae: fee, addFee, fx, setFx, loadFx, convert, assertDecimals,
   addConversion, sunatValid, assertSunat, assertReference, terminate,
   linkUser, createEmployee, assertActiveEmployee, isBusinessDay.
   ===================================================================== */
(function () {
  const { h, btn, badge, status, page, card, table, kpis, dl, notice, drawer, modal, form, toast, tabs, pills } = G.ui;
  const U = G.util, F = G.fmt, D = G.db;
  const R = (n, d = 2) => U.round(n, d);
  const T = G.date;

  /* ---------- feriados nacionales del Perú 2026 (no hay publicación de TC) ---------- */
  const HOLIDAYS = { '2026-01-01': 'Año Nuevo', '2026-04-02': 'Jueves Santo', '2026-04-03': 'Viernes Santo', '2026-05-01': 'Día del Trabajo', '2026-06-07': 'Batalla de Arica y Día de la Bandera', '2026-06-29': 'San Pedro y San Pablo', '2026-07-23': 'Día de la Fuerza Aérea', '2026-07-28': 'Fiestas Patrias', '2026-07-29': 'Fiestas Patrias', '2026-08-06': 'Batalla de Junín', '2026-08-30': 'Santa Rosa de Lima', '2026-10-08': 'Combate de Angamos', '2026-11-01': 'Todos los Santos', '2026-12-08': 'Inmaculada Concepción', '2026-12-09': 'Batalla de Ayacucho', '2026-12-25': 'Navidad' };
  const dow = d => T.parse(d).getUTCDay();
  const isBusinessDay = d => dow(d) !== 0 && dow(d) !== 6 && !HOLIDAYS[d];
  const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  const DOC_TYPES = [['DNI', 'DNI'], ['CE', 'Carné de extranjería'], ['PASSPORT', 'Pasaporte']];
  const docTypeName = c => (DOC_TYPES.find(x => x[0] === c) || [c, c])[1];
  const PM_SYS = { CASH: 'CASH', YAPE: 'YAPE', PLIN: 'PLIN', CARD: 'POS_VISA', MP: 'MERCADOPAGO', TRANSFER: 'TRANSFER', CREDIT: 'CREDIT' };
  const PAY_CH = [['COUNTER', 'Mostrador'], ['DELIVERY', 'Delivery (contra entrega)'], ['WHATSAPP', 'WhatsApp'], ['TIKTOK', 'TikTok'], ['WEB', 'Web'], ['B2B', 'Empresas (B2B)'], ['CONSIGNMENT', 'Consignación']];
  const payChName = c => (PAY_CH.find(x => x[0] === c) || [c, c])[1];
  const PM_KIND = { CASH: 'Efectivo', WALLET: 'Billetera digital', CARD: 'Tarjeta (POS)', GATEWAY: 'Pasarela de pago', BANK: 'Transferencia bancaria', CREDIT: 'Crédito' };
  const UOM_TYPES = [['UNIT', 'Unidad'], ['WEIGHT', 'Peso'], ['VOLUME', 'Volumen'], ['SERVICE', 'Servicio'], ['PACKAGE', 'Empaque']];
  const uomTypeName = c => (UOM_TYPES.find(x => x[0] === c) || [c, c])[1];
  const FI_KIND = [['BANK', 'Banco'], ['WALLET', 'Billetera'], ['ACQUIRER', 'Adquirente (POS)'], ['GATEWAY', 'Pasarela de pago'], ['CAJA', 'Caja municipal']];
  const fiKindName = c => (FI_KIND.find(x => x[0] === c) || [c, c])[1];
  const TERM_REASONS = ['Renuncia voluntaria', 'Término de contrato', 'Mutuo disenso', 'Despido', 'Abandono de trabajo', 'Fallecimiento', 'Otro'];
  const CATALOG_NAMES = { '01': 'Tipo de documento', '03': 'Unidades de medida', '06': 'Tipo de documento de identidad', '07': 'Tipo de afectación del IGV', '09': 'Tipo de nota de crédito', '10': 'Tipo de nota de débito', '12': 'Documentos relacionados tributarios', '18': 'Modalidad de transporte', '20': 'Motivo de traslado' };

  const audLog = (event, o = {}) => { if (G.aud && G.aud.log) try { G.aud.log(event, o); } catch (e) { } };
  const sel = (options, value, onChange, label) => { const s = h('select', { class: 'input', attrs: { 'aria-label': label || 'Elegir' } }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l))); s.addEventListener('change', () => onChange(s.value)); return s; };
  const userOfEmployee = empId => D.where('users', u => u.employee_id === empId).sort((a, b) => (a.status === 'INACTIVE') - (b.status === 'INACTIVE'))[0] || null;
  const fx3 = v => F.num(v, 3);

  /* =====================================================================
     Dominio
     ===================================================================== */
  const M = G.mae = {
    HOLIDAYS, isBusinessDay,
    /** RN-MAE-01: formato del documento */
    checkDoc(doc_type, doc_number) {
      const n = String(doc_number || '').trim().toUpperCase();
      if (doc_type === 'DNI' && !/^\d{8}$/.test(n)) G.fail('RN-MAE-01', `El DNI tiene 8 dígitos (recibido «${doc_number || ''}»).`);
      if ((doc_type === 'CE' || doc_type === 'PASSPORT') && !/^[A-Z0-9]{6,15}$/.test(n)) G.fail('RN-MAE-01', `El ${docTypeName(doc_type)} tiene de 6 a 15 letras o dígitos, sin espacios (recibido «${doc_number || ''}»).`);
      if (!['DNI', 'CE', 'PASSPORT'].includes(doc_type)) G.fail('RN-MAE-01', 'Tipo de documento no válido: usa DNI, CE o pasaporte.');
      return n;
    },
    /** alta de trabajador (RN-MAE-01 único por tipo y número) */
    createEmployee(v) {
      if (!G.can('mae.employee.manage')) G.fail('RN-MAE-01', `Tu rol (${G.roleName()}) no tiene el permiso mae.employee.manage.`);
      const doc_number = M.checkDoc(v.doc_type, v.doc_number);
      const dup = D.find('employees', e => e.doc_type === v.doc_type && String(e.doc_number).toUpperCase() === doc_number);
      if (dup) G.fail('RN-MAE-01', `Ya existe el trabajador ${dup.full_name} con ${docTypeName(v.doc_type)} ${doc_number}.`);
      if (!String(v.full_name || '').trim()) G.fail('RN-MAE-01', 'Escribe el nombre completo.');
      if (v.phone && !U.phoneOk(v.phone)) G.fail('RN-MAE-01', 'El celular va con código de país, por ejemplo +51987654321.');
      return D.insert('employees', { id: 'em-' + doc_number, doc_type: v.doc_type, doc_number, full_name: v.full_name.trim(), position: v.position, establishment_id: v.establishment_id, cost_center_id: v.cost_center_id || null, hire_date: v.hire_date || G.TODAY, phone: v.phone || null, email: v.email || null, monthly_salary: Number(v.monthly_salary) || null, status: 'ACTIVE', terminated_on: null, termination_reason: null });
    },
    /** RN-MAE-02: un trabajador inactivo no se asigna a rutas, cajas ni tareas nuevas */
    assertActiveEmployee(empId) { const e = D.get('employees', empId); if (!e || e.status !== 'ACTIVE') G.fail('RN-MAE-02', `${e ? e.full_name : 'El trabajador'} está dado de baja${e && e.terminated_on ? ' desde el ' + F.date(e.terminated_on) : ''}: no se le asignan rutas, cajas ni tareas nuevas.`); return e; },
    /** RN-MAE-02: baja con fecha y motivo; desactiva el usuario, cierra sesiones y revoca dispositivos */
    terminate(empId, { date, reason } = {}) {
      if (!G.can('mae.employee.manage')) G.fail('RN-MAE-02', `Tu rol (${G.roleName()}) no tiene el permiso mae.employee.manage para dar de baja.`);
      const e = D.get('employees', empId); if (!e) G.fail('RN-MAE-02', 'Trabajador no encontrado.');
      if (e.status !== 'ACTIVE') G.fail('RN-MAE-02', `${e.full_name} ya está de baja desde el ${F.date(e.terminated_on)}.`);
      if (!reason || String(reason).trim().length < 5) G.fail('RN-MAE-02', 'Indica el motivo del cese.');
      const on = date || G.TODAY;
      if (on < e.hire_date) G.fail('RN-MAE-02', `La fecha de cese (${F.date(on)}) es anterior al ingreso (${F.date(e.hire_date)}).`);
      D.update('employees', e.id, { status: 'INACTIVE', terminated_on: on, termination_reason: reason });
      const out = { users: [], sessions: 0, devices: 0 };
      for (const u of D.where('users', x => x.employee_id === e.id && x.status !== 'INACTIVE')) {
        D.update('users', u.id, { status: 'INACTIVE', deactivated_at: G.date.now(), deactivated_reason: `RN-MAE-02: cese del trabajador (${reason})` });
        out.users.push(u.id);
        for (const s of D.where('user_sessions', s => s.user_id === u.id && !['REVOKED', 'CLOSED', 'EXPIRED'].includes(s.status))) { D.update('user_sessions', s.id, { status: 'REVOKED', revoked_at: G.date.now(), revoked_reason: 'Cese del trabajador (RN-SEG-18)' }, { silent: true }); out.sessions++; audLog('SESSION_REVOKED', { user_id: u.id, user_name: u.name, detail: `Sesión ${s.device || s.id} cerrada por cese del trabajador`, session_id: s.id }); }
        for (const d of D.where('user_devices', d => d.user_id === u.id && d.status !== 'REVOKED')) { D.update('user_devices', d.id, { status: 'REVOKED', revoked_at: G.date.now() }, { silent: true }); out.devices++; }
        if (G.ctx.session && G.ctx.session.user_id === u.id) G.ctx.session = null;
      }
      G.events.emit('employee.terminated', { employee_id: e.id, on, reason, users: out.users });
      return out;
    },
    /** RN-MAE-13: un trabajador tiene a lo más un usuario vigente */
    linkUser(empId, userId) {
      if (!G.can('mae.employee.manage')) G.fail('RN-MAE-13', `Tu rol (${G.roleName()}) no tiene el permiso mae.employee.manage.`);
      const e = M.assertActiveEmployee(empId);
      const u = D.get('users', userId); if (!u) G.fail('RN-MAE-13', 'Usuario no encontrado.');
      const other = D.find('users', x => x.employee_id === e.id && x.id !== u.id && ['ACTIVE', 'LOCKED'].includes(x.status));
      if (other && ['ACTIVE', 'LOCKED'].includes(u.status)) G.fail('RN-MAE-13', `${e.full_name} ya tiene el usuario vigente ${other.email}: desactívalo antes de vincular otro.`);
      if (u.employee_id && u.employee_id !== e.id) { const oe = D.get('employees', u.employee_id); if (oe && oe.status === 'ACTIVE') G.fail('RN-MAE-13', `El usuario ${u.email} ya está vinculado a ${oe.full_name}.`); }
      D.update('users', u.id, { employee_id: e.id });
      return u;
    },
    /* ---------- medios de pago y comisiones ---------- */
    /** RN-MAE-04: número de operación obligatorio según el medio */
    assertReference(pmId, ref) { const pm = D.get('payment_methods', pmId); if (!pm) G.fail('RN-MAE-04', 'Medio de pago no encontrado.'); if (pm.status !== 'ACTIVE') G.fail('RN-MAE-03', `${pm.name} está desactivado.`); if (pm.requires_reference && !String(ref || '').trim()) G.fail('RN-MAE-04', `${pm.name} exige el número de operación.`); return true; },
    feeRow(pmId, date) { return D.find('payment_method_fees', f => f.payment_method_id === pmId && f.status !== 'VOIDED' && f.valid_from <= date && (!f.valid_to || f.valid_to >= date)); },
    /** payment_method_fee: comisión = monto × % + fijo, redondeada (RN-MAE-05) */
    fee(pmId, date, amount) { const f = M.feeRow(pmId, String(date).slice(0, 10)); if (!f) return { fee: 0, pct: 0, fixed: 0, row: null }; const fee = R(Number(amount) * (f.fee_pct || 0) / 100 + (f.fee_fixed || 0)); return { fee, pct: f.fee_pct || 0, fixed: f.fee_fixed || 0, igv_included: f.igv_included, igv: f.igv_included ? 0 : R(fee * G.tax.rate()), row: f }; },
    /** RN-MAE-05: vigencias sin solaparse. closePrevious cierra la vigencia abierta anterior el día previo. */
    addFee(v, { closePrevious } = {}) {
      if (!G.can('mae.payment_method.manage')) G.fail('RN-MAE-05', `Tu rol (${G.roleName()}) no tiene el permiso mae.payment_method.manage.`);
      if (!v.payment_method_id || !v.valid_from) G.fail('RN-MAE-05', 'Indica el medio de pago y la fecha de inicio.');
      if (v.valid_to && v.valid_to < v.valid_from) G.fail('RN-MAE-05', 'La vigencia termina antes de empezar.');
      if (!(Number(v.fee_pct) >= 0) || !(Number(v.fee_fixed || 0) >= 0)) G.fail('RN-MAE-05', 'El porcentaje y el monto fijo no pueden ser negativos.');
      const end = v.valid_to || '9999-12-31';
      let clash = D.where('payment_method_fees', f => f.payment_method_id === v.payment_method_id && f.status !== 'VOIDED' && f.valid_from <= end && (f.valid_to || '9999-12-31') >= v.valid_from);
      if (closePrevious) for (const c of clash.filter(f => !f.valid_to && f.valid_from < v.valid_from)) { D.update('payment_method_fees', c.id, { valid_to: T.add(v.valid_from, -1) }); }
      clash = clash.filter(f => !(closePrevious && !f.valid_to && f.valid_from < v.valid_from));
      if (clash.length) { const c = clash[0]; G.fail('RN-MAE-05', `Se cruza con la comisión de ${F.pct(c.fee_pct, 2)} vigente del ${F.date(c.valid_from)} ${c.valid_to ? 'al ' + F.date(c.valid_to) : 'sin fecha de fin'}: un medio tiene una sola comisión por fecha.`); }
      const row = D.insert('payment_method_fees', { payment_method_id: v.payment_method_id, valid_from: v.valid_from, valid_to: v.valid_to || null, fee_pct: Number(v.fee_pct), fee_fixed: Number(v.fee_fixed || 0), igv_included: v.igv_included !== false && v.igv_included !== 'false', note: v.note || null, status: 'ACTIVE', created_by: G.ctx.userName() });
      G.events.emit('payment_method.fee_changed', { payment_method_id: v.payment_method_id, fee_id: row.id });
      return row;
    },
    /* ---------- tipo de cambio ---------- */
    rateOn(date, currency = 'USD') { return D.find('exchange_rates', x => x.date === date && (x.currency || 'USD') === currency); },
    /** get_exchange_rate (RN-MAE-07): del día o el último publicado dentro de mae_fx_max_fallback_days */
    fx(date = G.TODAY, currency = 'USD') {
      const d0 = String(date).slice(0, 10);
      const own = M.rateOn(d0, currency);
      if (own) return { date: d0, used_date: d0, buy: own.buy, sell: own.sell, fallback: false, days_back: 0, row: own };
      const maxD = G.param('mae_fx_max_fallback_days') ?? 7;
      if (G.param('mae_fx_use_previous_published') !== false) for (let i = 1; i <= maxD; i++) { const d = T.add(d0, -i); const r = M.rateOn(d, currency); if (r) return { date: d0, used_date: d, buy: r.buy, sell: r.sell, fallback: true, days_back: i, row: r }; }
      G.fail('RN-MAE-07', `No hay tipo de cambio ${currency} del ${F.date(d0)} ni publicado en los ${maxD} días anteriores: el documento no se graba. Cárgalo en MAE-05.`);
    },
    /** convierte un monto en moneda extranjera a soles con el TC venta (D-MAE-02) */
    toPen(amount, date, currency = 'USD') { const r = M.fx(date, currency); return { pen: R(Number(amount) * r.sell), rate: r.sell, used_date: r.used_date, fallback: r.fallback }; },
    /** RN-MAE-06 / RN-MAE-08 */
    setFx({ date, currency = 'USD', buy, sell, reason, via = 'MANUAL' }) {
      buy = Number(buy); sell = Number(sell);
      if (!date) G.fail('RN-MAE-06', 'Indica la fecha.');
      if (!(buy > 0) || !(sell > 0)) G.fail('RN-MAE-06', 'La compra y la venta deben ser mayores que cero.');
      if (buy > sell) G.fail('RN-MAE-06', `La compra (${fx3(buy)}) no puede superar a la venta (${fx3(sell)}).`);
      const prev = M.rateOn(date, currency);
      if (prev) {
        if (!G.can('mae.exchange_rate.edit')) G.fail('RN-MAE-08', `Corregir un tipo de cambio exige el permiso mae.exchange_rate.edit (tu rol: ${G.roleName()}).`);
        if (!reason || String(reason).trim().length < 10) G.fail('RN-MAE-08', 'Corregir un tipo de cambio ya cargado exige un motivo de al menos 10 caracteres.');
        if (prev.edit_reason && String(reason).trim() === prev.edit_reason) G.fail('RN-MAE-08', 'Escribe un motivo nuevo para esta corrección.');
        return D.update('exchange_rates', prev.id, { buy, sell, edit_reason: reason.trim(), loaded_via: 'MANUAL', source: 'MANUAL', edited_by: G.ctx.userName(), edited_at: G.date.now() });
      }
      if (via === 'MANUAL' && !G.can('mae.exchange_rate.edit')) G.fail('RN-MAE-08', `Registrar el tipo de cambio exige el permiso mae.exchange_rate.edit (tu rol: ${G.roleName()}).`);
      const row = D.insert('exchange_rates', { id: currency === 'USD' ? 'fx-' + date : 'fx-' + currency + '-' + date, date, currency, buy, sell, source: via === 'SUNAT' ? 'SUNAT' : via, loaded_via: via, published_on: date, edit_reason: null, loaded_by: G.ctx.userName() });
      G.events.emit('exchange_rate.loaded', { date, currency, buy, sell, via });
      return row;
    },
    /** carga desde el conector FX (SUNAT simulada). Sábado, domingo y feriado: SUNAT no publica. */
    loadFx(date = G.TODAY, { via = 'SUNAT' } = {}) {
      const conn = D.find('integration_connectors', c => c.code === 'FX-SUNAT');
      if (conn && conn.simulate_down) { if (G.int && G.int.connectorReport) G.int.connectorReport(conn.id, false, 'Tiempo de espera agotado al consultar SUNAT'); G.fail('RN-MAE-14', 'El servicio de tipo de cambio no respondió. Tras tres fallos se avisa a administración para cargarlo a mano.'); }
      if (!isBusinessDay(date)) return { published: false, msg: `SUNAT no publica el ${DOW[dow(date)].toLowerCase()} ${F.date(date)}${HOLIDAYS[date] ? ' (feriado: ' + HOLIDAYS[date] + ')' : ''}: se usa el último publicado (RN-MAE-07).` };
      if (M.rateOn(date)) return { published: true, already: true, msg: `El tipo de cambio del ${F.date(date)} ya estaba cargado.`, row: M.rateOn(date) };
      const prev = M.fx(T.add(date, -1)).row || { sell: 3.39 };
      const r = U.rng(Number(date.replace(/-/g, '')));
      const sell = R(prev.sell + (r() - 0.5) * 0.012, 3), buy = R(sell - 0.008 - r() * 0.004, 3);
      const row = M.setFx({ date, buy, sell, via });
      if (conn && G.int && G.int.connectorReport) G.int.connectorReport(conn.id, true);
      return { published: true, row, msg: `Tipo de cambio del ${F.date(date)} cargado: compra ${fx3(buy)} · venta ${fx3(sell)}.` };
    },
    /* ---------- unidades ---------- */
    uom(code) { return D.find('units_of_measure', u => u.code === code); },
    /** assert_qty_decimals (RN-MAE-10) */
    assertDecimals(qty, code) {
      const u = M.uom(code); if (!u) G.fail('RN-MAE-10', `Unidad ${code} no registrada.`);
      const d = u.decimals ?? 0; const f = Math.pow(10, d); const q = Number(qty);
      if (Math.abs(q * f - Math.round(q * f)) > 1e-7) G.fail('RN-MAE-10', `${u.name} (${u.code}) admite ${d === 0 ? 'solo cantidades enteras' : d + ' decimales'}: ${String(qty).replace('.', ',')} no es válido.`);
      return true;
    },
    /** convert_qty (RN-MAE-09): conversión directa o inversa (1 / factor) */
    convert(qty, from, to) {
      if (from === to) return Number(qty);
      M.assertDecimals(qty, from);
      const dir = D.find('unit_conversions', c => c.from_uom === from && c.to_uom === to && c.status !== 'INACTIVE');
      if (dir) return R(Number(qty) * dir.factor, 6);
      const inv = D.find('unit_conversions', c => c.from_uom === to && c.to_uom === from && c.status !== 'INACTIVE');
      if (inv) return R(Number(qty) / inv.factor, 6);
      G.fail('RN-MAE-09', `No hay conversión definida entre ${from} y ${to}: la operación se rechaza.`);
    },
    addConversion({ from_uom, to_uom, factor, note }) {
      if (!G.can('mae.unit.manage')) G.fail('RN-MAE-09', `Tu rol (${G.roleName()}) no tiene el permiso mae.unit.manage.`);
      factor = Number(factor);
      if (!from_uom || !to_uom || from_uom === to_uom) G.fail('RN-MAE-09', 'Elige dos unidades distintas.');
      if (!(factor > 0)) G.fail('RN-MAE-09', 'El factor debe ser mayor que cero.');
      const dup = D.find('unit_conversions', c => (c.from_uom === from_uom && c.to_uom === to_uom) || (c.from_uom === to_uom && c.to_uom === from_uom));
      if (dup) G.fail('RN-MAE-09', `Ya existe la conversión 1 ${dup.from_uom} = ${F.num(dup.factor, 4)} ${dup.to_uom}; la inversa se calcula y no se registra aparte.`);
      return D.insert('unit_conversions', { from_uom, to_uom, factor, note: note || null, status: 'ACTIVE' });
    },
    /* ---------- catálogos globales ---------- */
    sunatItem(catalog, code) { return D.find('sunat_catalog_items', x => x.catalog === catalog && x.code === code); },
    /** sunat_code_valid (RN-MAE-12) */
    sunatValid(catalog, code, date = G.TODAY) { const x = M.sunatItem(catalog, code); return !!x && x.valid_from <= date && (!x.valid_to || x.valid_to >= date); },
    assertSunat(catalog, code, date = G.TODAY) { if (!M.sunatValid(catalog, code, date)) { const x = M.sunatItem(catalog, code); G.fail('RN-MAE-12', x ? `El código ${code} del catálogo ${catalog} (${x.description}) no está vigente el ${F.date(date)} (vigencia ${F.date(x.valid_from)} – ${x.valid_to ? F.date(x.valid_to) : 'sin fin'}).` : `El código ${code} no existe en el catálogo ${catalog}.`); } return true; },
    /** RN-MAE-11: catálogos, ubigeo y entidades son globales y de solo lectura para la aplicación */
    assertGlobalWrite(table) { if (!G.can('mae.catalog.import')) G.fail('RN-MAE-11', `${table === 'ubigeo' ? 'El ubigeo' : table === 'financial_institutions' ? 'Las entidades financieras' : 'Los catálogos SUNAT'} son globales y de solo lectura: solo el operador de la plataforma los actualiza por importación (mae.catalog.import).`); },
    updateGlobal(table, id, patch) { M.assertGlobalWrite(table); const r = D.raw(table).find(x => x.id === id); if (!r) G.fail('RN-MAE-11', 'Registro no encontrado.'); Object.assign(r, patch); D.touch(); return r; },
    /** importación del operador: filas [{…}] con upsert por clave */
    importGlobal(table, rows, keyFn) {
      M.assertGlobalWrite(table);
      let ins = 0, upd = 0; const all = D.raw(table); const idx = new Map(all.map(r => [keyFn(r), r]));
      for (const r of rows) { const k = keyFn(r); const ex = idx.get(k); if (ex) { Object.assign(ex, r); upd++; } else { const n = Object.assign({ id: table.slice(0, 3) + '-' + k.replace(/[^A-Za-z0-9]/g, '') }, r); D.insert(table, n, { silent: true, global: true }); idx.set(k, n); ins++; } }
      D.touch(); G.audit('IMPORTAR', table, '-', `Importación global: ${ins} nuevas, ${upd} actualizadas`);
      return { inserted: ins, updated: upd };
    },
  };

  /* =====================================================================
     Semilla (orden 13)
     ===================================================================== */
  G.seed(13, function seedMAE() {
    const ins = (t, r) => D.insert(t, r, { silent: true });
    const glob = (t, r) => D.insert(t, r, { silent: true, global: true });
    const r = U.rng(130013);
    /* ----- trabajadores: correo, centro de costo ----- */
    const CC_BY_ROLE = { GERENTE: 'ADM', ADMIN_SISTEMA: 'ADM', ADMINISTRACION: 'ADM', SUPERVISORA_VENTAS: 'VEN-DG', CAJERO: 'VEN-MOS', PREPARADOR: 'ALM-L1', COORDINADOR_DELIVERY: 'DEL', REPARTIDOR: 'DEL', MARKETING: 'MKT-DG', JEFE_PRODUCCION: 'PROD-L2', CALIDAD: 'CAL', COMPRAS: 'ADM', CONTADORA: 'FIN', PRACTICANTE_CONTABLE: 'FIN', VISITADOR_CONSIGNACION: 'VEN-DG', RRHH: 'RRHH', AUDITOR: 'ADM' };
    for (const e of D.all('employees')) {
      const u = D.find('users', x => x.employee_id === e.id);
      let cc = u ? CC_BY_ROLE[u.role] : null;
      if (u && u.role === 'VENDEDORA') cc = 'VEN-' + (u.brands[0] || 'br-DG').slice(3);
      if (u && u.role === 'ALMACENERO') cc = e.establishment_id === 'es-L2' ? 'ALM-L2' : 'ALM-L1';
      if (u && u.role === 'OPERARIO_PRODUCCION') cc = e.establishment_id === 'es-L2' ? 'PROD-L2' : 'PROD-L1';
      if (!u) cc = /almac/i.test(e.position) ? 'ALM-L1' : e.establishment_id === 'es-L2' ? 'PROD-L2' : 'PROD-L1';
      Object.assign(e, { email: u ? u.email : null, cost_center_id: 'cc-' + cc, terminated_on: null, termination_reason: null });
    }
    // trabajadora extranjera (CE), dos ceses con usuario desactivado y una vendedora de campaña sin ingresos recientes
    ins('employees', { id: 'em-CE001284567', doc_type: 'CE', doc_number: '001284567', full_name: 'Yorgelis Méndez Paz', position: 'Operaria de empaque', establishment_id: 'es-L2', cost_center_id: 'cc-PROD-L2', hire_date: '2025-11-03', phone: '+51912334455', email: null, monthly_salary: 1250, status: 'ACTIVE', terminated_on: null, termination_reason: null });
    ins('employees', { id: 'em-46281937', doc_type: 'DNI', doc_number: '46281937', full_name: 'Ronald Mena Cáceres', position: 'Repartidor (moto)', establishment_id: 'es-L1', cost_center_id: 'cc-DEL', hire_date: '2024-05-06', phone: '+51945118822', email: 'rmena@donguando.pe', monthly_salary: 1400, status: 'INACTIVE', terminated_on: '2026-08-31', termination_reason: 'Renuncia voluntaria' });
    ins('users', { id: 'us-rmena', employee_id: 'em-46281937', name: 'Ronald Mena Cáceres', email: 'rmena@donguando.pe', role: 'REPARTIDOR', brands: [], sites: ['es-L1'], status: 'INACTIVE', twofa_enabled: false, last_login: '2026-08-31T19:40', deactivated_at: '2026-08-31T20:05', deactivated_reason: 'RN-MAE-02: cese del trabajador (Renuncia voluntaria)' });
    ins('employees', { id: 'em-47719320', doc_type: 'DNI', doc_number: '47719320', full_name: 'Milagros Ccopa Huillca', position: 'Preparadora (temporal)', establishment_id: 'es-L1', cost_center_id: 'cc-ALM-L1', hire_date: '2026-06-01', phone: '+51976551200', email: null, monthly_salary: 1130, status: 'INACTIVE', terminated_on: '2026-09-30', termination_reason: 'Término de contrato' });
    ins('employees', { id: 'em-48820155', doc_type: 'DNI', doc_number: '48820155', full_name: 'Fiorella Campos Ruiz', position: 'Vendedora de campaña', establishment_id: 'es-L1', cost_center_id: 'cc-VEN-M4', hire_date: '2026-05-04', phone: '+51981220455', email: 'fcampos@donguando.pe', monthly_salary: 1500, status: 'ACTIVE', terminated_on: null, termination_reason: null });
    ins('users', { id: 'us-fcampos', employee_id: 'em-48820155', name: 'Fiorella Campos Ruiz', email: 'fcampos@donguando.pe', role: 'VENDEDORA', brands: ['br-M4'], sites: [], status: 'ACTIVE', twofa_enabled: false, last_login: T.add(G.TODAY, -90) + 'T10:12' });
    /* ----- medios de pago (RN-MAE-03) ----- */
    const PMX = { CASH: [null, null, 0, ['COUNTER', 'DELIVERY', 'WHATSAPP', 'TIKTOK', 'CONSIGNMENT']], YAPE: ['YAPE', null, 0, ['COUNTER', 'DELIVERY', 'WHATSAPP', 'TIKTOK', 'B2B', 'CONSIGNMENT']], PLIN: ['PLIN', null, 0, ['COUNTER', 'DELIVERY', 'WHATSAPP', 'TIKTOK']], CARD: [null, null, 2, ['COUNTER', 'DELIVERY']], MP: ['MERCADOPAGO', 'MP-DG', 14, ['WEB']], TRANSFER: ['BCP', null, 0, ['WHATSAPP', 'B2B', 'WEB']], CREDIT: [null, null, 0, ['B2B', 'CONSIGNMENT']] };
    let i = 0;
    for (const pm of D.all('payment_methods')) { const [inst, conn, days, chans] = PMX[pm.code] || [null, null, 0, []]; Object.assign(pm, { system_code: PM_SYS[pm.code] || pm.code, is_system: true, institution_code: inst, connector_code: conn, connector_id: null, settlement_days: days, allowed_channels: chans, sort_order: ++i }); }
    /* ----- comisiones por vigencia (D-MAE-01 y D-MAE-03: tasas de ejemplo) ----- */
    ins('payment_method_fees', { id: 'pmf-MP-1', payment_method_id: 'pm-MP', valid_from: '2026-01-01', valid_to: '2026-09-30', fee_pct: 4.19, fee_fixed: 0, igv_included: true, note: 'Tasa estándar de Mercado Pago (ejemplo)', status: 'ACTIVE', created_by: 'Carmen Huamán Soto' });
    ins('payment_method_fees', { id: 'pmf-MP-2', payment_method_id: 'pm-MP', valid_from: '2026-10-01', valid_to: '2026-10-31', fee_pct: 3.99, fee_fixed: 0, igv_included: true, note: 'Tasa de prueba 3,99 % (D-MAE-03: confirmar contrato de donguando.com)', status: 'ACTIVE', created_by: 'Carmen Huamán Soto' });
    ins('payment_method_fees', { id: 'pmf-MP-3', payment_method_id: 'pm-MP', valid_from: '2026-11-01', valid_to: null, fee_pct: 3.49, fee_fixed: 0, igv_included: true, note: 'Tarifa negociada por volumen (ejemplo)', status: 'ACTIVE', created_by: 'Carmen Huamán Soto' });
    ins('payment_method_fees', { id: 'pmf-YAPE-1', payment_method_id: 'pm-YAPE', valid_from: '2026-01-01', valid_to: null, fee_pct: 0, fee_fixed: 0, igv_included: true, note: 'Yape a cuenta de empresa sin comisión (D-MAE-04)', status: 'ACTIVE', created_by: 'Carmen Huamán Soto' });
    ins('payment_method_fees', { id: 'pmf-PLIN-1', payment_method_id: 'pm-PLIN', valid_from: '2026-01-01', valid_to: null, fee_pct: 0, fee_fixed: 0, igv_included: true, note: 'Plin a cuenta de empresa', status: 'ACTIVE', created_by: 'Carmen Huamán Soto' });
    ins('payment_method_fees', { id: 'pmf-TRF-1', payment_method_id: 'pm-TRANSFER', valid_from: '2026-01-01', valid_to: null, fee_pct: 0, fee_fixed: 0, igv_included: true, note: 'Transferencias del mismo banco sin costo', status: 'ACTIVE', created_by: 'Carmen Huamán Soto' });
    /* ----- tipo de cambio: días hábiles desde agosto; 08/10 feriado; 06/10 sin carga (RN-MAE-14) ----- */
    D.t.exchange_rates = (D.t.exchange_rates || []).filter(x => x.tenant && x.tenant !== 'DG');
    const days = []; for (let d = '2026-08-03'; d <= '2026-10-09'; d = T.add(d, 1)) if (isBusinessDay(d) && d !== '2026-10-06') days.push(d);
    const walk = [0]; for (let k = 1; k < days.length; k++) walk.push(walk[k - 1] + (r() - 0.5) * 0.014);
    days.forEach((d, k) => {
      const sell = R(3.390 + walk[k] - walk[days.length - 1], 3); const buy = d === '2026-10-09' ? 3.380 : R(sell - 0.008 - Math.round(r() * 4) / 1000, 3);
      const via = d < '2026-09-01' ? 'IMPORT' : (d === '2026-09-22' || d === '2026-10-02') ? 'MANUAL' : 'SUNAT';
      ins('exchange_rates', { id: 'fx-' + d, date: d, currency: 'USD', buy, sell: d === '2026-10-09' ? 3.390 : sell, source: via, loaded_via: via, published_on: d, edit_reason: d === '2026-09-15' ? 'SUNAT publicó una corrección del tipo de cambio venta a las 11:20' : null, loaded_by: via === 'SUNAT' ? 'Conector FX (09:00)' : via === 'IMPORT' ? 'Carga inicial desde archivo' : 'Carmen Huamán Soto', edited_by: d === '2026-09-15' ? 'CPC Marisol Cárdenas' : null });
    });
    /* ----- unidades y conversiones ----- */
    const UX = { NIU: ['UNIT', 0], KGM: ['WEIGHT', 3], GRM: ['WEIGHT', 0], LTR: ['VOLUME', 3], MLT: ['VOLUME', 0], BX: ['PACKAGE', 0], PK: ['PACKAGE', 0] };
    for (const u of D.all('units_of_measure')) Object.assign(u, { uom_type: (UX[u.code] || ['UNIT'])[0], decimals: (UX[u.code] || [0, 0])[1], is_system: true, status: 'ACTIVE' });
    ins('units_of_measure', { id: 'um-ZZ', code: 'ZZ', name: 'Unidad (servicios)', kind: 'SERVICE', sunat_code: 'ZZ', uom_type: 'SERVICE', decimals: 0, is_system: true, status: 'ACTIVE' });
    ins('units_of_measure', { id: 'um-BG', code: 'BG', name: 'Bolsa', kind: 'UNIT', sunat_code: 'BG', uom_type: 'PACKAGE', decimals: 0, is_system: false, status: 'ACTIVE' });
    ins('unit_conversions', { id: 'uc-KGM-GRM', from_uom: 'KGM', to_uom: 'GRM', factor: 1000, note: '1 kg = 1000 g', status: 'ACTIVE' });
    ins('unit_conversions', { id: 'uc-LTR-MLT', from_uom: 'LTR', to_uom: 'MLT', factor: 1000, note: '1 L = 1000 ml', status: 'ACTIVE' });
    ins('unit_conversions', { id: 'uc-BX-NIU', from_uom: 'BX', to_uom: 'NIU', factor: 12, note: 'Caja de caldo de 1 L (12 unidades)', status: 'ACTIVE' });
    ins('unit_conversions', { id: 'uc-PK-NIU', from_uom: 'PK', to_uom: 'NIU', factor: 6, note: 'Paquete de chorizos (6 unidades)', status: 'ACTIVE' });
    /* ----- catálogos SUNAT (globales) ----- */
    const CAT = {
      '01': [['01', 'Factura'], ['03', 'Boleta de venta'], ['07', 'Nota de crédito'], ['08', 'Nota de débito'], ['09', 'Guía de remisión remitente'], ['12', 'Ticket de máquina registradora'], ['20', 'Comprobante de retención'], ['31', 'Guía de remisión transportista'], ['40', 'Comprobante de percepción']],
      '03': [['NIU', 'Unidad (bienes)'], ['ZZ', 'Unidad (servicios)'], ['KGM', 'Kilogramo'], ['GRM', 'Gramo'], ['LTR', 'Litro'], ['MLT', 'Mililitro'], ['BX', 'Caja'], ['PK', 'Paquete'], ['BG', 'Bolsa'], ['TNE', 'Tonelada']],
      '06': [['0', 'Doc. tributario no domiciliado sin RUC'], ['1', 'Documento Nacional de Identidad (DNI)'], ['4', 'Carné de extranjería'], ['6', 'Registro Único de Contribuyentes (RUC)'], ['7', 'Pasaporte'], ['A', 'Cédula diplomática de identidad'], ['B', 'Doc. de identidad del país de residencia (no domiciliado)'], ['C', 'Tax Identification Number (TIN)'], ['D', 'Identification Number (IN)'], ['E', 'Tarjeta Andina de Migración (TAM)'], ['F', 'Permiso Temporal de Permanencia (PTP)'], ['G', 'Salvoconducto']],
      '07': [['10', 'Gravado – Operación onerosa'], ['11', 'Gravado – Retiro por premio'], ['12', 'Gravado – Retiro por donación'], ['13', 'Gravado – Retiro'], ['14', 'Gravado – Retiro por publicidad'], ['15', 'Gravado – Bonificaciones'], ['16', 'Gravado – Retiro por entrega a trabajadores'], ['17', 'Gravado – IVAP'], ['20', 'Exonerado – Operación onerosa'], ['21', 'Exonerado – Transferencia gratuita'], ['30', 'Inafecto – Operación onerosa'], ['31', 'Inafecto – Retiro por bonificación'], ['32', 'Inafecto – Retiro'], ['33', 'Inafecto – Retiro por muestras médicas'], ['34', 'Inafecto – Retiro por convenio colectivo'], ['35', 'Inafecto – Retiro por premio'], ['36', 'Inafecto – Retiro por publicidad'], ['37', 'Inafecto – Transferencia gratuita'], ['40', 'Exportación de bienes o servicios']],
      '09': [['01', 'Anulación de la operación'], ['02', 'Anulación por error en el RUC'], ['03', 'Corrección por error en la descripción'], ['04', 'Descuento global'], ['05', 'Descuento por ítem'], ['06', 'Devolución total'], ['07', 'Devolución por ítem'], ['08', 'Bonificación'], ['09', 'Disminución en el valor'], ['10', 'Otros conceptos'], ['11', 'Ajustes de operaciones de exportación'], ['12', 'Ajustes afectos al IVAP'], ['13', 'Corrección del monto neto pendiente de pago o de las fechas de vencimiento']],
      '10': [['01', 'Intereses por mora'], ['02', 'Aumento en el valor'], ['03', 'Penalidades u otros conceptos'], ['11', 'Ajustes de operaciones de exportación'], ['12', 'Ajustes afectos al IVAP']],
      '12': [['01', 'Factura – emitida para corregir error en el RUC'], ['02', 'Factura – emitida por anticipos'], ['03', 'Boleta de venta – emitida por anticipos'], ['04', 'Ticket de salida – ENAPU'], ['05', 'Código SCOP'], ['99', 'Otros']],
      '18': [['01', 'Transporte público'], ['02', 'Transporte privado']],
      '20': [['01', 'Venta'], ['02', 'Compra'], ['03', 'Venta con entrega a terceros'], ['04', 'Traslado entre establecimientos de la misma empresa'], ['05', 'Consignación'], ['06', 'Devolución'], ['07', 'Recojo de bienes transformados'], ['08', 'Importación'], ['09', 'Exportación'], ['13', 'Otros'], ['14', 'Venta sujeta a confirmación del comprador'], ['17', 'Traslado de bienes para transformación'], ['18', 'Traslado emisor itinerante de comprobantes de pago'], ['19', 'Traslado a zona primaria']],
    };
    const NEW_GRE = ['03', '05', '06', '07', '17'];
    for (const [cat, items] of Object.entries(CAT)) for (const [code, desc] of items) glob('sunat_catalog_items', { id: `sc-${cat}-${code}`, catalog: cat, catalog_name: CATALOG_NAMES[cat], code, description: desc, valid_from: cat === '20' && NEW_GRE.includes(code) ? '2022-07-01' : cat === '06' && code === 'F' ? '2017-02-01' : '2016-01-01', valid_to: cat === '20' && code === '19' ? '2022-06-30' : null, status: 'ACTIVE' });
    /* ----- ubigeo INEI: Lima Metropolitana (43), Callao (7) y Arequipa provincia (29) ----- */
    const DEPS = ['Amazonas', 'Áncash', 'Apurímac', 'Arequipa', 'Ayacucho', 'Cajamarca', 'Callao', 'Cusco', 'Huancavelica', 'Huánuco', 'Ica', 'Junín', 'La Libertad', 'Lambayeque', 'Lima', 'Loreto', 'Madre de Dios', 'Moquegua', 'Pasco', 'Piura', 'Puno', 'San Martín', 'Tacna', 'Tumbes', 'Ucayali'];
    DEPS.forEach((n, k) => glob('ubigeo', { id: 'ub-' + U.pad(k + 1, 2), code: U.pad(k + 1, 2), level: 'DEPARTMENT', department: n, province: null, district: null }));
    const PROVS = { '15': ['Lima', 'Barranca', 'Cajatambo', 'Canta', 'Cañete', 'Huaral', 'Huarochirí', 'Huaura', 'Oyón', 'Yauyos'], '07': ['Callao'], '04': ['Arequipa', 'Camaná', 'Caravelí', 'Castilla', 'Caylloma', 'Condesuyos', 'Islay', 'La Unión'] };
    for (const [dep, ps] of Object.entries(PROVS)) ps.forEach((n, k) => glob('ubigeo', { id: 'ub-' + dep + U.pad(k + 1, 2), code: dep + U.pad(k + 1, 2), level: 'PROVINCE', department: DEPS[Number(dep) - 1], province: n, district: null }));
    const DIST = {
      '1501': ['Lima', 'Ancón', 'Ate', 'Barranco', 'Breña', 'Carabayllo', 'Chaclacayo', 'Chorrillos', 'Cieneguilla', 'Comas', 'El Agustino', 'Independencia', 'Jesús María', 'La Molina', 'La Victoria', 'Lince', 'Los Olivos', 'Lurigancho', 'Lurín', 'Magdalena del Mar', 'Pueblo Libre', 'Miraflores', 'Pachacámac', 'Pucusana', 'Puente Piedra', 'Punta Hermosa', 'Punta Negra', 'Rímac', 'San Bartolo', 'San Borja', 'San Isidro', 'San Juan de Lurigancho', 'San Juan de Miraflores', 'San Luis', 'San Martín de Porres', 'San Miguel', 'Santa Anita', 'Santa María del Mar', 'Santa Rosa', 'Santiago de Surco', 'Surquillo', 'Villa El Salvador', 'Villa María del Triunfo'],
      '0701': ['Callao', 'Bellavista', 'Carmen de la Legua Reynoso', 'La Perla', 'La Punta', 'Ventanilla', 'Mi Perú'],
      '0401': ['Arequipa', 'Alto Selva Alegre', 'Cayma', 'Cerro Colorado', 'Characato', 'Chiguata', 'Jacobo Hunter', 'La Joya', 'Mariano Melgar', 'Miraflores', 'Mollebaya', 'Paucarpata', 'Pocsi', 'Polobaya', 'Quequeña', 'Sabandía', 'Sachaca', 'San Juan de Siguas', 'San Juan de Tarucani', 'Santa Isabel de Siguas', 'Santa Rita de Siguas', 'Socabaya', 'Tiabaya', 'Uchumayo', 'Vitor', 'Yanahuara', 'Yarabamba', 'Yura', 'José Luis Bustamante y Rivero'],
    };
    for (const [prov, ds] of Object.entries(DIST)) ds.forEach((n, k) => glob('ubigeo', { id: 'ub-' + prov + U.pad(k + 1, 2), code: prov + U.pad(k + 1, 2), level: 'DISTRICT', department: DEPS[Number(prov.slice(0, 2)) - 1], province: PROVS[prov.slice(0, 2)][Number(prov.slice(2)) - 1], district: n }));
    /* ----- entidades financieras (globales) ----- */
    [['BCP', 'Banco de Crédito del Perú', 'BANK', '20100047218', '002'], ['IBK', 'Interbank', 'BANK', '20100053455', '003'], ['BBVA', 'BBVA Perú', 'BANK', '20100130204', '011'], ['SCOTIA', 'Scotiabank Perú', 'BANK', '20100043140', '009'], ['BN', 'Banco de la Nación', 'BANK', '20100030595', '018'], ['BANBIF', 'BanBif', 'BANK', '20101036813', '038'], ['YAPE', 'Yape (BCP)', 'WALLET', null, null], ['PLIN', 'Plin (Interbank, BBVA, Scotiabank y otros)', 'WALLET', null, null], ['NIUBIZ', 'Niubiz', 'ACQUIRER', null, null], ['IZIPAY', 'Izipay', 'ACQUIRER', null, null], ['MERCADOPAGO', 'Mercado Pago', 'GATEWAY', null, null], ['CULQI', 'Culqi', 'GATEWAY', null, null], ['CMAC-AQP', 'Caja Arequipa', 'CAJA', null, '803'], ['CMAC-HYO', 'Caja Huancayo', 'CAJA', null, '808']]
      .forEach(([code, name, kind, ruc, cci], k) => glob('financial_institutions', { id: 'fi-' + code, code, name, kind, ruc: ruc && U.rucOk(ruc) ? ruc : null, cci_code: cci, status: 'ACTIVE', sort_order: k + 1 }));
  }, 'MAE maestros');

  /* =====================================================================
     Pantallas
     ===================================================================== */
  const canEmp = () => G.can('mae.employee.manage') && G.canDo('MAE', 'E');
  const wrapErr = fn => { try { return fn(); } catch (e) { toast(e.message, 'bad'); return false; } };

  /* ---------- MAE-01 Trabajadores ---------- */
  function renderEmployees(el) {
    const body = page(el, { code: 'MAE-01', title: 'Trabajadores', sub: 'Personal de Don Guando con su documento, cargo, local, centro de costo y usuario vinculado. La baja desactiva el usuario.', actions: [canEmp() ? { label: 'Importar CSV', onClick: () => G.go('MAE-10') } : null, canEmp() ? { label: 'Nuevo trabajador', kind: 'primary', icon: '+', onClick: () => G.go('MAE-02', { nuevo: 1 }) } : null].filter(Boolean) });
    const rows = G.scope.filter(D.all('employees'), { brand: '_', site: 'establishment_id' });
    const users = D.all('users'); const byEmp = U.groupBy(users.filter(u => u.employee_id), 'employee_id');
    const act = rows.filter(e => e.status === 'ACTIVE');
    body.appendChild(kpis([
      { label: 'Trabajadores activos', value: F.num(act.length), sub: `${rows.length - act.length} de baja` },
      { label: 'Con usuario vigente', value: F.num(act.filter(e => (byEmp[e.id] || []).some(u => u.status !== 'INACTIVE')).length), sub: 'acceden al sistema' },
      { label: 'Sin usuario', value: F.num(act.filter(e => !(byEmp[e.id] || []).some(u => u.status !== 'INACTIVE')).length), sub: 'operarios y apoyo' },
      { label: 'Ceses este año', value: F.num(rows.filter(e => e.terminated_on && e.terminated_on >= '2026-01-01').length), tone: 'warn' },
    ]));
    const positions = [...new Set(rows.map(e => e.position))].sort();
    body.appendChild(table({
      id: 'mae01', rows, onRow: e => G.go('MAE-02', { id: e.id }),
      columns: [
        { key: 'doc_number', label: 'Documento', mono: true, value: e => `${e.doc_type} ${e.doc_number}` },
        { key: 'full_name', label: 'Nombre' },
        { key: 'position', label: 'Cargo' },
        { key: 'establishment_id', label: 'Local', value: e => G.siteName(e.establishment_id) },
        { key: 'cost_center_id', label: 'Centro de costo', value: e => (D.get('cost_centers', e.cost_center_id) || {}).code || '—' },
        { key: 'user', label: 'Usuario', value: e => { const u = (byEmp[e.id] || [])[0]; return u ? u.email : ''; }, render: e => { const u = (byEmp[e.id] || []).sort((a, b) => (a.status === 'INACTIVE') - (b.status === 'INACTIVE'))[0]; return u ? h('span', { class: 'row', style: 'gap:6px' }, h('span', { class: 'small' }, u.email), status(u.status)) : h('span', { class: 'muted small' }, 'Sin usuario'); } },
        { key: 'hire_date', label: 'Ingreso', render: e => F.date(e.hire_date) },
        { key: 'status', label: 'Estado', render: e => e.status === 'ACTIVE' ? status('ACTIVE') : badge('Cesado ' + F.date(e.terminated_on), 'bad') },
      ],
      filters: [
        { key: 'establishment_id', label: 'Local', options: D.all('establishments').map(x => [x.id, x.short]) },
        { key: 'position', label: 'Cargo', options: positions.map(p => [p, p]) },
        { key: 'status', label: 'Estado', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'De baja']] },
      ],
    }));
  }

  /* ---------- MAE-02 Ficha del trabajador ---------- */
  const empFields = (isNew) => [
    { key: 'doc_type', label: 'Tipo de documento', type: 'select', options: DOC_TYPES, required: true, disabled: !isNew },
    { key: 'doc_number', label: 'Número de documento', required: true, disabled: !isNew, help: 'DNI: 8 dígitos. CE o pasaporte: 6 a 15 letras o dígitos (RN-MAE-01).' },
    { key: 'full_name', label: 'Nombre completo', required: true, span: 2 },
    { key: 'position', label: 'Cargo', required: true },
    { key: 'establishment_id', label: 'Local', type: 'select', options: D.all('establishments').map(x => [x.id, x.name]), required: true },
    { key: 'cost_center_id', label: 'Centro de costo', type: 'select', options: D.all('cost_centers').map(c => [c.id, `${c.code} · ${c.name}`]), required: true },
    { key: 'hire_date', label: 'Fecha de ingreso', type: 'date', required: true },
    { key: 'phone', label: 'Celular', placeholder: '+51987654321' },
    { key: 'email', label: 'Correo' },
  ];
  function renderEmployee(el, p = {}) {
    const e = p.id ? D.get('employees', p.id) : null;
    if (!e) {
      const body = page(el, { code: 'MAE-02', title: 'Ficha del trabajador', sub: 'Alta de un trabajador nuevo o elige uno de la lista para ver su ficha.', actions: [{ label: 'Volver a la lista', onClick: () => G.go('MAE-01') }] });
      const grid = h('div', { class: 'grid c2' });
      grid.appendChild(card('Nuevo trabajador', canEmp() ? form({
        id: 'mae02new', fields: empFields(true), values: { doc_type: 'DNI', hire_date: G.TODAY, establishment_id: 'es-L1' }, submitLabel: 'Registrar trabajador',
        onSubmit: v => { const n = M.createEmployee(v); toast(`${n.full_name} registrado`, 'ok'); G.go('MAE-02', { id: n.id }); return true; },
      }) : notice(`Tu rol (${G.roleName()}) no tiene el permiso mae.employee.manage para dar de alta.`, 'warn')));
      grid.appendChild(card('Abrir ficha', table({ id: 'mae02pick', rows: D.all('employees'), pageSize: 8, onRow: x => G.go('MAE-02', { id: x.id }), columns: [{ key: 'full_name', label: 'Nombre' }, { key: 'position', label: 'Cargo' }, { key: 'status', label: 'Estado', render: x => status(x.status) }] }), { flush: true }));
      body.appendChild(grid); return;
    }
    const users = D.where('users', u => u.employee_id === e.id);
    const vig = users.find(u => ['ACTIVE', 'LOCKED'].includes(u.status));
    const acts = [];
    if (canEmp() && e.status === 'ACTIVE') {
      acts.push({ label: 'Editar', onClick: () => drawer('Editar ' + e.full_name, (bd, close) => bd.appendChild(form({ id: 'mae02ed', fields: empFields(false), values: e, onCancel: close, onSubmit: v => { if (v.phone && !U.phoneOk(v.phone)) return { phone: 'RN-MAE-01: el celular va con código de país, por ejemplo +51987654321.' }; D.update('employees', e.id, { full_name: v.full_name, position: v.position, establishment_id: v.establishment_id, cost_center_id: v.cost_center_id, hire_date: v.hire_date, phone: v.phone || null, email: v.email || null }); close(); toast('Ficha actualizada', 'ok'); G.refresh(); return true; } })), { code: 'MAE-02' }) });
      acts.push({ label: 'Vincular usuario', onClick: () => linkDialog(e) });
      acts.push({ label: 'Dar de baja', kind: 'danger', onClick: () => terminateDialog(e) });
    }
    const body = page(el, { code: 'MAE-02', title: e.full_name, sub: `${e.position} · ${G.siteName(e.establishment_id)} · ${docTypeName(e.doc_type)} ${e.doc_number}`, actions: [{ label: 'Lista', onClick: () => G.go('MAE-01') }, ...acts] });
    if (e.status !== 'ACTIVE') body.appendChild(notice([h('b', null, `Cesado el ${F.date(e.terminated_on)}. `), `Motivo: ${e.termination_reason}. Su usuario quedó inactivo y no se le asignan rutas, cajas ni tareas nuevas (RN-MAE-02).`], 'bad'));
    const grid = h('div', { class: 'grid c2' });
    grid.appendChild(card('Datos del trabajador', dl([
      ['Documento', `${docTypeName(e.doc_type)} ${e.doc_number}`], ['Nombre', e.full_name], ['Cargo', e.position], ['Local', G.siteName(e.establishment_id)],
      ['Centro de costo', G.ccName(e.cost_center_id)], ['Fecha de ingreso', F.date(e.hire_date)], ['Antigüedad', F.days(T.diff(e.terminated_on || G.TODAY, e.hire_date))],
      ['Celular', e.phone], ['Correo', e.email], ['Estado', e.status === 'ACTIVE' ? status('ACTIVE') : badge('Cesado', 'bad')],
      e.terminated_on ? ['Fecha de cese', F.date(e.terminated_on)] : null, e.terminated_on ? ['Motivo del cese', e.termination_reason] : null,
    ])));
    const sessions = vig ? D.where('user_sessions', s => s.user_id === vig.id) : [];
    grid.appendChild(card('Usuario vinculado', users.length ? h('div', { class: 'stack' }, users.map(u => h('div', { class: 'stack', style: 'gap:6px;border-bottom:1px solid var(--line);padding-bottom:8px' },
      h('div', { class: 'row between' }, h('b', null, u.email), status(u.status)),
      dl([['Rol', G.roleName(u.role)], ['Marcas', (u.brands || []).length ? u.brands.map(G.brandName).join(', ') : 'Todas'], ['Último ingreso', F.datetime(u.last_login)], ['Segundo factor', u.twofa_enabled ? 'Activo' : 'No'], u.deactivated_reason ? ['Desactivado', u.deactivated_reason] : null]),
      sessions.length && u === vig ? h('div', { class: 'small muted' }, `${sessions.filter(s => s.status === 'ACTIVE').length} sesión(es) activa(s)`) : null)),
      notice('Un trabajador tiene a lo más un usuario vigente (RN-MAE-13).', 'info'))
      : h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Sin usuario: este trabajador no ingresa al sistema.'), canEmp() && e.status === 'ACTIVE' ? btn('Vincular usuario', () => linkDialog(e), { sm: true }) : null)));
    body.appendChild(grid);
    if (G.aud && G.aud.historyPanel) body.appendChild(card('Historia', G.aud.historyPanel('employees', e.id)));
  }
  function terminateDialog(e) {
    const u = D.find('users', x => x.employee_id === e.id && x.status !== 'INACTIVE');
    modal('Dar de baja a ' + e.full_name, (bd, close) => {
      bd.appendChild(notice(u ? `Su usuario ${u.email} quedará inactivo, se cerrarán sus sesiones y se revocarán sus dispositivos (RN-MAE-02, RN-SEG-18).` : 'No tiene usuario vinculado.', 'warn'));
      bd.appendChild(form({ id: 'mae02term', fields: [{ key: 'date', label: 'Fecha de cese', type: 'date', required: true }, { key: 'reason', label: 'Motivo', type: 'select', options: TERM_REASONS.map(x => [x, x]), required: true }, { key: 'detail', label: 'Detalle (opcional)', type: 'textarea' }], values: { date: G.TODAY, reason: TERM_REASONS[0] }, submitLabel: 'Dar de baja', onCancel: close,
        onSubmit: v => { const r = M.terminate(e.id, { date: v.date, reason: v.reason + (v.detail ? ' · ' + v.detail : '') }); close(); toast(`${e.full_name} dado de baja${r.users.length ? '; usuario desactivado y ' + r.sessions + ' sesión(es) cerrada(s)' : ''}`, 'ok'); G.refresh(); return true; } }));
    });
  }
  function linkDialog(e) {
    const free = D.where('users', u => u.status !== 'INACTIVE' && u.role !== 'CLIENTE_B2B' && !u.platform && (!u.employee_id || u.employee_id === e.id || (D.get('employees', u.employee_id) || {}).status !== 'ACTIVE'));
    modal('Vincular usuario a ' + e.full_name, (bd, close) => {
      if (!free.length) { bd.appendChild(notice('No hay usuarios libres. Crea el usuario en Seguridad (SEG) y vuelve a vincularlo aquí.', 'info')); return; }
      bd.appendChild(form({ id: 'mae02link', fields: [{ key: 'user_id', label: 'Usuario', type: 'select', options: free.map(u => [u.id, `${u.name} · ${u.email} · ${G.roleName(u.role)}`]), required: true }], submitLabel: 'Vincular', onCancel: close, onSubmit: v => { const u = M.linkUser(e.id, v.user_id); close(); toast(`Usuario ${u.email} vinculado`, 'ok'); G.refresh(); return true; } }));
    });
  }

  /* ---------- MAE-03 Medios de pago ---------- */
  function renderPaymentMethods(el) {
    const canPM = G.can('mae.payment_method.manage') && G.canDo('MAE', 'E');
    const body = page(el, { code: 'MAE-03', title: 'Medios de pago', sub: 'Los 7 medios de Don Guando con su entidad, canales, plazo de abono y conector. Los del sistema no se borran ni cambian de código (RN-MAE-03).' });
    const pms = D.all('payment_methods').sort(U.by('sort_order'));
    const pays = D.where('payments', p => p.status === 'CONFIRMED' && String(p.paid_at).slice(0, 7) === G.TODAY.slice(0, 7));
    const byPm = U.groupBy(pays, 'payment_method_id');
    body.appendChild(kpis([
      { label: 'Medios activos', value: `${pms.filter(p => p.status === 'ACTIVE').length} de ${pms.length}` },
      { label: 'Exigen n.º de operación', value: F.num(pms.filter(p => p.requires_reference).length), sub: 'Yape, Plin, POS, Mercado Pago, transferencia' },
      { label: 'Cobrado en octubre', value: F.money(U.sum(pays, p => p.amount)), sub: `${F.num(pays.length)} cobros` },
      { label: 'Comisión de Mercado Pago', value: F.pct(M.fee('pm-MP', G.TODAY, 100).pct, 2), sub: 'vigente hoy · D-MAE-03' },
    ]));
    body.appendChild(table({
      id: 'mae03', rows: pms, onRow: pm => pmDrawer(pm, canPM), search: false,
      columns: [
        { key: 'system_code', label: 'Código', mono: true },
        { key: 'name', label: 'Medio' },
        { key: 'kind', label: 'Tipo', value: pm => PM_KIND[pm.kind] || pm.kind },
        { key: 'institution_code', label: 'Entidad', value: pm => pm.institution_code ? ((D.find('financial_institutions', f => f.code === pm.institution_code) || {}).name || pm.institution_code) : (pm.code === 'CARD' ? 'Por definir (D-MAE-01)' : '—') },
        { key: 'requires_reference', label: 'N.º de operación', render: pm => pm.requires_reference ? badge('Obligatorio', 'warn') : badge('No pide', '') },
        { key: 'allowed_channels', label: 'Canales', value: pm => (pm.allowed_channels || []).map(payChName).join(', ') },
        { key: 'settlement_days', label: 'Abono', align: 'r', value: pm => pm.settlement_days, render: pm => pm.settlement_days ? F.days(pm.settlement_days) : 'Inmediato' },
        { key: 'connector', label: 'Conector', value: pm => pm.connector_code || '—' },
        { key: 'month', label: 'Cobrado oct.', align: 'r', value: pm => U.sum(byPm[pm.id] || [], p => p.amount), render: pm => F.money(U.sum(byPm[pm.id] || [], p => p.amount)) },
        { key: 'status', label: 'Estado', render: pm => status(pm.status) },
      ],
    }));
    body.appendChild(card('Validar un cobro (RN-MAE-04)', form({ id: 'mae03val', fields: [{ key: 'pm', label: 'Medio', type: 'select', options: pms.map(p => [p.id, p.name]), required: true }, { key: 'ref', label: 'Número de operación' }], submitLabel: 'Validar', onSubmit: v => { M.assertReference(v.pm, v.ref); toast('El cobro tiene los datos que exige el medio.', 'ok'); return true; } })));
  }
  function pmDrawer(pm, canPM) {
    drawer(pm.name, (bd, close) => {
      bd.appendChild(dl([['Código del sistema', pm.system_code], ['Tipo', PM_KIND[pm.kind]], ['Exige número de operación', pm.requires_reference ? 'Sí (RN-MAE-04)' : 'No'], ['Permitido contra entrega', pm.allowed_on_delivery ? 'Sí' : 'No'], ['Canales', (pm.allowed_channels || []).map(payChName).join(', ')], ['Plazo de abono', pm.settlement_days ? F.days(pm.settlement_days) : 'Inmediato'], ['Conector', pm.connector_code || '—'], ['Comisión vigente', (() => { const f = M.feeRow(pm.id, G.TODAY); return f ? `${F.pct(f.fee_pct, 2)} + ${F.money(f.fee_fixed)}` : 'Sin comisión registrada'; })()], ['Estado', status(pm.status)]]));
      if (!canPM) { bd.appendChild(notice(`Tu rol (${G.roleName()}) no tiene el permiso mae.payment_method.manage.`, 'info')); return; }
      bd.appendChild(h('h3', null, 'Configurar'));
      bd.appendChild(form({ id: 'mae03cfg', fields: [
        { key: 'name', label: 'Nombre visible', required: true },
        { key: 'institution_code', label: 'Entidad', type: 'select', options: D.all('financial_institutions').map(f => [f.code, `${f.name} · ${fiKindName(f.kind)}`]) },
        { key: 'settlement_days', label: 'Plazo de abono (días)', type: 'number', min: 0, max: 60 },
        ...PAY_CH.map(([c, l]) => ({ key: 'ch_' + c, label: l, type: 'checkbox' })),
        { key: 'reason', label: 'Motivo del cambio', required: true, span: 2 },
      ], values: Object.assign({ name: pm.name, institution_code: pm.institution_code, settlement_days: pm.settlement_days }, Object.fromEntries(PAY_CH.map(([c]) => ['ch_' + c, (pm.allowed_channels || []).includes(c)]))), submitLabel: 'Guardar configuración', onCancel: close,
        onSubmit: v => { const ch = PAY_CH.filter(([c]) => v['ch_' + c]).map(([c]) => c); if (!ch.length) return 'Elige al menos un canal.'; D.update('payment_methods', pm.id, { name: v.name, institution_code: v.institution_code || null, settlement_days: Number(v.settlement_days) || 0, allowed_channels: ch, config_reason: v.reason }); close(); toast('Medio de pago actualizado', 'ok'); G.refresh(); return true; } }));
      bd.appendChild(h('div', { class: 'row', style: 'margin-top:10px' },
        btn(pm.status === 'ACTIVE' ? 'Desactivar' : 'Activar', () => { const reason = prompt0(); if (!reason) return; D.update('payment_methods', pm.id, { status: pm.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', status_reason: reason }); close(); toast('Estado actualizado', 'ok'); G.refresh(); }, { kind: pm.status === 'ACTIVE' ? 'danger' : 'primary', sm: true }),
        btn('Eliminar', () => toast('RN-MAE-03: los medios de pago del sistema no se borran ni cambian su código o tipo; puedes desactivarlo.', 'bad'), { kind: 'ghost', sm: true })));
      function prompt0() { const t = bd.querySelector('#f-mae03cfg-reason'); const r = t && t.value.trim(); if (!r) { toast('Escribe el motivo del cambio arriba.', 'warn'); return null; } return r; }
    }, { code: 'MAE-03' });
  }

  /* ---------- MAE-04 Comisiones ---------- */
  function renderFees(el) {
    const canPM = G.can('mae.payment_method.manage') && G.canDo('MAE', 'C');
    const body = page(el, { code: 'MAE-04', title: 'Comisiones por medio de pago', sub: 'Historial de comisiones por vigencia. Una sola comisión por medio y fecha; comisión = monto × % + fijo (RN-MAE-05).', actions: canPM ? [{ label: 'Nueva comisión', kind: 'primary', icon: '+', onClick: () => feeDialog() }] : [] });
    body.appendChild(notice('D-MAE-01 y D-MAE-03: la comisión del POS Visa está por registrar y la de Mercado Pago (3,99 %) es una tasa de ejemplo hasta confirmar el contrato.', 'info'));
    const grid = h('div', { class: 'grid c2' });
    const sim = h('div');
    const st = { pm: 'pm-MP', date: '2026-10-15', amount: 100 };
    const drawSim = () => {
      G.ui.clear(sim);
      const f = M.fee(st.pm, st.date, st.amount);
      sim.append(h('div', { class: 'grid c3' },
        h('label', { class: 'field' }, 'Medio', sel(D.all('payment_methods').map(p => [p.id, p.name]), st.pm, v => { st.pm = v; drawSim(); })),
        h('label', { class: 'field' }, 'Fecha del cobro', (() => { const i = h('input', { class: 'input', type: 'date', value: st.date }); i.addEventListener('change', () => { st.date = i.value; drawSim(); }); return i; })()),
        h('label', { class: 'field' }, 'Monto (S/)', (() => { const i = h('input', { class: 'input', type: 'number', value: st.amount, attrs: { step: '0.01', min: '0' } }); i.addEventListener('change', () => { st.amount = Number(i.value) || 0; drawSim(); }); return i; })())),
        dl([['Comisión vigente', f.row ? `${F.pct(f.pct, 2)} + ${F.money(f.fixed)} (del ${F.date(f.row.valid_from)} ${f.row.valid_to ? 'al ' + F.date(f.row.valid_to) : 'sin fin'})` : 'Sin comisión para esa fecha'], ['Comisión del cobro', h('b', null, F.money(f.fee))], f.row && !f.igv_included ? ['IGV de la comisión', F.money(f.igv)] : null, ['Neto que se abona', F.money(R(st.amount - f.fee - (f.igv || 0)))]]));
    };
    drawSim();
    grid.appendChild(card(`Simulador «cobro de ${F.money(100)} el día X»`, sim));
    // KPI-MAE-02 por medio
    const from = G.date.month(G.TODAY);
    const pays = D.where('payments', p => p.status === 'CONFIRMED' && String(p.paid_at).slice(0, 10) >= from && String(p.paid_at).slice(0, 10) <= G.TODAY);
    const by = U.groupBy(pays, 'payment_method_id');
    grid.appendChild(card('Comisión efectiva de octubre (KPI-MAE-02)', table({ id: 'mae04kpi', search: false, pageSize: 10, rows: Object.entries(by).map(([pm, ps]) => { const amt = U.sum(ps, p => p.amount); const fee = R(U.sum(ps, p => M.fee(pm, p.paid_at, p.amount).fee)); return { pm, n: ps.length, amt, fee, pct: amt ? fee / amt * 100 : 0 }; }),
      columns: [{ key: 'pm', label: 'Medio', value: r => G.pmName(r.pm) }, { key: 'n', label: 'Cobros', align: 'r' }, { key: 'amt', label: 'Cobrado', align: 'r', render: r => F.money(r.amt) }, { key: 'fee', label: 'Comisión', align: 'r', render: r => F.money(r.fee) }, { key: 'pct', label: '%', align: 'r', render: r => F.pct(r.pct, 2) }] }), { flush: true }));
    body.appendChild(grid);
    body.appendChild(table({
      id: 'mae04', rows: D.all('payment_method_fees').sort((a, b) => a.payment_method_id.localeCompare(b.payment_method_id) || a.valid_from.localeCompare(b.valid_from)),
      columns: [
        { key: 'payment_method_id', label: 'Medio', value: f => G.pmName(f.payment_method_id) },
        { key: 'valid_from', label: 'Desde', render: f => F.date(f.valid_from) },
        { key: 'valid_to', label: 'Hasta', render: f => f.valid_to ? F.date(f.valid_to) : 'Sin fin' },
        { key: 'fee_pct', label: '%', align: 'r', render: f => F.pct(f.fee_pct, 2) },
        { key: 'fee_fixed', label: 'Fijo', align: 'r', render: f => F.money(f.fee_fixed) },
        { key: 'igv_included', label: 'IGV', render: f => f.igv_included ? 'Incluido' : 'Más IGV' },
        { key: 'vig', label: 'Vigencia hoy', value: f => f.valid_from <= G.TODAY && (!f.valid_to || f.valid_to >= G.TODAY) ? 1 : f.valid_from > G.TODAY ? 2 : 0, render: f => f.valid_from <= G.TODAY && (!f.valid_to || f.valid_to >= G.TODAY) ? badge('Vigente', 'ok') : f.valid_from > G.TODAY ? badge('Programada', 'info') : badge('Histórica', '') },
        { key: 'note', label: 'Nota' },
      ],
      filters: [{ key: 'payment_method_id', label: 'Medio', options: D.all('payment_methods').map(p => [p.id, p.name]) }],
    }));
    function feeDialog() {
      drawer('Nueva comisión', (bd, close) => bd.appendChild(form({ id: 'mae04new', fields: [
        { key: 'payment_method_id', label: 'Medio', type: 'select', options: D.all('payment_methods').map(p => [p.id, p.name]), required: true },
        { key: 'valid_from', label: 'Vigente desde', type: 'date', required: true }, { key: 'valid_to', label: 'Vigente hasta', type: 'date', help: 'Vacío: sin fecha de fin' },
        { key: 'fee_pct', label: 'Porcentaje (%)', type: 'number', min: 0, max: 20, required: true }, { key: 'fee_fixed', label: 'Monto fijo (S/)', type: 'money', min: 0 },
        { key: 'igv_included', label: 'La comisión incluye IGV', type: 'checkbox' }, { key: 'closePrevious', label: 'Cerrar la vigencia abierta anterior el día previo', type: 'checkbox' },
        { key: 'note', label: 'Nota', type: 'textarea' },
      ], values: { payment_method_id: 'pm-CARD', valid_from: G.TODAY, fee_pct: 0, fee_fixed: 0, igv_included: true, closePrevious: true }, onCancel: close, submitLabel: 'Registrar',
        onSubmit: v => { M.addFee(v, { closePrevious: v.closePrevious }); close(); toast('Comisión registrada', 'ok'); G.refresh(); return true; } })), { code: 'MAE-04' });
    }
  }

  /* ---------- MAE-05 Tipo de cambio ---------- */
  const fxState = { month: G.date.month(G.TODAY), currency: 'USD' };
  function renderFx(el) {
    const canFx = G.can('mae.exchange_rate.edit');
    const body = page(el, { code: 'MAE-05', title: 'Tipo de cambio', sub: 'Compra y venta diarias desde SUNAT (conector FX a las ' + (G.param('mae_fx_load_time') || '09:00') + ') o a mano. Sin publicación se usa el último publicado (RN-MAE-07).', actions: [
      { label: 'Cargar de SUNAT hoy', onClick: () => wrapErr(() => { const r = M.loadFx(G.TODAY); toast(r.msg, r.published ? 'ok' : 'info'); G.refresh(); }) },
      canFx ? { label: 'Registrar a mano', kind: 'primary', onClick: () => fxDialog(null) } : null].filter(Boolean) });
    body.appendChild(notice('D-MAE-02: se usa la venta SUNAT del día o el último publicado dentro de ' + (G.param('mae_fx_max_fallback_days') ?? 7) + ' días (valor a confirmar por la contadora).', 'info'));
    const today = (() => { try { return M.fx(G.TODAY); } catch (e) { return null; } })();
    const k1 = G.kpi('KPI-MAE-01', { from: fxState.month, to: G.date.add(G.date.addMonths(fxState.month, 1), -1) < G.TODAY ? G.date.add(G.date.addMonths(fxState.month, 1), -1) : G.TODAY });
    const missing = []; for (let d = fxState.month; d < G.date.addMonths(fxState.month, 1) && d <= G.TODAY; d = T.add(d, 1)) if (isBusinessDay(d) && !M.rateOn(d, fxState.currency)) missing.push(d);
    body.appendChild(kpis([
      { label: 'Venta aplicable hoy', value: today ? fx3(today.sell) : '—', sub: today ? (today.fallback ? `del ${F.date(today.used_date)} (último publicado)` : 'publicado hoy') : 'RN-MAE-07: sin tipo de cambio', tone: today && today.fallback ? 'warn' : '' },
      { label: 'Compra aplicable hoy', value: today ? fx3(today.buy) : '—' },
      { label: 'Días hábiles con carga', value: k1 ? F.pct(k1.value, 1) : '—', sub: k1 ? `${k1.numerator} de ${k1.denominator} · KPI-MAE-01` : '', tone: k1 && k1.value < 100 ? 'warn' : 'ok' },
      { label: 'Días hábiles sin carga', value: F.num(missing.length), sub: missing.map(F.date).join(', ') || 'ninguno', tone: missing.length ? 'bad' : '' },
    ]));
    const months = []; for (let m = '2026-08-01'; m <= G.date.month(G.TODAY); m = G.date.addMonths(m, 1)) months.push([m, G.date.monthName(m)]);
    body.appendChild(h('div', { class: 'row between' }, pills(months, fxState.month, v => { fxState.month = v; G.refresh(); }), h('span', { class: 'small muted' }, 'Clic en un día para ver o corregir.')));
    // calendario
    const cal = h('div', { style: 'display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px' });
    for (const d of ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']) cal.appendChild(h('div', { class: 'small muted', style: 'text-align:center' }, d));
    const first = fxState.month; const off = (dow(first) + 6) % 7; for (let k = 0; k < off; k++) cal.appendChild(h('div'));
    for (let d = first; d < G.date.addMonths(first, 1); d = T.add(d, 1)) {
      const row = M.rateOn(d, fxState.currency); const bd = isBusinessDay(d); const fut = d > G.TODAY;
      const tone = row ? (row.edit_reason ? 'var(--warn-soft)' : 'var(--surface)') : fut ? 'transparent' : bd ? 'var(--bad-soft)' : 'var(--surface-2, var(--bg))';
      const fb = !row && !fut ? (() => { try { return M.fx(d, fxState.currency); } catch (e) { return null; } })() : null;
      const dd = d;
      cal.appendChild(h('button', { class: 'card', style: `all:unset;cursor:pointer;display:block;padding:6px;border:1px solid var(--line);border-radius:6px;background:${tone};min-height:58px;min-width:0;overflow:hidden`, title: HOLIDAYS[d] || '', on: { click: () => fxDay(dd) } },
        h('div', { class: 'row between', style: 'gap:2px' }, h('b', { class: 'small' }, d.slice(8)), row ? h('span', { class: 'small muted', style: 'font-size:.7rem' }, { SUNAT: 'SUNAT', MANUAL: 'manual', IMPORT: 'import.' }[row.loaded_via] || '') : null),
        row ? h('div', { class: 'mono small', style: 'line-height:1.25' }, fx3(row.buy), h('br'), h('b', null, fx3(row.sell))) : fut ? null : h('div', { class: 'small', style: 'line-height:1.2;color:' + (bd ? 'var(--bad)' : 'var(--muted)') }, bd ? 'Sin carga' : (HOLIDAYS[d] ? 'Feriado' : 'No publica'), fb ? h('div', { class: 'mono', style: 'font-size:.7rem' }, '→ ' + fx3(fb.sell)) : null)));
    }
    body.appendChild(card(`${G.date.monthName(fxState.month)} · ${fxState.currency} (compra / venta)`, cal));
    // consulta
    const out = h('div', { class: 'small' });
    body.appendChild(card('¿Qué tipo de cambio usa un documento? (get_exchange_rate)', h('div', { class: 'stack' }, form({ id: 'mae05q', fields: [{ key: 'date', label: 'Fecha del documento', type: 'date', required: true }, { key: 'usd', label: 'Monto en US$', type: 'money', min: 0 }], values: { date: G.TODAY, usd: 250 }, submitLabel: 'Calcular',
      onSubmit: v => { G.ui.clear(out); const r = M.toPen(v.usd || 0, v.date); out.appendChild(notice(`Se usa la venta ${fx3(r.rate)} del ${F.date(r.used_date)}${r.fallback ? ' (último publicado, RN-MAE-07)' : ''}: US$ ${F.num(v.usd || 0, 2)} = ${F.money(r.pen)}.`, r.fallback ? 'warn' : 'ok')); return true; } }), out)));
    body.appendChild(table({ id: 'mae05list', rows: D.where('exchange_rates', x => x.edit_reason || x.loaded_via === 'MANUAL'), search: false, pageSize: 10, empty: 'Sin cargas manuales ni correcciones.',
      columns: [{ key: 'date', label: 'Fecha', render: x => F.date(x.date) }, { key: 'buy', label: 'Compra', align: 'r', render: x => fx3(x.buy) }, { key: 'sell', label: 'Venta', align: 'r', render: x => fx3(x.sell) }, { key: 'loaded_via', label: 'Origen' }, { key: 'loaded_by', label: 'Cargado por', value: x => x.edited_by || x.loaded_by }, { key: 'edit_reason', label: 'Motivo de corrección' }] }));
    function fxDay(d) {
      const row = M.rateOn(d, fxState.currency);
      drawer('Tipo de cambio del ' + F.date(d), (bd, close) => {
        bd.appendChild(dl([['Día', `${DOW[dow(d)]} ${F.date(d)}${HOLIDAYS[d] ? ' · feriado: ' + HOLIDAYS[d] : ''}`], ['Hábil', isBusinessDay(d) ? 'Sí' : 'No'], row ? ['Compra', fx3(row.buy)] : null, row ? ['Venta', fx3(row.sell)] : null, row ? ['Origen', row.loaded_via] : null, row ? ['Cargado por', row.loaded_by] : null, row && row.edit_reason ? ['Corrección', `${row.edit_reason} (${row.edited_by || ''})`] : null]));
        if (!row) { try { const fb = M.fx(d); bd.appendChild(notice(`Sin publicación: los documentos de este día usan la venta ${fx3(fb.sell)} del ${F.date(fb.used_date)} (RN-MAE-07).`, 'warn')); } catch (e) { bd.appendChild(notice(e.message, 'bad')); } }
        if (canFx && d <= G.TODAY) bd.appendChild(h('div', { class: 'row', style: 'margin:10px 0' }, isBusinessDay(d) && !row ? btn('Cargar de SUNAT', () => wrapErr(() => { const r = M.loadFx(d); toast(r.msg, 'ok'); close(); G.refresh(); }), { sm: true }) : null, btn(row ? 'Corregir' : 'Registrar a mano', () => { close(); fxDialog(d); }, { kind: 'primary', sm: true })));
        if (row && G.aud && G.aud.historyPanel) bd.appendChild(G.aud.historyPanel('exchange_rates', row.id));
      }, { code: 'MAE-05' });
    }
    function fxDialog(d) {
      const row = d && M.rateOn(d, fxState.currency);
      drawer(row ? 'Corregir tipo de cambio' : 'Registrar tipo de cambio', (bd, close) => bd.appendChild(form({ id: 'mae05f', fields: [
        { key: 'date', label: 'Fecha', type: 'date', required: true, disabled: !!row }, { key: 'buy', label: 'Compra', type: 'number', min: 0, step: '0.001', required: true }, { key: 'sell', label: 'Venta', type: 'number', min: 0, step: '0.001', required: true },
        { key: 'reason', label: row ? 'Motivo de la corrección (mín. 10 caracteres)' : 'Nota', type: 'textarea', required: !!row },
      ], values: row ? { date: row.date, buy: row.buy, sell: row.sell } : { date: d || G.TODAY }, onCancel: close, submitLabel: row ? 'Guardar corrección' : 'Registrar',
        onSubmit: v => { M.setFx({ date: v.date, currency: fxState.currency, buy: v.buy, sell: v.sell, reason: v.reason, via: 'MANUAL' }); close(); toast(row ? 'Tipo de cambio corregido (queda en la auditoría)' : 'Tipo de cambio registrado', 'ok'); G.refresh(); return true; } })), { code: 'MAE-05' });
    }
  }

  /* ---------- MAE-06 Unidades y conversiones ---------- */
  function renderUnits(el) {
    const canU = G.can('mae.unit.manage') && G.canDo('MAE', 'C');
    const body = page(el, { code: 'MAE-06', title: 'Unidades y conversiones', sub: 'Unidades con su código SUNAT, tipo y decimales permitidos (RN-MAE-10); conversiones exactas con su inversa calculada (RN-MAE-09).', actions: canU ? [{ label: 'Nueva conversión', kind: 'primary', icon: '+', onClick: () => convDialog() }] : [] });
    const grid = h('div', { class: 'grid c2' });
    grid.appendChild(card('Unidades de medida', table({ id: 'mae06u', search: false, rows: D.all('units_of_measure'), columns: [
      { key: 'code', label: 'Código SUNAT', mono: true }, { key: 'name', label: 'Unidad' }, { key: 'uom_type', label: 'Tipo', value: u => uomTypeName(u.uom_type) },
      { key: 'decimals', label: 'Decimales', align: 'r' }, { key: 'is_system', label: 'Sistema', render: u => u.is_system ? badge('Sistema', 'info') : badge('Propia', '') },
      { key: 'sunat', label: 'Catálogo 03', render: u => M.sunatValid('03', u.code) ? badge('Vigente', 'ok') : badge('No está', 'bad') }] }), { flush: true }));
    grid.appendChild(card('Conversiones', table({ id: 'mae06c', search: false, rows: D.all('unit_conversions'), columns: [
      { key: 'from_uom', label: 'De', mono: true }, { key: 'factor', label: 'Factor', align: 'r', render: c => F.num(c.factor, 4) }, { key: 'to_uom', label: 'A', mono: true },
      { key: 'inv', label: 'Inversa (calculada)', render: c => `1 ${c.to_uom} = ${F.num(1 / c.factor, 6)} ${c.from_uom}` }, { key: 'note', label: 'Nota' }] }), { flush: true }));
    body.appendChild(grid);
    const out = h('div');
    const units = D.all('units_of_measure').map(u => [u.code, `${u.code} · ${u.name}`]);
    body.appendChild(card('Calculadora de conversión', h('div', { class: 'stack' }, form({ id: 'mae06calc', fields: [{ key: 'qty', label: 'Cantidad', type: 'number', required: true }, { key: 'from', label: 'De', type: 'select', options: units, required: true }, { key: 'to', label: 'A', type: 'select', options: units, required: true }], values: { qty: 1.25, from: 'KGM', to: 'GRM' }, submitLabel: 'Convertir',
      onSubmit: v => { G.ui.clear(out); const r = M.convert(v.qty, v.from, v.to); const dec = x => String(x).split('.')[1] ? String(x).split('.')[1].length : 0;
        out.appendChild(notice(`${F.num(v.qty, dec(v.qty))} ${v.from} = ${F.num(r, dec(r))} ${v.to}`, 'ok')); return true; } }), out)));
    function convDialog() {
      drawer('Nueva conversión', (bd, close) => bd.appendChild(form({ id: 'mae06new', fields: [{ key: 'from_uom', label: 'De', type: 'select', options: units, required: true }, { key: 'to_uom', label: 'A', type: 'select', options: units, required: true }, { key: 'factor', label: 'Factor (1 De = factor A)', type: 'number', required: true }, { key: 'note', label: 'Nota' }], values: { from_uom: 'BG', to_uom: 'NIU' }, onCancel: close,
        onSubmit: v => { M.addConversion(v); close(); toast('Conversión registrada', 'ok'); G.refresh(); return true; } })), { code: 'MAE-06' });
    }
  }

  /* ---------- MAE-07 Catálogos SUNAT ---------- */
  const catState = { cat: '01' };
  function renderCatalogs(el) {
    const canImp = G.can('mae.catalog.import');
    const body = page(el, { code: 'MAE-07', title: 'Catálogos SUNAT', sub: 'Catálogos de la facturación electrónica con su vigencia. Son globales y de solo lectura; el operador de la plataforma los actualiza por importación (RN-MAE-11).', actions: canImp ? [{ label: 'Importar catálogo', onClick: () => importDialog() }] : [] });
    const cats = Object.keys(CATALOG_NAMES).filter(c => D.find('sunat_catalog_items', x => x.catalog === c));
    body.appendChild(pills(cats.map(c => [c, `${c} · ${CATALOG_NAMES[c]}`]), catState.cat, v => { catState.cat = v; G.refresh(); }));
    const rows = D.where('sunat_catalog_items', x => x.catalog === catState.cat);
    body.appendChild(table({ id: 'mae07', rows, pageSize: 30, columns: [
      { key: 'code', label: 'Código', mono: true }, { key: 'description', label: 'Descripción' }, { key: 'valid_from', label: 'Vigente desde', render: x => F.date(x.valid_from) }, { key: 'valid_to', label: 'Hasta', render: x => x.valid_to ? F.date(x.valid_to) : 'Sin fin' },
      { key: 'vig', label: 'Hoy', render: x => M.sunatValid(x.catalog, x.code) ? badge('Vigente', 'ok') : badge('No vigente', 'bad') }] }));
    const out = h('div');
    body.appendChild(card('¿Se puede usar este código? (RN-MAE-12)', h('div', { class: 'stack' }, form({ id: 'mae07chk', fields: [{ key: 'catalog', label: 'Catálogo', type: 'select', options: cats.map(c => [c, `${c} · ${CATALOG_NAMES[c]}`]), required: true }, { key: 'code', label: 'Código', required: true }, { key: 'date', label: 'Fecha del documento', type: 'date', required: true }], values: { catalog: '20', code: '19', date: G.TODAY }, submitLabel: 'Validar',
      onSubmit: v => { G.ui.clear(out); try { M.assertSunat(v.catalog, String(v.code).trim(), v.date); out.appendChild(notice(`Código ${v.code} vigente el ${F.date(v.date)}: ${M.sunatItem(v.catalog, String(v.code).trim()).description}.`, 'ok')); } catch (e) { out.appendChild(notice(e.message, 'bad')); } return true; } }), out)));
    function importDialog() {
      drawer('Importar catálogo SUNAT', (bd, close) => {
        bd.appendChild(notice('Formato: catálogo;código;descripción;vigente desde;vigente hasta (una fila por línea). Las filas existentes se actualizan.', 'info'));
        bd.appendChild(form({ id: 'mae07imp', fields: [{ key: 'csv', label: 'Contenido', type: 'textarea', required: true }], values: { csv: '09;01;Anulación de la operación;2016-01-01;\n18;02;Transporte privado;2016-01-01;' }, submitLabel: 'Importar', onCancel: close,
          onSubmit: v => { const rows = []; for (const [k, line] of v.csv.split(/\r?\n/).filter(x => x.trim()).entries()) { const [c, code, desc, from, to] = line.split(';').map(s => (s || '').trim()); if (!c || !code || !desc || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return `Fila ${k + 1}: faltan catálogo, código, descripción o la fecha de inicio (AAAA-MM-DD).`; rows.push({ catalog: c.padStart(2, '0'), catalog_name: CATALOG_NAMES[c.padStart(2, '0')] || 'Catálogo ' + c, code, description: desc, valid_from: from, valid_to: to || null, status: 'ACTIVE' }); } const r = M.importGlobal('sunat_catalog_items', rows, x => x.catalog + '-' + x.code); close(); toast(`Catálogo importado: ${r.inserted} nuevas, ${r.updated} actualizadas`, 'ok'); G.refresh(); return true; } }));
      }, { code: 'MAE-07' });
    }
  }

  /* ---------- MAE-08 Ubigeo ---------- */
  function renderUbigeo(el) {
    const canImp = G.can('mae.catalog.import');
    const body = page(el, { code: 'MAE-08', title: 'Ubigeo', sub: 'Departamento, provincia y distrito con el código INEI. Global y de solo lectura; el operador importa el archivo oficial (RN-MAE-11).', actions: canImp ? [{ label: 'Importar archivo INEI', onClick: () => importDialog() }] : [] });
    const dist = D.where('ubigeo', u => u.level === 'DISTRICT');
    const lima = dist.filter(u => u.code.startsWith('1501')).length, callao = dist.filter(u => u.code.startsWith('0701')).length, aqp = dist.filter(u => u.code.startsWith('0401')).length;
    const used = U.groupBy(D.all('customer_addresses').filter(a => a.ubigeo && a.ubigeo.length === 6), 'ubigeo');
    body.appendChild(kpis([{ label: 'Lima Metropolitana', value: `${lima} distritos`, sub: 'provincia 1501' }, { label: 'Callao', value: `${callao} distritos`, sub: 'provincia 0701' }, { label: 'Arequipa', value: `${aqp} distritos`, sub: 'provincia 0401 (envíos a provincia)' }, { label: 'Departamentos', value: F.num(D.where('ubigeo', u => u.level === 'DEPARTMENT').length) }]));
    body.appendChild(notice('Local 1: 150140 Santiago de Surco · Local 2: 150119 Lurín.', 'info'));
    body.appendChild(table({ id: 'mae08', rows: D.all('ubigeo').sort(U.by('code')), pageSize: 30, columns: [
      { key: 'code', label: 'Ubigeo', mono: true }, { key: 'level', label: 'Nivel', value: u => ({ DEPARTMENT: 'Departamento', PROVINCE: 'Provincia', DISTRICT: 'Distrito' })[u.level] },
      { key: 'department', label: 'Departamento' }, { key: 'province', label: 'Provincia' }, { key: 'district', label: 'Distrito' },
      { key: 'use', label: 'Direcciones', align: 'r', value: u => (used[u.code] || []).length }],
      filters: [{ key: 'level', label: 'Nivel', options: [['DEPARTMENT', 'Departamento'], ['PROVINCE', 'Provincia'], ['DISTRICT', 'Distrito']] }, { key: 'department', label: 'Departamento', options: [...new Set(D.all('ubigeo').map(u => u.department))].sort().map(d => [d, d]) }],
      actions: u => [btn('Editar', () => wrapErr(() => M.updateGlobal('ubigeo', u.id, {})) && toast('Importación aplicada.', 'ok'), { sm: true, kind: 'ghost', title: 'La aplicación no modifica el ubigeo (RN-MAE-11)' })] }));
    function importDialog() {
      drawer('Importar ubigeo INEI', (bd, close) => {
        bd.appendChild(notice('Formato: ubigeo;departamento;provincia;distrito (6 dígitos por distrito).', 'info'));
        bd.appendChild(form({ id: 'mae08imp', fields: [{ key: 'csv', label: 'Contenido', type: 'textarea', required: true }], values: { csv: '040701;Arequipa;Islay;Mollendo\n040702;Arequipa;Islay;Cocachacra' }, submitLabel: 'Importar', onCancel: close,
          onSubmit: v => { const rows = []; for (const [k, line] of v.csv.split(/\r?\n/).filter(x => x.trim()).entries()) { const [code, dep, prov, dis] = line.split(';').map(s => (s || '').trim()); if (!/^\d{6}$/.test(code) || !dis) return `Fila ${k + 1}: el ubigeo tiene 6 dígitos y debe traer el distrito.`; rows.push({ code, level: 'DISTRICT', department: dep, province: prov, district: dis }); } const r = M.importGlobal('ubigeo', rows, x => x.code); close(); toast(`Ubigeo importado: ${r.inserted} nuevos, ${r.updated} actualizados`, 'ok'); G.refresh(); return true; } }));
      }, { code: 'MAE-08' });
    }
  }

  /* ---------- MAE-09 Entidades financieras ---------- */
  function renderInstitutions(el) {
    const body = page(el, { code: 'MAE-09', title: 'Entidades financieras', sub: 'Bancos, billeteras (Yape, Plin), adquirentes (Niubiz, Izipay) y pasarelas (Mercado Pago). Globales: se enlazan a los medios de pago y a las cuentas de CAJ.' });
    const pms = D.all('payment_methods'); const accs = D.all('cash_accounts');
    body.appendChild(table({ id: 'mae09', rows: D.all('financial_institutions').sort(U.by('sort_order')), onRow: f => drawer(f.name, bd => { bd.appendChild(dl([['Código', f.code], ['Tipo', fiKindName(f.kind)], ['RUC', f.ruc], ['Código CCI', f.cci_code], ['Medios que la usan', pms.filter(p => p.institution_code === f.code).map(p => p.name).join(', ') || '—'], ['Cuentas de la empresa', accs.filter(a => a.bank_name && f.name.toLowerCase().includes(String(a.bank_name).toLowerCase().split(' ')[0])).map(a => a.name || a.id).join(', ') || '—']])); bd.appendChild(notice('Registro global de solo lectura (RN-MAE-11).', 'info')); }, { code: 'MAE-09' }),
      columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Entidad' }, { key: 'kind', label: 'Tipo', value: f => fiKindName(f.kind) }, { key: 'ruc', label: 'RUC', mono: true }, { key: 'cci_code', label: 'Código CCI', mono: true },
        { key: 'pm', label: 'Medios de pago', value: f => pms.filter(p => p.institution_code === f.code).map(p => p.name).join(', ') }, { key: 'status', label: 'Estado', render: f => status(f.status) }],
      filters: [{ key: 'kind', label: 'Tipo', options: FI_KIND }] }));
  }

  /* ---------- MAE-10 Importar trabajadores ---------- */
  const SAMPLE_CSV = 'tipo_doc;numero;nombre;cargo;local;centro_costo;ingreso;celular;correo\nDNI;72651034;Jhon Huamaní Tito;Preparador;L1;ALM-L1;2026-10-12;+51984551230;\nDNI;7265103;Lucero Rojas Paz;Vendedora;L1;VEN-M2;2026-10-12;+51984551231;lrojas@donguando.pe\nCE;002315478;Andreína Pérez Gil;Operaria de empaque;L2;PROD-L2;2026-10-12;+51984551232;\nDNI;40123000;Rosa Quispe Huamán;Gerente general;L1;ADM;2023-03-01;;\nDNI;73110254;Kelvin Soto Aguirre;Repartidor (moto);L3;DEL;2026-10-12;+51984551234;\nDNI;73110299;Nataly Inga Ramos;Operaria de caldos;L2;PROD-L2;12/10/2026;984551235;';
  const impState = { csv: SAMPLE_CSV, rows: null };
  function parseEmployees(csv) {
    const lines = csv.split(/\r?\n/).filter(x => x.trim()); const out = []; const seen = new Set();
    lines.slice(/^tipo_doc/i.test(lines[0] || '') ? 1 : 0).forEach((line, k) => {
      const [doc_type, num, name, position, local, cc, hire, phone, email] = line.split(/[;,]/).map(s => (s || '').trim());
      const errs = []; let doc_number = num;
      try { doc_number = M.checkDoc((doc_type || '').toUpperCase() === 'PASAPORTE' ? 'PASSPORT' : (doc_type || '').toUpperCase(), num); } catch (e) { errs.push(e.message); }
      const dt = (doc_type || '').toUpperCase() === 'PASAPORTE' ? 'PASSPORT' : (doc_type || '').toUpperCase();
      if (D.find('employees', e => e.doc_type === dt && String(e.doc_number) === doc_number)) errs.push(`RN-MAE-01: ya existe un trabajador con ${dt} ${doc_number}.`);
      if (seen.has(dt + doc_number)) errs.push('RN-MAE-01: documento repetido en el archivo.'); seen.add(dt + doc_number);
      if (!name) errs.push('Falta el nombre.'); if (!position) errs.push('Falta el cargo.');
      const est = D.find('establishments', e => e.code === local); if (!est) errs.push(`El local «${local}» no existe (usa L1 o L2).`);
      const ccr = D.find('cost_centers', c => c.code === cc); if (!ccr) errs.push(`El centro de costo «${cc}» no existe.`);
      let hd = hire; if (/^\d{2}\/\d{2}\/\d{4}$/.test(hire)) hd = hire.split('/').reverse().join('-'); if (!/^\d{4}-\d{2}-\d{2}$/.test(hd || '')) errs.push('Fecha de ingreso no válida (AAAA-MM-DD o DD/MM/AAAA).');
      if (phone && !U.phoneOk(phone)) errs.push('El celular va con código de país (+51…).');
      out.push({ n: k + 1, doc_type: dt, doc_number, full_name: name, position, establishment_id: est && est.id, cost_center_id: ccr && ccr.id, hire_date: hd, phone: phone || null, email: email || null, errs });
    });
    return out;
  }
  function renderImport(el) {
    const body = page(el, { code: 'MAE-10', title: 'Importar trabajadores', sub: 'Carga de un CSV con validación fila por fila, vista previa y reporte de errores antes de grabar.', actions: [{ label: 'Trabajadores', onClick: () => G.go('MAE-01') }] });
    if (!canEmp()) { body.appendChild(notice(`Tu rol (${G.roleName()}) no tiene el permiso mae.employee.manage.`, 'warn')); }
    const ta = h('textarea', { class: 'input mono', style: 'min-height:150px;font-size:.8rem', attrs: { 'aria-label': 'Contenido CSV' } }, impState.csv);
    ta.addEventListener('input', () => { impState.csv = ta.value; });
    const fileIn = h('input', { type: 'file', class: 'input', attrs: { accept: '.csv,text/csv', 'aria-label': 'Archivo CSV' } });
    fileIn.addEventListener('change', () => { const f = fileIn.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { impState.csv = String(rd.result); impState.rows = parseEmployees(impState.csv); G.refresh(); }; rd.readAsText(f); });
    body.appendChild(card('1. Archivo', h('div', { class: 'stack' }, h('p', { class: 'small muted' }, 'Columnas: tipo_doc; numero; nombre; cargo; local (L1/L2); centro_costo; ingreso; celular; correo. El ejemplo trae errores a propósito.'), fileIn, ta, h('div', { class: 'row' }, btn('Validar', () => { impState.rows = parseEmployees(impState.csv); G.refresh(); }, { kind: 'primary' }), btn('Restaurar ejemplo', () => { impState.csv = SAMPLE_CSV; impState.rows = null; G.refresh(); })))));
    if (impState.rows) {
      const ok = impState.rows.filter(r => !r.errs.length);
      body.appendChild(kpis([{ label: 'Filas leídas', value: impState.rows.length }, { label: 'Válidas', value: ok.length, tone: 'ok' }, { label: 'Con errores', value: impState.rows.length - ok.length, tone: impState.rows.length - ok.length ? 'bad' : '' }]));
      body.appendChild(card('2. Vista previa', table({ id: 'mae10', search: false, rows: impState.rows, columns: [
        { key: 'n', label: 'Fila', align: 'r' }, { key: 'doc', label: 'Documento', mono: true, value: r => `${r.doc_type} ${r.doc_number}` }, { key: 'full_name', label: 'Nombre' }, { key: 'position', label: 'Cargo' },
        { key: 'establishment_id', label: 'Local', value: r => r.establishment_id ? G.siteName(r.establishment_id) : '—' }, { key: 'hire_date', label: 'Ingreso', render: r => F.date(r.hire_date) },
        { key: 'errs', label: 'Resultado', render: r => r.errs.length ? h('div', { class: 'small', style: 'color:var(--bad)' }, r.errs.join(' ')) : badge('Lista para grabar', 'ok') }] }), { flush: true, actions: canEmp() && ok.length ? [btn(`Grabar ${ok.length} fila(s) válidas`, () => wrapErr(() => { let n = 0; for (const r of ok) { M.createEmployee(r); n++; } impState.rows = null; toast(`${n} trabajador(es) registrados. Las filas con error no se grabaron.`, 'ok'); G.go('MAE-01'); }), { kind: 'primary', sm: true })] : null }));
    }
  }

  /* =====================================================================
     Registro, indicadores, ganchos y pruebas
     ===================================================================== */
  const SP = G.SPEC.MAE.screens; const nm = c => (SP.find(s => s[0] === c) || [c, c])[1];
  G.register({ code: 'MAE', name: 'Maestros comunes', phase: 0, group: 'Plataforma', screens: [
    { code: 'MAE-01', name: nm('MAE-01'), render: renderEmployees },
    { code: 'MAE-02', name: nm('MAE-02'), render: renderEmployee },
    { code: 'MAE-03', name: nm('MAE-03'), render: renderPaymentMethods },
    { code: 'MAE-04', name: nm('MAE-04'), render: renderFees },
    { code: 'MAE-05', name: nm('MAE-05'), render: renderFx },
    { code: 'MAE-06', name: nm('MAE-06'), render: renderUnits },
    { code: 'MAE-07', name: nm('MAE-07'), render: renderCatalogs },
    { code: 'MAE-08', name: nm('MAE-08'), render: renderUbigeo },
    { code: 'MAE-09', name: nm('MAE-09'), render: renderInstitutions },
    { code: 'MAE-10', name: nm('MAE-10'), render: renderImport },
  ] });

  G.kpiCalc['KPI-MAE-01'] = ({ from, to }) => { let n = 0, d = 0; for (let x = from; x <= to; x = T.add(x, 1)) if (isBusinessDay(x)) { d++; if (M.rateOn(x, 'USD')) n++; } return { value: d ? R(n / d * 100, 1) : 100, numerator: n, denominator: d }; };
  G.kpiCalc['KPI-MAE-02'] = ({ from, to, brand, site, method = 'pm-MP' }) => { const ps = D.where('payments', p => p.status === 'CONFIRMED' && p.payment_method_id === method && String(p.paid_at).slice(0, 10) >= from && String(p.paid_at).slice(0, 10) <= to && (!brand || p.brand_id === brand) && (!site || p.establishment_id === site)); const amt = U.sum(ps, p => p.amount); const fee = R(U.sum(ps, p => M.fee(method, p.paid_at, p.amount).fee)); return { value: amt ? R(fee / amt * 100, 2) : 0, numerator: fee, denominator: R(amt) }; };

  G.searchProviders.push(q => { const s = q.toLowerCase(); return D.all('employees').filter(e => e.full_name.toLowerCase().includes(s) || String(e.doc_number).includes(s)).slice(0, 5).map(e => ({ label: e.full_name, sub: `Trabajador · ${e.position} · ${e.doc_type} ${e.doc_number}`, go: () => G.go('MAE-02', { id: e.id }) })); });
  G.alertProviders.push(() => {
    const out = []; const last = (() => { for (let d = G.TODAY, i = 0; i < 10; i++, d = T.add(d, -1)) if (isBusinessDay(d)) return d; })();
    if (last && !M.rateOn(last)) out.push({ module: 'MAE', title: `Falta el tipo de cambio del ${F.date(last)}`, detail: 'Cárgalo de SUNAT o a mano (RN-MAE-14).', tone: 'warn', go: () => G.go('MAE-05') });
    try { M.fx(G.TODAY); } catch (e) { out.push({ module: 'MAE', title: 'Sin tipo de cambio aplicable hoy', detail: e.message, tone: 'bad', go: () => G.go('MAE-05') }); }
    return out;
  });

  const assert = (c, m) => { if (!c) throw new Error(m); };
  const throwsRule = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return true; throw new Error(`Se esperaba ${code} y salió: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code}`); };
  G.tests.push({ module: 'MAE', name: 'CA-MAE-01: Mercado Pago 3,99 % el 15/10 y 3,49 % el 15/11 sobre S/ 100,00; una tercera vigencia que se cruza con octubre se rechaza (RN-MAE-05)', fn: async () => {
    assert(M.fee('pm-MP', '2026-10-15', 100).fee === 3.99, 'La comisión del 15/10 debe ser S/ 3,99');
    assert(M.fee('pm-MP', '2026-11-15', 100).fee === 3.49, 'La comisión del 15/11 debe ser S/ 3,49');
    throwsRule(() => M.addFee({ payment_method_id: 'pm-MP', valid_from: '2026-10-20', valid_to: '2026-10-25', fee_pct: 2.5 }), 'RN-MAE-05');
  } });
  G.tests.push({ module: 'MAE', name: 'CA-MAE-02: el sábado 10/10 se usa la venta 3,390 del viernes 09/10; el 20/10 sin cargas en 7 días se rechaza (RN-MAE-07)', fn: async () => {
    const f = M.rateOn('2026-10-09'); assert(f && f.buy === 3.38 && f.sell === 3.39, 'Falta el TC del 09/10 (3,380 / 3,390)');
    assert(!M.rateOn('2026-10-10'), 'El sábado no debe tener publicación');
    const r = M.toPen(100, '2026-10-10'); assert(r.rate === 3.39 && r.used_date === '2026-10-09' && r.fallback, 'Debe usar 3,390 del viernes');
    throwsRule(() => M.toPen(100, '2026-10-20'), 'RN-MAE-07');
  } });
  G.tests.push({ module: 'MAE', name: 'CA-MAE-03: 1,250 kg = 1250 g; 500 g = 0,5 kg; 1,5 unidades se rechaza (RN-MAE-10)', fn: async () => {
    assert(M.convert(1.25, 'KGM', 'GRM') === 1250, '1,250 kg deben ser 1250 g');
    assert(M.convert(500, 'GRM', 'KGM') === 0.5, '500 g deben ser 0,5 kg');
    throwsRule(() => M.assertDecimals(1.5, 'NIU'), 'RN-MAE-10');
    throwsRule(() => M.convert(1, 'KGM', 'LTR'), 'RN-MAE-09');
  } });
  G.tests.push({ module: 'MAE', name: 'CA-MAE-04: dar de baja al repartidor Juan desactiva su usuario, cierra su sesión y guarda la fecha de cese de hoy', fn: async () => {
    const prev = G.ctx.role;
    try {
      G.ctx.role = 'ADMINISTRACION';
      const e = M.createEmployee({ doc_type: 'DNI', doc_number: '71234567', full_name: 'Juan Quispe Rojas', position: 'Repartidor (moto)', establishment_id: 'es-L1', cost_center_id: 'cc-DEL', hire_date: '2026-03-02', phone: '+51987001122' });
      const u = D.insert('users', { id: 'us-jquispe-t', employee_id: e.id, name: 'Juan Quispe Rojas', email: 'jquispe@donguando.pe', role: 'REPARTIDOR', brands: [], sites: ['es-L1'], status: 'ACTIVE' }, { silent: true });
      const s = D.insert('user_sessions', { user_id: u.id, device: 'Celular Android (app del repartidor)', status: 'ACTIVE', started_at: G.TODAY + 'T07:30' }, { silent: true });
      const r = M.terminate(e.id, { reason: 'Renuncia voluntaria' });
      assert(D.get('users', u.id).status === 'INACTIVE', 'El usuario debe quedar inactivo');
      assert(D.get('user_sessions', s.id).status === 'REVOKED' && r.sessions === 1, 'La sesión debe cerrarse');
      const e2 = D.get('employees', e.id); assert(e2.terminated_on === G.TODAY && e2.status === 'INACTIVE', 'La ficha debe mostrar la fecha de cese de hoy');
      throwsRule(() => M.assertActiveEmployee(e.id), 'RN-MAE-02');
    } finally { G.ctx.role = prev; }
  } });
  G.tests.push({ module: 'MAE', name: 'CA-MAE-05: la semilla trae 7 medios de pago y Yape, Plin, POS Visa, Mercado Pago y transferencia exigen número de operación', fn: async () => {
    const pms = D.all('payment_methods').filter(p => p.status !== 'INTERNAL'); /* «Saldo a favor» de CAJ es interno, no un medio de cobro */ assert(pms.length === 7, 'Deben ser 7 medios, hay ' + pms.length);
    const need = pms.filter(p => p.requires_reference).map(p => p.system_code).sort().join(','); assert(need === 'MERCADOPAGO,PLIN,POS_VISA,TRANSFER,YAPE', 'Exigen número: ' + need);
    throwsRule(() => M.assertReference('pm-YAPE', ''), 'RN-MAE-04'); assert(M.assertReference('pm-CASH', ''), 'El efectivo no pide número');
  } });
  G.tests.push({ module: 'MAE', name: 'CA-MAE-06: ubigeo con 43 distritos de Lima Metropolitana y 7 del Callao (150140 = Santiago de Surco); la aplicación no lo modifica (RN-MAE-11)', fn: async () => {
    const d = D.where('ubigeo', u => u.level === 'DISTRICT');
    assert(d.filter(u => u.code.startsWith('1501')).length === 43, 'Lima debe tener 43 distritos'); assert(d.filter(u => u.code.startsWith('0701')).length === 7, 'Callao debe tener 7');
    assert((D.find('ubigeo', u => u.code === '150140') || {}).district === 'Santiago de Surco', '150140 debe ser Santiago de Surco');
    const prev = G.ctx.role; try { G.ctx.role = 'ADMIN_SISTEMA'; throwsRule(() => M.updateGlobal('ubigeo', 'ub-150140', { district: 'Surco' }), 'RN-MAE-11'); } finally { G.ctx.role = prev; }
    assert(D.find('ubigeo', u => u.code === '150140').district === 'Santiago de Surco', 'No debe cambiar');
  } });
})();
