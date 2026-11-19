# Catálogos globales: cómo se actualizan

Tres tablas son **de toda la plataforma**, iguales para todas las empresas, y no de una empresa en particular:

| Tabla | Qué guarda | Quién la define | Pantalla de consulta |
|---|---|---|---|
| `sunat_catalog_items` | Catálogos de la facturación electrónica: tipo de documento (01), unidad de medida (03), documento de identidad (06), afectación del IGV (07), notas (09 y 10), documentos relacionados (12), transporte (18) y motivo de traslado (20) | SUNAT | MAE-07 |
| `ubigeo` | Departamento, provincia y distrito con su código INEI | INEI | MAE-08 |
| `financial_institutions` | Bancos, billeteras, adquirentes, pasarelas y cajas municipales | Intelectalab | MAE-09 |

Las empresas **solo las consultan** (RN-MAE-11). La aplicación tiene permiso `SELECT` y nada más sobre esas tablas, así que ningún usuario de una empresa puede cambiarlas, ni con un error de permisos en la API. Las actualiza **Intelectalab** con el comando de abajo, que escribe con la conexión del dueño de la base (`pgsql_owner`).

¿Cuándo? Pocas veces al año: cuando SUNAT publica un cambio en un catálogo (un código nuevo, o uno que se da de baja con fecha), cuando el INEI cambia el ubigeo o cuando se suma una entidad financiera.

## El comando

```bash
php artisan mae:importar-global {tabla} {archivo} [--probar]
```

- `tabla`: `sunat`, `ubigeo` o `entidades`.
- `archivo`: un texto con una fila por línea y los campos separados por punto y coma (`;`), en UTF-8. Máximo 5 MB.
- `--probar`: solo revisa el archivo y dice cuántas filas son válidas, **sin grabar**. Conviene correrlo siempre antes.

Si una línea tiene un error, el comando se detiene, dice el número de línea y **no graba nada**. Si todo está bien, graba todo junto: las filas nuevas se agregan y las que ya existían se actualizan (por catálogo y código, por ubigeo o por código de entidad). Nunca borra filas: un código de SUNAT dado de baja se carga con su fecha «hasta» y deja de estar vigente desde ese día.

### Formato de cada archivo

**sunat**: `catálogo;código;descripción;vigente desde;vigente hasta`

```
20;19;Traslado a zona primaria;2016-01-01;2022-06-30
03;TNE;Tonelada;2016-01-01;
```

Las fechas van como AAAA-MM-DD; «vigente hasta» vacío quiere decir sin fin. El catálogo se completa con cero a la izquierda (`3` → `03`).

**ubigeo**: `ubigeo;departamento;provincia;distrito` (un distrito por línea, 6 dígitos)

```
040701;Arequipa;Islay;Mollendo
040702;Arequipa;Islay;Cocachacra
```

**entidades**: `código;nombre;tipo;RUC;código CCI`

```
BCP;Banco de Crédito del Perú;BANK;20100047218;002
CULQI;Culqi;GATEWAY;;
```

El tipo es `BANK`, `WALLET`, `ACQUIRER`, `GATEWAY` o `CAJA`. El RUC, si va, tiene 11 dígitos. El código va en mayúsculas.

## Paso a paso

**En una computadora del equipo** (desde `apps/api`):

```bash
php artisan mae:importar-global sunat ruta/al/archivo.txt --probar
```

```bash
php artisan mae:importar-global sunat ruta/al/archivo.txt
```

**En el servidor** (`ssh cubo`, en `/var/www/aycha/apps/api`): subir el archivo al servidor, sacar un respaldo con `bash /var/www/aycha/infrastructure/deploy/backup.sh catalogos` (queda en `/root/backups/aycha`), y correr el mismo comando, primero con `--probar`. Como las tablas son de todas las empresas, el cambio se ve de inmediato en todas.

Después, abrir MAE-07, MAE-08 o MAE-09 y revisar que aparezca lo cargado.

## Desde la consola (hecho el 19/11/2026)

La consola de Intelectalab tiene la pantalla **Catálogos globales** (`/consola/catalogos`, solo para el administrador de plataforma, con segundo factor):

1. Se elige el catálogo y se sube el archivo con los mismos formatos de arriba (`.txt` o `.csv`, hasta 5 MB).
2. **«Revisar sin grabar»** muestra las filas nuevas, las que cambian (con ejemplos de antes y después), las que quedan igual y los errores por línea.
3. Solo con el archivo sin errores se importa, con motivo. Graba con la conexión del dueño de la base y queda en la bitácora de la consola (quién, cuándo, cuántas filas, nombre y huella del archivo).

El comando `mae:importar-global` sigue funcionando y usa la misma lógica (`App\Modulos\Mae\Services\CatalogosGlobales`).

## Lo que se pedía antes (ya resuelto)

Hoy la actualización se hace con este comando porque **todavía no existe la consola de la plataforma** (módulo OPS, de Intelectalab). El prototipo la ponía como un botón «Importar catálogo», «Importar archivo INEI» dentro de MAE-07 y MAE-08, visible solo para el operador de la plataforma (`mae.catalog.import`).

En el sistema real ese botón **no va dentro del sistema de la empresa**: si viviera ahí, un error de permisos dejaría a una empresa cambiar lo de todas. Cuando se construya la consola de Intelectalab (ver [pendientes.md](pendientes.md), sección 1), debe tener una pantalla de **importación de catálogos globales** que:

1. Acepte el archivo (o Excel con la plantilla de `App\Support\Importar`) para SUNAT, ubigeo y entidades, con los mismos formatos de arriba.
2. Muestre una vista previa con las filas nuevas, las que cambian y los errores por línea antes de grabar, como hace hoy `--probar`.
3. Grabe con una conexión separada de la de las empresas, solo para usuarios de la plataforma con segundo factor, y deje registro de quién importó qué y cuándo.
4. Reutilice la lógica del comando (`App\Console\Commands\MaeImportarGlobal`), moviéndola a un servicio para que el comando y la pantalla hagan lo mismo.
