# 03/11/2026 · Menú e inicio en el orden del prototipo

## Qué estaba mal
El menú agrupaba los módulos por el campo `group` de cada módulo del prototipo: 13 grupos ordenados por fase y por nombre. Pero el prototipo **no** arma su menú así. Lo arma con `G.GROUPS` (`aycha-proto/src/js/04-shell.js`): 10 grupos en un orden fijo, con un encabezado por fase y los módulos en el orden de su lista. Además, mostraba módulos que el prototipo oculta.

## Qué se cambió
- **Estructura del prototipo:** `apps/web/src/lib/menu-prototipo.json` es una copia literal de `G.GROUPS` y `G.SCREEN_ONLY`. **No se reordena a mano.**
- **Regla de visibilidad:** `menuDe()` en `src/lib/modulos.ts` aplica la regla del prototipo. Un módulo sale si el rol tiene la letra L o C (`G.canSee`) y al menos una pantalla visible (`G.screenVisible`):
  - `G.SCREEN_ONLY` limita qué pantallas ve la vendedora y el repartidor;
  - el cliente B2B solo ve las pantallas marcadas para él;
  - las pantallas con roles declarados solo las ven esos roles, además de la gerencia y el auditor.
- **Sidebar:** los grupos en el orden del prototipo y, dentro, los módulos en orden.
- **Inicio:** una sección por grupo, en el mismo orden del menú, con cuántas pantallas ve el rol.
- **Ficha del módulo:** lista solo las pantallas que el rol ve en el prototipo.
- **Abrir un módulo por su dirección:** si no está en el menú del rol, el armazón muestra «sin permiso».
- **API (`/me`):** usa la regla L o C para decidir qué módulos ve cada rol.

## Pantallas en el menú (tercer nivel)
Como en el prototipo, cada módulo se despliega y muestra las pantallas que ve el rol. Cada pantalla tiene su dirección con su código (`/m/ped/ped-02`):
- **Mientras no exista,** la dirección muestra la ficha de la pantalla: código, nombre, descripción de la spec, roles, dónde crearla, y la anterior y la siguiente.
- **Cabecera:** migas empresa · grupo · módulo, y el título de la pantalla.
- **Buscador (Ctrl K):** encuentra pantallas por nombre o código.
- **Modo íconos:** el panel flotante despliega los módulos con sus pantallas.
- **Inicio:** cada tarjeta abre la primera pantalla del módulo, como el prototipo.
- **Pantalla que el rol no ve,** abierta por su dirección: muestra «sin permiso». Probado con la vendedora: en Cajas ve CAJ-02, 03, 05 y 11, y CAJ-01 le sale bloqueada.

## Verificación
Se ingresó por la API con un usuario de cada uno de los 22 roles:
- **Menú:** los 22 tienen exactamente el mismo que el prototipo (grupos, módulos y orden).
- **Pantallas visibles por rol:** coinciden con el recorrido por roles del prototipo. Por ejemplo, vendedora 101, cajero 102, almacenero 112, repartidor 7, cliente B2B 6 y administración 449.

## Pendiente
- Segundo factor: queda pendiente por decisión del equipo.

## Sin fases en la interfaz
Las fases (F0 a F4 y sus nombres) son la planificación de la entrega del prototipo, no algo que vea el usuario. Se quitaron del menú, del inicio y de las fichas. El orden de los grupos se mantiene.

## Fuentes
El `body` y los títulos usaban `var(--font-sans)` y `var(--font-display)`. Con `@theme inline` de Tailwind 4, esas variables no existen en CSS, así que se veía la fuente del sistema y el navegador avisaba de fuentes precargadas sin uso. Ahora usan directamente las variables de next/font: se ven Source Sans 3 y Archivo, como en el prototipo.
