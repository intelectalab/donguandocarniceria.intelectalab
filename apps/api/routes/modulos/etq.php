<?php

use App\Modulos\Etq\Http\Controllers\ImpresionController as Imp;
use App\Modulos\Etq\Http\Controllers\PlantillaController as Tpl;
use App\Modulos\Etq\Http\Controllers\RetiroController as Ret;
use Illuminate\Support\Facades\Route;

// ETQ · Etiquetado, trazabilidad y retiros. Reglas en app/Modulos/Etq/Services/EtiquetasService.php.
// Plantillas: etq.template.manage. Imprimir: etq.label.print (o reprint). Reimprimir: etq.label.reprint.
// Iniciar retiro: etq.recall.start. Cerrar retiro: etq.recall.close. La página pública del QR va en routes/api.php, sin sesión.
Route::prefix('etq')->group(function () {
    Route::get('/opciones', [Tpl::class, 'opciones'])->middleware('modulo:ETQ');
    Route::get('/tablero', [Ret::class, 'tablero'])->middleware('modulo:ETQ');                     // ETQ-09

    // ETQ-01 Plantillas
    Route::get('/plantillas', [Tpl::class, 'index'])->middleware('modulo:ETQ');
    Route::get('/plantillas/{id}', [Tpl::class, 'show'])->middleware('modulo:ETQ')->whereUuid('id');
    Route::post('/plantillas', [Tpl::class, 'store'])->middleware(['modulo:ETQ,C', 'permiso:etq.template.manage']);
    Route::put('/plantillas/{id}', [Tpl::class, 'update'])->middleware(['modulo:ETQ,E', 'permiso:etq.template.manage'])->whereUuid('id');

    // ETQ-02 Impresión y ETQ-03 Historial
    Route::get('/lotes', [Imp::class, 'lotes'])->middleware('modulo:ETQ');
    Route::post('/previa', [Imp::class, 'previa'])->middleware(['modulo:ETQ', 'throttle:120,1']);
    Route::get('/impresiones', [Imp::class, 'index'])->middleware('modulo:ETQ');
    Route::get('/impresiones/{id}', [Imp::class, 'show'])->middleware('modulo:ETQ')->whereUuid('id');
    Route::post('/impresiones', [Imp::class, 'store'])->middleware(['modulo:ETQ,C', 'permiso:etq.label.print|etq.label.reprint', 'throttle:120,1']);
    Route::post('/impresiones/{id}/reimprimir', [Imp::class, 'reimprimir'])->middleware(['modulo:ETQ,C', 'permiso:etq.label.reprint'])->whereUuid('id');

    // ETQ-04 Trazabilidad
    Route::get('/lotes/{id}/qr', [Ret::class, 'qr'])->middleware('modulo:ETQ')->whereUuid('id');                  // ETQ-08
    Route::get('/lotes/{id}/trazabilidad', [Ret::class, 'trazabilidad'])->middleware('modulo:ETQ')->whereUuid('id');

    // ETQ-05 Retiros, ETQ-06 Nuevo retiro y ETQ-07 Seguimiento
    Route::get('/retiros', [Ret::class, 'index'])->middleware('modulo:ETQ');
    Route::post('/retiros/previa', [Ret::class, 'previa'])->middleware('modulo:ETQ');
    Route::post('/retiros', [Ret::class, 'store'])->middleware(['modulo:ETQ,C', 'permiso:etq.recall.start']);
    Route::get('/retiros/{id}', [Ret::class, 'show'])->middleware('modulo:ETQ')->whereUuid('id');
    Route::post('/retiros/{id}/cerrar', [Ret::class, 'cerrar'])->middleware(['modulo:ETQ,E', 'permiso:etq.recall.close'])->whereUuid('id');
    Route::put('/contactos/{id}', [Ret::class, 'contacto'])->middleware(['modulo:ETQ,E', 'permiso:etq.recall.start|etq.recall.close'])->whereUuid('id');
    Route::get('/contactos/{id}/aviso', [Ret::class, 'aviso'])->middleware('modulo:ETQ')->whereUuid('id');
});
