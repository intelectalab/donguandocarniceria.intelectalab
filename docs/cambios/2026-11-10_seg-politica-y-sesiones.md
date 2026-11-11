# SEG · Política, sesiones de la empresa y mis sesiones (10/11/2026)

Sigue a [2026-11-10_seg-roles.md](2026-11-10_seg-roles.md): SEG-14 Política de contraseñas y sesiones, SEG-15 Sesiones activas de la empresa y SEG-07 Mis sesiones y dispositivos. Además, la política de sesiones ahora **se cumple**: antes solo existía como parámetros.

## La política de sesiones se cumple (`Sesiones`)
- **RN-SEG-09, duración:** una sesión web dura como máximo `seg_session_max_hours` (12 h), también con «Recordarme» (que solo guarda la sesión en el navegador al cerrarlo). Antes «Recordarme» la dejaba abierta 30 días.
- **RN-SEG-09, inactividad:** una sesión web sin uso por más de `seg_session_idle_minutes` (30 min) se cierra en el siguiente intento de usarla y responde 401; la de la app móvil, tras `seg_mobile_session_days` (7). Se valida en Sanctum (`authenticateAccessTokensUsing`, en `AppServiceProvider`) antes de anotar el uso de esa petición, y queda `SESSION_EXPIRED` en la bitácora.
- **RN-SEG-10:** al iniciar sesión, si el usuario pasa de `seg_max_concurrent_sessions` (3), se cierran las de uso más antiguo (nunca la nueva) y queda `SESSION_REVOKED` en la bitácora.
- **Sesiones vigentes:** toda lista y cuenta (SEG-07, SEG-09, SEG-15 y el máximo) excluye las vencidas por fecha o por inactividad, aunque todavía no se hayan borrado (`Sesiones::vigentes`).
- Los tres valores se cambian en SEG-14 sin tocar código.

## Sesiones anteriores
- Migración `2026_11_10_000400_seg_sesiones_anteriores.php`: el disparador `seg_archivar_sesion` archiva en `user_sessions` cada sesión que se borra, con su estado (`REVOKED` cerrada o `EXPIRED` vencida), cuándo y su motivo. `user_sessions` pasa a ser de solo inserción para la app.
- El motivo lo deja quien cierra con `Sesiones::cerrando()`: cierre de sesión, cuenta bloqueada por intentos, usuario bloqueado o desactivado, cerrada por quien la cerró, cerrada por el usuario, contraseña cambiada o restablecida, dispositivo revocado, máximo de sesiones, vencida por inactividad o por duración. Sin motivo queda «Sesión cerrada».
- `Sesiones::delUsuario()` da las abiertas y las anteriores con el mismo formato (las vencidas que todavía no se borraron cuentan como anteriores).

## Política de contraseñas (RN-SEG-02)
`PasswordPolicy` suma dos condiciones que pedía la spec: la contraseña **no contiene el correo ni el nombre** (partes de 4 letras o más, sin distinguir mayúsculas ni tildes) y **no es una contraseña común** (lista interna). Sigue exigiendo largo mínimo, mayúsculas, minúsculas y número, y no repetir las últimas `seg_password_history_count`. Rige al cambiar la contraseña, al restablecerla y al activar una invitación. `PasswordPolicy::checks()` devuelve cada condición con si se cumple.

## API (`PoliticaController`, `SesionController`)
- `GET /seg/politica`: parámetros de SEG con su valor vigente y si es propio de la empresa, la regla en texto y las cifras del mes (bloqueos, inicios fallidos y su tasa). `GET /seg/politica/historial`: el historial de la política, paginado, con búsqueda, orden y filtro por parámetro. Pide el módulo SEG. Los valores se cambian con el editor de parámetros de PLT, que acepta `seg.policy.edit` para las claves `seg_*` y exige motivo.
- `POST /seg/politica/probar`: prueba una contraseña con el usuario que pregunta y responde qué condiciones cumple. No la guarda ni la registra. Máximo 30 pedidos por minuto.
- `GET /seg/sesiones` (`seg.session.view_all`): sesiones vigentes de la empresa con usuario, cliente, dispositivo, IP, inicio, última actividad y vencimiento; filtros por usuario, rol y cliente; cada fila trae cuántas sesiones tiene ese usuario; cifras y política. `DELETE /seg/sesiones/{id}` (`seg.session.revoke`): cierra una; nunca la propia actual.
- `GET /seg/mis-sesiones` (abiertas, anteriores y dispositivos), `DELETE /seg/mis-sesiones/{id}` y `DELETE /seg/mis-sesiones` («cerrar todas las demás»): cada persona, las suyas, sin permiso especial ni acceso al módulo SEG. La actual no se cierra desde aquí.

## Web
- **SEG-14:** cifras (bloqueos del mes, inicios fallidos, largo mínimo, sesiones a la vez), los parámetros en cinco grupos como el prototipo (contraseñas, bloqueo, sesiones, segundo factor y recuperación, dispositivos y revisión) que abren el editor de parámetros, «Probar la política con tu usuario» y el historial paginado con búsqueda y filtro por parámetro.
- **SEG-15:** cifras del prototipo (sesiones abiertas, usuarios conectados, app móvil; «esperando segundo factor» llega con el segundo factor), lista con búsqueda y filtros por usuario, rol y cliente, y por fila «Cerrar» y, si el usuario tiene más de una, «Todas del usuario».
- **SEG-07:** cifras; mis sesiones abiertas (cliente con «Esta sesión», dispositivo, IP, inicio, última actividad y vence) con «Cerrar» y «Cerrar todas las demás»; sesiones anteriores con su estado y motivo; mis dispositivos registrados («Aprobado por»).
- **SEG-09:** la pestaña Sesiones muestra las abiertas y luego las anteriores, con su estado y motivo.

## Pendiente
- **SEG-07 para quien no tiene el módulo Seguridad:** la API ya responde a cualquiera, pero el menú y el armazón solo muestran las pantallas de SEG a quien tiene el módulo. Se resuelve con SEG-06 Mi cuenta, que va en el menú de la cuenta de cada persona.

## Pruebas
- `tests/Feature/Modulos/SegSesionesTest.php`, 10 pruebas: la política y sus cifras, probar la política (correo, nombre, comunes, largo), la política al cambiar la contraseña, vencimiento por inactividad y duración de 12 horas, máximo de sesiones, sesiones de la empresa con permisos, sesión inactiva que no se lista ni cuenta, historial paginado, sesiones anteriores con su motivo y archivo de solo inserción, y mis sesiones.
