# Revisión del prototipo Aycha · Don Guando Comercial (v1.2)

Fecha de la revisión: 03/11/2026
Prototipo revisado: `aycha-proto/` (copia de `Aycha_Prototipo_v1.2_20261016.zip`)
Base técnica: Laravel 12 / PHP 8.4, Next.js 16 + React 19 + Tailwind 4, PostgreSQL 17 con RLS, Redis, Sanctum, Docker
Equipo: 3 personas

---

## 1. Qué es el prototipo

Es un HTML de un solo archivo (`dist/aycha-don-guando.html`, 6,8 MB) armado desde `src/` con `tools/build.py`. Funciona sin servidor: guarda todo en `localStorage` y simula SUNAT, WhatsApp, Mercado Pago, WooCommerce, anuncios y telefonía. La fecha de la demo está fija (`G.TODAY = 2026-10-10`).

Muestra el SaaS comercial **Aycha** (de Intelectalab) aplicado a **AGROPECUARIA DON GUANDO SAC**:

- 1 RUC con 5 marcas que facturan con él (Don Guando, Cortes, Embutidos, Despensa, Gourmet).
- 2 locales: Surco, con producción y mostrador, y Lurín, con producción.
- ~1000 pedidos al mes, que llegan por 6 números de WhatsApp, la web WooCommerce con Mercado Pago, TikTok, Facebook e Instagram.
- Reparto propio, alquilado o con terceros, y envíos a provincia.
- Una segunda empresa de demo (`CS`, Carnes Selectas del Sur) que sirve para probar el aislamiento entre tenants.

### Archivos y para qué sirve cada uno

| Archivo | Qué es | Para qué sirve en el proyecto |
|---|---|---|
| `dist/spec.json` | **La especificación completa**: por módulo trae objetivo, dependencias, pantallas, reglas RN, criterios CA, KPI, permisos, parámetros y decisiones D | **El requerimiento real.** Es lo que manda |
| `dist/tablas.md` | Tablas por módulo, más las funciones SQL y las vistas | Base para las migraciones |
| `API.md` | Guía para quienes armaron el prototipo (núcleo `G.*`, servicios, semillas, pruebas) | Muestra los **contratos entre módulos**: inventario, pedidos, comprobantes, cobros y eventos |
| `NOTAS-*.md` | Decisiones y respaldos que tomó cada módulo del prototipo | Pendientes y choques entre módulos (sección 6) |
| `src/modules/*.js` | El código de cada pantalla | Referencia de disposición, textos y cálculos |
| `tools/*` | Pruebas con Playwright (`test.js`, `roles-sweep.js`, `boot-check.js`) | Sirven para comparar después |

**No está en la carpeta** el kit que citan `API.md` y `tablas.md`: `aycha-kit/docs/fase-N/modulos/*.md`, `docs/modelo-de-datos.md` (con las columnas de cada tabla), `02-mapa-de-modulos.md` y los SQL `f0_nucleo.py` y `f0_plataforma.sql`. `spec.json` cubre casi todo el texto, pero **las columnas exactas de las tablas solo están completas en ese kit**. Hay que pedirlo.

---

## 2. Verificación funcional (hecha el 03/11/2026)

| Revisión | Resultado |
|---|---|
| Pantallas de la spec presentes | 498/498 (más 6 auxiliares = 504) |
| Cada pantalla abre sin error, con título y contenido | 504/504 |
| Pruebas funcionales (una por criterio CA) | 322/322 aprobadas |
| Acceso de los 22 roles | Todos entran; ninguna pantalla visible falla |
| `dist` al día con `src` | Sí |
| Celular a 390 px | Sin desborde en la muestra revisada (157 pantallas) |

Fallas del HTML del prototipo (no afectan al sistema real, solo a la demo): faltan `<meta charset="utf-8">` y `<meta name="viewport">` en `src/template.html`. Servido por HTTP, la demo no arranca. En celular se ve como escritorio reducido.

---

## 3. Tamaño del trabajo

| Fase | Módulos | Pantallas | Reglas RN | Criterios CA | KPI | Decisiones D |
|---|---|---:|---:|---:|---:|---:|
| 0 Plataforma | PLT, SEG, MAE, AUD, INT | 60 | 89 | 35 | 17 | 23 |
| 1 Operación comercial | CAT, CLI, PED, POS, WEB, CRM, ADS, TEL, ALM, PRE, DEL, FAC, CAJ, GAS, TAB | 184 | 215 | 116 | 109 | 66 |
| 2 Producción y contabilidad | COM, GRJ, PRO, REC, DES, CAL, EQU, ETQ, CNT | 98 | 129 | 59 | 44 | 28 |
| 3 Nuevos canales | B2B, CMP, CON, FLO, PER, PRS | 87 | 117 | 54 | 49 | 25 |
| 4 Producto SaaS | SUS, ONB, OPS, API, SEP | 69 | 96 | 37 | 26 | 27 |
| **Total** | **40** | **498** | **646** | **301** | **245** | **169** |

