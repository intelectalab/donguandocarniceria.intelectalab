# Plan de sprints por objetivos · 3 personas (BORRADOR)

> Copia para analizar. **No reemplaza** a `docs/plan-de-sprints.md` (que reparte por carga) hasta que el equipo lo decida. Se genera con `python -I tools/prototipo/plan_sprints_por_objetivos.py`.

## 1. En qué se diferencia del plan por carga

| | Plan por carga (`plan-de-sprints.md`) | Este plan por objetivos |
|---|---|---|
| Criterio | Llenar ~17 pantallas por persona y sprint | Cada sprint tiene un objetivo que se puede mostrar al cerrarlo |
| Cada persona | Salta de tema cuando un hueco lo pide | Sigue su carril (A plataforma → finanzas → SaaS; B vender → cobrar → canales; C stock → preparar → repartir → producir) |
| Módulos | Se parten entre sprints para rellenar | Un módulo, un sprint (salvo dos módulos chicos juntos) |
| Sprints | 11 | 12 |
| Carga | Pareja | Desigual: algunos sprints de 22 pantallas y otros de 8 a 10 |
| Bloqueos | Ninguno | Ninguno (verificado por el script) |

Las dependencias y los niveles son los mismos de `plan-de-sprints.md` (sección 1): **fuerte** = llama a un servicio de otro módulo y bloquea; **débil** = solo usa sus tablas y no bloquea. Única diferencia: CNT ya no espera a TAB, porque el congelamiento de indicadores al cerrar un período lo dispara un evento.

## 2. Sprints

| Sprint | Objetivo | A · Plataforma, finanzas y SaaS | B · Comercial | C · Operación y producción |
|---|---|---|---|---|
| **S01** | Empresa, catálogo y stock | PLT (14) | CAT (12) | ALM (13) |
| **S02** | Usuarios, clientes y lotes liberados | SEG (15) | CLI (12) | CAL (13) |
| **S03** | Tomar pedidos completos | MAE (10) | PED (14) | REC (10) |
| **S04** | Pedido preparado y facturado | GAS (11) | FAC (12) | PRE (12) |
| **S05** | Cobrar y conciliar | INT (13) | CAJ (13) | EQU (9) |
| **S06** | Mostrador, reparto y contabilidad | CNT (16) | POS (12) | DEL (22) |
| **S07** | Producir | AUD (8) | TAB (10) | PRO (13) |
| **S08** | WhatsApp y comprar | SUS (14) | CRM (18) | COM (12) |
| **S09** | Tienda web y producción completa | ONB (16) | WEB (8) + ADS (9) | DES (9) + ETQ (9) |
| **S10** | Clientes empresariales y consignación | OPS (16) | B2B (17) | CON (17) |
| **S11** | Campañas, granja y flota | API (11) | CMP (13) | GRJ (7) + FLO (15) |
| **S12** | Personal, presupuesto y llamadas | PRS (10) + SEP (12) | TEL (12) | PER (15) |

## 3. Qué se puede mostrar al cerrar cada sprint

- **S01 · Empresa, catálogo y stock:** La empresa con sus marcas, locales y series; el catálogo con precios; el stock por almacén y lote.
- **S02 · Usuarios, clientes y lotes liberados:** Usuarios con rol y alcance; clientes con dirección con pin y zona; lotes que calidad libera o bloquea.
- **S03 · Tomar pedidos completos:** Un pedido de cualquier canal que no se confirma sin sus datos; recetas listas para producir.
- **S04 · Pedido preparado y facturado:** El pedido se prepara con escaneo y bolsas numeradas y sale con su boleta o factura; gastos con comprobante.
- **S05 · Cobrar y conciliar:** Cobros con su referencia, aplicados al pedido y conciliados; conectores e integraciones; equipos y mantenimiento.
- **S06 · Mostrador, reparto y contabilidad:** Venta en mostrador con balanza, reparto con ruta y cobro contra entrega, y cada venta con su asiento.
- **S07 · Producir:** Órdenes de producción con costo real; tablero de indicadores; auditoría y exportaciones.
- **S08 · WhatsApp y comprar:** Bandeja omnicanal con control de vendedoras; compras y cuentas por pagar; planes del SaaS.
- **S09 · Tienda web y producción completa:** Pedidos de la web con Mercado Pago, anuncios atribuidos a ventas, despiece y etiquetas con trazabilidad.
- **S10 · Clientes empresariales y consignación:** Portal B2B con crédito, consignación con visitas y liquidación; consola de plataforma.
- **S11 · Campañas, granja y flota:** Campañas y fidelización, integración con la granja, flota con costo por vehículo; API pública.
- **S12 · Personal, presupuesto y llamadas:** Personal y comisiones, presupuesto contra lo real, separación de marcas y telefonía.

## 4. Carga por persona y sprint (pantallas)

