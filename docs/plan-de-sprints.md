# Plan de sprints por módulos · 3 personas

Este plan sale de un cálculo, no de un reparto a ojo. Las dependencias de cada módulo se tomaron de la spec (`aycha-proto/dist/spec.json`, campo `deps`) y se simuló el avance sprint por sprint para comprobar que **nadie espera a otro**.

## 1. Cómo se definen los niveles

La spec tiene dependencias circulares: PED↔ALM, FAC↔CAJ, DEL↔PRE, PRO↔CAL… Si todas bloquearan, nadie podría empezar. Por eso cada dependencia se clasifica en una de dos clases:

- **Fuerte (bloquea):** el módulo necesita **llamar a un servicio** de otro, como reservar stock (ALM), calcular un precio (CAT) o crear un pedido (PED). Esa dependencia tiene que estar terminada **antes** de empezar.
- **Débil (no bloquea):** el módulo solo **lee o escribe las tablas** de otro. Esas tablas ya existen y se llenan con datos de demo. Se trabaja contra la tabla y la integración real se conecta cuando el otro módulo termina (sección 5).

Con esa regla salen exactamente tres niveles:

| Nivel | Qué significa | Módulos | Pantallas |
|---|---|---|---:|
| **1 · Independiente** | Solo usa la base, que ya está construida | PLT, SEG, MAE, INT, AUD, SUS, TAB, CAT, CLI, ALM, FAC, CAJ, GAS, EQU, REC | 176 |
| **2 · Dependiente** | Usa servicios de módulos del nivel 1 | PED, ADS, COM, PRO, CAL, CNT, ONB | 93 |
| **3 · Dependiente de dependiente** | Usa servicios de los niveles 1 y 2 | POS, PRE, WEB, CRM, DEL, TEL, B2B, CMP, CON, FLO, PER, PRS, DES, ETQ, GRJ, OPS, API, SEP | 235 |

**La base ya está hecha y no bloquea a nadie:** empresa y usuarios, ingreso, permisos, alcance por marca y local, RLS, bitácora, eventos, parámetros, menú y todas las tablas de las fases 0 y 1 con datos de demo. Los módulos PLT, SEG, MAE, INT y AUD del nivel 1 son *sus pantallas* de administración.

## 2. Reparto

Se mantiene el reparto por dominio de `docs/revision-del-prototipo.md` (sección 8): cada persona es dueña de sus módulos, de sus tablas y de sus servicios.

| Persona | Módulos (en orden de trabajo) | Pantallas |
|---|---|---:|
| **A · Plataforma, finanzas y SaaS** | PLT, SEG, GAS, MAE, INT, AUD, CNT, SUS, ONB, PRS, OPS, API, SEP | 166 |
| **B · Comercial** | CAT, CLI, FAC, CAJ, PED, TAB, CRM, POS, WEB, ADS, B2B, CMP, TEL | 162 |
| **C · Operación y producción** | ALM, REC, EQU, COM, CAL, PRO, PRE, DEL, DES, ETQ, GRJ, CON, FLO, PER | 176 |

La carga se mide en pantallas de la spec: unas **17 por persona por sprint**. Es una medida aproximada, porque no todas las pantallas cuestan lo mismo (las de CRM con WhatsApp, FAC con SUNAT o WEB con Mercado Pago pesan más). La duración de cada sprint la define el equipo.

## 3. Sprints

«…» indica que el módulo continúa en el sprint siguiente; entre paréntesis, las pantallas de ese sprint.

| Sprint | A · Plataforma, finanzas y SaaS | B · Comercial | C · Operación y producción |
|---|---|---|---|
| **S01** | PLT (14) | CAT (12), CLI… (5) | ALM (13) |
| **S02** | SEG (15) | CLI (7), FAC… (10) | REC (10), EQU… (7) |
| **S03** | GAS (11), MAE… (6) | FAC (2), CAJ (13) | EQU (2), CAL (13) |
| **S04** | MAE (4), INT (13) | PED (14) | COM (12), PRO… (5) |
| **S05** | AUD (8), SUS… (9) | TAB (10), CRM… (7) | PRO (8), PRE… (9) |
| **S06** | SUS (5), CNT… (12) | CRM (11), POS… (6) | PRE (3), DEL… (14) |
| **S07** | CNT (4), ONB… (13) | POS (6), WEB (8) | DEL (8), DES (9) |
| **S08** | ONB (3), API (11) | ADS (9), B2B… (8) | ETQ (9), GRJ (7) |
| **S09** | PRS (10), OPS… (7) | B2B (9), CMP… (8) | CON (17) |
| **S10** | OPS (9), SEP… (8) | CMP (5), TEL (12) | FLO (15) |
| **S11** | SEP (4) | Integraciones pendientes y pruebas de punta a punta (sección 5) | PER (15) |

