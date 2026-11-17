<?php

namespace App\Modulos\Mae\Services;

use App\Models\User;
use App\Modulos\Mae\Services\TipoCambio\FuenteTipoCambio;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * MAE-05: tipo de cambio diario.
 *
 *  RN-MAE-06  único por fecha y moneda; compra y venta > 0 y la compra no supera a la venta (también en la base).
 *  RN-MAE-07  sin publicación del día se usa el último publicado dentro de mae_fx_max_fallback_days (7); si no hay,
 *             el documento no se graba: para().
 *  RN-MAE-08  corregir uno ya cargado pide motivo de 10 caracteres o más y mae.exchange_rate.edit (la ruta); queda
 *             en la auditoría.
 *  RN-MAE-14  carga automática a las mae_fx_load_time desde la fuente (conector FX de INT); tras tres fallos avisa
 *             a administración (comando mae:cargar-tipo-cambio).
 *
 * Para otros módulos (GAS, COM, FAC): TiposDeCambio::para($fecha, 'USD') devuelve la venta que usa el documento.
 */
final class TiposDeCambio
{
    /** Hoy en Lima. */
    public static function hoy(): string
    {
        return now('America/Lima')->toDateString();
    }

    /** Feriados nacionales del Perú del año (fijos más Jueves y Viernes Santo): ese día SUNAT no publica. */
    public static function feriados(int $anio): array
    {
        $f = [
            "{$anio}-01-01" => 'Año Nuevo', "{$anio}-05-01" => 'Día del Trabajo', "{$anio}-06-07" => 'Batalla de Arica y Día de la Bandera',
            "{$anio}-06-29" => 'San Pedro y San Pablo', "{$anio}-07-23" => 'Día de la Fuerza Aérea', "{$anio}-07-28" => 'Fiestas Patrias',
            "{$anio}-07-29" => 'Fiestas Patrias', "{$anio}-08-06" => 'Batalla de Junín', "{$anio}-08-30" => 'Santa Rosa de Lima',
            "{$anio}-10-08" => 'Combate de Angamos', "{$anio}-11-01" => 'Todos los Santos', "{$anio}-12-08" => 'Inmaculada Concepción',
            "{$anio}-12-09" => 'Batalla de Ayacucho', "{$anio}-12-25" => 'Navidad',
        ];
        // Domingo de Pascua (algoritmo de Meeus, calendario gregoriano).
        $a = $anio % 19;
        $b = intdiv($anio, 100);
        $c = $anio % 100;
        $d = intdiv($b, 4);
        $e = $b % 4;
        $g = intdiv(8 * $b + 13, 25);
        $h = (19 * $a + $b - $d - $g + 15) % 30;
        $i = intdiv($c, 4);
        $k = $c % 4;
        $l = (32 + 2 * $e + 2 * $i - $h - $k) % 7;
        $m = intdiv($a + 11 * $h + 19 * $l, 433);
        $mes = intdiv($h + $l - 7 * $m + 90, 25);
        $dia = ($h + $l - 7 * $m + 33 * $mes + 19) % 32;
        $pascua = strtotime(sprintf('%04d-%02d-%02d', $anio, $mes, $dia));
        $f[date('Y-m-d', strtotime('-3 days', $pascua))] = 'Jueves Santo';
        $f[date('Y-m-d', strtotime('-2 days', $pascua))] = 'Viernes Santo';
        ksort($f);

        return $f;
    }

    public static function feriado(string $fecha): ?string
    {
        return self::feriados((int) substr($fecha, 0, 4))[$fecha] ?? null;
    }

    /** Día hábil: de lunes a viernes y no feriado. */
    public static function esHabil(string $fecha): bool
    {
        return (int) date('N', strtotime($fecha)) <= 5 && ! self::feriado($fecha);
    }

    public static function delDia(string $fecha, string $moneda = 'USD'): ?object
    {
        return DB::table('exchange_rates')->where(['date' => $fecha, 'currency' => $moneda])->first();
    }

    /**
     * RN-MAE-07: tipo de cambio que usa un documento de esa fecha.
     *
     * @return array{buy: float, sell: float, fecha_usada: string, respaldo: bool}
     */
    public static function para(string $fecha, string $moneda = 'USD'): array
    {
        $fecha = substr($fecha, 0, 10);
        $dias = max(0, (int) (Params::get('mae_fx_max_fallback_days') ?? 7));
        $usarAnterior = (string) (Params::get('mae_fx_use_previous_published') ?? 'true') !== 'false';
        $desde = date('Y-m-d', strtotime("{$fecha} -{$dias} days"));
        $r = DB::table('exchange_rates')->where('currency', $moneda)->where('date', '<=', $fecha)
            ->where('date', '>=', $usarAnterior ? $desde : $fecha)->orderByDesc('date')->first();
        if (! $r) {
            $f = date('d/m/Y', strtotime($fecha));
            RuleError::fail('RN-MAE-07', "No hay tipo de cambio {$moneda} del {$f} ni publicado en los {$dias} días anteriores: el documento no se graba. Cárgalo en MAE-05.");
        }

        return ['buy' => (float) $r->buy, 'sell' => (float) $r->sell, 'fecha_usada' => $r->date, 'respaldo' => $r->date !== $fecha];
    }

