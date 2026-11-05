<?php

use App\Modulos\Plt\Http\Controllers\EmpresaController;
use App\Modulos\Plt\Http\Controllers\LocalController;
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

    // Distritos para los campos de ubigeo (catálogo global de MAE-08, solo lectura).
    Route::get('/ubigeo', function (Request $request) {
        $q = mb_strtolower(trim((string) $request->query('q', '')));

        return DB::table('ubigeo')->where('level', 'DISTRICT')
            ->when($q !== '', fn ($w) => $w->where(fn ($x) => $x->whereRaw('lower(district) like ?', ["%{$q}%"])->orWhere('code', 'like', "{$q}%")))
            ->orderBy('department')->orderBy('province')->orderBy('district')->limit(30)
            ->get(['code', 'department', 'province', 'district']);
    })->middleware('modulo:PLT');
});
