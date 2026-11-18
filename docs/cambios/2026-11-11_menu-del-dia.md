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

# Campana · notificaciones importantes (11/11/2026)

Del prototipo nuevo: la campana cuenta solo lo importante para tu puesto.

- **Importante:** lo rojo, y lo ámbar de los módulos de tu día a día. Esos son los módulos de tu menú corto o, si tu puesto no tiene menú corto, los módulos donde tu rol registra o aprueba. Lo informativo nunca es importante.
- **La campana** muestra cuántas importantes tienes sin leer.
- **El panel** tiene dos pestañas:
  - **Importantes:** las sin leer primero, lo rojo antes que lo ámbar, agrupadas por módulo. Si no hay ninguna dice «Nada urgente para ti. Revisa «Todas» si quieres ver el resto.».
  - **Todas:** como antes, de la más nueva a la más antigua.

  El punto de cada notificación sin leer va en rojo o ámbar según su color.
- No se ocultó ninguna notificación de «Todas». Algunas personales, como «Celular aprobado», son de módulos que esa persona no tiene, y se perderían.

## API
`GET /me/notifications/summary?dia=CRM,PED` (códigos de módulo, validados) devuelve además `importantes` (cuántas sin leer) y `latest_importantes`. Sin `dia`, usa los módulos donde el rol registra o aprueba.

## Pruebas
`CuentaTest::test_la_campana_cuenta_solo_las_importantes_para_el_puesto`.

# Notificaciones de rol, leídas por persona (11/11/2026)

- Una notificación dirigida a un rol, como «Vender primero» para las vendedoras, ahora la marca como leída **cada persona por su cuenta**. Antes, la primera persona del rol que la leía la dejaba leída para todas.
- Tabla `notification_reads` (empresa, notificación, persona, cuándo). RLS por empresa. La app solo inserta, una vez por persona y notificación. Migración `2026_11_11_000500_int_notificaciones_leidas_por_persona`.
- Las personales siguen usando su `read_at`. Las de rol que ya estaban marcadas como leídas vuelven a quedar sin leer para cada persona, porque no se sabe quién de verdad las leyó.
- Prueba: `CuentaTest::test_una_notificacion_del_rol_se_lee_por_persona`.
