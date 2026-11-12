# SEG · Revisión del módulo contra la spec (11/11/2026)

Se comparó Seguridad con la spec: reglas, criterios de aceptación, indicadores, permisos, parámetros y pantallas. Estos son los arreglos.

## Ingreso
- **El aviso de bloqueo ya no revela que el correo existe.** Con la cuenta bloqueada y una contraseña incorrecta, se responde el mensaje de siempre («El correo o la contraseña no son correctos»), igual que con un correo que no existe. El aviso «Tu cuenta está bloqueada hasta las…» solo sale con la contraseña correcta, y aun así no entra. En la bitácora queda `LOGIN_BLOCKED` con `password_ok`.
- **Contraseñas con Argon2id** (`config/hashing.php`). Las guardadas antes con bcrypt se siguen aceptando y se vuelven a guardar con Argon2id la próxima vez que la persona ingresa. Es la misma contraseña, así que no cuenta como cambio ni entra al historial. En las pruebas, Argon2id usa poca memoria (`phpunit.xml`).

## Vencimiento de la contraseña
- Con `seg_password_max_age_days` mayor que 0, la contraseña vence a esos días de cambiada (sin fecha de cambio, cuenta desde la creación del usuario). Hoy el parámetro está en 0: no vence.
- Con la contraseña vencida, o si se le pidió cambiarla, la API solo deja usar `/me`, el cambio de contraseña, las notificaciones, salir y Mi cuenta. El resto responde 403 con `PASSWORD_CHANGE_REQUIRED` (`SetUserContext`).
- La web lleva a la persona a Mi cuenta con un aviso hasta que cree una contraseña nueva.

## Mi cuenta y Mis sesiones, como en el prototipo
- Mi cuenta ya no trae la lista de sesiones. La cifra «Sesiones abiertas» lleva a **Mis sesiones y dispositivos**.
- Mis sesiones y dispositivos está también en `/perfil/sesiones`, en el menú de la cuenta y en el buscador, para que la abra cualquier persona aunque no tenga el módulo de Seguridad. SEG-07 sigue en el menú de Seguridad.

## Pruebas
`tests/Feature/Modulos/SegIngresoTest.php`, 4 pruebas: el bloqueo no revela el correo, Argon2id y la conversión al ingresar, la contraseña vencida solo deja cambiarla, y el código de recuperación vence a los 30 minutos y al usarlo cierra las sesiones.

## Sigue pendiente
- Segundo factor (verificar y activar al ingresar, códigos de recuperación).
- Ingreso de la app móvil desde un dispositivo aprobado (llega con la app).

# Segunda revisión (11/11/2026)

## Nadie se da más acceso a sí mismo
- Nadie cambia su **propio rol ni su alcance**. Sí puede cambiar su nombre o su trabajador (`Usuarios::actualizar`).
- Nadie cambia los **accesos ni los permisos de su propio rol** (`Roles::editable`). Si otra persona edita el rol de administrador, sigue sin poder dejarlo sin lo necesario para administrar.
- El rol **Gerente** lo da o lo quita solo la gerencia, también al crear un usuario (`Usuarios::soloLaGerencia`).
- Nadie reinicia su **propio segundo factor**.
- Al cambiar la contraseña en Mi cuenta, cada fallo de la contraseña actual **cuenta para el bloqueo**, como al ingresar. Al llegar al máximo se bloquea la cuenta y se cierran sus sesiones, también la actual (`AuthController::registrarFallo`).
- La base solo acepta **correos en minúsculas** y sin espacios (migración `2026_11_11_000200_seg_correo_en_minusculas`).

## Pantallas
- Ficha del usuario: la bitácora de accesos se filtra **por evento**. Solo se ofrecen los eventos que tiene ese usuario, y la API rechaza un evento desconocido.
- Usuarios: el filtro de local tiene «Todos (sin asignar)», para ver quién no tiene local asignado y por eso ve todos. La API valida los filtros de local y marca.
- Mi cuenta: el texto de arriba ya no menciona las sesiones.
- Política de contraseñas y sesiones: arriba quedan solo las cifras del prototipo, Bloqueos del mes e Inicios fallidos. Se quitaron «Largo mínimo» y «Sesiones a la vez», que repetían valores de la lista de parámetros.

## Pruebas
`SegNadieSeDaMasAccesoTest` (6 pruebas), más 2 de filtros en `SegUsuariosTest`. `SegRolesTest` ahora prueba que el rol de administrador lo protege también cuando lo edita la gerencia.
