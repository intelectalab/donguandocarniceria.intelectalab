# Barra lateral · menú corto «Lo de todos los días» y estrellas (11/11/2026)

Del prototipo nuevo (menú corto por puesto). La barra tiene dos menús y cada persona elige cuál ver. El **menú completo** es la barra de siempre, con los mismos grupos, orden y estilo.

## Menú corto
- Muestra Inicio y, bajo el título «Lo de todos los días», solo las pantallas del trabajo diario del puesto y las que la persona fijó. Debajo de cada una dice su módulo. Así ninguna pantalla sale dos veces.
  Por ejemplo: el cajero tiene Venta, turno, cierre y clientes, y el repartidor sus rutas y paradas. Las listas por rol son las del prototipo (`lib/menuDia.ts`).
- Al final, **«Ver todos los módulos →»** pasa al menú completo. El buscador de la cabecera sigue encontrando todo.
- Sale por defecto a quien tiene al menos 3 pantallas del día. Con menos, como Auditor sin estrellas, siempre el completo y sin botón.
- Con la barra en modo íconos se ven los íconos de siempre.

## Menú completo
- La barra de siempre. Debajo de Inicio está **«← Ver solo lo de todos los días»** para volver al corto.
- **Estrella en cada pantalla**: aparece al pasar el mouse. Al marcarla, la pantalla se suma al menú corto y la estrella queda dorada. En el menú corto, la estrella de una fijada la quita.

## Qué se muestra
Solo las pantallas que la persona ve en su menú. Un módulo apagado, sin acceso, o una pantalla que su rol no ve, no aparece aunque esté en la lista del puesto o la haya fijado.

## Diferencias con el prototipo
- Las estrellas y el menú elegido se guardan **en la cuenta** (no solo en el navegador), así siguen a la persona en cualquier equipo.
- La campana con «Importantes» y «Todas» queda para otro paso.

## API
- `users.menu_favs` (jsonb, lista de hasta 40) y `users.menu_corto` (sin elegir = null). Migraciones `2026_11_11_000300_seg_pantallas_fijadas` y `2026_11_11_000400_seg_menu_corto`.
- `PUT /seg/mi-cuenta/menu`:
  - `favs`: la lista completa de códigos de pantalla (`PED-02`), sin repetir, como máximo 40.
  - `corto`: true o false.
  - Llega una de las dos o ambas. La usa cualquier persona, sin permiso especial, con un límite de 60 por minuto.
- `/me` devuelve `user.menu_favs` y `user.menu_corto`.

## Pruebas
`SegMiCuentaTest::test_las_pantallas_fijadas_del_menu_quedan_en_la_cuenta`: las estrellas y el menú elegido se guardan y se ven desde otra sesión. Se rechazan códigos inválidos, repetidos, más de 40, un valor de menú que no es sí o no, y una petición vacía.
