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

---

## Dominios de correo de la consola (ajuste del 19/11)

Antes, las cuentas de la consola tenían que ser `@intelectalab.com`, fijo en el código (`Consola::DOMINIO`). Ahora es el parámetro de plataforma **`ops_platform_email_domains`**:

- Es una lista de dominios y viene con `intelectalab.com`. Lo agrega la migración `2026_11_19_000400_ops_dominios_de_correo.php`.
- Se cambia en **OPS-16 Parámetros de plataforma**, con motivo y queda en el historial. Se escribe un dominio por línea; acepta escrito con o sin @ y lo guarda en minúsculas. Se aceptan hasta 20 dominios válidos.
- **Vacío acepta cualquier correo.**
- Vale para las cuentas nuevas: las que ya existen no cambian.
- **Primera cuenta con otro dominio:** como todavía no hay administrador que pueda cambiar el parámetro, el comando tiene la opción `--agregar-dominio`, que suma el dominio de ese correo a la lista y deja constancia en el historial y en la bitácora:

  ```
  php artisan ops:crear-admin nombre@gmail.com "Nombre" --agregar-dominio
  ```

  Sin esa opción, el comando rechaza el correo y explica cómo usarla.

Se agregaron 2 pruebas; en total el sistema tiene 337. Se revisó en el navegador agregando `gmail.com` desde OPS-16.

---

# Tanda 5: registro desde la página pública y registros y pedidos de demo en la consola (ONB-01 y ONB-16)

## Base de datos

Migración `2026_11_19_000500_onb_registro_publico.php`. Después de `git pull`, correr `php artisan migrate --database=pgsql_owner`.

- **`tenant_signups`** (tabla global): cada registro desde la página. Guarda RUC, razón social, nombre comercial, rubro, régimen, domicilio fiscal, plan, contacto y correo, y además:
  - el código de 6 caracteres con hash, su vencimiento y los intentos;
  - la contraseña que eligió, con hash, que se borra al crear la empresa;
  - su estado: PENDING (por verificar), PROVISIONED (empresa creada), EXPIRED o REJECTED, y la empresa creada.

  Reglas en la base:
  - **Un solo registro vivo por RUC** (RN-ONB-02).
  - El RUC debe tener formato válido.
  - El correo se guarda en minúsculas.
- **`demo_requests`** gana quién atendió el pedido, cuándo y su nota. La aplicación sigue sin poder leer esa tabla: la consola usa `platform_demo_requests()` y `platform_attend_demo_request()`, que exigen un usuario de plataforma activo.
- **`platform_create_tenant_from_signup()`** crea la fila de la empresa solo para un registro con el correo verificado y sin empresa. `tenants` sigue siendo de solo lectura para la aplicación.
- **Parámetros de plataforma** (también se cambian en Parámetros de plataforma):
  - `onb_signup_code_hours` (48): cuánto dura el código.
  - `onb_signup_expire_days` (7): a los cuántos días vence un registro sin verificar, lo que libera el RUC.

## Cómo funciona el registro

1. **«Pruébalo gratis»** en la cabecera, en la portada, en las tarjetas de planes y en la calculadora de precios lleva a **`/registro`**, con el plan si se eligió uno. **«Agenda una demo»** sigue abriendo el pedido de demo.
2. **El formulario** pide:
   - la empresa: RUC, razón social, nombre comercial, rubro, régimen y domicilio fiscal;
   - el plan;
   - los datos de acceso: nombre, celular, correo y contraseña dos veces, con el ojito;
   - aceptar los términos.

   También tiene una trampa invisible contra robots.
3. **La API revisa todo antes de guardar:**
   - el dígito verificador del RUC (RN-ONB-01);
   - que el RUC no sea ya cliente (RN-ONB-02);
   - que no haya otro registro en curso con otro correo;
   - la contraseña, con la misma política de SEG.

   Si todo está bien, envía **un código de 6 caracteres al correo**. Si la persona se vuelve a registrar con el mismo RUC y el mismo correo, recibe un código nuevo.
4. **Con el código correcto** se crea la empresa en una sola operación (RN-ONB-17): razón social, roles y permisos, módulos del plan, la administradora **ya activa con la contraseña que eligió** (rol Gerencia) y la suscripción **en prueba** por `sus_trial_days_default` días. Desde ahí ingresa al sistema normal.
5. **Límites del código:**
   - Hay 5 intentos; al quinto fallo el registro vence y hay que registrarse de nuevo.
   - El código vence a las 48 horas.

El alta desde la consola y el registro público usan el mismo paso interno (`Empresas::poblar`), así crean exactamente lo mismo.

## Consola: Registros y demos

Va en el menú «Clientes» de la consola y tiene dos pestañas:

- **Registros:** empresa, RUC, contacto, plan y rubro, estado (por verificar con sus intentos fallidos, empresa creada con enlace a su ficha, vencido o rechazado) y fecha. El administrador puede **rechazar** un registro por verificar, con motivo; eso libera el RUC.
- **Pedidos de demo:** quién, WhatsApp, rubro, plan e intereses, y la fecha. Se marcan **atendidos** con una nota (qué se coordinó) o se reabren.

Cada pestaña cuenta lo pendiente. Las altas por registro, los rechazos y los pedidos atendidos quedan en la bitácora de la consola.

## Pruebas

4 pruebas nuevas:
- en `OnbTest`: registro, verificación y alta en prueba, con ingreso al sistema; las validaciones, la trampa contra robots y el RUC en curso; los 5 intentos y el vencimiento;
- en `OpsTest`: registros y pedidos de demo en la consola.

En total el sistema tiene 341 pruebas, todas correctas.

Revisión en el navegador contra `aycha_test`:
- el registro completo de «Pollos San Martín» desde `/registro`: formulario, código del correo y cuenta lista;
- la consola con el registro convertido en empresa y un pedido de demo por atender.

## Pendiente

- **Consulta del RUC a SUNAT** para traer la razón social, el estado y el domicilio (D-ONB-01): hoy se valida el dígito verificador y la persona escribe los datos.
- **Correo:** el código llega por correo. En local queda en el log; en el servidor hay que configurar el correo antes de abrir el registro al público.
- **Términos del servicio y política de privacidad:** el registro pide aceptarlos, pero todavía no hay una página con esos textos.
- **Segundo factor** para el administrador de la empresa: pendiente con el de SEG.
- **ONB-02 a 15:** el asistente de alta con plantillas por rubro e importadores.

