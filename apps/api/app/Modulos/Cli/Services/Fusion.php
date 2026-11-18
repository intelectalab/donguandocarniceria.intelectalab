<?php

namespace App\Modulos\Cli\Services;

use App\Models\User;
use App\Modulos\Cli\Models\Customer;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * RN-CLI-08: la fusión mueve pedidos, direcciones, comprobantes, cobros, conversaciones y saldo al
 * sobreviviente, deja al fusionado inactivo con merged_into_id y no se deshace (customer_merges es
 * de solo inserción).
 *
 * Qué se mueve: toda tabla de la base con customer_id o billing_customer_id que la app puede
 * actualizar (así, cuando otro módulo agrega una tabla con cliente, la fusión ya la incluye).
 * No se mueven las de solo inserción: los consentimientos quedan como constancia en el fusionado y
 * el saldo a favor se traslada con dos movimientos (sale del fusionado, entra al sobreviviente).
 */
final class Fusion
{
    /** Tablas que no se tocan al mover (las del propio CLI y la bitácora). */
    private const FUERA = ['customers', 'customer_duplicate_candidates', 'customer_merges'];

    public const NOMBRES = [
        'sales_orders' => 'Pedidos', 'customer_addresses' => 'Direcciones', 'sales_documents' => 'Comprobantes', 'payments' => 'Cobros',
        'conversations' => 'Conversaciones', 'messages' => 'Mensajes', 'channel_contacts' => 'Contactos de canal', 'leads' => 'Prospectos',
        'crm_tasks' => 'Tareas de CRM', 'customer_location_links' => 'Enlaces de ubicación', 'quality_claims' => 'Reclamos',
        'delivery_surveys' => 'Encuestas de entrega', 'customer_rebuy_profiles' => 'Perfil de recompra', 'tel_calls' => 'Llamadas',
        'web_order_inbox' => 'Pedidos web', 'ad_attributions' => 'Atribución de anuncios', 'warehouses' => 'Almacenes en consignación',
        'users' => 'Usuarios del portal B2B', 'contact_consents' => 'Consentimientos (quedan en el fusionado)',
    ];

    /** @return array<int, array{tabla: string, columna: string}> */
    private static function columnas(): array
    {
        return array_map(fn ($r) => ['tabla' => $r->table_name, 'columna' => $r->column_name], DB::select(
            "SELECT c.table_name, c.column_name
               FROM information_schema.columns c
               JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
              WHERE c.table_schema = 'public' AND c.column_name IN ('customer_id', 'billing_customer_id')
                AND c.table_name NOT IN ('".implode("','", self::FUERA)."')
                AND has_table_privilege(current_user, format('%I.%I', c.table_schema, c.table_name), 'UPDATE')
              ORDER BY 1, 2"
        ));
    }

    /** Lo que se moverá al fusionar, sin cambiar nada. */
    public static function vistaPrevia(Customer $fusionado): array
    {
        $conteo = [];
        foreach (self::columnas() as ['tabla' => $t, 'columna' => $col]) {
            $n = DB::table($t)->where($col, $fusionado->id)->count();
            if ($n) {
                $conteo[$t] = ($conteo[$t] ?? 0) + $n;
            }
        }
        $consent = DB::table('contact_consents')->where('customer_id', $fusionado->id)->count();

        return [
            'conteo' => collect($conteo)->map(fn ($n, $t) => ['tabla' => $t, 'nombre' => self::NOMBRES[$t] ?? $t, 'filas' => $n])->values()->all(),
            'consentimientos' => $consent,
            'saldo' => Clientes::saldo($fusionado->id),
            'por_cobrar' => Clientes::porCobrar($fusionado->id)['total'],
        ];
    }

