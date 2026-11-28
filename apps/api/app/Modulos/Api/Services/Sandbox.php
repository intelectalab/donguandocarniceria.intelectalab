<?php

namespace App\Modulos\Api\Services;

use App\Models\User;
use App\Modulos\Plt\Services\Ruc;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * API-09 Sandbox (RN-API-16, CA-API-07).
 *
 *  - Cada empresa tiene un entorno de pruebas emparejado (api_sandboxes) con datos de demostración propios.
 *  - Las claves de pruebas (ak_test_) operan únicamente sobre el sandbox: no leen ni escriben pedidos, clientes ni
 *    comprobantes de producción.
 *  - Los comprobantes emitidos en el sandbox usan el OSE simulado (FAKE), quedan aceptados al instante con
 *    sent_to_sunat = false y no tocan SUNAT. Los mensajes se registran en el proveedor FAKE sin enviarse a WhatsApp.
 *  - Reiniciar el sandbox (api.sandbox.reset) restaura los datos de demostración; las claves de prueba siguen vigentes.
 */
final class Sandbox
{
    public const ESTADOS = ['READY' => 'Listo', 'RESETTING' => 'Reiniciando'];

    public const HOST = 'https://sandbox.gestioncarnica.pe';

    public static function diasReinicio(): int
    {
        return max(1, (int) (Params::get('api_sandbox_reset_days') ?? 30));
    }

    /** Devuelve la fila del sandbox de la empresa actual, creándola con datos de demostración si aún no existe. */
    public static function obtener(): object
    {
        $s = DB::table('api_sandboxes')->first();
        if (! $s) {
            $s = self::sembrarInicial();
        }

        return $s;
    }

    private static function sembrarInicial(): object
    {
        $ahora = now('America/Lima');
        $datos = self::datosDemostracion($ahora);
        $short = (string) (DB::table('tenants')->whereRaw('id = app_tenant_id()')->value('short') ?? 'DG');
        $codigo = strtoupper(substr(preg_replace('/[^A-Za-z0-9]/', '', $short), 0, 12) ?: 'DG');
        DB::table('api_sandboxes')->insert([
            'paired_tenant' => "{$codigo}-SBX",
            'status' => 'READY',
            'ose_provider' => 'FAKE',
            'messaging_provider' => 'FAKE',
            'payments_provider' => 'FAKE',
            'host' => self::HOST,
            'last_reset_at' => $ahora,
            'next_reset_at' => $ahora->copy()->addDays(self::diasReinicio())->toDateString(),
            'reset_count' => 1,
            'reset_by' => null,
            'reset_by_name' => 'Sistema',
            'data' => json_encode($datos, JSON_UNESCAPED_UNICODE),
            'seq' => json_encode(['order' => count($datos['orders']), 'doc' => count($datos['documents'])]),
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ]);

        return DB::table('api_sandboxes')->first();
    }