**Regla del sprint:** un módulo solo empieza cuando todas sus dependencias fuertes terminaron en un sprint **anterior**. Nunca se depende de algo que otra persona está haciendo en el mismo sprint.

## 4. Detalle por módulo (en el orden del menú)

| Módulo | Nivel | Dueño | Pantallas | Sprints | Depende (fuerte) | Lee de (débil) |
|---|:---:|:---:|---:|---|---|---|
| **PLT** Plataforma | 1 | A | 14 | S01 | solo la base | — |
| **SEG** Seguridad | 1 | A | 15 | S02 | solo la base | — |
| **MAE** Maestros comunes | 1 | A | 10 | S03–S04 | solo la base | — |
| **INT** Integraciones | 1 | A | 13 | S04 | solo la base | — |
| **AUD** Auditoría | 1 | A | 8 | S05 | solo la base | — |
| **CAT** Catálogo y listas de precio | 1 | B | 12 | S01 | solo la base | — |
| **CLI** Clientes y zonas de reparto | 1 | B | 12 | S01–S02 | solo la base | — |
| **PED** Pedidos | 2 | B | 14 | S04 | CAT (S01), CLI (S02), ALM (S01) | — |
| **POS** Mostrador | 3 | B | 12 | S06–S07 | PED (S04), ALM (S01), FAC (S03), CAJ (S03) | CAT, CLI |
| **WEB** Tienda web y Mercado Pago | 3 | B | 8 | S07 | PED (S04), CAJ (S03), CAT (S01) | CLI, ALM |
| **CRM** Bandeja omnicanal | 3 | B | 18 | S05–S06 | PED (S04), CLI (S02), CAT (S01), CAJ (S03) | — |
| **ADS** Publicidad y atribución | 2 | B | 9 | S08 | CAJ (S03), GAS (S03) | CRM, PED |
| **TEL** Telefonía (incluida y apagada) | 3 | B | 12 | S10 | CLI (S02), PED (S04) | CRM |
| **ALM** Almacenes y lotes | 1 | C | 13 | S01 | solo la base | CAT, PED, FAC |
| **PRE** Preparación de pedidos | 3 | C | 12 | S05–S06 | PED (S04), ALM (S01) | CAT, DEL |
| **DEL** Delivery | 3 | C | 22 | S06–S07 | PED (S04), CLI (S02), FAC (S03), CAJ (S03), GAS (S03) | PRE |
| **FAC** Comprobantes y guías | 1 | B | 12 | S02–S03 | solo la base | CLI, PED, ALM |
| **CAJ** Cajas, cobros y conciliación | 1 | B | 13 | S03 | solo la base | CLI, PED, FAC, WEB, POS |
| **GAS** Gastos | 1 | A | 11 | S03 | solo la base | CAJ, COM |
| **TAB** Tablero e indicadores | 1 | B | 10 | S05 | solo la base | CNT |
| **PRO** Órdenes de producción | 2 | C | 13 | S04–S05 | REC (S02), ALM (S01), EQU (S03) | CAT, TAB, DES, CAL |
| **DES** Despiece y costeo conjunto | 3 | C | 9 | S07 | PRO (S05), ALM (S01), CAL (S03) | CAT, EQU |
| **REC** Recetas y formulación | 1 | C | 10 | S02 | solo la base | CAT, ALM, PRO, CAL |
| **CAL** Calidad | 2 | C | 13 | S03 | ALM (S01) | CAT, CLI, PED, PRE, DEL, FAC, CRM, PRO, REC, EQU, COM |
| **EQU** Equipos y mantenimiento | 1 | C | 9 | S02–S03 | solo la base | ALM, GAS, COM, CAL, PRO |
| **ETQ** Etiquetas y trazabilidad | 3 | C | 9 | S08 | PRO (S05), CAL (S03), ALM (S01) | CAT, CLI, PED, PRE, FAC, CRM, COM, GRJ |
| **COM** Compras y cuentas por pagar | 2 | C | 12 | S04 | ALM (S01), CAJ (S03), GAS (S03) | CAT, CAL, EQU, GRJ, CNT |
| **GRJ** Integración con la granja | 3 | C | 7 | S08 | COM (S04), CAL (S03), ALM (S01) | CAT, ETQ, CNT |
| **CNT** Contabilidad | 2 | A | 16 | S06–S07 | FAC (S03), CAJ (S03), GAS (S03), ALM (S01), TAB (S05) | COM, GRJ, PRO |
| **CON** Consignación | 3 | C | 17 | S09 | ALM (S01), FAC (S03), CAJ (S03), CAL (S03), CNT (S07) | CLI, CAT, DEL, TAB |
| **B2B** Clientes empresariales | 3 | B | 17 | S08–S09 | PED (S04), FAC (S03), CAJ (S03), CLI (S02), CNT (S07) | CAT, CRM, DEL, TAB |
| **CMP** Campañas y fidelización | 3 | B | 13 | S09–S10 | PED (S04), CAJ (S03), ADS (S08) | CLI, CRM, FAC, TAB |
| **FLO** Flota avanzada | 3 | C | 15 | S10 | GAS (S03), CAL (S03), CNT (S07) | DEL, TAB, PER |
| **PER** Personal | 3 | C | 15 | S11 | PED (S04), CAJ (S03), CNT (S07) | DEL, CRM, TEL, TAB, FLO |
| **PRS** Presupuesto | 3 | A | 10 | S09 | GAS (S03), FAC (S03), CNT (S07), COM (S04), ADS (S08) | TAB, PER, FLO |
| **SUS** Planes y suscripciones | 1 | A | 14 | S05–S06 | solo la base | — |
| **ONB** Alta de empresas | 2 | A | 16 | S07–S08 | SUS (S06), CAT (S01), CLI (S02), ALM (S01), FAC (S03) | CRM, TAB, DES, REC, CAL, GAS |
| **SEP** Separación de marcas | 3 | A | 12 | S10–S11 | ALM (S01), FAC (S03), PED (S04), CAJ (S03) | CLI, CRM, WEB, ADS, SUS |
| **OPS** Consola de plataforma y soporte | 3 | A | 16 | S09–S10 | ONB (S08), SUS (S06) | — |
| **API** API pública y webhooks | 3 | A | 11 | S08 | SUS (S06), PED (S04), FAC (S03), CAJ (S03) | CLI, CAT, ALM, DEL |