Es un sistema grande y de dominio físico: peso variable, lotes FEFO, cadena de frío, producción con costeo conjunto, reparto y escaneo.

### Roles (22)
GERENTE, ADMIN_SISTEMA, ADMINISTRACION, SUPERVISORA_VENTAS, VENDEDORA, CAJERO, ALMACENERO, PREPARADOR, COORDINADOR_DELIVERY, REPARTIDOR, MARKETING, JEFE_PRODUCCION, OPERARIO_PRODUCCION, CALIDAD, COMPRAS, CONTADORA, PRACTICANTE_CONTABLE, VISITADOR_CONSIGNACION, RRHH, CLIENTE_B2B, SOPORTE_PLATAFORMA, AUDITOR.

El alcance se filtra por **marca y local** (la vendedora solo ve sus marcas).

### Apps y portales de un solo rol
App del repartidor (DEL), del preparador (PRE), del operario (PRO) y del visitador de consignación (CON). Portal del cliente empresarial (B2B). Las cuatro apps se pueden hacer como PWA con modo sin conexión.

---

## 4. Base técnica

La base sigue la arquitectura de erp-saas, otro SaaS de Intelectalab: monorepo `apps/api` + `apps/web`, migraciones de Laravel, RLS por tenant, Sanctum y tema por variables. Sobre esa forma de trabajo, Aycha agrega lo propio del rubro:

| Módulo | Lo que Aycha agrega |
|---|---|
| PLT | **Marcas** dentro del tenant, varias empresas (RUC) por tenant, series por marca y dominio por tenant |
| SEG | Alcance con dos ejes (marca y local). La spec pide segundo factor **TOTP** (CA-SEG-01) |
| AUD | Políticas de retención y purga (`audit_retention_policies`) |
| INT | Outbox, idempotencia y conectores reales |
| SUS / ONB / OPS | Planes por producto, plantillas por rubro e importadores masivos |
| Estilo | Paleta de Don Guando: granate #922242, dorado #FFC676, crema |

---

## 5. Integraciones externas que el prototipo simula

En el sistema real hacen falta cuentas, credenciales y, en algunos casos, contrato. Cada una debe estar detrás de un adaptador con modo de prueba, para desarrollar y probar sin la cuenta real:

| Integración | Módulo | Qué se necesita |
|---|---|---|
| Facturación electrónica SUNAT (OSE o PSE) | FAC | Proveedor elegido |
| WhatsApp Cloud API (6 números, coexistencia) | CRM | Verificación del negocio en Meta, plantillas aprobadas, costo por mensaje |
| WooCommerce y Mercado Pago | WEB, CAJ | Claves de la tienda y de la pasarela, y webhooks |
| Google, Meta y TikTok Ads | ADS | Acceso de lectura a las cuentas publicitarias |
| Telefonía con grabación | TEL | Viene apagada; se puede dejar para el final |
| SaaS de Granja Don Guando | GRJ | API del otro sistema |
| Ayni HR | PER | API o archivo de intercambio |
| Mapas y geocodificación | CLI, DEL | Proveedor (el prototipo usa un mapa esquemático) |
| Balanzas y lectores de códigos | PRE, POS, PRO | PLU de balanza, lectura de código de barras con la cámara |

---

## 6. Puntos abiertos que deja el prototipo

1. **169 decisiones D** con valor provisional. Por ejemplo, D-PED-01: un pedido por marca. D-PED-02: 3 franjas de 40 pedidos. Hay que confirmarlas con el cliente; el listado completo está en `spec.json`.
2. **FAC fija la empresa `co-dg`** en `assertSeries`, `issueGuide` y los resúmenes diarios. Con la separación de marcas (SEP) debe usarse la empresa vigente a la fecha (NOTAS-SEP).
3. **Accesos a SEP:** CONTADORA y ADMINISTRACION preparan la separación por permiso especial, pero no ven el menú (NOTAS-SEP sugiere `CLE`).
4. **Presupuesto:** con los datos de ejemplo, la planilla (~S/ 85 000) casi iguala las ventas sin IGV (~S/ 88 000), así que el resultado sale negativo (NOTAS-PRS). Es un efecto de la demo, pero conviene revisarlo con datos reales.
5. **2FA:** TOTP según la spec, o código por correo.
6. **Columnas de tablas:** falta `modelo-de-datos.md` del kit (sección 1).

---

## 7. Contratos entre módulos (lo que más hay que cuidar entre 3 personas)

El prototipo funciona porque todos los módulos pasan por **unas pocas puertas únicas** del núcleo. En el sistema real cada una debe ser un servicio de Laravel con su dueño, y nadie escribe directamente en las tablas de otro:

