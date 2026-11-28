<?php

namespace App\Modulos\Caj\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Params;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/** Lo común de CAJ: textos, montos, alcance por marca y local, números y parámetros. */
final class Base
{
    public const EPS = 0.005;

    public const TIPOS = [
        'CASH_REGISTER' => 'Caja de efectivo', 'PETTY_CASH' => 'Caja chica', 'BANK' => 'Cuenta bancaria', 'WALLET' => 'Billetera (Yape o Plin)',
        'GATEWAY' => 'Pasarela de pago', 'CARD_ACQUIRER' => 'POS de tarjeta (adquirente)', 'DRIVER_CASH' => 'Caja del repartidor',
    ];

    /** Tipos de cuenta a los que puede ir cada clase de medio de pago (RN-CAJ-01). */
    public const CUENTAS_DEL_MEDIO = [
        'CASH' => ['CASH_REGISTER', 'PETTY_CASH'], 'WALLET' => ['WALLET'], 'CARD' => ['CARD_ACQUIRER'],
        'GATEWAY' => ['GATEWAY'], 'BANK' => ['BANK'],
    ];

    public const CONCILIACION = ['PENDING' => 'Por conciliar', 'MATCHED' => 'Conciliado', 'DIFFERENCE' => 'Con diferencia', 'NOT_APPLICABLE' => 'No aplica'];

    public const ESTADOS_COBRO = ['CONFIRMED' => 'Vigente', 'REVERSED' => 'Revertido'];

    public const ORIGENES = ['CAJ' => 'Caja', 'POS' => 'Mostrador', 'DEL' => 'Contra entrega', 'WEB' => 'Tienda web'];

    public static function hoy(): string
    {
        return CarbonImmutable::now('America/Lima')->toDateString();
    }

    public static function r(mixed $n): float
    {
        return round((float) $n, 2);
    }

    public static function soles(float $n): string
    {
        return ($n < 0 ? '−' : '').'S/ '.number_format(abs($n), 2, '.', ',');
    }

    public static function num(string $clave, float $defecto, array $alcance = []): float
    {
        $v = Params::get($clave, $alcance);

        return is_numeric($v) ? (float) $v : $defecto;
    }

    public static function marcas(User $u): array
    {
        return Access::for($u)['brands'];
    }

    public static function locales(User $u): array
    {
        return Access::for($u)['establishments'];
    }

    /** Filtra por las marcas y locales del usuario (vacío = todos). */
    public static function alcance(Builder $q, User $u, ?string $marca = 'p.brand_id', ?string $local = 'p.establishment_id'): Builder
    {
        $m = self::marcas($u);
        $l = self::locales($u);

        return $q->when($marca && $m, fn ($w) => $w->whereIn($marca, $m))->when($local && $l, fn ($w) => $w->whereIn($local, $l));
    }

    public static function enAlcance(User $u, ?string $marca, ?string $local): bool
    {
        $m = self::marcas($u);
        $l = self::locales($u);

        return (! $m || ! $marca || in_array($marca, $m, true)) && (! $l || ! $local || in_array($local, $l, true));
    }

    /** Número correlativo por empresa con candado: CB-000001 (cobros, la misma serie que el mostrador y el reparto). */
    public static function numero(string $tabla, string $prefijo, int $digitos = 6, string $columna = 'number'): string
    {
        $clave = $tabla === 'payments' ? 'caj:cobro:' : "caj:{$tabla}:";
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', [$clave.DB::selectOne('SELECT app_tenant_id() AS t')->t]);
        $n = strlen($prefijo) + 1;
        $max = DB::table($tabla)->where($columna, 'like', $prefijo.'%')
            ->selectRaw("max(nullif(regexp_replace(substr({$columna}, {$n}), '\\D', '', 'g'), '')::int) AS n")->value('n');

        return $prefijo.str_pad((string) (((int) $max) + 1), $digitos, '0', STR_PAD_LEFT);
    }

    /** Candado por cliente para que dos usos del saldo a favor no lo dejen negativo (RN-CAJ-08). */
    public static function candadoCliente(string $clienteId): void
    {
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['caj:saldo:'.$clienteId]);
    }

    public static function motivo(?string $motivo, string $regla, string $texto, int $min = 5): string
    {
        $m = trim((string) $motivo);
        if (mb_strlen($m) < $min) {
            RuleError::fail($regla, $texto);
        }

        return mb_substr($m, 0, 255);
    }

    public static function fecha(?string $f, ?string $defecto = null): string
    {
        return $f && preg_match('/^\d{4}-\d{2}-\d{2}$/', $f) ? $f : ($defecto ?? self::hoy());
    }

    public static function avisar(array $para, string $titulo, string $cuerpo, string $pantalla, ?string $id, string $tono = 'warn'): void
    {
        DB::table('notifications')->insert($para + [
            'title' => mb_substr($titulo, 0, 255), 'body' => $cuerpo, 'ref' => json_encode(array_filter(['screen' => $pantalla, 'id' => $id])),
            'tone' => $tono, 'severity' => match ($tono) {
                'bad' => 'CRITICAL', 'warn' => 'WARNING', 'ok' => 'OK', default => 'INFO'
            },
            'module' => 'CAJ', 'type' => 'PAYMENTS', 'at' => now(), 'in_app' => true,
        ]);
    }
}
