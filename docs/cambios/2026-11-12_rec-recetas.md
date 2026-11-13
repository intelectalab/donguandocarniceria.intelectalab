# REC · Recetas y formulación (12/11/2026)

Módulo REC completo: REC-01 a REC-10 con datos reales, sobre las tablas que ya existían (`2026_11_03_002800_rec_recetas.php`). Contrato publicado en [docs/contratos.md](../contratos.md) (sección REC).

## Base de datos
- **Migración `2026_11_12_000100_rec_restricciones_y_versiones_cerradas.php`:**
  - `recipe_ingredients.qty_kg` pasa a 4 decimales: el nitrito va en 0,0015 kg por lote (CA-REC-03). Con 3 decimales quedaba en 0,002 kg y la dosis subía de 145 a 193 ppm. `standard_cost_per_kg` también a 4 (CA-REC-06).
  - `CHECK` de estados, tipos, conservación, variables y equipos; kg y base positivos; mínimo ≤ máximo y acción correctiva escrita (RN-REC-12); aditivo con `additive_id` (RN-REC-04); límite positivo.
  - Únicos: código de receta y SIN por empresa; número de versión por receta; **una sola versión aprobada** (RN-REC-01) y una sola en curso por receta (índices parciales).
  - **RN-REC-03 en la base:** un disparador rechaza cambiar o borrar ingredientes, pasos y puntos de control de una versión aprobada o retirada, y cambiar su contenido. Insertar no se bloquea en la base (la siembra crea la versión aprobada antes que sus filas); eso lo valida el servicio.
  - Columnas nuevas `recalc_cost_per_kg` y `recalc_at` para el recálculo de REC-09 sin tocar el costo fijado al aprobar.
- Los datos de demo cumplen todas las restricciones: `migrate:fresh --seed` corre sin cambios en los seeders.

## API (`app/Modulos/Rec`, rutas en `routes/modulos/rec.php`, 35 rutas bajo `/api/v1/rec`)
- `RecetasService` con todas las reglas RN-REC-01 a 12. Controladores: `RecetaController`, `VersionController`, `DetalleController`, `AditivoController` y `CostoController`.
- Costos solo con `rec.cost.view`; la receta completa solo para quien la edita, la aprueba o ve su costo (D-REC-02).
- Eventos `recipe_version.submitted`, `recipe_version.approved` y `recipe.cost_variation`; avisos a Calidad, al autor y al jefe de producción.

## Web (`src/app/(sistema)/m/rec/rec-01` … `rec-10`, piezas en `src/modulos/rec`)
- REC-01: lista con cifras, filtros por tipo y versión vigente, ficha de la receta con sus versiones, **formulario de nueva receta** (crea la versión 1 y abre sus ingredientes) y edición de la receta.
- REC-02: editor de la versión con el rendimiento calculado mientras se escribe, empaques, enviar a revisión, nueva versión desde una cerrada, borrar borrador e historial.
- REC-03: ingredientes con % del total, dosis en ppm y aviso de límite en el formulario; al elegir un insumo que es aditivo del catálogo se marca solo.
- REC-04: catálogo de aditivos con su uso en recetas. REC-05: pasos con subir y bajar. REC-06: puntos de control y aviso de punto crítico faltante.
- REC-07: validaciones, comparación con la vigente, aprobar y devolver con comentario. REC-08: escalado con stock liberado. REC-09: costos y «Recalcular y avisar». REC-10: ficha técnica imprimible (Imprimir o PDF).
- Todas las pantallas de una versión comparten el selector y llevan la versión en `?v=`.
- Revisadas a 1440 px y 390 px sin desborde ni errores en la consola. Se creó una receta y se agregó un aditivo desde el formulario.

## Pruebas
- `tests/Feature/Modulos/RecTest.php`: 16 pruebas. CA-REC-01 a 06, RN-REC-04, 07, 08, 10, 11 y 12, nueva versión y devolución, orden de pasos, D-REC-02, costos con permiso y recálculo con aviso, aislamiento entre empresas y las pantallas con datos de demo.
- `php artisan test --testsuite=Feature`: todo en verde. `npm run typecheck` y `npm run lint` limpios.

## Decisiones para revisar
- **CONTADORA** tiene `rec.cost.view` pero no tiene el módulo REC en la matriz de accesos, así que hoy no entra a REC-09. No cambié la matriz.
- **Aprobar** pide la acción E del módulo (CALIDAD tiene `LE`, no `A`) además de `rec.version.approve`.
- **Operario (D-REC-02):** con solo leer el módulo ve el escalado, no la receta ni el costo.
- **Costo promedio vigente:** promedio ponderado de los saldos con stock de todos los almacenes; sin stock, el costo estándar de la variante.
- **KPI-REC-03** (lecturas fuera de rango) espera a PRO, que registrará las lecturas.
- **Ficha técnica:** se imprime o guarda en PDF desde el navegador (no hay librería de PDF en la API).
