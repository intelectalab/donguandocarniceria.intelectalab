<?php

namespace App\Modulos\Web\Services;

use App\Modulos\Int\Services\Corridas;
use App\Modulos\Int\Services\Webhooks;
use Illuminate\Support\Facades\DB;

/**
 * Lo que WEB instala en INT: el procesador de los webhooks de WooCommerce (pedidos) y de Mercado Pago (pagos), y las
 * corridas de catálogo y stock que se ejecutan desde Integraciones (INT-06). INT guarda, firma y deduplica el evento
 * (RN-INT-04/05); aquí se decide qué hacer con él.
 */
final class Procesadores
{
    public static function instalar(): void
    {
        Webhooks::$procesadores['WOOCOMMERCE'] = fn (array $cuerpo, object $c, object $ev): string => self::woo($cuerpo, $c, $ev);
        Webhooks::$procesadores['MERCADOPAGO'] = fn (array $cuerpo, object $c, object $ev): string => self::mp($cuerpo, $c, $ev);
        Corridas::$procesos['WOO_STOCK_SYNC'] = fn (object $c): array => self::corrida($c, 'STOCK');
        Corridas::$procesos['WOO_CATALOG_SYNC'] = fn (object $c): array => self::corrida($c, 'CATALOG');
    }

    /** La tienda del conector (de pedidos o de pagos). */
    private static function tiendaDe(object $c, string $columna): ?object
    {
        $s = DB::table('web_stores')->where($columna, $c->id)
            ->orderByRaw("CASE status WHEN 'ACTIVE' THEN 0 WHEN 'TESTING' THEN 1 ELSE 2 END")->first();

        return $s ? Base::decodificar($s) : null;
    }

    public static function woo(array $cuerpo, object $c, object $ev): string
    {
        $s = self::tiendaDe($c, 'connector_id');
        if (! $s) {
            return 'Sin tienda web con este conector: se guarda y no crea pedidos.';
        }
        if (! isset($cuerpo['id']) && isset($cuerpo['webhook_id'])) {
            return 'Ping de WooCommerce al crear el webhook: correcto.';
        }
        if (! isset($cuerpo['line_items']) && ! isset($cuerpo['billing'])) {
            return 'El evento no es un pedido de WooCommerce: no se procesa.';
        }
        if (! in_array($s->status, ['ACTIVE', 'TESTING'], true) || ! $s->sync_orders) {
            return "La tienda {$s->name} no recibe pedidos (".Base::ESTADOS_TIENDA[$s->status].'): se guarda y no se procesa.';
        }
        $r = Bandeja::registrar($s, $cuerpo, 'WEBHOOK', $ev->id);
        $ib = $r['inbox'];
        if ($r['duplicado']) {
            return "Pedido web #{$ib->external_order_id} repetido: mismo registro de la bandeja (RN-WEB-02).";
        }
        $nums = DB::table('sales_orders')->whereIn('id', Base::json($ib->order_ids) ?: ['00000000-0000-0000-0000-000000000000'])->orderBy('number')->pluck('number')->all();

        return "Pedido web #{$ib->external_order_id}: ".mb_strtolower(Base::ESTADOS_BANDEJA[$ib->status])
            .($nums ? ' · '.implode(', ', $nums) : '').($ib->error_code ? " · {$ib->error_code}" : '');
    }

    public static function mp(array $cuerpo, object $c, object $ev): string
    {
        $s = self::tiendaDe($c, 'payment_connector_id');
        if (! $s) {
            return 'Sin tienda web con este conector de pagos: se guarda y no se registra nada.';
        }
        $tipo = (string) ($cuerpo['type'] ?? $cuerpo['topic'] ?? '');
        if ($tipo !== 'payment') {
            return "Notificación de Mercado Pago de tipo «{$tipo}»: no es un pago, no se procesa.";
        }
        $id = (string) ($cuerpo['data']['id'] ?? '');
        $r = Pagos::notificacion($s, $id, $ev->id, is_array($cuerpo['data'] ?? null) ? $cuerpo['data'] : null);

        return mb_substr($r['detalle'], 0, 255);
    }

    private static function corrida(object $c, string $tipo): array
    {
        $ok = 0;
        $mal = 0;
        $det = [];
        foreach (DB::table('web_stores')->where('connector_id', $c->id)->whereIn('status', ['ACTIVE', 'TESTING'])->orderBy('name')->get() as $s) {
            if (! $s->{Sincronizacion::BANDERA[$tipo]}) {
                $det[] = "{$s->name}: no sincroniza ".mb_strtolower(Base::TIPOS[$tipo]);

                continue;
            }
            $r = Sincronizacion::correr($s->id, $tipo, 'SCHEDULE');
            $ok += (int) $r->items_ok;
            $mal += (int) $r->items_failed;
            $det[] = "{$s->name}: {$r->number} · {$r->detail}";
        }

        return ['ok' => $ok, 'fallidos' => $mal, 'detalle' => $det ? implode(' | ', $det) : 'Ninguna tienda activa usa este conector.'];
    }
}
