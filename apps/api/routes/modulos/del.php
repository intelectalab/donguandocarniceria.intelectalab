<?php

use App\Modulos\Del\Http\Controllers\AppController;
use App\Modulos\Del\Http\Controllers\ControlController;
use App\Modulos\Del\Http\Controllers\CostoController;
use App\Modulos\Del\Http\Controllers\PlanController;
use App\Modulos\Del\Http\Controllers\ProvinciaController;
use App\Modulos\Del\Http\Controllers\SeguimientoController;
use App\Modulos\Del\Http\Controllers\TerceroController;
use App\Modulos\Del\Http\Controllers\VehiculoController;
use Illuminate\Support\Facades\Route;

// DEL · Reparto (DEL-01 a DEL-22). Reglas en app/Modulos/Del/Services. Leer pide el módulo; cada acción pide además
// su permiso de la spec. La conciliación y los costos se abren solo con su permiso (administración, contadora y
// auditor no tienen el módulo DEL, pero la spec les da esas pantallas). La página pública de seguimiento está en
// routes/api.php (v1/publico/seguimiento).
Route::prefix('del')->group(function () {
    $leer = 'modulo:DEL';
    $plan = ['modulo:DEL', 'permiso:del.route.plan'];
    $calle = ['modulo:DEL', 'permiso:del.route.drive|del.route.plan', 'throttle:240,1'];

    Route::get('/opciones', [PlanController::class, 'opciones']);
    Route::post('/archivos/{id}/enlace', [ControlController::class, 'archivo'])->middleware(['modulo:DEL', 'throttle:120,1'])->whereUuid('id');

    // DEL-01 Planificador, DEL-02 Asignación, DEL-03 Hoja de ruta
    Route::get('/planificador', [PlanController::class, 'planificador'])->middleware(['modulo:DEL', 'permiso:del.route.plan|del.tracking.view']);
    Route::get('/rutas', [PlanController::class, 'rutas'])->middleware($leer);
    Route::get('/rutas/{id}', [PlanController::class, 'show'])->middleware($leer)->whereUuid('id');
    Route::post('/rutas', [PlanController::class, 'store'])->middleware(['modulo:DEL,C', 'permiso:del.route.plan']);
    Route::post('/rutas/{id}/paradas', [PlanController::class, 'agregar'])->middleware($plan)->whereUuid('id');
    Route::post('/rutas/{id}/ordenar', [PlanController::class, 'ordenar'])->middleware($plan)->whereUuid('id');
    Route::post('/rutas/{id}/asignar', [PlanController::class, 'asignar'])->middleware($plan)->whereUuid('id');
    Route::post('/rutas/{id}/cancelar', [PlanController::class, 'cancelar'])->middleware($plan)->whereUuid('id');
    Route::post('/paradas/{id}/quitar', [PlanController::class, 'quitar'])->middleware($plan)->whereUuid('id');
    Route::post('/paradas/{id}/mover', [PlanController::class, 'mover'])->middleware($plan)->whereUuid('id');
    Route::post('/paradas/{id}/aviso', [PlanController::class, 'aviso'])->middleware(['modulo:DEL', 'permiso:del.route.plan|del.tracking.view'])->whereUuid('id');
    Route::post('/rutas/{id}/cargar', [PlanController::class, 'cargar'])->middleware($calle)->whereUuid('id');
    Route::post('/rutas/{id}/salir', [PlanController::class, 'salir'])->middleware($calle)->whereUuid('id');
    Route::post('/rutas/{id}/volver', [PlanController::class, 'volver'])->middleware($calle)->whereUuid('id');

    // DEL-04 y DEL-05 App del repartidor (con cola sin conexión)
    Route::get('/app/rutas', [AppController::class, 'rutas'])->middleware($leer);
    Route::get('/app/rutas/{id}', [AppController::class, 'ruta'])->middleware($leer)->whereUuid('id');
    Route::post('/app/paradas/{id}/llegar', [AppController::class, 'llegar'])->middleware($calle)->whereUuid('id');
    Route::post('/app/paradas/{id}/cobrar', [AppController::class, 'cobrar'])->middleware($calle)->whereUuid('id');
    Route::post('/app/paradas/{id}/entregar', [AppController::class, 'entregar'])->middleware($calle)->whereUuid('id');
    Route::post('/app/paradas/{id}/no-entregar', [AppController::class, 'noEntregar'])->middleware($calle)->whereUuid('id');
    Route::post('/app/paradas/{id}/incidencia', [AppController::class, 'incidencia'])->middleware($calle)->whereUuid('id');
    Route::post('/app/paradas/{id}/contacto', [AppController::class, 'contacto'])->middleware($calle)->whereUuid('id');
    Route::post('/app/paradas/{id}/derivar', [AppController::class, 'derivar'])->middleware($calle)->whereUuid('id');
    Route::post('/app/rutas/{id}/posicion', [AppController::class, 'posicion'])->middleware($calle)->whereUuid('id');
    Route::post('/app/rutas/{id}/apoyo', [AppController::class, 'apoyo'])->middleware($calle)->whereUuid('id');
    Route::post('/app/sincronizar', [AppController::class, 'sincronizar'])->middleware($calle);

    // DEL-17 Gastos de la ruta y DEL-21 Mensajes a control
    Route::get('/app/rutas/{id}/gastos', [AppController::class, 'gastos'])->middleware($leer)->whereUuid('id');
    Route::post('/app/rutas/{id}/gastos', [AppController::class, 'gasto'])->middleware($calle)->whereUuid('id');
    Route::post('/gastos/{id}/anular', [ControlController::class, 'anularGasto'])->middleware(['modulo:DEL', 'permiso:del.route.plan|del.cost.manage'])->whereUuid('id');
    Route::get('/app/rutas/{id}/mensajes', [AppController::class, 'mensajes'])->middleware($leer)->whereUuid('id');
    Route::post('/app/rutas/{id}/mensajes', [AppController::class, 'mensaje'])->middleware($calle)->whereUuid('id');

    // DEL-18 Ticket de entrega
    Route::get('/paradas/{id}/ticket', [AppController::class, 'ticket'])->middleware($leer)->whereUuid('id');
    Route::post('/paradas/{id}/ticket', [AppController::class, 'ticketEntregado'])->middleware($calle)->whereUuid('id');

    // DEL-06 Liquidación del repartidor
    Route::get('/liquidaciones', [SeguimientoController::class, 'liquidaciones'])->middleware($leer);
    Route::get('/rutas/{id}/liquidacion', [SeguimientoController::class, 'liquidacion'])->middleware($leer)->whereUuid('id');
    Route::post('/rutas/{id}/liquidar', [SeguimientoController::class, 'liquidar'])->middleware('modulo:DEL,E')->whereUuid('id');
    Route::post('/liquidaciones/{id}/aprobar', [SeguimientoController::class, 'aprobar'])->middleware('modulo:DEL,A')->whereUuid('id');

    // DEL-07 Seguimiento en mapa y DEL-08 Enlace de seguimiento
    Route::get('/mapa', [SeguimientoController::class, 'mapa'])->middleware(['modulo:DEL', 'permiso:del.tracking.view|del.route.plan']);
    Route::get('/pedidos/{id}/enlace', [SeguimientoController::class, 'enlace'])->middleware(['modulo:DEL', 'permiso:del.tracking.view|del.route.plan'])->whereUuid('id');
    Route::post('/pedidos/{id}/enlace/anular', [SeguimientoController::class, 'anular'])->middleware($plan)->whereUuid('id');

    // DEL-09 Empresas de delivery y tarifas, DEL-10 Conciliación
    Route::get('/empresas', [TerceroController::class, 'empresas'])->middleware('permiso:del.carrier.manage|del.carrier_invoice.reconcile|del.route.plan');
    Route::post('/tarifas', [TerceroController::class, 'crearTarifa'])->middleware('permiso:del.carrier.manage');
    Route::put('/tarifas/{id}', [TerceroController::class, 'editarTarifa'])->middleware('permiso:del.carrier.manage')->whereUuid('id');
    Route::post('/tarifas/{id}/anular', [TerceroController::class, 'anularTarifa'])->middleware('permiso:del.carrier.manage')->whereUuid('id');
    Route::get('/facturas', [TerceroController::class, 'facturas'])->middleware('permiso:del.carrier_invoice.reconcile|del.carrier.manage');
    Route::get('/facturas/envios', [TerceroController::class, 'envios'])->middleware('permiso:del.carrier_invoice.reconcile|del.carrier.manage');
    Route::get('/facturas/{id}', [TerceroController::class, 'factura'])->middleware('permiso:del.carrier_invoice.reconcile|del.carrier.manage')->whereUuid('id');
    Route::post('/facturas', [TerceroController::class, 'conciliar'])->middleware('permiso:del.carrier_invoice.reconcile');

    // DEL-11 Envíos a provincia
    Route::get('/provincia', [ProvinciaController::class, 'index'])->middleware($leer);
    Route::post('/provincia', [ProvinciaController::class, 'store'])->middleware(['modulo:DEL', 'permiso:del.province.manage']);
    Route::put('/provincia/{id}', [ProvinciaController::class, 'update'])->middleware(['modulo:DEL', 'permiso:del.province.manage'])->whereUuid('id');
    Route::post('/provincia/{id}/agencia', [ProvinciaController::class, 'agencia'])->middleware(['modulo:DEL', 'permiso:del.province.manage'])->whereUuid('id');
    Route::post('/provincia/{id}/estado', [ProvinciaController::class, 'estado'])->middleware(['modulo:DEL', 'permiso:del.province.manage'])->whereUuid('id');

    // DEL-12 Vehículos
    Route::get('/vehiculos', [VehiculoController::class, 'index'])->middleware($leer);
    Route::post('/vehiculos', [VehiculoController::class, 'store'])->middleware(['modulo:DEL', 'permiso:del.vehicle.manage']);
    Route::put('/vehiculos/{id}', [VehiculoController::class, 'update'])->middleware(['modulo:DEL', 'permiso:del.vehicle.manage'])->whereUuid('id');

    // DEL-13 Costos, DEL-14 Costo por entrega, DEL-15 Comparativo
    $verCostos = 'permiso:del.cost.view|del.cost.manage';
    Route::get('/costos', [CostoController::class, 'index'])->middleware($verCostos);
    Route::post('/costos', [CostoController::class, 'store'])->middleware('permiso:del.cost.manage');
    Route::post('/costos/{id}/anular', [CostoController::class, 'anular'])->middleware('permiso:del.cost.manage')->whereUuid('id');
    Route::get('/costo-entrega', [CostoController::class, 'resumen'])->middleware($verCostos);
    Route::post('/costo-entrega/calcular', [CostoController::class, 'calcular'])->middleware('permiso:del.cost.manage');
    Route::get('/comparativo', [CostoController::class, 'comparativo'])->middleware($verCostos);

    // DEL-16 No entregados
    Route::get('/no-entregados', [ControlController::class, 'noEntregados'])->middleware($leer);
    Route::post('/paradas/{id}/recibir-bolsas', [ControlController::class, 'recibirBolsas'])->middleware($plan)->whereUuid('id');
    Route::post('/paradas/{id}/reprogramar', [ControlController::class, 'reprogramar'])->middleware($plan)->whereUuid('id');

    // DEL-19 Calidad de direcciones
    Route::get('/direcciones', [ControlController::class, 'direcciones'])->middleware($leer);
    Route::post('/direcciones/{id}/confirmar', [ControlController::class, 'confirmarDireccion'])->middleware($plan)->whereUuid('id');
    Route::post('/direcciones/{id}/senal', [ControlController::class, 'senal'])->middleware($plan)->whereUuid('id');
    Route::post('/pedidos/{id}/pedir-ubicacion', [ControlController::class, 'pedirUbicacion'])->middleware($plan)->whereUuid('id');

    // DEL-20 Apoyo y derivaciones
    Route::get('/apoyos', [ControlController::class, 'apoyos'])->middleware(['modulo:DEL', 'permiso:del.route.plan|del.tracking.view']);
    Route::post('/apoyos/{id}/resolver', [ControlController::class, 'resolverApoyo'])->middleware($plan)->whereUuid('id');
    Route::post('/derivaciones/{id}/cerrar', [ControlController::class, 'cerrarDerivacion'])->middleware($plan)->whereUuid('id');

    // DEL-22 Mensajes del reparto
    Route::get('/mensajes', [ControlController::class, 'mensajes'])->middleware($leer);
    Route::post('/mensajes/{id}/responder', [ControlController::class, 'responder'])->middleware(['modulo:DEL', 'permiso:del.route.plan|del.tracking.view'])->whereUuid('id');
});
