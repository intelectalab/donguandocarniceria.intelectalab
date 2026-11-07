<?php

namespace App\Modulos\Plt\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Params;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Búsqueda global (PLT-02, RN-PLT-16). Busca en clientes, pedidos, comprobantes, productos,
 * trabajadores, en los datos de Plataforma y en lo que publican los demás módulos (search_entries).
 * Respeta:
 *  - la empresa: todo pasa por RLS;
 *  - los módulos: solo los encendidos que el rol puede ver (Access::module, letra L);
 *  - el alcance: marcas y locales del usuario (Access: brands, establishments);
 *  - el permiso propio de cada entrada publicada (permission_code).
 *
 * Para que un módulo aparezca en la búsqueda sin tocar este archivo:
 *   Busqueda::publicar('TEL', 'call', $llamada->id, 'Llamada de Rosa…', 'Entrante · 4 min', '/m/tel/tel-08',
 *       keywords: 'rosa huaman', brandId: $marca, siteId: $local, permiso: 'tel.call.view_own');
 */
final class Busqueda
{
    public const TIPOS = [
        'customer' => 'Clientes', 'order' => 'Pedidos', 'document' => 'Comprobantes', 'product' => 'Productos',
        'employee' => 'Trabajadores', 'conversation' => 'Conversaciones', 'call' => 'Llamadas', 'setting' => 'Plataforma', 'other' => 'Otros',
    ];

