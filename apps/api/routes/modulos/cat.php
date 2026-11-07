<?php

use App\Modulos\Cat\Http\Controllers\ComboController;
use App\Modulos\Cat\Http\Controllers\CorteController;
use App\Modulos\Cat\Http\Controllers\EtiquetaController;
use App\Modulos\Cat\Http\Controllers\HistorialController;
use App\Modulos\Cat\Http\Controllers\ListaController;
use App\Modulos\Cat\Http\Controllers\ProductoController;
use App\Modulos\Cat\Http\Controllers\SanitarioController;
use App\Modulos\Cat\Http\Controllers\SimuladorController;
use App\Modulos\Cat\Http\Controllers\VarianteController;
use App\Modulos\Cat\Http\Controllers\WebController;
use Illuminate\Support\Facades\Route;

Route::prefix('cat')->group(function () {
    // CAT-01 Productos
    Route::get('/productos', [ProductoController::class, 'index'])->middleware('modulo:CAT');
    Route::get('/productos/resumen', [ProductoController::class, 'resumen'])->middleware('modulo:CAT');

    // CAT-02 Ficha del producto
    Route::get('/productos/{id}', [ProductoController::class, 'show'])->middleware('modulo:CAT')->whereUuid('id');
    Route::post('/productos', [ProductoController::class, 'store'])->middleware(['modulo:CAT,C', 'permiso:cat.product.manage']);
    Route::put('/productos/{id}', [ProductoController::class, 'update'])->middleware(['modulo:CAT,E', 'permiso:cat.product.manage'])->whereUuid('id');
    Route::put('/productos/{id}/estado', [ProductoController::class, 'estado'])->middleware(['modulo:CAT,E', 'permiso:cat.product.manage'])->whereUuid('id');

    // CAT-03 Variantes y cortes
    Route::get('/variantes', [VarianteController::class, 'index'])->middleware('modulo:CAT');
    Route::get('/variantes/resumen', [VarianteController::class, 'resumen'])->middleware('modulo:CAT');
    Route::get('/variantes/{id}', [VarianteController::class, 'show'])->middleware('modulo:CAT')->whereUuid('id');
    Route::post('/variantes', [VarianteController::class, 'store'])->middleware(['modulo:CAT,C', 'permiso:cat.product.manage']);
    Route::put('/variantes/{id}', [VarianteController::class, 'update'])->middleware(['modulo:CAT,E', 'permiso:cat.product.manage'])->whereUuid('id');
    Route::put('/variantes/{id}/estado', [VarianteController::class, 'estado'])->middleware(['modulo:CAT,E', 'permiso:cat.product.manage'])->whereUuid('id');
    Route::delete('/variantes/{id}', [VarianteController::class, 'destroy'])->middleware(['modulo:CAT,E', 'permiso:cat.product.manage'])->whereUuid('id');
    Route::get('/cortes', [VarianteController::class, 'cortes'])->middleware('modulo:CAT');

    // CAT-04 Tipos de corte
    Route::get('/tipos-corte', [CorteController::class, 'index'])->middleware('modulo:CAT');
    Route::post('/tipos-corte', [CorteController::class, 'store'])->middleware(['modulo:CAT,C', 'permiso:cat.product.manage']);
    Route::put('/tipos-corte/{id}', [CorteController::class, 'update'])->middleware(['modulo:CAT,E', 'permiso:cat.product.manage'])->whereUuid('id');

    // CAT-05 Listas de precio
    Route::get('/listas', [ListaController::class, 'index'])->middleware('modulo:CAT');
    Route::get('/listas/{id}', [ListaController::class, 'show'])->middleware('modulo:CAT')->whereUuid('id');
    Route::post('/listas', [ListaController::class, 'store'])->middleware(['modulo:CAT,C', 'permiso:cat.price.manage']);
    Route::put('/listas/{id}', [ListaController::class, 'update'])->middleware(['modulo:CAT,E', 'permiso:cat.price.manage'])->whereUuid('id');
    Route::put('/listas/{id}/estado', [ListaController::class, 'estado'])->middleware(['modulo:CAT,E', 'permiso:cat.price.manage'])->whereUuid('id');
    Route::post('/listas/{id}/copiar', [ListaController::class, 'copiar'])->middleware(['modulo:CAT,C', 'permiso:cat.price.manage'])->whereUuid('id');
    Route::post('/listas/{id}/programar', [ListaController::class, 'programar'])->middleware(['modulo:CAT,E', 'permiso:cat.price.manage'])->whereUuid('id');

    // CAT-06 Precios de la lista
    Route::get('/listas/{id}/precios', [ListaController::class, 'precios'])->middleware('modulo:CAT')->whereUuid('id');
    Route::post('/listas/{id}/precios', [ListaController::class, 'agregarPrecio'])->middleware(['modulo:CAT,C', 'permiso:cat.price.manage'])->whereUuid('id');
    Route::put('/listas/{id}/precios/{item}/cerrar', [ListaController::class, 'cerrarPrecio'])->middleware(['modulo:CAT,E', 'permiso:cat.price.manage'])->whereUuid(['id', 'item']);
    Route::post('/listas/{id}/csv/vista', [ListaController::class, 'vistaCsv'])->middleware(['modulo:CAT,C', 'permiso:cat.price.manage'])->whereUuid('id');
    Route::post('/listas/{id}/csv', [ListaController::class, 'importarCsv'])->middleware(['modulo:CAT,C', 'permiso:cat.price.manage'])->whereUuid('id');

    // CAT-07 Simulador de precio
    Route::get('/simulador', SimuladorController::class)->middleware('modulo:CAT');

    // CAT-08 Combos
    Route::get('/combos', [ComboController::class, 'index'])->middleware('modulo:CAT');
    Route::post('/combos', [ComboController::class, 'store'])->middleware(['modulo:CAT,C', 'permiso:cat.product.manage']);
    Route::post('/combos/{id}/componentes', [ComboController::class, 'agregar'])->middleware(['modulo:CAT,E', 'permiso:cat.product.manage'])->whereUuid('id');
    Route::put('/combos/{id}/componentes/{componente}', [ComboController::class, 'actualizar'])->middleware(['modulo:CAT,E', 'permiso:cat.product.manage'])->whereUuid(['id', 'componente']);
    Route::delete('/combos/{id}/componentes/{componente}', [ComboController::class, 'quitar'])->middleware(['modulo:CAT,E', 'permiso:cat.product.manage'])->whereUuid(['id', 'componente']);

    // CAT-09 Publicación web
    Route::get('/web', [WebController::class, 'index'])->middleware('modulo:CAT');
    Route::put('/web/{id}/publicar', [WebController::class, 'publicar'])->middleware(['modulo:CAT,E', 'permiso:cat.product.publish_web'])->whereUuid('id');
    Route::put('/web/{id}', [WebController::class, 'datos'])->middleware(['modulo:CAT,E', 'permiso:cat.product.publish_web'])->whereUuid('id');
    Route::post('/web/{id}/enviar', [WebController::class, 'enviar'])->middleware(['modulo:CAT,E', 'permiso:cat.product.publish_web'])->whereUuid('id');

    // CAT-10 Registros sanitarios
    Route::get('/sanitarios', [SanitarioController::class, 'index'])->middleware('modulo:CAT');
    Route::put('/sanitarios/{id}', [SanitarioController::class, 'update'])->middleware(['modulo:CAT,E', 'permiso:cat.sanitary.manage'])->whereUuid('id');
    Route::post('/sanitarios/{id}/certificado', [SanitarioController::class, 'subirCertificado'])->middleware(['modulo:CAT,E', 'permiso:cat.sanitary.manage'])->whereUuid('id');
    Route::get('/sanitarios/{id}/certificado', [SanitarioController::class, 'certificado'])->middleware('modulo:CAT')->whereUuid('id');

    // CAT-11 Etiquetas de balanza
    Route::get('/etiquetas', [EtiquetaController::class, 'index'])->middleware('modulo:CAT');
    Route::post('/etiquetas/leer', [EtiquetaController::class, 'leer'])->middleware('modulo:CAT');
    Route::post('/etiquetas/generar', [EtiquetaController::class, 'generar'])->middleware('modulo:CAT');
    Route::put('/etiquetas/formato', [EtiquetaController::class, 'formato'])->middleware(['modulo:CAT,E', 'permiso:cat.product.manage']);

    // CAT-12 Historial de precios
    Route::get('/historial', [HistorialController::class, 'index'])->middleware('modulo:CAT');
    Route::get('/historial/resumen', [HistorialController::class, 'resumen'])->middleware('modulo:CAT');

    Route::get('/categorias', [ProductoController::class, 'categorias'])->middleware('modulo:CAT');
});
