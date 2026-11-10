# Revisión de la versión 2.4 del prototipo (10/11/2026)

Llegó una versión más nueva del prototipo de Don Guando, publicada como producto aparte con otro nombre. Se revisó su app compilada contra el prototipo que usamos (`aycha-proto`) para ver qué conviene llevar a Aycha.

**El producto sigue siendo Aycha.** De esa versión se toman pantallas y correcciones de reglas, nunca su nombre ni su marca. Las cinco reglas de la spec que esa versión «cambió» (RN-API-07, RN-OPS-06, RN-SUS-12, RN-SUS-19, RN-SUS-21) solo reemplazan Aycha e Intelectalab por su nombre: no se aplican.

Tampoco se trae su servidor (Node y Express): hace lo mismo que ya resolvemos con Laravel, RLS, permisos en la API y bitácora.

## 1. Lo que no cambió
Parte de la misma spec: los mismos 40 módulos, 498 pantallas y 646 reglas. El diseño de la app casi no cambió: sus estilos difieren en 27 líneas (las del mapa, el menú corto y el indicador de guardado).

## 2. Seis pantallas nuevas
Van en la sección 7 de [plan-de-sprints-por-tablas.md](plan-de-sprints-por-tablas.md), con su dueño y su sprint.

| Pantalla | Qué hace | Base de datos hoy |
|---|---|---|
| **CAT-13 Categorías** | Cada empresa arma sus categorías (res, cerdo, pollo, cordero, menudencia, embutidos, preparados): nombre, especie, orden, color, si se ven en la caja y en la web. Se mueven productos de una a otra; una categoría con productos activos no se inactiva. Ventas y kilos por categoría (7, 30 o 90 días). Una empresa nueva crea de un clic las categorías típicas. La caja (POS-02) y el catálogo del pedido (PED) se agrupan por categoría en vez de por línea fija. | Existe `product_categories` y `category_id` en el catálogo: revisar columnas (especie, color, orden, visible en caja y web). |
| **CRM-19 Formularios y popups de la web** | Una dirección por formulario de WordPress (Elementor, Contact Form 7, OptinMonster, Popup Maker o HTML propio). Cada envío entra como lead en CRM-05 con nombre, teléfono, correo, mensaje, página y campaña (utm). El mismo teléfono o correo en 24 horas se suma al lead abierto. Trampa para robots, límite por IP y página de gracias. Alerta de leads de la web sin atender. | No existe: tabla de formularios con su clave pública y registro de envíos. |
| **DEL-23 Pagos por validar** | Pedidos pagados por transferencia, depósito, Yape o Plin a la cuenta de la empresa: el vendedor (o supervisión, administración o cobranza) escribe el número de operación y valida, y se registra el cobro. No se acepta un número de operación ya usado ni un monto menor al pedido. La ruta no sale con pedidos sin validar. Si el cliente transfiere en la entrega, el vendedor confirma que llegó o lo rechaza (se revierte y cobranza recibe el aviso). Se apaga con el parámetro `del_seller_payment_check`. | No existe: número de operación único, quién y cuándo validó, estado. |
| **DEL-24 Devoluciones del reparto** | En la parada, «Entregar con rechazo»: qué productos y cuánto devolvió el cliente y el motivo (calidad, peso, producto equivocado, empaque, sin frío, no lo pidió). El cobro contra entrega baja en lo rechazado. Lo rechazado vuelve con la ruta; al recibirlo entra al almacén de devoluciones del local (`InventarioService::devolver` de ALM) y, si ya había comprobante, sale la nota de crédito (motivo 07, por ítem). Avisos al coordinador y al vendedor. | No existe: devolución con sus líneas, motivo y recepción. |
| **TAB-11 Análisis de ventas** | Ventas sin IGV con 7 indicadores y su variación frente al período anterior o al mismo del año pasado; por categoría, marca, local, canal, vendedora, cliente, producto, zona, día u hora; tendencia, lo que más sube y baja y productos ABC. Filtro por canal. La vendedora ve solo lo suyo. Se exporta con el diseño de reporte (`App\Support\Exportar`). | Lee de lo existente: no necesita tablas. |
| **WEB-09 Conexión con las tiendas** | Cada tienda WooCommerce se conecta con sus claves de la API REST: se prueba la conexión, las claves se guardan cifradas y nunca vuelven al navegador. Los pedidos entran por webhook firmado (uno con firma falsa se rechaza y uno repetido no duplica) y una revisión cada 10 minutos por si se perdió un aviso; pasan por la bandeja WEB-04. Stock, precios y productos nuevos salen a la tienda en lotes con reintentos. «Traer productos» vincula el catálogo de la tienda por SKU. | Existe `web_stores`: faltan las claves cifradas, el secreto del webhook y el registro de lo recibido. |

