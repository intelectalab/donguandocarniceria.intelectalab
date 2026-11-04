/* =====================================================================
   Datos maestros y transaccionales de ejemplo · AGROPECUARIA DON GUANDO SAC
   (seed orden 0 = maestros; orden 5 = historial de pedidos, comprobantes y cobros)
   Los módulos agregan sus propios datos con G.seed(orden, fn).
   ===================================================================== */
(function () {
  const ins = (t, r) => G.db.insert(t, r, { silent: true });
  const U = G.util;
  G.DATA = {}; // catálogos de apoyo para los generadores (nombres, coordenadas)

  /** RUC con dígito verificador válido (algoritmo SUNAT módulo 11) */
  U.rucCheck = function (first10) { const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < 10; i++) s += Number(first10[i]) * w[i]; let r = 11 - (s % 11); if (r === 10) r = 0; if (r === 11) r = 1; return first10 + r; };
  U.rucOk = function (ruc) { return /^(10|15|17|20)\d{9}$/.test(String(ruc || '')) && U.rucCheck(String(ruc).slice(0, 10)) === String(ruc); };
  U.dniOk = d => /^\d{8}$/.test(String(d || ''));
  U.phoneOk = p => /^\+[0-9]{8,15}$/.test(String(p || ''));

  G.seed(0, function seedMaestros() {
    const r = U.rng(20261010);
    /* ---------- empresas (tenants) ---------- */
    ins('tenants', { id: 'DG', tenant: null, name: 'AGROPECUARIA DON GUANDO SAC', short: 'Don Guando', plan: 'PILOTO', status: 'ACTIVE', hostname: 'donguando.aycha.pe' });
    ins('tenants', { id: 'CS', tenant: null, name: 'CARNES SELECTAS DEL SUR SAC', short: 'Carnes Selectas', plan: 'CRECER', status: 'ACTIVE', hostname: 'carnesselectas.aycha.pe' });
    const RUC_DG = U.rucCheck('2060914725');
    ins('companies', { id: 'co-dg', legal_name: 'AGROPECUARIA DON GUANDO SAC', ruc: RUC_DG, trade_name: 'Don Guando', tax_regime: 'MYPE', fiscal_address: 'Av. Los Próceres 1240, Santiago de Surco, Lima', fiscal_ubigeo: '150140', status: 'ACTIVE', default_currency: 'PEN', timezone: 'America/Lima' });
    /* ---------- locales ---------- */
    ins('establishments', { id: 'es-L1', company_id: 'co-dg', code: 'L1', name: 'Local 1 · Surco (producción y mostrador)', short: 'Local 1', sunat_code: '0000', est_type: 'MIXED', address: 'Av. Los Próceres 1240, Santiago de Surco', ubigeo: '150140', lat: -12.1385, lng: -76.9905, status: 'ACTIVE', has_counter: true });
    ins('establishments', { id: 'es-L2', company_id: 'co-dg', code: 'L2', name: 'Local 2 · Lurín (producción)', short: 'Local 2', sunat_code: '0001', est_type: 'PLANT', address: 'Calle Los Huertos 315, Lurín', ubigeo: '150119', lat: -12.2745, lng: -76.8700, status: 'ACTIVE', has_counter: false });
    /* ---------- marcas (todas facturan con el mismo RUC) ---------- */
    const BR = [
      ['DG', 'Don Guando', '#922242', 'Carnes de granja: cuy, conejo, aves, cordero, caldos y embutidos', 'www.donguando.com'],
      ['M2', 'Marca 2 · Cortes', '#6D102B', 'Cortes especiales de cerdo y res', null],
      ['M3', 'Marca 3 · Embutidos', '#B9781A', 'Embutidos artesanales', null],
      ['M4', 'Marca 4 · Despensa', '#2F7A43', 'Caldos, mantecas, aceitunas y consumo diario', null],
      ['M5', 'Marca 5 · Gourmet', '#2A6A8C', 'Café, frutos secos, mermeladas e infusiones', null],
    ];
    BR.forEach(([code, name, color, desc, web], i) => ins('brands', { id: 'br-' + code, company_id: 'co-dg', code, name, primary_color: color, description: desc, website: web, legal_footer: `Representación impresa del comprobante electrónico · ${name} es una marca de AGROPECUARIA DON GUANDO SAC · RUC ${RUC_DG}`, whatsapp_display_name: name.split(' · ')[0], status: 'ACTIVE', sort_order: i + 1 }));
    /* ---------- centros de costo ---------- */
    const CC = [
      ['PROD-L1', 'Producción Local 1', 'PRODUCTION', 'es-L1', null], ['PROD-L2', 'Producción Local 2', 'PRODUCTION', 'es-L2', null],
      ['CAL', 'Calidad', 'QUALITY', null, null], ['ALM-L1', 'Almacén Local 1', 'WAREHOUSE', 'es-L1', null], ['ALM-L2', 'Almacén Local 2', 'WAREHOUSE', 'es-L2', null],
      ['DEL', 'Delivery y reparto', 'DELIVERY', 'es-L1', null], ['VEN-MOS', 'Mostrador Local 1', 'SALES', 'es-L1', null],
      ...BR.map(([c, n]) => ['VEN-' + c, 'Ventas ' + n.split(' · ')[0], 'SALES', null, 'br-' + c]),
      ...BR.map(([c, n]) => ['MKT-' + c, 'Marketing ' + n.split(' · ')[0], 'MARKETING', null, 'br-' + c]),
      ['ADM', 'Administración', 'ADMIN', null, null], ['FIN', 'Finanzas y contabilidad', 'FINANCE', null, null], ['RRHH', 'Recursos humanos', 'HR', null, null],
    ];
    CC.forEach(([code, name, area, est, br]) => ins('cost_centers', { id: 'cc-' + code, company_id: 'co-dg', code, name, area, establishment_id: est, brand_id: br, status: 'ACTIVE' }));
    /* ---------- series (RN-PLT-03) ---------- */
    BR.forEach(([c], i) => {
      const n = i + 1;
      ins('document_series', { id: `se-F00${n}`, company_id: 'co-dg', establishment_id: 'es-L1', brand_id: 'br-' + c, doc_type: 'INVOICE', series: `F00${n}`, next_number: 1, is_electronic: true, status: 'ACTIVE' });
      ins('document_series', { id: `se-B00${n}`, company_id: 'co-dg', establishment_id: 'es-L1', brand_id: 'br-' + c, doc_type: 'RECEIPT', series: `B00${n}`, next_number: 1, is_electronic: true, status: 'ACTIVE' });
      ins('document_series', { id: `se-FC0${n}`, company_id: 'co-dg', establishment_id: 'es-L1', brand_id: 'br-' + c, doc_type: 'CREDIT_NOTE', series: `FC0${n}`, next_number: 1, is_electronic: true, status: 'ACTIVE', applies_to: 'INVOICE' });
      ins('document_series', { id: `se-BC0${n}`, company_id: 'co-dg', establishment_id: 'es-L1', brand_id: 'br-' + c, doc_type: 'CREDIT_NOTE', series: `BC0${n}`, next_number: 1, is_electronic: true, status: 'ACTIVE', applies_to: 'RECEIPT' });
    });
    ins('document_series', { id: 'se-B010', company_id: 'co-dg', establishment_id: 'es-L1', brand_id: null, doc_type: 'RECEIPT', series: 'B010', next_number: 1, is_electronic: true, status: 'ACTIVE', note: 'Mostrador Local 1 (todas las marcas)' });
    ins('document_series', { id: 'se-T001', company_id: 'co-dg', establishment_id: 'es-L1', brand_id: null, doc_type: 'DISPATCH_GUIDE', series: 'T001', next_number: 1, is_electronic: true, status: 'ACTIVE' });
    ins('document_series', { id: 'se-T002', company_id: 'co-dg', establishment_id: 'es-L2', brand_id: null, doc_type: 'DISPATCH_GUIDE', series: 'T002', next_number: 1, is_electronic: true, status: 'ACTIVE' });
    [['INTERNAL_NOTE', 'NI01'], ['PURCHASE_ORDER', 'OC01'], ['PRODUCTION_ORDER', 'OP01'], ['QUOTE', 'CT01'], ['CONSIGNMENT_NOTE', 'NC01'], ['JOURNAL', 'AS01']].forEach(([t, s]) => ins('document_series', { id: 'se-' + s, company_id: 'co-dg', establishment_id: null, brand_id: null, doc_type: t, series: s, next_number: 1, is_electronic: false, status: 'ACTIVE' }));
    /* ---------- períodos (ene–ago cerrados; set en cierre pendiente; oct abierto) ---------- */
    for (let m = 1; m <= 10; m++) { const p = `2026-${U.pad(m, 2)}-01`; ins('accounting_periods', { id: 'pe-' + p.slice(0, 7), company_id: 'co-dg', period: p, status: m <= 8 ? 'CLOSED' : 'OPEN', closed_at: m <= 8 ? G.date.add(G.date.addMonths(p, 1), 14) + 'T18:00' : null, closed_by: m <= 8 ? 'Contadora' : null }); }
    /* ---------- módulos activables: todo encendido salvo TEL (incluido y apagado) ---------- */
    for (const [code, m] of Object.entries(G.SPEC)) ins('tenant_modules', { id: 'tm-' + code, module_code: code, phase: m.phase, enabled: code !== 'TEL', changed_at: '2026-10-01T09:00', changed_by: 'Luis Ccahuana', reason: code === 'TEL' ? 'Incluido y desactivado por decisión de gerencia (activar más adelante)' : 'Puesta en marcha' });
    /* ---------- unidades, medios de pago, tipo de cambio ---------- */
    [['NIU', 'Unidad', 'UNIT'], ['KGM', 'Kilogramo', 'WEIGHT'], ['GRM', 'Gramo', 'WEIGHT'], ['LTR', 'Litro', 'VOLUME'], ['MLT', 'Mililitro', 'VOLUME'], ['BX', 'Caja', 'UNIT'], ['PK', 'Paquete', 'UNIT']].forEach(([c, n, k]) => ins('units_of_measure', { id: 'um-' + c, code: c, name: n, kind: k, sunat_code: c }));
    [['CASH', 'Efectivo', 'CASH', false, true], ['YAPE', 'Yape', 'WALLET', true, true], ['PLIN', 'Plin', 'WALLET', true, true], ['CARD', 'Tarjeta (POS Visa)', 'CARD', true, true], ['MP', 'Mercado Pago (web)', 'GATEWAY', true, false], ['TRANSFER', 'Transferencia bancaria', 'BANK', true, false], ['CREDIT', 'Crédito (B2B)', 'CREDIT', false, false]].forEach(([c, n, k, ref, cod]) => ins('payment_methods', { id: 'pm-' + c, code: c, name: n, kind: k, requires_reference: ref, allowed_on_delivery: cod, status: 'ACTIVE' }));
    for (let i = 0; i < 15; i++) { const d = G.date.add(G.TODAY, -i); ins('exchange_rates', { id: 'fx-' + d, date: d, currency: 'USD', buy: U.round(3.72 + (r() - 0.5) * 0.04, 3), sell: U.round(3.74 + (r() - 0.5) * 0.04, 3), source: 'SUNAT' }); }

    /* ---------- trabajadores y usuarios ---------- */
    const EMP = [
      // [rol, nombre, cargo, local, marcas]
      ['GERENTE', 'Rosa Quispe Huamán', 'Gerente general', 'es-L1', []],
      ['ADMIN_SISTEMA', 'Luis Ccahuana Rojas', 'Administrador del sistema', 'es-L1', []],
      ['ADMINISTRACION', 'Carmen Huamán Soto', 'Jefa de administración', 'es-L1', []],
      ['SUPERVISORA_VENTAS', 'Patricia León Vera', 'Supervisora de ventas', 'es-L1', []],
      ['VENDEDORA', 'Ana Torres Lazo', 'Vendedora', 'es-L1', ['br-DG']],
      ['VENDEDORA', 'Betty Ramos Cruz', 'Vendedora', 'es-L1', ['br-DG']],
      ['VENDEDORA', 'Carla Núñez Pinto', 'Vendedora', 'es-L1', ['br-M2', 'br-M3']],
      ['VENDEDORA', 'Diana Flores Ríos', 'Vendedora', 'es-L1', ['br-M4', 'br-M5']],
      ['VENDEDORA', 'Elena Vargas Meza', 'Vendedora', 'es-L1', ['br-DG', 'br-M5']],
      ['CAJERO', 'Jorge Salas Pérez', 'Cajero de mostrador', 'es-L1', []],
      ['ALMACENERO', 'Miguel Torres Ayala', 'Almacenero Local 1', 'es-L1', []],
      ['ALMACENERO', 'Iván Rojas Quispe', 'Almacenero Local 2', 'es-L2', []],
      ['PREPARADOR', 'Sonia Mamani Cáceres', 'Preparadora', 'es-L1', []],
      ['PREPARADOR', 'Willy Huanca Cori', 'Preparador', 'es-L1', []],
      ['COORDINADOR_DELIVERY', 'Raúl Chávez Ortiz', 'Coordinador de delivery', 'es-L1', []],
      ['REPARTIDOR', 'Pedro Condori Ari', 'Repartidor (moto)', 'es-L1', []],
      ['REPARTIDOR', 'Hugo Ticona Laura', 'Repartidor (furgoneta)', 'es-L1', []],
      ['REPARTIDOR', 'Julio Choque Mena', 'Repartidor (moto alquilada)', 'es-L2', []],
      ['MARKETING', 'Lucía Paredes Gil', 'Analista de marketing', 'es-L1', []],
      ['JEFE_PRODUCCION', 'Óscar Lazo Villa', 'Jefe de producción', 'es-L2', []],
      ['OPERARIO_PRODUCCION', 'Nilda Poma Ccori', 'Operaria de producción', 'es-L2', []],
      ['OPERARIO_PRODUCCION', 'Víctor Apaza Luna', 'Operario de cortes', 'es-L1', []],
      ['CALIDAD', 'Silvia Ramos Tello', 'Responsable de calidad', 'es-L2', []],
      ['COMPRAS', 'Diego Flores Vega', 'Asistente de compras', 'es-L1', []],
      ['CONTADORA', 'CPC Marisol Cárdenas', 'Contadora', 'es-L1', []],
      ['PRACTICANTE_CONTABLE', 'Kevin Huerta Salinas', 'Practicante contable', 'es-L1', []],
      ['PRACTICANTE_CONTABLE', 'Andrea Cusi Palomino', 'Practicante contable', 'es-L1', []],
      ['VISITADOR_CONSIGNACION', 'Marco Villa Arenas', 'Visitador de consignación', 'es-L1', []],
      ['RRHH', 'Gabriela Soto Ruiz', 'Asistente de RR. HH.', 'es-L1', []],
      ['AUDITOR', 'Auditor externo', 'Auditoría', 'es-L1', []],
    ];
    const mail = n => n.replace(/^CPC /, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(' ').slice(0, 2).map((x, i) => i === 0 ? x[0] : x).join('') + '@donguando.pe';
    EMP.forEach(([role, name, position, est, brands], i) => {
      const dni = String(40123000 + i * 1371);
      const emp = ins('employees', { id: 'em-' + dni, doc_type: 'DNI', doc_number: dni, full_name: name, position, establishment_id: est, hire_date: G.date.add('2023-03-01', i * 23), phone: '+5199' + U.pad(1200000 + i * 3711, 7), status: 'ACTIVE', monthly_salary: { GERENTE: 6500, ADMINISTRACION: 4200, CONTADORA: 4500, SUPERVISORA_VENTAS: 3200, VENDEDORA: 1500, JEFE_PRODUCCION: 3800, CALIDAD: 2800, COORDINADOR_DELIVERY: 2600, REPARTIDOR: 1400, PRACTICANTE_CONTABLE: 1130, ADMIN_SISTEMA: 3500, MARKETING: 2800 }[role] || 1600 });
      if (role === 'AUDITOR') emp.status = 'ACTIVE';
      const id = 'us-' + mail(name).split('@')[0];
      ins('users', { id, employee_id: emp.id, name, email: mail(name), role, brands, sites: role === 'ALMACENERO' || role === 'REPARTIDOR' || role === 'OPERARIO_PRODUCCION' ? [est] : [], status: 'ACTIVE', twofa_enabled: ['GERENTE', 'ADMIN_SISTEMA', 'CONTADORA', 'ADMINISTRACION'].includes(role), last_login: G.date.add(G.TODAY, -(i % 4)) + 'T0' + (7 + i % 3) + ':1' + (i % 6) });
    });
    // usuario del portal B2B (cliente El Cuy Dorado) y soporte de Intelectalab (acceso temporal, OPS)
    ins('users', { id: 'us-portal-cuydorado', name: 'Mario Gálvez (El Cuy Dorado)', email: 'compras@elcuydorado.pe', role: 'CLIENTE_B2B', customer_id: 'cu-B001', brands: [], sites: [], status: 'ACTIVE', twofa_enabled: false, last_login: '2026-10-09T18:20' });
    ins('users', { id: 'us-soporte', name: 'Soporte Intelectalab', email: 'soporte@intelectalab.com', role: 'SOPORTE_PLATAFORMA', brands: [], sites: [], status: 'ACTIVE', twofa_enabled: false, platform: true, last_login: '2026-10-07T11:00' });
    // trabajadores sin usuario
    [['Teodoro Mayta Cruz', 'Operario de empaque', 'es-L2'], ['Rosa Inga Paucar', 'Operaria de caldos', 'es-L2'], ['Felipe Ñahui Rojas', 'Ayudante de almacén', 'es-L1'], ['Lidia Vilca Torres', 'Limpieza y desinfección', 'es-L2']].forEach(([n, p, e], i) => ins('employees', { id: 'em-4520' + U.pad(i, 4), doc_type: 'DNI', doc_number: '4520' + U.pad(i, 4), full_name: n, position: p, establishment_id: e, hire_date: '2024-02-01', phone: '+51987' + U.pad(600100 + i * 77, 6), status: 'ACTIVE', monthly_salary: 1250 }));

    /* ---------- categorías y catálogo ---------- */
    const CATS = [['CUY', 'Cuy', 'CUY'], ['CONEJO', 'Conejo', 'CONEJO'], ['AVES', 'Aves de corral', 'AVES'], ['CORDERO', 'Cordero', 'CORDERO'], ['CERDO', 'Cerdo', 'CERDO'], ['RES', 'Res', 'RES'], ['CALDOS', 'Caldos', 'CALDOS'], ['EMBUTIDOS', 'Embutidos', 'EMBUTIDOS'], ['MANTECA', 'Mantecas', 'MANTECA'], ['ABARROTES', 'Despensa', 'ABARROTES'], ['CAFE', 'Café', 'CAFE'], ['FRUTOS_SECOS', 'Frutos secos', 'FRUTOS_SECOS'], ['MERMELADAS', 'Mermeladas', 'MERMELADAS'], ['INFUSIONES', 'Infusiones', 'INFUSIONES'], ['INSUMOS', 'Insumos de producción', 'OTROS'], ['EMPAQUES', 'Empaques', 'OTROS'], ['MP', 'Materia prima cárnica', 'OTROS']];
    CATS.forEach(([c, n, l]) => ins('product_categories', { id: 'pc-' + c, code: c, name: n, line: l }));
    // [código, marca, categoría, nombre, origen, conservación, vida útil, autoridad, [[sku, nombre, modo, kg nominal, precio, costo, tolerancia]]]
    const P = [
      ['CUY-ENT', 'DG', 'CUY', 'Cuy entero', 'PRODUCED', 'CHILLED', 7, 'SENASA', [['DG-CUY-ENT', 'Cuy entero beneficiado', 'UNIT_VARIABLE_WEIGHT', 0.9, 42, 26.5, 10], ['DG-CUY-MIT', 'Cuy en mitades', 'UNIT_VARIABLE_WEIGHT', 0.9, 44, 27.2, 10], ['DG-CUY-DES', 'Cuy deshuesado al vacío', 'KG', null, 68, 41.0, 5]]],
      ['CUY-FRZ', 'DG', 'CUY', 'Cuy entero congelado', 'PRODUCED', 'FROZEN', 90, 'SENASA', [['DG-CUY-CNG', 'Cuy entero congelado', 'UNIT_VARIABLE_WEIGHT', 0.85, 40, 25.8, 10]]],
      ['CON-ENT', 'DG', 'CONEJO', 'Conejo', 'PRODUCED', 'CHILLED', 7, 'SENASA', [['DG-CON-ENT', 'Conejo entero', 'UNIT_VARIABLE_WEIGHT', 1.6, 32, 19.5, 10], ['DG-CON-TRZ', 'Conejo trozado', 'KG', null, 34, 21.0, 5]]],
      ['POL-CRL', 'DG', 'AVES', 'Pollo de corral', 'RESALE', 'CHILLED', 6, 'SENASA', [['DG-POL-ENT', 'Pollo de corral entero', 'UNIT_VARIABLE_WEIGHT', 2.2, 22, 14.2, 10], ['DG-POL-PEC', 'Pechuga de pollo de corral', 'KG', null, 28, 18.5, 5]]],
      ['PAT-ENT', 'DG', 'AVES', 'Pato', 'PRODUCED', 'CHILLED', 6, 'SENASA', [['DG-PAT-ENT', 'Pato entero', 'UNIT_VARIABLE_WEIGHT', 2.5, 30, 19.0, 10]]],
      ['GAL-CRL', 'DG', 'AVES', 'Gallina de corral', 'PRODUCED', 'CHILLED', 6, 'SENASA', [['DG-GAL-ENT', 'Gallina de corral entera', 'UNIT_VARIABLE_WEIGHT', 1.9, 24, 15.5, 10]]],
      ['COR-PIE', 'DG', 'CORDERO', 'Cordero', 'RESALE', 'CHILLED', 7, 'SENASA', [['DG-COR-PIE', 'Pierna de cordero', 'KG', null, 48, 33.0, 5], ['DG-COR-COS', 'Costillar de cordero', 'KG', null, 52, 35.5, 5]]],
      ['CAL-HUE', 'DG', 'CALDOS', 'Caldo de huesos', 'PRODUCED', 'FROZEN', 120, 'DIGESA', [['DG-CAL-1L', 'Caldo de huesos 1 L', 'UNIT', null, 18, 7.4, null], ['DG-CAL-500', 'Caldo de cuy 500 ml', 'UNIT', null, 14, 5.9, null]]],
      ['EMB-CHO', 'DG', 'EMBUTIDOS', 'Chorizo de cuy', 'PRODUCED', 'CHILLED', 21, 'DIGESA', [['DG-CHO-500', 'Chorizo de cuy 500 g', 'UNIT', null, 26, 12.8, null]]],
      ['BOND', 'M2', 'CERDO', 'Bondiola de cerdo', 'PRODUCED', 'CHILLED', 10, 'SENASA', [['M2-BON-KG', 'Bondiola de cerdo', 'KG', null, 38, 24.0, 5]]],
      ['PANC', 'M2', 'CERDO', 'Panceta de cerdo', 'PRODUCED', 'CHILLED', 10, 'SENASA', [['M2-PAN-KG', 'Panceta de cerdo', 'KG', null, 36, 22.5, 5], ['M2-PAN-AHU', 'Panceta ahumada 500 g', 'UNIT', null, 24, 13.1, null]]],
      ['LOMO', 'M2', 'RES', 'Lomo fino de res', 'RESALE', 'CHILLED', 10, 'SENASA', [['M2-LOM-KG', 'Lomo fino de res', 'KG', null, 85, 61.0, 5]]],
      ['ASAD', 'M2', 'RES', 'Asado de tira', 'PRODUCED', 'CHILLED', 10, 'SENASA', [['M2-ASA-KG', 'Asado de tira', 'KG', null, 42, 28.0, 5]]],
      ['CHUL', 'M2', 'CERDO', 'Chuleta de cerdo', 'PRODUCED', 'CHILLED', 8, 'SENASA', [['M2-CHU-KG', 'Chuleta de cerdo', 'KG', null, 30, 19.2, 5]]],
      ['CHOR', 'M3', 'EMBUTIDOS', 'Chorizo parrillero', 'PRODUCED', 'CHILLED', 21, 'DIGESA', [['M3-CHO-500', 'Chorizo parrillero 500 g', 'UNIT', null, 24, 11.4, null], ['M3-CHO-1K', 'Chorizo parrillero 1 kg', 'UNIT', null, 44, 21.9, null]]],
      ['SALH', 'M3', 'EMBUTIDOS', 'Salchicha huachana', 'PRODUCED', 'CHILLED', 21, 'DIGESA', [['M3-HUA-500', 'Salchicha huachana 500 g', 'UNIT', null, 16, 7.6, null]]],
      ['JAMO', 'M3', 'EMBUTIDOS', 'Jamón ahumado', 'PRODUCED', 'CHILLED', 30, 'DIGESA', [['M3-JAM-250', 'Jamón ahumado 250 g', 'UNIT', null, 19, 9.3, null], ['M3-JAM-KG', 'Jamón ahumado por kg', 'KG', null, 64, 33.0, 5]]],
      ['MORC', 'M3', 'EMBUTIDOS', 'Morcilla', 'PRODUCED', 'CHILLED', 14, 'DIGESA', [['M3-MOR-500', 'Morcilla 500 g', 'UNIT', null, 15, 6.8, null]]],
      ['MANT', 'M4', 'MANTECA', 'Manteca de cerdo', 'PRODUCED', 'AMBIENT', 180, 'DIGESA', [['M4-MAN-500', 'Manteca de cerdo 500 g', 'UNIT', null, 15, 6.1, null]]],
      ['CALG', 'M4', 'CALDOS', 'Caldo de gallina', 'PRODUCED', 'FROZEN', 120, 'DIGESA', [['M4-CGA-1L', 'Caldo de gallina 1 L', 'UNIT', null, 17, 6.9, null]]],
      ['ACEI', 'M4', 'ABARROTES', 'Aceitunas de botija', 'RESALE', 'AMBIENT', 365, 'DIGESA', [['M4-ACE-500', 'Aceitunas negras de botija 500 g', 'UNIT', null, 16, 9.0, null]]],
      ['MIEL', 'M4', 'ABARROTES', 'Miel de abeja', 'RESALE', 'AMBIENT', 720, 'DIGESA', [['M4-MIE-500', 'Miel de abeja 500 g', 'UNIT', null, 25, 15.0, null]]],
      ['CAFE', 'M5', 'CAFE', 'Café de altura', 'PRODUCED', 'AMBIENT', 270, 'DIGESA', [['M5-CAF-250', 'Café tostado molido 250 g', 'UNIT', null, 32, 14.5, null], ['M5-CAF-G500', 'Café en grano 500 g', 'UNIT', null, 55, 25.0, null]]],
      ['ALME', 'M5', 'FRUTOS_SECOS', 'Almendras', 'RESALE', 'AMBIENT', 240, 'DIGESA', [['M5-ALM-250', 'Almendras tostadas 250 g', 'UNIT', null, 22, 12.4, null]]],
      ['NUEZ', 'M5', 'FRUTOS_SECOS', 'Nueces', 'RESALE', 'AMBIENT', 240, 'DIGESA', [['M5-NUE-250', 'Nueces peladas 250 g', 'UNIT', null, 24, 13.6, null], ['M5-MIX-200', 'Mix de frutos secos 200 g', 'UNIT', null, 19, 9.9, null]]],
      ['MERM', 'M5', 'MERMELADAS', 'Mermelada artesanal', 'PRODUCED', 'AMBIENT', 180, 'DIGESA', [['M5-MER-AGU', 'Mermelada de aguaymanto 250 g', 'UNIT', null, 16, 6.2, null], ['M5-MER-FRE', 'Mermelada de fresa 250 g', 'UNIT', null, 15, 5.8, null]]],
      ['INFU', 'M5', 'INFUSIONES', 'Infusiones andinas', 'RESALE', 'AMBIENT', 365, 'DIGESA', [['M5-INF-MUN', 'Infusión de muña x 20 sobres', 'UNIT', null, 9, 3.9, null], ['M5-INF-HLU', 'Infusión de hierbaluisa x 20 sobres', 'UNIT', null, 9, 3.8, null]]],
      // insumos, empaques y materia prima (no se venden)
      ['MP-CUY', 'DG', 'MP', 'Cuy en canal (de granja)', 'RAW_MATERIAL', 'CHILLED', 4, 'SENASA', [['MP-CUY-CAN', 'Cuy en canal', 'KG', null, 0, 24.0, 5]]],
      ['MP-CON', 'DG', 'MP', 'Conejo en canal (de granja)', 'RAW_MATERIAL', 'CHILLED', 4, 'SENASA', [['MP-CON-CAN', 'Conejo en canal', 'KG', null, 0, 17.5, 5]]],
      ['MP-CER', 'M2', 'MP', 'Cerdo en media res', 'RAW_MATERIAL', 'CHILLED', 5, 'SENASA', [['MP-CER-MR', 'Cerdo media res', 'KG', null, 0, 12.8, 5]]],
      ['MP-HUE', 'DG', 'MP', 'Huesos para caldo', 'RAW_MATERIAL', 'FROZEN', 30, 'SENASA', [['MP-HUE-KG', 'Huesos de res y cuy', 'KG', null, 0, 3.2, 5]]],
      ['IN-SAL', 'DG', 'INSUMOS', 'Sal de cocina', 'RAW_MATERIAL', 'AMBIENT', 720, 'NONE', [['IN-SAL-KG', 'Sal de cocina', 'KG', null, 0, 1.2, null]]],
      ['IN-TRI', 'M3', 'INSUMOS', 'Tripa natural de cerdo', 'RAW_MATERIAL', 'CHILLED', 60, 'SENASA', [['IN-TRI-M', 'Tripa natural (madeja)', 'UNIT', null, 0, 38.0, null]]],
      ['IN-ESP', 'M3', 'INSUMOS', 'Mezcla de especias', 'RAW_MATERIAL', 'AMBIENT', 365, 'NONE', [['IN-ESP-KG', 'Especias para chorizo', 'KG', null, 0, 26.0, null]]],
      ['IN-AGU', 'M5', 'INSUMOS', 'Aguaymanto fresco', 'RAW_MATERIAL', 'CHILLED', 10, 'SENASA', [['IN-AGU-KG', 'Aguaymanto fresco', 'KG', null, 0, 7.5, null]]],
      ['IN-AZU', 'M5', 'INSUMOS', 'Azúcar rubia', 'RAW_MATERIAL', 'AMBIENT', 720, 'NONE', [['IN-AZU-KG', 'Azúcar rubia', 'KG', null, 0, 3.6, null]]],
      ['IN-CAV', 'M5', 'INSUMOS', 'Café verde', 'RAW_MATERIAL', 'AMBIENT', 365, 'SENASA', [['IN-CAV-KG', 'Café verde de altura', 'KG', null, 0, 21.0, null]]],
      ['EM-VAC', 'DG', 'EMPAQUES', 'Bolsa al vacío', 'RAW_MATERIAL', 'AMBIENT', 720, 'NONE', [['EM-VAC-2030', 'Bolsa al vacío 20×30', 'UNIT', null, 0, 0.35, null]]],
      ['EM-BOL', 'DG', 'EMPAQUES', 'Bolsa de despacho numerada', 'RAW_MATERIAL', 'AMBIENT', 720, 'NONE', [['EM-BOL-NUM', 'Bolsa de despacho numerada', 'UNIT', null, 0, 0.6, null]]],
      ['EM-ISO', 'DG', 'EMPAQUES', 'Caja isotérmica', 'RAW_MATERIAL', 'AMBIENT', 720, 'NONE', [['EM-ISO-20', 'Caja isotérmica 20 L', 'UNIT', null, 0, 9.5, null]]],
      ['EM-GEL', 'DG', 'EMPAQUES', 'Gel refrigerante', 'RAW_MATERIAL', 'FROZEN', 720, 'NONE', [['EM-GEL-500', 'Gel refrigerante 500 g', 'UNIT', null, 0, 2.1, null]]],
      ['EM-FRA', 'M5', 'EMPAQUES', 'Frasco de vidrio', 'RAW_MATERIAL', 'AMBIENT', 720, 'NONE', [['EM-FRA-250', 'Frasco de vidrio 250 g con tapa', 'UNIT', null, 0, 1.4, null]]],
    ];
    const lineOf = { CUY: 'CUY', CONEJO: 'CONEJO', AVES: 'AVES', CORDERO: 'CORDERO', CERDO: 'CERDO', RES: 'RES', CALDOS: 'CALDOS', EMBUTIDOS: 'EMBUTIDOS', MANTECA: 'MANTECA', ABARROTES: 'ABARROTES', CAFE: 'CAFE', FRUTOS_SECOS: 'FRUTOS_SECOS', MERMELADAS: 'MERMELADAS', INFUSIONES: 'INFUSIONES' };
    let plu = 10001;
    for (const [code, br, cat, name, origin, storage, life, auth, vars] of P) {
      const isInput = ['MP', 'INSUMOS', 'EMPAQUES'].includes(cat);
      const pid = 'pr-' + code;
      ins('products', { id: pid, brand_id: 'br-' + br, category_id: 'pc-' + cat, code, name, line: lineOf[cat] || 'OTROS', product_type: cat === 'EMPAQUES' ? 'PACKAGING' : isInput ? 'INPUT' : 'GOODS', origin, storage, shelf_life_days: life, requires_lot: cat !== 'EMPAQUES', igv_affectation: '10', sanitary_authority: auth, sanitary_registry: auth === 'NONE' ? null : (auth === 'DIGESA' ? 'R.S. N' + U.pad(4300 + plu % 97, 4) + 'N-NADGAN' : 'SENASA-PE-' + U.pad(1500 + plu % 89, 5)), sanitary_registry_expires: auth === 'NONE' ? null : G.date.add('2027-03-01', (plu % 9) * 40 - (code === 'JAMO' ? 175 : 0)), status: 'ACTIVE', web_publishable: !isInput, allow_discount: true, sanitary_alert_days: 60 });
      for (const [sku, vn, mode, nom, price, cost, tol] of vars) {
        const vid = 'va-' + sku;
        ins('product_variants', { id: vid, product_id: pid, brand_id: 'br-' + br, sku, name: vn, barcode: '775' + U.pad(plu * 7 % 1000000000, 10), uom_id: mode === 'UNIT' ? 'um-NIU' : 'um-KGM', sale_mode: mode, nominal_weight_kg: nom, weight_tolerance_pct: tol, min_weight_kg: nom ? U.round(nom * 0.8, 3) : null, max_weight_kg: nom ? U.round(nom * 1.25, 3) : null, scale_plu: mode !== 'UNIT' ? String(plu) : null, status: 'ACTIVE', web_publishable: !isInput, min_order_qty: mode === 'KG' ? 0.5 : 1, qty_step: mode === 'KG' ? 0.25 : 1, std_cost: cost, sellable: !isInput, line: lineOf[cat] || 'OTROS' });
        plu++;
      }
    }
    /* ---------- listas de precio por marca y canal (RN-CAT-05) ---------- */
    for (const [c] of BR) {
      ins('price_lists', { id: `pl-${c}-PUB`, code: `${c}-PUB`, name: `Público ${c} (web, WhatsApp, redes y mostrador)`, brand_id: 'br-' + c, channels: ['WEB', 'WHATSAPP', 'TIKTOK', 'FACEBOOK', 'INSTAGRAM', 'PHONE', 'COUNTER'], includes_igv: true, status: 'ACTIVE', valid_from: '2026-07-01' });
      ins('price_lists', { id: `pl-${c}-B2B`, code: `${c}-B2B`, name: `Restaurantes y negocios ${c}`, brand_id: 'br-' + c, channels: ['B2B', 'CONSIGNMENT'], includes_igv: true, status: 'ACTIVE', valid_from: '2026-07-01' });
    }
    for (const v of G.db.all('product_variants').filter(v => v.sellable)) {
      const br = v.brand_id.slice(3); const basis = v.sale_mode === 'UNIT' ? 'UNIT' : 'KG';
      const price = P.flatMap(p => p[8]).find(x => 'va-' + x[0] === v.id)[4];
      ins('price_list_items', { id: `pll-${br}-PUB-${v.sku}`, list_id: `pl-${br}-PUB`, variant_id: v.id, price, basis, valid_from: '2026-07-01', valid_to: null });
      ins('price_list_items', { id: `pll-${br}-B2B-${v.sku}`, list_id: `pl-${br}-B2B`, variant_id: v.id, price: U.round(price * 0.9, 2), basis, valid_from: '2026-07-01', valid_to: null });
      ins('price_list_items', { id: `pll-${br}-PUBOLD-${v.sku}`, list_id: `pl-${br}-PUB`, variant_id: v.id, price: U.round(price * 0.95, 1), basis, valid_from: '2026-01-01', valid_to: '2026-06-30' });
    }

    /* ---------- zonas de reparto (RN-PED-09: gratis desde 3 unidades o 3 kg) ---------- */
    const Z = [
      ['SURCO-A', 'Surco A (Higuereta – Monterrico)', 'es-L1', 10, -12.130, -76.985, ['Santiago de Surco']], ['SURCO-B', 'Surco B (Chacarilla – Primavera)', 'es-L1', 10, -12.110, -76.990, ['Santiago de Surco']],
      ['MIRAFLORES', 'Miraflores', 'es-L1', 12, -12.121, -77.030, ['Miraflores']], ['SAN-ISIDRO', 'San Isidro', 'es-L1', 12, -12.097, -77.036, ['San Isidro']],
      ['SAN-BORJA', 'San Borja', 'es-L1', 10, -12.100, -76.997, ['San Borja']], ['LA-MOLINA', 'La Molina', 'es-L1', 14, -12.080, -76.940, ['La Molina']],
      ['BARRANCO', 'Barranco', 'es-L1', 12, -12.149, -77.021, ['Barranco']], ['JESUS-MARIA', 'Jesús María y Lince', 'es-L1', 14, -12.078, -77.043, ['Jesús María', 'Lince']],
      ['CHORRILLOS', 'Chorrillos', 'es-L2', 12, -12.170, -77.010, ['Chorrillos']], ['LURIN', 'Lurín y Pachacámac', 'es-L2', 8, -12.274, -76.870, ['Lurín', 'Pachacámac']],
    ];
    Z.forEach(([code, name, est, fee, lat, lng, d], i) => ins('delivery_zones', { id: 'dz-' + code, establishment_id: est, code, name, districts: d, delivery_fee: fee, free_from_units: 3, free_from_kg: 3, free_from_amount: null, min_order_amount: 30, status: 'ACTIVE', priority: 100 + i, province: false, lat, lng, polygon: [[lat + 0.012, lng - 0.014], [lat + 0.012, lng + 0.014], [lat - 0.012, lng + 0.014], [lat - 0.012, lng - 0.014]] }));
    ins('delivery_zones', { id: 'dz-PROVINCIA', establishment_id: 'es-L1', code: 'PROVINCIA', name: 'Envíos a provincia (agencia)', districts: [], delivery_fee: 25, free_from_units: null, free_from_kg: null, min_order_amount: 80, status: 'ACTIVE', priority: 900, province: true });
    G.DATA.zones = Z;

    /* ---------- franjas de entrega (D-PED-02: 3 por día, cupo 40) ---------- */
    [['09:00', '13:00', '07:30'], ['13:00', '17:00', '11:00'], ['17:00', '20:00', '15:00']].forEach(([a, b, cut], i) => {
      for (const est of ['es-L1', 'es-L2']) ins('order_time_slots', { id: `ts-${est.slice(3)}-${i + 1}`, establishment_id: est, zone_id: null, name: `${a}–${b}`, slot_from: a, slot_to: b, cutoff: cut, capacity: est === 'es-L1' ? 40 : 15, weekdays: [1, 2, 3, 4, 5, 6, 0], status: 'ACTIVE' });
    });

    /* ---------- almacenes (2 principales con cámaras) ---------- */
    [['ALM-L1', 'Almacén principal Local 1', 'es-L1', 'MAIN', null, null, 10], ['CAM-L1', 'Cámara de frío Local 1', 'es-L1', 'COLD_ROOM', 0, 4, 20], ['CNG-L1', 'Congeladora Local 1', 'es-L1', 'FREEZER', -22, -18, 30], ['MOS-L1', 'Exhibidora del mostrador', 'es-L1', 'STORE', 0, 4, 5], ['CUA-L1', 'Cuarentena Local 1', 'es-L1', 'QUARANTINE', 0, 4, 999],
      ['ALM-L2', 'Almacén principal Local 2', 'es-L2', 'MAIN', null, null, 40], ['CAM-L2', 'Cámara de frío Local 2', 'es-L2', 'COLD_ROOM', 0, 4, 50], ['CNG-L2', 'Congeladora Local 2', 'es-L2', 'FREEZER', -22, -18, 60], ['PRD-L2', 'Sala de producción Local 2', 'es-L2', 'PRODUCTION', 2, 10, 900], ['DEV-L1', 'Devoluciones Local 1', 'es-L1', 'RETURNS', 0, 4, 999]]
      .forEach(([code, name, est, t, mi, ma, pr]) => ins('warehouses', { id: 'wh-' + code, establishment_id: est, code, name, wh_type: t, min_temp_c: mi, max_temp_c: ma, status: 'ACTIVE', allows_sale: ['MAIN', 'COLD_ROOM', 'FREEZER', 'STORE'].includes(t), pick_priority: pr }));

    /* ---------- proveedores ---------- */
    const S = [
      ['RUC', RUC_DG, 'GRANJA DON GUANDO (UNIDAD DE NEGOCIO)', 'Granja Don Guando', 'RELATED_FARM', 0], ['RUC', U.rucCheck('2055418723'), 'CAMAL SAN PEDRO DE LURÍN SAC', 'Camal San Pedro', 'SLAUGHTERHOUSE', 15],
      ['RUC', U.rucCheck('2060233817'), 'AVÍCOLA LOS ANDES EIRL', 'Avícola Los Andes', 'PRODUCER', 7], ['RUC', U.rucCheck('2048871205'), 'CORDEROS DE HUANCAVELICA SAC', 'Corderos Huancavelica', 'PRODUCER', 15],
      ['RUC', U.rucCheck('2051290011'), 'PORCINOS DEL SUR SAC', 'Porcinos del Sur', 'PRODUCER', 15], ['RUC', U.rucCheck('2060775190'), 'CAFÉS DE ALTURA VILLA RICA SAC', 'Cafés de Altura', 'PRODUCER', 30],
      ['RUC', U.rucCheck('2050011873'), 'EMPAQUES Y BOLSAS DEL PERÚ SAC', 'Empaques del Perú', 'PACKAGING', 30], ['RUC', U.rucCheck('2052219974'), 'INSUMOS CÁRNICOS LIMA SAC', 'Insumos Cárnicos', 'INPUTS', 30],
      ['FOREIGN', 'US-GOOGLE-ADS', 'GOOGLE LLC (Google Ads)', 'Google Ads', 'ADVERTISING', 0], ['FOREIGN', 'IE-META-ADS', 'META PLATFORMS IRELAND LTD', 'Meta Ads', 'ADVERTISING', 0], ['FOREIGN', 'SG-TIKTOK-ADS', 'TIKTOK PTE LTD (TikTok Ads)', 'TikTok Ads', 'ADVERTISING', 0],
      ['DNI', '72041385', 'Valeria Chumpitaz (creadora de contenido)', 'Vale Cocina', 'CONTENT_CREATOR', 0], ['DNI', '70115590', 'Renzo Aliaga (creador de contenido)', 'Renzo Parrillero', 'CONTENT_CREATOR', 0],
      ['RUC', U.rucCheck('2060432871'), 'MENSAJERÍA EXPRESS LIMA SAC', 'Express Lima', 'DELIVERY_COMPANY', 15], ['RUC', U.rucCheck('2049981327'), 'TRANSPORTES ANDINOS CARGO SAC', 'Andinos Cargo (provincia)', 'DELIVERY_COMPANY', 0],
      ['RUC', U.rucCheck('2060551132'), 'ALQUILER DE MOTOS RÁPIDO EIRL', 'Motos Rápido', 'VEHICLE_RENTAL', 7], ['RUC', U.rucCheck('2051177840'), 'SERVICIOS DE REFRIGERACIÓN FRÍO TOTAL SAC', 'Frío Total', 'SERVICES', 15],
    ];
    S.forEach(([dt, dn, ln, tn, t, terms], i) => ins('suppliers', { id: 'su-' + (t === 'RELATED_FARM' ? 'GRANJA' : dn.replace(/[^A-Z0-9]/gi, '').slice(-8)), doc_type: dt, doc_number: dn, legal_name: ln, trade_name: tn, supplier_type: t, phone: '+5101' + U.pad(4300000 + i * 911, 7), email: tn.toLowerCase().replace(/[^a-z]/g, '').slice(0, 12) + '@proveedor.pe', status: 'ACTIVE', payment_terms_days: terms, related_company_id: t === 'RELATED_FARM' ? 'co-dg' : null, sunat_status: dt === 'RUC' ? 'ACTIVE' : 'UNKNOWN', rating: 3 + (i % 3), default_cost_center_id: { ADVERTISING: 'cc-MKT-DG', CONTENT_CREATOR: 'cc-MKT-DG', DELIVERY_COMPANY: 'cc-DEL', VEHICLE_RENTAL: 'cc-DEL', SERVICES: 'cc-ADM' }[t] || 'cc-PROD-L2' }));

    /* ---------- vehículos ---------- */
    [['MTA-123', 'MOTO', 'OWN', null, 'es-L1', 60, false, 'GASOLINE', 0], ['MTB-456', 'MOTO', 'OWN', null, 'es-L1', 60, false, 'GASOLINE', 0], ['BXR-871', 'VAN', 'OWN', null, 'es-L1', 800, true, 'DIESEL', 0], ['MTC-789', 'MOTO', 'RENTED', 'su-' + U.rucCheck('2060551132').slice(-8), 'es-L2', 60, false, 'GASOLINE', 45]]
      .forEach(([plate, t, own, prov, est, cap, ref, fuel, rate], i) => ins('vehicles', { id: 've-' + plate, plate, vehicle_type: t, ownership: own, provider_id: prov, establishment_id: est, capacity_kg: cap, refrigerated: ref, status: 'ACTIVE', fuel_type: fuel, soat_policy_no: 'SOAT-' + (88120 + i), soat_expires_on: G.date.add(G.TODAY, [190, 24, 260, 120][i]), tech_inspection_expires_on: t === 'VAN' ? G.date.add(G.TODAY, 75) : null, odometer_km: [18450, 22710, 64320, 9880][i], rental_daily_rate: rate || null, driver_user_id: [null, null, null, null][i] }));

    /* ---------- cajas, cuentas y billeteras ---------- */
    [['CAJA-L1', 'Caja del mostrador Local 1', 'CASH_REGISTER', 'es-L1', null, null, null, null], ['CCH-L1', 'Caja chica Local 1', 'PETTY_CASH', 'es-L1', null, null, null, null], ['CCH-L2', 'Caja chica Local 2', 'PETTY_CASH', 'es-L2', null, null, null, null],
      ['BCP-CTE', 'BCP cuenta corriente soles', 'BANK', null, 'BCP', '193-2284719-0-55', null, null], ['IBK-CTE', 'Interbank cuenta corriente soles', 'BANK', null, 'Interbank', '200-3001847722', null, null],
      ['YAPE', 'Yape empresa (BCP)', 'WALLET', null, 'BCP', '+51987650001', 0, null], ['PLIN', 'Plin empresa (Interbank)', 'WALLET', null, 'Interbank', '+51987650002', 0, null],
      ['MP', 'Mercado Pago (WooCommerce)', 'GATEWAY', null, 'Mercado Pago', 'MP-9981230', 3.99, 0], ['POS-VISA', 'POS Visa del mostrador y delivery', 'CARD_ACQUIRER', 'es-L1', 'Adquirente Visa', 'COM-445120', 3.44, 0]]
      .forEach(([code, name, t, est, bank, acc, fee, fixed]) => ins('cash_accounts', { id: 'ca-' + code, code, name, account_type: t, establishment_id: est, currency: 'PEN', bank_name: bank, account_number: acc, status: 'ACTIVE', fee_pct: fee, fee_fixed: fixed, settlement_days: t === 'GATEWAY' ? 14 : t === 'CARD_ACQUIRER' ? 2 : 0 }));
    for (const u of G.db.where('users', u => u.role === 'REPARTIDOR')) ins('cash_accounts', { id: 'ca-DRV-' + u.id.slice(3), code: 'DRV-' + u.id.slice(3).toUpperCase(), name: 'Caja del repartidor · ' + u.name.split(' ').slice(0, 2).join(' '), account_type: 'DRIVER_CASH', establishment_id: 'es-L1', holder_employee_id: u.employee_id, user_id: u.id, currency: 'PEN', status: 'ACTIVE', max_balance: 500 });

    /* ---------- canales de mensajería (6 WhatsApp con coexistencia + TikTok, Messenger, Instagram) ---------- */
    const WA = [['DG', '+51987650101', 'Don Guando Ventas 1'], ['DG', '+51987650102', 'Don Guando Ventas 2'], ['M2', '+51987650201', 'Marca 2'], ['M3', '+51987650301', 'Marca 3'], ['M4', '+51987650401', 'Marca 4'], ['M5', '+51987650501', 'Marca 5']];
    WA.forEach(([b, num, n], i) => ins('messaging_channels', { id: 'ch-wa-' + num.slice(-4), kind: 'WHATSAPP', brand_id: 'br-' + b, number: num, display_name: n, coexistence: true, provider: 'CLOUD_API', status: 'ACTIVE', quality_rating: i === 1 ? 'MEDIUM' : 'HIGH', messaging_limit: 1000 }));
    ins('messaging_channels', { id: 'ch-tt-DG', kind: 'TIKTOK', brand_id: 'br-DG', number: '@donguando', display_name: 'TikTok Don Guando', status: 'ACTIVE' });
    ins('messaging_channels', { id: 'ch-tt-M5', kind: 'TIKTOK', brand_id: 'br-M5', number: '@marca5gourmet', display_name: 'TikTok Marca 5', status: 'ACTIVE' });
    ins('messaging_channels', { id: 'ch-fb-DG', kind: 'MESSENGER', brand_id: 'br-DG', number: 'fb.com/donguando', display_name: 'Messenger Don Guando', status: 'ACTIVE' });
    ins('messaging_channels', { id: 'ch-ig-DG', kind: 'INSTAGRAM', brand_id: 'br-DG', number: '@donguando', display_name: 'Instagram Don Guando', status: 'ACTIVE' });
    // miembros por canal: vendedoras según sus marcas
    for (const ch of G.db.all('messaging_channels')) for (const u of G.db.where('users', u => u.role === 'VENDEDORA' && u.brands.includes(ch.brand_id))) ins('channel_members', { id: `cm-${ch.id}-${u.id}`, channel_id: ch.id, user_id: u.id, role: 'AGENT', status: 'ACTIVE' });

    /* ---------- cuentas, campañas y anuncios (dimensión para atribución) ---------- */
    const PLAT = [['GOOGLE', 'Google Ads'], ['META', 'Meta Ads'], ['TIKTOK', 'TikTok Ads']];
    for (const [b] of BR) for (const [p, pn] of PLAT) {
      if (p === 'TIKTOK' && !['DG', 'M5', 'M3'].includes(b)) continue;
      const acc = ins('ad_accounts', { id: `aa-${b}-${p}`, platform: p, brand_id: 'br-' + b, name: `${pn} · ${b}`, external_id: `${p.slice(0, 2)}-${b}-${100200 + b.charCodeAt(1)}`, currency: p === 'GOOGLE' ? 'PEN' : 'USD', status: 'ACTIVE', connected_at: '2026-08-15T10:00' });
      const camps = p === 'META' ? [['CTWA', 'Clic a WhatsApp', 'MESSAGES'], ['CAT', 'Catálogo web', 'SALES']] : p === 'GOOGLE' ? [['SRCH', 'Búsqueda', 'SALES'], ['PMAX', 'Máximo rendimiento', 'SALES']] : [['VID', 'Video a mensaje', 'MESSAGES']];
      for (const [cc, cn, obj] of camps) {
        const camp = ins('ad_campaigns', { id: `ac-${b}-${p}-${cc}`, account_id: acc.id, brand_id: 'br-' + b, platform: p, code: `${b}-${p.slice(0, 2)}-${cc}`, name: `${cn} ${b}`, objective: obj, status: 'ACTIVE', daily_budget: p === 'GOOGLE' ? 60 : 45 });
        for (let k = 1; k <= 2; k++) ins('ad_ads', { id: `ad-${b}-${p}-${cc}-${k}`, campaign_id: camp.id, brand_id: 'br-' + b, platform: p, code: `${b}${p[0]}${cc.slice(0, 2)}${k}`, name: `${cn} · creativo ${k}`, status: 'ACTIVE' });
      }
    }

    /* ---------- clientes con dirección y pin (RN-CLI-02) ---------- */
    const FN = ['María', 'José', 'Lucía', 'Carlos', 'Rosa', 'Jorge', 'Ana', 'Luis', 'Carmen', 'Miguel', 'Sofía', 'Juan', 'Gabriela', 'Pedro', 'Valeria', 'Fernando', 'Patricia', 'Ricardo', 'Daniela', 'Alberto', 'Mónica', 'Raúl', 'Claudia', 'Hugo', 'Paola', 'Andrés', 'Milagros', 'César', 'Teresa', 'Martín'];
    const LN = ['García', 'Rodríguez', 'Flores', 'Sánchez', 'Ramírez', 'Torres', 'Quispe', 'Mendoza', 'Castillo', 'Vargas', 'Chávez', 'Rojas', 'Gutiérrez', 'Romero', 'Salazar', 'Herrera', 'Palacios', 'Benavides', 'Aguilar', 'Cárdenas', 'Paredes', 'Zevallos', 'Málaga', 'Delgado', 'Valdivia'];
    const STREETS = ['Av. Primavera', 'Jr. Las Gardenias', 'Calle Los Pinos', 'Av. Benavides', 'Av. El Polo', 'Calle Monte Rosa', 'Av. Javier Prado Este', 'Jr. Batallón Ayacucho', 'Av. Angamos', 'Calle Las Orquídeas', 'Av. La Molina', 'Av. Huaylas', 'Calle San Martín', 'Av. Larco', 'Av. Arequipa'];
    const REFS = ['Frente al parque', 'Casa blanca de rejas negras', 'Al costado de la farmacia', 'Edificio con portería, dpto 402', 'A media cuadra del grifo', 'Portón verde', 'Esquina con la bodega', 'Condominio, torre B'];
    const zonesL = G.db.where('delivery_zones', z => !z.province);
    const zw = { 'SURCO-A': 18, 'SURCO-B': 16, MIRAFLORES: 11, 'SAN-ISIDRO': 8, 'SAN-BORJA': 10, 'LA-MOLINA': 9, BARRANCO: 6, 'JESUS-MARIA': 6, CHORRILLOS: 8, LURIN: 8 };
    const pickZone = () => { let t = r() * 100; for (const z of zonesL) { t -= zw[z.code] || 0; if (t <= 0) return z; } return zonesL[0]; };
    const NCUST = 420;
    for (let i = 0; i < NCUST; i++) {
      const name = `${U.pick(r, FN)} ${U.pick(r, LN)} ${U.pick(r, LN)}`;
      const dni = String(10000000 + Math.floor(r() * 79999999));
      const z = pickZone();
      const c = ins('customers', { id: 'cu-' + U.pad(i + 1, 4), doc_type: r() < 0.55 ? 'DNI' : 'NONE', doc_number: null, full_name: name, phone: '+519' + U.pad(Math.floor(r() * 99999999), 8), email: r() < 0.6 ? name.split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + (100 + i) + '@correo.pe' : null, customer_type: 'PERSON', source_channel: U.pick(r, ['WHATSAPP', 'WHATSAPP', 'WEB', 'TIKTOK', 'FACEBOOK', 'INSTAGRAM']), marketing_opt_in: r() < 0.62, status: 'ACTIVE', first_order_at: null, last_order_at: null, segment_brands: [] });
      if (c.doc_type === 'DNI') { c.doc_number = dni; c.doc_validated_at = '2026-08-01T10:00'; c.doc_validation_source = 'RENIEC'; }
      ins('customer_addresses', { id: 'ad-' + c.id.slice(3), customer_id: c.id, label: 'Casa', address_line: `${U.pick(r, STREETS)} ${100 + Math.floor(r() * 1800)}, ${z.districts[0]}`, reference: U.pick(r, REFS), ubigeo: '1501', lat: U.round(z.lat + (r() - 0.5) * 0.02, 6), lng: U.round(z.lng + (r() - 0.5) * 0.02, 6), zone_id: z.id, contact_name: name.split(' ').slice(0, 2).join(' '), contact_phone: c.phone, is_default: true, status: 'ACTIVE', pin_source: U.pick(r, ['MAP', 'GPS', 'WEB']) });
    }
    // restaurantes y negocios (B2B), puntos de consignación y la granja como relacionada
    const BIZ = [['RESTAURANT', 'EL CUY DORADO SAC', 'El Cuy Dorado', 'SURCO-A'], ['RESTAURANT', 'PICANTERÍA LA AREQUIPEÑA EIRL', 'La Arequipeña', 'BARRANCO'], ['RESTAURANT', 'PARRILLAS DEL SUR SAC', 'Parrillas del Sur', 'MIRAFLORES'], ['RESTAURANT', 'SABORES DE MI TIERRA SAC', 'Sabores de mi Tierra', 'SAN-BORJA'], ['BUSINESS', 'CATERING EVENTOS LIMA SAC', 'Catering Eventos', 'LA-MOLINA'], ['RESTAURANT', 'LA CASA DEL CONEJO EIRL', 'La Casa del Conejo', 'CHORRILLOS'], ['BUSINESS', 'HOTEL BOUTIQUE MIRAMAR SAC', 'Hotel Miramar', 'MIRAFLORES'], ['RESTAURANT', 'CEVICHERÍA Y CRIOLLO DON LUCHO SAC', 'Don Lucho', 'SURCO-B'],
      ['CONSIGNMENT_POINT', 'MINIMARKET LOS ÁLAMOS EIRL', 'Minimarket Los Álamos', 'SURCO-B'], ['CONSIGNMENT_POINT', 'BODEGA GOURMET SAN ISIDRO SAC', 'Bodega Gourmet', 'SAN-ISIDRO'], ['CONSIGNMENT_POINT', 'MARKET ORGÁNICO LA MOLINA SAC', 'Market Orgánico', 'LA-MOLINA']];
    BIZ.forEach(([t, ln, tn, zc], i) => {
      const z = G.db.get('delivery_zones', 'dz-' + zc);
      const ruc = U.rucCheck('20' + U.pad(60100000 + i * 13579, 8));
      const c = ins('customers', { id: 'cu-B' + U.pad(i + 1, 3), doc_type: 'RUC', doc_number: ruc, full_name: ln, trade_name: tn, phone: '+5199' + U.pad(8800000 + i * 1234, 7), email: tn.toLowerCase().replace(/[^a-z]/g, '').slice(0, 12) + '@empresa.pe', customer_type: t, source_channel: 'B2B', marketing_opt_in: true, status: 'ACTIVE', doc_validated_at: '2026-07-10T09:00', doc_validation_source: 'SUNAT', price_list_id: null, seller_user_id: 'us-pleon' });
      ins('customer_addresses', { id: 'ad-' + c.id.slice(3), customer_id: c.id, label: 'Local', address_line: `${U.pick(r, STREETS)} ${200 + i * 37}, ${z.districts[0]}`, reference: 'Ingreso por cocina / despacho', ubigeo: '1501', lat: U.round(z.lat + (r() - 0.5) * 0.01, 6), lng: U.round(z.lng + (r() - 0.5) * 0.01, 6), zone_id: z.id, contact_name: 'Encargado de compras', contact_phone: c.phone, is_default: true, status: 'ACTIVE', pin_source: 'MAP' });
    });
    ins('customers', { id: 'cu-PROV1', doc_type: 'DNI', doc_number: '45128833', full_name: 'Javier Cusi Mamani', phone: '+51954112233', email: 'jcusi@correo.pe', customer_type: 'PERSON', source_channel: 'WHATSAPP', marketing_opt_in: true, status: 'ACTIVE' });
    ins('customer_addresses', { id: 'ad-PROV1', customer_id: 'cu-PROV1', label: 'Arequipa', address_line: 'Calle Mercaderes 410, Cercado de Arequipa', reference: 'Recoge en agencia Andinos Cargo', ubigeo: '040101', lat: -16.398, lng: -71.536, zone_id: 'dz-PROVINCIA', is_default: true, status: 'ACTIVE', pin_source: 'MAP' });
    ins('customers', { id: 'cu-VARIOS', doc_type: 'NONE', doc_number: null, full_name: 'Clientes varios (mostrador)', phone: null, customer_type: 'OTHER', status: 'ACTIVE', marketing_opt_in: false });
    ins('customers', { id: 'cu-BLOQ', doc_type: 'DNI', doc_number: '09887766', full_name: 'Cliente con deuda bloqueado', phone: '+51911000222', customer_type: 'PERSON', status: 'BLOCKED', blocked_reason: 'Dos pedidos contra entrega rechazados en la puerta', marketing_opt_in: false });

    /* ---------- definiciones de indicadores desde las especificaciones (TAB) ---------- */
    const unitOf = (n, f) => /tiempo|minutos/i.test(n) ? 'MINUTES' : /días|plazo/i.test(n) ? 'DAYS' : /horas/i.test(n) ? 'HOURS' : /%|× 100|tasa|porcentaje|margen|cumplimiento|participación|rendimiento|merma/i.test(f + ' ' + n) ? 'PCT' : /S\/|costo|ventas|monto|ingreso|gasto|ticket|saldo|valor/i.test(n) ? 'PEN' : /kg/i.test(n) ? 'KG' : 'COUNT';
    for (const [m, spec] of Object.entries(G.SPEC)) for (const [code, name, formula, dir] of spec.kpis) ins('kpi_definitions', { id: 'kd-' + code, code, module_code: m, name, formula, unit: unitOf(name, formula), direction: /más bajo|menor/i.test(dir) ? 'LOWER_BETTER' : /meta|objetivo/i.test(dir) && !/más alto/i.test(dir) ? 'TARGET' : 'HIGHER_BETTER', direction_text: dir, phase: spec.phase, frequency: 'MONTHLY', status: 'ACTIVE', requires_module: m });

    /* ---------- segunda empresa (cliente del SaaS) para probar el aislamiento ---------- */
    G.ctx.tenant = 'CS';
    try {
      ins('companies', { id: 'co-cs', legal_name: 'CARNES SELECTAS DEL SUR SAC', ruc: U.rucCheck('2061023344'), trade_name: 'Carnes Selectas', tax_regime: 'MYPE', fiscal_address: 'Av. Ejército 820, Yanahuara, Arequipa', status: 'ACTIVE', default_currency: 'PEN', timezone: 'America/Lima' });
      ins('establishments', { id: 'es-CS1', company_id: 'co-cs', code: 'AQP', name: 'Tienda Arequipa', short: 'Tienda Arequipa', sunat_code: '0000', est_type: 'MIXED', address: 'Av. Ejército 820, Yanahuara', status: 'ACTIVE', has_counter: true });
      ins('brands', { id: 'br-CS', company_id: 'co-cs', code: 'CS', name: 'Carnes Selectas', primary_color: '#7A2E1F', status: 'ACTIVE', sort_order: 1 });
      ins('users', { id: 'us-cs-gerente', name: 'Hernán Salas Pino', email: 'hsalas@carnesselectas.pe', role: 'GERENTE', brands: [], sites: [], status: 'ACTIVE', twofa_enabled: false, last_login: '2026-10-08T08:15' });
      ins('users', { id: 'us-cs-vendedora', name: 'Nora Pinto Ugarte', email: 'npinto@carnesselectas.pe', role: 'VENDEDORA', brands: ['br-CS'], sites: [], status: 'ACTIVE', twofa_enabled: false, last_login: '2026-10-09T09:40' });
      ins('product_categories', { id: 'pc-CS-RES', code: 'RES', name: 'Res', line: 'RES' });
      ins('products', { id: 'pr-CS-LOMO', brand_id: 'br-CS', category_id: 'pc-CS-RES', code: 'LOMO', name: 'Lomo saltado (corte)', line: 'RES', product_type: 'GOODS', origin: 'RESALE', storage: 'CHILLED', shelf_life_days: 6, requires_lot: true, igv_affectation: '10', status: 'ACTIVE' });
      ins('product_variants', { id: 'va-CS-LOMO', product_id: 'pr-CS-LOMO', brand_id: 'br-CS', sku: 'CS-LOMO-KG', name: 'Lomo para saltado', uom_id: 'um-KGM', sale_mode: 'KG', status: 'ACTIVE', std_cost: 38, sellable: true, line: 'RES' });
      for (let i = 1; i <= 12; i++) ins('customers', { id: 'cu-CS' + i, doc_type: 'DNI', doc_number: String(29000000 + i * 911), full_name: `Cliente Arequipa ${i}`, phone: '+51959' + U.pad(100000 + i, 6), customer_type: 'PERSON', status: 'ACTIVE' });
      for (const [code, spec] of Object.entries(G.SPEC)) if (spec.phase <= 1) ins('tenant_modules', { id: 'tm-CS-' + code, module_code: code, phase: spec.phase, enabled: code !== 'TEL', changed_at: '2026-09-20T10:00', changed_by: 'Onboarding', reason: 'Plan Crecer' });
      for (let m = 9; m <= 10; m++) ins('accounting_periods', { id: 'pe-CS-2026-' + m, company_id: 'co-cs', period: `2026-${m}-01`, status: 'OPEN' });
    } finally { G.ctx.tenant = 'DG'; }
  }, 'maestros');

  /* =====================================================================
     Seed 5: stock inicial por lotes, historial de pedidos (sep y oct),
     comprobantes, cobros y pedidos del día en todos los estados.
     ===================================================================== */
  G.seed(5, function seedTransacciones() {
    const r = U.rng(777);
    const V = G.db.all('product_variants');
    const sell = V.filter(v => v.sellable);
    const byBrand = U.groupBy(sell, 'brand_id');
    /* --- stock inicial por lotes (RN-ALM-02: solo lotes liberados se venden) --- */
    const whFor = v => { const p = G.db.get('products', v.product_id); if (p.product_type !== 'GOODS') return p.storage === 'FROZEN' ? 'wh-CNG-L2' : p.storage === 'CHILLED' ? 'wh-CAM-L2' : 'wh-ALM-L2'; return p.storage === 'FROZEN' ? 'wh-CNG-L1' : p.storage === 'CHILLED' ? 'wh-CAM-L1' : 'wh-ALM-L1'; };
    let lotN = 1;
    for (const v of V) {
      const p = G.db.get('products', v.product_id);
      const wh = whFor(v);
      const nLots = p.requires_lot ? (v.sale_mode === 'UNIT' ? 2 : 2) : 0;
      const baseQty = v.sale_mode === 'KG' ? 25 + Math.floor(r() * 30) : v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? 30 + Math.floor(r() * 50) : p.product_type === 'PACKAGING' ? 400 : 40 + Math.floor(r() * 60);
      if (!nLots) { G.inv.move({ type: 'RECEIPT', wh, variant: v.id, qty: baseQty, unitCost: v.std_cost, source: { type: 'INITIAL_LOAD', id: 'carga-inicial' }, at: '2026-10-01T08:00', reason: 'Carga inicial' }); continue; }
      for (let k = 0; k < nLots; k++) {
        const prodDate = G.date.add(G.TODAY, -(k === 0 ? Math.min(p.shelf_life_days - 1, 2 + Math.floor(r() * 4)) : 1));
        const lot = ins('lots', { id: 'lo-' + U.pad(lotN, 4), product_id: p.id, variant_id: v.id, code: `L${prodDate.slice(2, 4)}${prodDate.slice(5, 7)}${prodDate.slice(8, 10)}-${U.pad(lotN, 3)}`, origin: p.origin === 'PRODUCED' ? 'PRODUCTION' : p.origin === 'RAW_MATERIAL' && p.category_id === 'pc-MP' ? 'FARM' : 'PURCHASE', supplier_id: p.origin === 'RESALE' ? 'su-' + U.rucCheck('2060233817').slice(-8) : null, production_date: prodDate, expiry_date: G.date.add(prodDate, p.shelf_life_days), qc_status: 'RELEASED', unit_cost: v.std_cost, released_at: prodDate + 'T16:00', released_by: 'Silvia Ramos Tello' });
        lotN++;
        const q = Math.round(baseQty / nLots);
        G.inv.move({ type: 'RECEIPT', wh, variant: v.id, lot: lot.id, qty: q, weight: v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? U.round(q * v.nominal_weight_kg, 3) : v.sale_mode === 'KG' ? q : null, unitCost: v.std_cost, source: { type: 'INITIAL_LOAD', id: lot.id }, at: prodDate + 'T17:00', reason: 'Ingreso de lote' });
      }
    }
    // lote en cuarentena, lote por vencer y lote bloqueado (para ALM, CAL, ETQ)
    const vCuy = G.db.get('product_variants', 'va-DG-CUY-ENT');
    const lq = ins('lots', { id: 'lo-Q001', product_id: vCuy.product_id, variant_id: vCuy.id, code: 'L261010-Q01', origin: 'FARM', supplier_id: 'su-GRANJA', production_date: G.TODAY, expiry_date: G.date.add(G.TODAY, 7), qc_status: 'QUARANTINE', unit_cost: 26.5, notes: 'Recepción de la granja pendiente de inspección' });
    G.inv.move({ type: 'RECEIPT', wh: 'wh-CUA-L1', variant: vCuy.id, lot: lq.id, qty: 40, weight: 36.4, unitCost: 26.5, source: { type: 'FARM_RECEIPT', id: 'GRJ-REC-0012' }, at: G.TODAY + 'T07:10', reason: 'Recepción de la granja', allowUnreleased: true });
    const vJam = G.db.get('product_variants', 'va-M3-JAM-250');
    const lx = ins('lots', { id: 'lo-X001', product_id: vJam.product_id, variant_id: vJam.id, code: 'L260915-J07', origin: 'PRODUCTION', production_date: '2026-09-15', expiry_date: '2026-10-12', qc_status: 'RELEASED', unit_cost: 9.3, released_at: '2026-09-15T17:00', released_by: 'Silvia Ramos Tello' });
    G.inv.move({ type: 'RECEIPT', wh: 'wh-CAM-L1', variant: vJam.id, lot: lx.id, qty: 9, unitCost: 9.3, source: { type: 'PRODUCTION', id: 'OP01-0031' }, at: '2026-09-15T17:30', reason: 'Producción' });
    const vChu = G.db.get('product_variants', 'va-M2-CHU-KG');
    const lb = ins('lots', { id: 'lo-B001', product_id: vChu.product_id, variant_id: vChu.id, code: 'L261006-C02', origin: 'CUTTING', production_date: '2026-10-06', expiry_date: '2026-10-14', qc_status: 'BLOCKED', unit_cost: 19.2, block_reason: 'Temperatura de la cámara 7,8 °C por 3 h (no conformidad abierta)' });
    G.inv.move({ type: 'RECEIPT', wh: 'wh-CAM-L1', variant: vChu.id, lot: lb.id, qty: 6.5, weight: 6.5, unitCost: 19.2, source: { type: 'PRODUCTION', id: 'OP01-0040' }, at: '2026-10-06T15:00', reason: 'Producción', allowUnreleased: true });

    /* --- pedidos: ~1000 en setiembre y ~33 diarios en octubre --- */
    const users = G.db.all('users');
    const sellers = users.filter(u => u.role === 'VENDEDORA');
    const drivers = users.filter(u => u.role === 'REPARTIDOR');
    const persons = G.db.where('customers', c => c.customer_type === 'PERSON' && c.status === 'ACTIVE' && c.id.startsWith('cu-0'));
    const bizs = G.db.where('customers', c => ['RESTAURANT', 'BUSINESS'].includes(c.customer_type));
    const addrOf = c => G.db.find('customer_addresses', a => a.customer_id === c.id && a.is_default);
    const wa = G.db.where('messaging_channels', ch => ch.kind === 'WHATSAPP');
    const ads = G.db.all('ad_ads');
    const brandW = [['br-DG', 58], ['br-M2', 12], ['br-M3', 11], ['br-M4', 7], ['br-M5', 12]];
    const pickW = list => { let t = r() * list.reduce((a, x) => a + x[1], 0); for (const x of list) { t -= x[1]; if (t <= 0) return x[0]; } return list[0][0]; };
    const chanW = [['WHATSAPP', 55], ['WEB', 24], ['TIKTOK', 8], ['FACEBOOK', 3], ['INSTAGRAM', 3], ['PHONE', 3], ['B2B', 4]];
    const slots = G.db.where('order_time_slots', s => s.establishment_id === 'es-L1');
    const slotsL2 = G.db.where('order_time_slots', s => s.establishment_id === 'es-L2');
    // preferencia por los productos estrella de cada marca
    const star = { 'br-DG': ['va-DG-CUY-ENT', 'va-DG-CUY-ENT', 'va-DG-CUY-ENT', 'va-DG-CON-ENT', 'va-DG-POL-ENT', 'va-DG-CAL-1L', 'va-DG-CUY-DES', 'va-DG-PAT-ENT', 'va-DG-CHO-500', 'va-DG-GAL-ENT', 'va-DG-COR-PIE', 'va-DG-CUY-MIT', 'va-DG-CUY-CNG', 'va-DG-CAL-500', 'va-DG-CON-TRZ', 'va-DG-POL-PEC', 'va-DG-COR-COS'] };
    const N_SEP = 1000;
    const days = []; for (let d = '2026-09-01'; d <= G.TODAY; d = G.date.add(d, 1)) days.push(d);
    const perDay = d => d < '2026-10-01' ? Math.round(N_SEP / 30 * (0.75 + 0.5 * r())) : 31 + Math.floor(r() * 6);
    let nOrd = 0, nPay = 0;
    const seq = { order: 0 };
    const docSeq = {};
    for (const d of days) {
      const n = perDay(d);
      for (let i = 0; i < n; i++) {
        const isToday = d === G.TODAY;
        const channel = pickW(chanW);
        const brand_id = channel === 'B2B' ? pickW([['br-DG', 70], ['br-M2', 20], ['br-M3', 10]]) : pickW(brandW);
        const cust = channel === 'B2B' ? U.pick(r, bizs) : U.pick(r, persons);
        const addr = addrOf(cust);
        const zone = addr ? G.db.get('delivery_zones', addr.zone_id) : null;
        const est = zone && zone.establishment_id === 'es-L2' ? 'es-L2' : 'es-L1';
        const fulfillment = r() < 0.06 ? 'PICKUP' : 'DELIVERY';
        const bSellers = sellers.filter(s => s.brands.includes(brand_id));
        const seller = channel === 'WEB' ? null : U.pick(r, bSellers.length ? bSellers : sellers);
        const brandWa = wa.filter(w => w.brand_id === brand_id);
        const platform = channel === 'TIKTOK' ? 'TIKTOK' : channel === 'WEB' ? (r() < 0.6 ? 'GOOGLE' : 'META') : ['FACEBOOK', 'INSTAGRAM'].includes(channel) ? 'META' : channel === 'WHATSAPP' ? (r() < 0.7 ? 'META' : 'GOOGLE') : null;
        const brandAds = ads.filter(a => a.brand_id === brand_id && a.platform === platform);
        const ad = platform && r() < 0.72 && brandAds.length ? U.pick(r, brandAds) : null;
        // líneas
        const pool = star[brand_id] ? star[brand_id].map(id => sell.find(v => v.id === id)) : byBrand[brand_id];
        const nl = 1 + (r() < 0.45 ? 1 : 0) + (r() < 0.15 ? 1 : 0);
        const lines = []; const used = new Set();
        for (let k = 0; k < nl; k++) {
          const v = U.pick(r, pool); if (used.has(v.id)) continue; used.add(v.id);
          const list = channel === 'B2B' ? `pl-${brand_id.slice(3)}-B2B` : `pl-${brand_id.slice(3)}-PUB`;
          const pr = G.db.find('price_list_items', l => l.list_id === list && l.variant_id === v.id && !l.valid_to);
          const qty = v.sale_mode === 'KG' ? [0.5, 1, 1, 1.5, 2][Math.floor(r() * 5)] * (channel === 'B2B' ? 4 : 1) : (1 + Math.floor(r() * (channel === 'B2B' ? 10 : 3)));
          lines.push({ id: 'ol-' + (nOrd + 1) + '-' + k, variant_id: v.id, qty, unit_price: pr.price, list_price: pr.price, price_basis: pr.basis, price_list_id: list, est_weight_kg: v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? U.round(qty * v.nominal_weight_kg, 3) : v.sale_mode === 'KG' ? qty : null, tolerance_pct: v.weight_tolerance_pct || null, discount_pct: 0, discount_amount: 0, weighed_kg: null, final_amount: null, lot_id: null, cut_notes: null });
        }
        seq.order++;
        const created = d + 'T' + U.pad(8 + Math.floor(r() * 11), 2) + ':' + U.pad(Math.floor(r() * 60), 2);
        const dDate = isToday ? (r() < 0.25 ? G.date.add(d, 1) : d) : (r() < 0.3 ? G.date.add(d, 1) : d);
        const slot = U.pick(r, est === 'es-L2' ? slotsL2 : slots);
        const pmw = channel === 'WEB' ? [['pm-MP', 80], ['pm-YAPE', 12], ['pm-CARD', 8]] : channel === 'B2B' ? [['pm-TRANSFER', 60], ['pm-CREDIT', 40]] : [['pm-YAPE', 42], ['pm-PLIN', 12], ['pm-CASH', 20], ['pm-TRANSFER', 12], ['pm-CARD', 8], ['pm-MP', 6]];
        const pm = pickW(pmw);
        const o = {
          id: 'so-' + U.pad(seq.order, 5), number: 'P-' + U.pad(seq.order, 6), brand_id, establishment_id: est, channel, customer_id: cust.id, address_id: fulfillment === 'DELIVERY' && addr ? addr.id : null, seller_id: seller ? seller.id : null,
          fulfillment, delivery_date: dDate, slot_id: fulfillment === 'DELIVERY' || fulfillment === 'PICKUP' ? slot.id : null, slot_from: slot.slot_from, slot_to: slot.slot_to, requested_doc_type: cust.doc_type === 'RUC' ? 'INVOICE' : 'RECEIPT', billing_customer_id: cust.id,
          payment_method_id: pm, status: 'DRAFT', estimated_total: 0, final_total: null, delivery_fee: 0, paid_amount: 0, discount_total: 0, discount_status: 'NONE', weight_diff_status: 'NONE',
          contact_phone: cust.phone, zone_id: zone ? zone.id : null, pickup_establishment_id: fulfillment === 'PICKUP' ? est : null, notes: r() < 0.5 ? 'Sin indicaciones' : U.pick(r, ['Cortar en presas', 'Bien limpio, sin vísceras', 'Llamar antes de llegar', 'Dejar en portería', 'Para parrilla, cortes gruesos']), prep_notes_ok: true,
          origin_wa_number: channel === 'WHATSAPP' && brandWa.length ? U.pick(r, brandWa).number : null, origin_ad_code: ad ? ad.code : null, origin_utm: channel === 'WEB' && ad ? { source: platform.toLowerCase(), medium: 'cpc', campaign: ad.code } : null, external_ref: channel === 'WEB' ? 'WC-' + (51200 + seq.order) : null,
          created_at: created, confirmed_at: null, customer_confirmed_at: null, confirmation_channel: null, reschedule_count: 0, lines, history: [], tenant: 'DG', driver_user_id: null,
        };
        G.orders.recalc(o);
        // estado según la fecha
        let st;
        if (!isToday) st = r() < 0.04 ? 'CANCELLED' : (d >= '2026-10-08' && r() < 0.08 ? 'DELIVERED' : 'CLOSED');
        else { const x = r(); st = o.delivery_date > G.TODAY ? (x < 0.15 ? 'DRAFT' : 'CONFIRMED') : x < 0.08 ? 'DRAFT' : x < 0.28 ? 'CONFIRMED' : x < 0.45 ? 'IN_PREPARATION' : x < 0.53 ? 'WEIGHED' : x < 0.67 ? 'READY' : x < 0.85 ? 'IN_ROUTE' : x < 0.97 ? 'DELIVERED' : 'CANCELLED'; }
        if (st === 'DRAFT') { if (r() < 0.5) { o.address_id = null; o.slot_id = null; } if (r() < 0.5) o.payment_method_id = null; }
        if (st !== 'DRAFT') { o.confirmed_at = G.date.add(created.slice(0, 10), 0) + 'T' + created.slice(11, 13) + ':' + U.pad(Math.min(59, Number(created.slice(14, 16)) + 3 + Math.floor(r() * 12)), 2); o.customer_confirmed_at = o.confirmed_at; o.confirmation_channel = channel === 'WEB' ? 'WEB' : channel === 'PHONE' ? 'PHONE' : 'WHATSAPP'; }
        const weighed = ['WEIGHED', 'READY', 'IN_ROUTE', 'DELIVERED', 'CLOSED'].includes(st);
        if (weighed) {
          for (const l of o.lines) if (l.price_basis === 'KG') { const dev = (r() - 0.45) * (r() < 0.07 ? 0.34 : 0.16); l.weighed_kg = U.round(l.est_weight_kg * (1 + dev), 3); l.weight_source = 'SCALE'; }
          G.orders.recalc(o);
          const over = o.lines.some(l => l.price_basis === 'KG' && Math.abs(l.weighed_kg - l.est_weight_kg) / l.est_weight_kg * 100 > (l.tolerance_pct || 10));
          o.weight_diff_status = over ? (st === 'WEIGHED' ? 'NOTICE_REQUIRED' : 'NOTICE_SENT') : 'WITHIN_TOLERANCE';
        }
        if (['IN_ROUTE', 'DELIVERED', 'CLOSED'].includes(st) && o.fulfillment === 'DELIVERY') o.driver_user_id = U.pick(r, est === 'es-L2' ? drivers.slice(2) : drivers.slice(0, 2)).id;
        if (st === 'CANCELLED') { o.cancel_reason = U.pick(r, ['Cliente desistió', 'Sin stock del corte pedido', 'Dirección fuera de cobertura', 'Pedido duplicado']); o.cancelled_at = created; }
        if (['DELIVERED', 'CLOSED'].includes(st)) o.delivered_at = o.delivery_date + 'T' + (o.slot_from || '12:00').slice(0, 2) + ':' + U.pad(10 + Math.floor(r() * 45), 2);
        if (st === 'CLOSED') o.closed_at = o.delivered_at;
        o.status = st;
        if (isToday || d >= '2026-10-08') o.history = [{ at: created, from: null, to: 'DRAFT', user: seller ? seller.name : 'Tienda web' }].concat(st !== 'DRAFT' ? [{ at: o.confirmed_at || created, from: 'DRAFT', to: st === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED', user: seller ? seller.name : 'Tienda web' }] : []).concat(!['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(st) ? [{ at: (o.delivered_at || G.date.now()), from: 'CONFIRMED', to: st, user: 'Sistema' }] : []);
        G.db.insert('sales_orders', o, { silent: true });
        nOrd++;
        // pago adelantado (web y la mayoría de WhatsApp) o contra entrega
        const total = o.final_total ?? o.estimated_total;
        const prepaid = ['pm-MP', 'pm-YAPE', 'pm-PLIN', 'pm-TRANSFER'].includes(pm) && st !== 'DRAFT' && st !== 'CANCELLED';
        const paidNow = (prepaid && (st !== 'CONFIRMED' || r() < 0.7)) || ['DELIVERED', 'CLOSED'].includes(st) && pm !== 'pm-CREDIT';
        if (paidNow) {
          const amount = prepaid ? U.round(o.estimated_total + (r() < 0.1 ? 5 : 0), 2) : total;
          const acc = { 'pm-MP': 'ca-MP', 'pm-YAPE': 'ca-YAPE', 'pm-PLIN': 'ca-PLIN', 'pm-TRANSFER': 'ca-BCP-CTE', 'pm-CARD': 'ca-POS-VISA', 'pm-CASH': o.driver_user_id ? 'ca-DRV-' + o.driver_user_id.slice(3) : 'ca-CAJA-L1' }[pm];
          nPay++;
          const pay = G.db.insert('payments', { id: 'py-' + U.pad(nPay, 5), number: 'CB-' + U.pad(nPay, 6), customer_id: cust.id, payment_method_id: pm, cash_account_id: acc, amount, paid_at: prepaid ? (o.confirmed_at || created) : o.delivered_at, reference: pm === 'pm-CASH' ? null : (pm === 'pm-MP' ? 'MP' : 'OP') + (10000000 + Math.floor(r() * 89999999)), status: 'CONFIRMED', brand_id, establishment_id: est, fee_amount: pm === 'pm-MP' ? U.round(amount * 0.0399, 2) : pm === 'pm-CARD' ? U.round(amount * 0.0344, 2) : 0, reconciliation_status: d < '2026-10-01' ? 'MATCHED' : ['pm-MP', 'pm-CARD', 'pm-YAPE', 'pm-PLIN', 'pm-TRANSFER'].includes(pm) ? 'PENDING' : 'NOT_APPLICABLE', received_by: seller ? seller.id : null, collected_by_user_id: pm === 'pm-CASH' ? o.driver_user_id : null, allocations: [{ order_id: o.id, document_id: null, amount }], tenant: 'DG' }, { silent: true });
          o.paid_amount = amount;
          if (['DELIVERED', 'CLOSED'].includes(st) && o.final_total != null && amount > o.final_total) o.balance_mode = 'CUSTOMER_CREDIT';
          o.payment_ids = [pay.id];
        }
        // comprobante (FAC) al entregar o por adelantado en la web
        if (['DELIVERED', 'CLOSED'].includes(st)) {
          const doc = G.docs.fromOrder(o, { date: o.delivery_date, silent: true, accept: true, seq: docSeq });
          if (o.payment_ids) { const p = G.db.get('payments', o.payment_ids[0]); p.allocations[0].document_id = doc.id; }
        }
      }
    }
    // marcas del cliente y primeras/últimas compras
    const firstLast = {};
    for (const o of G.db.all('sales_orders')) { if (o.status === 'CANCELLED') continue; const f = firstLast[o.customer_id] || (firstLast[o.customer_id] = { first: o.created_at, last: o.created_at, n: 0, brands: new Set() }); if (o.created_at < f.first) f.first = o.created_at; if (o.created_at > f.last) f.last = o.created_at; f.n++; f.brands.add(o.brand_id); }
    for (const c of G.db.all('customers')) { const f = firstLast[c.id]; if (f) { c.first_order_at = f.first; c.last_order_at = f.last; c.orders_count = f.n; c.segment_brands = [...f.brands]; } }
    // reservas de stock para los pedidos confirmados y en preparación de hoy y mañana (RN-PED-17)
    for (const o of G.db.where('sales_orders', o => ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY'].includes(o.status))) G.inv.reserve(o, { silent: true });
  }, 'transacciones');
})();
