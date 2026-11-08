<?php

namespace App\Modulos\Cat\Services;

use App\Support\Params;
use Carbon\CarbonImmutable;

/**
 * Semáforo del registro sanitario de un producto (RN-CAT-09). Lo usan CAT-01, CAT-10 y el aviso de PED:
 *   RegistroSanitario::estado($producto);   // ['code' => 'AMBER', 'label' => 'Vence en 60 días', 'tone' => 'warn', 'days' => 60]
 *
 * Códigos: NA (no requiere), MISSING (sin número o sin vencimiento), EXPIRED (vence hoy o ya venció),
 * RED (30 días o menos), AMBER (dentro de cat_sanitary_alert_days, 90 por defecto) y OK.
 */
final class RegistroSanitario
{
    public const POR_VENCER = ['AMBER', 'RED', 'EXPIRED'];

    /** Días de aviso de la empresa (cat_sanitary_alert_days). */
    public static function diasAviso(): int
    {
        return (int) (Params::get('cat_sanitary_alert_days') ?? 90);
    }

    /**
     * @param  object|array  $p  producto con sanitary_authority, sanitary_registry, sanitary_registry_expires y sanitary_alert_days
     * @return array{code: string, label: string, tone: string, days: int|null}
     */
    public static function estado(object|array $p, ?string $hoy = null, ?int $aviso = null): array
    {
        $p = (object) $p;
        if (! $p->sanitary_authority || $p->sanitary_authority === 'NONE') {
            return ['code' => 'NA', 'label' => 'No requiere', 'tone' => 'neutral', 'days' => null];
        }
        if (! $p->sanitary_registry || ! $p->sanitary_registry_expires) {
            return ['code' => 'MISSING', 'label' => 'Sin registro', 'tone' => 'bad', 'days' => null];
        }

        $hoy = CarbonImmutable::parse($hoy ?? now()->toDateString())->startOfDay();
        $vence = CarbonImmutable::parse(substr((string) $p->sanitary_registry_expires, 0, 10))->startOfDay();
        $dias = (int) $hoy->diffInDays($vence, false);
        // Un producto puede tener sus propios días de aviso; si no, rigen los de la empresa.
        $propio = (int) ($p->sanitary_alert_days ?? 0);
        $aviso = $propio > 0 ? $propio : ($aviso ?? self::diasAviso());

        return match (true) {
            $dias < 0 => ['code' => 'EXPIRED', 'label' => 'Vencido hace '.self::dias(-$dias), 'tone' => 'bad', 'days' => $dias],
            $dias === 0 => ['code' => 'EXPIRED', 'label' => 'Vence hoy', 'tone' => 'bad', 'days' => 0],
            $dias <= 30 => ['code' => 'RED', 'label' => 'Vence en '.self::dias($dias), 'tone' => 'bad', 'days' => $dias],
            $dias <= $aviso => ['code' => 'AMBER', 'label' => 'Vence en '.self::dias($dias), 'tone' => 'warn', 'days' => $dias],
            default => ['code' => 'OK', 'label' => 'Vigente', 'tone' => 'ok', 'days' => $dias],
        };
    }

    private static function dias(int $n): string
    {
        return $n === 1 ? '1 día' : "{$n} días";
    }
}