    /** Reinicia el sandbox con los datos de demostración (RN-API-16). */
    public static function reiniciar(?User $u = null, bool $silencioso = false): array
    {
        if (! $silencioso && $u && ! Access::can($u, 'api.sandbox.reset') && ! Access::can($u, 'api.key.manage')) {
            RuleError::fail('RN-SEG-12', 'Reiniciar el sandbox exige el permiso api.sandbox.reset.');
        }
        $actual = DB::table('api_sandboxes')->first();
        $ahora = now('America/Lima');
        $datos = self::datosDemostracion($ahora);
        $seq = ['order' => count($datos['orders']), 'doc' => count($datos['documents'])];
        $short = (string) (DB::table('tenants')->whereRaw('id = app_tenant_id()')->value('short') ?? 'DG');
        $codigo = strtoupper(substr(preg_replace('/[^A-Za-z0-9]/', '', $short), 0, 12) ?: 'DG');

        if ($actual) {
            DB::table('api_sandboxes')->where('id', $actual->id)->update([
                'status' => 'READY',
                'last_reset_at' => $ahora,
                'next_reset_at' => $ahora->copy()->addDays(self::diasReinicio())->toDateString(),
                'reset_count' => ((int) $actual->reset_count) + 1,
                'reset_by' => $u?->id,
                'reset_by_name' => $u ? mb_substr($u->name, 0, 120) : 'Sistema',
                'data' => json_encode($datos, JSON_UNESCAPED_UNICODE),
                'seq' => json_encode($seq),
                'updated_at' => $ahora,
            ]);
            $id = $actual->id;
        } else {
            $id = DB::table('api_sandboxes')->insertGetId([
                'paired_tenant' => "{$codigo}-SBX",
                'status' => 'READY',
                'ose_provider' => 'FAKE',
                'messaging_provider' => 'FAKE',
                'payments_provider' => 'FAKE',
                'host' => self::HOST,
                'last_reset_at' => $ahora,
                'next_reset_at' => $ahora->copy()->addDays(self::diasReinicio())->toDateString(),
                'reset_count' => 1,
                'reset_by' => $u?->id,
                'reset_by_name' => $u ? mb_substr($u->name, 0, 120) : 'Sistema',
                'data' => json_encode($datos, JSON_UNESCAPED_UNICODE),
                'seq' => json_encode($seq),
                'created_at' => $ahora,
                'updated_at' => $ahora,
            ], 'id');
        }
        if (! $silencioso) {
            Events::emit('api.sandbox_reset', 'api_sandboxes', $id, ['by' => $u?->id]);
        }

        return self::panel($u);
    }

    /** API-09: estado del sandbox, proveedores FAKE, claves de prueba y tablas de pedidos, comprobantes, mensajes, clientes y productos. */
    public static function panel(?User $u = null): array
    {
        $s = self::obtener();
        $dt = json_decode((string) $s->data, true) ?: ['customers' => [], 'products' => [], 'orders' => [], 'documents' => [], 'payments' => [], 'messages' => []];
        $hoy = Claves::hoy();
        $claves = DB::table('api_keys')->where('environment', 'TEST')->orderByDesc('created_at')->get()
            ->map(function ($k) {
                $est = Claves::estado($k);

                return [
                    'id' => $k->id,
                    'name' => $k->name,
                    'prefix' => $k->prefix,
                    'expires_at' => $k->expires_at,
                    'status' => $est,
                    'estado' => Claves::ESTADOS[$est] ?? $est,
                    'scopes' => json_decode((string) $k->scopes, true) ?: [],
                ];
            })->all();
        $activas = count(array_filter($claves, fn ($k) => $k['status'] === 'ACTIVE'));

        return [
            'id' => $s->id,
            'paired_tenant' => $s->paired_tenant,
            'status' => $s->status,
            'estado' => self::ESTADOS[$s->status] ?? $s->status,
            'ose_provider' => $s->ose_provider,
            'messaging_provider' => $s->messaging_provider,
            'payments_provider' => $s->payments_provider,
            'host' => $s->host,
            'last_reset_at' => $s->last_reset_at,
            'next_reset_at' => $s->next_reset_at,
            'reset_count' => (int) $s->reset_count,
            'reset_by_name' => $s->reset_by_name,
            'dias_reinicio' => self::diasReinicio(),
            'claves' => $claves,
            'cifras' => [
                'claves_activas' => $activas,
                'claves_total' => count($claves),
                'pedidos' => count($dt['orders'] ?? []),
                'comprobantes' => count($dt['documents'] ?? []),
                'mensajes' => count($dt['messages'] ?? []),
                'clientes' => count($dt['customers'] ?? []),
                'productos' => count($dt['products'] ?? []),
            ],
            'orders' => array_reverse($dt['orders'] ?? []),
            'documents' => array_reverse($dt['documents'] ?? []),
            'messages' => array_reverse($dt['messages'] ?? []),
            'customers' => $dt['customers'] ?? [],
            'products' => $dt['products'] ?? [],
            'ejemplo_pedido' => self::ejemploCuerpoPedido(),
            'hoy' => $hoy,
            'puede_reiniciar' => $u ? (Access::can($u, 'api.sandbox.reset') || Access::can($u, 'api.key.manage')) : false,
        ];
    }

