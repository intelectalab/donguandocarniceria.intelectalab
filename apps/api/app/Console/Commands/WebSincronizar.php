<?php

namespace App\Console\Commands;

use App\Modulos\Int\Services\Conectores;
use App\Modulos\Web\Services\Sincronizacion;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * WEB · RN-WEB-05: programador de la tienda web, cada minuto y empresa por empresa. Stock cada web_stock_sync_minutes
 * y después de cada venta, precios cada hora, consulta de respaldo de pedidos cada web_order_poll_minutes (con los
 * reintentos de RN-WEB-04), ubicaciones recibidas por el enlace y pagos pendientes vencidos.
 */
class WebSincronizar extends Command
{
    protected $signature = 'web:sincronizar';

    protected $description = 'Sincroniza stock, precios y pedidos de las tiendas web (WooCommerce) que tocan ahora';

    public function handle(): int
    {
        foreach (DB::select("SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY name") as $t) {
            TenantContext::set(TenantContext::find($t->id));
            try {
                if (! Conectores::moduloEncendido('WEB')) {
                    continue;
                }
                foreach (Sincronizacion::programado() as $tienda => $hecho) {
                    if ($hecho) {
                        $this->info("{$t->id} {$tienda}: ".implode(' · ', $hecho));
                    }
                }
            } catch (\Throwable $e) {
                // Una empresa con problemas no frena a las demás.
                $this->error("{$t->id}: {$e->getMessage()}");
            }
        }
        TenantContext::set(null);

        return self::SUCCESS;
    }
}