    public static function fusionar(Customer $sobreviviente, Customer $fusionado, string $motivo, User $quien): object
    {
        $motivo = trim($motivo);
        if ($motivo === '') {
            RuleError::fail('RN-CLI-08', 'La fusión exige motivo: queda en la auditoría y no se deshace.');
        }
        if ($sobreviviente->id === $fusionado->id) {
            RuleError::fail('RN-CLI-08', 'Elige dos clientes distintos.');
        }
        if ($fusionado->fusionado()) {
            RuleError::fail('RN-CLI-08', "{$fusionado->nombre()} ya fue fusionado.");
        }
        if ($sobreviviente->fusionado()) {
            RuleError::fail('RN-CLI-08', "{$sobreviviente->nombre()} ya fue fusionado: no puede ser el sobreviviente.");
        }

        return DB::transaction(function () use ($sobreviviente, $fusionado, $motivo, $quien) {
            $s = Customer::lockForUpdate()->find($sobreviviente->id);
            $m = Customer::lockForUpdate()->find($fusionado->id);
            $saldo = Clientes::saldo($m->id);

            // 1. El fusionado queda inactivo primero: así su documento deja de contar como único (RN-CLI-11).
            $m->update(['status' => 'INACTIVE', 'merged_into_id' => $s->id, 'merged_at' => now(),
                'notes' => trim(($m->notes ? $m->notes."\n" : '')."Fusionado en {$s->nombre()}: {$motivo}")]);

            // 2. Mover lo enlazado. Las direcciones movidas no pueden quitarle la predeterminada al sobreviviente (RN-CLI-10).
            $teniaPredeterminada = DB::table('customer_addresses')->where(['customer_id' => $s->id, 'is_default' => true, 'status' => 'ACTIVE'])->exists();
            if ($teniaPredeterminada) {
                DB::table('customer_addresses')->where('customer_id', $m->id)->update(['is_default' => false]);
            }
            $movido = [];
            foreach (self::columnas() as ['tabla' => $t, 'columna' => $col]) {
                $n = DB::table($t)->where($col, $m->id)->update([$col => $s->id]);
                if ($n) {
                    $movido[$t] = ($movido[$t] ?? 0) + $n;
                }
            }
            if (abs($saldo) >= 0.01) {
                $mov = ['reason' => mb_substr("Fusión de clientes: {$motivo}", 0, 255), 'at' => now(), 'user' => mb_substr($quien->name, 0, 255)];
                DB::table('customer_balance_movements')->insert([
                    ['customer_id' => $m->id, 'movement_type' => 'MERGE_OUT', 'amount' => -$saldo] + $mov,
                    ['customer_id' => $s->id, 'movement_type' => 'MERGE_IN', 'amount' => $saldo] + $mov,
                ]);
            }

            // 3. El sobreviviente completa lo que le falte; el celular del fusionado queda como alterno.
            $pedidos = DB::table('sales_orders')->where('customer_id', $s->id)->where('status', '<>', 'CANCELLED');
            $docPropio = $s->doc_type !== 'NONE' && $s->doc_number;
            $s->update([
                'email' => $s->email ?: $m->email,
                'phone_alt' => $s->phone_alt ?: ($m->phone && $m->phone !== $s->phone ? $m->phone : $m->phone_alt),
                'doc_type' => $docPropio ? $s->doc_type : $m->doc_type,
                'doc_number' => $docPropio ? $s->doc_number : $m->doc_number,
                'doc_validated_at' => $docPropio ? $s->doc_validated_at : $m->doc_validated_at,
                'doc_validation_source' => $docPropio ? $s->doc_validation_source : $m->doc_validation_source,
                'seller_user_id' => $s->seller_user_id ?: $m->seller_user_id,
                'marketing_opt_in' => $s->marketing_opt_in || $m->marketing_opt_in,
                'orders_count' => (clone $pedidos)->count(),
                'first_order_at' => (clone $pedidos)->min('created_at'),
                'last_order_at' => (clone $pedidos)->max('created_at'),
            ]);

            // 4. Los pares abiertos del fusionado se cierran.
            foreach (DB::table('customer_duplicate_candidates')->where('status', 'OPEN')
                ->where(fn ($q) => $q->where('customer_id', $m->id)->orWhere('duplicate_of_id', $m->id))->get() as $par) {
                $conEste = in_array($s->id, [$par->customer_id, $par->duplicate_of_id], true);
                DB::table('customer_duplicate_candidates')->where('id', $par->id)->update([
                    'status' => $conEste ? 'MERGED' : 'DISMISSED', 'resolved_by' => $quien->id, 'resolved_at' => now(), 'updated_at' => now(),
                    'resolution_note' => mb_substr($conEste ? $motivo : "{$m->nombre()} se fusionó en {$s->nombre()}", 0, 255),
                ]);
            }

            $id = DB::table('customer_merges')->insertGetId([
                'survivor_id' => $s->id, 'merged_id' => $m->id, 'moved_counts' => json_encode($movido + ['balance' => $saldo]),
                'reason' => mb_substr($motivo, 0, 255), 'merged_at' => now(), 'merged_by' => mb_substr($quien->name, 0, 255),
                'survivor_name' => mb_substr($s->nombre(), 0, 255), 'merged_name' => mb_substr($m->nombre(), 0, 255),
            ]);
            Events::emit('customer.merged', 'customers', $s->id, ['survivor_id' => $s->id, 'merged_id' => $m->id, 'moved' => $movido, 'balance' => $saldo]);

            return DB::table('customer_merges')->find($id);
        });
    }
}