# Tanda 6 (23/11): tickets de soporte (OPS-15 Mis tickets y OPS-09 Bandeja de tickets)

## Base de datos

Migración `2026_11_23_000100_ops_tickets_de_soporte`:
- `support_tickets`: número único en toda la plataforma (`TK-0101`, `TK-0102`…), asunto, detalle, tema, prioridad, estado (abierto, en proceso, espera respuesta del cliente, resuelto, cerrado), quién lo abrió, a quién del equipo está asignado, plazo y hora de la primera respuesta, resuelto, cerrado y calificación (1 a 5).
- `support_ticket_messages`: la conversación. Solo se agregan mensajes; la base no deja cambiarlos ni borrarlos.
- Las dos tablas son de cada empresa (RLS). La consola ve las de todas porque su middleware abre una **sesión de plataforma** (`app.platform = on`, función `app_is_platform()`), y solo después de validar al usuario de la consola. Esa sesión ve tickets, no datos de negocio: clientes, pedidos y demás siguen sin verse (RN-OPS-06). Al fijar una empresa, la sesión de plataforma se apaga (`TenantContext::set`).
- Parámetros de plataforma: `ops_ticket_first_response_hours` (urgente 1, alta 4, normal 8, baja 24) y `ops_ticket_auto_close_days` (7).

## Reglas

- **Plazo de la primera respuesta:** urgente cuenta las 24 horas; las demás prioridades, el horario de soporte (lunes a sábado de 9 a 18, hora de Lima). Ejemplo: abierto el sábado a las 17:00 con prioridad normal, vence el lunes a las 16:00.
- Cuando soporte responde: cuenta como primera respuesta, el ticket queda asignado a quien respondió si no lo tenía nadie, y a quien lo abrió le llega un **aviso en la campana**, con enlace al ticket.
- Si el cliente escribe en un ticket resuelto, se **reabre** (en proceso). Un ticket resuelto se cierra con la calificación del cliente o, si no responde en 7 días, solo (tarea `ops:cerrar-tickets`, cada mañana a las 5:30). Un ticket cerrado no recibe más mensajes: se abre uno nuevo.
- **Quién:** en la empresa abre tickets quien tiene el permiso «Abrir tickets» y ve los de toda la empresa quien tiene «Ver todos los tickets» (gerencia, administración); los demás ven solo los suyos. En la consola todos ven la bandeja; responden y asignan administración, soporte nivel 1 y 2 e ingeniería.
- **Soporte es parte del servicio:** los permisos de tickets y de accesos de soporte valen aunque el plan de la empresa no tenga el módulo OPS (`Access::DEL_SERVICIO`, también en `/me`). Una empresa en solo lectura o con la suscripción cancelada también puede pedir ayuda.

## API

- Empresa: `GET/POST /api/v1/soporte/tickets`, `GET /soporte/tickets/{id}`, `POST /soporte/tickets/{id}/responder`, `POST /soporte/tickets/{id}/cerrar` (con calificación opcional).
- Consola: `GET /api/v1/consola/tickets` (filtros: estado, prioridad, tema, empresa, asignado y búsqueda; trae las cifras de la bandeja), `GET /consola/tickets/{id}`, `POST /consola/tickets/{id}/responder`, `POST /consola/tickets/{id}/asignar`.
- Responder y asignar quedan en la bitácora de la consola.

## Pantallas

- **Empresa · Ayuda y soporte** (`/soporte`, en el menú de la persona y en el buscador; también es la pantalla «Mis tickets» del módulo): lista de tickets, nuevo ticket (asunto, tema, prioridad y detalle) y el ticket con su conversación, para responder, cerrarlo («Ya no necesito ayuda») o calificarlo con estrellas.
- **Consola · Bandeja de tickets** (grupo Clientes): cifras (abiertos, sin primera respuesta, plazo vencido, sin asignar), filtros, y cada ticket con su plazo, asignación («Tomarlo» o elegir a alguien) y la respuesta con el estado en que queda.

## Pruebas

3 pruebas nuevas en `OpsTest`: el recorrido completo empresa ↔ consola (permisos, plazo, aviso, reapertura, calificación, cierre y asignación); el aislamiento entre empresas y el ticket en solo lectura; el plazo en horario hábil y el cierre automático.

## Pendiente

- Adjuntar capturas a un ticket.
- Correo al cliente además de la campana.
- Accesos de soporte: hechos en la tanda 7.

# Tanda 7 (23/11): accesos de soporte (OPS-05 Solicitar acceso, OPS-06 Sesión de soporte y OPS-14 Accesos de soporte)

## Base de datos

Migración `2026_11_23_000200_ops_accesos_de_soporte`:
- `support_accesses`: empresa, ticket (opcional), a quién de la consola se otorga, motivo, nivel (solo lectura, o lectura y escritura), módulos (vacío = todos los de la empresa), si puede exportar, horas sugeridas y aprobadas, estado (por aprobar, vigente, rechazado, revocado, vencido, terminado por soporte, cancelado), quién decidió, vigencia, primer uso, cierre y el usuario técnico.
- `support_access_events`: la bitácora del acceso, que es **solo inserción**: pedido, decisión, entradas, cada consulta, cambio y exportación del soporte, los intentos rechazados y el cierre.
- Las dos tablas son de la empresa (RLS); la consola las ve con su sesión de plataforma. Las dos partes ven los mismos registros (CA-OPS-03).
- Parámetro de plataforma `ops_support_max_hours` (72). La duración por defecto (`ops_support_default_hours`, 8) y el aviso a administradores (`ops_support_notify_admins`) son parámetros de cada empresa (ya estaban definidos).

## Cómo funciona

