# El producto pasa a llamarse GestionCarnica (13/11/2026)

A pedido de la dueña del proyecto, el producto deja de llamarse **Aycha** y pasa a llamarse **GestionCarnica**, como en los prototipos 2.4 y 2.5. El cliente sigue siendo Don Guando y el sistema hace lo mismo: solo cambia el nombre y el logo.

## Dónde se ve el nombre nuevo
- **Página pública:** títulos de la pestaña (inicio y precios), cabecera, pie («© GestionCarnica · Intelectalab»), preguntas frecuentes, aviso del pedido de demo y mensaje de WhatsApp.
- **Ingreso:** nombre del panel y «GestionCarnica by Intelectalab».
- **Sistema:** título de la pestaña, cabecera y barra lateral cuando no hay empresa, pie de la barra lateral y «Vienen con GestionCarnica» en SEG-10.
- **Correos y mensajes de la API:** invitación a un usuario («Invitación a GestionCarnica»), aviso de empresa no activa y empresa general del ingreso.
- **Excel exportados:** autor y descripción del archivo.
- **Descripciones de módulos** (`modulos.json`) que nombraban al producto.

## Logo
- La «A» se cambia por la **«G» dorada sobre el cuadro vino** del prototipo 2.5 (`web/public/favicon.svg` de esa versión).
- Está en el ícono de la pestaña (`app/icon.svg`), en la cabecera y el pie de la página pública (`LogoMarca` en `components/landing/Cabecera.tsx`) y en el panel del ingreso general.
- Con dominio por empresa, el ingreso y la barra lateral siguen mostrando el logo o las iniciales de la empresa, como antes.

## Celular
El nombre es más largo, así que en la cabecera de la página pública, por debajo de 640 px, el logo y el nombre se achican un poco y «Pruébalo gratis» no se parte. Revisado a 375 px y 768 px sin desplazamiento horizontal.

## Qué se mantiene con el nombre anterior (por compatibilidad)
- **Base de datos, roles y servidor:** bases `aycha` y `aycha_test`, roles `aycha_app`, `aycha_owner` y `aycha_alm_inventario`, contenedores `aycha_postgres` y `aycha_redis`, carpeta `/var/www/aycha`, procesos `aycha-web` y `aycha-queue` y `config/aycha.php`. Cambiarlos obliga a mover el servidor y no se ve en ninguna pantalla.
- **Claves del navegador** (`aycha-tema`, `aycha-marca`, `aycha-local`, `aycha_token`…): si cambian, todos pierden sus preferencias y su sesión.
- **Dominios de la plataforma** `aycha.pe` en la configuración: todavía no se usan; se cambian cuando haya dominio nuevo.
- **Contraseñas prohibidas:** se agregan `gestioncarnica`, `gestioncarnica1`, `gestioncarnica123` y `gestioncarnica2026`, sin quitar las de `aycha`.
- **Prototipo viejo** (`aycha-proto/`) y **notas de cambios anteriores:** son historia y no se reescriben.

## En el servidor
Al desplegar, cambiar `APP_NAME` en `/var/www/aycha/apps/api/.env` a `"GestionCarnica Don Guando"`, como `.env.example` (el remitente de los correos sale de ahí) y limpiar la caché de configuración. `.env.example` ya trae el nombre nuevo.

## Pruebas
`php artisan test --testsuite=Feature`: 236 en verde. `npm run typecheck` y `npm run lint` limpios.
