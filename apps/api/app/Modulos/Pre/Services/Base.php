<?php

namespace App\Modulos\Pre\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Params;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Piezas comunes de PRE: nombres, alcance por marca y local, números de ola, parámetros y avisos.
 */
final class Base
{
    public const EPS = 0.0005;

    public const TAREA_ACTIVA = ['PENDING', 'PICKING', 'PICKED', 'PACKED', 'VERIFIED', 'LOADED'];

    public const TAREA = ['PENDING' => 'pendiente', 'PICKING' => 'en armado', 'PICKED' => 'armada', 'PACKED' => 'embolsada',
        'VERIFIED' => 'verificada', 'LOADED' => 'cargada', 'CANCELLED' => 'anulada'];

    public const OLA = ['DRAFT' => 'en borrador', 'RELEASED' => 'liberada', 'PICKING' => 'en armado', 'PACKED' => 'embolsada',
        'LOADED' => 'cargada', 'CLOSED' => 'cerrada', 'CANCELLED' => 'cancelada'];

    public const RESULTADOS = ['OK' => 'Correcto', 'WRONG_PRODUCT' => 'Producto equivocado', 'WRONG_ORDER' => 'Pedido cruzado', 'WRONG_ROUTE' => 'Ruta equivocada',
        'LOT_NOT_RELEASED' => 'Lote no liberado', 'NOT_FEFO' => 'Fuera de FEFO', 'EXCESS' => 'Exceso', 'DUPLICATE' => 'Etiqueta repetida',
        'LOAD_ORDER' => 'Fuera de orden de carga', 'UNKNOWN' => 'Código desconocido'];

    public const BOLSAS = ['BAG' => 'bolsa', 'THERMAL_BOX' => 'caja térmica', 'BOX' => 'caja', 'COOLER' => 'cooler'];

    /** Estados del pedido en los que se puede armar. */
    public const PEDIDO_ARMABLE = ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED'];

    public static function tarea(string $s): string
    {
        return self::TAREA[$s] ?? $s;
    }

    public static function ola(string $s): string
    {
        return self::OLA[$s] ?? $s;
    }

    public static function hoy(): string
    {
        return CarbonImmutable::now('America/Lima')->toDateString();
    }

    public static function q(mixed $v, int $d = 3): float
    {
        return round((float) $v, $d);
    }

    /** «1,720 kg» o «3 u». */
    public static function cant(float $q, ?string $modo): string
    {
        return $modo === 'KG' ? number_format($q, 3, ',', '.').' kg' : number_format($q, abs($q - round($q)) > self::EPS ? 3 : 0, ',', '.').' u';
    }

    public static function fecha(?string $d): string
    {
        return $d ? CarbonImmutable::parse(substr($d, 0, 10))->format('d/m/Y') : '—';
    }

    /** Número corto del pedido para la etiqueta: «P-001045» → «1045». */
    public static function numeroCorto(string $numero): string
    {
        $d = preg_replace('/\D/', '', $numero);

        return $d !== '' ? (string) (int) $d : $numero;
    }

    public static function bool(string $clave, ?string $marca = null, bool $defecto = true): bool
    {
        $v = Params::get($clave, $marca ? ['brand' => $marca] : []);
        if ($v === null || $v === '') {
            return $defecto;
        }

        return in_array(strtolower((string) $v), ['true', '1', 'si', 'sí', 'yes'], true);
    }

    public static function num(string $clave, float $defecto, ?string $marca = null): float
    {
        $v = Params::get($clave, $marca ? ['brand' => $marca] : []);

        return $v === null || $v === '' ? $defecto : (float) $v;
    }

    /** Alcance del usuario sobre tareas (marca y local) con la tarea como «t». */
    public static function alcanceTareas(Builder $q, User $u, string $t = 't'): Builder
    {
        $a = Access::for($u);

        return $q->when($a['brands'], fn ($w) => $w->whereIn("{$t}.brand_id", $a['brands']))
            ->when($a['establishments'], fn ($w) => $w->whereIn("{$t}.establishment_id", $a['establishments']));
    }

    /** Alcance del usuario sobre olas (local) con la ola como «w». */
    public static function alcanceOlas(Builder $q, User $u, string $w = 'w'): Builder
    {
        $a = Access::for($u);

        return $q->when($a['establishments'], fn ($x) => $x->whereIn("{$w}.establishment_id", $a['establishments']));
    }

    public static function veLocal(User $u, string $establecimiento): bool
    {
        $a = Access::for($u);

        return ! $a['establishments'] || in_array($establecimiento, $a['establishments'], true);
    }

    public static function veTarea(object $t, User $u): bool
    {
        $a = Access::for($u);

        return (! $a['brands'] || in_array($t->brand_id, $a['brands'], true)) && self::veLocal($u, $t->establishment_id);
    }

    /** Siguiente número de ola («OLA-0052»), por empresa, con candado de la transacción. */
    public static function numeroOla(): string
    {
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['pre:ola:'.DB::selectOne('SELECT app_tenant_id() AS t')->t]);
        $max = DB::table('picking_waves')->where('number', 'like', 'OLA-%')
            ->selectRaw("max(nullif(regexp_replace(substr(number, 5), '\\D', '', 'g'), '')::int) AS n")->value('n');

        return 'OLA-'.str_pad((string) (((int) $max) + 1), 4, '0', STR_PAD_LEFT);
    }

    /** Aviso en el centro de notificaciones: a una persona (user_id) o a un rol. */
    public static function avisar(array $para, string $titulo, string $cuerpo, string $pantalla, ?string $id, string $tono = 'warn'): void
    {
        DB::table('notifications')->insert($para + [
            'title' => mb_substr($titulo, 0, 255), 'body' => $cuerpo, 'ref' => json_encode(array_filter(['screen' => $pantalla, 'id' => $id])),
            'tone' => $tono, 'severity' => match ($tono) {
                'bad' => 'CRITICAL', 'warn' => 'WARNING', 'ok' => 'OK', default => 'INFO'
            },
            'module' => 'PRE', 'type' => 'ORDERS', 'at' => now(), 'in_app' => true,
        ]);
    }

    /** Nombre del cliente del pedido. */
    public static function cliente(?string $customerId): ?string
    {
        if (! $customerId) {
            return null;
        }
        $c = DB::table('customers')->where('id', $customerId)->first(['trade_name', 'full_name']);

        return $c ? ($c->trade_name ?: $c->full_name) : null;
    }
}
