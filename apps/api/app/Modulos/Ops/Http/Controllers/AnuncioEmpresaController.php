<?php

namespace App\Modulos\Ops\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Ops\Services\Anuncios;

/** Anuncios de GestionCarnica que ve la empresa (RN-OPS-06: solo los dirigidos a ella, publicados y vigentes). */
class AnuncioEmpresaController extends Controller
{
    public function __invoke()
    {
        return response()->json(['data' => Anuncios::paraEmpresa()]);
    }
}
