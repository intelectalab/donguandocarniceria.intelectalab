# Plan de sprints · 3 personas

Generado con `python -I tools/prototipo/plan_sprints_por_tablas.py` desde las migraciones reales. Los dos planes anteriores (`plan-de-sprints.md` por carga y `plan-de-sprints-por-objetivos.md`) se conservan para comparar; el equipo decide cuál rige.

## 1. Criterio

- **Un módulo depende de otro si cualquier columna de sus tablas apunta a una tabla del otro, sea obligatoria u opcional.** Una pantalla se entrega con todos sus campos funcionando: no se deja un campo «para después» porque la base lo admita vacío.
- La base (PLT, SEG, MAE, INT, AUD y las tablas comunes `vehicles` y `suppliers`) no cuenta como dependencia: existe desde el inicio.
- **Cortes:** la spec tiene círculos (ALM necesita a PED y PED a ALM…). Si todos bloquearan, nadie podría empezar. Los únicos enlaces que se dejan para después son los de la sección 3, listados con su columna exacta y quién los completa. Son 11 en todo el plan.
- Módulos de las fases 2 a 4 sin migración todavía: dependencias según la spec del prototipo (campo «deps», todas las que nombra).

## 2. Sprints

El sprint 1 ya se entregó: **PLT** (14, A) y **CAT** (12, B). **ALM** era del sprint 1 y no se hizo: pasa al sprint 2 y es lo más urgente, porque PED, FAC, PRE, CAL, EQU y COM lo necesitan.

| Sprint | A · Plataforma, finanzas y SaaS | B · Comercial | C · Operación y producción |
|---|---|---|---|
| **S01** (hecho) | PLT (14) | CAT (12) | — (ALM pendiente) |
| **S02** | SEG (15) | CLI (12) | ALM (13) |
| **S03** | MAE (10), AUD (8) | PED (14) | REC (10), EQU (9) |
| **S04** | INT (13) | FAC (12) | PRE (12) |
| **S05** | SUS (14) | CAJ (13) | CAL (13) |
| **S06** | GAS (11) | POS (12), WEB (8) | PRO (13) |
| **S07** | CNT (16) | CRM (18) | DEL (22) |
| **S08** | API (11) | ADS (9), TEL (12) | COM (12), DES (9) |
| **S09** | SEP (12) | TAB (10) | ETQ (9) |
| **S10** | ONB (16) | B2B (17) | CON (17) |
| **S11** | OPS (16) | CMP (13) | GRJ (7), FLO (15) |
| **S12** | PRS (10) | PER (15) *entre dos* | PER (15) *entre dos* |
| **Pantallas** | 166 | 170 | 169 |

## 3. Cortes de círculos (lo único que se completa después)