    /** @return array{q: string, min: int, corta: bool, total: int, resultados: array, por_tipo: array} */
    public static function buscar(string $q, User $quien): array
    {
        $min = (int) (Params::get('plt_search_min_chars') ?? 3);
        $max = (int) (Params::get('plt_search_max_results') ?? 20);
        $q = trim(mb_substr($q, 0, 100));
        $base = ['q' => $q, 'min' => $min, 'corta' => mb_strlen($q) < $min, 'total' => 0, 'resultados' => [], 'por_tipo' => []];
        if ($base['corta'] || ! Access::can($quien, 'plt.search.use')) {
            return $base;
        }

        $a = Access::for($quien);
        $ve = fn (string $m) => Access::module($quien, $m, 'L');
        $patron = '%'.addcslashes(self::plano($q), '%_\\').'%';
        $marcas = $a['brands'];
        $locales = $a['establishments'];
        $porTipo = $max; // cada fuente trae hasta el máximo; después se reparte entre tipos

        $hallados = [];
        $agregar = function (string $tipo, string $modulo, iterable $filas) use (&$hallados) {
            foreach ($filas as $f) {
                $hallados[] = ['tipo' => $tipo, 'modulo' => $modulo] + (array) $f;
            }
        };

        if ($ve('CLI')) {
            $agregar('customer', 'CLI', self::filtrar(DB::table('customers'), ['full_name', 'trade_name', 'doc_number', 'phone'], $patron)
                ->when($marcas, fn ($w) => $w->where(fn ($x) => $x->whereNull('segment_brands')->orWhereRaw("segment_brands = '[]'::jsonb")
                    ->orWhereRaw('jsonb_exists_any(segment_brands, ?::text[])', ['{'.implode(',', $marcas).'}'])))
                ->orderByDesc('last_order_at')->limit($porTipo)
                ->get(['id', DB::raw('coalesce(trade_name, full_name) as titulo'),
                    DB::raw("concat_ws(' · ', nullif(concat_ws(' ', nullif(doc_type, 'NONE'), doc_number), ''), phone, case when orders_count = 1 then '1 pedido' when orders_count > 1 then orders_count || ' pedidos' end) as detalle"),
                    DB::raw('last_order_at as fecha')]));
        }
        if ($ve('PED')) {
            $agregar('order', 'PED', self::alcance(self::filtrar(DB::table('sales_orders as o')->leftJoin('customers as c', 'c.id', '=', 'o.customer_id'),
                ['o.number', 'o.external_ref', 'c.full_name', 'c.trade_name'], $patron), 'o', $marcas, $locales)
                ->orderByDesc('o.created_at')->limit($porTipo)
                ->get(['o.id', DB::raw("concat_ws(' · ', o.number, coalesce(c.trade_name, c.full_name)) as titulo"),
                    DB::raw("concat_ws(' · ', o.status, 'S/ ' || to_char(coalesce(o.final_total, o.estimated_total), 'FM999990.00'), to_char(o.delivery_date, 'DD/MM/YYYY')) as detalle"),
                    DB::raw('o.created_at as fecha')]));
        }
        if ($ve('FAC')) {
            $agregar('document', 'FAC', self::alcance(self::filtrar(DB::table('sales_documents as d'), ['d.full_number', 'd.customer_name', 'd.customer_doc_number'], $patron), 'd', $marcas, $locales)
                ->orderByDesc('d.issue_date')->limit($porTipo)
                ->get(['d.id', 'd.full_number as titulo',
                    DB::raw("concat_ws(' · ', d.customer_name, 'S/ ' || to_char(d.total, 'FM999990.00'), to_char(d.issue_date, 'DD/MM/YYYY')) as detalle"),
                    DB::raw('d.issue_date as fecha')]));
        }
        if ($ve('CAT')) {
            $agregar('product', 'CAT', self::filtrar(DB::table('product_variants as v'), ['v.name', 'v.sku', 'v.barcode'], $patron)
                ->when($marcas, fn ($w) => $w->where(fn ($x) => $x->whereNull('v.brand_id')->orWhereIn('v.brand_id', $marcas)))
                ->orderBy('v.name')->limit($porTipo)
                ->get(['v.id', 'v.name as titulo', DB::raw("concat_ws(' · ', v.sku, v.barcode) as detalle"), DB::raw('null as fecha')]));
        }
        if ($ve('MAE')) {
            $agregar('employee', 'MAE', self::filtrar(DB::table('employees as e'), ['e.full_name', 'e.doc_number', 'e.position'], $patron)
                ->when($locales, fn ($w) => $w->where(fn ($x) => $x->whereNull('e.establishment_id')->orWhereIn('e.establishment_id', $locales)))
                ->orderBy('e.full_name')->limit($porTipo)
                ->get(['e.id', 'e.full_name as titulo', DB::raw("concat_ws(' · ', e.position, e.doc_type || ' ' || e.doc_number) as detalle"), DB::raw('null as fecha')]));
        }
        if ($ve('PLT')) {
            foreach ([
                ['companies', ['legal_name', 'trade_name', 'ruc'], 'legal_name', "concat_ws(' · ', 'RUC ' || ruc, trade_name)", '/m/plt/plt-03', 'Empresa'],
                ['establishments', ['name', 'short', 'code', 'address'], 'name', "concat_ws(' · ', code, address)", '/m/plt/plt-04', 'Local'],
                ['brands', ['name', 'code', 'website'], 'name', "concat_ws(' · ', code, website)", '/m/plt/plt-05', 'Marca'],
                ['document_series', ['series', 'note'], 'series', "concat_ws(' · ', doc_type, note)", '/m/plt/plt-08', 'Serie'],
                ['cost_centers', ['code', 'name'], 'name', "code", '/m/plt/plt-07', 'Centro de costo'],
            ] as [$tabla, $columnas, $titulo, $detalle, $url, $nombre]) {
                $agregar('setting', 'PLT', self::filtrar(DB::table($tabla), $columnas, $patron)->limit(5)
                    ->get(['id', DB::raw("{$titulo} as titulo"), DB::raw("'{$nombre}' || ' · ' || {$detalle} as detalle"), DB::raw('null as fecha'), DB::raw("'{$url}' as url")]));
            }
        }

        // Lo que publican los demás módulos.
        $publicadas = self::alcance(self::filtrar(DB::table('search_entries as s'), ['s.title', 's.subtitle', 's.keywords'], $patron), 's', $marcas, $locales)
            ->orderByDesc('s.created_at')->limit($max * 2)
            ->get(['s.entity_id as id', 's.module_code', 's.entity_type', 's.permission_code', 's.title as titulo', 's.subtitle as detalle', 's.url', 's.created_at as fecha']);
        foreach ($publicadas as $s) {
            if (! $s->module_code || ! $ve($s->module_code) || ($s->permission_code && ! Access::can($quien, $s->permission_code))) {
                continue;
            }
            $hallados[] = ['tipo' => isset(self::TIPOS[$s->entity_type]) ? $s->entity_type : 'other', 'modulo' => $s->module_code,
                'id' => $s->id, 'titulo' => $s->titulo, 'detalle' => $s->detalle, 'fecha' => $s->fecha, 'url' => self::url($s->url)];
        }

        // Primero lo que empieza con lo buscado; después lo más reciente.
        $plano = self::plano($q);
        usort($hallados, fn ($x, $y) => [(int) ! str_starts_with(self::plano((string) $x['titulo']), $plano), -strtotime((string) ($x['fecha'] ?? '1970-01-01'))]
            <=> [(int) ! str_starts_with(self::plano((string) $y['titulo']), $plano), -strtotime((string) ($y['fecha'] ?? '1970-01-01'))]);

        // Reparto justo entre tipos hasta el máximo.
        $grupos = [];
        foreach ($hallados as $h) {
            $grupos[$h['tipo']][] = $h + ['url' => $h['url'] ?? '/m/'.mb_strtolower($h['modulo'])];
        }
        $salida = [];
        for ($i = 0; count($salida) < $max; $i++) {
            $agrego = false;
            foreach (array_keys(self::TIPOS) as $t) {
                if (isset($grupos[$t][$i]) && count($salida) < $max) {
                    $salida[] = $grupos[$t][$i];
                    $agrego = true;
                }
            }
            if (! $agrego) {
                break;
            }
        }

        return ['total' => count($hallados), 'resultados' => $salida,
            'por_tipo' => array_map('count', $grupos)] + $base;
    }

