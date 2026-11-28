<?php

namespace App\Modulos\Del\Services;

use App\Models\User;
use App\Modulos\Caj\Services\Liquidaciones as CajLiquidaciones;
use Illuminate\Support\Facades\DB;

/**
 * DEL-06 Liquidación del repartidor (RN-DEL-10, RN-CAJ-10, RN-CAJ-11). CAJ es el dueño de las liquidaciones:
 * esta pantalla de DEL usa el mismo servicio que CAJ-07 (App\Modulos\Caj\Services\Liquidaciones), que además
 * traslada el efectivo entregado de la caja del repartidor a la caja que recibe.
 * La ruta pasa a LIQUIDADA con la liquidación cuadrada o aprobada.
 */
final class Liquidaciones
{
    public const ESTADOS = CajLiquidaciones::ESTADOS;

    /** Lo que el repartidor debe entregar: cobros en efectivo menos gastos pagados del efectivo de la ruta. */
    public static function esperado(string $routeId): array
    {
        return CajLiquidaciones::esperado($routeId);
    }

    public static function deRuta(string $routeId): ?object
    {
        return CajLiquidaciones::deRuta($routeId);
    }

    /** Registra la liquidación al volver. Quien entrega el efectivo no la recibe. */
    public static function liquidar(string $routeId, float $contado, ?string $motivo, User $u, ?string $cuentaRecibe = null): object
    {
        return DB::transaction(function () use ($routeId, $contado, $motivo, $u, $cuentaRecibe) {
            Base::rutaVisible($routeId, $u, true);

            return CajLiquidaciones::registrar($routeId, $contado, $motivo, $u, $cuentaRecibe);
        });
    }

    /** Se aprueba una liquidación con diferencia; quien la registró no la aprueba. */
    public static function aprobar(string $id, ?string $nota, User $u): object
    {
        return DB::transaction(function () use ($id, $nota, $u) {
            $ruta = DB::table('driver_settlements')->where('id', $id)->value('route_ref');
            if ($ruta) {
                Base::rutaVisible($ruta, $u, true);
            }

            return CajLiquidaciones::aprobar($id, $nota, $u);
        });
    }
}
