# Nuevos canales · CON, B2B y CMP (24/11/2026)

Los tres módulos del bloque «Nuevos canales», completos y con datos reales:

- **CON · Consignación:** CON-01 a CON-17.
- **B2B · Clientes empresariales y portal del cliente:** B2B-01 a B2B-17.
- **CMP · Campañas y fidelización:** CMP-01 a CMP-13.

Son 47 pantallas, 141 rutas bajo `/api/v1` (CON 53, B2B 51, CMP 37), tres migraciones nuevas y 41 pruebas. Los contratos con los demás módulos están publicados en [docs/contratos.md](../contratos.md), en las secciones CON, B2B y CMP.

## Base de datos

Las tres migraciones crean tablas con RLS por empresa, auditoría y `CHECK` con los valores de la spec. También agregan las restricciones que la base puede garantizar.

**`2026_11_24_000100_b2b_clientes_empresariales.php`**
- Tablas:
  - Crédito: `customer_credit_profiles`, `credit_exceptions`.
  - Precios: `customer_prices`.
  - Pedidos recurrentes: `recurring_orders`, `recurring_order_lines`, `recurring_order_runs`.
  - Portal y reclamos: `b2b_portal_accounts`, `b2b_claims`.
  - Cobranza: `collection_reminders`, `payment_promises`.
- Columnas nuevas en `sales_orders`: el origen (portal o recurrente) y el pedido que se repite.
- Vista `b2b_receivables_v`: comprobantes a crédito con su saldo.
- Lo que garantiza la base:
  - Un precio activo por cliente y presentación, sin vigencias que se traslapen (RN-B2B-06).
  - Una corrida por recurrente y fecha de entrega (CA-B2B-03).
  - Una excepción abierta por pedido.

**`2026_11_24_000200_cmp_campanas.php`**
- Tablas:
  - Segmentos: `customer_segments`, `customer_segment_members`.
  - Campañas: `campaigns`, `campaign_recipients`, `campaign_attributions`.
  - Cupones: `coupons`, `coupon_redemptions`.
  - Puntos y referidos: `loyalty_programs`, `loyalty_ledger`, `referrals`.
- Lo que garantiza la base:
  - Quien crea una campaña no la aprueba (RN-CMP-02).
  - Un cupón aplicado por pedido (RN-CMP-10).
  - Un pedido se atribuye a una sola campaña (RN-CMP-15).
  - Un cobro gana puntos una sola vez.
  - El libro de puntos es solo de inserción: `aycha_app` no puede `UPDATE` ni `DELETE`, y un error se corrige con un reverso (RN-CMP-13).

**`2026_11_24_000300_con_consignacion.php`**
- Tablas:
  - Calendario: `calendar_holidays`.
  - Puntos y contratos: `consignment_points`, `consignment_contracts`, `consignment_contract_products`, `consignment_margin_tiers`, `consignment_targets`.
  - Equipos: `consignment_equipment_loans`.
  - Visitas: `consignment_visits`, `consignment_visit_counts`, `consignment_visit_photos`.
  - Entregas: `consignment_deliveries`, `consignment_delivery_lines`.
  - Registro: `consignment_register`.
  - Liquidaciones: `consignment_settlements`, `consignment_settlement_lines`.
- Cada punto tiene su propio almacén (`wh_type = CONSIGNMENT`): lo que está en el punto sigue siendo de la empresa hasta que se vende.
- Lo que garantiza la base:
  - Un contrato activo por punto y fecha (RN-CON-03).
  - El registro es solo de inserción (RN-CON-13).

**Datos de demo:** `data/prototipo-canales.json.gz` trae los datos del prototipo:
- CON: 3 puntos con sus contratos, entregas, visitas y liquidaciones.
- B2B: 10 clientes con crédito y 2 usuarios del portal.
- CMP: 9 campañas, 7 cupones, el programa de puntos y referidos.

`PrototipoSeeder` ahora suma cualquier `prototipo-*.json.gz`, para que cada bloque siembre lo suyo. `CanalesDemoSeeder` deja a los usuarios del portal como usuarios de su cliente y da un código de referido a cada cliente.

## API

Cada módulo vive en `app/Modulos/<Mod>` y sus rutas en `routes/modulos/<mod>.php`. Lo común de los tres está en `app/Modulos/Canales`: fechas de Lima, numeración, avisos, el emisor de WhatsApp y la traducción de los errores de la base a mensajes claros.

**CON**
- Servicios:
  - `Base`: días hábiles con feriados, semáforo de plazo, comisión con escala, reposición y margen neto.
  - `PuntosService`, `EntregasService`, `VisitasService`, `LiquidacionesService` e `IndicadoresService`.