    /** Publica (o actualiza) una entrada para que otros la encuentren en la búsqueda global. */
    public static function publicar(string $modulo, string $tipo, string $entidadId, string $titulo, ?string $detalle = null, ?string $url = null,
        ?string $keywords = null, ?string $brandId = null, ?string $siteId = null, ?string $permiso = null): void
    {
        DB::table('search_entries')->updateOrInsert(
            ['module_code' => $modulo, 'entity_type' => $tipo, 'entity_id' => $entidadId],
            ['title' => mb_substr($titulo, 0, 255), 'subtitle' => $detalle ? mb_substr($detalle, 0, 255) : null, 'url' => $url,
                'keywords' => $keywords ? mb_substr($keywords, 0, 255) : null, 'brand_id' => $brandId, 'establishment_id' => $siteId,
                'permission_code' => $permiso, 'updated_at' => now()],
        );
    }

    /** Quita la entrada (al anular o borrar lo publicado). */
    public static function quitar(string $modulo, string $tipo, string $entidadId): void
    {
        DB::table('search_entries')->where(['module_code' => $modulo, 'entity_type' => $tipo, 'entity_id' => $entidadId])->delete();
    }

    /** Busca el patrón en las columnas, en minúsculas y sin tildes (unaccent no está instalado). */
    private static function filtrar(Builder $q, array $columnas, string $patron): Builder
    {
        return $q->where(function ($w) use ($columnas, $patron) {
            foreach ($columnas as $c) {
                $w->orWhereRaw("translate(lower({$c}::text), 'áéíóúüñ', 'aeiouun') like ?", [$patron]);
            }
        });
    }

    /** Solo filas de las marcas y locales del usuario (sin marca o local: las ven todos). */
    private static function alcance(Builder $q, string $t, array $marcas, array $locales): Builder
    {
        return $q
            ->when($marcas, fn ($w) => $w->where(fn ($x) => $x->whereNull("{$t}.brand_id")->orWhereIn("{$t}.brand_id", $marcas)))
            ->when($locales, fn ($w) => $w->where(fn ($x) => $x->whereNull("{$t}.establishment_id")->orWhereIn("{$t}.establishment_id", $locales)));
    }

    private static function plano(string $t): string
    {
        return strtr(mb_strtolower($t), ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n']);
    }

    /** «#TEL-08» del prototipo pasa a la ruta de la pantalla; solo rutas internas. */
    private static function url(?string $url): ?string
    {
        if ($url && preg_match('/^#([A-Z0-9]{3})-(\d{2})$/', $url, $m)) {
            return '/m/'.strtolower($m[1]).'/'.strtolower($m[1]).'-'.$m[2];
        }

        return $url && str_starts_with($url, '/') && ! str_starts_with($url, '//') ? $url : null;
    }
}
