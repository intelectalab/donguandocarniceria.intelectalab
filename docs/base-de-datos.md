# Base de datos · Aycha Don Guando

PostgreSQL 17 en Docker. Las migraciones son de Laravel 12 (`apps/api/database/migrations`). Se trabaja con RLS por tenant, un usuario que migra y otro con el que entra la app.

## Levantar la base

Requisitos: Docker Desktop abierto («Engine running»), PHP 8.4 con `pdo_pgsql` y Composer.

```bash
docker compose up -d postgres redis
```
```bash
docker compose ps
```
Los dos servicios deben aparecer como `healthy`.

```bash
cd apps/api
```
```bash
composer install
```
```bash
php artisan migrate --database=pgsql_owner --seed
```

`--seed` corre `PrototipoSeeder` con los datos del prototipo para **todas las tablas que existen**: unas 48 000 filas en 201 tablas, para las empresas de demo Don Guando (DG) y Carnes Selectas del Sur (CS). Incluye:
- catálogos globales (módulos, parámetros, catálogos SUNAT, ubigeo, bancos);
- empresa, locales, marcas, series, períodos, usuarios, roles y permisos;
- catálogo y precios, clientes con dirección y zonas, almacenes, lotes y stock;
- pedidos con sus líneas, preparación, reparto, comprobantes, cobros, gastos y caja;
- bandeja omnicanal, anuncios, telefonía, tablero, calidad, recetas y equipos.

Así, cada módulo encuentra datos reales desde el primer sprint, aunque el módulo vecino todavía no tenga pantallas.

- **Origen:** `database/seeders/data/prototipo.json.gz` (1,5 MB comprimido), extraído con `tools/prototipo/extraer_esquema.js`.
- **Ids estables:** los del prototipo pasan a uuid fijos, así que cada corrida da los mismos ids.
- **Dos pasadas:** primero se calculan todos los ids y después se insertan las filas sabiendo qué referencias existen. El orden entre tablas no importa y una referencia a algo que no existe queda vacía.
- **Sin bitácora ni FK durante la carga.** Después, una revisión de las 800 FK da **0 referencias rotas**.
- **No se siembran los secretos de la demo** (historial de contraseñas, códigos de recuperación y de respaldo, sesiones).
- **Contraseña:** la de los usuarios es `SEED_PASSWORD` del `.env`.

**Defectos de datos del prototipo que el seeder corrige y avisa:**
- un usuario repetido (`us-dflores`);
- un id de precio repetido;
- 3 870 fechas mal formadas (`10:08:00:00`, `09:110:00`, horas «NaN»);
- límites de descuento que guardan el código del rol en vez de su id.

Se pierden 34 filas de 47 590, que apuntan a pedidos o productos que el prototipo no tiene.

| Dato | Valor local |
|---|---|
| Host / puerto | `127.0.0.1:5433` (no el 5432 por defecto, para no chocar con otro PostgreSQL instalado) |
| Base | `aycha` (y `aycha_test` para `php artisan test`) |
| Dueño (solo para migrar) | `aycha_owner` / `aycha_owner_local` |
| App (respeta RLS) | `aycha_app` / `aycha_app_local` |
| Redis | `127.0.0.1:6380` |

Para empezar de cero, **esto borra todos los datos locales**:
```bash
docker compose down -v
```
```bash
docker compose up -d postgres redis
```
El script `infrastructure/postgres/init/01-roles.sh` vuelve a crear `aycha_app` cuando el volumen está vacío.

`php artisan migrate:fresh --database=pgsql_owner` borra las tablas de `public`, pero **no el esquema `audit`**: la bitácora de pruebas anteriores se conserva. Así se hizo a propósito, para que ninguna migración pueda borrar la bitácora. Para empezar de cero también en la bitácora, usa `docker compose down -v` o `php artisan migrate:reset --database=pgsql_owner`.

Estado verificado el 03/11/2026:
- 189 tablas, ninguna en `rls_gaps`, 662 FK y 141 tablas conectadas a la bitácora.
- Con dos empresas, cada una solo ve y modifica lo suyo; escribir con el tenant de otra la rechaza RLS.
- La app no puede borrar la bitácora, cambiar tablas de solo inserción, escribir en catálogos globales ni crear tablas.
- `migrate:reset` deshace las 26 migraciones sin errores.

## Cómo está armado

- **Migración base** (`2026_11_03_000000_base_aycha.php`):
  - extensiones `pgcrypto`, `citext` y `btree_gist`;
  - funciones `app_tenant_id()` y `app_user_id()`, que leen el contexto de la sesión;
  - `enable_tenant_rls(tabla)`, que activa la política `tenant_isolation`;
  - la vista `rls_gaps`, que debe volver vacía;
  - permisos por defecto para `aycha_app`.
- **Una migración por módulo** para las fases 0 y 1 (`..._plt_plataforma.php` … `..._tab_tablero.php`), más `..._relaciones_entre_modulos.php` con las FK cuyo destino se crea después.
- **`..._eventos_y_bitacora_de_cambios.php`**:
  - `domain_events`, de solo inserción;
  - `audit.change_log`, que llena un trigger, enmascara datos sensibles y no se puede modificar;
  - `audit.track(tabla)`, que conecta una tabla a la bitácora.
- **`..._seg_tokens_y_acceso_por_modulo.php`**:
  - `personal_access_tokens` (Sanctum) con RLS: un token solo sirve dentro de su empresa;
  - `role_module_access`: la matriz C/L/E/A de cada rol por módulo (`G.ACCESS` del prototipo).
- **La app debe fijar el contexto en cada petición.** El middleware `tenant` de la API ya lo hace. Sin él no ve ninguna fila:
  ```sql
  SELECT set_config('app.tenant_id', '<uuid del tenant>', true), set_config('app.user_id', '<uuid del usuario>', true);
  ```