    public static function ejemploCuerpoPedido(): array
    {
        $s = self::obtener();
        $dt = json_decode((string) $s->data, true) ?: [];
        $c = $dt['customers'][0] ?? ['id' => 'sbx-cu-1', 'addresses' => [['id' => 'sbx-ad-1']]];
        $p1 = $dt['products'][0] ?? ['sku' => 'SBX-DG-CUY-ENT'];
        $p2 = $dt['products'][2] ?? ($dt['products'][1] ?? ['sku' => 'SBX-DG-CAL-1L']);

        return [
            'customer_id' => $c['id'],
            'fulfillment' => 'DELIVERY',
            'address_id' => $c['addresses'][0]['id'] ?? 'sbx-ad-1',
            'delivery_date' => now('America/Lima')->addDays(2)->toDateString(),
            'slot' => '09:00–13:00',
            'payment_method' => 'CREDIT',
            'notes' => 'Entregar por la puerta de cocina',
            'external_ref' => 'OC-DEMO-0001',
            'lines' => [
                ['sku' => $p1['sku'], 'qty' => 4, 'est_weight_kg' => 3.6],
                ['sku' => $p2['sku'], 'qty' => 2],
            ],
        ];
    }

    private static function datosDemostracion(Carbon $cuando): array
    {
        $productos = [
            ['sku' => 'SBX-DG-CUY-ENT', 'name' => 'Cuy entero (demo)', 'brand' => 'DG', 'sale_mode' => 'UNIT_VARIABLE_WEIGHT', 'nominal_weight_kg' => 0.9, 'price' => 48.0, 'basis' => 'UNIT', 'stock' => 42],
            ['sku' => 'SBX-DG-CON-ENT', 'name' => 'Conejo entero (demo)', 'brand' => 'DG', 'sale_mode' => 'UNIT_VARIABLE_WEIGHT', 'nominal_weight_kg' => 1.4, 'price' => 52.0, 'basis' => 'UNIT', 'stock' => 28],
            ['sku' => 'SBX-DG-CAL-1L', 'name' => 'Caldo concentrado 1 L (demo)', 'brand' => 'DG', 'sale_mode' => 'UNIT_FIXED', 'nominal_weight_kg' => 1.0, 'price' => 25.0, 'basis' => 'UNIT', 'stock' => 65],
            ['sku' => 'SBX-DG-POL-ENT', 'name' => 'Pollo de campo entero (demo)', 'brand' => 'DG', 'sale_mode' => 'KG', 'nominal_weight_kg' => 2.2, 'price' => 18.5, 'basis' => 'KG', 'stock' => 4],
            ['sku' => 'SBX-M2-BON-KG', 'name' => 'Bondiola de cerdo por kg (demo)', 'brand' => 'M2', 'sale_mode' => 'KG', 'nominal_weight_kg' => 1.0, 'price' => 36.0, 'basis' => 'KG', 'stock' => 35],
            ['sku' => 'SBX-M3-CHO-500', 'name' => 'Chorizo artesanal 500 g (demo)', 'brand' => 'M3', 'sale_mode' => 'UNIT_FIXED', 'nominal_weight_kg' => 0.5, 'price' => 22.0, 'basis' => 'UNIT', 'stock' => 50],
        ];

        $clientes = [
            [
                'id' => 'sbx-cu-1',
                'doc_type' => 'RUC',
                'doc_number' => '20601234567',
                'name' => 'RESTAURANTE DEMO SAC',
                'phone' => '+51900000001',
                'addresses' => [
                    ['id' => 'sbx-ad-1', 'address_line' => 'Av. Ejemplo 123, Santiago de Surco', 'reference' => 'Puerta de cocina', 'lat' => -12.13, 'lng' => -76.99],
                ],
            ],
            [
                'id' => 'sbx-cu-2',
                'doc_type' => 'DNI',
                'doc_number' => '40000001',
                'name' => 'Cliente de Prueba',
                'phone' => '+51900000002',
                'addresses' => [
                    ['id' => 'sbx-ad-2', 'address_line' => 'Calle Prueba 456, Miraflores', 'reference' => 'Frente al parque', 'lat' => -12.12, 'lng' => -77.03],
                ],
            ],
            [
                'id' => 'sbx-cu-3',
                'doc_type' => 'RUC',
                'doc_number' => '20552103816',
                'name' => 'TIENDA ONLINE DEMO EIRL',
                'phone' => '+51900000003',
                'addresses' => [],
            ],
        ];

        $estados = ['DELIVERED', 'DELIVERED', 'CONFIRMED', 'IN_ROUTE', 'CANCELLED'];
        $pedidos = [];
        for ($i = 0; $i < 5; $i++) {
            $c = $clientes[$i % 2];
            $p1 = $productos[$i % count($productos)];
            $p2 = $productos[($i + 2) % count($productos)];
            $lineas = [];
            foreach ([$p1, $p2] as $j => $p) {
                $qty = 1 + (($i + $j) % 3);
                $w = $p['basis'] === 'KG' ? round($qty * ($p['nominal_weight_kg'] ?: 1), 3) : null;
                $importe = round(($w ?? $qty) * $p['price'], 2);
                $lineas[] = [
                    'sku' => $p['sku'],
                    'name' => $p['name'],
                    'qty' => $qty,
                    'price_basis' => $p['basis'],
                    'unit_price' => $p['price'],
                    'est_weight_kg' => $w,
                    'weighed_kg' => null,
                    'amount' => $importe,
                ];
            }
            $dia = $cuando->copy()->subDays(5 - $i)->toDateString();
            $total = round(array_sum(array_column($lineas, 'amount')), 2);
            $pedidos[] = [
                'number' => sprintf('SBX-%06d', $i + 1),
                'status' => $estados[$i],
                'brand' => 'DG',
                'channel' => 'B2B',
                'customer' => ['id' => $c['id'], 'name' => $c['name']],
                'external_ref' => sprintf('OC-DEMO-%04d', 100 + $i),
                'fulfillment' => 'DELIVERY',
                'delivery_date' => $dia,
                'slot' => '09:00–13:00',
                'payment_method' => 'CREDIT',
                'estimated_total' => $total,
                'final_total' => null,
                'delivery_fee' => 0,
                'paid_amount' => 0,
                'currency' => 'PEN',
                'created_at' => "{$dia}T08:1{$i}:00",
                'confirmed_at' => "{$dia}T08:2{$i}:00",
                'delivered_at' => $estados[$i] === 'DELIVERED' ? "{$dia}T11:40:00" : null,
                'lines' => $lineas,
                'address_id' => $c['addresses'][0]['id'] ?? null,
                'api_key' => null,
            ];
        }

        $p0 = $pedidos[0];
        $sub0 = round($p0['estimated_total'] / 1.18, 2);
        $igv0 = round($p0['estimated_total'] - $sub0, 2);
        $comprobantes = [
            [
                'full_number' => 'F001-00000001',
                'number' => 'F001-00000001',
                'doc_type' => 'INVOICE',
                'type' => 'INVOICE',
                'issue_date' => $p0['delivery_date'],
                'brand' => 'DG',
                'customer' => ['doc_type' => 'RUC', 'doc_number' => $clientes[0]['doc_number'], 'name' => $clientes[0]['name']],
                'subtotal' => $sub0,
                'igv' => $igv0,
                'total' => $p0['estimated_total'],
                'currency' => 'PEN',
                'sunat_status' => 'ACCEPTED',
                'status' => 'ISSUED',
                'ose' => 'FAKE',
                'ose_adapter' => 'FakeEInvoiceProvider',
                'sent_to_sunat' => false,
                'cdr_code' => '0',
                'ose_message' => 'La F001-00000001 ha sido aceptada (OSE de prueba)',
                'order_number' => $p0['number'],
                'order' => $p0['number'],
            ],
        ];

        return [
            'customers' => $clientes,
            'products' => $productos,
            'orders' => $pedidos,
            'documents' => $comprobantes,
            'payments' => [],
            'messages' => [],
        ];
    }

