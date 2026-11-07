<?php

use App\Modulos\Plt\Http\Controllers\EmpresaController;
use App\Modulos\Plt\Http\Controllers\LocalController;
use App\Modulos\Plt\Http\Controllers\MarcaController;
use App\Modulos\Plt\Http\Controllers\PeriodoController;
use App\Modulos\Plt\Http\Controllers\SerieController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

Route::prefix('plt')->group(function () {
    // PLT-03 Empresas
    Route::get('/empresas', [EmpresaController::class, 'index'])->middleware('modulo:PLT');
    Route::get('/empresas/{id}', [EmpresaController::class, 'show'])->middleware('modulo:PLT')->whereUuid('id');
    Route::post('/empresas', [EmpresaController::class, 'store'])->middleware(['modulo:PLT,C', 'permiso:plt.company.manage']);
    Route::put('/empresas/{id}', [EmpresaController::class, 'update'])->middleware(['modulo:PLT,E', 'permiso:plt.company.manage'])->whereUuid('id');

    // PLT-04 Locales (ADMINISTRACION edita PLT pero no crea: el permiso especial decide)
    Route::get('/locales', [LocalController::class, 'index'])->middleware('modulo:PLT');
    Route::post('/locales', [LocalController::class, 'store'])->middleware(['modulo:PLT,E', 'permiso:plt.establishment.manage']);
    Route::put('/locales/{id}', [LocalController::class, 'update'])->middleware(['modulo:PLT,E', 'permiso:plt.establishment.manage'])->whereUuid('id');

    // PLT-05 Marcas
    Route::get('/marcas', [MarcaController::class, 'index'])->middleware('modulo:PLT');
    Route::get('/marcas/{id}', [MarcaController::class, 'show'])->middleware('modulo:PLT')->whereUuid('id');
    Route::post('/marcas', [MarcaController::class, 'store'])->middleware(['modulo:PLT,C', 'permiso:plt.brand.manage']);
    Route::put('/marcas/{id}', [MarcaController::class, 'update'])->middleware(['modulo:PLT,E', 'permiso:plt.brand.manage'])->whereUuid('id');
    Route::put('/marcas/estado', [MarcaController::class, 'estado'])->middleware(['modulo:PLT,E', 'permiso:plt.brand.manage']);
    Route::get('/marcas/{id}/logo', [MarcaController::class, 'logo'])->middleware('modulo:PLT')->whereUuid('id');
    Route::post('/marcas/{id}/logo', [MarcaController::class, 'subirLogo'])->middleware(['modulo:PLT,E', 'permiso:plt.brand.manage', 'throttle:20,1'])->whereUuid('id');
    Route::delete('/marcas/{id}/logo', [MarcaController::class, 'quitarLogo'])->middleware(['modulo:PLT,E', 'permiso:plt.brand.manage'])->whereUuid('id');

    // PLT-08 Series (ADMINISTRACION también las maneja)
    Route::get('/series', [SerieController::class, 'index'])->middleware('modulo:PLT');
    Route::get('/series/resumen', [SerieController::class, 'resumen'])->middleware('modulo:PLT');
    Route::get('/series/{id}', [SerieController::class, 'show'])->middleware('modulo:PLT')->whereUuid('id');
    Route::post('/series', [SerieController::class, 'store'])->middleware(['modulo:PLT,E', 'permiso:plt.series.manage']);
    Route::put('/series/estado', [SerieController::class, 'estadoVarias'])->middleware(['modulo:PLT,E', 'permiso:plt.series.manage']);
    Route::put('/series/{id}/estado', [SerieController::class, 'estado'])->middleware(['modulo:PLT,E', 'permiso:plt.series.manage'])->whereUuid('id');

    // PLT-09 Períodos (cerrar: también ADMINISTRACION y CONTADORA; reabrir: sin ADMINISTRACION)
    Route::get('/periodos', [PeriodoController::class, 'index'])->middleware('modulo:PLT');
    Route::get('/periodos/historial', [PeriodoController::class, 'historial'])->middleware('modulo:PLT');
    Route::post('/periodos/cerrar', [PeriodoController::class, 'cerrar'])->middleware(['modulo:PLT,E', 'permiso:plt.period.close']);
    Route::post('/periodos/{id}/reabrir', [PeriodoController::class, 'reabrir'])->middleware(['modulo:PLT,E', 'permiso:plt.period.reopen'])->whereUuid('id');

    // Distritos para los campos de ubigeo (catálogo global de MAE-08, solo lectura).
    Route::get('/ubigeo', function (Request $request) {
        $q = mb_strtolower(trim((string) $request->query('q', '')));

        return DB::table('ubigeo')->where('level', 'DISTRICT')
            ->when($q !== '', fn ($w) => $w->where(fn ($x) => $x->whereRaw('lower(district) like ?', ["%{$q}%"])->orWhere('code', 'like', "{$q}%")))
            ->orderBy('department')->orderBy('province')->orderBy('district')->limit(30)
            ->get(['code', 'department', 'province', 'district']);
    })->middleware('modulo:PLT');
});