- Las tablas de **solo inserción** según la spec (historiales, bitácoras, movimientos) no admiten `UPDATE` ni `DELETE` de `aycha_app`. Los catálogos de plataforma (`platform_modules`, `ubigeo`, `sunat_catalog_items`…) son de solo lectura para la app.

### De dónde salen las tablas

Las generó `tools/prototipo/generar_migraciones.py` a partir del modelo de datos del prototipo (`tools/prototipo/schema-prototipo.json`) y de `aycha-proto/dist/tablas.md`:

- Los ids pasan a `uuid`. Cada tabla de negocio lleva `tenant_id` con RLS.
- Las relaciones se detectaron por los valores reales del prototipo.
- Las listas embebidas pasan a tablas hijas: `sales_order_lines`, `sales_document_lines` y `payment_allocations`.
- Los estados quedan como comentario de la columna, con los valores que usa el prototipo.
- Las columnas que apuntan a tablas de las fases 2 a 4 (cupones, producción, consignación, API…) **no se crearon**. Las agrega cada módulo cuando llegue su fase.

**Son un punto de partida.** Antes de construir sus pantallas, el dueño de cada módulo revisa sus tablas y corrige con una migración nueva:

- tipos y largos;
- únicos;
- `CHECK` de estados;
- columnas que eran artefactos de la demo (por ejemplo, `balance_decided_by_name`).

## Agregar migraciones

1. Crea el archivo con el código del módulo al inicio del nombre:
   ```bash
   php artisan make:migration ped_agregar_motivo_de_reprogramacion
   ```
2. **Nunca edites una migración que ya se corrió** en la base de otra persona. Los cambios van siempre en una migración nueva.
3. Toca **solo las tablas de tu módulo**. Si necesitas una columna en una tabla ajena, pídesela a su dueño (reparto en `docs/revision-del-prototipo.md`, sección 8).
4. Una tabla nueva con datos de una empresa sigue este molde:
   ```php
   Schema::create('order_notes', function (Blueprint $table) {
       $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
       $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
       $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
       // … columnas
       $table->timestampTz('created_at')->useCurrent();
       $table->timestampTz('updated_at')->nullable();
       $table->index('tenant_id');
   });
   DB::statement("SELECT enable_tenant_rls('order_notes')");
   DB::statement("SELECT audit.track('order_notes')");
   // si es de solo inserción:
   DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON order_notes FROM aycha_app');
   ```
5. Corre la migración con el dueño y comprueba que no quede ninguna tabla sin RLS:
   ```bash
   php artisan migrate --database=pgsql_owner
   ```
   ```sql
   SELECT * FROM rls_gaps;
   ```

### Generar el punto de partida de las fases 2 a 4

El mismo generador sirve para las tablas de los módulos siguientes (por ejemplo, COM, PRO y CAL de la fase 2):
```bash
python -I tools/prototipo/generar_migraciones.py --modulos COM,GRJ,PRO,REC,DES,CAL,EQU,ETQ,CNT --prefijo 2026_12_01 --desde 100 --salida <carpeta temporal>
```
Genéralo en una carpeta aparte, revisa el resultado y pasa a `database/migrations` solo lo que corresponde.

Ojo: el generador vuelve a crear las tablas que ya existen si su módulo está en la lista. Hay que quitar a mano las que ya están creadas y las columnas que se agregan con `ALTER`.

## Correcciones al esquema generado (03/11/2026)
- `..._ids_internos_como_uuid.php`: 35 columnas `*_id` internas habían salido como texto (`customers.price_list_id`, `vehicles.driver_user_id`, los `route_id`, los `*_file_id`…). Pasan a uuid con FK. Las que guardan ids de sistemas externos (WhatsApp, WooCommerce, Mercado Pago, proveedor de telefonía) siguen siendo texto.
- `..._textos_con_largo_holgado.php`: las columnas de texto tenían el largo justo de los datos de demo (20, 40…). Pasan a 255.
- `..._relaciones_opcionales.php`: la cuenta de anuncios sin conector y la grabación sin audio (purgado) son válidas.
- Tablas de **CAL, REC y EQU** (fase 2), que el plan por objetivos adelanta a S02, S03 y S05. Lo que apunta a Producción o Compras (aún no existen) queda como columna opcional sin FK, con un comentario; su dueño agrega la FK al crear ese módulo.

El generador ya incluye estas correcciones: deduce la tabla de un `*_id` por su nombre, usa 255 en los textos, y acepta `--ya` (módulos ya migrados) y `--columnas-futuras`. Ejemplo para los módulos de producción:
```bash
python -I tools/prototipo/generar_migraciones.py --modulos PRO,DES,ETQ --ya PLT,SEG,MAE,INT,AUD,NUC,CAT,CLI,PED,POS,ALM,PRE,DEL,FAC,CAJ,GAS,WEB,CRM,ADS,TEL,TAB,CAL,REC,EQU --columnas-futuras --prefijo AAAA_MM_DD --desde 100 --salida <carpeta temporal>
```

## Pendiente
- **Funciones de negocio de la spec** (`alm_inventory_move`, `ped_missing_fields`, `fac_assert_ready`…): se deciden con el dueño de cada módulo, como servicio de Laravel o como función SQL.
- **Restricciones de la spec**: `stock_balances` no negativo, reservado ≤ saldo, vigencias de precios sin superponerse (`btree_gist`), una dirección predeterminada por cliente.
- **FK que aseguren el mismo tenant** entre tablas (RN-PLT-02).
- **Semillas** (`database/seeders`) con las dos empresas de demo.
