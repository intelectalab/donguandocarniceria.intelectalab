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

---

# Tanda 2: empresas, su ficha y el alta desde la consola (OPS-02 y OPS-03)

## Base de datos

Migración `2026_11_19_000200_ops_empresas_y_suscripciones.php`. Después de `git pull`, correr `php artisan migrate --database=pgsql_owner`.

- `tenants` gana estas columnas: `ruc` (único en toda la plataforma, RN-ONB-02), `business_type` (rubro), `contact_name`, `contact_email`, `contact_phone` y `created_by_platform_user`. Las empresas que ya existían toman el RUC de su primera razón social; la siembra hace lo mismo con una línea en `DatabaseSeeder`.
- `subscriptions` (nombre de la spec):
  - Estados TRIAL, ACTIVE, PAST_DUE, READ_ONLY, SUSPENDED y CANCELLED.
  - Una sola suscripción viva por empresa (RN-SUS-03).
  - Una prueba siempre tiene fecha de fin.
  - Guarda los días de prueba otorgados.
- `subscription_events`: historial de la suscripción, de solo inserción (RN-SUS-10).
- Parámetros de plataforma: `sus_trial_days_default` (14) y `sus_trial_max_days` (30).
- Funciones de la base para la consola, que corren como dueño (SECURITY DEFINER) y solo puede ejecutar la aplicación:

  | Función | Qué devuelve |
  |---|---|
  | `platform_tenant_usage()` | Totales de usuarios activos, marcas y locales por empresa, y el último ingreso. Sin filas de negocio (RN-OPS-06). No cuenta los usuarios de soporte ni los de clientes B2B (RN-SUS-06). |
  | `platform_tenant_modules()` | Los módulos encendidos de cada empresa (`tenant_modules` tiene RLS). |
  | `platform_ruc_in_use(ruc)` | Solo si el RUC ya es de alguna empresa. |
  | `platform_create_tenant(...)` | Crea la fila de la empresa. `tenants` sigue siendo de solo lectura para la aplicación, y la función solo acepta a un administrador de plataforma activo. |

## Alta de una empresa (`Empresas::alta`)

Corre en una sola transacción con la conexión normal de la aplicación:

1. Crea la fila de la empresa con `platform_create_tenant`.
2. Fija el contexto de la empresa nueva (`app.tenant_id`). Desde ahí, cada fila pasa por RLS como la de cualquier empresa.
3. Crea la razón social.
4. Crea los 22 roles del sistema, sus permisos, los permisos por rol y el acceso por módulo, con la misma plantilla que la demo (`prototipo.json.gz`). Suma los permisos que los módulos agregaron después; hoy es el de EQU.
5. Enciende los módulos del núcleo y los del plan, y apaga los demás (RN-SUS-08).
6. Crea al administrador como invitado con el rol Gerencia (ve todo y aprueba) y un código de 6 caracteres. Lo canjea en «Olvidé mi contraseña» → «Ya tengo un código», igual que las invitaciones de SEG-08.
7. Abre la suscripción en prueba por los días elegidos (14 por defecto, máximo 30) y registra su primer evento.

Validaciones:
- El RUC debe tener su dígito verificador correcto (RN-ONB-01).
- Un RUC no puede tener dos empresas (RN-ONB-02).
- El plan debe estar activo.
- Los días de prueba no pueden pasar el máximo (RN-SUS-15).
- El dominio no puede estar repetido.
- Solo un administrador de plataforma da de alta (RN-OPS-10).

El alta queda en la bitácora de la consola y se avisa por correo al administrador. Las marcas, los locales y lo demás los registra la empresa con su asistente (PLT-14).

## API

| Ruta | Qué hace |
|---|---|
| `GET /api/v1/consola/empresas` | Lista de empresas |
| `GET /api/v1/consola/empresas/opciones` | Planes, regímenes, rubros y días de prueba para el formulario |
| `GET /api/v1/consola/empresas/{id}` | Ficha de la empresa |
| `POST /api/v1/consola/empresas` | Alta de una empresa (10 por minuto) |

