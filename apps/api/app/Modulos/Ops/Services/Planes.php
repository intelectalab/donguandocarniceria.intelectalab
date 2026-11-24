<?php

namespace App\Modulos\Ops\Services;

use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * SUS-09 Catálogo de planes (consola). Cada plan tiene versiones: un borrador que se edita, una publicada que se
 * vende y las retiradas. Publicado no cambia (RN-SUS-02): el cambio es una versión nueva. Para publicar hace falta
 * precio, al menos un módulo y que las dependencias de cada módulo estén en el plan o en el núcleo (RN-SUS-01).
 * Publicar y retirar pasan por funciones de la base (saas_plans es de solo lectura para la aplicación).
 */
final class Planes
{
    public const ESTADOS = ['DRAFT' => 'Borrador', 'PUBLISHED' => 'Publicado', 'RETIRED' => 'Retirado'];

    public static function catalogo(): array
    {
        $modulos = self::modulos();
        $enUso = DB::table('subscriptions')->where('status', '<>', 'CANCELLED')->whereNotNull('plan_version_id')
            ->selectRaw('plan_version_id, count(*) n')->groupBy('plan_version_id')->pluck('n', 'plan_version_id');

        $planes = DB::table('saas_plan_versions')->orderBy('sort_order')->orderBy('plan_code')->orderByDesc('version')->get()
            ->groupBy('plan_code')->map(function ($versiones, $codigo) use ($modulos, $enUso) {
                $lista = $versiones->map(fn ($v) => self::version($v, $modulos, (int) ($enUso[$v->id] ?? 0)))->values();

                return [
                    'code' => $codigo,
                    'name' => $lista->firstWhere('status', 'PUBLISHED')['name'] ?? $lista->first()['name'],
                    'publicada' => $lista->firstWhere('status', 'PUBLISHED'),
                    'borrador' => $lista->firstWhere('status', 'DRAFT'),
                    'retiradas' => $lista->where('status', 'RETIRED')->values(),
                ];
            })->values();

        return ['planes' => $planes, 'modulos' => array_values($modulos)];
    }

    /** Borrador nuevo: de un plan nuevo (código y nombre) o la versión siguiente de uno existente (copia la publicada). */
    public static function nuevoBorrador(array $d, array $quien): array
    {
        Consola::exigir($quien, 'plans.manage');
        $codigo = mb_strtoupper(trim($d['plan_code']));
        $base = DB::table('saas_plan_versions')->where('plan_code', $codigo)->orderByDesc('version')->first();
        if (DB::table('saas_plan_versions')->where('plan_code', $codigo)->where('status', 'DRAFT')->exists()) {
            RuleError::fail('RN-SUS-02', 'Ese plan ya tiene un borrador: edítalo o bórralo.');
        }
        if (! empty($d['nuevo']) && $base) {
            RuleError::fail('RN-SUS-01', 'Ya existe un plan con ese código.');
        }
        $publicada = DB::table('saas_plan_versions')->where('plan_code', $codigo)->where('status', 'PUBLISHED')->first() ?? $base;
        $fila = $publicada ? (array) $publicada : [
            'name' => trim($d['name'] ?? $codigo), 'description' => 'Describe a quién va dirigido.', 'price_pen' => 0, 'users_max' => 5, 'brands_max' => 1,
            'sites_max' => 1, 'all_modules' => false, 'modules' => '[]', 'highlights' => '[]', 'includes_previous' => null, 'is_featured' => false, 'sort_order' => 9,
        ];
        $id = DB::table('saas_plan_versions')->insertGetId([
            'plan_code' => $codigo, 'version' => ($base->version ?? 0) + 1, 'status' => 'DRAFT', 'name' => $fila['name'], 'description' => $fila['description'],
            'price_pen' => $fila['price_pen'], 'users_max' => $fila['users_max'], 'brands_max' => $fila['brands_max'], 'sites_max' => $fila['sites_max'],
            'all_modules' => $fila['all_modules'], 'modules' => $fila['modules'], 'highlights' => $fila['highlights'], 'includes_previous' => $fila['includes_previous'],
            'is_featured' => $fila['is_featured'], 'sort_order' => $fila['sort_order'], 'created_by' => $quien['id'], 'created_at' => now(),
        ], 'id');
        Consola::bitacora('PLAN_DRAFT_CREATED', $quien, ['entity' => 'saas_plan_versions', 'entity_id' => $id, 'reason' => "Borrador del plan {$codigo}"]);

        return self::version(DB::table('saas_plan_versions')->where('id', $id)->first(), self::modulos(), 0);
    }

    public static function editarBorrador(string $id, array $d, array $quien): array
    {
        Consola::exigir($quien, 'plans.manage');
        $v = self::borrador($id);
        $modulos = self::modulos();
        $elegidos = array_values(array_unique(array_filter($d['modules'] ?? [], fn ($m) => isset($modulos[$m]) && ! $modulos[$m]['is_core'])));
        sort($elegidos);
        DB::table('saas_plan_versions')->where('id', $v->id)->update([
            'name' => trim($d['name']), 'description' => trim($d['description']), 'price_pen' => $d['price_pen'], 'users_max' => $d['users_max'],
            'brands_max' => $d['brands_max'], 'sites_max' => $d['sites_max'], 'all_modules' => (bool) $d['all_modules'],
            'modules' => json_encode($d['all_modules'] ? [] : $elegidos), 'highlights' => json_encode(array_values(array_filter(array_map('trim', $d['highlights'] ?? [])))),
            'includes_previous' => $d['includes_previous'] ?? null, 'is_featured' => (bool) ($d['is_featured'] ?? false), 'sort_order' => $d['sort_order'] ?? 9,
            'updated_at' => now(),
        ]);

        return self::version(DB::table('saas_plan_versions')->where('id', $v->id)->first(), $modulos, 0);
    }