## 3. Errores del prototipo que esa versión corrigió
Nuestro prototipo todavía los tiene. Quien construya FAC, CAJ, POS y PED debe seguir la versión corregida, no la del prototipo:

| Error en `aycha-proto` | Cómo debe quedar en Aycha |
|---|---|
| Los comprobantes que salen de un pedido (mostrador, pedidos, B2B, API) ponen IGV «10 gravado» en todas las líneas (`G.docs.fromOrder`). | La afectación del IGV sale de cada producto, como en FAC: gravado, exonerado o inafecto. |
| La boleta de mostrador usa siempre la serie `B010`, y si una marca no tiene serie toma la de otra marca (`G.series.for`). | Serie de mostrador del local (o la de la empresa); nunca la de otra marca; error claro si no hay serie. En Aycha la serie la da `Correlativo::emitir`. |
| Un cobro se puede asignar por más de su monto, o aplicarse a un comprobante al crédito por encima de su saldo (`G.pay.register`). | Las asignaciones no superan el cobro ni el saldo del comprobante. Un pedido sí puede quedar pagado de más: el exceso es saldo a favor del cliente. |
| La empresa emisora y el local están escritos a mano como los de Don Guando (`'co-dg'`, `'es-L1'`) en más de 150 lugares. | Siempre la empresa y el local del contexto o de la marca. En Aycha ya es así por RLS y por los selectores de marca y local; vale como recordatorio al leer el prototipo. |
| La huella del comprobante (`xml_hash`) es un texto al azar. | SHA-256 del contenido hasta que el OSE devuelva la del XML firmado. |
| Las librerías de QR y de optimización se cargan de un CDN sin verificación. | En Aycha van como dependencias del proyecto, nunca de un CDN sin integridad. |

## 4. Mejoras de uso para considerar
No son pantallas de la spec; se deciden en equipo.

- **Menú corto por puesto:** cada persona ve primero «Lo de todos los días» de su rol (la cajera: venta, turno, cierre; el repartidor: sus rutas; la contadora: su bandeja) y fija más pantallas con una estrella. «Ver todos los módulos» abre el menú completo. Toca el armazón (A).
- **Campana con lo importante:** cuenta solo lo urgente para el puesto, con «Importantes» y «Todas».
- **Mapa de calles en el reparto** (Leaflet con OpenStreetMap, que vuelve al plano esquemático si no carga) y botones «Ir con Google Maps» e «Ir con Waze», gratuitos y sin clave. Orden de paradas mejorado. Va con DEL.
- **App del repartidor instalable y sin señal:** se instala desde el navegador del teléfono, abre sin señal, guarda lo registrado y lo envía al volver, y manda la ubicación con la app abierta. Va con DEL.
- **Módulos por plan:** lo que el plan del cliente no incluye no aparece en el menú y la API rechaza sus datos. Va con SUS y PLT-12.

## 5. Dónde está
El archivo recibido no se sube a GitHub. Quien lo necesite lo pide al equipo.