    private static function guardarEstado(object $s, array $dt, array $seq): void
    {
        DB::table('api_sandboxes')->where('id', $s->id)->update([
            'data' => json_encode($dt, JSON_UNESCAPED_UNICODE),
            'seq' => json_encode($seq),
            'updated_at' => now(),
        ]);
    }

    /* ------------------------------------------------------------------ Operaciones de /api/publica/v1 para claves TEST */

    private static function limite(array $q, int $def = 20): int
    {
        return max(1, min(100, (int) ($q['limit'] ?? $def)));
    }

    public static function listarPedidos(object $k, array $q): array
    {
        $s = self::obtener();
        $dt = json_decode((string) $s->data, true) ?: [];
        $os = array_values(array_filter($dt['orders'] ?? [], function ($o) use ($q) {
            if (! empty($q['status']) && strtoupper((string) $q['status']) !== ($o['status'] ?? '')) {
                return false;
            }
            if (! empty($q['from']) && ($o['delivery_date'] ?? '') < $q['from']) {
                return false;
            }

            return true;
        }));
        $os = array_reverse($os);
        $n = self::limite($q);

        return [
            'data' => array_slice($os, 0, $n),
            'total' => count($os),
            'has_more' => count($os) > $n,
            'sandbox' => true,
        ];
    }