1. **Pedir (consola).** Soporte nivel 1 pide solo lectura; nivel 2, ingeniería y administración también lectura y escritura. Una persona tiene a lo más un acceso pendiente o vigente por empresa. Se pide desde «Accesos de soporte» o desde el ticket en la bandeja.
2. **Aprobar (empresa).** A quien aprueba (gerencia y roles con «Aprobar o rechazar accesos de soporte») le llega un aviso en la campana. Al aprobar elige las horas (vacío = 8, máximo 72). No se amplía: se pide otro. Solo se aprueba uno pendiente; uno cerrado no se reabre.
3. **Entrar (consola).** Solo la persona a la que se otorgó, con el botón «Entrar». Abre la empresa en otra pestaña con un **usuario técnico** de la empresa (`Soporte GestionCarnica · nombre`, `user_type = PLATFORM_SUPPORT`), con una franja arriba que muestra el nivel, si puede exportar, el tiempo que queda y «Terminar sesión». La sesión vence con el acceso. Ese usuario no ingresa con contraseña.
4. **Límites (middleware `soporte`).** Ve solo los módulos del acceso, con sus permisos (nunca los de aprobar o revocar accesos ni los de tickets). En solo lectura no modifica nada; sin exportación no descarga archivos (también si la descarga no está en una ruta «exportar»). Todo queda en la bitácora del acceso, también lo rechazado.
5. **Cerrar.** La empresa revoca un acceso vigente; el soporte lo termina o cancela su pedido; vence solo (tarea `ops:vencer-accesos`, cada minuto). Al cerrarse, el usuario técnico queda inactivo y sus sesiones se cierran.
6. Con `ops_support_notify_admins`, la empresa recibe aviso al aprobarse, al primer uso y al terminar.

## Archivos compartidos que se tocaron (una o pocas líneas)

- `Access.php`: el usuario técnico ve solo los módulos y permisos de su acceso.
- `AuthController.php`: el usuario técnico no ingresa con contraseña.
- `MeController.php`: `soporte` con los datos de la franja.
- `bootstrap/app.php` y `routes/api.php`: el middleware `soporte` en las rutas de empresa.
- `routes/console.php`: la tarea de cada minuto.
- Web: la franja en `AppShell`, el tipo de `/me` y el menú del usuario técnico (`modulos.ts`).

## Pantallas

- **Empresa · Ayuda y soporte → pestaña «Accesos de soporte»** (también desde el menú de Soporte): pedidos por aprobar (aprobar con horas o rechazar con motivo), accesos vigentes con el tiempo que queda (revocar) y la ficha de cada acceso con la cuenta de consultas, cambios, exportaciones y rechazos, más la bitácora.
- **Consola · Accesos de soporte** (grupo Clientes): lista con filtros por estado y empresa, «Pedir acceso», «Entrar», «Terminar», «Cancelar» y la misma ficha con su bitácora.
- **Sesión de soporte:** el sistema de la empresa con la franja amarilla arriba.

## Pruebas

2 pruebas nuevas en `OpsTest`: pedido, aprobación, sesión de solo lectura con sus límites, bitácora en los dos lados, revocación (CA-OPS-01 a 03); lectura y escritura con exportación y vencimiento automático. En total el sistema tiene 346 pruebas, todas correctas. Revisado en el navegador contra `aycha_test` (1440 y 375 px).

## Pendiente

- En modo «empresa por dominio», «Entrar» tendrá que abrir el dominio de la empresa (hoy abre `/inicio` en el mismo dominio, que es como funciona el servidor).
- En solo lectura, algunas pantallas muestran botones de crear o exportar; al usarlos la API los rechaza con un mensaje claro y queda registrado.

# Tanda 8 (23/11): salud de componentes, incidentes y anuncios (OPS-07, OPS-08 y OPS-11)

## Base de datos

Migración `2026_11_23_000300_ops_salud_incidentes_y_anuncios`:
- `platform_components` (13 componentes: aplicación, base de datos, colas, OSE, WhatsApp, pasarelas, mapas, correo, almacenamiento, telefonía, anuncios pagados, WooCommerce, API) y `platform_health_readings` (solo inserción).
- `platform_incidents` (número INC-0001…, severidad SEV1 a SEV4, componente, estado, inicio y cierre, mensaje público, aviso a clientes, causa raíz, post mortem), `platform_incident_tenants` (empresas afectadas), `platform_incident_updates` (línea de tiempo, solo inserción) y `support_tickets.incident_id` (tickets vinculados).
- La base exige que un incidente resuelto tenga hora de cierre posterior al inicio y causa raíz (RN-OPS-08).
- `platform_announcements` con RLS: la consola ve todo y una empresa solo lo publicado y dirigido a ella (a todas, a su plan o a ella por nombre). La ventana de fechas la filtra la aplicación con su reloj (RN-OPS-06).
- Las demás tablas de operación solo se ven con la sesión de la consola.
- Parámetros de plataforma: `ops_component_check_seconds` (60), `ops_incident_notify_minutes` (30) y `ops_maintenance_notice_hours` (48), con sus reglas en «Parámetros de plataforma».

## Salud de componentes (OPS-07)

- Tarea `ops:leer-salud` cada minuto. Mide de verdad:
  - la aplicación;
  - la base de datos (latencia; degradada si pasa de 500 ms);
  - las colas (trabajos pendientes; degradada si el más antiguo espera más de 5 minutos o hubo fallidos en la última hora; caída si espera más de 15 minutos: ningún proceso la atiende);
  - el almacenamiento (escribe y lee un archivo de prueba).
- Los servicios externos todavía no tienen adaptador: quedan «sin lectura» y no se inventa un verde. Ingeniería y administración registran su estado a mano, con lo que se observó.
- Disponibilidad de 24 horas y de 7 días = lecturas operativas sobre el total (degradado cuenta la mitad).
- Un componente que pasa a caído abre solo un incidente SEV2, si no había uno abierto para él (CA-OPS-07).

## Incidentes (OPS-08)

- Alta con título, severidad, componente y empresas afectadas (o todas). Se editan mientras estén abiertos.
- Línea de tiempo con notas internas y mensajes públicos. Un mensaje público:
  - se muestra como anuncio en el sistema de las empresas afectadas;
  - en SEV1 y SEV2, avisa en la campana a gerencia, sistemas y administración de esas empresas.
- Plazo de aviso a clientes en SEV1 y SEV2 (30 minutos desde el inicio): pendiente, a tiempo, vencido o fuera de plazo (RN-OPS-14).
- Resolver pide causa raíz y hora de cierre (vacía: ahora). Si se había avisado a los clientes, el anuncio pasa a «Resuelto: …» por 6 horas más. El post mortem se completa después.
- Desde la bandeja de tickets, un ticket se vincula al incidente que lo causó.

## Anuncios (OPS-11)

- Tipos: información, novedad y mantenimiento. Los de incidente se publican desde el incidente.
- Para: todas las empresas, por plan o empresas elegidas. Se guardan como borrador, se publican (o quedan programados si la fecha de inicio es futura) y se cancelan.
- Un mantenimiento lleva su ventana y se anuncia con al menos 48 horas entre que el anuncio se ve y su inicio (RN-OPS-18). Se ve hasta que termina el mantenimiento.
- En la empresa aparecen como franjas arriba del contenido, en todo el sistema. Cada persona puede ocultar un anuncio (se recuerda en su navegador).