| Puerta | Qué hace | Lo usan |
|---|---|---|
| Inventario (`G.inv.move`) | Única forma de mover stock: FEFO, lote liberado, sin negativos (RN-ALM-01/02/03), reservas | PED, POS, PRE, DEL, PRO, DES, CON, COM, SEP |
| Pedidos (`G.orders`) | Crear, confirmar con datos obligatorios (RN-PED-01), pesar, cambiar de estado | POS, WEB, CRM, B2B, CON, API |
| Comprobantes (`G.docs`) | Emitir por serie de marca, IGV, notas | PED, POS, DEL, CAJ, B2B, CON, SEP |
| Cobros (`G.pay`) | Registrar con referencia según el medio, aplicar a pedido o comprobante | POS, DEL, WEB, B2B, CON |
| Eventos (`G.events`) | `order.confirmed`, `document.issued`, `stock.moved`… → `domain_events` + outbox | CNT (asientos al vuelo), TAB, CRM |
| Parámetros, períodos, series y módulos | `param`, `period.assertOpen`, `series.next`, `assertMod` | Todos |
| KPI (`G.kpiCalc`) | Cada módulo registra el cálculo de sus KPI; TAB los muestra | Todos → TAB |

---

## 8. Reparto entre 3 personas

El reparto es por dominio, para que cada persona sea dueña de sus puertas y de sus tablas, y equilibrado en pantallas según la spec:

| Persona | Dominio | Módulos | Pantallas |
|---|---|---|---:|
| **A · Plataforma, finanzas y SaaS** | Base técnica, seguridad, contabilidad | PLT, SEG, MAE, AUD, INT · GAS · CNT, PRS · SUS, ONB, OPS, API, SEP | 166 |
| **B · Comercial** | Del cliente al comprobante y al cobro | CAT, CLI, PED, POS, WEB, CRM, ADS, TEL, TAB · FAC, CAJ · CMP, B2B | 162 |
| **C · Operación y producción** | Stock, preparación, reparto, planta | ALM, PRE, DEL · COM, GRJ, PRO, REC, DES, CAL, EQU, ETQ · CON, FLO, PER | 170 |

Dueños de las puertas: **A** → parámetros, períodos, series, módulos, eventos y outbox, permisos. **B** → pedidos, comprobantes, cobros, precios. **C** → inventario y reservas.

### Orden de trabajo

1. **Arranque (las 3 personas):** la base del repo (ya hecha: ver `docs/cambios/`), convenciones, componentes de UI compartidos y paleta. Se acuerdan por escrito las firmas de las 7 puertas de la sección 7 (en `docs/contratos.md`), aunque al principio estén vacías.
2. **Fase 0 + inicio de fase 1 en paralelo:** A construye las pantallas de PLT/SEG/MAE/AUD/INT sobre la base. B arranca con CAT y CLI. C arranca con ALM y la puerta de inventario.
3. **Fase 1 (el MVP que opera la tienda):** B → PED, POS, FAC, CAJ, WEB, CRM. C → PRE, DEL con su app. A → GAS y la parte de TAB que es de plataforma; además integra y revisa.
4. **Fases 2 a 4**, según lo que priorice el cliente.

### Reglas de equipo
- Una rama por tarea y un PR revisado por otra persona antes de unir a `main`.
- Cada entrega se documenta en `docs/cambios/AAAA-MM-DD_tema.md`, con el mismo formato de los que ya están.
- Las migraciones llevan prefijo de fecha y hora y tocan **solo las tablas propias**. Si un módulo necesita una columna en una tabla ajena, se la pide a su dueño.
- Pruebas por criterio CA, como en el prototipo: cada `CA-…` tiene su prueba en Laravel (Pest o PHPUnit). Los números del criterio se reproducen tal cual.
- El prototipo manda en disposición y textos; la spec manda en reglas. Si una regla cambia la disposición, se propone antes de construir.

---

## 9. Decisiones

### Tomadas
| Fecha | Decisión |
|---|---|
| 03/11/2026 | Repo propio con la base técnica de la sección 4 (`apps/api` + `apps/web`). |
| 03/11/2026 | La base de datos parte con las tablas de las fases 0 y 1, más CAL, REC y EQU, con datos de demo. |
| 03/11/2026 | Ingreso general: la empresa sale del usuario, no del dominio (se puede activar después). |
| 03/11/2026 | El segundo factor queda pendiente: no se implementa por ahora. |

### Abiertas
1. Pedir el kit completo (`aycha-kit/docs`, `modelo-de-datos.md`, SQL).
2. Confirmar con el cliente las decisiones D de la fase 1 (66) y elegir los proveedores de la sección 5.
3. Segundo factor: TOTP o código por correo.
4. Las demás están en [pendientes.md](pendientes.md).
