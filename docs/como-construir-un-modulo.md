# Cómo construir un módulo

La base ya está lista: empresa del usuario (o por dominio, con `TENANT_POR_DOMINIO=true`), ingreso, permisos, alcance por marca y local, RLS, bitácora, eventos, menú y tema. Cada módulo se construye **encima**, sin tocar la base.

Antes de empezar un módulo:
1. Lee su ficha en la web (`/m/<codigo>`): objetivo y pantallas de la spec. La spec completa está en `aycha-proto/dist/spec.json` y se ve funcionando en el prototipo.
2. Revisa sus tablas: ya existen para las fases 0 y 1 (`apps/api/database/migrations/2026_11_03_*_<codigo>_*.php`). Corrige con migraciones nuevas lo que haga falta (ver [base-de-datos.md](base-de-datos.md)).
3. Confirma quién es el dueño en el reparto ([revision-del-prototipo.md](revision-del-prototipo.md), sección 8). Solo el dueño escribe en las tablas del módulo; los demás usan sus servicios.

## API (apps/api)

### Dónde va cada cosa
```
app/Modulos/Ped/
  Models/SalesOrder.php          extends App\Models\Model (uuid; tenant_id lo pone la base)
  Services/PedidoService.php     reglas y transacciones: lo que otros módulos llaman
  Http/Controllers/PedidoController.php
routes/modulos/ped.php           se carga solo, dentro de tenant + auth + usuario
tests/Feature/Modulos/PedTest.php
```

### Rutas
El archivo `routes/modulos/ped.php` se carga solo. Cada ruta declara su módulo y acción (C crear, L leer, E editar, A aprobar o anular) o un permiso especial de la spec:

```php
<?php

use App\Modulos\Ped\Http\Controllers\PedidoController;
use Illuminate\Support\Facades\Route;

Route::prefix('ped')->group(function () {
    Route::get('/pedidos', [PedidoController::class, 'index'])->middleware('modulo:PED');
    Route::post('/pedidos', [PedidoController::class, 'store'])->middleware('modulo:PED,C');
    Route::post('/pedidos/{id}/confirmar', [PedidoController::class, 'confirmar'])->middleware('modulo:PED,E');
    Route::post('/pedidos/{id}/descuento/aprobar', [PedidoController::class, 'aprobarDescuento'])
        ->middleware(['modulo:PED,A', 'permiso:ped.discount.approve']);
});
```
Con un módulo apagado para la empresa, `modulo:` responde `RN-PLT-07`, aunque el rol tenga acceso.

### Lo que ya tienes

| Pieza | Para qué |
|---|---|
| RLS + `TenantContext` | Cada consulta ya viene filtrada por empresa. **No filtres por `tenant_id` a mano** y nunca lo recibas del cliente. |
| `Access::for($user)` | Marcas y locales del usuario (`brands`, `establishments`; vacío = todas). Filtra tus listas con ellos: la vendedora solo ve sus marcas. |
| `Access::can($user, 'ped.discount.approve')` | Permiso especial dentro de una acción. |
| `RuleError::fail('RN-PED-01', 'faltan: dirección con pin, franja.')` | Regla que bloquea. La API responde 422 con `code` = la regla, y el mensaje empieza con su código. |
| `Params::get('ped_weight_tolerance_pct', ['brand' => $id])` | Parámetros de la spec: primero los de la empresa, si no, el valor por defecto. |
| `Events::emit('order.confirmed', 'sales_orders', $id, [...])` | Eventos entre módulos (nombres de la spec). |
| `Listado::de($query, $request, buscar: [...], ordenar: [...])` | Listas paginadas con búsqueda (`?q=`, sin mayúsculas ni tildes), orden (`?sort=campo` o `-campo`, solo columnas permitidas) y páginas (`?page=`, `?per_page=` hasta 100). Es lo que espera `useListado` en la web. |
| Bitácora | Automática: cada cambio queda en `audit.change_log` con el usuario. |
| `DB::transaction(...)` | Todo cambio de varias tablas va en una transacción; el evento también. |

**Quien pide no aprueba:** compara `$request->user()->id` con el solicitante antes de aprobar.

**Fechas y montos:** zona `America/Lima`. Montos en `decimal` y calculados en la API, nunca en el navegador. IGV 18 % (los precios incluyen IGV).

**Ejemplo completo:** PLT-03 Empresas y PLT-04 Locales (`app/Modulos/Plt/`, `routes/modulos/plt.php`, `tests/Feature/Modulos/PltTest.php`).

### Pruebas
Una prueba por cada criterio `CA-…` de la spec, con los números del criterio, en `tests/Feature/Modulos/<Codigo>Test.php`. `Tests\TestCase` ya prepara la base con las dos empresas de demo y deshace cada prueba al terminar. Para entrar como un rol:

```php
$token = $this->ingresar(self::DG, 'ana.torres@donguando.pe');
$this->desde(self::DG, $token)->postJson('/api/v1/ped/pedidos', [...])->assertCreated();
```

## Web (apps/web)

