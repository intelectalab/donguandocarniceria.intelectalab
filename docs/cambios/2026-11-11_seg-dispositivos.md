# SEG · Dispositivos de la app (11/11/2026)

SEG-13 Dispositivos de la app. Aprobar y revocar ya existían desde la ficha del usuario (SEG-09); esta pantalla los muestra para toda la empresa.

## API (`DispositivoController`)
- `GET /seg/dispositivos`: celulares de toda la empresa (como el prototipo, sin los equipos web, que no piden aprobación, D-SEG-03) con usuario, rol, plataforma, estado, quién y cuándo aprobó, motivo de revocación y último uso. Búsqueda, orden y filtros por estado y plataforma. Cifras: por aprobar, aprobados, revocados y si la aprobación está exigida (`seg_mobile_device_approval`).
- La ve quien tiene el módulo de Seguridad **o** el permiso `seg.device.approve` (el coordinador de delivery, que aprueba los celulares de los repartidores sin administrar usuarios).
- Aprobar ahora **avisa al dueño** del celular con una notificación («Celular aprobado»), como el prototipo.

## Web (`src/app/(sistema)/m/seg/seg-13`)
Cifras del prototipo, lista con búsqueda y filtros, el nombre del usuario lleva a su ficha, y por fila «Aprobar» (pendientes) y «Revocar» con motivo. Las columnas son las del prototipo, con «Aprobado por».

## Pendiente de decisión
**El coordinador de delivery no ve SEG-13 en el menú.** Tiene el permiso de aprobar celulares, pero ni la base ni el prototipo le dan acceso al módulo de Seguridad, y el menú muestra los módulos según ese acceso. La API ya lo deja ver la lista y aprobar. Para que llegue a la pantalla hay que darle lectura en Seguridad (SEG-11) y limitarlo a SEG-13 en el menú (`screenOnly`), o poner SEG-13 también en el menú de Delivery.

## Pruebas
- `tests/Feature/Modulos/SegDispositivosTest.php`, 2 pruebas: lista de celulares con cifras y filtros, y quién la ve (coordinador sí, cajero no).
- `SegUsuariosTest`: aprobar avisa al dueño.

## El coordinador de delivery desde su menú (11/11/2026)
- Quien tiene el permiso de aprobar celulares (`seg.device.approve`) pero no el módulo de Seguridad ve en su menú **solo** Seguridad → Dispositivos de la app. El resto del módulo no le sale, ni en el menú, ni en el inicio, ni en la lista del módulo.
- No se le dio acceso de lectura al módulo: con él, la API le dejaría consultar usuarios, roles y la política. La API sigue igual: Dispositivos pide el permiso, y lo demás de Seguridad responde 403 (`SegDispositivosTest`).
- En la web: `POR_PERMISO` en `lib/modulos.ts` (pantalla que se abre con un permiso sin el módulo). `menuDe` recibe los permisos de la persona, y las listas genéricas del módulo y de la pantalla usan `pantallasDelMenu`, las mismas pantallas del menú. Con el módulo de Seguridad apagado, el permiso no cuenta y la pantalla no sale.