| Módulo | Deja para después | Columnas | Quién lo completa |
|---|---|---|---|
| ALM | PED | `stock_reservations.order_id` **(obligatoria)** | La reserva de stock por pedido (stock_reservations) es un concepto de Pedidos: PED crea esa tabla al confirmar pedidos. ALM entrega el stock, los lotes y los movimientos sin reservas. |
| ALM | CLI | `warehouses.customer_id` | warehouses.customer_id es el almacén en consignación de un cliente (CON, fase 3). ALM lo deja vacío; CON lo usa. |
| PED | CRM | `sales_orders.conversation_id` | El canal de origen del pedido: hoy se vende por WhatsApp y mostrador y el pedido nace sin conversación enlazada. CRM enlaza al llegar. |
| PED | WEB | `sales_orders.web_store_id`, `sales_orders.web_inbox_id` | Pedidos de la tienda web: WEB los crea y enlaza cuando exista. |
| PED | POS | `sales_orders.pos_shift_id`, `sales_orders.pos_terminal_id` | Turno y terminal de mostrador: POS los enlaza cuando exista. |
| FAC | POS | `sales_documents.pos_shift_id`, `sales_documents.pos_terminal_id` | Turno y terminal de mostrador en el comprobante: POS los enlaza. |
| FAC | PED | `sales_documents.order_id`, `dispatch_guides.order_id` | Un comprobante puede emitirse sin pedido (FAC-03 Emisión directa). FAC-02 Emitir desde el pedido se termina cuando PED exista; si PED va antes, no hay corte. |
| CAJ | DEL | `driver_settlements.route_ref` | Liquidación del repartidor (driver_settlements.route_ref): DEL la enlaza. |
| CAJ | POS | `payments.pos_shift_id` | Cobro en turno de mostrador: POS lo enlaza. |
| CRM | ADS | `leads.ad_id`, `conversations.ad_id` | Anuncio que originó la conversación: ADS lo enlaza. |
| GAS | ADS | `expenses.ad_campaign_id` | Campaña publicitaria de un gasto: ADS la enlaza. |
| CNT | COM | (según la spec; sin migración aún) | Contabilidad arranca con ventas, cobros y gastos (FAC, CAJ, GAS). Los asientos de compras los suma COM al llegar. |
| CNT | GRJ | (según la spec; sin migración aún) | Los asientos de la granja los suma GRJ al llegar. |
| COM | GRJ | (según la spec; sin migración aún) | Las compras a la granja propia las enlaza GRJ. |
| PRO | DES | (según la spec; sin migración aún) | Producción produce con recetas; el despiece (DES) toma la orden de producción después. |
| ETQ | GRJ | (según la spec; sin migración aún) | Las etiquetas salen de producción y almacén; el origen de granja se agrega con GRJ. |
| FLO | PER | (según la spec; sin migración aún) | La flota arranca con vehículos y rutas; el enlace con choferes y planilla lo pone PER. |
| PER | TEL | (según la spec; sin migración aún) | Telefonía está aplazada por gerencia; Personal se hace sin el enlace a llamadas. |
| SUS | ONB | (según la spec; sin migración aún) | Planes y suscripciones es la base de la consola; el alta de empresas (ONB) la usa después. |
| SUS | OPS | (según la spec; sin migración aún) | Ídem: la consola de soporte (OPS) se apoya en SUS. |
| CNT | TAB | (según la spec; sin migración aún) | CNT-16 Tablero contable y el congelamiento al cerrar el mes se completan cuando TAB exista; el resto de CNT no los necesita. |
| PRO | TAB | (según la spec; sin migración aún) | PRO-12 Tablero de producción se completa cuando TAB exista. |
| PER | FLO | (según la spec; sin migración aún) | Solo la línea «multas» de PER-12 Pagos al personal viene de Flota: se suma cuando FLO exista. (El otro lado, FLO→PER, también está cortado: los dos se hacen sin esperarse.) |
| PRS | PER | (según la spec; sin migración aún) | Solo la bajada a planillas de PRS-07 Detalle del real: se suma cuando PER exista. |

## 4. Cada módulo