### Dónde va cada cosa
```
src/app/(sistema)/m/ped/ped-01/page.tsx          pantalla PED-01 (lista de pedidos)
src/app/(sistema)/m/ped/ped-02/page.tsx          pantalla PED-02 (nuevo pedido)
src/app/(sistema)/m/ped/ped-03/[id]/page.tsx     una pantalla con parámetro (detalle del pedido)
src/modulos/ped/                                 componentes y tipos propios del módulo
```
- **Cada pantalla de la spec tiene su dirección,** con su código: `/m/ped/ped-02`. El menú (grupo → módulo → pantallas) ya apunta a todas. Mientras una pantalla no exista, esa dirección muestra su ficha (`m/[codigo]/[pantalla]`). Al crear `m/ped/ped-02/page.tsx`, la ruta fija tiene prioridad y la pantalla real reemplaza la ficha, sin tocar el menú.
- **El orden y la visibilidad del menú** están en `src/lib/menu.json` (los grupos en su orden y las pantallas restringidas por rol); la regla está en `menuDe` de `src/lib/modulos.ts`. No los cambies a mano. El armazón no monta una pantalla que el rol no ve.

### Lo que ya tienes
```tsx
"use client";
import { api, ApiError } from "@/lib/api";
import { useSesion } from "@/lib/sesion";

export default function Pedidos() {
  const { me, marca, local, puede, can } = useSesion();
  // marca / local: selector superior ('ALL' o el id). Envíalos como filtro a la API.
  // puede('PED', 'C') para mostrar «Nuevo pedido»; can('ped.discount.approve') para «Aprobar».
  // api<T>('/v1/ped/pedidos?brand=' + marca) envía el token (que dice la empresa); un 401 vuelve al ingreso.
  // Un ApiError trae code (RN-PED-06, PERMISSION_DENIED…): muéstralo tal cual al usuario.
}
```
### Componentes compartidos
Todas las pantallas usan los mismos, de `@/components/ui`. Se ven funcionando en **/componentes** (solo en desarrollo). No hagas tablas, ventanas ni botones propios: si falta algo, se agrega aquí para todos.

| Componente | Para qué |
|---|---|
| `DataTable` + `useListado` | Lista con búsqueda, orden, páginas, carga, error y vacío. `useListado` habla con `Listado` de la API: `<DataTable {...lista.tabla} columns={columnas} />` |
| `Field` + `Input`, `Select`, `Textarea`, `Checkbox`, `Switch` | Campos de formulario con etiqueta, ayuda y error. Los errores de la API por campo salen de `erroresDe(err)` |
| `Modal` | Panel que entra por la derecha para crear o editar (`placement="center"` para un diálogo corto); se monta solo mientras está abierto |
| `confirmAction` | Confirmar antes de una acción, con motivo opcional (`reason: { min: 10 }`) para las reglas que lo piden |
| `toast` | Aviso flotante: `toast.ok("Guardado")`, `toast.error(mensajeDe(err))` |
| `MapPicker` | Mapa (OpenStreetMap) para fijar una ubicación con un pin, con otros puntos de referencia. Sirve para locales, direcciones de clientes y reparto |
| `MapView` | Mapa de solo lectura con varios pines etiquetados; un clic en un pin lo abre |
| `Button`, `IconButton` | Botones (`primary`, `secondary`, `ghost`, `danger`), con `loading` |
| `PageHeader`, `Tabs`, `Alert`, `Badge`, `StatusBadge`, `DetailList` | Inicio de la pantalla, pestañas, mensajes, etiquetas de estado y fichas de solo lectura |

Para mostrar datos, `@/lib/formato`: `soles()`, `kg()`, `numero()`, `porcentaje()`, `fecha()` y `fechaHora()` (en hora de Lima). Ejemplo completo de pantallas: `m/plt/plt-03` (tarjetas) y `m/plt/plt-04` (tabla con filtros y formulario), con sus piezas en `src/modulos/plt/`.

- **El armazón ya pone** la cabecera (título y migas del módulo), el menú y el control de acceso: si el rol no tiene el módulo o está apagado, tu pantalla no se monta. Empieza la pantalla con su contenido (`h2` para títulos de sección; el `h1` es de la cabecera).
- **Colores:** solo las clases del tema (`bg-surface`, `text-muted`, `bg-primary`, `text-bad`, `bg-ok-soft`…), definidas en `src/app/globals.css`. Nunca colores fijos: el modo oscuro sale solo.
- **Botones sin permiso:** ocúltalos o desactívalos con `puede` / `can`. La API igual los valida.
- **Celular:** cada pantalla debe funcionar a 390 px. Las apps del repartidor, el preparador y el operario son pantallas de celular primero.
- **Next.js 16** cambió APIs: lee `apps/web/AGENTS.md` y la guía en `node_modules/next/dist/docs/` antes de usar algo que no conozcas. Por ejemplo, `params` es una Promise y el middleware se llama `proxy.ts`.

Antes de entregar:
```bash
npm run typecheck
```
```bash
npm run lint
```

## Al terminar una tanda
- Corre `php artisan test` y los chequeos de la web.
- Escribe qué cambió en `docs/cambios/AAAA-MM-DD_<codigo>-<tema>.md`.
- Una rama por tarea y un PR revisado por otra persona del equipo.
