# INT · Integraciones

Módulo de Yadira. Se construye en 5 tandas:

1. Conectores y credenciales: INT-01, INT-02 e INT-03.
2. Mensajes salientes y cola muerta, con su despacho: INT-06 e INT-07.
3. Webhooks de entrada y su bitácora: INT-04 e INT-05.
4. Corridas programadas, salud y simulador: INT-08, INT-12 e INT-13.
5. Notificaciones, preferencias y archivos adjuntos: INT-09, INT-10 e INT-11.

Las tablas existen desde la base del proyecto, con 28 conectores y 30 credenciales de demostración de Don Guando.

# Tanda 1 (24/11): conectores y credenciales

## Base de datos

Migración `2026_11_25_000100_int_conectores_y_credenciales`:
- `integration_credentials`:
  - `secret_enc` pasa a texto, porque el secreto cifrado no entra en 255 caracteres;
  - `revoked_reason` pasa a 300 caracteres y `created_by` a 120;
  - columna nueva `rotated_from`, la versión de la que viene una rotación;
  - CHECK de estado y versión;
  - índice único parcial: **una sola credencial vigente por conector y nombre** (RN-INT-03).
- `integration_connectors`:
  - columna nueva `status_reason`, el motivo del último cambio de estado;
  - CHECK de estado y entorno;
  - **el adaptador falso nunca en producción** (RN-INT-01).

Antes de migrar se revisó que los datos de demostración cumplieran todo.

## Adaptadores (`App\Modulos\Int\Services\Adaptadores`)

- Cada tipo de conector tiene su interfaz (mensajería, comprobantes, pagos, anuncios, telefonía, mapas, comercio, balanzas, delivery, GPS, granja, personal, correo, push y tipo de cambio).
- En el entorno de prueba (o con el adaptador `FAKE`) responde el **adaptador falso**, sin salir a internet. «Simular caída» lo hace fallar como si el proveedor no respondiera.
- Los **adaptadores reales** (WhatsApp Cloud, OSE, Mercado Pago…) se instalan con el módulo que los usa (CRM, FAC, CAJ…) en `Adaptadores::INSTALADOS`. Mientras uno no está instalado, «Probar conexión» lo dice tal cual y **no lo cuenta como falla**, para que el conector no pase a «En error» por algo que no depende del proveedor.

## Reglas

- **RN-INT-19:** tras `int_connector_error_threshold` (3) fallos seguidos, el conector pasa a «En error» y avisa a la administración del sistema con severidad crítica. La siguiente conexión correcta lo devuelve a «Activo» y avisa que volvió. Se guardan los últimos 30 errores.
- **RN-INT-14:**
  - con el módulo dueño apagado, el conector no se activa;
  - desactivado, no se prueba;
  - activar y desactivar piden un motivo de al menos 10 caracteres.
- **RN-INT-02:** el secreto se cifra con la clave de la aplicación (`APP_KEY`, fuera de la base) en formato `enc:v2:…`.
  - No vuelve nunca a la pantalla ni a la bitácora: solo sus últimos 4 caracteres (`••••1234`).
  - Los adaptadores reales lo leen con `Credenciales::secreto()`.
  - Las credenciales de demostración traen un `enc:v1:…` de ejemplo que no se descifra.
- **RN-INT-03:**
  - cargar una que ya está vigente pide rotarla;
  - rotar crea la versión siguiente y revoca la anterior («Rotación»);
  - revocar pide un motivo de al menos 10 caracteres.
- **RN-INT-20:** las que vencen dentro de `int_credential_expiry_warn_days` (7) días se avisan. Las vencidas se marcan «Vencida».
- **Permisos:** probar, activar y simular piden `int.connector.manage`; cargar, rotar y revocar piden `int.credential.rotate`. Por defecto los tienen la administración del sistema y la gerencia.
- **Bitácora:** cada acción queda en `domain_events` (`connector.tested`, `connector.enabled` y `disabled`, `credential.loaded`, `rotated` y `revoked`), siempre con el valor enmascarado.

## Pantallas

- **INT-01 Conectores:**
  - cifras: activos, en error, números de WhatsApp y entorno de prueba;
  - buscador y filtros por tipo, marca, entorno y estado;
  - columnas: conector, tipo, adaptador, marca y local, entorno, módulo, última conexión correcta, último error y estado. Todas se ordenan.
  - Se muestran el adaptador y el módulo con su nombre, nunca con su código interno.
- **INT-02 Ficha del conector:**
  - «Probar conexión», con el resultado en pantalla;
  - activar o desactivar con motivo;
  - avisos de «En error» y de módulo apagado;
  - configuración no secreta, credenciales vigentes (enmascaradas), webhooks de entrada, actividad (mensajes salientes, webhooks y corridas) e historial de errores;
  - en los de prueba, la casilla «Simular caída del proveedor».
- **INT-03 Credenciales:**
  - avisos de vencidas y por vencer;
  - filtros por conector y estado;
  - valor enmascarado, versión, vencimiento, quién la cargó y estado;
  - «Cargar credencial» (con el botón para ver u ocultar el secreto), «Rotar» y «Revocar».

**No se agregó del prototipo:** la tarjeta técnica «Así la ve la API», que en el prototipo sirve para mostrar que el secreto sale enmascarado. Eso queda cubierto por la prueba.

## Pruebas

`tests/Feature/Modulos/IntTest.php`, con 4 casos:
- la lista y la ficha sin secretos, y el aislamiento entre empresas;
- probar con el adaptador falso y con uno real no instalado, y el paso a «En error» con su aviso y su recuperación;
- activar y desactivar con motivo, y el módulo dueño apagado;
- las credenciales cifradas: cargar, una sola vigente, rotar, revocar, permisos, y que ni la respuesta ni la bitácora traigan el secreto.

