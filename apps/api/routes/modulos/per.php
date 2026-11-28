<?php

use App\Modulos\Per\Http\Controllers\AsistenciaController;
use App\Modulos\Per\Http\Controllers\CostoController;
use App\Modulos\Per\Http\Controllers\PagosController;
use App\Modulos\Per\Http\Controllers\PersonalController;
use Illuminate\Support\Facades\Route;

// PER · Personal (PER-01 a PER-15). Reglas RN-PER-01 a 20 en app/Modulos/Per/Services. Cada acción pide su permiso de la
// spec; las listas además se recortan a lo que la persona puede ver (RN-PER-19: cada trabajador ve solo lo suyo).
Route::prefix('per')->group(function () {
    $leer = 'modulo:PER';
    $gestion = ['modulo:PER', 'permiso:per.employee.manage'];
    $aprueba = ['modulo:PER', 'permiso:per.attendance.approve|per.employee.manage'];
    $marca = ['permiso:per.attendance.mark'];   // todos marcan, aunque su rol no tenga el resto de PER
    $comision = ['modulo:PER', 'permiso:per.commission.manage'];
    $pago = ['modulo:PER', 'permiso:per.payout.approve'];
    $intercambio = ['modulo:PER', 'permiso:per.payroll.exchange'];

    Route::get('/opciones', [PersonalController::class, 'opciones'])->middleware($leer);

    // PER-01 Puestos y funciones
    Route::get('/puestos', [PersonalController::class, 'puestos'])->middleware($leer);
    Route::post('/puestos', [PersonalController::class, 'guardarPuesto'])->middleware($gestion);
    Route::put('/puestos/{id}', [PersonalController::class, 'guardarPuesto'])->middleware($gestion)->whereUuid('id');

    // PER-02 Ficha del trabajador
    Route::get('/trabajadores', [PersonalController::class, 'trabajadores'])->middleware($leer);
    Route::get('/trabajadores/{id}', [PersonalController::class, 'ficha'])->middleware($leer)->whereUuid('id');
    Route::post('/trabajadores/{id}/asignaciones', [PersonalController::class, 'asignar'])->middleware($gestion)->whereUuid('id');

    // PER-03 Condiciones de pago
    Route::get('/condiciones', [PersonalController::class, 'condiciones'])->middleware($leer);
    Route::post('/condiciones', [PersonalController::class, 'guardarCondicion'])->middleware($gestion);

    // PER-04 Turnos y PER-05 Programación
    Route::get('/turnos', [AsistenciaController::class, 'turnos'])->middleware($leer);
    Route::post('/turnos', [AsistenciaController::class, 'guardarTurno'])->middleware($gestion);
    Route::put('/turnos/{id}', [AsistenciaController::class, 'guardarTurno'])->middleware($gestion)->whereUuid('id');
    Route::get('/programacion', [AsistenciaController::class, 'semana'])->middleware($leer);
    Route::post('/programacion', [AsistenciaController::class, 'programar'])->middleware($aprueba);
    Route::post('/programacion/copiar', [AsistenciaController::class, 'copiarSemana'])->middleware([...$aprueba, 'throttle:20,1']);

    // PER-06 App · Marcación y PER-07 QR del local
    Route::get('/app', [AsistenciaController::class, 'app'])->middleware($marca);
    Route::post('/marcaciones', [AsistenciaController::class, 'marcar'])->middleware([...$marca, 'throttle:60,1']);
    Route::get('/qr/{local}', [AsistenciaController::class, 'qr'])->middleware([...$aprueba, 'throttle:240,1'])->whereUuid('local');

    // PER-08 Asistencia diaria, permisos y vacaciones
    Route::get('/asistencia', [AsistenciaController::class, 'diaria'])->middleware($leer);
    Route::get('/asistencia/mes', [AsistenciaController::class, 'resumenMes'])->middleware($leer);
    Route::post('/asistencia/consolidar', [AsistenciaController::class, 'consolidar'])->middleware([...$aprueba, 'throttle:20,1']);
    Route::post('/asistencia/{id}/justificar', [AsistenciaController::class, 'justificar'])->middleware($aprueba)->whereUuid('id');
    Route::get('/permisos', [AsistenciaController::class, 'permisos'])->middleware($leer);
    Route::post('/permisos', [AsistenciaController::class, 'pedirPermiso'])->middleware([...$marca, 'throttle:20,1']);
    Route::post('/permisos/{id}/decidir', [AsistenciaController::class, 'decidirPermiso'])->middleware($aprueba)->whereUuid('id');

    // PER-09 Adelantos
    Route::get('/adelantos', [PagosController::class, 'adelantos'])->middleware($leer);
    Route::post('/adelantos', [PagosController::class, 'pedirAdelanto'])->middleware([...$marca, 'throttle:20,1']);
    Route::post('/adelantos/{id}/decidir', [PagosController::class, 'decidirAdelanto'])->middleware(['modulo:PER', 'permiso:per.advance.approve'])->whereUuid('id');
    Route::post('/adelantos/{id}/pagar', [PagosController::class, 'pagarAdelanto'])->middleware($pago)->whereUuid('id');
    Route::post('/adelantos/{id}/anular', [PagosController::class, 'anularAdelanto'])->middleware($marca)->whereUuid('id');

    // PER-10 Planes y PER-11 Comisiones y bonos del período
    Route::get('/planes', [PagosController::class, 'planes'])->middleware($leer);
    Route::post('/planes', [PagosController::class, 'guardarPlan'])->middleware($comision);
    Route::put('/planes/{id}', [PagosController::class, 'guardarPlan'])->middleware($comision)->whereUuid('id');
    Route::get('/comisiones', [PagosController::class, 'comisiones'])->middleware($leer);
    Route::post('/comisiones/procesar', [PagosController::class, 'procesar'])->middleware([...$comision, 'throttle:20,1']);

    // PER-12 Pagos al personal
    Route::get('/pagos', [PagosController::class, 'pagos'])->middleware($leer);
    Route::get('/pagos/previa', [PagosController::class, 'previa'])->middleware(['modulo:PER', 'permiso:per.employee.view_salary']);
    Route::post('/pagos/generar', [PagosController::class, 'generar'])->middleware(['modulo:PER', 'permiso:per.commission.manage|per.payout.approve', 'throttle:10,1']);
    Route::post('/pagos/{id}/liberar', [PagosController::class, 'liberar'])->middleware(['modulo:PER', 'permiso:per.commission.manage|per.payout.approve'])->whereUuid('id');
    Route::post('/pagos/{id}/aprobar', [PagosController::class, 'aprobar'])->middleware($pago)->whereUuid('id');
    Route::post('/pagos/{id}/pagar', [PagosController::class, 'pagar'])->middleware($pago)->whereUuid('id');
    Route::post('/pagos/{id}/anular', [PagosController::class, 'anular'])->middleware(['modulo:PER', 'permiso:per.payout.approve|per.commission.manage'])->whereUuid('id');

    // PER-13 Supervisión
    Route::get('/supervision', [PagosController::class, 'supervision'])->middleware($leer);
    Route::post('/supervision', [PagosController::class, 'nuevaObservacion'])->middleware(['modulo:PER', 'permiso:per.supervision.manage|per.attendance.approve']);
    Route::post('/supervision/{id}/accion', [PagosController::class, 'registrarAccion'])->middleware(['modulo:PER', 'permiso:per.supervision.manage'])->whereUuid('id');

    // PER-14 Costo de personal (montos agregados de remuneraciones: RN-PER-19)
    Route::get('/costo', [CostoController::class, 'costo'])->middleware(['modulo:PER', 'permiso:per.employee.view_salary|per.payroll.exchange']);
    Route::get('/costo/exportar', [CostoController::class, 'exportarCosto'])->middleware(['modulo:PER', 'permiso:per.employee.view_salary|per.payroll.exchange', 'throttle:10,1']);

    // PER-15 Intercambio con Ayni HR o el contador
    Route::get('/intercambio', [CostoController::class, 'intercambios'])->middleware($intercambio);
    Route::get('/intercambio/plantilla', [CostoController::class, 'plantilla'])->middleware($intercambio);
    Route::post('/intercambio/importar', [CostoController::class, 'importar'])->middleware([...$intercambio, 'throttle:10,1']);
    Route::get('/intercambio/exportar', [CostoController::class, 'exportarVariables'])->middleware([...$intercambio, 'throttle:10,1']);
});