    public static function verPedido(object $k, string $numero): array
    {
        $s = self::obtener();
        $dt = json_decode((string) $s->data, true) ?: [];
        foreach ($dt['orders'] ?? [] as $o) {
            if (($o['number'] ?? '') === $numero) {
                return $o + ['sandbox' => true];
            }
        }
        abort(response()->json([
            'code' => 'RN-API-16',
            'message' => "No existe el pedido {$numero} en el sandbox (las claves de prueba no leen producción).",
        ], 404));
    }

    public static function crearPedido(object $k, array $b): array
    {
        $s = self::obtener();
        $dt = json_decode((string) $s->data, true) ?: [];
        $seq = json_decode((string) $s->seq, true) ?: ['order' => count($dt['orders'] ?? []), 'doc' => count($dt['documents'] ?? [])];

        $cu = collect($dt['customers'] ?? [])->firstWhere('id', $b['customer_id'] ?? '');
        $faltan = [];
        if (! $cu) {
            $faltan[] = 'CLIENTE';
        }
        $fulf = $b['fulfillment'] ?? 'DELIVERY';
        if ($fulf === 'DELIVERY') {
            $dir = $cu ? collect($cu['addresses'] ?? [])->firstWhere('id', $b['address_id'] ?? '') : null;
            if (! $dir && $cu && ! empty($cu['addresses'])) {
                $dir = $cu['addresses'][0];
            }
            if (! $dir) {
                $faltan[] = 'DIRECCION_CON_PIN';
            }
        }
        if (empty($b['delivery_date']) || (empty($b['slot']) && empty($b['slot_id']))) {
            $faltan[] = 'FRANJA';
        }
        $lineas = [];
        foreach (array_values($b['lines'] ?? []) as $l) {
            $sku = (string) ($l['sku'] ?? '');
            $p = collect($dt['products'] ?? [])->firstWhere('sku', $sku);
            if (! $p && ! str_starts_with($sku, 'SBX-')) {
                $p = collect($dt['products'] ?? [])->firstWhere('sku', 'SBX-'.$sku);
            }
            if (! $p) {
                RuleError::fail('RN-PED-02', "El SKU {$sku} no existe en el sandbox.");
            }
            $qty = max(0, (float) ($l['qty'] ?? 1));
            $w = $p['basis'] === 'KG'
                ? (isset($l['est_weight_kg']) ? (float) $l['est_weight_kg'] : ($p['sale_mode'] === 'KG' ? $qty : null))
                : (isset($l['est_weight_kg']) ? (float) $l['est_weight_kg'] : null);
            $importe = round(($p['basis'] === 'KG' ? ($w ?: 0) : $qty) * (float) $p['price'], 2);
            $lineas[] = [
                'sku' => $p['sku'],
                'name' => $p['name'],
                'qty' => $qty,
                'price_basis' => $p['basis'],
                'unit_price' => (float) $p['price'],
                'est_weight_kg' => $w,
                'weighed_kg' => null,
                'amount' => $importe,
            ];
        }
        if (! $lineas) {
            $faltan[] = 'PRODUCTOS';
        }
        if (collect($lineas)->contains(fn ($l) => $l['price_basis'] === 'KG' && ! ($l['est_weight_kg'] > 0))) {
            $faltan[] = 'PESO_ESTIMADO';
        }
        if (empty($b['payment_method'])) {
            $faltan[] = 'FORMA_DE_PAGO';
        }
        if ($faltan) {
            RuleError::fail('RN-PED-01', 'Faltan datos obligatorios: '.implode(', ', $faltan).'.');
        }

        $seq['order'] = ((int) ($seq['order'] ?? 0)) + 1;
        $ahora = now('America/Lima')->format('Y-m-d\TH:i:s');
        $pedido = [
            'number' => sprintf('SBX-%06d', $seq['order']),
            'status' => 'CONFIRMED',
            'brand' => $b['brand'] ?? 'DG',
            'channel' => $k->channel ?: 'B2B',
            'customer' => ['id' => $cu['id'], 'name' => $cu['name']],
            'external_ref' => $b['external_ref'] ?? null,
            'fulfillment' => $fulf,
            'delivery_date' => $b['delivery_date'],
            'slot' => $b['slot'] ?? '09:00–13:00',
            'payment_method' => $b['payment_method'],
            'estimated_total' => round(array_sum(array_column($lineas, 'amount')), 2),
            'final_total' => null,
            'delivery_fee' => 0,
            'paid_amount' => 0,
            'currency' => 'PEN',
            'created_at' => $ahora,
            'confirmed_at' => $ahora,
            'delivered_at' => null,
            'lines' => $lineas,
            'address_id' => $b['address_id'] ?? ($cu['addresses'][0]['id'] ?? null),
            'api_key' => $k->prefix,
        ];
        $dt['orders'][] = $pedido;
        $dt['messages'][] = [
            'at' => $ahora,
            'provider' => 'FAKE',
            'to' => $cu['phone'] ?? '+51900000001',
            'template' => 'confirmacion_pedido',
            'ref' => $pedido['number'],
            'delivered' => false,
            'note' => 'Proveedor FAKE: no se envía a WhatsApp',
        ];
        self::guardarEstado($s, $dt, $seq);
        Webhooks::publicar('order.created', $pedido, ['env' => 'TEST', 'source_id' => $pedido['number']]);

        return $pedido + ['sandbox' => true];
    }

