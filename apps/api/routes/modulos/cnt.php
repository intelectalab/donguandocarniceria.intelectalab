<?php

use App\Modulos\Cnt\Http\Controllers\AsientoController as A;
use App\Modulos\Cnt\Http\Controllers\CntController as C;
use Illuminate\Support\Facades\Route;

// CNT · Contabilidad. Reglas en app/Modulos/Cnt/Services.
// Plan y reglas: cnt.account.manage / cnt.rule.manage (contadora). Asientos manuales y bandeja: cnt.entry.prepare clasifica, cnt.entry.approve aprueba.
// SIRE: cnt.sire.manage importa y prepara, cnt.sire.submit marca el envío. Cierre: cnt.period.close y cnt.period.reopen.
// Estados financieros, balance y libros: cnt.report.view o el equipo contable (permiso:a|b).
Route::prefix('cnt')->group(function () {
    $ver = 'permiso:cnt.report.view|cnt.entry.prepare';

    Route::get('/opciones', [C::class, 'opciones'])->middleware('modulo:CNT');
    Route::get('/cifras/{pantalla}', [C::class, 'cifras'])->middleware('modulo:CNT')->where('pantalla', '\d{2}');

    // CNT-01 Plan de cuentas
    Route::get('/cuentas', [A::class, 'cuentas'])->middleware('modulo:CNT');
    Route::post('/cuentas', [A::class, 'guardarCuenta'])->middleware(['modulo:CNT', 'permiso:cnt.account.manage']);
    Route::put('/cuentas/{id}', [A::class, 'guardarCuenta'])->middleware(['modulo:CNT', 'permiso:cnt.account.manage'])->whereUuid('id');

    // CNT-02 Reglas de asiento
    Route::get('/reglas', [A::class, 'reglas'])->middleware('modulo:CNT');
    Route::get('/reglas/{id}', [A::class, 'regla'])->middleware('modulo:CNT')->whereUuid('id');
    Route::post('/reglas', [A::class, 'guardarRegla'])->middleware(['modulo:CNT', 'permiso:cnt.rule.manage']);
    Route::put('/reglas/{id}', [A::class, 'guardarRegla'])->middleware(['modulo:CNT', 'permiso:cnt.rule.manage'])->whereUuid('id');
    Route::post('/reglas/{id}/estado', [A::class, 'estadoRegla'])->middleware(['modulo:CNT', 'permiso:cnt.rule.manage'])->whereUuid('id');

    // CNT-03 Asientos y CNT-04 Asiento manual
    Route::get('/asientos', [A::class, 'asientos'])->middleware('modulo:CNT');
    Route::get('/asientos/sin-asiento', [A::class, 'sinAsiento'])->middleware('modulo:CNT');
    Route::post('/asientos/generar', [A::class, 'generarPendientes'])->middleware(['modulo:CNT', 'permiso:cnt.entry.prepare']);
    Route::get('/asientos/{id}', [A::class, 'asiento'])->middleware('modulo:CNT')->whereUuid('id');
    Route::post('/asientos', [A::class, 'crearAsiento'])->middleware(['modulo:CNT', 'permiso:cnt.entry.prepare']);
    Route::post('/asientos/{id}/enviar', [A::class, 'enviar'])->middleware(['modulo:CNT', 'permiso:cnt.entry.prepare'])->whereUuid('id');
    Route::post('/asientos/{id}/aprobar', [A::class, 'aprobar'])->middleware('modulo:CNT')->whereUuid('id');
    Route::post('/asientos/{id}/anular', [A::class, 'anular'])->middleware(['modulo:CNT', 'permiso:cnt.entry.prepare'])->whereUuid('id');
    Route::post('/asientos/{id}/reversar', [A::class, 'reversar'])->middleware(['modulo:CNT', 'permiso:cnt.entry.prepare'])->whereUuid('id');
    Route::patch('/lineas/{id}', [A::class, 'cambiarLinea'])->middleware(['modulo:CNT', 'permiso:cnt.entry.prepare'])->whereUuid('id');

    // CNT-05 Bandeja de la contadora
    Route::get('/bandeja', [A::class, 'bandeja'])->middleware('modulo:CNT');
    Route::get('/bandeja/{id}', [A::class, 'item'])->middleware('modulo:CNT')->whereUuid('id');
    Route::post('/bandeja/{id}/clasificar', [A::class, 'clasificar'])->middleware(['modulo:CNT', 'permiso:cnt.entry.prepare'])->whereUuid('id');
    Route::post('/bandeja/{id}/aprobar', [A::class, 'aprobarItem'])->middleware('modulo:CNT')->whereUuid('id');
    Route::post('/bandeja/{id}/devolver', [A::class, 'devolverItem'])->middleware(['modulo:CNT', 'permiso:cnt.entry.approve'])->whereUuid('id');
    Route::post('/bandeja/{id}/asignar', [A::class, 'asignarItem'])->middleware(['modulo:CNT', 'permiso:cnt.entry.prepare|cnt.entry.approve'])->whereUuid('id');

    // CNT-06 Propuesta SIRE de compras, CNT-07 SIRE de ventas y CNT-08 Envíos SIRE
    Route::get('/sire/propuestas', [C::class, 'propuestas'])->middleware('modulo:CNT');
    Route::get('/sire/propuestas/{id}', [C::class, 'propuesta'])->middleware('modulo:CNT')->whereUuid('id');
    Route::post('/sire/propuestas', [C::class, 'importarPropuesta'])->middleware(['modulo:CNT', 'permiso:cnt.sire.manage']);
    Route::post('/sire/propuestas/{id}/cruzar', [C::class, 'cruzar'])->middleware(['modulo:CNT', 'permiso:cnt.sire.manage'])->whereUuid('id');
    Route::post('/sire/lineas/{id}/resolver', [C::class, 'resolver'])->middleware(['modulo:CNT', 'permiso:cnt.sire.manage'])->whereUuid('id');
    Route::get('/sire/sistema', [C::class, 'sistema'])->middleware('modulo:CNT');
    Route::get('/sire/ejemplo', [C::class, 'ejemplo'])->middleware('modulo:CNT');
    Route::get('/sire/envios', [C::class, 'envios'])->middleware('modulo:CNT');
    Route::post('/sire/envios', [C::class, 'preparar'])->middleware(['modulo:CNT', 'permiso:cnt.sire.manage']);
    Route::post('/sire/envios/{id}/enviado', [C::class, 'enviado'])->middleware(['modulo:CNT', 'permiso:cnt.sire.submit'])->whereUuid('id');
    Route::post('/sire/envios/{id}/resultado', [C::class, 'resultado'])->middleware(['modulo:CNT', 'permiso:cnt.sire.submit'])->whereUuid('id');

    // CNT-09 Libros y PLE y CNT-10 Régimen y libros del año
    Route::get('/libros', [C::class, 'libros'])->middleware(['modulo:CNT', $ver]);
    Route::get('/libros/vista', [C::class, 'vistaLibro'])->middleware(['modulo:CNT', $ver]);
    Route::post('/libros', [C::class, 'generarLibro'])->middleware(['modulo:CNT', $ver]);
    Route::get('/anios', [C::class, 'anios'])->middleware('modulo:CNT');
    Route::get('/regimen', [C::class, 'regimen'])->middleware('modulo:CNT');
    Route::post('/anios', [C::class, 'guardarAnio'])->middleware(['modulo:CNT', 'permiso:cnt.account.manage']);

    // CNT-11 Conciliación bancaria
    Route::get('/bancos', [C::class, 'bancos'])->middleware('modulo:CNT');
    Route::get('/bancos/{id}', [C::class, 'banco'])->middleware('modulo:CNT')->whereUuid('id');
    Route::post('/bancos', [C::class, 'importarExtracto'])->middleware(['modulo:CNT', 'permiso:cnt.entry.prepare']);
    Route::post('/bancos/{id}/cruzar', [C::class, 'recruzar'])->middleware(['modulo:CNT', 'permiso:cnt.entry.prepare'])->whereUuid('id');
    Route::post('/bancos/{id}/cerrar', [C::class, 'cerrarBanco'])->middleware(['modulo:CNT', 'permiso:cnt.entry.approve'])->whereUuid('id');
    Route::post('/bancos/lineas/{id}/cruzar', [C::class, 'cruzarLinea'])->middleware(['modulo:CNT', 'permiso:cnt.entry.prepare'])->whereUuid('id');
    Route::post('/bancos/lineas/{id}/cargo', [C::class, 'cargo'])->middleware(['modulo:CNT', 'permiso:cnt.entry.prepare'])->whereUuid('id');

    // CNT-12 Cierre mensual
    Route::get('/cierre', [C::class, 'cierre'])->middleware('modulo:CNT');
    Route::post('/cierre/tareas/{id}/marcar', [C::class, 'marcar'])->middleware(['modulo:CNT', 'permiso:cnt.entry.prepare|cnt.period.close'])->whereUuid('id');
    Route::post('/cierre/tareas/{id}/desmarcar', [C::class, 'desmarcar'])->middleware(['modulo:CNT', 'permiso:cnt.entry.prepare|cnt.period.close'])->whereUuid('id');
    Route::post('/cierre/cerrar', [C::class, 'cerrar'])->middleware(['modulo:CNT', 'permiso:cnt.period.close']);
    Route::post('/cierre/reabrir', [C::class, 'reabrir'])->middleware(['modulo:CNT', 'permiso:cnt.period.reopen']);

    // CNT-13 Estados financieros y CNT-14 Balance de comprobación
    Route::get('/estados/{codigo}', [C::class, 'estado'])->middleware(['modulo:CNT', $ver])->where('codigo', 'ESF|ERF|ERN');
    Route::get('/estados/{codigo}/comparativo', [C::class, 'comparativo'])->middleware(['modulo:CNT', $ver])->where('codigo', 'ERF|ERN');
    Route::get('/balance', [C::class, 'balance'])->middleware(['modulo:CNT', $ver]);
    Route::get('/mayor/{codigo}', [C::class, 'mayor'])->middleware(['modulo:CNT', $ver])->where('codigo', '\d{2,10}');

    // CNT-15 Importación de planilla y CNT-16 Tablero contable
    Route::get('/planilla', [C::class, 'planillas'])->middleware('modulo:CNT');
    Route::get('/planilla/previa', [C::class, 'planillaPrevia'])->middleware('modulo:CNT');
    Route::post('/planilla', [C::class, 'importarPlanilla'])->middleware(['modulo:CNT', 'permiso:cnt.entry.prepare']);
    Route::get('/tablero', [C::class, 'tablero'])->middleware('modulo:CNT');
});
