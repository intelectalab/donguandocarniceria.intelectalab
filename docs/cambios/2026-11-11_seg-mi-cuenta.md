# SEG · Mi cuenta (11/11/2026)

SEG-06 Mi cuenta. Es la misma pantalla que «Mi perfil» del menú de la cuenta, así la ve **cualquier persona**, tenga o no el módulo de Seguridad. También resuelve el pendiente de SEG-07: dentro de Mi cuenta van «Mis sesiones y dispositivos».

## API (`MiCuentaController`, sin permiso especial ni acceso al módulo)
- `GET /seg/mi-cuenta`: mis datos (nombre, correo, empresa, rol, alcance, trabajador, último ingreso, idioma), preferencias, mis marcas, y seguridad (segundo factor, códigos de recuperación disponibles, cuándo cambié la contraseña y si vence, sesiones abiertas y máximo, y la regla de contraseñas). El alcance muestra solo lo que limita: las marcas asignadas y los locales asignados.
- `PUT /seg/mi-cuenta/preferencias`: marca por defecto (solo una de las mías), modo de color (`LIGHT`, `DARK`, `SYSTEM`) y avisos (correo, celular, resumen diario). Queda `PROFILE_UPDATED` en la bitácora.
- `POST /seg/mi-cuenta/probar-clave`: prueba la contraseña nueva contra la política sin guardarla (la de SEG-14 pide el módulo de Seguridad).
- El cambio de contraseña sigue siendo `POST /me/password` y ahora deja `PASSWORD_CHANGED` en la bitácora.

## Preferencias que se aplican
- **Modo de color:** al entrar se aplica el guardado en la cuenta (`lib/modoColor.ts`), así sigue a la persona en cualquier equipo. El botón de la cabecera también lo guarda en la cuenta.
- **Marca por defecto:** al entrar se elige sola si en ese navegador no se había elegido otra.

## Web
- `modulos/seg/MiCuenta.tsx`: cifras del prototipo (rol, segundo factor, sesiones abiertas, contraseña cambiada), Mis datos, Preferencias, Cambiar contraseña con la política en vivo, Segundo factor (solo estado: activarlo llega con el segundo factor) y Mis sesiones y dispositivos.
- `modulos/seg/MisSesiones.tsx`: el contenido de SEG-07, que ahora usan SEG-07 y Mi cuenta.
- `/perfil` y `/m/seg/seg-06` muestran Mi cuenta.

## Pruebas
- `tests/Feature/Modulos/SegMiCuentaTest.php`, 3 pruebas: cualquier persona ve su cuenta (alcance solo con lo asignado), preferencias solo con una de sus marcas y en la bitácora, y probar la clave y el cambio en la bitácora.

## Pantallas fuera del menú
SEG-01 a SEG-05 (inicio de sesión, verificar y activar el segundo factor, olvidé mi contraseña y nueva contraseña) pasan antes de entrar al sistema y ya tienen su página propia: `/login`, `/forgot-password` y `/reset-password`. No salen en el menú ni en la lista del módulo (`FUERA_DEL_MENU` en `lib/modulos.ts`). Lo que pide la spec para el ingreso y la recuperación ya se cumple ahí (mensaje de error único, respuesta igual exista o no el correo, política al poner la contraseña nueva). El segundo factor queda pendiente: se activará en el ingreso y en Mi cuenta.
