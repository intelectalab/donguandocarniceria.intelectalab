<?php

use App\Modulos\Ped\Http\Controllers\AccionController;
use App\Modulos\Ped\Http\Controllers\CatalogoController;
use App\Modulos\Ped\Http\Controllers\ClienteController;
use App\Modulos\Ped\Http\Controllers\DescuentoController;
use App\Modulos\Ped\Http\Controllers\FranjaController;
use App\Modulos\Ped\Http\Controllers\PedidoController;
use App\Modulos\Ped\Http\Controllers\PesoController;
use App\Modulos\Ped\Http\Controllers\ProductoController;
use App\Modulos\Ped\Http\Controllers\ProvinciaController;
use App\Modulos\Ped\Http\Controllers\TableroController;
use Illuminate\Support\Facades\Route;

// PED · Pedidos de todos los canales (PED-01 a PED-14). Reglas en app/Modulos/Ped/Services.
Route::prefix('ped')->group(function () {
    $crear = 'permiso:ped.order.create';

    // PED-01 Pedidos y PED-03 Detalle
    Route::get('/pedidos', [PedidoController::class, 'index'])->middleware('modulo:PED');
    Route::get('/pedidos/resumen', [PedidoController::class, 'resumen'])->middleware('modulo:PED');
    Route::get('/pedidos/exportar', [PedidoController::class, 'exportar'])->middleware(['modulo:PED', 'throttle:10,1']);
    Route::get('/pedidos/{id}', [PedidoController::class, 'show'])->middleware('modulo:PED')->whereUuid('id');

    // PED-02 Nuevo pedido (borrador) y sus ayudas: cliente, dirección, franjas, límite de descuento
    Route::post('/pedidos', [PedidoController::class, 'store'])->middleware(['modulo:PED,C', $crear]);
    Route::put('/pedidos/{id}', [PedidoController::class, 'update'])->middleware(['modulo:PED,E', $crear])->whereUuid('id');
    Route::get('/pedidos/{id}/faltantes', [AccionController::class, 'faltantes'])->middleware('modulo:PED')->whereUuid('id');
    Route::get('/opciones', fn () => response()->json(PedidoController::opciones()))->middleware('modulo:PED');
    Route::get('/clientes/buscar', [ClienteController::class, 'buscar'])->middleware('modulo:PED');
    Route::get('/clientes/{id}', [ClienteController::class, 'show'])->middleware('modulo:PED')->whereUuid('id');
    Route::post('/clientes/rapida', [ClienteController::class, 'rapida'])->middleware(['modulo:PED,C', $crear]);
    Route::post('/clientes/{id}/direcciones', [ClienteController::class, 'direccion'])->middleware(['modulo:PED,C', $crear])->whereUuid('id');
    Route::get('/franjas/disponibles', [AccionController::class, 'franjas'])->middleware('modulo:PED');
    Route::get('/descuentos/limite', [DescuentoController::class, 'limite'])->middleware('modulo:PED');

    // PED-04 Selector de productos
    Route::get('/productos', [ProductoController::class, 'index'])->middleware('modulo:PED');

    // Confirmar, volver a borrador y siguiente estado (RN-PED-01, RN-PED-03)
    Route::post('/pedidos/{id}/confirmar', [AccionController::class, 'confirmar'])->middleware(['modulo:PED,E', 'permiso:ped.order.confirm'])->whereUuid('id');
    Route::post('/pedidos/{id}/borrador', [AccionController::class, 'borrador'])->middleware(['modulo:PED,E', $crear])->whereUuid('id');
    Route::post('/pedidos/{id}/estado', [AccionController::class, 'estado'])->middleware('modulo:PED,E')->whereUuid('id');
    Route::post('/pedidos/{id}/pesos', [AccionController::class, 'pesos'])->middleware('modulo:PED,E')->whereUuid('id');

    // PED-05 Confirmación con el cliente
    Route::get('/pedidos/{id}/resumen', [AccionController::class, 'resumen'])->middleware('modulo:PED')->whereUuid('id');
    Route::post('/pedidos/{id}/confirmo-cliente', [AccionController::class, 'confirmoCliente'])->middleware('modulo:PED,E')->whereUuid('id');

    // PED-06 Franjas de entrega
    Route::get('/franjas', [FranjaController::class, 'index'])->middleware('modulo:PED');
    Route::get('/franjas/{id}/pedidos', [FranjaController::class, 'pedidos'])->middleware('modulo:PED')->whereUuid('id');
    Route::post('/franjas', [FranjaController::class, 'store'])->middleware('modulo:PED,A');
    Route::put('/franjas/{id}', [FranjaController::class, 'update'])->middleware('modulo:PED,A')->whereUuid('id');

    // PED-07 Diferencia de peso
    Route::get('/pesos', [PesoController::class, 'index'])->middleware('modulo:PED');
    Route::get('/pesos/{id}', [PesoController::class, 'show'])->middleware('modulo:PED')->whereUuid('id');
    Route::post('/pesos/{id}/aviso', [PesoController::class, 'avisar'])->middleware('modulo:PED,E')->whereUuid('id');
    Route::post('/avisos/{id}/respuesta', [PesoController::class, 'respuesta'])->middleware('modulo:PED,E')->whereUuid('id');

    // PED-08 Reprogramar y PED-09 Cancelar o no entrega
    Route::post('/pedidos/{id}/reprogramar', [AccionController::class, 'reprogramar'])->middleware(['modulo:PED,E', 'permiso:ped.order.reschedule'])->whereUuid('id');
    Route::get('/motivos', [AccionController::class, 'motivos'])->middleware('modulo:PED');
    Route::post('/pedidos/{id}/cancelar', [AccionController::class, 'cancelar'])->middleware('modulo:PED,E')->whereUuid('id');
    Route::post('/pedidos/{id}/no-entregado', [AccionController::class, 'noEntregado'])->middleware('modulo:PED,E')->whereUuid('id');

    // PED-10 Aprobación de descuentos
    Route::get('/descuentos', [DescuentoController::class, 'index'])->middleware('modulo:PED');
    Route::post('/descuentos/{id}/aprobar', [DescuentoController::class, 'aprobar'])->middleware(['modulo:PED,A', 'permiso:ped.discount.approve'])->whereUuid('id');
    Route::post('/descuentos/{id}/rechazar', [DescuentoController::class, 'rechazar'])->middleware(['modulo:PED,A', 'permiso:ped.discount.approve'])->whereUuid('id');

    // PED-11 Pedidos de provincia
    Route::get('/provincia', [ProvinciaController::class, 'index'])->middleware('modulo:PED');
    Route::put('/provincia/{id}', [ProvinciaController::class, 'update'])->middleware('modulo:PED,E')->whereUuid('id');

    // PED-12 Saldo del pedido
    Route::get('/saldos', [AccionController::class, 'saldos'])->middleware('modulo:PED');
    Route::post('/pedidos/{id}/saldo', [AccionController::class, 'saldo'])->middleware('modulo:PED,E')->whereUuid('id');
    Route::post('/pedidos/{id}/cerrar', [AccionController::class, 'cerrar'])->middleware('modulo:PED,E')->whereUuid('id');

    // PED-13 Motivos y límites
    Route::get('/catalogo', [CatalogoController::class, 'index'])->middleware('modulo:PED');
    Route::post('/motivos', [CatalogoController::class, 'guardarMotivo'])->middleware('modulo:PED,A');
    Route::put('/motivos/{id}', [CatalogoController::class, 'guardarMotivo'])->middleware('modulo:PED,A')->whereUuid('id');
    Route::post('/limites', [CatalogoController::class, 'guardarLimite'])->middleware(['modulo:PED,A', 'permiso:ped.discount.approve']);
    Route::put('/limites/{id}', [CatalogoController::class, 'guardarLimite'])->middleware(['modulo:PED,A', 'permiso:ped.discount.approve'])->whereUuid('id');

    // PED-14 Tablero del día
    Route::get('/tablero', [TableroController::class, 'dia'])->middleware('modulo:PED');
    Route::get('/kpis', [TableroController::class, 'kpis'])->middleware('modulo:PED');
});