## Pantallas

- **OPS-02 Empresas** (`/consola/empresas`, ahora el inicio de la consola):
  - Cifras: cantidad de empresas, en prueba, activas o con deuda, y MRR sin IGV.
  - La tabla muestra plan, estado de la suscripción y días en el estado, MRR, y uso de usuarios, marcas y locales con barras (verde, ámbar desde 80 %, rojo al límite) y fecha de alta.
  - Tiene buscador por nombre o RUC, filtro por estado y columnas ordenables.
  - Las empresas sin suscripción (Don Guando y Carnes Selectas) aparecen como «Sin suscripción», sin límites (RN-SUS-21).
- **OPS-03 Ficha de la empresa** (`/consola/empresas/ficha?id=`):
  - Datos y contacto del alta, suscripción, uso por límite y módulos encendidos.
  - Historial de la suscripción y acciones de la consola sobre la empresa.
- **Nueva empresa** (`/consola/empresas/nueva`):
  - Secciones: empresa, plan (tarjetas con precio, límites y módulos), días de prueba, administrador y dominio opcional.
  - Al terminar muestra un resumen y, una sola vez, el código de la invitación, por si el correo no llega.

## Pruebas

3 pruebas nuevas en `OpsTest`:
- el alta completa, incluido que la administradora crea su contraseña con el código, entra a su empresa y no ve datos de Don Guando;
- las validaciones del alta y quién puede hacerla;
- la lista y la ficha con plan, estado y uso.

En total el sistema tiene 329 pruebas, todas correctas.

Revisión en el navegador contra `aycha_test`:
- la lista;
- el alta, que rechazó el RUC con dígito errado y luego creó la empresa;
- la ficha;
- el ingreso de la administradora nueva a su sistema vacío, con los módulos fuera del plan marcados como «Apagado»;
- la lista en celular.

Dos ajustes posteriores no se volvieron a revisar en pantalla: el error de RUC junto a su campo y el nombre corto de los módulos.

## Pendiente (tanda 3)

- SUS-09 Catálogo de planes: versiones, publicar y retirar, módulos con dependencias.
- SUS-11 Suscripciones.
- OPS-04 Suspender o reactivar con motivo.
- Extender la prueba y cambiar de plan.
- Reenviar la invitación del administrador desde la ficha.

---

# Tanda 3: planes con versiones, suscripciones y suspender o reactivar (SUS-09, SUS-11 y OPS-04)

## Base de datos

Migración `2026_11_19_000300_sus_versiones_de_planes_y_estados.php`. Después de `git pull`, correr `php artisan migrate --database=pgsql_owner`.

- **`saas_plan_versions`** (versiones de cada plan):
  - Una versión nace como borrador (DRAFT), se publica (PUBLISHED) y termina retirada (RETIRED).
  - Hay una sola versión publicada y un solo borrador por plan.
  - Un trigger impide cambiar una versión publicada, salvo para retirarla; tampoco deja tocar ni borrar una retirada, ni borrar nada que no sea un borrador (RN-SUS-02).
  - Lo publicado necesita un precio mayor que cero.
  - Cada plan existente queda como su versión 1 publicada.
- **`subscriptions`** gana tres columnas:
  - `plan_version_id`: la versión que contrató la empresa. La conserva hasta que cambie de plan.
  - `discount_pct` y `discount_reason`: el descuento pactado, de 0 a 100 %.
- **Funciones guardadas.** `saas_plans`, `saas_plan_modules` y `tenants` siguen siendo de solo lectura para la aplicación; solo las cambian estas funciones, y solo a nombre de un usuario de plataforma activo con rol Administración o Cobranza:

  | Función | Qué hace |
  |---|---|
  | `platform_publish_plan_version` | Retira la versión publicada anterior y deja `saas_plans` y sus módulos como la nueva. De ahí leen la página pública y el alta. |
  | `platform_retire_plan` | Deja de vender el plan. |
  | `platform_set_tenant_status` | Suspende o reactiva el acceso de una empresa. |

