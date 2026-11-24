# Correos con el diseño de GestionCarnica (24/11/2026)

Los correos del sistema eran texto plano y decían «Entra a /consola/activar» sin enlace. Ahora todos usan un mismo diseño.

## Cómo se ve

- Arriba, el logo «G» (vino y dorado) y el nombre GestionCarnica.
- Una tarjeta blanca con título, saludo y texto.
- El código en grande, dentro de un recuadro, con su vencimiento.
- Los pasos numerados.
- Un botón con el enlace completo al sitio (sale de `APP_URL`). Debajo, el mismo enlace por si el botón no funciona.
- Un aviso final en gris y un pie que dice que el correo es automático.

Se ve bien en Gmail, Outlook y el celular: usa tablas y estilos en línea, y bajo 480 px achica los márgenes y el código. Cada correo lleva además una versión de texto para los lectores que no muestran HTML.

## Correos que cambiaron

| Correo | Dónde se envía | Botón |
|---|---|---|
| Acceso a la consola | Invitación a un usuario de la consola y `ops:crear-admin` | Activar mi cuenta → `/consola/activar` |
| Invitación a GestionCarnica | Alta de un usuario en la empresa (SEG) | Crear mi contraseña → `/forgot-password` |
| Tu cuenta está lista (alta) | Alta de una empresa desde la consola | Crear mi contraseña → `/forgot-password` |
| Tu código para activar | Registro público (ONB) | — |
| Tu cuenta está lista (registro) | Registro público, al activar | Ingresar → `/login` |
| Recuperar tu contraseña | «Olvidé mi contraseña» | — |

Cuando la cuenta de la consola la crea el servidor (`ops:crear-admin`), el correo dice «Ya tienes acceso…». Antes mostraba el nombre interno «Servidor (ops:crear-admin)».

## Cómo se usa

`App\Support\Correo::enviar($para, $asunto, [...])`, con las vistas `resources/views/correos/base.blade.php` (HTML) y `base-texto.blade.php` (texto). Las piezas son `titulo`, `saludo`, `parrafos`, `codigo`, `vence`, `pasos`, `boton` (`texto` y `ruta`) y `nota`.

## Seguridad

- Nombres, empresas y demás datos se escapan en el HTML: nunca se toman como código.
- El código y el correo no van en el enlace, para que no queden en el historial del navegador ni en los registros de los servidores.

## Pruebas

Prueba nueva `tests/Unit/CorreoTest.php`, que no usa la base. Comprueba:
- el asunto, el destinatario y el código;
- el enlace completo;
- que los datos se escapan en el HTML y no en el texto;
- que el código no va en ningún enlace.

También se ajustaron `CuentaTest` y `SegIngresoTest`, que atrapaban el código simulando `Mail::raw`: ahora lo leen del correo nuevo. En total el sistema tiene 360 pruebas, todas correctas.