Entre paréntesis, el sprint en que termina cada dependencia fuerte; siempre es anterior al inicio del módulo. DEL incluye las 6 pantallas de la ampliación del prototipo (DEL-17 a DEL-22).

## 5. Integraciones débiles que se conectan después

Cuando un módulo lee de otro que todavía no existe, trabaja contra la tabla con datos de demo y deja anotada la conexión pendiente. **La conecta el dueño del módulo que termina segundo**, en el sprint en que termina:

| Se conecta en | Módulo | Con | Quién la conecta |
|---|---|---|---|
| S03 | ALM Almacenes y lotes | FAC Comprobantes y guías | B (dueño de FAC) |
| S03 | REC Recetas y formulación | CAL Calidad | C (dueño de CAL) |
| S04 | ALM Almacenes y lotes | PED Pedidos | B (dueño de PED) |
| S04 | CAJ Cajas, cobros y conciliación | PED Pedidos | B (dueño de PED) |
| S04 | CAL Calidad | COM Compras y cuentas por pagar | C (dueño de COM) |
| S04 | CAL Calidad | PED Pedidos | B (dueño de PED) |
| S04 | EQU Equipos y mantenimiento | COM Compras y cuentas por pagar | C (dueño de COM) |
| S04 | FAC Comprobantes y guías | PED Pedidos | B (dueño de PED) |
| S04 | GAS Gastos | COM Compras y cuentas por pagar | C (dueño de COM) |
| S05 | CAL Calidad | PRO Órdenes de producción | C (dueño de PRO) |
| S05 | EQU Equipos y mantenimiento | PRO Órdenes de producción | C (dueño de PRO) |
| S05 | REC Recetas y formulación | PRO Órdenes de producción | C (dueño de PRO) |
| S06 | CAL Calidad | CRM Bandeja omnicanal | B (dueño de CRM) |
| S06 | CAL Calidad | PRE Preparación de pedidos | C (dueño de PRE) |
| S07 | CAJ Cajas, cobros y conciliación | POS Mostrador | B (dueño de POS) |
| S07 | CAJ Cajas, cobros y conciliación | WEB Tienda web y Mercado Pago | B (dueño de WEB) |
| S07 | CAL Calidad | DEL Delivery | C (dueño de DEL) |
| S07 | COM Compras y cuentas por pagar | CNT Contabilidad | A (dueño de CNT) |
| S07 | PRE Preparación de pedidos | DEL Delivery | C (dueño de DEL) |
| S07 | PRO Órdenes de producción | DES Despiece y costeo conjunto | C (dueño de DES) |
| S07 | TAB Tablero e indicadores | CNT Contabilidad | A (dueño de CNT) |
| S08 | CNT Contabilidad | GRJ Integración con la granja | C (dueño de GRJ) |
| S08 | COM Compras y cuentas por pagar | GRJ Integración con la granja | C (dueño de GRJ) |
| S10 | PRS Presupuesto | FLO Flota avanzada | C (dueño de FLO) |
| S11 | FLO Flota avanzada | PER Personal | C (dueño de PER) |
| S11 | PRS Presupuesto | PER Personal | C (dueño de PER) |