| Sprint | A | B | C |
|---|---:|---:|---:|
| S01 | 14 | 12 | 13 |
| S02 | 15 | 12 | 13 |
| S03 | 10 | 14 | 10 |
| S04 | 11 | 12 | 12 |
| S05 | 13 | 13 | 9 |
| S06 | 16 | 12 | 22 |
| S07 | 8 | 10 | 13 |
| S08 | 14 | 18 | 12 |
| S09 | 16 | 17 | 18 |
| S10 | 16 | 17 | 17 |
| S11 | 11 | 13 | 22 |
| S12 | 22 | 12 | 15 |
| **Total** | 166 | 162 | 176 |

**Sprints pesados:** C en S06 (Delivery, 22 pantallas, incluida su app del repartidor) y en S11 (GRJ + FLO, 22), y A en S12 (PRS + SEP, 22). Hay que vigilarlos: si no alcanzan, se pasa la parte que sobra al sprint siguiente de esa persona. **Sprints livianos:** A en S07 (8) y C en S05 (9); ese tiempo se usa para conectar integraciones pendientes y para la prueba del objetivo del sprint.

**Por qué C alterna un poco** (REC en S03 y EQU en S05, entre preparación y reparto): Preparación necesita Pedidos (B, S03) y Delivery necesita Comprobantes y Caja (B, S04 y S05). Mientras tanto, C adelanta la base de producción en lugar de esperar.

## 5. Detalle por módulo (en el orden del menú)

| Módulo | Nivel | Dueño | Pantallas | Sprint | Depende (fuerte) | Lee de (débil) |
|---|:---:|:---:|---:|---|---|---|
| **PLT** Plataforma | 1 | A | 14 | S01 | solo la base | — |
| **SEG** Seguridad | 1 | A | 15 | S02 | solo la base | — |
| **MAE** Maestros comunes | 1 | A | 10 | S03 | solo la base | — |
| **INT** Integraciones | 1 | A | 13 | S05 | solo la base | — |
| **AUD** Auditoría | 1 | A | 8 | S07 | solo la base | — |
| **CAT** Catálogo y listas de precio | 1 | B | 12 | S01 | solo la base | — |
| **CLI** Clientes y zonas de reparto | 1 | B | 12 | S02 | solo la base | — |
| **PED** Pedidos | 2 | B | 14 | S03 | CAT (S01), CLI (S02), ALM (S01) | — |
| **POS** Mostrador | 3 | B | 12 | S06 | PED (S03), ALM (S01), FAC (S04), CAJ (S05) | CAT, CLI |
| **WEB** Tienda web y Mercado Pago | 3 | B | 8 | S09 | PED (S03), CAJ (S05), CAT (S01) | CLI, ALM |
| **CRM** Bandeja omnicanal | 3 | B | 18 | S08 | PED (S03), CLI (S02), CAT (S01), CAJ (S05) | — |
| **ADS** Publicidad y atribución | 2 | B | 9 | S09 | CAJ (S05), GAS (S04) | CRM, PED |
| **TEL** Telefonía (incluida y apagada) | 3 | B | 12 | S12 | CLI (S02), PED (S03) | CRM |
| **ALM** Almacenes y lotes | 1 | C | 13 | S01 | solo la base | CAT, PED, FAC |
| **PRE** Preparación de pedidos | 3 | C | 12 | S04 | PED (S03), ALM (S01) | CAT, DEL |
| **DEL** Delivery | 3 | C | 22 | S06 | PED (S03), CLI (S02), FAC (S04), CAJ (S05), GAS (S04) | PRE |
| **FAC** Comprobantes y guías | 1 | B | 12 | S04 | solo la base | CLI, PED, ALM |
| **CAJ** Cajas, cobros y conciliación | 1 | B | 13 | S05 | solo la base | CLI, PED, FAC, WEB, POS |
| **GAS** Gastos | 1 | A | 11 | S04 | solo la base | CAJ, COM |
| **TAB** Tablero e indicadores | 1 | B | 10 | S07 | solo la base | CNT |
| **PRO** Órdenes de producción | 2 | C | 13 | S07 | REC (S03), ALM (S01), EQU (S05) | CAT, TAB, DES, CAL |
| **DES** Despiece y costeo conjunto | 3 | C | 9 | S09 | PRO (S07), ALM (S01), CAL (S02) | CAT, EQU |
| **REC** Recetas y formulación | 1 | C | 10 | S03 | solo la base | CAT, ALM, PRO, CAL |
| **CAL** Calidad | 2 | C | 13 | S02 | ALM (S01) | CAT, CLI, PED, PRE, DEL, FAC, CRM, PRO, REC, EQU, COM |
| **EQU** Equipos y mantenimiento | 1 | C | 9 | S05 | solo la base | ALM, GAS, COM, CAL, PRO |
| **ETQ** Etiquetas y trazabilidad | 3 | C | 9 | S09 | PRO (S07), CAL (S02), ALM (S01) | CAT, CLI, PED, PRE, FAC, CRM, COM, GRJ |
| **COM** Compras y cuentas por pagar | 2 | C | 12 | S08 | ALM (S01), CAJ (S05), GAS (S04) | CAT, CAL, EQU, GRJ, CNT |
| **GRJ** Integración con la granja | 3 | C | 7 | S11 | COM (S08), CAL (S02), ALM (S01) | CAT, ETQ, CNT |
| **CNT** Contabilidad | 2 | A | 16 | S06 | FAC (S04), CAJ (S05), GAS (S04), ALM (S01) | TAB, COM, GRJ, PRO |
| **CON** Consignación | 3 | C | 17 | S10 | ALM (S01), FAC (S04), CAJ (S05), CAL (S02), CNT (S06) | CLI, CAT, DEL, TAB |
| **B2B** Clientes empresariales | 3 | B | 17 | S10 | PED (S03), FAC (S04), CAJ (S05), CLI (S02), CNT (S06) | CAT, CRM, DEL, TAB |
| **CMP** Campañas y fidelización | 3 | B | 13 | S11 | PED (S03), CAJ (S05), ADS (S09) | CLI, CRM, FAC, TAB |
| **FLO** Flota avanzada | 3 | C | 15 | S11 | GAS (S04), CAL (S02), CNT (S06) | DEL, TAB, PER |
| **PER** Personal | 3 | C | 15 | S12 | PED (S03), CAJ (S05), CNT (S06) | DEL, CRM, TEL, TAB, FLO |
| **PRS** Presupuesto | 3 | A | 10 | S12 | GAS (S04), FAC (S04), CNT (S06), COM (S08), ADS (S09) | TAB, PER, FLO |
| **SUS** Planes y suscripciones | 1 | A | 14 | S08 | solo la base | — |
| **ONB** Alta de empresas | 2 | A | 16 | S09 | SUS (S08), CAT (S01), CLI (S02), ALM (S01), FAC (S04) | CRM, TAB, DES, REC, CAL, GAS |
| **SEP** Separación de marcas | 3 | A | 12 | S12 | ALM (S01), FAC (S04), PED (S03), CAJ (S05) | CLI, CRM, WEB, ADS, SUS |
| **OPS** Consola de plataforma y soporte | 3 | A | 16 | S10 | ONB (S09), SUS (S08) | — |
| **API** API pública y webhooks | 3 | A | 11 | S11 | SUS (S08), PED (S03), FAC (S04), CAJ (S05) | CLI, CAT, ALM, DEL |

