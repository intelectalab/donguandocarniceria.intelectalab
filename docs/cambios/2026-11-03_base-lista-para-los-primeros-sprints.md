# 03/11/2026 · Base de datos lista para los primeros sprints

## Qué faltaba
Las tablas de las fases 0 y 1 existían, pero:
- no existían las de **Calidad, Recetas y Equipos** (fase 2), que el plan por objetivos adelanta a S02, S03 y S05;
- las tablas de operación estaban **vacías** (productos, clientes, stock, pedidos, comprobantes, cobros…). El plan para no bloquearse cuenta con trabajar contra tablas con datos de demo.

## Qué se hizo
1. **Tablas de CAL, REC y EQU** (23 tablas), con RLS y bitácora. Lo que apunta a Producción y Compras (aún no existen) queda como columna opcional sin FK.
2. **Datos de demo de todas las tablas:** 48 444 filas en 201 tablas para DG y CS, desde el prototipo. El seeder trabaja en dos pasadas y, al terminar, la revisión de las 800 FK da 0 referencias rotas.
3. **Correcciones al esquema generado,** encontradas al sembrar:
   - 35 columnas `*_id` internas que habían salido como texto pasan a uuid con FK;
   - los textos pasan de su largo justo (20, 40…) a 255;
   - la cuenta de anuncios sin conector y la grabación sin audio pasan a ser válidas.
4. **El generador** incorpora esas correcciones para las fases siguientes (`--ya` y `--columnas-futuras`).
5. **La política de contraseñas** ignora un hash heredado que no pueda leer, en lugar de fallar.

## Defectos encontrados en los datos del prototipo
- 3 870 fechas mal formadas: `10:08:00:00`, `09:110:00` y horas «NaN».
- Un id de precio repetido y un usuario repetido.
- Límites de descuento con el código del rol en vez de su id.
- Cuentas de anuncios con un conector que no existe.
- Grabaciones de llamadas sin su archivo.

El seeder los corrige y avisa. Se pierden 34 filas de 47 590, que apuntan a pedidos o productos inexistentes.

## Verificado
- `php artisan test`: 18 pasan (las pruebas siembran la base completa en `aycha_test`).
- `rls_gaps` vacío.
- La app ingresa y muestra datos con la base nueva.

## Para el equipo
Cada persona debe volver a migrar y sembrar su base local (borra los datos locales):
```bash
php artisan migrate:fresh --database=pgsql_owner --seed
```
