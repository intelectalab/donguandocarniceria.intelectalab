<?php

namespace App\Modulos\Plt\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Colores de cada marca y de la empresa (PLT-06, ui_themes). Cada tema tiene modo claro y oscuro con
 * 7 colores; guardar exige el contraste mínimo en los pares de texto (RN-PLT-15) y deja una versión
 * nueva activa. Una marca sin tema propio usa el de la empresa (RN-PLT-23).
 */
final class Temas
{
    public const COLORES = [
        'primary' => 'Primario', 'primary_dark' => 'Primario oscuro', 'accent' => 'Acento', 'background' => 'Fondo',
        'surface' => 'Superficie', 'text' => 'Texto', 'on_primary' => 'Texto sobre primario',
    ];

    /** Pares que se revisan: [texto, fondo, nombre]. */
    public const PARES = [
        ['text', 'background', 'Texto sobre fondo'],
        ['text', 'surface', 'Texto sobre superficie'],
        ['on_primary', 'primary', 'Texto sobre primario'],
    ];

    public static function minimo(): float
    {
        return (float) (Params::get('plt_ui_min_contrast_ratio') ?? 4.5);
    }

    /** Contraste WCAG 2.x entre dos colores #RRGGBB (1 a 21). */
    public static function contraste(string $a, string $b): float
    {
        $l1 = self::luminancia($a);
        $l2 = self::luminancia($b);

        return round((max($l1, $l2) + 0.05) / (min($l1, $l2) + 0.05), 2);
    }

    /** Revisión de los dos modos: [{modo, par, nombre, ratio, ok}]. */
    public static function revisar(array $claro, array $oscuro): array
    {
        $min = self::minimo();
        $out = [];
        foreach (['LIGHT' => $claro, 'DARK' => $oscuro] as $modo => $t) {
            foreach (self::PARES as [$a, $b, $nombre]) {
                $ratio = self::esHex($t[$a] ?? null) && self::esHex($t[$b] ?? null) ? self::contraste($t[$a], $t[$b]) : 0.0;
                $out[] = ['modo' => $modo, 'par' => "{$a}/{$b}", 'nombre' => $nombre, 'ratio' => $ratio, 'ok' => $ratio >= $min];
            }
        }

        return $out;
    }

    /** El tema activo propio de la marca (o de la empresa con null), si tiene. */
    public static function propio(?string $brandId): ?object
    {
        return self::decodificar(DB::table('ui_themes')->where('status', 'ACTIVE')
            ->where(fn ($q) => $brandId ? $q->where('brand_id', $brandId) : $q->whereNull('brand_id'))
            ->orderByDesc('created_at')->first());
    }

    /** El que rige para la marca: el suyo o, si no tiene, el de la empresa. */
    public static function vigente(?string $brandId): ?object
    {
        return ($brandId ? self::propio($brandId) : null) ?? self::propio(null);
    }

    /**
     * Guarda una versión nueva del tema de la marca (o de la empresa) y desactiva la anterior.
     * Falla si algún color no es #RRGGBB o algún par no llega al contraste mínimo.
     */
    public static function guardar(?string $brandId, array $claro, array $oscuro, User $quien, ?string $nombre = null): object
    {
        $limpiar = fn (array $t) => array_map(fn ($k) => mb_strtoupper(trim((string) ($t[$k] ?? ''))), array_combine(array_keys(self::COLORES), array_keys(self::COLORES)));
        $claro = $limpiar($claro);
        $oscuro = $limpiar($oscuro);

        foreach (['claro' => $claro, 'oscuro' => $oscuro] as $modo => $t) {
            foreach ($t as $k => $v) {
                if (! self::esHex($v)) {
                    RuleError::fail('RN-PLT-15', self::COLORES[$k]." (modo {$modo}) no es un color #RRGGBB.");
                }
            }
        }
        $malos = array_filter(self::revisar($claro, $oscuro), fn ($r) => ! $r['ok']);
        if ($malos) {
            $min = self::numero(self::minimo());
            RuleError::fail('RN-PLT-15', 'El texto no se leería bien: '.implode('; ', array_map(
                fn ($r) => ($r['modo'] === 'LIGHT' ? 'claro' : 'oscuro').' · '.mb_strtolower($r['nombre']).' '.self::numero($r['ratio']).':1', $malos
            ))." (mínimo {$min}:1).");
        }

        return DB::transaction(function () use ($brandId, $claro, $oscuro, $quien, $nombre) {
            $marca = $brandId ? DB::table('brands')->where('id', $brandId)->value('name') : null;
            DB::table('ui_themes')->where('status', 'ACTIVE')
                ->where(fn ($q) => $brandId ? $q->where('brand_id', $brandId) : $q->whereNull('brand_id'))
                ->update(['status' => 'INACTIVE', 'updated_at' => now()]);
            $id = DB::table('ui_themes')->insertGetId([
                'brand_id' => $brandId, 'name' => mb_substr(trim((string) $nombre) ?: ($marca ? "Tema {$marca}" : 'Tema de la empresa'), 0, 80),
                'light' => json_encode($claro), 'dark' => json_encode($oscuro), 'font_family' => 'Source Sans 3', 'radius_px' => 8,
                'status' => 'ACTIVE', 'changed_by' => mb_substr($quien->name, 0, 40),
            ], 'id');
            Events::emit('theme.changed', 'ui_themes', $id, ['brand_id' => $brandId]);

            return self::decodificar(DB::table('ui_themes')->find($id));
        });
    }

    /** La marca deja su tema propio y vuelve a usar el de la empresa. */
    public static function quitar(string $brandId): void
    {
        $n = DB::table('ui_themes')->where('brand_id', $brandId)->where('status', 'ACTIVE')->update(['status' => 'INACTIVE', 'updated_at' => now()]);
        if (! $n) {
            RuleError::fail('RN-PLT-23', 'Esta marca no tiene colores propios: ya usa los de la empresa.');
        }
        Events::emit('theme.changed', 'ui_themes', null, ['brand_id' => $brandId, 'removed' => true]);
    }

    public static function decodificar(?object $t): ?object
    {
        if ($t) {
            $t->light = is_string($t->light) ? json_decode($t->light, true) : $t->light;
            $t->dark = is_string($t->dark) ? json_decode($t->dark, true) : $t->dark;
        }

        return $t;
    }

    private static function esHex(?string $c): bool
    {
        return (bool) preg_match('/^#[0-9A-Fa-f]{6}$/', (string) $c);
    }

    private static function luminancia(string $hex): float
    {
        $canal = function (int $i) use ($hex) {
            $c = hexdec(substr($hex, $i, 2)) / 255;

            return $c <= 0.03928 ? $c / 12.92 : (($c + 0.055) / 1.055) ** 2.4;
        };

        return 0.2126 * $canal(1) + 0.7152 * $canal(3) + 0.0722 * $canal(5);
    }

    private static function numero(float $n): string
    {
        return rtrim(rtrim(number_format($n, 2, '.', ''), '0'), '.');
    }
}