Entre paréntesis, el sprint en que termina cada dependencia fuerte; siempre es anterior.

## 6. Integraciones débiles que se conectan después

La conecta el dueño del módulo que termina segundo, en su sprint:

| Se conecta en | Módulo | Con | Quién |
|---|---|---|---|
| S03 | ALM Almacenes y lotes | PED Pedidos | B |
| S03 | CAL Calidad | PED Pedidos | B |
| S03 | CAL Calidad | REC Recetas y formulación | C |
| S04 | ALM Almacenes y lotes | FAC Comprobantes y guías | B |
| S04 | CAL Calidad | FAC Comprobantes y guías | B |
| S04 | CAL Calidad | PRE Preparación de pedidos | C |
| S05 | CAL Calidad | EQU Equipos y mantenimiento | C |
| S05 | GAS Gastos | CAJ Cajas, cobros y conciliación | B |
| S06 | CAJ Cajas, cobros y conciliación | POS Mostrador | B |
| S06 | CAL Calidad | DEL Delivery | C |
| S06 | PRE Preparación de pedidos | DEL Delivery | C |
| S07 | CAL Calidad | PRO Órdenes de producción | C |
| S07 | CNT Contabilidad | PRO Órdenes de producción | C |
| S07 | CNT Contabilidad | TAB Tablero e indicadores | B |
| S07 | EQU Equipos y mantenimiento | PRO Órdenes de producción | C |
| S07 | REC Recetas y formulación | PRO Órdenes de producción | C |
| S08 | CAL Calidad | COM Compras y cuentas por pagar | C |
| S08 | CAL Calidad | CRM Bandeja omnicanal | B |
| S08 | CNT Contabilidad | COM Compras y cuentas por pagar | C |
| S08 | EQU Equipos y mantenimiento | COM Compras y cuentas por pagar | C |
| S08 | GAS Gastos | COM Compras y cuentas por pagar | C |
| S09 | CAJ Cajas, cobros y conciliación | WEB Tienda web y Mercado Pago | B |
| S09 | PRO Órdenes de producción | DES Despiece y costeo conjunto | C |
| S11 | CNT Contabilidad | GRJ Integración con la granja | C |
| S11 | COM Compras y cuentas por pagar | GRJ Integración con la granja | C |
| S11 | ETQ Etiquetas y trazabilidad | GRJ Integración con la granja | C |
| S12 | FLO Flota avanzada | PER Personal | C |

Son 27.

## 7. Lo que sigue igual que en el plan por carga

- El reparto por dominio y las reglas para no bloquearse (contrato antes que código, nadie escribe en tablas ajenas, pruebas por cada criterio CA).
- Las integraciones externas deben estar listas antes del sprint de su módulo: mapas (CLI, S02), SUNAT (FAC, S04), WhatsApp (CRM, S08), WooCommerce y Mercado Pago (WEB, S09), anuncios (ADS, S09), granja (GRJ, S11), Ayni HR (PER, S12) y telefonía (TEL, S12).
- El segundo factor sigue pendiente por decisión del equipo.
