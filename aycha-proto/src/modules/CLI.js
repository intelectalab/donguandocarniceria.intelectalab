/* =====================================================================
   CLI · Clientes, direcciones con pin y zonas de reparto (CLI-01 … CLI-12)
   Cliente único para las 5 marcas: celular E.164, documento validado,
   direcciones con pin obligatorio y referencia; la zona y la tarifa salen
   del pin. Duplicados, fusión trazable, bloqueo y consentimiento (Ley 29733).
   Expone G.cli (normalizePhone, findByPhone, quickCreate, saveAddress,
   zoneFor, quote, merge, block, validateDoc…).
   ===================================================================== */
(function () {
  const { h, btn, badge, status, page, card, table, kpis, dl, notice, drawer, form, toast, tabs, pills, confirm } = G.ui;
  const U = G.util, F = G.fmt, D = G.db;
  const R = (n, d = 2) => U.round(n, d);

  const CTYPES = [['PERSON', 'Persona'], ['RESTAURANT', 'Restaurante'], ['BUSINESS', 'Negocio'], ['CONSIGNMENT_POINT', 'Punto de consignación'], ['RELATED', 'Parte relacionada'], ['OTHER', 'Otro']];
  const DOCS = [['DNI', 'DNI'], ['RUC', 'RUC'], ['CE', 'Carné de extranjería'], ['PASSPORT', 'Pasaporte'], ['NONE', 'Sin documento']];
  const PIN_SRC = { MAP: 'Mapa (vendedora)', GPS: 'GPS del cliente', WEB: 'Web', LINK: 'Enlace al cliente', GEOCODE: 'Geocodificación', IMPORT: 'Importación' };
  const PIN_OK = ['MAP', 'GPS', 'WEB', 'LINK'];
  const REASONS = { SAME_PHONE: 'Mismo celular', SAME_DOC: 'Mismo documento', SAME_EMAIL: 'Mismo correo', SIMILAR_NAME_ADDRESS: 'Nombre y dirección parecidos' };
  const DUP_ST = { OPEN: ['Abierto', 'warn'], MERGED: ['Fusionado', 'ok'], DISMISSED: ['Descartado', ''] };
  const LINK_ST = { PENDING: ['Pendiente', 'warn'], USED: ['Usado', 'ok'], EXPIRED: ['Vencido', ''], CANCELLED: ['Anulado', ''] };
  const lab = (arr, v) => (arr.find(x => x[0] === v) || [v, v ?? '—'])[1];
  const cust = id => D.get('customers', id);
  const cname = c => c ? (c.trade_name || c.full_name) : '—';
  const need = (perm, rule) => { if (!G.can(perm)) G.fail(rule, `Tu rol (${G.roleName()}) no tiene el permiso ${perm}.`); };
  const emit = (ev, p) => { if (!G._seeding) G.events.emit(ev, p); };
  const canManage = () => G.can('cli.customer.manage') && (G.canDo('CLI', 'C') || G.canDo('CLI', 'E'));
  const isMerged = c => !!(c && c.merged_into_id);
  const strip = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const addHours = (iso, hrs) => { const d = new Date(String(iso).slice(0, 19) + 'Z'); d.setUTCHours(d.getUTCHours() + Number(hrs)); return d.toISOString().slice(0, 19); };

  /* =====================================================================
     Celular E.164 (RN-CLI-01) y documento (RN-CLI-03, RN-CLI-11)
     ===================================================================== */
  function normalizePhone(raw) {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim(); if (!s) return null;
    const cc = String(G.param('cli_default_country_code') || '+51'); const ccd = cc.replace(/\D/g, '');
    let d = s.replace(/\D/g, '');
    if (s.startsWith('00')) d = d.slice(2);
    if (s.startsWith('+') || s.startsWith('00')) return '+' + d;
    if (d.length === 9 && d[0] === '9') return cc + d;
    if (d.startsWith(ccd) && d.length === ccd.length + 9) return '+' + d;
    return cc + d;
  }
  const phoneValid = p => !!p && (/^\+51\d{9}$/.test(p) || (!p.startsWith('+51') && /^\+\d{8,15}$/.test(p)));
  const fmtPhone = p => p && /^\+51\d{9}$/.test(p) ? `+51\u00a0${p.slice(3, 6)}\u00a0${p.slice(6, 9)}\u00a0${p.slice(9)}` : (p || '—');
  function docError(type, num) {
    const n = String(num || '').trim().toUpperCase();
    if (!type || type === 'NONE') return null;
    if (type === 'DNI' && !/^\d{8}$/.test(n)) return 'RN-CLI-03: el DNI tiene 8 dígitos.';
    if (type === 'RUC' && !/^(10|15|17|20)\d{9}$/.test(n)) return 'RN-CLI-03: el RUC tiene 11 dígitos y empieza con 10, 15, 17 o 20.';
    if (type === 'CE' && !/^[A-Z0-9]{8,12}$/.test(n)) return 'RN-CLI-03: el carné de extranjería tiene de 8 a 12 caracteres.';
    if (type === 'PASSPORT' && !/^[A-Z0-9]{6,12}$/.test(n)) return 'RN-CLI-03: el pasaporte tiene de 6 a 12 caracteres.';
    return null;
  }
  const rucIsValid = ruc => U.rucOk(ruc);
  const activeCustomers = () => D.where('customers', c => !isMerged(c) && c.status !== 'INACTIVE');
  function findByPhone(raw) {
    const p = normalizePhone(raw); if (!p) return null;
    return D.find('customers', c => !isMerged(c) && c.status !== 'INACTIVE' && (c.phone === p || c.phone_alt === p));
  }
  function findByDoc(type, num, exceptId) {
    if (!type || type === 'NONE' || !num) return null;
    return D.find('customers', c => !isMerged(c) && c.id !== exceptId && c.doc_type === type && String(c.doc_number) === String(num).toUpperCase());
  }

  /* =====================================================================
     Duplicados (RN-CLI-07)
     ===================================================================== */
  function detect(c) {
    const out = [];
    const em = strip(c.email);
    for (const o of activeCustomers()) {
      if (o.id === c.id) continue;
      if (c.phone && (o.phone === c.phone || o.phone_alt === c.phone)) out.push([o, 'SAME_PHONE', 0.95]);
      else if (c.phone_alt && (o.phone === c.phone_alt || o.phone_alt === c.phone_alt)) out.push([o, 'SAME_PHONE', 0.9]);
      else if (c.doc_type && c.doc_type !== 'NONE' && c.doc_number && o.doc_type === c.doc_type && o.doc_number === c.doc_number) out.push([o, 'SAME_DOC', 1]);
      else if (em && strip(o.email) === em) out.push([o, 'SAME_EMAIL', 0.85]);
    }
    return out;
  }
  function registerDuplicate(customer_id, duplicate_of_id, reason, score) {
    const ex = D.find('customer_duplicate_candidates', x => (x.customer_id === customer_id && x.duplicate_of_id === duplicate_of_id) || (x.customer_id === duplicate_of_id && x.duplicate_of_id === customer_id));
    if (ex) return ex;
    return D.insert('customer_duplicate_candidates', { customer_id, duplicate_of_id, match_reason: reason, score, status: 'OPEN', resolved_by: null, resolved_at: null }, { silent: G._seeding });
  }
  /** revisa toda la base: mismo celular, documento, correo o nombre + zona */
  function scanDuplicates() {
    const cs = activeCustomers().filter(c => c.id !== 'cu-VARIOS');
    const by = {}; const add = (k, c) => { if (!k) return; (by[k] = by[k] || []).push(c); };
    const defZone = new Map(D.where('customer_addresses', a => a.is_default && a.status === 'ACTIVE').map(a => [a.customer_id, a.zone_id]));
    for (const c of cs) { add('P' + c.phone, c); if (c.phone_alt) add('P' + c.phone_alt, c); if (c.doc_number && c.doc_type !== 'NONE') add('D' + c.doc_type + c.doc_number, c); if (c.email) add('E' + strip(c.email), c); add('N' + strip(c.full_name) + '|' + (defZone.get(c.id) || ''), c); }
    let n = 0;
    for (const [k, list] of Object.entries(by)) {
      const uniq = [...new Map(list.map(c => [c.id, c])).values()]; if (uniq.length < 2 || k === 'Pnull' || k === 'Pundefined') continue;
      const reason = { P: 'SAME_PHONE', D: 'SAME_DOC', E: 'SAME_EMAIL', N: 'SIMILAR_NAME_ADDRESS' }[k[0]];
      const score = { SAME_PHONE: 0.95, SAME_DOC: 1, SAME_EMAIL: 0.85, SIMILAR_NAME_ADDRESS: 0.6 }[reason];
      uniq.sort(U.by('created_at'));
      for (let i = 1; i < uniq.length; i++) { const before = D.all('customer_duplicate_candidates').length; registerDuplicate(uniq[i].id, uniq[0].id, reason, score); if (D.all('customer_duplicate_candidates').length > before) n++; }
    }
    return n;
  }

  /* =====================================================================
     Alta y edición de clientes
     ===================================================================== */
  function create(d, opts = {}) {
    G.assertMod('CLI'); if (!opts.system) need('cli.customer.manage', 'RN-CLI-01');
    const full_name = String(d.full_name || '').trim();
    if (!full_name) G.fail('RN-CLI-11', 'Escribe el nombre del cliente.');
    const phone = normalizePhone(d.phone), phone_alt = normalizePhone(d.phone_alt);
    if (d.phone && !phoneValid(phone)) G.fail('RN-CLI-01', `El celular «${d.phone}» no es válido: para Perú son 9 dígitos (se guarda como +51XXXXXXXXX).`);
    if (d.phone_alt && !phoneValid(phone_alt)) G.fail('RN-CLI-01', `El celular alterno «${d.phone_alt}» no es válido.`);
    const doc_type = d.doc_type || 'NONE'; const doc_number = doc_type === 'NONE' ? null : String(d.doc_number || '').trim().toUpperCase();
    const de = docError(doc_type, doc_number); if (de) G.fail('RN-CLI-03', de.replace(/^RN-CLI-03: /, ''));
    const same = findByDoc(doc_type, doc_number); if (same) G.fail('RN-CLI-11', `Ya existe ${cname(same)} con ${doc_type} ${doc_number}: un cliente es único por tipo y número de documento.`);
    if (!phone && doc_type === 'NONE') G.fail('RN-CLI-11', 'Sin documento, el celular es el identificador del cliente: escríbelo.');
    const c = D.insert('customers', { doc_type, doc_number, full_name, trade_name: d.trade_name || null, phone, phone_alt, email: d.email ? String(d.email).trim().toLowerCase() : null, customer_type: d.customer_type || 'PERSON', source_channel: d.source_channel || 'WHATSAPP', origin_wa_number: d.origin_wa_number || null,
      marketing_opt_in: !!d.marketing_opt_in, marketing_opt_in_at: d.marketing_opt_in ? G.date.now() : null, status: 'ACTIVE', seller_user_id: d.seller_user_id !== undefined ? d.seller_user_id : (G.ctx.role === 'VENDEDORA' ? G.ctx.userId() : null), first_order_at: null, last_order_at: null, orders_count: 0, segment_brands: [],
      doc_validated_at: null, doc_validation_source: null, merged_into_id: null, blocked_reason: null, created_by: G.ctx.userName() }, { silent: !!opts.silent });
    const dups = detect(c).map(([o, reason, score]) => registerDuplicate(c.id, o.id, reason, score));
    emit('customer.created', { customer_id: c.id, phone: c.phone, duplicates: dups.length });
    return { customer: c, duplicates: dups };
  }
  /** alta rápida desde el pedido o el chat: si el celular existe, devuelve ese cliente (CA-CLI-01) */
  function quickCreate(d) {
    const ex = findByPhone(d.phone);
    if (ex) return { customer: ex, existing: true, duplicates: [] };
    const r = create(d);
    return Object.assign(r, { existing: false });
  }
  function updateCustomer(id, d) {
    G.assertMod('CLI'); need('cli.customer.manage', 'RN-CLI-01');
    const c = cust(id); if (isMerged(c)) G.fail('RN-CLI-08', `${cname(c)} fue fusionado en ${G.custName(c.merged_into_id)}: edita el sobreviviente.`);
    const phone = normalizePhone(d.phone), phone_alt = normalizePhone(d.phone_alt);
    if (d.phone && !phoneValid(phone)) G.fail('RN-CLI-01', `El celular «${d.phone}» no es válido: para Perú son 9 dígitos.`);
    if (d.phone_alt && !phoneValid(phone_alt)) G.fail('RN-CLI-01', `El celular alterno «${d.phone_alt}» no es válido.`);
    const doc_type = d.doc_type || 'NONE'; const doc_number = doc_type === 'NONE' ? null : String(d.doc_number || '').trim().toUpperCase();
    const de = docError(doc_type, doc_number); if (de) G.fail('RN-CLI-03', de.replace(/^RN-CLI-03: /, ''));
    const same = findByDoc(doc_type, doc_number, id); if (same) G.fail('RN-CLI-11', `Ya existe ${cname(same)} con ${doc_type} ${doc_number}.`);
    const docChanged = doc_type !== c.doc_type || doc_number !== c.doc_number;
    const patch = { full_name: d.full_name, trade_name: d.trade_name || null, customer_type: d.customer_type, phone, phone_alt, email: d.email ? String(d.email).trim().toLowerCase() : null, doc_type, doc_number, seller_user_id: d.seller_user_id || null, notes: d.notes || null };
    if (docChanged) Object.assign(patch, { doc_validated_at: null, doc_validation_source: null });
    D.update('customers', id, patch);
    if (phone !== c.phone || phone_alt !== c.phone_alt || patch.email !== c.email) for (const [o, reason, score] of detect(cust(id))) registerDuplicate(id, o.id, reason, score);
    return cust(id);
  }

  /* =====================================================================
     Validación de documento con el proveedor (adaptador falso, D-CLI-01)
     ===================================================================== */
  const FAKE_FN = ['Rosa', 'Juan', 'María', 'Carlos', 'Lucía', 'Pedro', 'Elena', 'Víctor'], FAKE_LN = ['Huamán', 'Quispe', 'Torres', 'Salazar', 'Paredes', 'Rojas', 'Mendoza', 'Cárdenas'];
  function lookupDoc(type, number) {
    const n = String(number || '').trim().toUpperCase();
    const e = docError(type, n); if (e) return { ok: false, error: e };
    const known = D.find('customers', c => c.doc_type === type && c.doc_number === n);
    const k = n.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
    if (type === 'DNI') return { ok: true, source: 'RENIEC', name: known ? known.full_name : `${FAKE_FN[k % 8]} ${FAKE_LN[(k >> 1) % 8]} ${FAKE_LN[(k >> 2) % 8]}`, state: 'VIGENTE', checked_at: G.date.now() };
    if (type === 'RUC') {
      if (!rucIsValid(n)) return { ok: false, error: 'RN-CLI-03: el dígito verificador del RUC no es válido (módulo 11). Revisa el número con el cliente.' };
      const noHab = n.endsWith('7') && !known;
      return { ok: true, source: 'SUNAT', name: known ? known.full_name : `EMPRESA ${n.slice(2, 6)} ${n.startsWith('10') ? 'PERSONA NATURAL' : 'SAC'}`, state: 'ACTIVO', condition: noHab ? 'NO HABIDO' : 'HABIDO', fiscal_address: known && known.fiscal_address ? known.fiscal_address : `Av. Principal ${100 + (k % 900)}, Lima`, checked_at: G.date.now() };
    }
    return { ok: false, error: 'El proveedor solo consulta DNI y RUC: usa la validación manual.' };
  }
  function validateDoc(customer_id, { doc_type, doc_number, manual, note }) {
    G.assertMod('CLI');
    const c = cust(customer_id); if (!c) G.fail('RN-CLI-12', 'Elige el cliente.');
    const n = String(doc_number || '').trim().toUpperCase();
    const e = docError(doc_type, n); if (e) G.fail('RN-CLI-03', e.replace(/^RN-CLI-03: /, ''));
    const same = findByDoc(doc_type, n, customer_id); if (same) G.fail('RN-CLI-11', `${doc_type} ${n} ya pertenece a ${cname(same)}: si es la misma persona, fusiónalos (CLI-11).`);
    let res;
    if (manual) { need('cli.customer.validate_manual', 'RN-CLI-12'); if (!note) G.fail('RN-CLI-12', 'La validación manual exige una nota (qué documento se vio).'); res = { ok: true, source: 'MANUAL', name: c.full_name, state: 'VALIDADO A MANO' }; }
    else { res = lookupDoc(doc_type, n); if (!res.ok) G.fail('RN-CLI-03', res.error.replace(/^RN-CLI-03: /, '')); }
    const patch = { doc_type, doc_number: n, doc_validated_at: G.date.now(), doc_validation_source: res.source, doc_validation_state: res.condition ? `${res.state} · ${res.condition}` : res.state };
    if (doc_type === 'RUC' && res.source === 'SUNAT') Object.assign(patch, { full_name: res.name, fiscal_address: res.fiscal_address, taxpayer_condition: res.condition });
    D.update('customers', customer_id, patch);
    G.audit('CONSULTA_DOCUMENTO', 'customers', customer_id, `${doc_type} ${n} · fuente ${res.source} · ${res.state}${res.condition ? ' · ' + res.condition : ''}${note ? ' · ' + note : ''} (Ley 29733)`);
    return res;
  }

  /* =====================================================================
     Zonas (RN-CLI-06), pin (RN-CLI-04/05) y direcciones (RN-CLI-02/10)
     ===================================================================== */
  const inPeru = (lat, lng) => lat != null && lng != null && !(Number(lat) === 0 && Number(lng) === 0) && lat >= -18.4 && lat <= -0.03 && lng >= -81.4 && lng <= -68.6;
  function zoneMatch(lat, lng, district) {
    const zs = D.where('delivery_zones', z => z.status === 'ACTIVE' && !z.province && z.polygon && z.polygon.length >= 3);
    if (lat != null && lng != null) { const hit = zs.filter(z => G.geo.inPoly(Number(lat), Number(lng), z.polygon)).sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))[0]; if (hit) return { zone: hit, by: 'POLYGON' }; }
    if (district) { const d = strip(district); const z = D.where('delivery_zones', z => z.status === 'ACTIVE' && (z.districts || []).some(x => strip(x) === d)).sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))[0]; if (z) return { zone: z, by: 'DISTRICT' }; }
    return { zone: null, by: null };
  }
  const zoneFor = (lat, lng, district) => zoneMatch(lat, lng, district).zone;
  const districtsAll = () => [...new Set(D.all('delivery_zones').flatMap(z => z.districts || []))].sort();
  function saveAddress(customer_id, vals, existing, opts = {}) {
    G.assertMod('CLI'); if (!opts.fromLink) need('cli.customer.manage', 'RN-CLI-02');
    const c = cust(customer_id); if (!c) G.fail('RN-CLI-02', 'Elige el cliente.');
    if (isMerged(c)) G.fail('RN-CLI-08', `${cname(c)} fue fusionado: agrega la dirección al sobreviviente.`);
    const minRef = Number(G.param('cli_min_reference_chars') ?? 10), minConf = Number(G.param('cli_min_geocode_confidence') ?? 0.8);
    const line = String(vals.address_line || '').trim(), ref = String(vals.reference || '').trim(), district = String(vals.district || '').trim();
    if (!line) G.fail('RN-CLI-02', 'Escribe la línea de dirección (calle y número).');
    if (!district) G.fail('RN-CLI-02', 'Indica el distrito.');
    if (ref.length < minRef) G.fail('RN-CLI-02', `La referencia «${ref}» tiene ${ref.length} caracteres; el mínimo es ${minRef} (por ejemplo «Frente al parque»).`);
    if (vals.lat === null || vals.lat === undefined || vals.lat === '' || vals.lng === null || vals.lng === undefined || vals.lng === '') G.fail('RN-CLI-02', 'Marca el pin en el mapa: sin pin la dirección no se guarda.');
    const lat = Number(vals.lat), lng = Number(vals.lng);
    if (!inPeru(lat, lng)) G.fail('RN-CLI-04', `El pin (${F.num(lat, 4)}, ${F.num(lng, 4)}) está fuera del Perú: muévelo a la dirección real.`);
    let src = vals.pin_source || 'MAP'; let conf = vals.geocode_confidence != null && vals.geocode_confidence !== '' ? Number(vals.geocode_confidence) : (src === 'GEOCODE' ? 0.5 : 1);
    if (src === 'GEOCODE' && vals.pin_confirmed) { src = 'MAP'; conf = 1; }
    if (src === 'GEOCODE' && conf < minConf) G.fail('RN-CLI-05', `El pin salió de la geocodificación con confianza ${F.num(conf, 2)} (mínimo ${F.num(minConf, 2)}): muévelo en el mapa para confirmarlo o envía el enlace al cliente.`);
    const zm = zoneMatch(lat, lng, district);
    const own = D.where('customer_addresses', a => a.customer_id === customer_id && a.status === 'ACTIVE' && (!existing || a.id !== existing.id));
    const isDefault = !!vals.is_default || !own.length;
    const row = { customer_id, label: vals.label || 'Casa', address_line: line, district, reference: ref, lat: R(lat, 6), lng: R(lng, 6), zone_id: zm.zone ? zm.zone.id : null, zone_by: zm.by, out_of_coverage: !zm.zone, contact_name: vals.contact_name || cname(c), contact_phone: normalizePhone(vals.contact_phone) || c.phone, is_default: isDefault, status: 'ACTIVE', pin_source: src, geocode_confidence: conf, ubigeo: vals.ubigeo || (existing && existing.ubigeo) || null };
    if (row.contact_phone && !phoneValid(row.contact_phone)) G.fail('RN-CLI-01', 'El celular de quien recibe no es válido.');
    if (isDefault) for (const a of own.filter(a => a.is_default)) D.update('customer_addresses', a.id, { is_default: false }, { silent: true }); // RN-CLI-10
    const a = existing ? D.update('customer_addresses', existing.id, row) : D.insert('customer_addresses', row);
    return { address: a, zone: zm.zone, by: zm.by };
  }
  function setDefaultAddress(addrId) {
    need('cli.customer.manage', 'RN-CLI-10');
    const a = D.get('customer_addresses', addrId);
    for (const x of D.where('customer_addresses', x => x.customer_id === a.customer_id && x.is_default && x.id !== addrId)) D.update('customer_addresses', x.id, { is_default: false }, { silent: true });
    D.update('customer_addresses', addrId, { is_default: true });
  }
  /** geocodificación (MapsProvider falso): distrito y calle → pin aproximado con confianza */
  function geocode(text) {
    const t = strip(text); if (!t) return null;
    const z = D.all('delivery_zones').filter(z => !z.province).find(z => (z.districts || []).some(d => t.includes(strip(d))) || t.includes(strip(z.name).split(' (')[0]));
    if (!z) return null;
    const k = t.split('').reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 100003, 7);
    const hasNum = /\d{2,4}/.test(t);
    return { lat: R(z.lat + ((k % 100) / 100 - 0.5) * 0.016, 6), lng: R(z.lng + (((k >> 3) % 100) / 100 - 0.5) * 0.016, 6), confidence: hasNum ? 0.82 : 0.6, district: (z.districts || [])[0] || z.name };
  }

  /* ---------- tarifa de delivery (CA-CLI-03, RN-PED-09) ---------- */
  function quote({ lat, lng, district, zone_id, lines = [], channel = 'WEB' } = {}) {
    const zm = zone_id ? { zone: D.get('delivery_zones', zone_id), by: 'ZONE' } : zoneMatch(lat, lng, district);
    let units = 0, kg = 0, amount = 0;
    for (const l of lines) {
      const v = G.variant(l.variant_id); if (!v) continue; const q = Number(l.qty) || 0;
      const pr = G.price.of(v.id, { brand_id: v.brand_id, channel });
      if (v.sale_mode === 'UNIT_VARIABLE_WEIGHT') { units += q; kg += q * v.nominal_weight_kg; amount += pr ? q * v.nominal_weight_kg * pr.price : 0; }
      else if (v.sale_mode === 'KG') { kg += q; amount += pr ? q * pr.price : 0; }
      else { units += q; amount += pr ? q * pr.price : 0; }
    }
    kg = R(kg, 3); amount = R(amount);
    const z = zm.zone;
    if (!z) return { zone: null, by: null, units, kg, amount, fee: null, free: false, covered: false, reason: 'RN-CLI-06: fuera de cobertura. El pedido de delivery solo se confirma como envío a provincia o recojo en local.' };
    const fee = G.orders.deliveryFee({ fulfillment: z.province ? 'PROVINCE_SHIPPING' : 'DELIVERY', zone_id: z.id }, { units, kg, amount });
    const why = fee === 0 ? (z.free_from_units && units >= z.free_from_units ? `Gratis desde ${z.free_from_units} unidades (lleva ${F.num(units)})` : z.free_from_kg && kg >= z.free_from_kg ? `Gratis desde ${F.num(z.free_from_kg)} kg (lleva ${F.num(kg, 3)} kg)` : `Gratis desde ${F.money(z.free_from_amount)}`) : `Tarifa de ${z.name}: no llega a ${z.free_from_units ? z.free_from_units + ' unidades' : ''}${z.free_from_units && z.free_from_kg ? ' ni ' : ''}${z.free_from_kg ? F.num(z.free_from_kg) + ' kg' : ''}`;
    return { zone: z, by: zm.by, units, kg, amount, fee, free: fee === 0, covered: true, below_min: z.min_order_amount ? amount < z.min_order_amount : false, reason: why };
  }

  /* =====================================================================
     Bloqueo (RN-CLI-09), consentimiento (RN-CLI-13), fusión (RN-CLI-08)
     ===================================================================== */
  function block(id, reason) {
    G.assertMod('CLI'); need('cli.customer.block', 'RN-CLI-09');
    if (!String(reason || '').trim()) G.fail('RN-CLI-09', 'Bloquear un cliente exige motivo (fraude, deuda, maltrato…).');
    const c = cust(id); if (isMerged(c)) G.fail('RN-CLI-08', 'Un cliente fusionado no se bloquea: actúa sobre el sobreviviente.');
    D.update('customers', id, { status: 'BLOCKED', blocked_reason: reason, blocked_at: G.date.now(), blocked_by: G.ctx.userName() });
  }
  function unblock(id, note) {
    G.assertMod('CLI'); need('cli.customer.block', 'RN-CLI-09');
    const c = cust(id); if (isMerged(c)) G.fail('RN-CLI-08', `${cname(c)} fue fusionado en ${G.custName(c.merged_into_id)}: no puede volver a activarse.`);
    D.update('customers', id, { status: 'ACTIVE', blocked_reason: null, unblocked_at: G.date.now(), unblocked_note: note || null });
  }
  function setConsent(id, granted, { channel = 'WHATSAPP', evidence } = {}) {
    G.assertMod('CLI'); need('cli.customer.manage', 'RN-CLI-13');
    const c = cust(id);
    D.update('customers', id, { marketing_opt_in: !!granted, marketing_opt_in_at: G.date.now(), marketing_opt_in_source: channel });
    D.insert('contact_consents', { customer_id: id, contact_id: null, purpose: 'MARKETING', granted: !!granted, channel, evidence_text: evidence || (granted ? 'Aceptó recibir promociones' : 'Pidió no recibir promociones'), recorded_at: G.date.now(), recorded_by: G.ctx.userName() });
    if (!granted && c.marketing_opt_in) emit('consent.opted_out', { customer_id: id, channel });
  }
  /** lo que se moverá al fusionar (sin cambiar nada) */
  const SKIP = new Set(['customers', 'customer_duplicate_candidates', 'customer_merges', 'audit', 'domain_events', 'notifications']);
  const TABLE_NAMES = { sales_orders: 'Pedidos', customer_addresses: 'Direcciones', sales_documents: 'Comprobantes', payments: 'Cobros', conversations: 'Conversaciones', customer_balance_movements: 'Movimientos de saldo', messages: 'Mensajes', contact_consents: 'Consentimientos', customer_location_links: 'Enlaces de ubicación', customer_prices: 'Precios especiales', channel_contacts: 'Contactos de canal', leads: 'Prospectos', crm_tasks: 'Tareas de CRM' };
  function mergePreview(mergedId) {
    const out = {};
    for (const [t, rows] of Object.entries(D.t)) { if (SKIP.has(t)) continue; let n = 0; for (const r of rows) { if (r.tenant && r.tenant !== G.ctx.tenant) continue; if (r.customer_id === mergedId || r.billing_customer_id === mergedId) n++; } if (n) out[t] = n; }
    return { counts: out, balance: creditBalance(mergedId), receivable: receivables(mergedId).total };
  }
  function merge(survivorId, mergedId, reason) {
    G.assertMod('CLI'); need('cli.customer.merge', 'RN-CLI-08');
    if (!String(reason || '').trim()) G.fail('RN-CLI-08', 'La fusión exige motivo (queda en la auditoría y no se deshace).');
    if (survivorId === mergedId) G.fail('RN-CLI-08', 'Elige dos clientes distintos.');
    const s = cust(survivorId), m = cust(mergedId);
    if (!s || !m) G.fail('RN-CLI-08', 'Cliente no encontrado.');
    if (isMerged(m)) G.fail('RN-CLI-08', `${cname(m)} ya fue fusionado en ${G.custName(m.merged_into_id)}.`);
    if (isMerged(s)) G.fail('RN-CLI-08', `${cname(s)} ya fue fusionado: no puede ser el sobreviviente.`);
    const pv = mergePreview(mergedId);
    const moved = {};
    const survivorDefault = D.find('customer_addresses', a => a.customer_id === survivorId && a.is_default && a.status === 'ACTIVE');
    for (const [t, rows] of Object.entries(D.t)) {
      if (SKIP.has(t)) continue;
      for (const r of rows) {
        if (r.tenant && r.tenant !== G.ctx.tenant) continue;
        let hit = false;
        if (r.customer_id === mergedId) { r.customer_id = survivorId; hit = true; }
        if (r.billing_customer_id === mergedId) { r.billing_customer_id = survivorId; hit = true; }
        if (hit) { moved[t] = (moved[t] || 0) + 1; if (t === 'customer_addresses' && survivorDefault) r.is_default = false; }
      }
    }
    const brands = new Set([...(s.segment_brands || []), ...(m.segment_brands || [])]);
    const first = [s.first_order_at, m.first_order_at].filter(Boolean).sort()[0] || null, last = [s.last_order_at, m.last_order_at].filter(Boolean).sort().pop() || null;
    D.update('customers', survivorId, { email: s.email || m.email, phone_alt: s.phone_alt || (m.phone && m.phone !== s.phone ? m.phone : m.phone_alt) || null, doc_type: s.doc_type !== 'NONE' && s.doc_number ? s.doc_type : m.doc_type, doc_number: s.doc_type !== 'NONE' && s.doc_number ? s.doc_number : m.doc_number,
      doc_validated_at: s.doc_validated_at || m.doc_validated_at || null, doc_validation_source: s.doc_validation_source || m.doc_validation_source || null, segment_brands: [...brands], orders_count: (s.orders_count || 0) + (m.orders_count || 0), first_order_at: first, last_order_at: last }, { silent: true });
    D.update('customers', mergedId, { status: 'INACTIVE', merged_into_id: survivorId, merged_at: G.date.now(), phone: m.phone, notes: `Fusionado en ${cname(s)}: ${reason}` });
    for (const x of D.where('customer_duplicate_candidates', x => x.status === 'OPEN' && (x.customer_id === mergedId || x.duplicate_of_id === mergedId))) D.update('customer_duplicate_candidates', x.id, { status: (x.customer_id === survivorId || x.duplicate_of_id === survivorId) ? 'MERGED' : 'DISMISSED', resolved_by: G.ctx.userId(), resolved_at: G.date.now(), resolution_note: (x.customer_id === survivorId || x.duplicate_of_id === survivorId) ? reason : `El cliente ${cname(m)} se fusionó en ${cname(s)}` }, { silent: true });
    const row = D.insert('customer_merges', { survivor_id: survivorId, merged_id: mergedId, moved_counts: Object.assign({}, moved, { balance: pv.balance }), reason, merged_at: G.date.now(), merged_by: G.ctx.userName(), survivor_name: cname(s), merged_name: cname(m) });
    G.audit('FUSIONAR', 'customers', survivorId, `${cname(m)} (${mergedId}) → ${cname(s)} · ${Object.entries(moved).map(([t, n]) => `${TABLE_NAMES[t] || t}: ${n}`).join(', ')} · ${reason}`);
    D.touch();
    emit('customer.merged', { survivor_id: survivorId, merged_id: mergedId, moved });
    return row;
  }
  function dismissDuplicate(candId, note) {
    need('cli.customer.merge', 'RN-CLI-07');
    if (!String(note || '').trim()) G.fail('RN-CLI-07', 'Escribe por qué no es duplicado (por ejemplo: «esposos con el mismo celular»).');
    D.update('customer_duplicate_candidates', candId, { status: 'DISMISSED', resolved_by: G.ctx.userId(), resolved_at: G.date.now(), resolution_note: note });
  }

  /* ---------- saldo a favor (CAJ) y cuentas por cobrar ---------- */
  /** pagado por pedido según los cobros confirmados (allocations), con respaldo en paid_amount */
  function paidByOrder(cid) {
    const m = {};
    for (const p of D.where('payments', p => p.customer_id === cid && p.status === 'CONFIRMED')) for (const a of p.allocations || []) if (a.order_id) m[a.order_id] = (m[a.order_id] || 0) + (Number(a.amount) || 0);
    return m;
  }
  const paidOf = (o, m) => Math.max(o.paid_amount || 0, m[o.id] || 0);
  function creditBalance(cid) {
    const mv = D.where('customer_balance_movements', m => m.customer_id === cid);
    if (mv.length) return R(U.sum(mv, m => m.amount));
    const pm = paidByOrder(cid);
    return R(U.sum(D.where('sales_orders', o => o.customer_id === cid && ['DELIVERED', 'CLOSED'].includes(o.status) && o.final_total != null), o => Math.max(0, paidOf(o, pm) - o.final_total)));
  }
  function receivables(cid) {
    const docs = D.where('sales_documents', d => d.customer_id === cid && (d.balance || 0) > 0.005 && d.status !== 'VOIDED' && d.doc_type !== 'CREDIT_NOTE');
    const docOrders = new Set(docs.map(d => d.order_id));
    const pm = paidByOrder(cid);
    const ords = D.where('sales_orders', o => o.customer_id === cid && ['DELIVERED', 'CLOSED'].includes(o.status) && o.payment_method_id !== 'pm-CREDIT' && !docOrders.has(o.id) && (o.final_total ?? o.estimated_total) - paidOf(o, pm) > 0.5).map(o => Object.assign(Object.create(o), { _due: R((o.final_total ?? o.estimated_total) - paidOf(o, pm)) }));
    return { docs, orders: ords, total: R(U.sum(docs, d => d.balance) + U.sum(ords, o => o._due)) };
  }

  /* ---------- enlace de ubicación para el cliente (CLI-07) ---------- */
  function linkStatus(l) { return l.status === 'PENDING' && l.expires_at < G.date.now().slice(0, 19) ? 'EXPIRED' : l.status; }
  function createLink(customer_id, { send = true } = {}) {
    G.assertMod('CLI'); need('cli.customer.manage', 'RN-CLI-05');
    const c = cust(customer_id); if (!c) G.fail('RN-CLI-05', 'Elige el cliente.');
    if (!c.phone) G.fail('RN-CLI-01', 'El cliente no tiene celular para enviarle el enlace.');
    for (const l of D.where('customer_location_links', l => l.customer_id === customer_id && linkStatus(l) === 'PENDING')) D.update('customer_location_links', l.id, { status: 'CANCELLED' }, { silent: true }); // un solo enlace vivo
    const token = U.token(10);
    const hrs = Number(G.param('cli_location_link_hours') ?? 24);
    const l = D.insert('customer_location_links', { customer_id, token, url: `https://donguando.aycha.pe/u/${token}`, expires_at: addHours(G.date.now(), hrs), status: 'PENDING', created_by: G.ctx.userName(), sent_via: send ? 'WHATSAPP' : null, phone: c.phone });
    if (send && G.msg) { const m = G.msg.send({ customer_id, kind: 'UTILITY', template: 'ubicacion_entrega', text: `Hola ${c.full_name.split(' ')[0]}, marca en el mapa dónde recibes tu pedido y escribe una referencia: ${l.url} (vence en ${hrs} h).`, ref: l.id, inServiceWindow: true }); D.update('customer_location_links', l.id, { message_id: m.id }, { silent: true }); }
    return l;
  }
  function completeLink(linkId, vals) {
    const l = D.get('customer_location_links', linkId);
    if (!l) G.fail('RN-CLI-05', 'Enlace no encontrado.');
    const st = linkStatus(l);
    if (st === 'EXPIRED') G.fail('RN-CLI-05', `El enlace venció el ${F.datetime(l.expires_at)} (vigencia cli_location_link_hours): genera uno nuevo.`);
    if (st !== 'PENDING') G.fail('RN-CLI-05', 'El enlace ya fue usado o anulado: es de un solo uso.');
    const r = saveAddress(l.customer_id, Object.assign({ label: 'Enviada por el cliente', pin_source: 'LINK', geocode_confidence: 1 }, vals), null, { fromLink: true });
    D.update('customer_location_links', linkId, { status: 'USED', used_at: G.date.now(), address_id: r.address.id });
    G.notify({ role: 'VENDEDORA', title: `Ubicación recibida de ${G.custName(l.customer_id)}`, body: `${r.address.address_line} · ${r.zone ? r.zone.name : 'fuera de cobertura'}`, module: 'CLI', tone: 'ok' });
    return r;
  }

  /* ---------- importación (CLI-12) ---------- */
  function previewImport(text) {
    const rows = []; const seen = {};
    String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach((ln, i) => {
      if (i === 0 && /nombre/i.test(ln)) return;
      const [full_name, phoneRaw, email, doc, district] = ln.split(/[;\t]/).map(s => (s || '').trim());
      const phone = normalizePhone(phoneRaw);
      const r = { line: i + 1, full_name, phone_raw: phoneRaw, phone, email: email || null, doc: doc || null, doc_type: /^\d{8}$/.test(doc || '') ? 'DNI' : /^\d{11}$/.test(doc || '') ? 'RUC' : 'NONE', district: district || null, error: null, dup: null, action: 'CREATE' };
      if (!full_name) r.error = 'Falta el nombre';
      else if (!phone || !phoneValid(phone)) r.error = `RN-CLI-01: celular «${phoneRaw}» no válido`;
      else if (r.doc && docError(r.doc_type === 'NONE' ? 'DNI' : r.doc_type, r.doc)) r.error = docError(r.doc_type === 'NONE' ? 'DNI' : r.doc_type, r.doc);
      if (!r.error) {
        const ex = findByPhone(phone) || findByDoc(r.doc_type, r.doc) || (email && D.find('customers', c => !isMerged(c) && strip(c.email) === strip(email)));
        if (ex) { r.dup = ex; r.dup_reason = ex.phone === phone || ex.phone_alt === phone ? 'SAME_PHONE' : ex.doc_number === r.doc ? 'SAME_DOC' : 'SAME_EMAIL'; r.action = r.dup_reason === 'SAME_DOC' ? 'SKIP' : 'SKIP'; }
        else if (seen[phone]) { r.dup_in_file = seen[phone]; r.action = 'SKIP'; }
        seen[phone] = seen[phone] || r.line;
      }
      rows.push(r);
    });
    return rows;
  }
  function runImport(rows, source = 'IMPORT') {
    need('cli.customer.manage', 'RN-CLI-07');
    const res = { created: 0, skipped: 0, flagged: 0 };
    for (const r of rows) {
      if (r.error || r.action === 'SKIP') { res.skipped++; continue; }
      if (r.dup && r.dup_reason === 'SAME_DOC') { res.skipped++; continue; } // RN-CLI-11
      const out = create({ full_name: r.full_name, phone: r.phone, email: r.email, doc_type: r.doc ? r.doc_type : 'NONE', doc_number: r.doc, customer_type: r.doc_type === 'RUC' ? 'BUSINESS' : 'PERSON', source_channel: source, marketing_opt_in: false, seller_user_id: null });
      out.customer.import_district = r.district;
      res.created++; if (out.duplicates.length) res.flagged++;
    }
    return res;
  }

  /* =====================================================================
     KPI
     ===================================================================== */
  G.kpiCalc['KPI-CLI-01'] = p => {
    const first = {};
    for (const o of D.all('sales_orders')) { if (!o.confirmed_at || o.status === 'CANCELLED' || o.customer_id === 'cu-VARIOS') continue; if (p.brand && o.brand_id !== p.brand) continue; if (p.site && o.establishment_id !== p.site) continue; const d = o.confirmed_at.slice(0, 10); if (!first[o.customer_id] || d < first[o.customer_id]) first[o.customer_id] = d; }
    return Object.values(first).filter(d => d >= (p.from || '0000') && d <= (p.to || '9999')).length;
  };
  G.kpiCalc['KPI-CLI-02'] = p => { const g = U.groupBy(G.sales.orders(p).filter(o => o.customer_id !== 'cu-VARIOS'), 'customer_id'); const all = Object.keys(g).length; const rec = Object.values(g).filter(x => x.length >= 2).length; return { value: all ? R(rec / all * 100, 1) : 0, numerator: rec, denominator: all }; };
  G.kpiCalc['KPI-CLI-03'] = () => D.where('customer_duplicate_candidates', x => x.status === 'OPEN').length;
  G.kpiCalc['KPI-CLI-04'] = p => {
    const ids = new Set(D.where('sales_orders', o => o.address_id && o.status !== 'CANCELLED' && o.created_at.slice(0, 10) >= (p.from || '0000') && o.created_at.slice(0, 10) <= (p.to || '9999') && (!p.brand || o.brand_id === p.brand) && (!p.site || o.establishment_id === p.site)).map(o => o.address_id));
    let ok = 0; for (const id of ids) { const a = D.get('customer_addresses', id); if (a && PIN_OK.includes(a.pin_source)) ok++; }
    return { value: ids.size ? R(ok / ids.size * 100, 1) : 0, numerator: ok, denominator: ids.size };
  };

  /* ---------- pedidos de clientes bloqueados o fusionados (RN-CLI-09, RN-CLI-08) ---------- */
  const coreTransition = G.orders.transition;
  G.orders.transition = function (o, to, opts) {
    const ord = typeof o === 'string' ? D.get('sales_orders', o) : o;
    if (ord && to === 'CONFIRMED' && ord.status === 'DRAFT') {
      const c = cust(ord.customer_id);
      if (c && c.status === 'BLOCKED') G.fail('RN-CLI-09', `${cname(c)} está bloqueado (${c.blocked_reason || 'sin motivo'}): no se le confirman pedidos nuevos.`);
      if (isMerged(c)) G.fail('RN-CLI-08', `${cname(c)} fue fusionado en ${G.custName(c.merged_into_id)}: cambia el cliente del pedido al sobreviviente.`);
    }
    return coreTransition.call(this, o, to, opts);
  };

  G.cli = { normalizePhone, phoneValid, docError, rucIsValid, findByPhone, findByDoc, create, quickCreate, updateCustomer, detect, registerDuplicate, scanDuplicates, lookupDoc, validateDoc, inPeru, zoneFor, zoneMatch, saveAddress, setDefaultAddress, geocode, quote, block, unblock, setConsent, mergePreview, merge, dismissDuplicate, creditBalance, receivables, createLink, completeLink, linkStatus, previewImport, runImport };

  /* =====================================================================
     Interfaz
     ===================================================================== */
  const custOpts = (pred = () => true) => activeCustomers().filter(pred).sort(U.by('full_name')).map(c => [c.id, `${cname(c)} · ${fmtPhone(c.phone)}`]);
  const sellerOpts = () => D.where('users', u => ['VENDEDORA', 'SUPERVISORA_VENTAS'].includes(u.role) && u.status === 'ACTIVE').map(u => [u.id, u.name]);
  const typeBadge = t => badge(lab(CTYPES, t), t === 'PERSON' ? '' : t === 'RESTAURANT' ? 'accent' : 'info');
  const pinBadge = a => PIN_OK.includes(a.pin_source) ? badge(PIN_SRC[a.pin_source], 'ok') : badge(`${PIN_SRC[a.pin_source] || 'Sin pin'}${a.geocode_confidence != null ? ' · ' + F.num(a.geocode_confidence, 2) : ''}`, 'warn');
  const docBadge = c => c.doc_type === 'NONE' || !c.doc_number ? h('span', { class: 'muted small' }, 'Sin documento') : h('span', null, h('span', { class: 'mono' }, `${c.doc_type} ${c.doc_number}`), ' ', c.doc_validated_at ? badge(c.doc_validation_source, 'ok') : badge('Sin validar', 'warn'), c.doc_type === 'RUC' && !rucIsValid(c.doc_number) ? badge('Dígito inválido', 'bad') : null);
  const custStatus = c => isMerged(c) ? badge('Fusionado', '') : status(c.status);
  /** índices por cliente: última marca, pedidos, zona de la dirección predeterminada */
  function custIndex() {
    const last = {}, cnt = {};
    for (const o of D.all('sales_orders')) { if (o.status === 'CANCELLED') continue; cnt[o.customer_id] = (cnt[o.customer_id] || 0) + 1; if (!last[o.customer_id] || o.created_at > last[o.customer_id].created_at) last[o.customer_id] = o; }
    const zone = new Map(D.where('customer_addresses', a => a.is_default && a.status === 'ACTIVE').map(a => [a.customer_id, a.zone_id]));
    const dup = new Set(D.where('customer_duplicate_candidates', x => x.status === 'OPEN').flatMap(x => [x.customer_id, x.duplicate_of_id]));
    return { last, cnt, zone, dup };
  }

  /** encuadre del mapa alrededor de un punto (misma escala en latitud y longitud) */
  const around = (lat, lng, hgt = 320, span = 0.045) => ({ latMin: lat - span, latMax: lat + span, lngMin: lng - span * 640 / hgt, lngMax: lng + span * 640 / hgt });

  /* ---------- CLI-01 Clientes ---------- */
  function renderList(el) {
    const st = renderList.st = renderList.st || { show: 'ACTIVE' };
    const body = page(el, { code: 'CLI-01', title: 'Clientes', sub: 'Un solo cliente para las 5 marcas. Busca por celular (como sea que lo escriba), nombre, documento o correo.',
      actions: [canManage() ? { label: 'Alta rápida', kind: 'primary', icon: '+', onClick: () => G.go('CLI-03') } : null, G.can('cli.customer.export') ? { label: 'Exportar', onClick: () => { G.audit('EXPORTAR', 'customers', '-', `Exportación de ${activeCustomers().length} clientes (bitácora Ley 29733)`); toast('Exportación registrada en la bitácora: en el sistema final se descarga el CSV.', 'info'); } } : null].filter(Boolean) });
    const ix = custIndex();
    const brands = G.scope.brands().map(b => b.id);
    let rows = D.all('customers').filter(c => c.id !== 'cu-VARIOS' && (st.show === 'ALL' ? true : st.show === 'MERGED' ? isMerged(c) : st.show === 'BLOCKED' ? c.status === 'BLOCKED' : !isMerged(c) && c.status !== 'INACTIVE'));
    if (G.ctx.brand !== 'ALL') rows = rows.filter(c => !(c.segment_brands || []).length || c.segment_brands.includes(G.ctx.brand));
    else if (brands.length < D.all('brands').length) rows = rows.filter(c => !(c.segment_brands || []).length || c.segment_brands.some(b => brands.includes(b)));
    const act = activeCustomers();
    const k1 = G.kpi('KPI-CLI-01') || {}, k2 = G.kpi('KPI-CLI-02') || {};
    body.appendChild(kpis([
      { label: 'Clientes activos', value: F.num(act.filter(c => c.status === 'ACTIVE' && c.id !== 'cu-VARIOS').length), sub: `${F.num(act.filter(c => c.marketing_opt_in).length)} aceptan publicidad` },
      { label: 'Nuevos este mes', value: F.num(k1.value), sub: 'Primer pedido confirmado · KPI-CLI-01' },
      { label: 'Recurrentes del mes', value: F.pct(k2.value), sub: `${k2.numerator || 0} de ${k2.denominator || 0} con 2+ entregas · KPI-CLI-02` },
      { label: 'Duplicados por revisar', value: F.num(G.kpi('KPI-CLI-03').value), tone: G.kpi('KPI-CLI-03').value ? 'warn' : 'ok', onClick: () => G.go('CLI-10'), sub: 'KPI-CLI-03' },
      { label: 'Bloqueados', value: F.num(act.filter(c => c.status === 'BLOCKED').length), tone: 'bad', onClick: () => { st.show = 'BLOCKED'; G.refresh(); } },
    ]));
    body.appendChild(pills([['ACTIVE', 'Activos y bloqueados'], ['BLOCKED', 'Bloqueados'], ['MERGED', 'Fusionados'], ['ALL', 'Todos']], st.show, v => { st.show = v; G.refresh(); }));
    body.appendChild(table({ id: 'cli01', rows, onRow: c => G.go('CLI-02', { id: c.id }), searchPlaceholder: 'Celular (987 654 321), nombre, DNI/RUC o correo…',
      searchText: c => `${c.phone || ''} ${(c.phone || '').replace('+51', '')} ${c.phone_alt || ''} ${c.doc_number || ''} ${c.email || ''} ${c.full_name} ${c.trade_name || ''}`,
      filters: [
        { key: 'customer_type', label: 'Tipo', options: CTYPES },
        { key: 'lb', label: 'Marca de su última compra', options: D.all('brands').map(b => [b.id, G.brandName(b.id)]), value: c => ix.last[c.id] ? ix.last[c.id].brand_id : '' },
        { key: 'zone', label: 'Zona', options: D.all('delivery_zones').map(z => [z.id, z.name]), value: c => ix.zone.get(c.id) || '' },
        { key: 'status', label: 'Estado', options: [['ACTIVE', 'Activo'], ['BLOCKED', 'Bloqueado'], ['INACTIVE', 'Inactivo']] },
        { key: 'seller_user_id', label: 'Vendedora', options: sellerOpts() },
      ],
      columns: [
        { key: 'full_name', label: 'Cliente', render: c => h('div', null, h('div', null, cname(c), ix.dup.has(c.id) ? badge('Posible duplicado', 'warn') : null), h('div', { class: 'small muted' }, c.trade_name ? c.full_name : (c.email || ''))) },
        { key: 'phone', label: 'Celular', mono: true, render: c => fmtPhone(c.phone) },
        { key: 'doc', label: 'Documento', sort: false, render: docBadge, value: c => c.doc_number || '' },
        { key: 'customer_type', label: 'Tipo', render: c => typeBadge(c.customer_type), value: c => lab(CTYPES, c.customer_type) },
        { key: 'zone', label: 'Zona', value: c => ix.zone.get(c.id) ? G.zoneName(ix.zone.get(c.id)) : '—' },
        { key: 'lb', label: 'Última compra', value: c => ix.last[c.id] ? ix.last[c.id].created_at : '', render: c => ix.last[c.id] ? h('div', null, h('div', null, F.date(ix.last[c.id].created_at)), h('div', { class: 'small muted' }, G.brandName(ix.last[c.id].brand_id))) : '—' },
        { key: 'n', label: 'Pedidos', align: 'r', value: c => ix.cnt[c.id] || 0 },
        { key: 'seller_user_id', label: 'Vendedora', value: c => c.seller_user_id ? G.userShort(c.seller_user_id) : '—' },
        { key: 'marketing_opt_in', label: 'Publicidad', render: c => c.marketing_opt_in ? badge('Sí', 'ok') : h('span', { class: 'muted small' }, 'No') },
        { key: 'status', label: 'Estado', render: custStatus },
      ] }));
  }

  /* ---------- CLI-02 Ficha del cliente ---------- */
  function editCustomer(c) {
    if (!canManage()) return G.require('cli.customer.manage', () => { });
    drawer(`Editar ${cname(c)}`, (bd, close) => {
      bd.appendChild(form({ id: 'clie', values: Object.assign({}, c, { phone: c.phone || '', phone_alt: c.phone_alt || '' }), submitLabel: 'Guardar', onCancel: close,
        fields: [{ key: 'full_name', label: 'Nombre o razón social', required: true, span: 2 }, { key: 'trade_name', label: 'Nombre comercial' }, { key: 'customer_type', label: 'Tipo', type: 'select', options: CTYPES, required: true },
          { key: 'phone', label: 'Celular principal', help: 'Se guarda en E.164 (+51…) · RN-CLI-01' }, { key: 'phone_alt', label: 'Celular alterno' }, { key: 'email', label: 'Correo' },
          { key: 'doc_type', label: 'Documento', type: 'select', options: DOCS, required: true }, { key: 'doc_number', label: 'Número' }, { key: 'seller_user_id', label: 'Vendedora asignada', type: 'select', options: sellerOpts() }, { key: 'notes', label: 'Notas', type: 'textarea' }],
        onSubmit: vals => { updateCustomer(c.id, vals); close(); toast('Cliente actualizado', 'ok'); G.refresh(); return true; } }));
    }, { code: 'CLI-02' });
  }
  function blockDialog(c) {
    drawer(c.status === 'BLOCKED' ? `Desbloquear ${cname(c)}` : `Bloquear ${cname(c)}`, (bd, close) => {
      bd.appendChild(notice(c.status === 'BLOCKED' ? `Bloqueado por: ${c.blocked_reason} (${c.blocked_by || '—'}, ${F.datetime(c.blocked_at)}).` : 'Un cliente bloqueado no recibe pedidos nuevos: se rechazan con RN-CLI-09 antes de revisar los datos del pedido.', c.status === 'BLOCKED' ? 'warn' : 'info'));
      bd.appendChild(form({ id: 'clib', values: {}, submitLabel: c.status === 'BLOCKED' ? 'Desbloquear' : 'Bloquear', onCancel: close,
        fields: c.status === 'BLOCKED' ? [{ key: 'note', label: 'Nota', type: 'textarea' }] : [{ key: 'kind', label: 'Motivo', type: 'select', options: [['Fraude', 'Fraude'], ['Deuda', 'Deuda'], ['Maltrato', 'Maltrato al personal'], ['Rechazos', 'Rechazos contra entrega']], required: true }, { key: 'detail', label: 'Detalle', type: 'textarea', required: true }],
        onSubmit: vals => { if (c.status === 'BLOCKED') unblock(c.id, vals.note); else block(c.id, `${vals.kind}: ${vals.detail}`); close(); toast(c.status === 'BLOCKED' ? 'Cliente desbloqueado' : 'Cliente bloqueado', 'ok'); G.refresh(); return true; } }));
    }, { code: 'CLI-02' });
  }
  function renderCard(el, params) {
    const c = cust(params.id) || cust('cu-B001');
    const ix = { orders: D.where('sales_orders', o => o.customer_id === c.id) };
    const ords = G.scope.filter(ix.orders);
    const addrs = D.where('customer_addresses', a => a.customer_id === c.id && a.status === 'ACTIVE');
    const dups = D.where('customer_duplicate_candidates', x => x.status === 'OPEN' && (x.customer_id === c.id || x.duplicate_of_id === c.id));
    const bal = creditBalance(c.id), rec = receivables(c.id), paidMap = paidByOrder(c.id);
    const docs = D.where('sales_documents', d => d.customer_id === c.id);
    const body = page(el, { code: 'CLI-02', title: `Ficha del cliente · ${cname(c)}`, sub: 'Datos, documento validado, teléfonos, consentimiento, vendedora, saldo a favor, cuentas por cobrar, pedidos por marca y canal, direcciones y alertas.',
      actions: [canManage() && !isMerged(c) ? { label: 'Editar', kind: 'primary', onClick: () => editCustomer(c) } : null].filter(Boolean) });
    const tools = [!isMerged(c) ? { label: 'Validar documento', onClick: () => G.go('CLI-04', { id: c.id }) } : null,
        canManage() && !isMerged(c) ? { label: 'Nueva dirección', onClick: () => G.go('CLI-06', { customer_id: c.id }) } : null,
        G.can('cli.customer.block') && !isMerged(c) ? { label: c.status === 'BLOCKED' ? 'Desbloquear' : 'Bloquear', kind: c.status === 'BLOCKED' ? '' : 'danger', onClick: () => blockDialog(c) } : null,
        G.screens['PED-02'] && c.status === 'ACTIVE' ? { label: 'Nuevo pedido', onClick: () => G.go('PED-02', { customer_id: c.id }) } : null, { label: 'Direcciones', onClick: () => G.go('CLI-05', { id: c.id }) }].filter(Boolean);
    body.appendChild(h('div', { class: 'row' }, tools.map(a => btn(a.label, a.onClick, { kind: a.kind, sm: true }))));
    if (isMerged(c)) body.appendChild(notice(['Cliente fusionado en ', h('a', { class: 'linklike', href: '#', on: { click: e => { e.preventDefault(); G.go('CLI-02', { id: c.merged_into_id }); } } }, G.custName(c.merged_into_id)), ` el ${F.datetime(c.merged_at)}. No puede volver a activarse (RN-CLI-08).`], 'info'));
    if (c.status === 'BLOCKED') body.appendChild(notice(`Bloqueado: ${c.blocked_reason}. No se le confirman pedidos nuevos (RN-CLI-09).`, 'bad'));
    if (dups.length) body.appendChild(notice([`Posible duplicado (${dups.map(d => REASONS[d.match_reason]).join(', ')}) con `, ...dups.map(d => { const o = d.customer_id === c.id ? d.duplicate_of_id : d.customer_id; return h('a', { class: 'linklike', href: '#', style: 'margin-right:8px', on: { click: e => { e.preventDefault(); G.go('CLI-11', { a: o, b: c.id }); } } }, G.custName(o)); }), ' · revisar en CLI-10 o fusionar.'], 'warn'));
    if (!addrs.length && !isMerged(c) && c.id !== 'cu-VARIOS') body.appendChild(notice('Sin dirección con pin: el primer delivery exige pin y referencia (RN-CLI-02). Envía el enlace de ubicación (CLI-07).', 'warn'));
    const delivered = ix.orders.filter(o => ['DELIVERED', 'CLOSED'].includes(o.status));
    body.appendChild(kpis([
      { label: 'Pedidos', value: F.num(ix.orders.filter(o => o.status !== 'CANCELLED').length), sub: `${F.num(delivered.length)} entregados` },
      { label: 'Compras entregadas', value: F.money(G.sales.total(delivered)), sub: delivered.length ? `Ticket ${F.money(G.sales.total(delivered) / delivered.length)}` : '' },
      { label: 'Saldo a favor', value: F.money(bal), sub: 'CAJ', tone: bal > 0 ? 'ok' : '' },
      { label: 'Por cobrar', value: F.money(rec.total), sub: `${rec.docs.length} comprobante(s) · ${rec.orders.length} pedido(s)`, tone: rec.total > 0 ? 'warn' : '' },
    ]));
    const ord = [...ords].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const consentRows = D.where('contact_consents', x => x.customer_id === c.id && x.purpose === 'MARKETING').sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)));
    body.appendChild(h('div', { class: 'grid c2' },
      card('Datos del cliente', dl([
        ['Nombre', c.full_name], c.trade_name ? ['Nombre comercial', c.trade_name] : null, ['Tipo', typeBadge(c.customer_type)], ['Documento', docBadge(c)],
        ['Validado', c.doc_validated_at ? `${c.doc_validation_source} · ${F.datetime(c.doc_validated_at)}${c.doc_validation_state ? ' · ' + c.doc_validation_state : ''}` : 'No'],
        ['Celular', h('span', { class: 'mono' }, fmtPhone(c.phone))], ['Celular alterno', c.phone_alt ? h('span', { class: 'mono' }, fmtPhone(c.phone_alt)) : '—'], ['Correo', c.email],
        ['Vendedora asignada', c.seller_user_id ? G.userName(c.seller_user_id) : '—'], ['Canal de origen', G.channelName(c.source_channel)], ['Cliente desde', F.date(c.first_order_at || c.created_at)], ['Estado', custStatus(c)],
      ])),
      card('Consentimiento de publicidad (Ley 29733)', h('div', { class: 'stack' },
        h('div', { class: 'row between' }, h('div', null, c.marketing_opt_in ? badge('Acepta campañas', 'ok') : badge('No recibe campañas', ''), h('div', { class: 'small muted' }, c.marketing_opt_in_at ? `Registrado ${F.datetime(c.marketing_opt_in_at)}` : 'Sin registro de fecha')),
          canManage() && !isMerged(c) ? btn(c.marketing_opt_in ? 'Registrar baja' : 'Registrar alta', () => { try { setConsent(c.id, !c.marketing_opt_in, { channel: 'WHATSAPP' }); toast('Consentimiento registrado', 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); } }, { sm: true }) : null),
        h('p', { class: 'small muted' }, 'Sin consentimiento no recibe campañas (CRM y CMP lo respetan); el aviso y la confirmación de su pedido sí se envían (RN-CLI-13).'),
        consentRows.length ? h('div', { class: 'timeline' }, consentRows.slice(0, 4).map(x => h('div', { class: 'tl-item' }, h('div', { class: 'small muted' }, `${F.datetime(x.recorded_at)} · ${x.channel}`), h('div', null, x.granted ? 'Alta' : 'Baja', x.evidence_text ? ' · ' + x.evidence_text : '')))) : null))));
    const byBrand = U.groupBy(ix.orders.filter(o => o.status !== 'CANCELLED'), 'brand_id'), byCh = U.groupBy(ix.orders.filter(o => o.status !== 'CANCELLED'), 'channel');
    body.appendChild(h('div', { style: 'min-width:0' }, tabs([
      { key: 'o', label: 'Pedidos', count: ord.length, render: pn => {
        pn.appendChild(h('div', { class: 'grid c2', style: 'margin-bottom:12px' },
          card('Por marca', Object.keys(byBrand).length ? G.ui.chart.hbar({ items: Object.entries(byBrand).map(([b, os]) => ({ label: G.brandName(b), value: os.length })), format: v => F.num(v) + ' ped.' }) : G.ui.empty('Sin pedidos.')),
          card('Por canal', Object.keys(byCh).length ? G.ui.chart.hbar({ items: Object.entries(byCh).map(([ch, os]) => ({ label: G.channelName(ch), value: os.length })), format: v => F.num(v) + ' ped.' }) : G.ui.empty('Sin pedidos.'))));
        pn.appendChild(table({ id: 'cli02o', rows: ord, pageSize: 10, onRow: o => G.screens['PED-03'] ? G.go('PED-03', { id: o.id }) : null, columns: [
          { key: 'number', label: 'Pedido', mono: true }, { key: 'created_at', label: 'Fecha', render: o => F.date(o.created_at) }, { key: 'brand_id', label: 'Marca', value: o => G.brandName(o.brand_id) }, { key: 'channel', label: 'Canal', value: o => G.channelName(o.channel) },
          { key: 'total', label: 'Total', align: 'r', value: o => o.final_total ?? o.estimated_total, render: o => F.money(o.final_total ?? o.estimated_total) }, { key: 'paid_amount', label: 'Pagado', align: 'r', value: o => paidOf(o, paidMap), render: o => F.money(paidOf(o, paidMap)) }, { key: 'status', label: 'Estado', render: o => status(o.status) }] }));
      } },
      { key: 'd', label: 'Comprobantes', count: docs.length, render: pn => pn.appendChild(table({ id: 'cli02d', rows: docs.slice().sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date))), pageSize: 10, columns: [
        { key: 'full_number', label: 'Comprobante', mono: true, render: d => G.docs.label(d) }, { key: 'issue_date', label: 'Fecha', render: d => F.date(d.issue_date) }, { key: 'brand', label: 'Marca', value: d => G.brandName(d.brand_id) },
        { key: 'total', label: 'Total', align: 'r', render: d => F.money(d.total) }, { key: 'balance', label: 'Saldo', align: 'r', render: d => d.balance > 0 ? badge(F.money(d.balance), 'warn') : F.money(0) }, { key: 'due_date', label: 'Vence', render: d => F.date(d.due_date) }, { key: 'sunat_status', label: 'SUNAT', render: d => status(d.sunat_status) }] })) },
      { key: 'a', label: 'Direcciones', count: addrs.length, render: pn => { pn.appendChild(addressTable(addrs, c)); if (addrs.length) { const lats = addrs.map(a => a.lat), lngs = addrs.map(a => a.lng); const cl = (Math.min(...lats) + Math.max(...lats)) / 2, cg = (Math.min(...lngs) + Math.max(...lngs)) / 2; const span = Math.max(0.03, (Math.max(...lats) - Math.min(...lats)) * 0.7, (Math.max(...lngs) - Math.min(...lngs)) * 0.7 * 260 / 640); pn.appendChild(G.ui.map({ bounds: around(cl, cg, 260, span), points: addrs.map((a, i) => ({ lat: a.lat, lng: a.lng, label: i + 1, tone: a.is_default ? 'ok' : '', title: a.address_line })), height: 260 })); } } },
      { key: 'r', label: 'Por cobrar', render: pn => { pn.appendChild(rec.docs.length || rec.orders.length ? table({ id: 'cli02r', search: false, rows: [...rec.docs.map(d => ({ k: G.docs.label(d), date: d.issue_date, due: d.due_date, amt: d.balance })), ...rec.orders.map(o => ({ k: 'Pedido ' + o.number, date: o.delivery_date, due: null, amt: o._due }))], columns: [{ key: 'k', label: 'Documento' }, { key: 'date', label: 'Fecha', render: r => F.date(r.date) }, { key: 'due', label: 'Vence', render: r => F.date(r.due) }, { key: 'amt', label: 'Saldo', align: 'r', render: r => F.money(r.amt) }] }) : G.ui.empty('Sin cuentas por cobrar.')); } },
    ])));
  }

  /* ---------- CLI-03 Alta rápida ---------- */
  function renderQuick(el, params) {
    const body = page(el, { code: 'CLI-03', title: 'Alta rápida desde el pedido o el chat', sub: 'Celular, nombre y tipo. Si el celular ya existe, se abre ese cliente en vez de crear otro. Para la vendedora y el mostrador.' });
    const look = h('div');
    const check = v => {
      G.ui.clear(look);
      const p = normalizePhone(v); if (!p || p.length < 12) return;
      const ex = findByPhone(p);
      look.appendChild(ex ? notice([h('b', null, `Ya existe: ${cname(ex)} (${fmtPhone(ex.phone)}). `), 'Al guardar se abre su ficha; no se crea otro. ', btn('Abrir ahora', () => G.go('CLI-02', { id: ex.id }), { sm: true })], 'warn') : notice(`Se guardará como ${p}${phoneValid(p) ? '' : ' (no válido)'}.`, phoneValid(p) ? 'info' : 'bad'));
    };
    const wa = D.where('messaging_channels', ch => ch.kind === 'WHATSAPP');
    const f = form({ id: 'cliq', values: { customer_type: 'PERSON', source_channel: 'WHATSAPP', origin_wa_number: (wa[0] || {}).number, phone: params.phone || '' }, submitLabel: 'Guardar cliente',
      fields: [{ key: 'phone', label: 'Celular', required: true, placeholder: '987 654 321', onChange: v => check(v) }, { key: 'full_name', label: 'Nombre', required: true },
        { key: 'customer_type', label: 'Tipo', type: 'select', options: CTYPES, required: true }, { key: 'source_channel', label: 'Canal', type: 'select', options: G.CHANNELS.filter(c => !['OTHER'].includes(c[0])), required: true },
        { key: 'origin_wa_number', label: 'Número de WhatsApp de origen', type: 'select', options: wa.map(ch => [ch.number, `${ch.display_name} · ${ch.number}`]) },
        { key: 'marketing_opt_in', label: 'Acepta recibir promociones (Ley 29733)', type: 'checkbox' }],
      onSubmit: vals => {
        if (!canManage()) return `Tu rol (${G.roleName()}) no tiene el permiso cli.customer.manage.`;
        const r = quickCreate(vals);
        if (r.existing) { toast(`El celular ya es de ${cname(r.customer)}: se abrió su ficha`, 'info'); G.go('CLI-02', { id: r.customer.id }); return true; }
        toast(`Cliente creado con ${r.customer.phone}` + (r.duplicates.length ? ' · posible duplicado registrado' : ''), r.duplicates.length ? 'warn' : 'ok');
        G.go('CLI-02', { id: r.customer.id }); return true;
      } });
    const recent = D.where('customers', c => c.created_at >= G.date.add(G.TODAY, -7)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    body.appendChild(h('div', { class: 'grid side-r' }, card('Nuevo cliente', h('div', { class: 'stack' }, f, look)),
      card('Creados en los últimos 7 días', recent.length ? h('div', { class: 'stack', style: 'gap:6px' }, recent.slice(0, 8).map(c => h('div', { class: 'row between' }, h('a', { class: 'linklike', href: '#', on: { click: e => { e.preventDefault(); G.go('CLI-02', { id: c.id }); } } }, cname(c)), h('span', { class: 'small muted mono' }, fmtPhone(c.phone))))) : G.ui.empty('Sin altas recientes.'))));
    if (params.phone) check(params.phone);
  }

  /* ---------- CLI-04 Validar documento ---------- */
  function renderValidate(el, params) {
    const st = renderValidate.st = renderValidate.st || {};
    const c = cust(params.id) || cust(st.id) || activeCustomers().find(x => x.doc_type === 'RUC' && !x.doc_validated_at) || activeCustomers().find(x => x.doc_type !== 'NONE' && !x.doc_validated_at) || cust('cu-B001');
    st.id = c.id;
    const body = page(el, { code: 'CLI-04', title: 'Validar documento', sub: 'Consulta DNI (RENIEC) o RUC (SUNAT) con el proveedor: nombre o razón social, estado, condición y dirección fiscal. Guarda la fuente y la fecha. D-CLI-01: adaptador de prueba; validación manual con permiso.' });
    const out = h('div', { class: 'stack' });
    const sel = h('select', { class: 'input', attrs: { 'aria-label': 'Cliente' }, on: { change: e => G.go('CLI-04', { id: e.target.value }) } }, custOpts(x => x.id === c.id || x.doc_type !== 'NONE' || !x.doc_validated_at).slice(0, 600).map(([v, l]) => h('option', { value: v, selected: v === c.id }, l)));
    const f = form({ id: 'cliv', values: { doc_type: c.doc_type === 'NONE' ? 'DNI' : c.doc_type, doc_number: c.doc_number || '' }, submitLabel: 'Consultar al proveedor',
      fields: [{ key: 'doc_type', label: 'Tipo', type: 'select', options: DOCS.filter(d => d[0] !== 'NONE'), required: true }, { key: 'doc_number', label: 'Número', required: true }, { key: 'manual', label: 'Validación manual (vi el documento)', type: 'checkbox', help: 'Exige cli.customer.validate_manual (RN-CLI-12)' }, { key: 'note', label: 'Nota de la validación manual', span: 2 }],
      onSubmit: vals => {
        G.ui.clear(out);
        const pre = vals.manual ? null : lookupDoc(vals.doc_type, vals.doc_number);
        if (pre && !pre.ok) { out.appendChild(notice(pre.error, 'bad')); return true; }
        if (pre) out.appendChild(card(`Respuesta de ${pre.source}`, dl([['Nombre o razón social', pre.name], ['Estado', pre.state], pre.condition ? ['Condición', pre.condition === 'HABIDO' ? badge('HABIDO', 'ok') : badge(pre.condition, 'bad')] : null, pre.fiscal_address ? ['Dirección fiscal', pre.fiscal_address] : null, ['Consultado', F.datetime(pre.checked_at)]])));
        if (pre && pre.condition === 'NO HABIDO') out.appendChild(notice('Contribuyente NO HABIDO: la factura se emite igual, pero avisa a la contadora.', 'warn'));
        out.appendChild(h('div', { class: 'row' }, btn('Guardar en el cliente', () => { try { validateDoc(c.id, vals); toast('Documento validado y guardado', 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); } }, { kind: 'primary', disabled: !canManage() && !vals.manual })));
        return true;
      } });
    const log = (D.t.audit || []).filter(a => a.tenant === G.ctx.tenant && a.action === 'CONSULTA_DOCUMENTO').slice().reverse();
    const pend = activeCustomers().filter(x => x.doc_type !== 'NONE' && x.doc_number && !x.doc_validated_at);
    body.appendChild(h('div', { class: 'grid c2' },
      card('Cliente', h('div', { class: 'stack' }, sel, dl([['Documento actual', docBadge(c)], ['Validado', c.doc_validated_at ? `${c.doc_validation_source} · ${F.datetime(c.doc_validated_at)}` : 'No'], ['Tipo', lab(CTYPES, c.customer_type)]]), f)),
      h('div', { class: 'stack' }, out, card('Documentos sin validar', pend.length ? h('div', { class: 'stack', style: 'gap:4px' }, pend.slice(0, 8).map(x => h('div', { class: 'row between' }, h('a', { class: 'linklike', href: '#', on: { click: e => { e.preventDefault(); G.go('CLI-04', { id: x.id }); } } }, cname(x)), h('span', { class: 'mono small' }, `${x.doc_type} ${x.doc_number}`)))) : G.ui.empty('Todos los documentos están validados.')),
        card('Bitácora de consultas (Ley 29733)', log.length ? h('div', { class: 'timeline' }, log.slice(0, 6).map(a => h('div', { class: 'tl-item' }, h('div', { class: 'small muted' }, `${F.datetime(a.at)} · ${a.user}`), h('div', null, `${G.custName(a.entity_id)} · ${a.detail}`)))) : G.ui.empty('Sin consultas en esta sesión.')))));
  }

  /* ---------- CLI-05 Direcciones ---------- */
  function addressTable(addrs, c) {
    const lastUse = {}; for (const o of D.where('sales_orders', o => o.customer_id === (c && c.id))) if (o.address_id && (!lastUse[o.address_id] || o.created_at > lastUse[o.address_id])) lastUse[o.address_id] = o.created_at;
    return table({ id: 'cli05-' + (c ? c.id : 'x'), rows: addrs, search: false, onRow: a => G.go('CLI-06', { customer_id: a.customer_id, address_id: a.id }), columns: [
      { key: 'label', label: 'Etiqueta', render: a => h('span', null, a.label, ' ', a.is_default ? badge('Predeterminada', 'ok') : null) },
      { key: 'address_line', label: 'Dirección', render: a => h('div', null, h('div', null, a.address_line), h('div', { class: 'small muted' }, a.reference)) },
      { key: 'zone_id', label: 'Zona', render: a => a.zone_id ? G.zoneName(a.zone_id) : badge('Fuera de cobertura', 'bad'), value: a => G.zoneName(a.zone_id) },
      { key: 'pin_source', label: 'Pin', render: pinBadge },
      { key: 'contact_name', label: 'Recibe', render: a => h('div', null, a.contact_name || '—', h('div', { class: 'small muted mono' }, fmtPhone(a.contact_phone))) },
      { key: 'last', label: 'Último uso', value: a => lastUse[a.id] || a.last_used_at || '', render: a => F.date(lastUse[a.id] || a.last_used_at) }],
      actions: canManage() ? a => [!a.is_default ? btn('Predeterminar', () => { setDefaultAddress(a.id); toast('Dirección predeterminada', 'ok'); G.refresh(); }, { sm: true }) : null, btn('Desactivar', () => { D.update('customer_addresses', a.id, { status: 'INACTIVE', is_default: false }); toast('Dirección desactivada', 'ok'); G.refresh(); }, { sm: true, kind: 'ghost' })].filter(Boolean) : null });
  }
  function renderAddresses(el, params) {
    const st = renderAddresses.st = renderAddresses.st || {};
    const multi = U.groupBy(D.where('customer_addresses', a => a.status === 'ACTIVE'), 'customer_id');
    const c = cust(params.id) || cust(st.id) || cust(Object.keys(multi).find(k => multi[k].length >= 2)) || cust('cu-0001');
    st.id = c.id;
    const sel = h('select', { class: 'input', style: 'max-width:340px', attrs: { 'aria-label': 'Cliente' }, on: { change: e => G.go('CLI-05', { id: e.target.value }) } }, custOpts(x => x.id === c.id || (multi[x.id] || []).length >= 2 || !(multi[x.id] || []).length).map(([v, l]) => h('option', { value: v, selected: v === c.id }, l)));
    const body = page(el, { code: 'CLI-05', title: `Direcciones · ${cname(c)}`, sub: 'Direcciones del cliente con su zona, la predeterminada (solo una, RN-CLI-10) y la última vez que se usó.',
      actions: [sel, canManage() ? { label: 'Nueva dirección', kind: 'primary', icon: '+', onClick: () => G.go('CLI-06', { customer_id: c.id }) } : null, { label: 'Enviar enlace al cliente', onClick: () => G.go('CLI-07', { customer_id: c.id }) }].filter(Boolean) });
    const all = D.where('customer_addresses', a => a.status === 'ACTIVE');
    const k4 = G.kpi('KPI-CLI-04') || {};
    body.appendChild(kpis([
      { label: 'Direcciones del cliente', value: F.num((multi[c.id] || []).length) },
      { label: 'Pins confirmados (mes)', value: F.pct(k4.value), sub: `${k4.numerator || 0} de ${k4.denominator || 0} usadas en pedidos · KPI-CLI-04` },
      { label: 'Pins por confirmar', value: F.num(all.filter(a => !PIN_OK.includes(a.pin_source)).length), tone: 'warn', sub: `Geocodificados con confianza < ${G.param('cli_min_geocode_confidence')}` },
      { label: 'Fuera de cobertura', value: F.num(all.filter(a => !a.zone_id).length), tone: 'bad' },
    ]));
    const addrs = D.where('customer_addresses', a => a.customer_id === c.id && a.status === 'ACTIVE');
    body.appendChild(addrs.length ? addressTable(addrs, c) : notice('El cliente no tiene direcciones con pin.', 'warn'));
    const pend = all.filter(a => !PIN_OK.includes(a.pin_source) || !a.zone_id);
    body.appendChild(card('Direcciones por revisar (todas)', table({ id: 'cli05p', rows: pend, search: false, pageSize: 8, onRow: a => G.go('CLI-06', { customer_id: a.customer_id, address_id: a.id }), columns: [
      { key: 'c', label: 'Cliente', value: a => G.custName(a.customer_id) }, { key: 'address_line', label: 'Dirección' }, { key: 'pin', label: 'Pin', render: pinBadge }, { key: 'z', label: 'Zona', render: a => a.zone_id ? G.zoneName(a.zone_id) : badge('Fuera de cobertura', 'bad') }] }), { flush: true }));
  }

  /* ---------- CLI-06 Mapa de la dirección ---------- */
  function renderAddressMap(el, params) {
    const c = cust(params.customer_id) || cust('cu-0001');
    const a = params.address_id ? D.get('customer_addresses', params.address_id) : null;
    const st = { lat: a ? a.lat : null, lng: a ? a.lng : null, pin_source: a ? a.pin_source : 'MAP', geocode_confidence: a ? a.geocode_confidence : null, moved: false };
    const da = D.find('customer_addresses', x => x.customer_id === c.id && x.is_default && x.status === 'ACTIVE');
    let bounds = around(st.lat ?? (da ? da.lat : -12.125), st.lng ?? (da ? da.lng : -76.99), 340);
    const body = page(el, { code: 'CLI-06', title: a ? `Mapa de la dirección · ${a.label}` : `Nueva dirección · ${cname(c)}`, sub: 'Pin sobre el mapa (clic para moverlo), búsqueda por texto, distrito, referencia obligatoria y contacto que recibe. La zona y la tarifa salen del pin.',
      actions: [{ label: 'Enviar enlace al cliente', onClick: () => G.go('CLI-07', { customer_id: c.id }) }, { label: 'Ficha del cliente', onClick: () => G.go('CLI-02', { id: c.id }) }] });
    const info = h('div', { class: 'stack' });
    const mapBox = h('div');
    let fapi = null;
    const drawInfo = () => {
      G.ui.clear(info);
      if (st.lat == null) { info.appendChild(notice('Haz clic en el mapa o busca la dirección para poner el pin (RN-CLI-02).', 'warn')); return; }
      const zm = zoneMatch(st.lat, st.lng, fapi ? fapi.values.district : null);
      const z = zm.zone;
      info.appendChild(dl([['Pin', `${F.num(st.lat, 5)}, ${F.num(st.lng, 5)}`], ['Origen', PIN_SRC[st.pin_source] + (st.geocode_confidence != null && st.pin_source === 'GEOCODE' ? ` · confianza ${F.num(st.geocode_confidence, 2)}` : '')],
        ['Zona', z ? `${z.name} (${zm.by === 'POLYGON' ? 'por polígono' : 'por distrito'})` : badge('Fuera de cobertura · RN-CLI-06', 'bad')], ['Tarifa', z ? `${F.money(z.delivery_fee)} · gratis desde ${z.free_from_units} u o ${F.num(z.free_from_kg)} kg` : '—'], ['Local que atiende', z ? G.siteName(z.establishment_id) : '—']]));
      if (st.pin_source === 'GEOCODE' && st.geocode_confidence < Number(G.param('cli_min_geocode_confidence'))) info.appendChild(notice(`RN-CLI-05: confianza ${F.num(st.geocode_confidence, 2)} menor a ${G.param('cli_min_geocode_confidence')}: mueve el pin en el mapa para confirmarlo.`, 'warn'));
    };
    const drawMap = () => { G.ui.clear(mapBox).appendChild(G.ui.map({ bounds, pick: st.lat != null ? { lat: st.lat, lng: st.lng } : null, highlightZone: st.lat != null ? (zoneFor(st.lat, st.lng) || {}).id : null, height: 340, legend: 'Clic para mover el pin. Cuadros: locales; recuadros: zonas de reparto (la del pin, resaltada).',
      onPick: (lat, lng) => { st.lat = lat; st.lng = lng; if (st.pin_source === 'GEOCODE') { st.pin_source = 'MAP'; st.geocode_confidence = 1; } else st.pin_source = 'MAP'; st.moved = true; if (fapi) { fapi.set('lat', lat); fapi.set('lng', lng); } drawInfo(); drawMap(); } })); };
    const q = h('input', { class: 'input', placeholder: 'Buscar: Av. Primavera 1240, Santiago de Surco', attrs: { 'aria-label': 'Buscar dirección' } });
    const f = form({ id: 'cliad', values: a ? Object.assign({}, a) : { label: 'Casa', contact_name: c.full_name, contact_phone: c.phone, district: 'Santiago de Surco' }, submitLabel: a ? 'Guardar dirección' : 'Crear dirección', onCancel: () => G.back(),
      fields: [{ key: 'label', label: 'Etiqueta', required: true }, { key: 'district', label: 'Distrito', type: 'select', options: districtsAll().map(d => [d, d]), required: true, onChange: () => drawInfo() },
        { key: 'address_line', label: 'Dirección (calle y número)', required: true, span: 2 }, { key: 'reference', label: `Referencia (mínimo ${G.param('cli_min_reference_chars')} caracteres)`, required: true, span: 2 },
        { key: 'contact_name', label: 'Quién recibe' }, { key: 'contact_phone', label: 'Celular de quien recibe' }, { key: 'lat', label: 'Latitud', type: 'number', step: 0.000001 }, { key: 'lng', label: 'Longitud', type: 'number', step: 0.000001 },
        { key: 'is_default', label: 'Dirección predeterminada', type: 'checkbox' }],
      onSubmit: vals => {
        const r = saveAddress(c.id, Object.assign({}, vals, { lat: vals.lat === '' ? st.lat : vals.lat, lng: vals.lng === '' ? st.lng : vals.lng, pin_source: st.pin_source, geocode_confidence: st.geocode_confidence, pin_confirmed: st.moved }), a);
        toast(`Dirección guardada · ${r.zone ? r.zone.name : 'fuera de cobertura'}`, r.zone ? 'ok' : 'warn'); G.go('CLI-05', { id: c.id }); return true;
      } });
    fapi = f.api;
    body.appendChild(h('div', { class: 'grid c2' },
      card('Datos de la dirección', h('div', { class: 'stack' }, h('div', { class: 'row' }, q, btn('Buscar', () => { const g = geocode(q.value); if (!g) { toast('No se encontró: escribe el distrito (por ejemplo «Surco»).', 'warn'); return; } st.lat = g.lat; st.lng = g.lng; bounds = around(g.lat, g.lng, 340); st.pin_source = 'GEOCODE'; st.geocode_confidence = g.confidence; st.moved = false; fapi.set('lat', g.lat); fapi.set('lng', g.lng); fapi.set('district', g.district); if (!fapi.values.address_line) fapi.set('address_line', q.value); drawInfo(); drawMap(); }, { kind: 'accent' })), f)),
      card('Pin y zona', h('div', { class: 'stack' }, mapBox, info))));
    drawMap(); drawInfo();
  }

  /* ---------- CLI-07 Enlace de ubicación ---------- */
  function renderLinks(el, params) {
    const st = renderLinks.st = renderLinks.st || {};
    if (params.customer_id) st.customer_id = params.customer_id;
    const c = cust(st.customer_id) || cust('cu-0002');
    const body = page(el, { code: 'CLI-07', title: 'Enlace de ubicación para el cliente', sub: `Enlace de un solo uso que el cliente abre en su celular para marcar el pin y escribir la referencia; vence en ${G.param('cli_location_link_hours')} h y el resultado llega a la ficha.` });
    const sel = h('select', { class: 'input', attrs: { 'aria-label': 'Cliente' }, on: { change: e => { st.customer_id = e.target.value; G.refresh(); } } }, custOpts(x => !!x.phone).map(([v, l]) => h('option', { value: v, selected: v === c.id }, l)));
    const links = D.all('customer_location_links').slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const live = links.find(l => l.customer_id === c.id && linkStatus(l) === 'PENDING');
    const phone = h('div', { class: 'phone', style: 'max-width:320px' }, h('div', { class: 'phone-screen' }, live ? phoneLink(live) : h('div', { class: 'stack', style: 'padding:16px' }, h('b', null, 'Sin enlace pendiente'), h('p', { class: 'small muted' }, 'Genera el enlace: el cliente lo recibe por WhatsApp (plantilla de utilidad, gratis dentro de la ventana de servicio de 24 h).'))));
    body.appendChild(h('div', { class: 'grid c2' },
      card('Generar y enviar', h('div', { class: 'stack' }, sel, dl([['Celular', fmtPhone(c.phone)], ['Direcciones activas', D.where('customer_addresses', a => a.customer_id === c.id && a.status === 'ACTIVE').length], ['Enlace vivo', live ? `${live.url} · vence ${F.datetime(live.expires_at)}` : 'No']]),
        h('div', { class: 'row' }, btn(live ? 'Reenviar (anula el anterior)' : 'Generar y enviar por WhatsApp', () => { try { createLink(c.id); toast('Enlace enviado por WhatsApp', 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); } }, { kind: 'primary', disabled: !canManage() })))),
      card('Lo que ve el cliente', phone)));
    body.appendChild(table({ id: 'cli07', rows: links, pageSize: 10, filters: [{ key: 'st', label: 'Estado', options: Object.entries(LINK_ST).map(([k, v]) => [k, v[0]]), value: l => linkStatus(l) }],
      columns: [{ key: 'customer', label: 'Cliente', value: l => G.custName(l.customer_id) }, { key: 'url', label: 'Enlace', mono: true }, { key: 'created_at', label: 'Creado', render: l => F.datetime(l.created_at) }, { key: 'expires_at', label: 'Vence', render: l => F.datetime(l.expires_at) },
        { key: 'status', label: 'Estado', value: l => linkStatus(l), render: l => { const s = LINK_ST[linkStatus(l)]; return badge(s[0], s[1]); } }, { key: 'address', label: 'Resultado', value: l => l.address_id ? ((D.get('customer_addresses', l.address_id) || {}).address_line || '—') : '—' }, { key: 'created_by', label: 'Generó' }],
      onRow: l => { st.customer_id = l.customer_id; G.refresh(); } }));
  }
  function phoneLink(l) {
    const st = { lat: null, lng: null };
    const box = h('div', { class: 'stack', style: 'padding:12px;gap:8px' });
    const mapBox = h('div');
    const zoneTxt = h('div', { class: 'small muted' }, 'Toca el mapa donde recibes tu pedido.');
    const hz = D.get('delivery_zones', (D.find('customer_addresses', a => a.customer_id === l.customer_id && a.is_default) || {}).zone_id) || D.get('delivery_zones', 'dz-SURCO-B');
    const bnd = around(hz.lat, hz.lng, 230, 0.03);
    const draw = () => G.ui.clear(mapBox).appendChild(G.ui.map({ bounds: bnd, height: 230, pick: st.lat != null ? st : null, onPick: (lat, lng, z) => { st.lat = lat; st.lng = lng; zoneTxt.textContent = z ? `Zona ${z.name} · delivery ${F.money(z.delivery_fee)}` : 'Fuera de nuestra zona de reparto'; draw(); } }));
    const line = h('input', { class: 'input', placeholder: 'Calle y número', attrs: { 'aria-label': 'Dirección' } });
    const ref = h('input', { class: 'input', placeholder: 'Referencia (frente a…, color de la casa)', attrs: { 'aria-label': 'Referencia' } });
    const dist = h('select', { class: 'input', attrs: { 'aria-label': 'Distrito' } }, districtsAll().map(d => h('option', { value: d, selected: (hz.districts || [])[0] === d }, d)));
    box.append(h('b', null, 'Don Guando · ¿Dónde recibes tu pedido?'), h('div', { class: 'small muted' }, `Enlace de un solo uso · vence ${F.datetime(l.expires_at)}`), mapBox, zoneTxt,
      btn('Usar mi ubicación', () => { const z = G.db.get('delivery_zones', (D.find('customer_addresses', a => a.customer_id === l.customer_id) || {}).zone_id) || D.get('delivery_zones', 'dz-SURCO-B'); st.lat = R(z.lat + 0.002, 6); st.lng = R(z.lng - 0.002, 6); zoneTxt.textContent = `Ubicación del GPS · zona ${(zoneFor(st.lat, st.lng) || { name: 'fuera de cobertura' }).name}`; draw(); }, { sm: true }),
      dist, line, ref, btn('Enviar ubicación', () => { try { const r = completeLink(l.id, { lat: st.lat, lng: st.lng, address_line: line.value, reference: ref.value, district: dist.value }); toast(`Ubicación recibida · ${r.zone ? r.zone.name : 'fuera de cobertura'}`, 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); } }, { kind: 'primary' }));
    draw();
    return box;
  }

  /* ---------- CLI-08 Zonas de reparto ---------- */
  function renderZones(el) {
    const st = renderZones.st = renderZones.st || { draw: null, pts: [] };
    const canZ = G.can('cli.zone.manage') && G.canDo('CLI', 'E');
    const body = page(el, { code: 'CLI-08', title: 'Zonas de reparto', sub: 'Polígonos en el mapa o lista de distritos, local que atiende, tarifa, pedido mínimo, gratis desde unidades, kg o monto, prioridad y zona de provincia. D-CLI-02: zonas y tarifas de demostración.',
      actions: canZ ? [{ label: 'Nueva zona', kind: 'primary', icon: '+', onClick: () => zoneDialog(null) }] : [] });
    const zones = D.all('delivery_zones').slice().sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    const used = U.groupBy(D.where('customer_addresses', a => a.status === 'ACTIVE' && a.zone_id), 'zone_id');
    const ords = U.groupBy(D.where('sales_orders', o => o.zone_id && o.created_at >= G.date.month(G.TODAY)), 'zone_id');
    if (st.draw) {
      const z = D.get('delivery_zones', st.draw);
      body.appendChild(notice([h('b', null, `Dibujando el polígono de ${z.name}: `), `${st.pts.length} vértice(s). Haz clic en el mapa para agregar vértices (mínimo 3). `,
        btn('Guardar polígono', () => { if (st.pts.length < 3) { toast('El polígono necesita al menos 3 vértices.', 'warn'); return; } D.update('delivery_zones', z.id, { polygon: st.pts.slice(), lat: R(U.sum(st.pts, p => p[0]) / st.pts.length, 6), lng: R(U.sum(st.pts, p => p[1]) / st.pts.length, 6) }); st.draw = null; st.pts = []; toast('Polígono guardado', 'ok'); G.refresh(); }, { sm: true, kind: 'primary' }), ' ',
        btn('Deshacer vértice', () => { st.pts.pop(); G.refresh(); }, { sm: true }), ' ', btn('Cancelar', () => { st.draw = null; st.pts = []; G.refresh(); }, { sm: true, kind: 'ghost' })], 'info'));
    }
    const pts = st.draw ? st.pts.map((p, i) => ({ lat: p[0], lng: p[1], label: i + 1, tone: 'accent' })) : [];
    const lima = zones.filter(z => !z.province);
    body.appendChild(h('div', { class: 'grid c2' },
      card('Mapa de zonas', G.ui.map({ points: pts, routes: st.draw && st.pts.length > 1 ? [{ points: st.pts.concat([st.pts[0]]), tone: 'accent' }] : [], height: 360, legend: 'Polígonos con su código; cuadros: Local 1 (Surco) y Local 2 (Lurín).',
        onPick: st.draw ? (lat, lng) => { st.pts.push([lat, lng]); G.refresh(); } : null })),
      h('div', { class: 'stack' },
        kpis([{ label: 'Zonas activas', value: F.num(zones.filter(z => z.status === 'ACTIVE').length), sub: `${lima.length} en Lima + provincia` }, { label: 'Tarifa promedio Lima', value: F.money(U.sum(lima, z => z.delivery_fee) / (lima.length || 1)) }, { label: 'Direcciones fuera de cobertura', value: F.num(D.where('customer_addresses', a => a.status === 'ACTIVE' && !a.zone_id).length), tone: 'warn', sub: 'RN-CLI-06' }]),
        card('Pedidos del mes por zona', G.ui.chart.hbar({ items: zones.map(z => ({ label: z.code, value: (ords[z.id] || []).length })).sort((a, b) => b.value - a.value), format: v => F.num(v) })))));
    body.appendChild(table({ id: 'cli08', rows: zones, onRow: z => zoneDialog(z), columns: [
      { key: 'priority', label: 'Prioridad', align: 'r' }, { key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Zona' },
      { key: 'establishment_id', label: 'Local', value: z => G.siteName(z.establishment_id) },
      { key: 'districts', label: 'Distritos', value: z => (z.districts || []).join(', ') || '—' },
      { key: 'delivery_fee', label: 'Tarifa', align: 'r', render: z => F.money(z.delivery_fee) }, { key: 'min_order_amount', label: 'Mínimo', align: 'r', render: z => F.money(z.min_order_amount) },
      { key: 'free', label: 'Gratis desde', value: z => [z.free_from_units ? `${z.free_from_units} u` : null, z.free_from_kg ? `${F.num(z.free_from_kg)} kg` : null, z.free_from_amount ? F.money(z.free_from_amount) : null].filter(Boolean).join(' o ') || '—' },
      { key: 'poly', label: 'Polígono', value: z => z.polygon ? `${z.polygon.length} vértices` : (z.province ? 'Provincia' : 'Por distrito') },
      { key: 'n', label: 'Direcciones', align: 'r', value: z => (used[z.id] || []).length }, { key: 'o', label: 'Pedidos del mes', align: 'r', value: z => (ords[z.id] || []).length },
      { key: 'status', label: 'Estado', render: z => status(z.status) }],
      actions: canZ ? z => !z.province ? [btn('Dibujar polígono', () => { st.draw = z.id; st.pts = []; G.refresh(); }, { sm: true })] : [] : null }));
  }
  function zoneDialog(z) {
    const canZ = G.can('cli.zone.manage') && G.canDo('CLI', 'E');
    drawer(z ? `Zona ${z.name}` : 'Nueva zona de reparto', (bd, close) => {
      if (!canZ) { bd.appendChild(notice(`Tu rol (${G.roleName()}) solo consulta: editar zonas exige cli.zone.manage.`, 'info')); bd.appendChild(dl([['Código', z.code], ['Tarifa', F.money(z.delivery_fee)], ['Distritos', (z.districts || []).join(', ')]])); return; }
      bd.appendChild(form({ id: 'cliz', values: z ? Object.assign({}, z, { districts_txt: (z.districts || []).join(', ') }) : { status: 'ACTIVE', priority: 200, delivery_fee: 10, min_order_amount: 30, free_from_units: 3, free_from_kg: 3, establishment_id: 'es-L1' }, submitLabel: z ? 'Guardar zona' : 'Crear zona', onCancel: close,
        fields: [{ key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nombre', required: true }, { key: 'establishment_id', label: 'Local que atiende', type: 'select', options: D.all('establishments').map(e => [e.id, e.short || e.name]), required: true },
          { key: 'priority', label: 'Prioridad (menor gana si hay polígonos superpuestos)', type: 'number', required: true }, { key: 'delivery_fee', label: 'Tarifa (S/)', type: 'money', min: 0, step: 0.5, required: true }, { key: 'min_order_amount', label: 'Pedido mínimo (S/)', type: 'money', min: 0 },
          { key: 'free_from_units', label: 'Gratis desde (unidades)', type: 'number', min: 0 }, { key: 'free_from_kg', label: 'Gratis desde (kg)', type: 'number', min: 0, step: 0.5 }, { key: 'free_from_amount', label: 'Gratis desde (S/)', type: 'money', min: 0 },
          { key: 'districts_txt', label: 'Distritos (separados por coma)', span: 2 }, { key: 'province', label: 'Zona de provincia (envío por agencia)', type: 'checkbox' }, { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activa'], ['INACTIVE', 'Inactiva']], required: true }],
        onSubmit: vals => {
          need('cli.zone.manage', 'RN-CLI-06');
          const code = String(vals.code).trim().toUpperCase();
          if (D.find('delivery_zones', x => x.code === code && (!z || x.id !== z.id))) return `Ya existe la zona ${code}.`;
          const districts = String(vals.districts_txt || '').split(',').map(s => s.trim()).filter(Boolean);
          if (!vals.province && !districts.length && !(z && z.polygon)) return 'RN-CLI-06: la zona necesita un polígono o al menos un distrito.';
          const row = { code, name: vals.name, establishment_id: vals.establishment_id, priority: Number(vals.priority), delivery_fee: Number(vals.delivery_fee), min_order_amount: vals.min_order_amount === '' ? null : Number(vals.min_order_amount), free_from_units: vals.free_from_units === '' || vals.free_from_units == null ? null : Number(vals.free_from_units), free_from_kg: vals.free_from_kg === '' || vals.free_from_kg == null ? null : Number(vals.free_from_kg), free_from_amount: vals.free_from_amount === '' || vals.free_from_amount == null ? null : Number(vals.free_from_amount), districts, province: !!vals.province, status: vals.status };
          if (z) D.update('delivery_zones', z.id, row); else { const est = D.get('establishments', row.establishment_id); D.insert('delivery_zones', Object.assign(row, { id: 'dz-' + code, polygon: null, lat: est.lat, lng: est.lng })); }
          close(); toast('Zona guardada', 'ok'); G.refresh(); return true;
        } }));
    }, { code: 'CLI-08' });
  }

  /* ---------- CLI-09 Simulador de zona y tarifa ---------- */
  function renderSimulator(el) {
    const st = renderSimulator.st = renderSimulator.st || { lat: -12.135, lng: -76.99, district: 'Santiago de Surco', lines: [{ variant_id: 'va-DG-CUY-ENT', qty: 2 }] };
    const body = page(el, { code: 'CLI-09', title: 'Simulador de zona y tarifa', sub: 'Dado un pin o un distrito y un carrito, muestra la zona, la tarifa y si aplica el delivery gratis (desde 3 unidades o 3 kg, como anuncia la web).' });
    const q = quote({ lat: st.lat, lng: st.lng, district: st.district, lines: st.lines });
    const vs = D.where('product_variants', v => v.sellable && v.status === 'ACTIVE');
    const cart = h('div', { class: 'stack', style: 'gap:6px' }, st.lines.map((l, i) => h('div', { class: 'row', style: 'flex-wrap:nowrap' },
      h('select', { class: 'input', style: 'min-width:0;flex:1', attrs: { 'aria-label': 'Producto' }, on: { change: e => { l.variant_id = e.target.value; G.refresh(); } } }, vs.map(v => h('option', { value: v.id, selected: v.id === l.variant_id }, `${v.name} · ${G.saleModeName(v.sale_mode)}`))),
      h('input', { class: 'input', type: 'number', value: l.qty, step: 0.25, min: 0, style: 'width:80px', attrs: { 'aria-label': 'Cantidad' }, on: { change: e => { l.qty = Number(e.target.value) || 0; G.refresh(); } } }),
      btn('Quitar', () => { st.lines.splice(i, 1); G.refresh(); }, { sm: true, kind: 'ghost' }))));
    const dsel = h('select', { class: 'input', attrs: { 'aria-label': 'Distrito' }, on: { change: e => { st.district = e.target.value; G.refresh(); } } }, h('option', { value: '' }, 'Distrito: —'), districtsAll().map(d => h('option', { value: d, selected: d === st.district }, d)));
    body.appendChild(h('div', { class: 'grid c2' },
      card('Pin y carrito', h('div', { class: 'stack' },
        G.ui.map({ bounds: st.bounds || (st.bounds = around(-12.13, -76.995, 280, 0.06)), pick: st.lat != null ? { lat: st.lat, lng: st.lng } : null, highlightZone: q.zone ? q.zone.id : null, height: 280, onPick: (lat, lng) => { st.lat = lat; st.lng = lng; G.refresh(); } }),
        h('div', { class: 'row' }, dsel, btn('Usar solo el distrito', () => { st.lat = null; st.lng = null; G.refresh(); }, { sm: true })),
        cart, h('div', { class: 'row' }, btn('Agregar producto', () => { st.lines.push({ variant_id: 'va-DG-CON-TRZ', qty: 1 }); G.refresh(); }, { sm: true }),
          btn('2 cuyes', () => { st.lines = [{ variant_id: 'va-DG-CUY-ENT', qty: 2 }]; G.refresh(); }, { sm: true, kind: 'ghost' }), btn('3 cuyes', () => { st.lines = [{ variant_id: 'va-DG-CUY-ENT', qty: 3 }]; G.refresh(); }, { sm: true, kind: 'ghost' }), btn('3,2 kg de conejo', () => { st.lines = [{ variant_id: 'va-DG-CON-TRZ', qty: 3.2 }]; G.refresh(); }, { sm: true, kind: 'ghost' })))),
      h('div', { class: 'stack' },
        kpis([{ label: 'Zona', value: q.zone ? q.zone.code : 'Sin zona', sub: q.zone ? `${q.zone.name} · ${q.by === 'POLYGON' ? 'por polígono' : q.by === 'DISTRICT' ? 'por distrito' : ''}` : 'Fuera de cobertura', tone: q.zone ? 'ok' : 'bad' },
          { label: 'Delivery', value: q.fee == null ? '—' : F.money(q.fee), tone: q.free ? 'ok' : '', sub: q.free ? 'Gratis' : q.zone ? `Tarifa ${F.money(q.zone.delivery_fee)}` : '' },
          { label: 'Carrito', value: `${F.num(q.units)} u · ${F.num(q.kg, 3)} kg`, sub: `Estimado ${F.money(q.amount)}` }]),
        notice(q.reason, q.zone ? (q.free ? 'ok' : 'info') : 'bad'),
        q.below_min ? notice(`Pedido mínimo de la zona: ${F.money(q.zone.min_order_amount)} (el carrito suma ${F.money(q.amount)}).`, 'warn') : null,
        q.zone ? card('Reglas de la zona', dl([['Local que atiende', G.siteName(q.zone.establishment_id)], ['Tarifa', F.money(q.zone.delivery_fee)], ['Gratis desde', [q.zone.free_from_units ? q.zone.free_from_units + ' unidades' : null, q.zone.free_from_kg ? F.num(q.zone.free_from_kg) + ' kg' : null, q.zone.free_from_amount ? F.money(q.zone.free_from_amount) : null].filter(Boolean).join(' o ')], ['Pedido mínimo', F.money(q.zone.min_order_amount)], ['Prioridad', q.zone.priority]])) : null)));
  }

  /* ---------- CLI-10 Duplicados ---------- */
  function renderDuplicates(el) {
    const st = renderDuplicates.st = renderDuplicates.st || { show: 'OPEN' };
    const body = page(el, { code: 'CLI-10', title: 'Duplicados', sub: 'Pares de clientes posiblemente duplicados con el motivo y el puntaje. Fusiona (CLI-11) o descarta con motivo.',
      actions: [G.can('cli.customer.merge') ? { label: 'Buscar duplicados en toda la base', onClick: () => { const n = scanDuplicates(); toast(n ? `${n} posible(s) duplicado(s) nuevos` : 'No se encontraron duplicados nuevos', n ? 'warn' : 'ok'); G.refresh(); } } : null].filter(Boolean) });
    const all = D.all('customer_duplicate_candidates');
    const cnt = U.groupBy(D.where('sales_orders', o => o.status !== 'CANCELLED'), 'customer_id');
    body.appendChild(kpis([
      { label: 'Abiertos', value: F.num(all.filter(x => x.status === 'OPEN').length), tone: 'warn', sub: 'KPI-CLI-03' },
      { label: 'Fusionados', value: F.num(all.filter(x => x.status === 'MERGED').length), tone: 'ok' },
      { label: 'Descartados', value: F.num(all.filter(x => x.status === 'DISMISSED').length) },
      { label: 'Fusiones registradas', value: F.num(D.all('customer_merges').length), onClick: () => G.go('CLI-11') },
    ]));
    body.appendChild(pills([['OPEN', 'Abiertos'], ['DONE', 'Resueltos'], ['ALL', 'Todos']], st.show, v => { st.show = v; G.refresh(); }));
    const rows = all.filter(x => st.show === 'ALL' || (st.show === 'OPEN' ? x.status === 'OPEN' : x.status !== 'OPEN'));
    const side = id => { const c = cust(id); return h('div', null, h('a', { class: 'linklike', href: '#', on: { click: e => { e.preventDefault(); e.stopPropagation(); G.go('CLI-02', { id }); } } }, cname(c)), h('div', { class: 'small muted' }, `${fmtPhone(c && c.phone)} · ${(cnt[id] || []).length} pedido(s)${c && c.origin_wa_number ? ' · WA ' + c.origin_wa_number.slice(-4) : ''}`)); };
    body.appendChild(table({ id: 'cli10', rows, columns: [
      { key: 'customer_id', label: 'Cliente', render: x => side(x.customer_id), value: x => G.custName(x.customer_id) },
      { key: 'duplicate_of_id', label: 'Posible duplicado de', render: x => side(x.duplicate_of_id), value: x => G.custName(x.duplicate_of_id) },
      { key: 'match_reason', label: 'Motivo', value: x => REASONS[x.match_reason] },
      { key: 'score', label: 'Puntaje', align: 'r', render: x => h('div', { style: 'min-width:80px' }, F.num(x.score, 2), G.ui.progress(x.score * 100, x.score >= 0.9 ? 'bad' : 'warn')) },
      { key: 'created_at', label: 'Detectado', render: x => F.datetime(x.created_at) },
      { key: 'status', label: 'Estado', render: x => badge(DUP_ST[x.status][0], DUP_ST[x.status][1]), value: x => DUP_ST[x.status][0] },
      { key: 'note', label: 'Resolución', value: x => x.resolution_note || '—' }],
      actions: x => x.status === 'OPEN' && G.can('cli.customer.merge') ? [btn('Fusionar', () => G.go('CLI-11', { a: x.duplicate_of_id, b: x.customer_id }), { sm: true, kind: 'primary' }), btn('Descartar', () => dismissDialog(x), { sm: true })] : [] }));
  }
  function dismissDialog(x) {
    drawer('Descartar duplicado', (bd, close) => {
      bd.appendChild(notice(`${G.custName(x.customer_id)} y ${G.custName(x.duplicate_of_id)} · ${REASONS[x.match_reason]}`, 'info'));
      bd.appendChild(form({ id: 'clidis', values: {}, submitLabel: 'Descartar', onCancel: close, fields: [{ key: 'note', label: 'Por qué no son el mismo cliente', type: 'textarea', required: true }],
        onSubmit: vals => { dismissDuplicate(x.id, vals.note); close(); toast('Par descartado', 'ok'); G.refresh(); return true; } }));
    }, { code: 'CLI-10' });
  }

  /* ---------- CLI-11 Fusión de clientes ---------- */
  function renderMerge(el, params) {
    const st = renderMerge.st = renderMerge.st || {};
    const open = D.where('customer_duplicate_candidates', x => x.status === 'OPEN')[0];
    let a = cust(params.a), b = cust(params.b);
    if (!a || !b) { a = open ? cust(open.duplicate_of_id) : null; b = open ? cust(open.customer_id) : null; }
    const body = page(el, { code: 'CLI-11', title: 'Fusión de clientes', sub: 'Elige el sobreviviente, revisa lo que se moverá (pedidos, direcciones, comprobantes, cobros, conversaciones y saldo) y registra el motivo. No se deshace (RN-CLI-08).' });
    if (a && b && !isMerged(a) && !isMerged(b)) {
      const key = a.id + '|' + b.id; if (st.key !== key) { st.key = key; st.survivor = (a.orders_count || 0) >= (b.orders_count || 0) ? a.id : b.id; }
      const surv = cust(st.survivor), gone = st.survivor === a.id ? b : a;
      const pv = mergePreview(gone.id);
      const col = c => card(c.id === surv.id ? 'Sobreviviente' : 'Se fusiona (queda inactivo)', h('div', { class: 'stack' }, dl([['Nombre', cname(c)], ['Celular', fmtPhone(c.phone)], ['Alterno', fmtPhone(c.phone_alt)], ['Correo', c.email], ['Documento', docBadge(c)], ['Tipo', lab(CTYPES, c.customer_type)], ['Origen', `${G.channelName(c.source_channel)}${c.origin_wa_number ? ' · ' + c.origin_wa_number : ''}`], ['Pedidos', c.orders_count || D.where('sales_orders', o => o.customer_id === c.id).length], ['Saldo a favor', F.money(creditBalance(c.id))], ['Estado', custStatus(c)]])), { class: c.id === surv.id ? '' : '' });
      body.appendChild(pills([[a.id, `Sobrevive ${cname(a)}`], [b.id, `Sobrevive ${cname(b)}`]], st.survivor, v => { st.survivor = v; G.refresh(); }));
      body.appendChild(h('div', { class: 'grid c2' }, col(surv), col(gone)));
      const moveRows = Object.entries(pv.counts).map(([t, n]) => ({ t, n }));
      body.appendChild(card('Lo que se moverá al sobreviviente', h('div', { class: 'stack' },
        moveRows.length ? h('div', { class: 'stack', style: 'gap:4px' }, moveRows.map(r => h('div', { class: 'row between' }, h('span', null, TABLE_NAMES[r.t] || r.t), h('b', { class: 'num' }, F.num(r.n))))) : G.ui.empty('No hay registros enlazados al cliente que se fusiona.'),
        h('div', { class: 'row between' }, h('span', null, 'Saldo a favor'), h('b', { class: 'num' }, F.money(pv.balance))), h('div', { class: 'row between' }, h('span', null, 'Por cobrar'), h('b', { class: 'num' }, F.money(pv.receivable))),
        h('p', { class: 'small muted' }, `Se completan en el sobreviviente los datos que le falten (correo, documento)${gone.phone && gone.phone !== surv.phone ? ` y el celular de ${cname(gone)} queda como alterno` : ''}. CRM, DEL y CAJ reciben el evento customer.merged.`),
        G.can('cli.customer.merge') ? form({ id: 'climg', values: {}, submitLabel: 'Fusionar (no se deshace)', fields: [{ key: 'reason', label: 'Motivo', type: 'textarea', required: true }],
          onSubmit: vals => { merge(surv.id, gone.id, vals.reason); toast(`${cname(gone)} fusionado en ${cname(surv)}`, 'ok'); G.go('CLI-02', { id: surv.id }); return true; } }) : notice(`Tu rol (${G.roleName()}) no tiene el permiso cli.customer.merge.`, 'info'))));
    } else body.appendChild(notice('No hay un par seleccionado: elige uno en CLI-10.', 'info'));
    body.appendChild(card('Fusiones registradas (solo inserción)', table({ id: 'cli11h', rows: D.all('customer_merges').slice().sort((x, y) => String(y.merged_at).localeCompare(String(x.merged_at))), search: false, pageSize: 10, columns: [
      { key: 'merged_at', label: 'Fecha', render: m => F.datetime(m.merged_at) }, { key: 'survivor_id', label: 'Sobreviviente', value: m => G.custName(m.survivor_id) }, { key: 'merged_id', label: 'Fusionado', value: m => m.merged_name || G.custName(m.merged_id) },
      { key: 'moved', label: 'Movido', value: m => Object.entries(m.moved_counts || {}).filter(([k]) => k !== 'balance').map(([k, n]) => `${TABLE_NAMES[k] || k}: ${n}`).join(', ') || '—' },
      { key: 'reason', label: 'Motivo' }, { key: 'merged_by', label: 'Usuario' }], onRow: m => G.go('CLI-02', { id: m.survivor_id }) }), { flush: true }));
  }

  /* ---------- CLI-12 Importar clientes ---------- */
  function renderImport(el) {
    const st = renderImport.st = renderImport.st || { text: null, rows: null, source: 'WHATSAPP' };
    const body = page(el, { code: 'CLI-12', title: 'Importar clientes', sub: 'Carga desde CSV o Excel (agenda de WhatsApp, base de la web) con normalización de celulares a E.164 y reporte de duplicados antes de confirmar.' });
    const ex = activeCustomers().find(c => c.id === 'cu-0003') || activeCustomers()[3];
    if (st.text == null) st.text = ['nombre;celular;correo;documento;distrito', 'Gloria Vásquez Ríos;987 111 222;gloria.vr@correo.pe;;Miraflores', 'Rubén Tello Ugaz;(01) 998877665;;45879632;Santiago de Surco', `${ex.full_name};${(ex.phone || '').replace('+51', '')};;;San Borja`, 'Sin Nombre Válido;12345;;;Barranco', 'Inés Carhuas Poma;+51 965 432 100;ines.cp@correo.pe;;La Molina', 'Inés Carhuas Poma;965432100;;;La Molina'].join('\n');
    const ta = h('textarea', { class: 'input', style: 'min-height:150px;font-family:var(--mono, monospace)', attrs: { 'aria-label': 'Contenido CSV' } }, st.text);
    const src = h('select', { class: 'input', style: 'max-width:240px', attrs: { 'aria-label': 'Origen' }, on: { change: e => { st.source = e.target.value; } } }, [['WHATSAPP', 'Agenda de WhatsApp'], ['WEB', 'Base de la web (WooCommerce)'], ['OTHER', 'Otro archivo']].map(([v, l]) => h('option', { value: v, selected: v === st.source }, l)));
    const file = h('input', { type: 'file', class: 'input', attrs: { accept: '.csv,.txt', 'aria-label': 'Archivo CSV' }, on: { change: e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { st.text = String(rd.result); st.rows = null; G.refresh(); }; rd.readAsText(f); } } });
    body.appendChild(card('Archivo', h('div', { class: 'stack' }, h('p', { class: 'small muted' }, 'Columnas: nombre; celular; correo; documento; distrito. Separador «;» o tabulación (pegado desde Excel). Las direcciones no se importan: sin pin no se guardan (RN-CLI-02); se piden con el enlace de ubicación.'),
      h('div', { class: 'row' }, src, file), ta, h('div', { class: 'row' }, btn('Revisar antes de importar', () => { st.text = ta.value; st.rows = previewImport(st.text); G.refresh(); }, { kind: 'accent' })))));
    if (st.rows) {
      const rows = st.rows;
      body.appendChild(kpis([{ label: 'Filas', value: F.num(rows.length) }, { label: 'Nuevas', value: F.num(rows.filter(r => !r.error && !r.dup && !r.dup_in_file).length), tone: 'ok' }, { label: 'Ya existen (duplicados)', value: F.num(rows.filter(r => r.dup || r.dup_in_file).length), tone: 'warn' }, { label: 'Con error', value: F.num(rows.filter(r => r.error).length), tone: 'bad' }]));
      body.appendChild(table({ id: 'cli12', rows, search: false, pageSize: 50, columns: [
        { key: 'line', label: 'Fila', align: 'r' }, { key: 'full_name', label: 'Nombre' }, { key: 'phone_raw', label: 'Celular original', mono: true }, { key: 'phone', label: 'E.164', mono: true, render: r => r.phone && phoneValid(r.phone) ? r.phone : '—' },
        { key: 'doc', label: 'Documento', value: r => r.doc ? `${r.doc_type} ${r.doc}` : '—' },
        { key: 'check', label: 'Revisión', render: r => r.error ? badge(r.error, 'bad') : r.dup ? h('span', null, badge(`${REASONS[r.dup_reason]}: ${cname(r.dup)}`, 'warn')) : r.dup_in_file ? badge(`Repetido en el archivo (fila ${r.dup_in_file})`, 'warn') : badge('Nuevo', 'ok') },
        { key: 'action', label: 'Acción', sort: false, render: r => r.error ? h('span', { class: 'muted small' }, 'Se omite') : r.dup && r.dup_reason === 'SAME_DOC' ? h('span', { class: 'muted small' }, 'Se omite (RN-CLI-11)') : h('select', { class: 'input', attrs: { 'aria-label': 'Acción fila ' + r.line }, on: { change: e => { r.action = e.target.value; } } }, [['CREATE', r.dup || r.dup_in_file ? 'Crear y marcar duplicado' : 'Crear'], ['SKIP', r.dup ? 'Usar el existente (omitir)' : 'Omitir']].map(([v, l]) => h('option', { value: v, selected: r.action === v }, l))) }] }));
      body.appendChild(h('div', { class: 'row' }, btn('Confirmar importación', () => { try { const res = runImport(rows, st.source); st.rows = null; toast(`${res.created} creados · ${res.skipped} omitidos · ${res.flagged} marcados como posible duplicado`, 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); } }, { kind: 'primary', disabled: !canManage() })));
    }
  }

  /* =====================================================================
     Registro del módulo
     ===================================================================== */
  const SC = G.SPEC.CLI.screens;
  const nm = code => (SC.find(s => s[0] === code) || [code, code])[1];
  G.register({ code: 'CLI', name: 'Clientes y zonas de reparto', phase: 1, group: 'Ventas y canales', screens: [
    { code: 'CLI-01', name: nm('CLI-01'), render: renderList },
    { code: 'CLI-02', name: nm('CLI-02'), render: renderCard },
    { code: 'CLI-03', name: nm('CLI-03'), render: renderQuick },
    { code: 'CLI-04', name: nm('CLI-04'), render: renderValidate },
    { code: 'CLI-05', name: nm('CLI-05'), render: renderAddresses },
    { code: 'CLI-06', name: nm('CLI-06'), render: renderAddressMap },
    { code: 'CLI-07', name: nm('CLI-07'), render: renderLinks },
    { code: 'CLI-08', name: nm('CLI-08'), render: renderZones },
    { code: 'CLI-09', name: nm('CLI-09'), render: renderSimulator },
    { code: 'CLI-10', name: nm('CLI-10'), render: renderDuplicates },
    { code: 'CLI-11', name: nm('CLI-11'), render: renderMerge },
    { code: 'CLI-12', name: nm('CLI-12'), render: renderImport },
  ] });

  /* ---------- búsqueda, escáner y alertas ---------- */
  G.searchProviders.push(q => {
    const s = String(q || '').trim(); if (s.length < 3 || !G.canSee('CLI')) return [];
    const digits = s.replace(/\D/g, ''); const sl = strip(s);
    const out = [];
    for (const c of D.all('customers')) {
      if (out.length >= 6) break;
      if (isMerged(c)) continue;
      const hit = (digits.length >= 6 && ((c.phone || '').includes(digits) || (c.phone_alt || '').includes(digits) || String(c.doc_number || '').includes(digits))) || strip(c.full_name).includes(sl) || strip(c.trade_name).includes(sl) || (c.email && c.email.includes(s.toLowerCase()));
      if (hit) out.push({ label: cname(c), sub: `Cliente · ${fmtPhone(c.phone)}${c.doc_number ? ' · ' + c.doc_type + ' ' + c.doc_number : ''}${c.status === 'BLOCKED' ? ' · BLOQUEADO' : ''}`, go: () => G.go('CLI-02', { id: c.id }) });
    }
    return out;
  });
  G.scanHandlers.push(code => {
    const c = String(code || '').trim().toUpperCase();
    if (/^CU-[A-Z0-9]+$/.test(c)) { const x = D.get('customers', 'cu-' + c.slice(3)); if (x) return () => G.go('CLI-02', { id: x.id }); }
    return null;
  });
  G.alertProviders.push(() => {
    const n = D.where('customer_duplicate_candidates', x => x.status === 'OPEN').length;
    const pins = D.where('customer_addresses', a => a.status === 'ACTIVE' && a.pin_source === 'GEOCODE' && (a.geocode_confidence ?? 0) < Number(G.param('cli_min_geocode_confidence') ?? 0.8)).length;
    const out = [];
    if (n) out.push({ module: 'CLI', title: `${n} posible(s) cliente(s) duplicado(s) por revisar`, detail: 'Mismo celular, documento o correo (RN-CLI-07).', tone: 'warn', go: () => G.go('CLI-10') });
    if (pins) out.push({ module: 'CLI', title: `${pins} pin(es) geocodificado(s) sin confirmar`, detail: 'Muévelos en el mapa o envía el enlace al cliente (RN-CLI-05).', tone: 'info', go: () => G.go('CLI-05') });
    return out;
  });

  /* =====================================================================
     Datos de ejemplo (orden 21)
     ===================================================================== */
  G.seed(21, function seedClientes() {
    const ins = (t, r) => D.insert(t, r, { silent: true });
    const r = U.rng(2121);
    // Zonas de Surco (D-CLI-02): Surco B (Chacarilla – Primavera) baja hasta el Local 1 por el oeste de Higuereta; Surco A rodea por el este
    const zA = D.get('delivery_zones', 'dz-SURCO-A'), zB = D.get('delivery_zones', 'dz-SURCO-B');
    zB.polygon = [[-12.098, -77.004], [-12.098, -76.976], [-12.122, -76.976], [-12.122, -76.982], [-12.142, -76.982], [-12.142, -76.999], [-12.122, -76.999], [-12.122, -77.004]];
    zA.polygon = [[-12.118, -76.999], [-12.118, -76.971], [-12.142, -76.971], [-12.142, -76.982], [-12.122, -76.982], [-12.122, -76.999]];
    for (const z of D.all('delivery_zones')) Object.assign(z, { priority: z.priority ?? 100, free_from_amount: z.free_from_amount ?? null, min_order_amount: z.min_order_amount ?? 30 });
    // direcciones: distrito, confianza, zona por el pin y último uso
    const lastUse = {}; for (const o of D.all('sales_orders')) if (o.address_id && (!lastUse[o.address_id] || o.created_at > lastUse[o.address_id])) lastUse[o.address_id] = o.created_at;
    const moved = new Map();
    for (const a of D.all('customer_addresses')) {
      a.district = a.district || String(a.address_line).split(', ').pop();
      a.geocode_confidence = a.geocode_confidence ?? 1; a.last_used_at = lastUse[a.id] || null;
      if (['dz-SURCO-A', 'dz-SURCO-B'].includes(a.zone_id)) { const z = zoneFor(a.lat, a.lng, a.district); if (z && z.id !== a.zone_id && ['dz-SURCO-A', 'dz-SURCO-B'].includes(z.id)) { moved.set(a.id, z.id); a.zone_id = z.id; } }
      a.zone_by = 'POLYGON';
    }
    for (const o of D.all('sales_orders')) if (o.address_id && moved.has(o.address_id)) o.zone_id = moved.get(o.address_id);
    // clientes: vendedora asignada (la de su último pedido), fecha de consentimiento
    const lastSeller = {}; for (const o of D.all('sales_orders')) if (o.seller_id && (!lastSeller[o.customer_id] || o.created_at > lastSeller[o.customer_id].at)) lastSeller[o.customer_id] = { at: o.created_at, id: o.seller_id };
    for (const c of D.all('customers')) Object.assign(c, { phone_alt: c.phone_alt || null, merged_into_id: null, seller_user_id: c.seller_user_id || (lastSeller[c.id] || {}).id || null, marketing_opt_in_at: c.marketing_opt_in ? (c.first_order_at || '2026-08-01T10:00') : null, created_at: c.first_order_at ? G.date.add(c.first_order_at.slice(0, 10), -1) + 'T10:00' : '2026-08-01T10:00' });
    Object.assign(D.get('customers', 'cu-BLOQ'), { blocked_at: '2026-09-22T16:40', blocked_by: 'Patricia León Vera' });
    ins('customers', { id: 'cu-BLOQ2', doc_type: 'NONE', doc_number: null, full_name: 'Marco Aurelio Pinto', phone: '+51944556677', customer_type: 'PERSON', source_channel: 'TIKTOK', marketing_opt_in: false, status: 'BLOCKED', blocked_reason: 'Fraude: envió una constancia de Yape adulterada (P-000412)', blocked_at: '2026-10-03T12:10', blocked_by: 'Patricia León Vera', segment_brands: [], created_at: '2026-10-02T19:00' });
    // segunda dirección (oficina) para algunos clientes, un pin por confirmar y uno fuera de cobertura
    const persons = D.where('customers', c => c.id.startsWith('cu-0') && c.orders_count >= 2).slice(0, 14);
    const OFF = [['dz-SAN-ISIDRO', 'Av. Javier Prado Oeste 890, San Isidro', 'Edificio de oficinas, recepción piso 1'], ['dz-MIRAFLORES', 'Av. Larco 1150, Miraflores', 'Frente al centro comercial, puerta lateral'], ['dz-SAN-BORJA', 'Av. San Luis 2480, San Borja', 'Al costado del banco, oficina 302'], ['dz-SURCO-B', 'Av. Primavera 645, Santiago de Surco', 'Torre empresarial, dejar en portería']];
    persons.forEach((c, i) => { const [zid, line, ref] = OFF[i % OFF.length]; const z = D.get('delivery_zones', zid); const lat = U.round(z.lat + (r() - 0.5) * 0.01, 6), lng = U.round(z.lng + (r() - 0.5) * 0.01, 6); ins('customer_addresses', { id: 'ad-OF' + c.id.slice(3), customer_id: c.id, label: 'Oficina', address_line: line, district: (z.districts || [])[0], reference: ref, lat, lng, zone_id: (zoneFor(lat, lng) || z).id, zone_by: 'POLYGON', contact_name: c.full_name.split(' ').slice(0, 2).join(' '), contact_phone: c.phone, is_default: false, status: 'ACTIVE', pin_source: i % 3 === 0 ? 'GPS' : 'MAP', geocode_confidence: 1, last_used_at: null }); });
    const cg = persons[1]; ins('customer_addresses', { id: 'ad-GEO1', customer_id: cg.id, label: 'Casa de playa', address_line: 'Calle Las Gaviotas 120, Chorrillos', district: 'Chorrillos', reference: 'Pasando el malecón, casa amarilla', lat: -12.1712, lng: -77.0168, zone_id: 'dz-CHORRILLOS', zone_by: 'POLYGON', contact_name: cg.full_name, contact_phone: cg.phone, is_default: false, status: 'ACTIVE', pin_source: 'GEOCODE', geocode_confidence: 0.62, last_used_at: null });
    const co = persons[2]; ins('customer_addresses', { id: 'ad-ATE1', customer_id: co.id, label: 'Casa de mamá', address_line: 'Av. Nicolás Ayllón 4200, Ate', district: 'Ate', reference: 'Frente al paradero Puruchuco', lat: -12.043, lng: -76.928, zone_id: null, zone_by: null, out_of_coverage: true, contact_name: co.full_name, contact_phone: co.phone, is_default: false, status: 'ACTIVE', pin_source: 'MAP', geocode_confidence: 1, last_used_at: null });
    // duplicados (RN-CLI-07)
    const orig = D.where('customers', c => c.id.startsWith('cu-0') && c.orders_count >= 3 && c.doc_type === 'DNI')[0];
    const dup1 = ins('customers', { id: 'cu-D001', doc_type: 'NONE', doc_number: null, full_name: orig.full_name.split(' ').slice(0, 2).join(' '), phone: orig.phone, email: null, customer_type: 'PERSON', source_channel: 'WHATSAPP', origin_wa_number: '+51987650102', marketing_opt_in: false, status: 'ACTIVE', seller_user_id: 'us-bramos', segment_brands: ['br-DG'], merged_into_id: null, created_at: '2026-10-06T11:20', created_by: 'Betty Ramos Cruz' });
    const oo = D.where('sales_orders', o => o.customer_id === orig.id).sort(U.by('created_at', -1))[0];
    if (oo) { oo.customer_id = dup1.id; oo.billing_customer_id = dup1.id; dup1.orders_count = 1; dup1.first_order_at = dup1.last_order_at = oo.created_at; orig.orders_count = Math.max(0, (orig.orders_count || 1) - 1); }
    ins('customer_duplicate_candidates', { id: 'cdc-001', customer_id: dup1.id, duplicate_of_id: orig.id, match_reason: 'SAME_PHONE', score: 0.95, status: 'OPEN', created_at: '2026-10-06T11:20' });
    const emailOrig = D.where('customers', c => c.id.startsWith('cu-0') && c.email && c.orders_count >= 1)[5];
    const dup2 = ins('customers', { id: 'cu-D002', doc_type: 'NONE', doc_number: null, full_name: emailOrig.full_name, phone: '+51912' + U.pad(345000 + 67, 6), email: emailOrig.email, customer_type: 'PERSON', source_channel: 'WEB', marketing_opt_in: true, marketing_opt_in_at: '2026-10-08T21:05', status: 'ACTIVE', segment_brands: [], merged_into_id: null, created_at: '2026-10-08T21:05', created_by: 'Tienda web' });
    ins('customer_duplicate_candidates', { id: 'cdc-002', customer_id: dup2.id, duplicate_of_id: emailOrig.id, match_reason: 'SAME_EMAIL', score: 0.85, status: 'OPEN', created_at: '2026-10-08T21:05' });
    const nameOrig = D.where('customers', c => c.id.startsWith('cu-0') && c.orders_count >= 1)[20];
    const nAddr = D.find('customer_addresses', a => a.customer_id === nameOrig.id && a.is_default);
    const dup3 = ins('customers', { id: 'cu-D003', doc_type: 'NONE', doc_number: null, full_name: nameOrig.full_name, phone: '+51923' + U.pad(456000 + 11, 6), email: null, customer_type: 'PERSON', source_channel: 'TIKTOK', marketing_opt_in: false, status: 'ACTIVE', segment_brands: [], merged_into_id: null, created_at: '2026-10-09T15:30', created_by: 'Carla Núñez Pinto' });
    ins('customer_addresses', { id: 'ad-D003', customer_id: dup3.id, label: 'Casa', address_line: nAddr.address_line, district: nAddr.district, reference: nAddr.reference, lat: U.round(nAddr.lat + 0.0004, 6), lng: U.round(nAddr.lng - 0.0003, 6), zone_id: nAddr.zone_id, zone_by: 'POLYGON', contact_name: nameOrig.full_name, contact_phone: dup3.phone, is_default: true, status: 'ACTIVE', pin_source: 'MAP', geocode_confidence: 1 });
    ins('customer_duplicate_candidates', { id: 'cdc-003', customer_id: dup3.id, duplicate_of_id: nameOrig.id, match_reason: 'SIMILAR_NAME_ADDRESS', score: 0.6, status: 'OPEN', created_at: '2026-10-09T15:30' });
    // descartado: esposos con el mismo celular alterno
    const famO = D.where('customers', c => c.id.startsWith('cu-0') && c.orders_count >= 1)[33];
    const fam = ins('customers', { id: 'cu-D004', doc_type: 'DNI', doc_number: '47821936', full_name: 'Esposo de ' + famO.full_name.split(' ')[0], phone: '+51934' + U.pad(220000 + 9, 6), phone_alt: famO.phone, customer_type: 'PERSON', source_channel: 'WHATSAPP', marketing_opt_in: true, marketing_opt_in_at: '2026-09-20T10:00', status: 'ACTIVE', segment_brands: [], merged_into_id: null, doc_validated_at: '2026-09-20T10:05', doc_validation_source: 'RENIEC', created_at: '2026-09-20T10:00' });
    ins('customer_duplicate_candidates', { id: 'cdc-004', customer_id: fam.id, duplicate_of_id: famO.id, match_reason: 'SAME_PHONE', score: 0.9, status: 'DISMISSED', resolved_by: 'us-pleon', resolved_at: '2026-09-21T09:30', resolution_note: 'Esposos: comparten el celular de la casa como alterno', created_at: '2026-09-20T10:00' });
    // fusión histórica (solo inserción)
    const sv = D.where('customers', c => c.id.startsWith('cu-0') && c.orders_count >= 2)[40];
    ins('customers', { id: 'cu-D005', doc_type: 'NONE', doc_number: null, full_name: sv.full_name.split(' ').slice(0, 2).join(' ') + ' (web)', phone: sv.phone, customer_type: 'PERSON', source_channel: 'WEB', marketing_opt_in: false, status: 'INACTIVE', merged_into_id: sv.id, merged_at: '2026-09-18T12:00', segment_brands: [], created_at: '2026-09-10T20:00', notes: `Fusionado en ${sv.full_name}: misma persona registrada desde la web` });
    ins('customer_duplicate_candidates', { id: 'cdc-005', customer_id: 'cu-D005', duplicate_of_id: sv.id, match_reason: 'SAME_PHONE', score: 0.95, status: 'MERGED', resolved_by: 'us-pleon', resolved_at: '2026-09-18T12:00', resolution_note: 'Misma persona registrada desde la web', created_at: '2026-09-10T20:00' });
    ins('customer_merges', { id: 'cme-001', survivor_id: sv.id, merged_id: 'cu-D005', moved_counts: { sales_orders: 1, customer_addresses: 1, balance: 0 }, reason: 'Misma persona registrada desde la web', merged_at: '2026-09-18T12:00', merged_by: 'Patricia León Vera', survivor_name: sv.full_name, merged_name: 'cliente web duplicado' });
    // enlaces de ubicación
    const lc = D.where('customers', c => c.id.startsWith('cu-0'));
    ins('customer_location_links', { id: 'cll-001', customer_id: lc[1].id, token: 'k7Qm2xPaZt', url: 'https://donguando.aycha.pe/u/k7Qm2xPaZt', expires_at: '2026-10-11T09:30:00', status: 'PENDING', created_by: 'Ana Torres Lazo', sent_via: 'WHATSAPP', phone: lc[1].phone, created_at: '2026-10-10T09:30' });
    ins('customer_location_links', { id: 'cll-002', customer_id: lc[4].id, token: 'Rw8nTq3LbY', url: 'https://donguando.aycha.pe/u/Rw8nTq3LbY', expires_at: '2026-10-09T18:00:00', status: 'USED', used_at: '2026-10-08T18:40', address_id: 'ad-' + lc[4].id.slice(3), created_by: 'Elena Vargas Meza', sent_via: 'WHATSAPP', phone: lc[4].phone, created_at: '2026-10-08T18:00' });
    ins('customer_location_links', { id: 'cll-003', customer_id: lc[7].id, token: 'Hn4vXc9MeS', url: 'https://donguando.aycha.pe/u/Hn4vXc9MeS', expires_at: '2026-10-06T11:00:00', status: 'PENDING', created_by: 'Betty Ramos Cruz', sent_via: 'WHATSAPP', phone: lc[7].phone, created_at: '2026-10-05T11:00' });
    D.get('customer_addresses', 'ad-' + lc[4].id.slice(3)).pin_source = 'LINK';
  }, 'clientes');

  /* =====================================================================
     Pruebas de aceptación (una por CA-CLI-*)
     ===================================================================== */
  const T = (name, fn) => G.tests.push({ module: 'CLI', name, fn });
  const throwsCode = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e; throw new Error(`Se esperaba ${code} y se obtuvo: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code}`); };
  T('CA-CLI-01: «987654321» en el alta rápida queda +51987654321; si ya existe se abre el cliente existente', async () => {
    const prev = G.ctx.role; G.ctx.role = 'VENDEDORA';
    try {
      const n0 = D.all('customers').length;
      const r1 = quickCreate({ phone: '987654321', full_name: 'Cliente Prueba Alta', customer_type: 'PERSON' });
      if (r1.existing || r1.customer.phone !== '+51987654321') throw new Error('Se guardó como ' + r1.customer.phone);
      const r2 = quickCreate({ phone: '987 654 321', full_name: 'Otro Nombre', customer_type: 'PERSON' });
      if (!r2.existing || r2.customer.id !== r1.customer.id) throw new Error('No abrió el cliente existente');
      if (D.all('customers').length !== n0 + 1) throw new Error('Se creó un segundo cliente');
    } finally { G.ctx.role = prev; }
  });
  T('CA-CLI-02: dirección en Surco con «Frente al parque» y pin (-12,135, -76,990) → zona Surco-B por polígono; «casa» → RN-CLI-02', async () => {
    const r = saveAddress('cu-0001', { label: 'Prueba', address_line: 'Av. Los Próceres 1250', district: 'Santiago de Surco', reference: 'Frente al parque', lat: -12.135, lng: -76.990, pin_source: 'MAP' });
    if (!r.zone || r.zone.code !== 'SURCO-B' || r.by !== 'POLYGON') throw new Error('Zona asignada: ' + (r.zone ? r.zone.code + ' por ' + r.by : 'ninguna'));
    if ('Frente al parque'.length !== 16) throw new Error('Largo de referencia');
    throwsCode(() => saveAddress('cu-0001', { label: 'Prueba 2', address_line: 'Av. Los Próceres 1250', district: 'Santiago de Surco', reference: 'casa', lat: -12.135, lng: -76.990 }), 'RN-CLI-02');
  });
  T('CA-CLI-03: Surco-B S/ 10 gratis desde 3 u: 2 cuyes → S/ 10; 3 cuyes → S/ 0; 3,2 kg de conejo → S/ 0', async () => {
    const z = D.get('delivery_zones', 'dz-SURCO-B');
    if (z.delivery_fee !== 10 || z.free_from_units !== 3 || z.free_from_kg !== 3) throw new Error('La zona Surco-B no tiene la tarifa del criterio');
    const at = { lat: -12.135, lng: -76.99 };
    const a = quote(Object.assign({ lines: [{ variant_id: 'va-DG-CUY-ENT', qty: 2 }] }, at)), b = quote(Object.assign({ lines: [{ variant_id: 'va-DG-CUY-ENT', qty: 3 }] }, at)), c = quote(Object.assign({ lines: [{ variant_id: 'va-DG-CON-TRZ', qty: 3.2 }] }, at));
    if (a.zone.code !== 'SURCO-B' || a.fee !== 10) throw new Error('2 cuyes: ' + a.fee);
    if (b.fee !== 0) throw new Error('3 cuyes: ' + b.fee);
    if (c.fee !== 0) throw new Error('3,2 kg de conejo: ' + c.fee);
  });
  T('CA-CLI-04: RUC 20100070970 válido; 20100070971 inválido', async () => {
    if (!rucIsValid('20100070970')) throw new Error('20100070970 debería ser válido');
    if (rucIsValid('20100070971')) throw new Error('20100070971 debería ser inválido');
    const bad = lookupDoc('RUC', '20100070971'); if (bad.ok || !/RN-CLI-03/.test(bad.error)) throw new Error('El proveedor debería rechazar el RUC con dígito inválido');
    if (!lookupDoc('RUC', '20100070970').ok) throw new Error('El proveedor debería aceptar el RUC válido');
  });
  T('CA-CLI-05: mismo celular desde 2 de los 6 números de WhatsApp → CLI-10 muestra «mismo celular»; al fusionar, los pedidos quedan en el sobreviviente', async () => {
    const wa = D.where('messaging_channels', ch => ch.kind === 'WHATSAPP');
    const a = create({ phone: '956 123 789', full_name: 'Teresa Gómez', origin_wa_number: wa[0].number, source_channel: 'WHATSAPP' }).customer;
    const r2 = create({ phone: '+51956123789', full_name: 'Tere Gómez', origin_wa_number: wa[3].number, source_channel: 'WHATSAPP' });
    const cand = r2.duplicates.find(d => d.duplicate_of_id === a.id && d.match_reason === 'SAME_PHONE' && d.status === 'OPEN');
    if (!cand) throw new Error('No se registró el posible duplicado por mismo celular');
    G.go('CLI-10'); await new Promise(r => setTimeout(r, 20));
    if (!/Mismo celular/.test(document.querySelector('.main').textContent) || !/Tere Gómez/.test(document.querySelector('.main').textContent)) throw new Error('CLI-10 no muestra el par');
    const o1 = G.orders.create({ customer_id: a.id, brand_id: 'br-DG', channel: 'WHATSAPP', origin_wa_number: wa[0].number, lines: [{ variant_id: 'va-DG-CAL-1L', qty: 1 }] });
    const o2 = G.orders.create({ customer_id: r2.customer.id, brand_id: 'br-M3', channel: 'WHATSAPP', origin_wa_number: wa[3].number, lines: [{ variant_id: 'va-M3-CHO-500', qty: 1 }] });
    merge(a.id, r2.customer.id, 'Misma clienta escribió a dos números');
    if (D.get('sales_orders', o1.id).customer_id !== a.id || D.get('sales_orders', o2.id).customer_id !== a.id) throw new Error('Los pedidos no quedaron en el sobreviviente');
    const m = cust(r2.customer.id); if (m.merged_into_id !== a.id || m.status !== 'INACTIVE') throw new Error('El fusionado no quedó inactivo con merged_into_id');
    if (D.get('customer_duplicate_candidates', cand.id).status !== 'MERGED') throw new Error('El par no quedó como fusionado');
    throwsCode(() => unblock(m.id), 'RN-CLI-08');
  });
  T('CA-CLI-06: pin en (0, 0) → RN-CLI-04', async () => {
    throwsCode(() => saveAddress('cu-0001', { label: 'Prueba', address_line: 'Calle Falsa 123', district: 'Miraflores', reference: 'Frente al parque central', lat: 0, lng: 0 }), 'RN-CLI-04');
  });
})();