    public static function publicar(string $id, array $quien): void
    {
        Consola::exigir($quien, 'plans.manage');
        $v = self::borrador($id);
        $fila = self::version($v, self::modulos(), 0);
        if ((float) $v->price_pen <= 0) {
            RuleError::fail('RN-SUS-01', 'Para publicar, el plan necesita un precio mayor que cero.');
        }
        if (! $v->all_modules && ! $fila['modules']) {
            RuleError::fail('RN-SUS-01', 'Para publicar, el plan necesita al menos un módulo.');
        }
        if ($fila['faltan']) {
            RuleError::fail('RN-SUS-01', 'Faltan módulos de los que dependen otros del plan: '.collect($fila['faltan'])
                ->map(fn ($f) => "{$f['modulo']} necesita ".implode(', ', $f['faltan']))->join('; ').'.');
        }
        DB::select('SELECT platform_publish_plan_version(?, ?)', [$v->id, $quien['id']]);
        Consola::bitacora('PLAN_PUBLISHED', $quien, ['entity' => 'saas_plan_versions', 'entity_id' => $v->id, 'reason' => "Publicó {$v->plan_code} versión {$v->version}",
            'detail' => ['price_pen' => (float) $v->price_pen, 'modules' => $fila['modules']]]);
    }

    public static function retirar(string $codigo, string $motivo, array $quien): void
    {
        Consola::exigir($quien, 'plans.manage');
        if (! DB::table('saas_plan_versions')->where('plan_code', $codigo)->where('status', 'PUBLISHED')->exists()) {
            RuleError::fail('RN-SUS-02', 'Ese plan no tiene una versión publicada.');
        }
        DB::select('SELECT platform_retire_plan(?, ?)', [$codigo, $quien['id']]);
        Consola::bitacora('PLAN_RETIRED', $quien, ['entity' => 'saas_plans', 'entity_id' => $codigo, 'reason' => $motivo]);
    }

    public static function borrarBorrador(string $id, array $quien): void
    {
        Consola::exigir($quien, 'plans.manage');
        $v = self::borrador($id);
        DB::table('saas_plan_versions')->where('id', $v->id)->delete();
        Consola::bitacora('PLAN_DRAFT_DELETED', $quien, ['entity' => 'saas_plan_versions', 'entity_id' => $v->id, 'reason' => "Borrador {$v->plan_code} versión {$v->version}"]);
    }

    /* ------------------------------------------------------------------ internos */

    /** code => módulo con su nombre corto, fase, si es núcleo y de qué depende. */
    public static function modulos(): array
    {
        return DB::table('platform_modules')->orderBy('sort_order')->get()->mapWithKeys(fn ($m) => [$m->code => [
            'code' => $m->code, 'name' => trim(explode(':', $m->name)[0]), 'phase' => $m->phase, 'is_core' => (bool) $m->is_core,
            'depends_on' => json_decode($m->depends_on, true) ?: [],
        ]])->all();
    }

    private static function borrador(string $id): object
    {
        $v = DB::table('saas_plan_versions')->where('id', $id)->first();
        if (! $v) {
            abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        }
        if ($v->status !== 'DRAFT') {
            RuleError::fail('RN-SUS-02', 'Un plan publicado o retirado no cambia: crea una versión nueva.');
        }

        return $v;
    }

    /** Versión para la consola, con las dependencias que le faltan (RN-SUS-01). */
    private static function version(object $v, array $modulos, int $suscripciones): array
    {
        $nucleo = array_keys(array_filter($modulos, fn ($m) => $m['is_core']));
        // Los del núcleo van siempre: aquí solo los propios del plan (las versiones viejas los traían en la lista).
        $propios = $v->all_modules ? array_keys(array_filter($modulos, fn ($m) => ! $m['is_core']))
            : array_values(array_diff(json_decode($v->modules, true) ?: [], $nucleo));
        $tiene = array_flip([...$propios, ...$nucleo]);
        $faltan = [];
        foreach ($propios as $m) {
            $sin = array_values(array_filter($modulos[$m]['depends_on'] ?? [], fn ($dep) => ! isset($tiene[$dep])));
            if ($sin) {
                $faltan[] = ['modulo' => $m, 'faltan' => $sin];
            }
        }

        return [
            'id' => $v->id, 'plan_code' => $v->plan_code, 'version' => $v->version, 'status' => $v->status, 'status_name' => self::ESTADOS[$v->status],
            'name' => $v->name, 'description' => $v->description, 'price_pen' => (float) $v->price_pen, 'users_max' => $v->users_max,
            'brands_max' => $v->brands_max, 'sites_max' => $v->sites_max, 'all_modules' => (bool) $v->all_modules, 'modules' => $propios,
            'highlights' => json_decode($v->highlights, true) ?: [], 'includes_previous' => $v->includes_previous, 'is_featured' => (bool) $v->is_featured,
            'sort_order' => $v->sort_order, 'published_at' => $v->published_at, 'retired_at' => $v->retired_at, 'faltan' => $faltan,
            'suscripciones' => $suscripciones,
        ];
    }
}