## Reglas

- **RN-SUS-01:**
  - Para publicar, el plan necesita precio, al menos un módulo y las dependencias de cada módulo, ya sea dentro del plan o en el núcleo.
  - El borrador muestra en vivo qué falta.
  - Los módulos del núcleo van siempre y no se cuentan como propios del plan.
- **RN-SUS-02:**
  - Un plan publicado no cambia: el cambio es una versión nueva.
  - Las empresas conservan la versión que contrataron, con sus límites y su precio.
  - Al retirar un plan, deja de verse en la página y en el alta.
- **RN-SUS-04:**
  - Solo se permiten los cambios de estado válidos, y Cancelada es final.
  - Cada cambio deja un evento con quién lo hizo y su motivo, y también queda en la bitácora de la consola (`TENANT_SUSPENDED` y `TENANT_REACTIVATED` cuando se corta o devuelve el acceso).
- **RN-SUS-07**, el efecto en la empresa:

  | Estado | Qué pasa con la empresa |
  |---|---|
  | Suspendida | Nadie de la empresa entra: `tenants.status` pasa a SUSPENDED y `ResolveTenant` responde `TENANT_BLOCKED`. |
  | Solo lectura o Cancelada | Cualquier petición que no sea una consulta responde **402 RN-SUS-07**. Sí puede consultar, exportar, cambiar su contraseña y cerrar sesión. Lo hace el middleware nuevo `suscripcion` (`SuscripcionVigente`), aplicado a todas las rutas de las empresas. |
  | En prueba, Activa o Con deuda | Opera normal. |

  Las empresas sin suscripción (piloto) no tienen bloqueos (RN-SUS-21).
- **RN-SUS-15:** la prueba se extiende sin pasar `sus_trial_max_days` (30) días en total.
- **MRR:** solo suman las suscripciones activas o con deuda, con el precio de su versión menos el descuento pactado y sin IGV.
- **RN-OPS-10:** cambiar planes, pruebas y descuentos, y cambiar el estado de una suscripción, lo pueden hacer Administración y Cobranza. Los demás roles solo consultan.

## Hallazgo: el plan Inicial no cumple RN-SUS-01

El plan Inicial incluye ONB (Alta de empresas), que depende de CRM, DES, REC y CAL, y esos módulos no vienen en ese plan. La consola lo marca como advertencia en el catálogo. Para corregirlo hay que crear una versión nueva: quitar ONB o agregar esos módulos. Es una decisión de negocio y no se cambió.

## API

Rutas nuevas bajo `/api/v1/consola`:

| Ruta | Qué hace |
|---|---|
| `GET /planes` | Catálogo de planes con sus versiones |
| `POST /planes/borradores` | Crea un borrador |
| `PUT /planes/borradores/{id}` | Edita un borrador |
| `DELETE /planes/borradores/{id}` | Borra un borrador |
| `POST /planes/borradores/{id}/publicar` | Publica un borrador |
| `POST /planes/{codigo}/retirar` | Retira un plan |
| `GET /suscripciones` y `GET /suscripciones/{id}` | Lista y detalle de suscripciones |
| `POST /suscripciones/{id}/estado` | Cambia el estado |
| `POST /suscripciones/{id}/extender` | Extiende la prueba |
| `POST /suscripciones/{id}/descuento` | Fija el descuento pactado |

## Pantallas