## Pantallas

- **Consola · grupo Operación:** Salud de componentes (tarjetas con estado, latencia, cola y disponibilidad; detalle con lecturas y registro a mano), Incidentes (lista, alta, detalle con línea de tiempo, resolver y post mortem) y Anuncios (lista, alta y edición, publicar y cancelar).
- **Bandeja de tickets:** en el ticket, «Causado por un incidente».
- **Empresa:** franja de anuncios en el sistema.

## Pruebas

3 pruebas nuevas en `OpsTest`:
- lecturas automáticas, permisos, caída que abre un incidente y disponibilidad;
- incidente con aviso a tiempo solo a la empresa afectada, ticket vinculado y resolución;
- anuncios por plan, borrador, mantenimiento con anticipación, programado y cancelado.

En total el sistema tiene 349 pruebas, todas correctas. Revisado en el navegador contra `aycha_test` (1440 y 375 px).

## Pendiente

- Adaptadores para leer la salud del OSE, WhatsApp, pasarelas, correo y demás servicios externos (cuando cada integración exista).
- En el servidor ya corre `schedule:run` cada minuto (cron de www-data): al desplegar, las lecturas, los accesos vencidos y el cierre de tickets funcionan solos.

# Tanda 9a (24/11): facturación, cobros y mora del SaaS (SUS-12, SUS-13 y SUS-14)

La tanda 9 se dividió en tres por su tamaño:
- **9a:** cobro, en la consola.
- **9b:** la suscripción vista por la empresa.
- **9c:** cambio de plan, complementos y métricas.

## Base de datos

Migración `2026_11_24_000100_sus_facturacion_cobros_y_mora`:
- `platform_document_series`: F001 factura, B001 boleta, FC01 y BC01 notas de crédito. Solo la consola las ve.
- `saas_invoices` y `saas_invoice_lines`: comprobantes del SaaS. La empresa verá los suyos en 9b.
- `saas_payment_methods`: solo el token de la pasarela, la marca y los 4 últimos dígitos.
- `saas_payments`: un cobro por referencia de la pasarela.
- `saas_gateway_events`: avisos crudos de la pasarela.
- `saas_settlements`: abonos conciliados.
- `saas_billing_runs`: corridas.
- `saas_dunning_actions`: recordatorios y prórrogas.
- `subscriptions.grace_until`: fecha de la prórroga.
- La base impide cambiar un comprobante emitido (importes, cliente, período, número, fecha) y agregarle o cambiarle líneas. Al emitir, exige que las líneas cuadren con la cabecera y que total = subtotal + IGV (RN-SUS-11). Un emitido no se borra.
- `platform_dunning_tenant_status`: la mora suspende o reactiva el acceso de la empresa, y la base solo lo permite si coincide con el estado de su suscripción.
- Parámetros de plataforma:
  - `sus_invoice_due_days` (5), `sus_payment_retry_days` ([1, 3, 5]), `sus_grace_days` (7) y `sus_read_only_days` (15);
  - `sus_igv_rate` (0,18);
  - `sus_issuer_ruc` y `sus_issuer_name` (vacíos);
  - `sus_gateway` (FAKE);
  - `sus_max_extension_days` (15).

  El RUC emisor se cambia desde «Parámetros de plataforma» y se valida.

## Cómo funciona

1. **Corrida del mes** (botón en la consola o sola el día 1 a las 7:00): un comprobante por suscripción activa, con deuda o en solo lectura. Lleva la cuota de su versión de plan menos el descuento pactado, más IGV. Es factura con RUC y boleta con DNI. Otra corrida del mismo mes solo crea los que faltan. Un plan sin precio aprobado no se factura y queda anotado.
2. **Sin RUC emisor** (D-SUS-06): los comprobantes quedan en borrador y no se emiten ni se cobran. La pantalla lo avisa.
3. **Emitir:** la serie de Intelectalab con su correlativo sin saltos, la fecha de hoy y el vencimiento a 5 días. El envío al OSE de Intelectalab queda «por enviar» hasta definir su OSE.
4. **Cobrar:** con el medio de pago activo de la empresa, por el adaptador de la pasarela. La pasarela de prueba aprueba o rechaza según el token.
   - El resultado llega por el aviso firmado (`POST /api/v1/publico/pasarela/{pasarela}`, cabecera `X-Firma`). Uno sin firma válida o repetido no tiene efecto, pero queda registrado.
   - El comprobante queda pagado solo si los cobros aprobados más las notas de crédito cubren su total.
5. **Nota de crédito:** sobre un comprobante emitido, por un monto que no pase lo que queda sin acreditar.
6. **Mora** (tarea diaria a las 6:20):
   - vencido → con deuda (sigue operando);
   - reintentos de cobro a los 1, 3 y 5 días;
   - a los 7 días, solo lectura;
   - a los 22, suspendida.

   Además:
   - Una prórroga pospone esos pasos.
   - El pago confirmado la devuelve a activa en el momento.
   - Una prueba vencida sin medio de pago pasa a solo lectura.
   - Cada cambio queda en el historial con actor «Sistema» y avisa a gerencia, sistemas y administración de la empresa.
7. **Conciliación:** los cobros aprobados se juntan con un abono de la pasarela; la diferencia es la comisión.

Facturan, cobran y gestionan la mora el administrador y cobranza (permiso nuevo «facturar, cobrar y gestionar la mora»). Los demás roles de la consola solo consultan.

## Pantallas (consola · grupo Cobranza)

- **Facturación del SaaS:** comprobantes con filtros y detalle (líneas, cobros, notas, emitir, borrar borrador, cobrar ahora, nota de crédito), corridas con sus notas y series.
- **Cobros y conciliación:** cobros con resultado, tarjeta, referencia y aviso crudo; avisos de la pasarela; abonos. Se marcan cobros para conciliar con un abono.
- **Mora:** quién debe, cuánto, días, próximo reintento, cuándo pasa a solo lectura y a suspensión. Acciones: cobrar, recordar y dar prórroga.

## Pruebas

3 pruebas nuevas en `OpsTest`:
- corrida sin RUC emisor (borrador) y con RUC (emite F001-00000001); cobro rechazado y aprobado; aviso repetido y sin firma; conciliación con comisión; nota de crédito FC01; el emitido no cambia;
- mora: con deuda, prórroga, solo lectura (402), suspensión y reactivación al pagar, con los 4 cambios en el historial (CA-SUS-04);
- prueba vencida sin medio de pago → solo lectura.

