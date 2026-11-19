# 19/11/2026 · OPS Consola de plataforma: tanda 1 (ingreso y usuarios de plataforma)

La consola de Intelectalab (el «superadmin») es una entrada aparte, `/consola`. El personal de Intelectalab **no es usuario de ninguna empresa**: tiene su tabla, su ingreso con segundo factor obligatorio, sus roles y su propia sesión.

Plan por tandas:
- **Tanda 1 (esta):** OPS-01 Ingreso a la consola y OPS-12 Usuarios de plataforma.
- **Tanda 2:** OPS-02 Empresas, OPS-03 Ficha de la empresa y el alta de empresas desde la consola.
- **Tanda 3:** SUS-09 Catálogo de planes, SUS-11 Suscripciones y OPS-04 Suspender o reactivar.
- **Tanda 4:** OPS-13 Bitácora de la consola, OPS-16 Parámetros de plataforma, importar los catálogos globales y ocultar las pantallas de consola a los roles de empresa.

## Base de datos

Migración `2026_11_19_000100_ops_consola.php`. Después de `git pull`, correr `php artisan migrate --database=pgsql_owner`.

Todas las tablas son globales, sin empresa ni RLS:

- `platform_users`:
  - Roles PLATFORM_ADMIN, BILLING, SUPPORT_L1, SUPPORT_L2, ENGINEER y READ_ONLY.
  - Estados INVITED, ACTIVE, LOCKED y DISABLED.
  - Correo único sin distinguir mayúsculas.
  - **CHECK:** una cuenta activa tiene contraseña y segundo factor (RN-OPS-01).
  - El secreto de la app autenticadora se guarda cifrado con la clave de la aplicación.
- `platform_user_tokens`: código de un solo uso para activar la cuenta, guardado con hash. Vence en `ops_platform_user_invite_hours` (48 h).
- `platform_sessions`: sesión de la consola. Solo se guarda la huella SHA-256 del token, con IP, dispositivo, último uso, vencimiento y motivo del cierre.
- `platform_audit_log`: bitácora de la consola. La aplicación solo puede insertar (RN-OPS-05).
- `platform_parameters` y `platform_parameter_history`: se siembran con estos parámetros:
  - `ops_console_session_minutes` (30)
  - `ops_console_ip_allowlist` ([])
  - `ops_console_session_max_hours` (12)
  - `ops_platform_user_invite_hours` (48)

  El historial es solo de inserción. La pantalla para cambiarlos es OPS-16, en la tanda 4.

## Cómo entra el superadmin

1. **Primera cuenta**, desde el servidor:

   ```
   php artisan ops:crear-admin nombre@intelectalab.com "Nombre Apellido"
   ```

   Crea al administrador como invitado e imprime su código de activación (también lo manda por correo). Solo funciona si no hay ningún administrador activo; después, las cuentas se crean en OPS-12.

2. **Activar la cuenta** en `/consola/activar`:
   - Se escribe el correo, el código y la contraseña nueva: 12 caracteres o más, con mayúsculas, minúsculas y un número, sin el correo ni el nombre.
   - Se escanea el QR con Google Authenticator, Microsoft Authenticator u otra app.
   - Se escribe el primer código de la app. Recién ahí la cuenta queda activa.
   - El QR se dibuja en el navegador: el secreto no pasa por ningún servicio externo.

3. **Ingresar** en `/consola/ingreso` con correo, contraseña y el código de la app (OPS-01).

## Reglas

- **RN-OPS-01:**
  - Sin segundo factor no hay cuenta activa.
  - El mismo código de la app no sirve dos veces.
  - Al quinto intento fallido, sea de contraseña o de código, la cuenta se bloquea y se cierran sus sesiones. Solo la reactiva un administrador, con motivo.
  - El bloqueo o la baja solo se le dicen a quien escribió la contraseña correcta.
- **Correo:** solo se aceptan cuentas `@intelectalab.com`, como en el prototipo.
- **RN-OPS-10:**
  - Solo PLATFORM_ADMIN crea, edita, bloquea, da de baja, reactiva o reinicia el segundo factor. Los demás roles solo consultan.
  - Nadie puede cambiar su propio rol ni bloquearse a sí mismo.
  - Nunca se queda la plataforma sin un administrador activo.
