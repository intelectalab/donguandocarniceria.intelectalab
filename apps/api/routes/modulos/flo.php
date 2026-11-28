<?php

use App\Modulos\Flo\Http\Controllers\CostoController;
use App\Modulos\Flo\Http\Controllers\FlotaController;
use Illuminate\Support\Facades\Route;

// FLO · Flota avanzada (FLO-01 a FLO-15). Reglas RN-FLO-01 a 20 en app/Modulos/Flo/Services. Cada pantalla pide su
// permiso de la spec; el servicio revisa además el alcance (local) y que el repartidor solo toque su propia jornada.
Route::prefix('flo')->group(function () {
    $leer = 'modulo:FLO';
    $vivo = ['modulo:FLO', 'permiso:flo.live.view'];
    $calle = ['modulo:FLO', 'permiso:flo.trip.operate|flo.live.view', 'throttle:240,1'];
    $combustible = ['modulo:FLO', 'permiso:flo.fuel.manage'];
    $mant = ['modulo:FLO', 'permiso:flo.maintenance.manage'];
    $docs = ['modulo:FLO', 'permiso:flo.document.manage'];
    $multas = ['modulo:FLO', 'permiso:flo.fine.manage'];
    $costo = ['modulo:FLO', 'permiso:flo.cost.view'];
    $gestion = ['modulo:FLO', 'permiso:flo.fuel.manage|flo.maintenance.manage'];

    Route::get('/opciones', [FlotaController::class, 'opciones'])->middleware($leer);
    Route::post('/archivos/{id}/enlace', [FlotaController::class, 'enlace'])->middleware([$leer, 'throttle:120,1'])->whereUuid('id');

    // FLO-01 Mapa en vivo y FLO-02 Recorrido histórico
    Route::get('/mapa', [FlotaController::class, 'mapa'])->middleware($vivo);
    Route::get('/vehiculos/{id}/recorrido', [FlotaController::class, 'recorrido'])->middleware($vivo)->whereUuid('id');

    // FLO-03 Jornadas y km reales
    Route::get('/jornadas', [FlotaController::class, 'jornadas'])->middleware(['modulo:FLO', 'permiso:flo.live.view|flo.trip.operate']);

    // FLO-04 Ficha del vehículo (perfil, programación y cambio de tablero)
    Route::get('/vehiculos', [FlotaController::class, 'vehiculos'])->middleware(['modulo:FLO', 'permiso:flo.live.view|flo.maintenance.manage']);
    Route::get('/vehiculos/{id}', [FlotaController::class, 'ficha'])->middleware(['modulo:FLO', 'permiso:flo.live.view|flo.maintenance.manage'])->whereUuid('id');
    Route::put('/vehiculos/{id}/perfil', [FlotaController::class, 'perfil'])->middleware($mant)->whereUuid('id');
    Route::post('/vehiculos/{id}/programar', [FlotaController::class, 'programar'])->middleware(['modulo:FLO,C', 'permiso:flo.live.view'])->whereUuid('id');
    Route::get('/vehiculos/{id}/rutas', [FlotaController::class, 'rutasDelDia'])->middleware($vivo)->whereUuid('id');
    Route::post('/vehiculos/{id}/cambio-tablero', [FlotaController::class, 'cambioTablero'])->middleware(['modulo:FLO', 'permiso:flo.odometer.reset'])->whereUuid('id');

    // FLO-15 App del conductor: jornada, posiciones (en lote) y temperatura manual
    Route::get('/app', [FlotaController::class, 'app'])->middleware($calle);
    Route::post('/jornadas', [FlotaController::class, 'iniciar'])->middleware([...$calle, 'throttle:30,1']);
    Route::post('/jornadas/{id}/cerrar', [FlotaController::class, 'cerrar'])->middleware($calle)->whereUuid('id');
    Route::post('/posiciones', [FlotaController::class, 'posiciones'])->middleware(['modulo:FLO', 'permiso:flo.trip.operate|flo.live.view', 'throttle:600,1']);

    // FLO-13 Cadena de frío
    Route::get('/temperatura', [FlotaController::class, 'temperatura'])->middleware($vivo);
    Route::post('/temperatura', [FlotaController::class, 'lectura'])->middleware($calle);

    // FLO-14 Alertas (calidad revisa los pedidos de una excursión de temperatura)
    Route::get('/alertas', [FlotaController::class, 'alertas'])->middleware($leer);
    Route::post('/alertas/barrido', [FlotaController::class, 'barrido'])->middleware([...$vivo, 'throttle:30,1']);
    Route::post('/alertas/{id}/atender', [FlotaController::class, 'atender'])->middleware($leer)->whereUuid('id');
    Route::post('/alertas/{id}/cerrar', [FlotaController::class, 'cerrarAlerta'])->middleware($leer)->whereUuid('id');
    Route::post('/alertas/{id}/pedidos', [FlotaController::class, 'revisarPedido'])->middleware($leer)->whereUuid('id');

    // FLO-05 Cargas de combustible y FLO-06 Rendimiento
    Route::get('/cargas', [CostoController::class, 'cargas'])->middleware(['modulo:FLO', 'permiso:flo.fuel.manage|flo.trip.operate|flo.live.view']);
    Route::get('/cargas/previa', [CostoController::class, 'previa'])->middleware(['modulo:FLO', 'permiso:flo.fuel.manage|flo.trip.operate']);
    Route::post('/cargas', [CostoController::class, 'registrarCarga'])->middleware(['modulo:FLO', 'permiso:flo.fuel.manage|flo.trip.operate', 'throttle:60,1']);
    Route::post('/cargas/{id}/anular', [CostoController::class, 'anularCarga'])->middleware($combustible)->whereUuid('id');
    Route::post('/cargas/{id}/gasto', [CostoController::class, 'gastoCarga'])->middleware($combustible)->whereUuid('id');
    Route::get('/gastos-candidatos', [CostoController::class, 'candidatos'])->middleware(['modulo:FLO', 'permiso:flo.fuel.manage|flo.maintenance.manage|flo.fine.manage']);
    Route::get('/rendimiento', [CostoController::class, 'rendimiento'])->middleware(['modulo:FLO', 'permiso:flo.fuel.manage|flo.live.view|flo.cost.view']);

    // FLO-07 Planes y FLO-08 Órdenes de mantenimiento
    Route::get('/planes', [CostoController::class, 'planes'])->middleware(['modulo:FLO', 'permiso:flo.maintenance.manage|flo.live.view']);
    Route::post('/planes', [CostoController::class, 'guardarPlan'])->middleware($mant);
    Route::put('/planes/{id}', [CostoController::class, 'guardarPlan'])->middleware($mant)->whereUuid('id');
    Route::get('/ordenes', [CostoController::class, 'ordenes'])->middleware(['modulo:FLO', 'permiso:flo.maintenance.manage|flo.live.view']);
    Route::post('/ordenes', [CostoController::class, 'abrirOrden'])->middleware($mant);
    Route::post('/ordenes/{id}/cerrar', [CostoController::class, 'cerrarOrden'])->middleware([...$mant, 'throttle:60,1'])->whereUuid('id');
    Route::post('/ordenes/{id}/anular', [CostoController::class, 'anularOrden'])->middleware($mant)->whereUuid('id');

    // FLO-09 Documentos del vehículo y del conductor
    Route::get('/documentos', [CostoController::class, 'documentos'])->middleware(['modulo:FLO', 'permiso:flo.document.manage|flo.live.view']);
    Route::post('/documentos', [CostoController::class, 'guardarDocumento'])->middleware([...$docs, 'throttle:60,1']);
    Route::post('/documentos/{id}/anular', [CostoController::class, 'anularDocumento'])->middleware($docs)->whereUuid('id');

    // FLO-10 Multas (el descuento lo aprueba RRHH o gerencia; el servicio lo revisa)
    Route::get('/multas', [CostoController::class, 'multas'])->middleware(['modulo:FLO', 'permiso:flo.fine.manage|flo.cost.view|flo.document.manage']);
    Route::post('/multas', [CostoController::class, 'registrarMulta'])->middleware($multas);
    Route::post('/multas/{id}/pagar', [CostoController::class, 'pagarMulta'])->middleware($multas)->whereUuid('id');
    Route::post('/multas/{id}/descontar', [CostoController::class, 'descontarMulta'])->middleware([$leer, 'throttle:30,1'])->whereUuid('id');
    Route::post('/multas/{id}/estado', [CostoController::class, 'cambiarMulta'])->middleware($multas)->whereUuid('id');

    // FLO-11 Otros costos (alquiler, peajes, cochera, seguros…)
    Route::get('/costos', [CostoController::class, 'costos'])->middleware(['modulo:FLO', 'permiso:flo.fuel.manage|flo.maintenance.manage|flo.cost.view']);
    Route::post('/costos', [CostoController::class, 'registrarCosto'])->middleware($gestion);
    Route::post('/costos/{id}/anular', [CostoController::class, 'anularCosto'])->middleware($gestion)->whereUuid('id');

    // FLO-12 Costo total y comparativo propio vs tercero
    Route::get('/tablero', [CostoController::class, 'tablero'])->middleware($costo);
    Route::get('/tablero/exportar', [CostoController::class, 'exportar'])->middleware([...$costo, 'throttle:20,1']);
});