Son 26. Las demás integraciones débiles se conectan solas, porque el otro módulo ya existe cuando se construye el que lo lee. En el **último sprint**, A y B revisan que todas estén conectadas y hacen las pruebas de punta a punta (pedido → preparación → reparto → comprobante → cobro → asiento), mientras C termina Personal.

## 6. Reglas para que nadie se bloquee

1. **Contrato antes que código.** Al empezar un módulo que otros van a usar (ALM, PED, FAC, CAJ, CAT, CLI, CNT, PRO, REC, CAL, COM, SUS, ONB), su dueño publica primero en `docs/contratos.md` la firma de sus servicios: nombre, parámetros, respuesta y reglas RN que valida.
2. **Las dependencias débiles no esperan.** Se trabaja contra la tabla con datos de demo, se emite o se escucha el evento de la spec (`Events::emit`) y se anota la conexión pendiente en `docs/cambios/`.
3. **Nadie escribe en tablas ajenas.** Si hace falta una columna en una tabla de otro módulo, se le pide al dueño (migración suya), como dice `docs/base-de-datos.md`.
4. **Cada módulo termina con sus pruebas**, una por cada criterio `CA-…` de la spec, en verde antes de cerrar el sprint. Así, el que lo usa después no hereda errores.
5. **Si algo cambia el plan** (un módulo más grande de lo esperado, una dependencia nueva), se recalcula con `python -I tools/prototipo/plan_sprints.py 17 plan.json`, en lugar de mover módulos a mano.

## 7. Integraciones externas: tenerlas antes de su sprint

No bloquean entre personas, pero sí al módulo. Las cuentas y las credenciales de prueba deben estar listas antes de que empiece:

| Módulo | Empieza | Necesita |
|---|---|---|
| CLI | S01 | proveedor de mapas y geocodificación |
| FAC | S02 | proveedor OSE o PSE de SUNAT, en ambiente de pruebas |
| CRM | S05 | WhatsApp Cloud API (números de prueba y plantillas) |
| WEB | S07 | WooCommerce y Mercado Pago (modo de prueba) |
| ADS | S08 | acceso de lectura a Google, Meta y TikTok Ads |
| GRJ | S08 | API del SaaS de Granja Don Guando |
| TEL | S10 | proveedor de telefonía (el módulo viene apagado) |
| PER | S11 | API o archivo de Ayni HR |

## 8. Pendiente fuera de este plan

- **Segundo factor:** pendiente por decisión del equipo.