- **SUS-09 Catálogo de planes** (`/consola/planes`):
  - Cada plan con su versión publicada: precio, límites, cuántos módulos tiene, cuántas empresas usan esa versión y desde cuándo.
  - Su borrador, sus versiones retiradas y la advertencia de dependencias.
  - Acciones: «Nuevo plan», «Nueva versión» (copia la publicada), editar, publicar y borrar el borrador, y retirar el plan con motivo.
  - Al editar se eligen los módulos agrupados por fase, cada uno con sus dependencias, y un aviso en vivo si así no se puede publicar.
- **SUS-11 Suscripciones** (`/consola/suscripciones`):
  - La lista muestra empresa, plan y versión, estado y días en el estado, fin de la prueba, MRR con su descuento y uso, con filtro por estado.
  - El detalle trae su historial, acceso a la ficha de la empresa y las acciones.
- **OPS-04 Suspender o reactivar**, en la ficha de la empresa:
  - Las mismas acciones: cambiar estado, extender la prueba y descuento.
  - Antes de guardar se explica qué le pasa a la empresa, y siempre se pide motivo.
  - La ficha muestra «Acceso suspendido» mientras dure la suspensión.

## Pruebas

3 pruebas nuevas en `OpsTest`:
- planes con versiones: publicar, conservar la versión de la empresa, el bloqueo en la base, las dependencias, la página pública y retirar;
- la prueba, los estados, la solo lectura (402), la suspensión, la reactivación, el descuento en el MRR y que Cancelada es final;
- que solo Administración y Cobranza pueden hacer cambios.

En total el sistema tiene 332 pruebas, todas correctas.

Revisión en el navegador contra `aycha_test`:
- el catálogo y la advertencia del plan Inicial;
- una versión 2 del plan Inicial, que dejó de mostrar la advertencia al marcar CRM, DES, REC y CAL, y luego se publicó;
- la suspensión desde Suscripciones, con su aviso de efecto y su motivo;
- la reactivación desde la ficha.

## Pendiente

- **Cambiar de plan** con prorrateo (RN-SUS-18).
- **SUS-12 a SUS-14:** facturación del SaaS, cobros y mora, que esperan la pasarela y el RUC emisor.
- **Lo que ve la empresa de su propia suscripción** (SUS-01 a SUS-08), incluida la franja de mora y solo lectura en el sistema.
- **Tanda 4:** bitácora de la consola, parámetros de plataforma, importar catálogos y ocultar a las empresas las pantallas de la consola.

---

# Tanda 4: bitácora, parámetros de plataforma, catálogos globales y ocultar la consola a las empresas

No hay migración nueva: usa las tablas de la tanda 1 (`platform_audit_log`, `platform_parameters`, `platform_parameter_history`).

## Pantallas

- **OPS-13 Bitácora de la consola** (`/consola/bitacora`):
  - Muestra toda acción de la consola con fecha y hora, acción en español, quién, empresa, motivo, detalle e IP.
  - Tiene buscador (persona, motivo, empresa o IP) y filtros por acción, usuario, empresa y rango de fechas. Va paginada.
  - Es de solo lectura para todos los roles (RN-OPS-05).
- **OPS-16 Parámetros de plataforma** (`/consola/parametros`):
  - Cada parámetro muestra su valor, descripción, último cambio y quién lo hizo, y su historial (de antes a después, con motivo).
  - Solo el administrador de plataforma los cambia, siempre con motivo. Cada cambio deja una fila en el historial (solo inserción) y otra en la bitácora.
  - Cada parámetro tiene sus límites:

    | Parámetro | Rango |
    |---|---|
    | Minutos de inactividad | 5 a 240 |
    | Horas máximas de sesión | 1 a 24 |
    | Horas de la invitación | 1 a 168 |
    | Días de prueba | 1 a 30, sin pasar el tope |
    | Tope de días de prueba | 1 a 90, sin bajar de los días por defecto |
    | Redes permitidas | IP o CIDR IPv4 válidas, máximo 50 |

  - **RN-OPS-16:** nadie puede guardar una lista de redes que deje afuera su propia IP.
