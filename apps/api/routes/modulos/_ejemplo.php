<?php

/*
| EJEMPLO, no se carga: routes/api.php ignora los archivos que empiezan con "_".
|
| Cada módulo crea su archivo aquí con su código en minúsculas: ped.php, alm.php, cal.php…
| Se carga solo dentro de tenant + auth:sanctum + usuario, así que cada ruta ya llega con la
| empresa fijada (RLS), el token validado y el usuario para la bitácora. Solo falta declarar
| quién puede usarla:
|   'modulo:PED'      leer (L), o con acción: C crear, E editar, A aprobar o anular
|   'permiso:x.y.z'   un permiso especial de la spec, además del acceso al módulo
|
| Las direcciones quedan como /api/v1/<prefijo>/...  →  GET /api/v1/ped/pedidos
| Para ver todas las rutas: php artisan route:list --path=v1/ped
*/

use App\Modulos\Ped\Http\Controllers\PedidoController;
use Illuminate\Support\Facades\Route;

Route::prefix('ped')->group(function () {
    Route::get('/pedidos', [PedidoController::class, 'index'])->middleware('modulo:PED');
    Route::get('/pedidos/{id}', [PedidoController::class, 'show'])->middleware('modulo:PED')->whereUuid('id');
    Route::post('/pedidos', [PedidoController::class, 'store'])->middleware('modulo:PED,C');
    Route::put('/pedidos/{id}', [PedidoController::class, 'update'])->middleware('modulo:PED,E')->whereUuid('id');
    Route::post('/pedidos/{id}/confirmar', [PedidoController::class, 'confirmar'])->middleware('modulo:PED,E')->whereUuid('id');
    Route::post('/pedidos/{id}/descuento/aprobar', [PedidoController::class, 'aprobarDescuento'])
        ->middleware(['modulo:PED,A', 'permiso:ped.discount.approve'])->whereUuid('id');
});