    /** Emite el comprobante de un pedido en el sandbox usando el OSE FAKE (CA-API-07, RN-API-16). */
    public static function emitirComprobante(object $k, string $numero): array
    {
        $s = self::obtener();
        $dt = json_decode((string) $s->data, true) ?: [];
        $seq = json_decode((string) $s->seq, true) ?: ['order' => count($dt['orders'] ?? []), 'doc' => count($dt['documents'] ?? [])];

        $pedido = collect($dt['orders'] ?? [])->firstWhere('number', $numero);
        if (! $pedido) {
            abort(response()->json([
                'code' => 'RN-API-16',
                'message' => "No existe el pedido {$numero} en el sandbox.",
            ], 404));
        }
        $existente = collect($dt['documents'] ?? [])->firstWhere('order_number', $numero);
        if ($existente) {
            return $existente + ['sandbox' => true];
        }
        if (($pedido['status'] ?? '') === 'CANCELLED') {
            RuleError::fail('RN-API-14', "El pedido {$numero} está cancelado.");
        }

        $cu = collect($dt['customers'] ?? [])->firstWhere('id', $pedido['customer']['id'] ?? '') ?? [
            'doc_type' => 'RUC',
            'doc_number' => '20601234567',
            'name' => $pedido['customer']['name'] ?? 'RESTAURANTE DEMO SAC',
        ];
        $tipo = ($cu['doc_type'] ?? 'RUC') === 'RUC' ? 'INVOICE' : 'RECEIPT';
        $seq['doc'] = ((int) ($seq['doc'] ?? 0)) + 1;
        $fullNumber = ($tipo === 'INVOICE' ? 'F001-' : 'B001-').sprintf('%08d', $seq['doc']);
        $total = round((float) ($pedido['estimated_total'] ?? 0) + (float) ($pedido['delivery_fee'] ?? 0), 2);
        $subtotal = round($total / 1.18, 2);
        $igv = round($total - $subtotal, 2);

        $doc = [
            'full_number' => $fullNumber,
            'number' => $fullNumber,
            'doc_type' => $tipo,
            'type' => $tipo,
            'issue_date' => now('America/Lima')->toDateString(),
            'brand' => $pedido['brand'] ?? 'DG',
            'customer' => [
                'doc_type' => $cu['doc_type'] ?? 'RUC',
                'doc_number' => $cu['doc_number'] ?? '20601234567',
                'name' => $cu['name'] ?? 'RESTAURANTE DEMO SAC',
            ],
            'subtotal' => $subtotal,
            'igv' => $igv,
            'total' => $total,
            'currency' => 'PEN',
            'order_number' => $pedido['number'],
            'order' => $pedido['number'],
            'sunat_status' => 'ACCEPTED',
            'status' => 'ISSUED',
            'ose' => 'FAKE',
            'ose_adapter' => 'FakeEInvoiceProvider',
            'cdr_code' => '0',
            'ose_message' => "La {$fullNumber} ha sido aceptada (OSE de prueba)",
            'sent_to_sunat' => false,
        ];
        $dt['documents'][] = $doc;
        self::guardarEstado($s, $dt, $seq);
        Webhooks::publicar('document.accepted', $doc, ['env' => 'TEST', 'source_id' => $fullNumber]);

        return $doc + ['sandbox' => true];
    }