En total el sistema tiene 366 pruebas, todas correctas. Revisado en el navegador contra `aycha_test` (1440 y 375 px).

---

# Tanda 2: mensajes salientes, cola muerta y despacho (INT-06 e INT-07)

## Base de datos

Migración `2026_11_25_000200_int_mensajes_salientes`:
- los intentos pasan a número entero;
- columnas nuevas `manual` (las acciones a mano, con quién, cuándo y motivo) y `cancel_reason`;
- reglas en la base para el estado y el tipo, e intentos nunca negativos;
- la clave de idempotencia es única por empresa (RN-INT-11);
- índice por estado y próximo intento, para que el despacho encuentre rápido lo que toca.

El número OB-000168… sigue al último de la empresa. Se calcula al registrar el mensaje, con un bloqueo hasta que termina la transacción, para que dos mensajes a la vez no reciban el mismo número.

## Reglas (Services\Salientes)

- **RN-INT-08:** `Salientes::encolar()` se llama dentro de la transacción del cambio de negocio. Si esa transacción se revierte, el mensaje no existe.
- **RN-INT-14:** con el módulo apagado (el que registra el mensaje o el dueño del conector), el mensaje no se crea.
- **RN-INT-09:** si un envío falla, se reintenta con una espera de 30 s × 2^(intento − 1), con tope de 1 hora (parámetros `int_outbox_base_delay_seconds` e `int_outbox_max_delay_seconds`). Cada intento queda guardado con su error y su espera. Al fallar 8 veces (`int_outbox_max_attempts`), el mensaje pasa a la cola muerta: se registra el evento `outbox.dead` y llega un aviso crítico a la administración del sistema, con enlace al mensaje.
- **RN-INT-10:** un mensaje de la cola muerta solo se reintenta o cancela a mano. Hace falta el permiso `int.outbox.retry` y un motivo de al menos 10 caracteres, y la acción queda en la bitácora. Si el reintento vuelve a fallar, el mensaje sigue en la cola muerta.
- **RN-INT-11:** la clave de idempotencia va al proveedor, así un reintento no duplica el envío.
- **Conectores:** las fallas del proveedor cuentan para pasar el conector a «En error» (RN-INT-19). Si falta el adaptador real, el mensaje no sale, pero eso no se cuenta contra el conector. Un envío correcto lo vuelve a poner en «Activo».
- **Despacho:** dos despachos a la vez no envían el mismo mensaje, porque cada uno toma el mensaje con bloqueo.
- **Éxito de entrega (KPI-INT-01):** enviados sobre enviados más muertos, en los 30 días que terminan en el último mensaje registrado. En operación esos 30 días terminan hoy. En los datos de demostración, que son de octubre, terminan en el último mensaje, así la cifra no queda vacía.

## Despacho programado

- Comando `int:despachar` (programado cada minuto, sin superponerse): recorre las empresas activas y envía lo pendiente y los reintentos cuya espera ya pasó. Si una empresa da error, las demás se despachan igual.
- «Procesar la cola» en la pantalla envía todo lo pendiente y lo que espera reintento, sin esperar. Pide el permiso de la cola.

## Pantallas

- **INT-06 Mensajes salientes:**
  - cifras: éxito de entrega (con meta ≥ 99,5 % y aviso si está debajo), pendientes, reintentando y cola muerta, que abre la cola muerta;
  - pestaña «Mensajes»: filtros por estado, conector, módulo, tipo y fecha. Columnas: número, creado, módulo (por su nombre), evento, tipo, conector, referencia, intentos, próximo intento, estado y último error. Todas se ordenan en el servidor;
  - pestaña «Eventos de dominio»: fecha y hora, evento, usuario, datos y estado, con filtro por evento y el detalle al hacer clic.
- **Ficha del mensaje:** se abre al hacer clic en una fila de INT-06 o INT-07. Muestra:
  - los datos y la clave de idempotencia;
  - cada intento con su error y la espera hasta el siguiente;
  - las acciones a mano con su motivo y el contenido;
  - «Reintentar» y «Cancelar el mensaje», si está en la cola muerta y la persona tiene el permiso.
- **INT-07 Cola muerta:**
  - cifras: en cola muerta (meta 0) y atendidos a mano;
  - la lista con los muertos y los ya atendidos. Columnas: número, cayó, conector, evento, referencia, intentos, último error y estado;
  - «Reintentar» y «Cancelar» con motivo;
  - un aviso para quien solo puede consultar.

**Diferencia con el prototipo:** los eventos de dominio no tienen todavía suscriptores que los consuman, así que su estado se muestra como «Registrado», no como «Despachado».

## Pruebas

En `IntTest` hay 3 casos nuevos, 7 en total:
- registrar dentro de la transacción (si se revierte, no existe), el módulo apagado, el envío por el adaptador falso, la clave repetida y el número que sigue al último;
- las esperas 30 s, 1 min, 2 min… con tope de 1 h, la cola muerta al octavo intento con su aviso y su evento, y el conector en error;
- reintentar y cancelar a mano: motivo, permiso, bitácora, y que un cancelado no se toca otra vez;
- filtros, ficha y eventos;
- el comando programado y «Procesar la cola» con y sin permiso.

En total el sistema tiene 369 pruebas, todas correctas. Revisado en el navegador contra `aycha_test` (1440 y 375 px), sin errores en la consola.
