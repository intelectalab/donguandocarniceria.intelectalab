<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * WEB · ajustes de los datos de prueba después de PrototipoSeeder (y desde la migración 2026_11_30_000100 en una base
 * ya sembrada). Se puede correr varias veces: no cambia lo que ya está bien.
 *  - Los roles con un permiso de WEB (administrador del sistema, administración) reciben el módulo WEB en solo lectura;
 *    cada acción la abre su permiso.
 *  - Los ids del prototipo guardados dentro de las listas jsonb pasan a los uuid de las filas reales.
 */
class WebDemoSeeder extends Seeder
{
    public function run(): void
    {
        $this->idsDeLaSiembra();
        // Los roles con un permiso de WEB ven el módulo (leer; cada acción la abre su permiso).
        DB::statement(<<<'SQL'
            INSERT INTO role_module_access (tenant_id, role_id, module_code, actions, created_at)
            SELECT DISTINCT rp.tenant_id, rp.role_id, 'WEB', 'L', now()
            FROM role_permissions rp
            JOIN permissions p ON p.id = rp.permission_id
            JOIN roles r ON r.id = rp.role_id
            WHERE p.code LIKE 'web.%' AND r.code <> 'GERENTE'
            ON CONFLICT (tenant_id, role_id, module_code) DO NOTHING
        SQL);
    }

    private function idsDeLaSiembra(): void
    {
        $ns = 'b7a1c2d4-5e6f-4a8b-9c0d-1e2f3a4b5c6d';
        $uid = fn (string $e, string $id) => (string) \Ramsey\Uuid\Uuid::uuid5($ns, $e.':'.$id);
        $esUuid = fn ($v) => is_string($v) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-/i', $v);
        foreach (DB::table('tenants')->pluck('id') as $tenant) {
            $clave = collect(['DG', 'CS'])->first(fn ($k) => $uid('', $k) === $tenant);
            if (! $clave) {
                continue;
            }
            $existe = fn (string $tabla, string $id) => DB::table($tabla)->where('id', $id)->exists();
            $mapa = function ($v, string $tabla) use ($clave, $uid, $esUuid, $existe) {
                if (! is_string($v) || $esUuid($v)) {
                    return $v;
                }
                $u = $uid($clave, $v);

                return $existe($tabla, $u) ? $u : null;
            };
            $lista = fn ($json, string $tabla) => array_values(array_filter(array_map(fn ($v) => $mapa($v, $tabla), json_decode((string) $json, true) ?: [])));

            foreach (DB::table('web_stores')->where('tenant_id', $tenant)->get() as $s) {
                $listas = [];
                foreach (json_decode((string) $s->price_lists, true) ?: [] as $b => $l) {
                    $bb = $mapa($b, 'brands');
                    $ll = $mapa($l, 'price_lists');
                    if ($bb && $ll) {
                        $listas[$bb] = $ll;
                    }
                }
                DB::table('web_stores')->where('id', $s->id)->update(['brands' => json_encode($lista($s->brands, 'brands')),
                    'price_lists' => json_encode((object) $listas), 'warehouse_ids' => json_encode($lista($s->warehouse_ids, 'warehouses'))]);
            }
            foreach (['web_order_inbox', 'gateway_transactions'] as $t) {
                foreach (DB::table($t)->where('tenant_id', $tenant)->get(['id', 'order_ids', 'webhook_event_ids']) as $r) {
                    DB::table($t)->where('id', $r->id)->update(['order_ids' => json_encode($lista($r->order_ids, 'sales_orders')),
                        'webhook_event_ids' => json_encode($lista($r->webhook_event_ids, 'webhook_events'))]);
                }
            }
            foreach (DB::table('gateway_transactions')->where('tenant_id', $tenant)->whereNotNull('credit_notes')->get(['id', 'credit_notes']) as $r) {
                $notas = array_map(fn ($n) => ['document_id' => $mapa($n['document_id'] ?? null, 'sales_documents')] + $n, json_decode((string) $r->credit_notes, true) ?: []);
                DB::table('gateway_transactions')->where('id', $r->id)->update(['credit_notes' => json_encode($notas, JSON_UNESCAPED_UNICODE)]);
            }
            foreach (DB::table('web_sync_runs')->where('tenant_id', $tenant)->get(['id', 'items']) as $r) {
                $items = json_decode((string) $r->items, true) ?: [];
                $cambio = false;
                foreach ($items as &$i) {
                    if (isset($i['variant_id']) && ! $esUuid($i['variant_id'])) {
                        $i['variant_id'] = $mapa($i['variant_id'], 'product_variants');
                        $cambio = true;
                    }
                    if (isset($i['mapping_id']) && ! $esUuid($i['mapping_id'])) {
                        $i['mapping_id'] = $mapa($i['mapping_id'], 'web_product_mappings');
                        $cambio = true;
                    }
                }
                unset($i);
                if ($cambio) {
                    DB::table('web_sync_runs')->where('id', $r->id)->update(['items' => json_encode($items, JSON_UNESCAPED_UNICODE)]);
                }
            }
        }
    }

}