    public static function listarClientes(object $k, array $q): array
    {
        $s = self::obtener();
        $dt = json_decode((string) $s->data, true) ?: [];
        $cs = $dt['customers'] ?? [];
        $t = mb_strtolower(trim((string) ($q['q'] ?? '')));
        if ($t !== '') {
            $cs = array_values(array_filter($cs, fn ($c) => str_contains(mb_strtolower(($c['name'] ?? '').' '.($c['doc_number'] ?? '').' '.($c['phone'] ?? '')), $t)));
        }

        return ['data' => array_slice($cs, 0, self::limite($q)), 'total' => count($cs), 'sandbox' => true];
    }

    public static function crearCliente(object $k, array $b): array
    {
        $nombre = trim((string) ($b['name'] ?? ''));
        $docType = strtoupper(trim((string) ($b['doc_type'] ?? 'DNI')));
        $docNum = trim((string) ($b['doc_number'] ?? ''));
        if ($nombre === '' || $docNum === '') {
            RuleError::fail('RN-API-14', 'Indica el nombre («name») y el número de documento («doc_number»).');
        }
        if ($docType === 'RUC' && ! Ruc::valido($docNum)) {
            RuleError::fail('RN-API-14', "El RUC {$docNum} no es válido (dígito verificador).");
        }
        if ($docType === 'DNI' && ! preg_match('/^\d{8}$/', $docNum)) {
            RuleError::fail('RN-API-14', "El DNI {$docNum} debe tener 8 dígitos.");
        }
        $s = self::obtener();
        $dt = json_decode((string) $s->data, true) ?: [];
        $seq = json_decode((string) $s->seq, true) ?: ['order' => 5, 'doc' => 1];
        $cu = [
            'id' => 'sbx-cu-'.(count($dt['customers'] ?? []) + 1),
            'doc_type' => $docType,
            'doc_number' => $docNum,
            'name' => $nombre,
            'phone' => $b['phone'] ?? null,
            'addresses' => [['id' => 'sbx-ad-'.(count($dt['customers'] ?? []) + 1), 'address_line' => $b['address'] ?? 'Av. Prueba 100, Lima', 'reference' => 'Demo', 'lat' => -12.1, 'lng' => -77.0]],
        ];
        $dt['customers'][] = $cu;
        self::guardarEstado($s, $dt, $seq);

        return $cu + ['status' => 'ACTIVE', 'sandbox' => true];
    }

