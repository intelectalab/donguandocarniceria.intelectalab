<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * CON, B2B y CMP · ajustes de la demo sobre los datos del prototipo (data/prototipo-canales.json.gz).
 * - Los usuarios con cuenta del portal quedan como usuarios de cliente (user_type B2B_CUSTOMER) y ligados a su cliente.
 * - Los clientes sin código de referido reciben uno (CMP-10).
 */
class CanalesDemoSeeder extends Seeder
{
    public function run(): void
    {
        DB::statement("UPDATE users u SET user_type = 'B2B_CUSTOMER', customer_id = a.customer_id
                         FROM b2b_portal_accounts a WHERE a.user_id = u.id AND (u.user_type IS DISTINCT FROM 'B2B_CUSTOMER' OR u.customer_id IS DISTINCT FROM a.customer_id)");
        DB::statement("UPDATE customers SET referral_code = upper(left(regexp_replace(translate(coalesce(trade_name, full_name), 'ÁÉÍÓÚÑáéíóúñ', 'AEIOUNaeioun'), '[^A-Za-z]', '', 'g'), 5)) || upper(right(replace(id::text, '-', ''), 4))
                        WHERE referral_code IS NULL AND customer_type <> 'OTHER'");
        $this->command?->info('Canales: usuarios del portal y códigos de referido listos');
    }
}