    /** Monto en soles con la venta que corresponde a la fecha (RN-MAE-07). */
    public static function aSoles(float $monto, string $fecha, string $moneda = 'USD'): array
    {
        $tc = self::para($fecha, $moneda);

        return $tc + ['soles' => round($monto * $tc['sell'], 2)];
    }

    /**
     * RN-MAE-06 y RN-MAE-08: registra el tipo de cambio de una fecha o corrige el ya cargado (con motivo).
     */
    public static function registrar(array $d, string $via, ?User $quien): object
    {
        $moneda = $d['currency'] ?? 'USD';
        $compra = round((float) $d['buy'], 4);
        $venta = round((float) $d['sell'], 4);
        if ($compra <= 0 || $venta <= 0) {
            RuleError::fail('RN-MAE-06', 'La compra y la venta son mayores que cero.');
        }
        if ($compra > $venta) {
            RuleError::fail('RN-MAE-06', 'La compra no puede ser mayor que la venta.');
        }
        if ($d['date'] > self::hoy()) {
            RuleError::fail('RN-MAE-06', 'No se registra el tipo de cambio de una fecha futura.');
        }
        $quienNombre = $quien ? mb_substr($quien->name, 0, 80) : 'Carga automática';

        return DB::transaction(function () use ($d, $moneda, $compra, $venta, $via, $quien, $quienNombre) {
            $actual = DB::table('exchange_rates')->where(['date' => $d['date'], 'currency' => $moneda])->lockForUpdate()->first();
            if ($actual) {
                $motivo = trim((string) ($d['reason'] ?? ''));
                if (mb_strlen($motivo) < 10) {
                    RuleError::fail('RN-MAE-08', 'Corregir un tipo de cambio ya cargado exige un motivo de al menos 10 caracteres.');
                }
                DB::table('exchange_rates')->where('id', $actual->id)->update([
                    'buy' => $compra, 'sell' => $venta, 'edit_reason' => mb_substr($motivo, 0, 255), 'edited_by' => $quienNombre, 'updated_at' => now(),
                ]);
                Events::emit('exchange_rate.corrected', 'exchange_rates', $actual->id, ['date' => $d['date'], 'currency' => $moneda, 'by' => $quien?->id, 'reason' => $motivo]);

                return DB::table('exchange_rates')->find($actual->id);
            }
            $id = DB::table('exchange_rates')->insertGetId([
                'date' => $d['date'], 'currency' => $moneda, 'buy' => $compra, 'sell' => $venta, 'source' => $via, 'loaded_via' => $via,
                'published_on' => $d['published_on'] ?? $d['date'], 'loaded_by' => $quienNombre,
            ]);
            Events::emit('exchange_rate.loaded', 'exchange_rates', $id, ['date' => $d['date'], 'currency' => $moneda, 'via' => $via]);

            return DB::table('exchange_rates')->find($id);
        });
    }

    /**
     * RN-MAE-14: carga el tipo de cambio de la fecha desde la fuente. Si ya está cargado, no hace nada.
     *
     * @return array{cargado: bool, mensaje: string, fila: ?object}
     */
    public static function cargarDeFuente(string $fecha, string $moneda = 'USD'): array
    {
        if ($r = self::delDia($fecha, $moneda)) {
            return ['cargado' => false, 'mensaje' => 'El tipo de cambio de ese día ya estaba cargado.', 'fila' => $r];
        }
        $fuente = app(FuenteTipoCambio::class);
        $p = $fuente->del($fecha, $moneda);
        if (! $p) {
            return ['cargado' => false, 'mensaje' => self::esHabil($fecha) ? "{$fuente->nombre()} no publicó tipo de cambio ese día." : 'Ese día no hay publicación (fin de semana o feriado): se usa el último publicado.', 'fila' => null];
        }
        $fila = self::registrar(['date' => $fecha, 'currency' => $moneda, 'buy' => $p['buy'], 'sell' => $p['sell'], 'published_on' => $p['published_on']], 'SUNAT', null);

        return ['cargado' => true, 'mensaje' => "Tipo de cambio cargado desde {$fuente->nombre()}.", 'fila' => $fila];
    }

    /**
     * KPI-MAE-01: días hábiles del rango (hasta hoy) con tipo de cambio cargado.
     *
     * @return array{valor: float, cargados: int, habiles: int, faltan: string[]}
     */
    public static function cobertura(string $desde, string $hasta, string $moneda = 'USD'): array
    {
        $hasta = min($hasta, self::hoy());
        $cargados = DB::table('exchange_rates')->where('currency', $moneda)->whereBetween('date', [$desde, $hasta])->pluck('date')->flip();
        $habiles = 0;
        $faltan = [];
        for ($d = $desde; $d <= $hasta; $d = date('Y-m-d', strtotime("{$d} +1 day"))) {
            if (self::esHabil($d)) {
                $habiles++;
                if (! isset($cargados[$d])) {
                    $faltan[] = $d;
                }
            }
        }
        $con = $habiles - count($faltan);

        return ['valor' => $habiles ? round($con / $habiles * 100, 1) : 100.0, 'cargados' => $con, 'habiles' => $habiles, 'faltan' => $faltan];
    }
}