    public static function productos(object $k, array $q): array
    {
        $s = self::obtener();
        $dt = json_decode((string) $s->data, true) ?: [];
        $ps = $dt['products'] ?? [];
        if (! empty($q['brand'])) {
            $ps = array_values(array_filter($ps, fn ($p) => ($p['brand'] ?? '') === $q['brand']));
        }
        if (! empty($q['sku'])) {
            $ps = array_values(array_filter($ps, fn ($p) => ($p['sku'] ?? '') === $q['sku']));
        }

        return [
            'data' => array_map(fn ($p) => [
                'sku' => $p['sku'],
                'name' => $p['name'],
                'brand' => $p['brand'],
                'sale_mode' => $p['sale_mode'],
                'nominal_weight_kg' => $p['nominal_weight_kg'] ?? null,
            ], array_slice($ps, 0, self::limite($q, 50))),
            'total' => count($ps),
            'sandbox' => true,
        ];
    }

    public static function precios(object $k, array $q): array
    {
        $s = self::obtener();
        $dt = json_decode((string) $s->data, true) ?: [];
        $ps = array_values(array_filter($dt['products'] ?? [], fn ($p) => empty($q['sku']) || ($p['sku'] ?? '') === $q['sku']));

        return [
            'data' => array_map(fn ($p) => [
                'sku' => $p['sku'],
                'name' => $p['name'],
                'brand' => $p['brand'],
                'price' => (float) $p['price'],
                'basis' => $p['basis'],
                'includes_igv' => true,
                'currency' => 'PEN',
            ], array_slice($ps, 0, self::limite($q, 50))),
            'sandbox' => true,
        ];
    }

    public static function stock(object $k, array $q): array
    {
        $s = self::obtener();
        $dt = json_decode((string) $s->data, true) ?: [];
        $ps = array_values(array_filter($dt['products'] ?? [], fn ($p) => empty($q['sku']) || ($p['sku'] ?? '') === $q['sku']));
        $min = (int) (Params::get('api_stock_low_default_qty') ?? 5);

        return [
            'data' => array_map(fn ($p) => [
                'sku' => $p['sku'],
                'name' => $p['name'],
                'brand' => $p['brand'],
                'sale_mode' => $p['sale_mode'],
                'available_qty' => (float) ($p['stock'] ?? 0),
                'status' => ($p['stock'] ?? 0) <= 0 ? 'OUT' : (($p['stock'] ?? 0) <= $min ? 'LOW' : 'OK'),
            ], array_slice($ps, 0, self::limite($q, 50))),
            'as_of' => now('America/Lima')->toIso8601String(),
            'sandbox' => true,
        ];
    }

    public static function comprobantes(object $k, array $q): array
    {
        $s = self::obtener();
        $dt = json_decode((string) $s->data, true) ?: [];
        $ds = array_reverse($dt['documents'] ?? []);

        return ['data' => array_slice($ds, 0, self::limite($q)), 'total' => count($ds), 'sandbox' => true];
    }

    public static function cobros(object $k, array $q): array
    {
        $s = self::obtener();
        $dt = json_decode((string) $s->data, true) ?: [];
        $ps = $dt['payments'] ?? [];

        return ['data' => $ps, 'total' => count($ps), 'sandbox' => true];
    }

    public static function entregas(object $k, array $q): array
    {
        $s = self::obtener();
        $dt = json_decode((string) $s->data, true) ?: [];
        $os = array_values(array_filter($dt['orders'] ?? [], fn ($o) => in_array($o['status'] ?? '', ['IN_ROUTE', 'DELIVERED'], true)));

        return [
            'date' => $q['date'] ?? now('America/Lima')->toDateString(),
            'data' => array_map(fn ($o) => [
                'order' => $o['number'],
                'number' => $o['number'],
                'status' => $o['status'],
                'delivered_at' => $o['delivered_at'] ?? null,
            ], $os),
            'sandbox' => true,
        ];
    }
}
