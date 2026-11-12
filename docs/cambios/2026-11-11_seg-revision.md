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
- Que el coordinador de delivery vea Dispositivos desde su menú.
