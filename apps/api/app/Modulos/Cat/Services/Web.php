<?php

namespace App\Modulos\Cat\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Publicación web (CAT-09). CAT marca qué productos y variantes van a la tienda de cada marca y con qué
 * título, descripción e imagen; el envío a WooCommerce lo hace WEB al escuchar product.changed.
 * Mientras WEB no exista, «Enviar a la web» deja el cambio como sincronizado con la fecha y hora.
 * RN-CAT-09: no se publica un producto con el registro sanitario vencido o sin registro.
 */
final class Web
{
    public static function delAlcance(User $u, string $id): object
    {
        $marcas = Access::for($u)['brands'];

        return DB::table('products')->where('id', $id)->whereIn('product_type', ['GOODS', 'COMBO', 'SERVICE'])
            ->when($marcas, fn ($q) => $q->whereIn('brand_id', $marcas))->first() ?? abort(404);
    }

    public static function publicar(object $p, bool $si): void
    {
        if ($si) {
            $s = RegistroSanitario::estado($p);
            if ($s['code'] === 'EXPIRED') {
                RuleError::fail('RN-CAT-09', "{$p->name} tiene el registro sanitario vencido (".date('d/m/Y', strtotime($p->sanitary_registry_expires)).'): no se publica en la web. Renueva el registro en Registros sanitarios.');
            }
            if ($s['code'] === 'MISSING') {
                RuleError::fail('RN-CAT-09', "{$p->name} no tiene registro sanitario: no se publica.");
            }
            if ($p->status !== 'ACTIVE') {
                RuleError::fail('RN-CAT-11', 'Solo se publican productos activos.');
            }
        }
        DB::transaction(function () use ($p, $si) {
            DB::table('products')->where('id', $p->id)->update(['web_publishable' => $si, 'web_sync_status' => 'PENDING', 'updated_at' => now()]);
            // Al publicar por primera vez, sus variantes activas van con él.
            if ($si && ! DB::table('product_variants')->where('product_id', $p->id)->where('web_publishable', true)->exists()) {
                DB::table('product_variants')->where('product_id', $p->id)->where('status', 'ACTIVE')->update(['web_publishable' => true, 'updated_at' => now()]);
            }
        });
        Events::emit('product.changed', 'products', $p->id, ['product_id' => $p->id, 'web' => $si]);
    }

    /** Título, descripción, imagen y qué variantes se publican. */
    public static function guardarDatos(object $p, array $d): void
    {
        $vencido = RegistroSanitario::estado($p)['code'] === 'EXPIRED';
        DB::transaction(function () use ($p, $d, $vencido) {
            foreach ($d['variantes'] ?? [] as $id => $si) {
                $v = DB::table('product_variants')->where('product_id', $p->id)->where('id', $id)->first(['id', 'web_publishable']);
                if (! $v || (bool) $v->web_publishable === (bool) $si) {
                    continue;
                }
                if ($si && $vencido) {
                    RuleError::fail('RN-CAT-09', 'El registro sanitario está vencido: no se publica.');
                }
                DB::table('product_variants')->where('id', $id)->update(['web_publishable' => (bool) $si, 'updated_at' => now()]);
            }
            DB::table('products')->where('id', $p->id)->update([
                'web_title' => $d['web_title'] ?? null, 'web_description' => $d['web_description'] ?? null, 'image_url' => $d['image_url'] ?? null,
                'web_sync_status' => $p->web_publishable ? 'PENDING' : $p->web_sync_status, 'updated_at' => now(),
            ]);
        });
        Events::emit('product.changed', 'products', $p->id, ['product_id' => $p->id, 'web' => true]);
    }

    /** Marca el cambio como enviado (hasta que WEB haga el envío real). */
    public static function enviar(object $p): void
    {
        DB::table('products')->where('id', $p->id)->update([
            'web_sync_status' => $p->web_publishable ? 'SYNCED' : 'NOT_PUBLISHED', 'web_synced_at' => now(), 'updated_at' => now(),
        ]);
    }
}