En total el sistema tiene 352 pruebas, todas correctas. Revisado en el navegador contra `aycha_test` (1440 y 375 px), con tres empresas de ejemplo: una pagada, una con la tarjeta rechazada y una en solo lectura.

## Pendiente

- Decisiones de negocio:
  - **Precios de los planes (D-SUS-01):** sin precio aprobado, un plan no se factura.
  - **RUC y OSE de Intelectalab (D-SUS-06):** sin RUC no se emite, y sin OSE los comprobantes quedan «por enviar».
- **Pasarela real (D-SUS-02):** Mercado Pago o Culqi. Basta con escribir su adaptador.
- **Tanda 9b:** la empresa registra su tarjeta, ve y paga sus comprobantes, y ve la franja de mora.

# Tanda 9b (24/11): la suscripción vista por la empresa (SUS-01, SUS-04 a SUS-08)

## Base de datos

Migración `2026_11_24_000200_sus_suscripcion_de_la_empresa`:
- `subscriptions`: `cancel_at_period_end`, `cancel_effective_on`, `cancel_reason`, `cancel_survey` y `cancel_requested_by`.
- Parámetro de plataforma `sus_data_retention_days` (90).

## Mi suscripción (`/suscripcion`, en el menú de la persona y en el buscador)

Las pantallas SUS-01, 04, 05, 06, 07 y 08 del menú abren la pestaña que corresponde. Pestañas:
- **Plan y uso:**
  - plan, estado y lo que significa para la empresa;
  - cuota (con descuento), próximo cobro o fin de la prueba, y tarjeta;
  - barras de uso de usuarios del personal, marcas y locales contra el límite del plan, más los pedidos del mes.
- **Comprobantes:**
  - solo los emitidos de su empresa, con estado de pago y de SUNAT;
  - detalle con los cobros;
  - «Pagar» con la tarjeta registrada;
  - «Imprimir o guardar en PDF» (representación impresa). El XML llegará con el OSE de Intelectalab.
- **Medio de pago:**
  - formulario de la pasarela de prueba. El número de la tarjeta se convierte en un token en el navegador y al sistema solo llegan el token, la marca, los 4 últimos dígitos y el vencimiento (RN-SUS-20);
  - cobro automático sí o no, y correo para los comprobantes;
  - tarjetas de prueba: si termina en 0002 la rechaza el banco, si termina en 9995 no hay fondos, cualquier otra válida se aprueba.
- **Cancelar:**
  - pide motivo, una respuesta de la encuesta y confirmar que sabe exportar sus datos;
  - se cancela al fin del período pagado (el 1 del mes siguiente; en prueba, al terminar la prueba) y se puede deshacer antes;
  - la tarea diaria la aplica, y la empresa queda en solo lectura con sus datos 90 días (RN-SUS-17).

Quién ve qué, según los permisos de la spec:
- ver la suscripción: gerencia, sistemas, administración y auditoría;
- comprobantes: además, contabilidad;
- tarjeta y pago: gerencia, sistemas y administración;
- cancelar: gerencia y sistemas.

Estos permisos valen aunque el plan no tenga el módulo SUS. Las rutas responden también en solo lectura o cancelada, para poder pagar. Una empresa sin suscripción (Don Guando) ve «opera sin suscripción».

## Franja de la suscripción (SUS-08)

En todo el sistema, arriba (no en la sesión del soporte):
- **Con deuda:** días de mora, monto y la fecha en que pasa a solo lectura.
- **Solo lectura:** qué puede hacer.
- **Cancelada:** hasta cuándo se conservan los datos.
- **Prueba por vencer sin tarjeta** (5 días antes).
- **Cancelación pedida.**

Lleva su botón (Pagar, Registrar tarjeta o Ver mi suscripción). La toma de `/me` (`suscripcion`).

## Contrato de SUS

