<?php

namespace App\Modulos\Sus\Services;

use App\Modulos\Ops\Services\Consola;
use App\Modulos\Ops\Services\Planes;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * SUS-10 Complementos (consola; administración y cobranza, plans.manage). Un complemento enciende un módulo que no es
 * del núcleo o suma unidades a un límite (usuarios, marcas, locales). Nace en borrador; se publica con precio
 * (RN-SUS-01); retirado ya no se contrata, pero quien lo tiene lo conserva hasta quitarlo.
 */
final class Complementos
{
    public const ESTADOS = ['DRAFT' => 'Borrador', 'PUBLISHED' => 'Publicado', 'RETIRED' => 'Retirado'];

    public const LIMITES = ['users' => 'usuarios', 'brands' => 'marcas', 'sites' => 'locales'];

    public static function lista(): array
    {
        $catalogo = Planes::modulos();
        $contratos = DB::table('subscription_addons')->where('status', 'ACTIVE')->selectRaw('addon_code, count(*) AS n, sum(quantity) AS q')->groupBy('addon_code')->get()->keyBy('addon_code');

        return [
            'data' => DB::table('saas_addons')->orderBy('sort_order')->orderBy('name')->get()->map(fn ($a) => [
                'code' => $a->code, 'name' => $a->name, 'description' => $a->description, 'kind' => $a->kind, 'module_code' => $a->module_code,
                'module_name' => $a->module_code ? ($catalogo[$a->module_code]['name'] ?? $a->module_code) : null, 'limit_key' => $a->limit_key,
                'limit_name' => $a->limit_key ? self::LIMITES[$a->limit_key] : null, 'unit_qty' => $a->unit_qty,
                'price_pen' => $a->price_pen !== null ? (float) $a->price_pen : null, 'status' => $a->status, 'status_name' => self::ESTADOS[$a->status],
                'empresas' => (int) ($contratos[$a->code]->n ?? 0), 'updated_by_name' => $a->updated_by_name, 'updated_at' => $a->updated_at,
            ])->all(),
            'modulos' => array_values(array_map(fn ($m) => ['code' => $m['code'], 'name' => $m['name']], array_filter($catalogo, fn ($m) => ! $m['is_core']))),
        ];
    }

    /** Crea uno nuevo o cambia uno en borrador. Uno publicado solo cambia su nombre y descripción (el precio queda). */
    public static function guardar(array $quien, array $d, ?string $code = null): array
    {
        Consola::exigir($quien, 'plans.manage');
        $actual = $code ? DB::table('saas_addons')->where('code', $code)->first() : null;
        if ($code && ! $actual) {
            abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        }
        if (! $code && DB::table('saas_addons')->where('code', $d['code'])->exists()) {
            RuleError::fail('RN-SUS-01', 'Ya hay un complemento con ese código.');
        }
        if ($actual && $actual->status !== 'DRAFT') {
            DB::table('saas_addons')->where('code', $code)->update(['name' => trim($d['name']), 'description' => $d['description'] ?? null,
                'updated_by_name' => $quien['full_name'], 'updated_at' => now()]);
        } else {
            if ($d['kind'] === 'MODULE') {
                $m = Planes::modulos()[$d['module_code'] ?? ''] ?? null;
                if (! $m || $m['is_core']) {
                    RuleError::fail('RN-SUS-01', 'Elige un módulo que no sea del núcleo (el núcleo va en todos los planes).');
                }
            }
            $fila = ['name' => trim($d['name']), 'description' => $d['description'] ?? null, 'kind' => $d['kind'],
                'module_code' => $d['kind'] === 'MODULE' ? $d['module_code'] : null, 'limit_key' => $d['kind'] === 'LIMIT' ? $d['limit_key'] : null,
                'unit_qty' => $d['kind'] === 'LIMIT' ? (int) $d['unit_qty'] : 1, 'price_pen' => $d['price_pen'] ?? null,
                'updated_by_name' => $quien['full_name'], 'updated_at' => now()];
            $actual ? DB::table('saas_addons')->where('code', $code)->update($fila)
                : DB::table('saas_addons')->insert($fila + ['code' => strtoupper($d['code']), 'status' => 'DRAFT', 'sort_order' => 100, 'created_at' => now()]);
        }
        $code ??= strtoupper($d['code']);
        Consola::bitacora('ADDON_SAVED', $quien, ['entity' => 'saas_addons', 'entity_id' => $code, 'reason' => trim($d['name'])]);

        return self::uno($code);
    }

    public static function publicar(string $code, array $quien): array
    {
        Consola::exigir($quien, 'plans.manage');
        $a = DB::table('saas_addons')->where('code', $code)->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        if ($a->status !== 'DRAFT') {
            RuleError::fail('RN-SUS-01', 'Solo se publica un complemento en borrador.');
        }
        if (! $a->price_pen || (float) $a->price_pen <= 0) {
            RuleError::fail('RN-SUS-01', 'Un complemento se publica con su precio (D-SUS-01).');
        }
        DB::table('saas_addons')->where('code', $code)->update(['status' => 'PUBLISHED', 'updated_by_name' => $quien['full_name'], 'updated_at' => now()]);
        Consola::bitacora('ADDON_PUBLISHED', $quien, ['entity' => 'saas_addons', 'entity_id' => $code, 'reason' => "{$a->name} a S/ {$a->price_pen}"]);

        return self::uno($code);
    }

    public static function retirar(string $code, array $quien): array
    {
        Consola::exigir($quien, 'plans.manage');
        $a = DB::table('saas_addons')->where('code', $code)->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        if ($a->status !== 'PUBLISHED') {
            RuleError::fail('RN-SUS-01', 'Solo se retira un complemento publicado.');
        }
        DB::table('saas_addons')->where('code', $code)->update(['status' => 'RETIRED', 'updated_by_name' => $quien['full_name'], 'updated_at' => now()]);
        Consola::bitacora('ADDON_RETIRED', $quien, ['entity' => 'saas_addons', 'entity_id' => $code, 'reason' => $a->name]);

        return self::uno($code);
    }

    private static function uno(string $code): array
    {
        return collect(self::lista()['data'])->firstWhere('code', $code);
    }
}