- **Catálogos globales** (`/consola/catalogos`, RN-MAE-11): la pantalla que pedía `docs/catalogos-globales.md`.
  - Se elige el catálogo (SUNAT, ubigeo o entidades financieras) y se sube un `.txt` o `.csv` de hasta 5 MB.
  - **«Revisar sin grabar»** muestra las filas válidas, cuántas son nuevas, cuántas cambian (con ejemplos de antes y después) y cuántas quedan igual, y los errores con su número de línea.
  - Solo se importa si no hay errores, con motivo. Graba con la conexión del dueño de la base (la de las empresas no puede escribir ahí).
  - Cada importación queda en la bitácora con cuántas filas eran nuevas o cambiaban, el nombre del archivo y su huella SHA-256.
  - Solo la hace el administrador de plataforma.
  - La lógica pasó del comando a `App\Modulos\Mae\Services\CatalogosGlobales`. El comando `mae:importar-global` y la pantalla hacen lo mismo; el comando ahora además lista todos los errores y dice cuántas filas son nuevas o cambian.
- **Menú de la consola:** muestra todas sus pantallas. Ya no hay «próximas tandas».

## Las empresas ya no ven pantallas de la consola (pendientes.md, punto 1.1)

`lib/modulos.ts` tiene ahora la lista `SOLO_CONSOLA`: OPS-01 a 13, OPS-16, SUS-09 a 14 y ONB-16. Esas pantallas no salen en el sistema de ninguna empresa, tenga el rol que tenga.

Revisado con el Gerente de Don Guando:

| Módulo | Antes | Ahora | Lo que le queda |
|---|---|---|---|
| OPS | 16 pantallas | 2 | Sus accesos de soporte y sus tickets |
| SUS | 14 | 8 | Su propia suscripción |
| ONB | 16 | 15 | Su alta |

## Pruebas

3 pruebas nuevas en `OpsTest`:
- la bitácora con filtros, con el detalle como datos;
- los parámetros con motivo, historial, rangos, la regla de no dejarse afuera y quién puede cambiarlos;
- los catálogos: revisar sin grabar, no importar con errores, importar y quién puede hacerlo.

En total el sistema tiene 335 pruebas, todas correctas.

Revisión en el navegador contra `aycha_test`:
- un cambio de parámetro con su motivo;
- la bitácora, donde se encontró y corrigió que el detalle salía letra por letra (el conocido `(array)$x + [...]`);
- la revisión de un archivo de ubigeo con una fila nueva, un cambio y un error;
- el menú del Gerente de Don Guando sin las pantallas de la consola.

## Con esto, la consola queda así

| Pantalla | Ruta |
|---|---|
| Ingreso con segundo factor y activación de cuentas | `/consola/ingreso`, `/consola/activar` |
| OPS-02 Empresas y OPS-03 Ficha, con el alta de empresas | `/consola/empresas` |
| SUS-11 Suscripciones y OPS-04 Suspender o reactivar | `/consola/suscripciones` y la ficha |
| SUS-09 Catálogo de planes | `/consola/planes` |
| OPS-12 Usuarios de plataforma | `/consola/usuarios` |
| Catálogos globales | `/consola/catalogos` |
| OPS-16 Parámetros de plataforma | `/consola/parametros` |
| OPS-13 Bitácora | `/consola/bitacora` |

Falta de la spec:
- **OPS-05, 06 y 14:** accesos de soporte que aprueba la empresa.
- **OPS-07 y 08:** salud de componentes e incidentes.
- **OPS-09 y 15:** tickets.
- **OPS-10:** métricas del negocio.
- **OPS-11:** anuncios.
- **SUS-12 a 14:** facturación, cobros y mora del SaaS.
- **Cambio de plan con prorrateo.**
- **Lo que ve la empresa de su suscripción:** SUS-01 a 08.
- **ONB-01 a 15:** registro público y asistente de alta.