| Módulo | Persona | Pantallas | Sprint | Bloqueado por (todas las tablas que usa) | Se completa después |
|---|---|---|---|---|---|
| **PLT** Plataforma | A | 14 | S01 (hecho) | solo la base | — |
| **CAT** Catálogo y listas de precio | B | 12 | S01 (hecho) | solo la base | — |
| **SEG** Seguridad | A | 15 | S02 | solo la base | — |
| **CLI** Clientes y zonas de reparto | B | 12 | S02 | solo la base | — |
| **ALM** Almacenes y lotes | C | 13 | S02 | CAT (S01) | PED, CLI |
| **AUD** Auditoría | A | 8 | S03 | solo la base | — |
| **MAE** Maestros comunes | A | 10 | S03 | solo la base | — |
| **PED** Pedidos | B | 14 | S03 | CLI (S02) | CRM, WEB, POS |
| **EQU** Equipos y mantenimiento | C | 9 | S03 | ALM (S02) | — |
| **REC** Recetas y formulación | C | 10 | S03 | CAT (S01) | — |
| **INT** Integraciones | A | 13 | S04 | solo la base | — |
| **FAC** Comprobantes y guías | B | 12 | S04 | CAT (S01), CLI (S02), ALM (S02) | POS, PED |
| **PRE** Preparación de pedidos | C | 12 | S04 | CAT (S01), ALM (S02), PED (S03) | — |
| **SUS** Planes y suscripciones | A | 14 | S05 | solo la base | ONB, OPS |
| **CAJ** Cajas, cobros y conciliación | B | 13 | S05 | CLI (S02), PED (S03) | DEL, POS |
| **CAL** Calidad | C | 13 | S05 | CAT (S01), CLI (S02), ALM (S02), EQU (S03), PED (S03), FAC (S04) | — |
| **GAS** Gastos | A | 11 | S06 | CAJ (S05) | ADS |
| **POS** Mostrador | B | 12 | S06 | CAT (S01), ALM (S02), CAJ (S05) | — |
| **WEB** Tienda web y Mercado Pago | B | 8 | S06 | CAT (S01), CLI (S02), CAJ (S05) | — |
| **PRO** Órdenes de producción | C | 13 | S06 | CAT (S01), ALM (S02), EQU (S03), REC (S03), CAL (S05) | DES, TAB |
| **CNT** Contabilidad | A | 16 | S07 | ALM (S02), FAC (S04), CAJ (S05), PRO (S06), GAS (S06) | COM, GRJ, TAB |
| **CRM** Bandeja omnicanal | B | 18 | S07 | CLI (S02), PED (S03) | ADS |
| **DEL** Delivery | C | 22 | S07 | CLI (S02), PED (S03), FAC (S04), GAS (S06) | — |
| **API** API pública y webhooks | A | 11 | S08 | CAT (S01), CLI (S02), ALM (S02), PED (S03), FAC (S04), SUS (S05), CAJ (S05), DEL (S07) | — |
| **ADS** Publicidad y atribución | B | 9 | S08 | CLI (S02), PED (S03), CRM (S07) | — |
| **TEL** Telefonía (incluida y apagada) | B | 12 | S08 | CLI (S02), PED (S03) | — |
| **COM** Compras y cuentas por pagar | C | 12 | S08 | CAT (S01), ALM (S02), EQU (S03), CAJ (S05), CAL (S05), GAS (S06), CNT (S07) | GRJ |
| **DES** Despiece y costeo conjunto | C | 9 | S08 | CAT (S01), ALM (S02), EQU (S03), CAL (S05), PRO (S06) | — |
| **SEP** Separación de marcas | A | 12 | S09 | CLI (S02), ALM (S02), PED (S03), FAC (S04), SUS (S05), CAJ (S05), WEB (S06), CRM (S07), ADS (S08) | — |
| **TAB** Tablero e indicadores | B | 10 | S09 | ALM (S02), PED (S03), FAC (S04), PRE (S04), CAJ (S05), GAS (S06), DEL (S07), CRM (S07), ADS (S08) | — |
| **ETQ** Etiquetas y trazabilidad | C | 9 | S09 | CAT (S01), CLI (S02), ALM (S02), PED (S03), FAC (S04), PRE (S04), CAL (S05), PRO (S06), CRM (S07), COM (S08) | GRJ |
| **ONB** Alta de empresas | A | 16 | S10 | CAT (S01), CLI (S02), ALM (S02), REC (S03), FAC (S04), SUS (S05), CAL (S05), GAS (S06), CRM (S07), DES (S08), TAB (S09) | — |
| **B2B** Clientes empresariales | B | 17 | S10 | CAT (S01), CLI (S02), PED (S03), FAC (S04), CAJ (S05), DEL (S07), CRM (S07), CNT (S07), TAB (S09) | — |
| **CON** Consignación | C | 17 | S10 | CAT (S01), CLI (S02), ALM (S02), FAC (S04), CAJ (S05), CAL (S05), DEL (S07), CNT (S07), TAB (S09) | — |
| **OPS** Consola de plataforma y soporte | A | 16 | S11 | SUS (S05), ONB (S10) | — |
| **CMP** Campañas y fidelización | B | 13 | S11 | CLI (S02), PED (S03), FAC (S04), CAJ (S05), CRM (S07), ADS (S08), TAB (S09) | — |
| **FLO** Flota avanzada | C | 15 | S11 | CAL (S05), GAS (S06), DEL (S07), CNT (S07), TAB (S09) | PER |
| **GRJ** Integración con la granja | C | 7 | S11 | CAT (S01), ALM (S02), CAL (S05), CNT (S07), COM (S08), ETQ (S09) | — |
| **PRS** Presupuesto | A | 10 | S12 | FAC (S04), GAS (S06), CNT (S07), ADS (S08), COM (S08), TAB (S09), FLO (S11) | PER |
| **PER** Personal | C | 15 | S12 | PED (S03), CAJ (S05), DEL (S07), CRM (S07), CNT (S07), TAB (S09) | TEL, FLO |

