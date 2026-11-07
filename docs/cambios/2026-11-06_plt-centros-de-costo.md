# 06/11/2026 · PLT-07 Centros de costo

## Pantalla
- Cifras de cabecera: centros (y activos), áreas con centros, nivel máximo frente al límite (`plt_cost_center_max_depth`, 4 por defecto) y centros por marca.
- Árbol por área (producción, calidad, almacén, delivery, ventas, marketing, administración, finanzas y RR. HH.), con su local y marca. Se abre un centro para editarlo y «+ hijo» crea uno debajo.
- Tabla con búsqueda, filtros por área y estado, nivel y de quién depende. Se marcan varios para activarlos o desactivarlos.
- Crear y editar (permiso `plt.cost_center.manage`: gerencia, sistemas y administración): código de 2 a 12 letras, números o guiones, único; nombre; de quién depende; área; local y marca opcionales de la misma empresa; estado.

## Reglas (RN-PLT-21)
- Hasta 4 niveles, contando los centros que ya tiene debajo el que se mueve.
- Sin ciclos: un centro no puede depender de sí mismo ni de uno que está debajo de él.
- Un hijo tiene la misma empresa y área que su padre. Si un centro cambia de área, sus centros de abajo también. *Decisión de construcción: el prototipo solo proponía el área del padre, pero un hijo de otra área no aparecería en el árbol.*
- No se borran: se desactivan. Un centro inactivo no admite gastos ni costos nuevos; lo ya imputado no cambia.

## Para los demás módulos
`App\Modulos\Plt\Services\CentrosCosto::activo($id)`: antes de imputar un gasto, planilla, equipo o mantenimiento. Falla con RN-PLT-21 si el centro está inactivo.

## API
`GET /v1/plt/centros-costo` (tabla), `GET /v1/plt/centros-costo/arbol` (todos, con cifras), `GET /v1/plt/centros-costo/{id}`, `POST /v1/plt/centros-costo`, `PUT /v1/plt/centros-costo/{id}`, `PUT /v1/plt/centros-costo/estado`.

## Pruebas
`tests/Feature/Modulos/PltCentrosCostoTest.php`: árbol con niveles y cifras, hijo que toma el área del padre, código único y con formato, límite de 4 niveles, ciclos, desactivar varios, centro inactivo sin gastos nuevos y permisos. 53 pruebas en total.

## Desplegables con buscador
`Select` (components/ui/Field.tsx) muestra un buscador cuando tiene más de 10 opciones: escribir filtra sin distinguir mayúsculas ni tildes, se elige con el ratón o con flechas y Enter, y Escape cierra solo la lista (no el formulario). La lista se dibuja sobre la página para que un formulario no la recorte, y se abre hacia arriba si abajo no hay espacio. Las pantallas no cambian: `onChange` recibe `e.target.value` igual que antes. `searchable` lo fuerza (`true`) o lo quita (`false`).