- Visitas desde el celular:
  - **Llegada:** con GPS y radio desde el pin. Fuera del radio, la llegada pide un motivo.
  - **Conteo:** el borrador se guarda campo por campo. El vendido nunca es negativo: si sobra, es sobrante con motivo.
  - **Retiros:** se proponen los lotes por vencer y los retirados del mercado.
  - **Fotos:** con la temperatura de cada congeladora prestada.
  - **Reposición:** sugerida, con tope en el máximo del contrato.
  - **Cierre:** asienta el registro y mueve el stock con ALM.
- Entregas: lotes FEFO con 10 días de vida útil como mínimo (RN-CON-06). Sin guía de remisión (motivo 05) no se despachan.
- Liquidaciones:
  - La comisión del mes sale con la escala del contrato (tramo alcanzado sobre toda la venta).
  - Semáforo de 9 días hábiles para facturar.
  - Factura, y nota de crédito al anular una liquidación facturada.
- La GRE y la factura van por las interfaces `EmisorGreConsignacion` y `FacturadorLiquidacion`. Hoy se usan los respaldos manuales hasta que exista FAC.

**B2B**
- Servicios: `Credito`, `PreciosCliente`, `Pedidos`, `Recurrentes`, `Cobranza`, `Reclamos` y `Portal`.
- **Control de crédito al confirmar** (lo usan PED, el portal y las corridas):
  - Exposición = saldo + pedidos sin facturar.
  - Bloqueo por vencido, con días de gracia.
  - Excepción para un solo pedido. La decide otra persona, nunca quien la pidió.
- **Recurrentes:** corrida diaria a las 18:00 que no repite pedidos.
- **Cobranza:** recordatorios 3 días antes, el día y a los 3 y 7 días de vencido. Promesas de pago que se evalúan solas.
- **Portal:** las rutas `/b2b/portal` exigen una cuenta activa y siempre filtran por su cliente. Las rutas internas rechazan a los usuarios del portal.

**CMP**
- Servicios: `Audiencia` (segmentos, consentimientos y recompra), `Campanas`, `Cupones` y `Puntos`.
- **Campañas:**
  - Antes de enviar, se recalcula el segmento.
  - Se omiten los clientes sin consentimiento de la marca y los que ya llegaron al tope de mensajes de la semana.
  - Hay un grupo de control reproducible.
  - El costo estimado se calcula con la tarifa de WhatsApp más la comisión.
- **Aprobación:** la hace otra persona. Sobre el umbral, solo gerencia.
- **Atribución y retorno:**
  - Un pedido se atribuye al cupón usado o al último mensaje entregado dentro de la ventana.
  - El retorno neto es (cobrado − costo) / costo.
- **Puntos:**
  - Se ganan por sol cobrado sin IGV.
  - Vencen por antigüedad.
  - El canje no puede superar el saldo.
  - Los ajustes y reversos llevan motivo.
- **Referidos:** el bono llega cuando el referido tiene su primer pedido entregado y cobrado.

**Tarea diaria `canales:diario {con|b2b|cmp|corrida}`** (hora de Lima):
- 06:20 CON: plan de visitas, retiros urgentes por lotes retirados y avisos de liquidaciones vencidas.
- 06:30 B2B: bloqueo y desbloqueo de crédito, recordatorios, promesas y reclamos atrasados.
- 06:40 CMP: segmentos vencidos, puntos de cobros, vencimiento de puntos, atribución y referidos.
- 18:00: corrida de recurrentes.

Todas son idempotentes.

**Ajuste en ALM:** el almacén de un punto de consignación no vende al público, pero lo que el punto vendió, devolvió o retiró sale de ahí. `InventarioService` ya no lo rechaza ni vuelve a exigir la vida útil comercial a esas salidas.

## Web

Pantallas en `src/app/(sistema)/m/{con,b2b,cmp}`. Las piezas compartidas están en `src/modulos/canales` (paneles, cifras, semáforo, días de la semana, filtros) y en cada `src/modulos/<mod>`.

**CON**

| Pantallas | Qué hacen |
|---|---|
| CON-01 | Puntos con mapa, filtros y semáforo de liquidación |
| CON-02 | Ficha con pestañas y cambios de estado |
| CON-03 | Contratos: aprobar, nueva versión, terminar |
| CON-04 | Productos y precios al punto |
| CON-05 | Equipos: prestar, devolver, dar de baja |
| CON-06 | Entregas con lotes FEFO, guía y despacho |
| CON-07 | Registro con exportación y reverso |
| CON-08 | Plan semanal de visitas y feriados |
| CON-09 a 12 | App de visita para el celular: llegada, conteo, retiros, fotos (subida real y vista) y reposición |
| CON-13 y 14 | Liquidaciones con aprobación, factura y anulación con nota de crédito |
| CON-15 | Incentivos: ranking, escalas y metas |
| CON-16 | Rentabilidad por punto y mes |
| CON-17 | Stock en puntos con alertas |