## 5. Reglas

1. **Nada se entrega con un campo colgado.** Si una pantalla tiene un selector de lote, vehículo o cliente, ese selector funciona el día que se entrega. Por eso el módulo espera a quien le da el dato.
2. **Los cortes de la sección 3 son los únicos huecos permitidos.** Quien completa el enlace lo hace en su propio sprint y lo anota en `docs/cambios/`.
3. **Contrato antes que código.** Al empezar un módulo que otros usan, su dueño publica primero en `docs/contratos.md` la firma de sus servicios. Los de PLT ya están en `docs/como-construir-un-modulo.md`: `Correlativo::emitir`, `Periodos::abierto`, `Marcas::activa`, `CentrosCosto::activo`, `Params::get`, `Busqueda::publicar`.
4. **Las tablas ya existen** para las fases 0 y 1 (más CAL, REC y EQU): el dueño revisa tipos, únicos y estados antes de hacer sus pantallas y cambia con migraciones nuevas, nunca editando las existentes.
5. Se regenera con el script cuando cambie una migración o un corte; no se edita a mano.

## 6. Huecos del plan y por qué están

- **ALM es lo más urgente:** era del sprint 1 y no está. PED (S03), FAC (S04), PRE, CAL, EQU y COM lo necesitan. Si no entra en S02, todo lo de C se corre un sprint.
- **TAB va al final de la fase 1** (no al principio): sus seis tableros muestran números de PED, CAJ, DEL, PRE, CRM y ADS. Sin ellos es una cáscara. Como TAB no apunta a otras tablas (los indicadores llegan por catálogo), el script lo sabe por una regla explícita, no por la base.
- **A tiene sprints sin módulo:** GAS espera a CAJ (`expenses.paid_from_account_id`, la cuenta de caja desde la que se paga un gasto), y lo demás de A depende de módulos de B y C. Esos sprints A los usa para lo que no es pantalla: la conexión con el proveedor de facturación electrónica (OSE/PSE) que FAC necesita, los respaldos y el despliegue, y los cortes de la sección 3 que le tocan.
- **DEL en S07 con 22 pantallas** es el sprint más pesado: DEL necesita GAS y GAS necesita CAJ. No se adelanta sin cortar un enlace real.
- **C se queda sin módulos libres en varios sprints:** todo lo de producción (PRO, DES, COM, ETQ, GRJ) espera a CAL, que espera a FAC. Es el costo de no dejar campos colgados; esos sprints C puede apoyar a B, que es quien más carga lleva.
- **Los sprints finales son de una sola persona** (PRS depende de casi todo). Es normal: los últimos módulos son los que consolidan al resto.