- **RN-OPS-16:**
  - La sesión se cierra tras 30 minutos sin uso o a las 12 horas.
  - Si `ops_console_ip_allowlist` tiene redes (IP o CIDR), la consola solo acepta esas, tanto al ingresar como en cada petición.
- **RN-OPS-06:**
  - La consola no fija ninguna empresa, así que RLS no le muestra datos de negocio.
  - El token de una empresa no sirve en la consola, ni el de la consola en la API de las empresas.
- **Reiniciar el segundo factor** (si alguien perdió su celular): la cuenta vuelve a invitada, se borran su contraseña y su secreto, se cierran sus sesiones y le llega un código nuevo.
- **Bitácora:** toda acción queda en `platform_audit_log` con quién, motivo, IP y detalle: ingresos, intentos fallidos, bloqueos, altas, cambios de rol, cambios de estado, reinicios y activaciones.

## API

Todas las rutas están bajo `/api/v1/consola`, sin `tenant` ni Sanctum.

| Ruta | Protección |
|---|---|
| `POST /ingreso`, `/activar/preparar`, `/activar` | Límite de 10 por minuto |
| `GET /yo`, `POST /salir` | Middleware `consola` (`ConsolaSesion`), 120 por minuto |
| `GET /usuarios`, `POST /usuarios`, `PUT /usuarios/{id}`, `POST /usuarios/{id}/estado`, `POST /usuarios/{id}/reiniciar-2fa`, `POST /usuarios/{id}/reenviar` | Middleware `consola` (`ConsolaSesion`), 120 por minuto |

Código:
- `app/Modulos/Ops/Services/Consola.php`: roles, permisos de la consola, parámetros, bitácora y redes permitidas.
- `app/Modulos/Ops/Services/UsuariosPlataforma.php`: usuarios, activación, ingreso y sesión.
- `app/Support/Totp.php`: códigos de la app autenticadora (RFC 6238), sin librerías nuevas.

## Pantallas

La consola tiene su propio armazón, con su menú y sin la marca de ninguna empresa. Las pantallas de las próximas tandas se ven en gris.

- **OPS-01 Ingreso a la consola** (`/consola/ingreso`): correo, contraseña y código de 6 dígitos. Si la sesión vence, avisa «Tu sesión de la consola terminó».
- **Activar mi cuenta** (`/consola/activar`): en dos pasos, primero el código y la contraseña, después el QR con la clave para copiar y el primer código de la app.
- **OPS-12 Usuarios de plataforma** (`/consola/usuarios`):
  - La lista muestra para cada persona su rol, estado (con el motivo), si tiene segundo factor, su último ingreso y sus sesiones abiertas.
  - Las acciones son «Nuevo usuario» (le llega el código por correo), editar nombre o rol, reenviar la invitación, bloquear, reactivar, dar de baja y reiniciar el segundo factor. Todas, menos editar y reenviar, piden motivo.

La sesión de la consola va en la cookie `gc_consola` (solo para `/consola`, `SameSite=Strict`, dura mientras el navegador está abierto). El proxy lleva a `/consola/ingreso` a quien entra sin ella.

## Pruebas

8 pruebas en `tests/Feature/Modulos/OpsTest.php`:
- el vector de la RFC 6238;
- la activación y el ingreso con segundo factor, incluido que el mismo código no se repite;
- el bloqueo al quinto intento y la reactivación con motivo;
- que solo el administrador maneja usuarios, con correo de Intelectalab;
- que no se queda sin administrador ni nadie se bloquea a sí mismo, y el reinicio del segundo factor;
- la inactividad y las redes permitidas;
- que la consola y las empresas no comparten sesiones ni datos;
- que la base protege la bitácora y el segundo factor.

En total el sistema tiene 326 pruebas, todas correctas.

Revisión en el navegador contra `aycha_test`:
- activación con QR;
- ingreso con el código de la app;
- alta de un usuario (rechaza un correo de otro dominio);
- baja con motivo y cierre de sesión;
- vista en celular de 375 px sin desplazamiento lateral.

## Pendiente

- **Tanda 2:** empresas y el alta de empresas desde la consola.
- **Códigos de respaldo** del segundo factor: por ahora, si alguien pierde su celular, otro administrador le reinicia el segundo factor.
- **Correo:** en local el correo va al log (`MAIL_MAILER=log`). En el servidor, revisar que el correo esté configurado antes de invitar a alguien. Si no lo está, la primera cuenta igual funciona, porque el comando imprime el código.
