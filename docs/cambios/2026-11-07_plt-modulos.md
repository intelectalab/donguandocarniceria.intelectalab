# 07/11/2026 · PLT-12 Módulos

## Pantalla
- Cifras: módulos del catálogo, encendidos, apagados (con sus códigos) y núcleo.
- Telefonía: lista de activación de 6 pasos con responsable, fecha y evidencia. Solo se enciende con los pasos 1 a 5 hechos (RN-TEL-02); el 6 se marca solo al encenderla. Con Telefonía encendida la lista no se deshace.
- Tabla: código, módulo, lo que necesita (en rojo si está apagado), quiénes lo necesitan, estado y el botón Encender o Apagar. El botón solo se habilita si el cambio se puede hacer, y dice por qué no cuando no.
- Ficha de cada módulo: lo que necesita, lo que aprovecha si está encendido, quiénes lo necesitan, último cambio con motivo y su historial de encendidos y apagados.
- Encender y apagar piden motivo y el permiso `plt.module.toggle` (gerencia y sistemas). Al cambiar un módulo, el menú se actualiza.

## Reglas (`App\Modulos\Plt\Services\Modulos`)
- El módulo está en el catálogo (RN-PLT-08). Los del núcleo (PLT, SEG, MAE, INT, AUD) no se apagan (RN-PLT-09).
- Encender exige que estén encendidos los que necesita (`platform_modules.depends_on`); apagar, que ningún encendido lo necesite (RN-PLT-10).
- OPS y SUS los maneja Intelectalab: aquí no se encienden ni apagan (ver `docs/pendientes.md`, punto 1).
- Cada cambio emite `module.enabled` o `module.disabled`.

## Un módulo apagado no concede permisos (RN-PLT-07)
`Access::can()` devuelve falso para un permiso de un módulo apagado, también para la gerencia, y `/v1/me` ya no manda el comodín `*`: manda la lista de permisos de los módulos encendidos. Por ejemplo, con Telefonía apagada nadie tiene `tel.call.make`.

## API
`GET /v1/plt/modulos`, `GET /v1/plt/modulos/{código}/eventos`, `PUT /v1/plt/modulos/{código}` (`enabled`, `reason`), `POST` y `DELETE /v1/plt/modulos/tel/pasos/{paso}`.

## Pendiente
Que lo que se puede encender dependa del plan de la empresa (SUS, fase 4).

## Pruebas
`tests/Feature/Modulos/PltModulosTest.php`: catálogo con su estado, núcleo y dependencias, módulos de la plataforma, permisos de un módulo apagado, lista de Telefonía y permisos. 63 pruebas en total.

## PLT-10: ficha del parámetro
La ficha muestra también el módulo y la descripción, como en el prototipo.
