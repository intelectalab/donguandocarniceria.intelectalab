# SEG · Usuarios y ficha del usuario (10/11/2026)

Primeras pantallas del módulo de seguridad: SEG-08 Usuarios y SEG-09 Ficha del usuario, con la bitácora de accesos del inicio de sesión. El segundo factor (SEG-02, SEG-03) sigue fuera por decisión del equipo; las pantallas solo lo muestran como información.

## API (`app/Modulos/Seg`, rutas en `routes/modulos/seg.php`, 15 rutas bajo `/api/v1/seg/usuarios`)
- **`Usuarios`** (servicio): crear e invitar, cambiar rol y alcance, bloquear, desbloquear, desactivar, reactivar, cerrar sesiones, reiniciar el segundo factor y reenviar la invitación.
  - RN-SEG-01: correo único sin distinguir mayúsculas; se guarda en minúsculas.
  - **Un solo rol por usuario**, como el prototipo. El alcance es de la persona: mezclar un rol de alcance asignado con uno total lo dejaba ambiguo.
  - RN-SEG-13: un rol de alcance asignado exige al menos un local o una marca; uno de alcance total ve todo y no guarda marcas ni locales.
  - RN-SEG-15: siempre queda un `ADMIN_SISTEMA` activo (no se le quita el rol, no se bloquea ni se desactiva). Nadie se bloquea ni desactiva a sí mismo.
  - RN-SEG-17 y 18: no se borran; desactivar o bloquear cierra sus sesiones (tokens de Sanctum) al instante y desactivar revoca sus celulares.
  - RN-SEG-20: los permisos se leen por petición, así que el cambio rige en la siguiente; queda en la bitácora y en `domain_events`.
  - Los roles `SOPORTE_PLATAFORMA` (Intelectalab) y `CLIENTE_B2B` (portal) no se asignan desde aquí.
- **Invitación:** el usuario nace `INVITED` con una contraseña aleatoria que no se usa; recibe por correo un código de 6 caracteres (48 horas) que canjea en «Nueva contraseña» (SEG-05). Al fijarla pasa a `ACTIVE`. Reactivar a un inactivo vuelve a invitarlo.
- **`Bitacora`** (servicio): escribe en `access_log` (solo inserción) con IP y dispositivo resumido («Chrome · Windows»), sin guardar el user agent completo. El inicio de sesión registra `LOGIN_OK`, `LOGIN_FAILED`, `LOCKED`, `LOGIN_BLOCKED` y `LOGOUT`; recuperar contraseña, `PASSWORD_RESET_REQUESTED` y `PASSWORD_RESET`. Un correo que no existe en ninguna empresa no se puede anotar (no hay empresa para la fila con RLS).
- **Bloqueo por intentos (RN-SEG-04):** al quinto intento el usuario pasa a `LOCKED` con `locked_until`, se cierran sus sesiones y se emite `user.locked`; al vencer el plazo, el siguiente ingreso correcto lo vuelve a `ACTIVE` con el contador en cero. El bloqueo a mano no tiene plazo.
- **Lista y ficha:** estado efectivo (`estado`), roles y alcance en texto, trabajador vinculado, sesiones abiertas (tokens vigentes), celulares y bitácora paginada (`GET /usuarios/{id}/accesos`, que incluye lo que otros hicieron sobre la cuenta). Los usuarios del portal B2B (`customer_id`) no salen.
- **Permisos:** listar y ver con el módulo SEG; crear, editar, bloquear, desactivar, reactivar y reenviar con `seg.user.manage`; desbloquear con `seg.user.unlock`; reiniciar el segundo factor con `seg.user.reset_mfa`; cerrar sesiones con `seg.session.revoke`. Todo se valida en la API; la web solo oculta botones.

## Alcance efectivo (`App\Support\Access`)
- RN-SEG-13: con un rol de alcance total el usuario ve todas las marcas y locales aunque queden filas guardadas en `user_scopes`. Antes se recortaba igual. Afecta a quien tenga datos antiguos con dos roles: en la demo, Diana Flores (Vendedora y Compras) ahora ve todas las marcas.
- Su ficha avisa que tiene más de un rol guardado; al guardar queda solo el elegido. Si necesita los permisos de ambos, se crea un rol propio que los junte (SEG-10).

## Sesiones
- Migración `2026_11_10_000200_seg_ip_y_dispositivo_de_la_sesion.php`: `ip` y `device` en `personal_access_tokens`, que se llenan al iniciar sesión. Las sesiones abiertas antes quedan sin esos datos.
- La ficha marca «Esta sesión» (la del token con el que se mira) y no ofrece cerrarla desde ahí.

## Dispositivos
- `Dispositivos` (servicio) y rutas `POST /seg/dispositivos/{id}/aprobar` y `/revocar`, con el permiso `seg.device.approve` (administrador del sistema y coordinador de delivery). SEG-13 los reutilizará.
- RN-SEG-11: revocar pide motivo y cierra al instante las sesiones abiertas desde ese dispositivo. Migración `2026_11_10_000300_seg_dispositivo_de_la_sesion.php`: `device_id` en `personal_access_tokens`, que llenará el ingreso desde la app móvil.
- RN-SEG-16: nadie aprueba su propio dispositivo, salvo la gerencia cuando es la única persona activa con el permiso (queda marcado en la bitácora).
- Solo la app móvil registra dispositivos (D-SEG-03). Los dispositivos web que se ven son datos de demo del prototipo.
- Pendiente: avisar al usuario cuando se aprueba su celular (en el prototipo, una notificación).

## Web (`src/app/(sistema)/m/seg/seg-08`, `seg-09`, formulario en `src/modulos/seg`)
- SEG-08: cifras del prototipo (activos, bloqueados, inactivos, cobertura del segundo factor KPI-SEG-01, sin uso KPI-SEG-03), filtros por rol, local, marca y estado, búsqueda e invitación en una ventana.
- SEG-09: ficha con acciones según estado y permiso, pestañas Rol y alcance (desplegable de rol; marcas y locales solo con un rol de alcance asignado), Sesiones (dispositivo, IP, inicio, última actividad, vencimiento; cerrar una), Dispositivos y Bitácora de accesos. Se abre con `?id=`; sin él, una lista corta para elegir.

## Pruebas
- `tests/Feature/Modulos/SegUsuariosTest.php`, 16 pruebas: CA-SEG-02, CA-SEG-06, CA-SEG-07, RN-SEG-01, 13, 15, 17, 18, 19 y 20, un solo rol, alcance según el rol, IP y dispositivo de la sesión, sesión actual que no se cierra, aprobar y revocar dispositivos, invitación con código y permisos de cada acción.

## Pendiente dentro de SEG
- SEG-07 y SEG-15: vencimiento por inactividad y máximo de sesiones simultáneas (RN-SEG-09, RN-SEG-10) sobre los tokens, que ya guardan IP y dispositivo.
- `PERMISSION_DENIED` y `MODULE_DISABLED` en la bitácora cuando se construya AUD-03.