**B2B**

| Pantallas | Qué hacen |
|---|---|
| B2B-01 y 02 | Clientes y ficha de crédito: editar, bloquear o desbloquear, historial, documentos abiertos |
| B2B-03 | Precios por cliente con referencia de costo y aprobación bajo margen |
| B2B-04 | Pedidos retenidos y excepciones |
| B2B-05 y 06 | Recurrentes y corridas |
| B2B-07 | Estado de cuenta |
| B2B-08 | Cartera por antigüedad (por cliente, vendedora o marca) |
| B2B-09 | Recordatorios y promesas de pago |
| B2B-10 | Reclamos |
| B2B-11 | Accesos al portal |
| B2B-12 a 17 | Portal del cliente: catálogo con carrito, pedido con fecha y franja, repetir pedido con diferencia de precio, mis pedidos, cuenta y comprobantes (PDF, XML, CDR), reclamos con fotos y usuarios |

**CMP**

| Pantallas | Qué hacen |
|---|---|
| CMP-01 y 02 | Segmentos y constructor de reglas con vista previa en vivo |
| CMP-03 a 06 | Campañas: formulario, estimación con embudo y costo, aprobación, envío y resultados con retorno, grupo de control y atribución |
| CMP-07 | Cupones con «Probar en un pedido» |
| CMP-08 | Programa de puntos |
| CMP-09 | Puntos del cliente: canje, ajuste y reverso |
| CMP-10 | Referidos y ranking |
| CMP-11 | Consentimientos por marca y prueba de baja por palabra |
| CMP-12 | Recompra esperada |
| CMP-13 | Calendario de campañas con clientes repetidos en la semana |

Las 47 pantallas se revisaron a 1440 px y 390 px, sin desborde ni errores en la consola.

## Pruebas

| Archivo | Pruebas | Qué cubre |
|---|---|---|
| `tests/Feature/Modulos/ConTest.php` | 14 | CA-CON-01 a 11, alcance del visitador, aislamiento y pantallas |
| `tests/Feature/Modulos/B2bTest.php` | 13 | CA-B2B-01 a 09, permisos, estado de cuenta en el portal, aislamiento y pantallas |
| `tests/Feature/Modulos/CmpTest.php` | 14 | CA-CMP-01 a 09, RN-CMP-02 (creador y umbral), permisos, mensajes sin códigos, aislamiento y pantallas |

La suite Feature completa pasa: 234 pruebas en verde. `npm run typecheck` y ESLint de los tres módulos también pasan limpios.

Las pruebas encontraron un error y ya está corregido: el conteo de mensajes de marketing de la semana (`Audiencia::enLaSemana`) fallaba en cuanto había mensajes, así que el tope semanal (CA-CMP-08) nunca se aplicaba.

## Decisiones para revisar

**Archivos**
- **Fotos de visita y de reclamos:** se suben de verdad (4 MB, png, jpg o webp) al disco local de la API y se ven con una ruta autenticada. Cuando haya almacenamiento de archivos, solo cambia el disco.

**Factura y guía**
- **GRE y factura de la liquidación:** quedan con respaldo manual (se escribe el número) hasta que exista FAC. FAC registra su implementación con un `bind`.

**Portal**
- **Carrito del portal:** se guarda en el navegador del usuario y no en la base. El pedido recién se crea al enviarlo.

**Campañas, cupones y puntos**
- **Probar un cupón:** además del id, acepta el número del pedido (`P-001383`), que es lo que conoce quien lo prueba. Si vale y el pedido está en borrador o confirmado, se puede aplicar en el mismo diálogo.
- **Retorno de campaña:** se muestra como «S/ 5,58 por sol», es decir, cuánto se gana neto por cada sol gastado.
- **Descuento estimado de una campaña con cupón:** supone que 8 % de los destinatarios lo usa, hasta que haya historia.
- **Estado de un segmento:** la validación aceptaba `ACTIVE` e `INACTIVE`, pero la base guarda `ACTIVE` y `ARCHIVED`. Se corrigió la validación.
- **Baja por palabra clave:** la manda CRM al recibir el mensaje (`/cmp/mensajes/entrante`). En CMP-11 hay un botón para simularla.

**Permisos**
- **Administración** aprueba campañas y ajusta puntos sin tener el módulo CMP, como dice la matriz. Esas rutas piden solo el permiso.
- **MARKETING** tiene el permiso de aprobar campañas: puede aprobar las de otra persona bajo el umbral, nunca las suyas.
- **La vendedora** tiene solo lectura de B2B, pero sus permisos le habilitan pedir excepciones y programar recurrentes.
- **El almacenero** despacha entregas con solo lectura de CON, gracias a su permiso de despacho.
- **El visitador** ve y trabaja solo sus puntos. Ver todos exige `con.visit.view_all`.
