# 07/11/2026 · El sistema se pinta con los colores de la marca

- `/v1/me` trae `themes`: los colores activos de la empresa y los propios de cada marca visible (PLT-06).
- Al elegir una marca en el selector de arriba, todo el sistema toma sus colores en modo claro y oscuro: botones, menú lateral, fondos, textos, cifras destacadas y la línea de colores de los encabezados. Con «Todas las marcas», o con una marca sin colores propios, rigen los de la empresa (RN-PLT-23).
- Se reescriben las variables de `globals.css` (`--primary`, `--bg`, `--surface`, `--ink`, `--side-bg`…) desde `lib/temaMarca.ts`. Los tonos intermedios (fondos suaves, líneas, texto tenue, el degradado del menú) se calculan con `color-mix` a partir de los 7 colores del tema.
- Para que no se vea un instante la paleta fija al cargar, la hoja de la marca se guarda en el navegador y un script del `<head>` la pone antes de pintar.
- Al guardar o quitar colores en PLT-06 la sesión se recarga y el cambio se ve al momento.

## Seguridad
- Solo se aceptan colores `#RRGGBB`, en la API al guardar y otra vez en la web antes de armar la hoja de estilos: ningún texto del usuario llega al CSS.
- El script del `<head>` solo aplica la hoja guardada si tiene los caracteres que genera `cssDeTema` y no contiene `url(`, `@import` ni `expression`.
- Al cerrar sesión (o si vence) se borran la hoja y lo guardado: la pantalla de ingreso no muestra los colores de la sesión anterior.
- `/v1/me` solo manda los temas de las marcas que el usuario puede ver.

## Pruebas
`PltTemasTest::test_la_sesion_trae_los_colores_de_la_empresa_y_de_cada_marca`. 68 pruebas en total.