En [contratos.md](../contratos.md#sus--planes-y-suscripciones): `Suscripcion::vigente()`, `operativa()`, `limite()`, `usado()` y `exigirLimite()` para los demás módulos. Queda pendiente conectar `exigirLimite` en el alta de usuarios, marcas y locales (SEG y PLT).

## Archivos compartidos (una o pocas líneas)

- `Access.php`: los permisos de SUS de la empresa entran a `DEL_SERVICIO`.
- `SuscripcionVigente.php`: `api/v1/suscripcion*` permitido en solo lectura.
- `MeController.php`: `suscripcion`.
- Web: la franja y «Mi suscripción» en `AppShell` y `Header`, y el tipo de `/me`.

## Pruebas

3 pruebas nuevas en `OpsTest`:
- plan y uso, empresa sin suscripción, tarjeta (rechaza un número en vez de token), cobro rechazado con franja, comprobantes solo de la empresa, pago aprobado que la reactiva;
- cancelar al fin del período, deshacer y quedar en solo lectura con 90 días de conservación;
- contrato de límites.

En total el sistema tiene 355 pruebas, todas correctas. Revisado en el navegador contra `aycha_test` (1440 y 375 px) con una empresa con deuda vencida.

## Pendiente (tanda 9c)

- Cambiar de plan (SUS-02) con prorrateo, y complementos (SUS-03 y SUS-10).
- Encender y apagar módulos según el plan (RN-SUS-08).
- Historial de uso de 12 meses (SUS-04).
- Métricas del negocio (OPS-10).

# Tanda 9c (24/11): cambio de plan, complementos y módulos según el plan (SUS-02, SUS-03, SUS-10 y RN-SUS-08)

La 9c se dividió en dos:
- **9c:** cambio de plan, complementos y módulos.
- **9d:** métricas del negocio (OPS-10) e historial de uso de 12 meses.

## Base de datos

Migración `2026_11_24_000300_sus_planes_y_complementos`:
- `saas_addons`: catálogo de complementos. Encienden un módulo que no es del núcleo o suman unidades a un límite (usuarios, marcas, locales).
  - Todos lo leen; solo la consola lo cambia.
  - Publicado tiene precio (RN-SUS-01, lo exige la base).
  - Vienen en borrador y sin precio, como propone la spec mientras no se decidan los precios (D-SUS-01): Telefonía, Contabilidad, Consignación, 5 usuarios más, 1 marca más y 1 local más.
- `subscription_addons`: lo que contrató cada empresa, con el precio del momento. Lo ven la empresa (RLS) y la consola.
- `subscriptions.pending_plan_version_id` y `pending_from`: bajada de plan programada.

## Cambiar de plan (empresa · Mi suscripción → «Cambiar de plan»)

- Comparador de los planes publicados: precio, límites, lo destacado y sus módulos. Muestra el prorrateo al subir y lo que excedería al bajar.
- **Subir:** el cambio es inmediato.
  - Se cobra el prorrateo de los días que quedan del mes en un comprobante aparte: (cuota nueva − anterior) × días restantes / días del mes (RN-SUS-18, CA-SUS-06). Se emite y se cobra solo si hay RUC emisor y cobro automático.
  - Los módulos del plan nuevo se encienden en el momento.
- **Bajar:** se aplica el 1 del mes siguiente y solo si el uso actual cabe (CA-SUS-07: «Usuarios del personal 6 de 5»).
  - Se puede deshacer antes.
  - Ese día la tarea diaria vuelve a revisar el uso: si ya no cabe, no se aplica y queda en el historial.
- En prueba, el cambio es inmediato y sin cobro.

## Complementos

- **Consola · Producto → Complementos** (SUS-10; administración y cobranza): crear, editar el borrador, publicar con precio y retirar. Uno publicado solo cambia nombre y descripción; retirado ya no se contrata.
- **Empresa · Mi suscripción → «Complementos»** (SUS-03): contratar y quitar.
  - **De límite:** suben el límite efectivo (plan + complementos, D-SUS-07). No se quitan si el uso quedaría por encima.
  - **De módulo:** encienden el módulo si el plan trae lo que necesita (RN-SUS-01). No se quitan si otro módulo depende de él.
  - Se cobran en la corrida del mes como líneas del comprobante, sin el descuento del plan.

## Módulos según el plan (RN-SUS-08 y RN-SUS-09)

- `ModulosDelPlan::sincronizar()`: núcleo + plan + complementos quedan encendidos y los demás apagados. Corre al cambiar de plan, al aplicar una bajada y al contratar o quitar un complemento.
- Un módulo que la empresa apagó a mano queda `MANUAL` y el plan no lo vuelve a encender.
- En **Plataforma → Módulos** (PLT, cambio de dos líneas en `Modulos::cambiar`): con suscripción, la empresa ya no enciende un módulo que no esté contratado. Al apagar uno queda `MANUAL`; al encenderlo toma su origen en el plan.

## Pruebas

2 pruebas nuevas en `OpsTest`:
- subir con prorrateo de 120 + IGV, pagado; módulos encendidos; bajar rechazado por uso; bajar programado, deshacer y aplicado el 1 de diciembre con módulos apagados;
- complementos: publicar con precio, permisos, límite que sube y baja, módulo encendido como complemento, corrida con las líneas, quitar y RN-SUS-09 en PLT.

En total el sistema tiene 357 pruebas, todas correctas. Revisado en el navegador contra `aycha_test` (1440 y 375 px).

## Pendiente

- **Tanda 9d:** métricas del negocio (OPS-10) e historial de uso de 12 meses (SUS-04).
- Complementos de números de WhatsApp, minutos, pedidos y llamadas de API, cuando se midan esos usos.
- Precios de planes y complementos (D-SUS-01).

# Tanda 9d (24/11): métricas del negocio e historial de uso (OPS-10 y SUS-04)

## Base de datos

Migración `2026_11_24_000400_ops_metricas_y_uso_mensual`:
- `platform_metric_runs`: corridas congeladas de cada mes (RN-OPS-17), solo inserción y solo consola.
- `tenant_usage_snapshots`: uso de cada empresa por mes (usuarios, marcas y locales, con su límite). La empresa ve las suyas; solo la consola escribe.

## Métricas (consola · Clientes → Métricas del negocio)

El mes en curso se calcula en vivo y un mes cerrado se congela el día 1 a las 3:00 (`ops:metricas cierre`). Administración y cobranza pueden congelar a mano un mes cerrado; recalcular pide motivo, crea otra corrida y la pantalla muestra la última.

| KPI | Cómo se calcula |
|---|---|
| MRR (KPI-OPS-01) | Cuota de las suscripciones activas y con deuda (con descuento) más sus complementos, sin IGV |
| Clientes activos (02) | Suscripciones activas o con deuda al cierre |
| Churn de clientes (03) | Cancelaciones del mes / activos al inicio |
| Churn de MRR (04) | MRR de los cancelados más lo que bajó / MRR al inicio |
| Retención neta (05) | MRR al cierre de los que estaban al inicio / MRR al inicio |
| Ingreso promedio (06) | MRR / clientes activos |
| Prueba a pago (07) | Pruebas que terminaron en el mes y quedaron activas / pruebas que terminaron |
| Uso por plan (08) | Promedio de usado / límite por plan |
| Tiempo de alta (09) | **Sin datos todavía**: falta el primer comprobante aceptado de cada empresa (FAC). No se inventa |
| Tickets por cliente (10) | Tickets del mes / activos |
| Primera respuesta (11) | Mediana por prioridad |
| Disponibilidad (12) | Lecturas UP / total, con degradado como media |
| MRR en mora (13) | Con deuda más solo lectura / MRR total |
| Resolución (14) | Mediana de los tickets resueltos en el mes |
| Horas de acceso de soporte (15) | Suma de la duración real de los accesos aprobados en el mes |

Además muestra lo facturado y lo cobrado del mes. Las empresas sin suscripción (el piloto) no cuentan.

El estado de cada suscripción en una fecha sale de su historial de eventos. El precio es el de su versión de plan actual: el historial todavía no guarda el precio de cada cambio, así que una bajada de precio en un mes pasado no se ve como contracción.

Pantalla:
- cifras del mes elegido;
- gráfico de barras del MRR de los últimos 12 meses (una serie, con el detalle al pasar el mouse);
- soporte, disponibilidad, uso por plan y facturación;
- tabla de los 12 meses (MRR, clientes, churn, retención y mora).

## Historial de uso (empresa · Mi suscripción → Plan y uso)

La tarea diaria (`ops:metricas uso`, 5:10) deja el uso del mes en curso de cada empresa con suscripción. «Plan y uso» muestra la tabla de los últimos 12 meses, con lo que llegó a su límite resaltado.

## Pruebas

1 prueba nueva en `OpsTest`:
- MRR, clientes e ingreso promedio con dos empresas;
- tiempo de alta sin datos;
- foto de uso en el historial de la empresa;
- en diciembre una cancelación: churn de clientes 50 %, de MRR 33,26 % y retención neta 66,74 %;
- congelar noviembre, recalcular con motivo (corrida 2) y no congelar el mes en curso;
- las corridas no se cambian.

En total el sistema tiene 358 pruebas, todas correctas. Revisado en el navegador contra `aycha_test` (1440 y 375 px).

## Con esto, la consola queda completa

Las 16 pantallas de OPS y las 14 de SUS están hechas. Pendientes de negocio:
- precios de planes y complementos (D-SUS-01);
- RUC y OSE de Intelectalab (D-SUS-06);
- pasarela real (D-SUS-02);
- plan Inicial sin las dependencias de ONB (RN-SUS-01).

Pendientes técnicos:
- conectar `Suscripcion::exigirLimite` en SEG y PLT;
- adaptadores de salud para los servicios externos;
- tiempo de alta cuando exista el comprobante aceptado;
- complementos de WhatsApp, minutos, pedidos y API.

# Límites del plan en usuarios, marcas y locales (24/11, RN-SUS-06 y CA-SUS-02)

`Suscripcion::exigirLimite()` (el contrato de SUS) ahora se llama antes de cada alta que suma al límite:
- **SEG · Usuarios** (`Usuarios::crear` y `Usuarios::reactivar`): invitar o reactivar un usuario.
- **PLT · Marcas** (`MarcaController`): crear una marca activa, pasar una a activa al editarla y activar varias a la vez.
- **PLT · Locales** (`LocalController`): crear un local activo y pasar uno a activo al editarlo.

Cómo funciona:
- Si ya llegó al límite del plan (más sus complementos), la API responde 422 con el código `RN-SUS-06`. Por ejemplo: «Tu plan permite 3 marcas y ya tienes 3. Cambia de plan o contrata un complemento para agregar más.»
- Lo inactivo se puede crear igual.
- **Las invitaciones pendientes cuentan como usuarios.** Si no, se podrían invitar muchos y activarlos después.
- Los técnicos del soporte y los del portal B2B no cuentan.
- Don Guando (sin suscripción) no tiene límites.
- Nada se borra si una empresa ya estaba por encima: solo no puede agregar más.

En la consola, el uso de cada empresa (Empresas y Métricas) sigue contando solo los usuarios activos; el límite cuenta también los invitados.

Prueba nueva en `OpsTest`: tres marcas entran y la cuarta activa no; inactiva sí, pero no se activa hasta contratar «1 marca más»; el tercer local no entra; con 15 usuarios (uno invitado) no se invita ni se reactiva, y con uno dado de baja sí se invita. En total el sistema tiene 359 pruebas, todas correctas.

# Paginación y buscador (24/11)

## Buscador en Parámetros de plataforma

Busca por nombre, descripción o valor (sin tildes ni mayúsculas) y agrupa en «Consola, soporte y operación», «Suscripciones y cobro» y «Registro de empresas».

De paso se corrigió:
- El RUC y el nombre con que factura Intelectalab se editan como texto: antes se mandaban como número y el nombre quedaba vacío.
- Los valores que son listas o grupos se leen bien (por ejemplo «Urgente: 1 · Alta: 4 · …»).

## Paginación

Antes, varias listas traían de una vez un tope de 100 a 500 filas, sin avisar si había más. Ahora:
- **Paginadas en el servidor** (`App\Support\Paginas`, mismo contrato que `Listado`: `data`, `current_page`, `last_page`, `per_page`, `total`; 25 por página, máximo 100):
  - consola: Bandeja de tickets, Accesos de soporte, Incidentes, Anuncios, Facturación del SaaS, Cobros, Avisos de la pasarela, Abonos y Mora;
  - empresa: Mis tickets, Accesos de soporte y Comprobantes de Mi suscripción.
- **Las cifras de la bandeja** (abiertos, sin primera respuesta, plazo vencido, sin asignar) siguen contando todo lo filtrado, no solo la página.
- **Paginadas en el navegador** (`usePaginaLocal`): Empresas, Suscripciones y Registros y demos. Filtran, ordenan y cuentan sobre la lista completa, así que se paginan después de filtrar.
- **Web:** `usePagina()` en `lib/paginas.ts` lleva la página y las filas por página. Al cambiar un filtro vuelve sola a la primera página.
- **Avisos y abonos de Cobros:** cada pestaña se carga por separado (`/consola/cobros/eventos` y `/consola/cobros/abonos`).

Prueba: en la bandeja, una por página: página 2 de 2, total 2 y las cifras con los 2 abiertos. En total el sistema tiene 359 pruebas, todas correctas. Revisado en el navegador con 30 tickets: «Mostrando 1 a 25 de 30» y, en la página 2, «26 a 30».

# Bitácora: filtros ordenados y cifras de cabecera (24/11)

- **Filtros:** antes iban todos en una caja dentro de la tabla, y las fechas ocupaban el ancho completo sin decir cuál era cuál. Ahora van en una cuadrícula arriba, como en la Bandeja de tickets: el buscador ocupa dos columnas, al lado van acción y usuario, y en la fila de abajo empresa, «Desde», «Hasta» y «Limpiar filtros» (aparece solo si hay algún filtro). «Desde» no deja elegir una fecha posterior a «Hasta», ni al revés.
- **Cifras, como en el prototipo** (no cambian con los filtros): acciones registradas, las de hoy (hora de Lima), acciones del soporte dentro de empresas (consultas, cambios y exportaciones de los accesos aprobados) e intentos rechazados (ingresos fallidos o bloqueados y pedidos del soporte fuera de lo aprobado), en ámbar si hay alguno.
- La API agrega `cifras` a `/consola/bitacora` en una sola consulta.

Prueba: `test_bitacora_de_la_consola_con_filtros` revisa que las cifras no dependan del filtro. Revisado en el navegador contra `aycha_test` (1440 y 375 px).

# Salud de componentes: cifras y vista en tabla (24/11)

- **Cifras del prototipo:**
  - operativos, con cuántos están sin lectura;
  - degradados;
  - caídos;
  - disponibilidad de 7 días de todos los componentes juntos;
  - incidentes abiertos, que lleva a Incidentes.
- La API agrega `disponibilidad_7d` e `incidentes_abiertos` a `/consola/salud`.
- **Vista en tabla o en tarjetas** con `VistaToggle` (componente nuevo en `components/ui`, que recuerda la vista elegida en cada pantalla). La tabla es la del prototipo: componente, estado, latencia, errores, cola, disponibilidad de 24 h y de 7 días, última lectura e incidente. La primera vez se abre en tabla.
- En la Bitácora y en el historial de Parámetros, la primera cuenta ya no figura como «Servidor (ops:crear-admin)» sino como «Instalación del servidor». Las claves del detalle se muestran en español (Correo, RUC, Plan…).
- **Falta del prototipo:** la tarjeta «Versiones desplegadas». El sistema todavía no guarda la versión de cada despliegue.

# Incidentes, Mora y Cobros con lo del prototipo; detalle en la Bitácora (24/11)

Se conserva lo que ya había (pestañas, acciones, diseño) y se agrega lo que el prototipo muestra.

## Incidentes

- **Cifras** (sin depender de los filtros):
  - abiertos;
  - SEV1 y SEV2 que empezaron este mes;
  - avisos fuera de plazo: SEV1 o SEV2 avisados después del plazo, o abiertos sin aviso con el plazo vencido;
  - tiempo medio de resolución (mediana).
- **Columnas del prototipo:** componente, inicio y duración por separado (con «en curso»), empresas («Todas» si afecta a todas) y aviso (minutos desde el inicio hasta que se avisó).

## Mora

- **Cifras:** en mora, deuda vencida, en solo lectura y suspendidas, sobre toda la cola.
- **Columnas del prototipo:** plan, estado, comprobante (con «y N más»), deuda, días de mora, próximo reintento y paso previsto. El medio de pago queda bajo la empresa.
- **Tarjeta «Proceso diario de mora»:**
  - dice cuándo corre solo (6:20) y muestra la última ejecución con su resumen;
  - administración y cobranza la pueden ejecutar a mano con «Ejecutar reintentos y cambios de estado» (`POST /consola/mora/proceso`, 5 por minuto).
  - Solo corre para hoy: el prototipo deja elegir la fecha porque es una demo, y en el sistema real eso sería simular el paso del tiempo.
  - Cada corrida, la programada (`sus:mora`) o la manual, queda en la bitácora como «Proceso de mora ejecutado».

## Cobros y conciliación

Las pestañas se quedan.
- **Cifras:**
  - cobros aprobados, con el monto;
  - rechazados;
  - por conciliar, con el monto;
  - avisos repetidos descartados.
- **Filtro por empresa.**
- **Columnas del prototipo:** fecha, empresa, comprobante, intento (cuántos cobros tuvo ese comprobante hasta ese), origen, monto, resultado, motivo, pasarela y referencia, y conciliado («Sí» con el abono o «Pendiente»).
- **Tarjeta «Conciliación con el abono de la pasarela»:** los cobros aprobados sin conciliar, agrupados por día, con el botón «Conciliar abono», que abre el mismo formulario de siempre. No se estima la comisión: se conoce recién con el abono.

## Bitácora

- Había acciones que se veían con su código interno (INCIDENT_OPENED, BILLING_RUN y 23 más) porque no tenían nombre. Ya lo tienen todas, y la prueba `tests/Unit/BitacoraTest.php` falla si se registra una acción nueva sin su nombre en español.
- Al hacer clic en una fila se abre el detalle: quién, empresa, motivo, IP, el detalle con sus nombres en español y, plegado, el registro completo tal como se guardó.

## Pruebas

En `OpsTest` se agregó:
- las cifras de incidentes, con un SEV2 sin aviso pasado el plazo;
- las cifras y el número de comprobante de mora;
- la última corrida y la corrida manual, que soporte nivel 1 no puede ejecutar;
- en cobros, el número de intento, las cifras y la agrupación por día.

# Facturación, Planes y Suscripciones con lo del prototipo (24/11)

## Facturación del SaaS

- Si hay RUC emisor, un aviso dice con qué RUC factura Intelectalab y el IGV.
- **Cifras:** por cobrar (monto y cuántos), vencido, emitido este mes y borradores.
- **Filtros nuevos:** empresa y tipo (factura, boleta, nota de crédito).
- **Columnas del prototipo:** número, empresa, emitido (con su vencimiento), período (inicio y fin), subtotal, IGV, total, pago y estado en el OSE.
- **Vista previa de la corrida** (pestaña Corridas):
  - Se elige el mes y se ve qué se facturaría, sin grabar nada: empresa, tipo, plan, período, líneas, subtotal, IGV y total, más las notas de las que no se facturan.
  - El botón «Emitir N comprobantes y cobrar» (o «Armar N borradores» si falta el RUC emisor) corre ese mes.
  - La API agrega `GET /consola/facturacion/vista-previa`, solo para administración y cobranza. La corrida y la vista previa usan el mismo cálculo (`Facturacion::porFacturar`), así que no pueden diferir.
- **Series en tabla** (como el prototipo, con la vista en tarjetas todavía disponible): serie, tipo, RUC emisor, siguiente número, último emitido y estado.

## Catálogo de planes

- **Cifras:** planes publicados (con los módulos del catálogo), borradores, empresas suscritas y precio desde.
- **Vista en tabla** con `VistaToggle`. Las tarjetas siguen siendo la vista inicial.
  - Una fila por versión (publicada, borrador y retiradas): plan, versión, estado, precio más IGV, módulos, límites, suscripciones, publicado y dependencias.
  - Se puede filtrar por estado.
- **Detalle de cada versión** al hacer clic en la tabla:
  - precio, empresas que la usan y fechas;
  - los límites con «Bloquea» (así funcionan en el sistema);
  - los módulos incluidos con su dependencia, marcando la que falta;
  - las acciones de siempre (editar, publicar, nueva versión, retirar).
- **No se agregó del prototipo:** «Producto» y su filtro. El sistema vende un solo producto (GestionCarnica); la Granja del prototipo es para más adelante.

## Suscripciones

- **Cifras:** MRR (activas y con deuda, sin IGV), empresas con suscripción vigente y cuántas hay en prueba, activas, con deuda, en solo lectura y suspendidas. Al hacer clic en una de estado se filtra la lista.
- **Columna nueva «Uso más alto»:** el porcentaje del límite más usado y de qué es; en ámbar desde 80 % y en rojo al llegar.
- **No se agregó del prototipo:**
  - «Producto», por lo mismo que en Planes;
  - «Nueva suscripción»: una suscripción nace con el alta de la empresa (Empresas → Nueva empresa).

Prueba: en `OpsTest` se revisa la vista previa (no graba y soporte no la ve), sus montos, las cifras de facturación y la lista de empresas del filtro.
