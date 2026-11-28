<?php

namespace App\Modulos\Caj\Services;

use App\Models\User;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * CAJ-05 Mensaje de pago: arma el mensaje para el cliente con el monto y los datos de la cuenta de la empresa
 * (enlace de Mercado Pago, QR oficial de Yape o Plin, cuenta bancaria). Los datos salen de la cuenta y la
 * vendedora no los puede cambiar (RN-CAJ-01).
 */
final class Mensajes
{
    public const MEDIOS = ['YAPE' => 'WALLET', 'PLIN' => 'WALLET', 'MP' => 'GATEWAY', 'TRANSFER' => 'BANK'];

    /** Cuentas de la marca para cada medio con el que el cliente paga a distancia. */
    public static function opciones(?string $marca): array
    {
        $r = [];
        foreach (self::MEDIOS as $codigo => $tipo) {
            $m = DB::table('payment_methods')->where('code', $codigo)->where('status', 'ACTIVE')->first(['code', 'name']);
            if (! $m) {
                continue;
            }
            $cuentas = self::cuentas($codigo, $marca);
            if ($cuentas->isNotEmpty()) {
                $r[] = ['code' => $m->code, 'name' => $m->name, 'cuentas' => $cuentas->map(fn ($c) => ['id' => $c->id, 'name' => $c->name])->values()];
            }
        }

        return $r;
    }

    private static function cuentas(string $medio, ?string $marca)
    {
        $tipo = self::MEDIOS[$medio] ?? null;

        return DB::table('cash_accounts')->where('status', 'ACTIVE')->where('account_type', $tipo)
            ->where(fn ($w) => $w->whereNull('brand_id')->when($marca, fn ($x) => $x->orWhere('brand_id', $marca)))
            ->when(in_array($medio, ['YAPE', 'PLIN'], true), fn ($q) => $q->orderByRaw('code = ? desc', [$medio]))
            ->orderByRaw('brand_id is null')->orderBy('code')->get();
    }

    /** $d: order_id o (customer_id, amount, brand_id), method, cash_account_id (opcional). */
    public static function armar(array $d, User $u): array
    {
        $o = ! empty($d['order_id']) ? DB::table('sales_orders')->where('id', $d['order_id'])->first() : null;
        if (! empty($d['order_id']) && (! $o || ! Base::enAlcance($u, $o->brand_id, $o->establishment_id))) {
            abort(404, 'No se encontró el pedido.');
        }
        $clienteId = $o?->customer_id ?? ($d['customer_id'] ?? null);
        $cliente = $clienteId ? DB::table('customers')->where('id', $clienteId)->first(['id', 'full_name', 'phone', 'doc_type']) : null;
        if (! $cliente) {
            RuleError::fail('RN-CAJ-01', 'Elige el pedido o el cliente.');
        }
        $marca = $o?->brand_id ?? ($d['brand_id'] ?? null);
        $monto = $o ? Cobros::pendientePedido($o) : Base::r($d['amount'] ?? 0);
        if (! empty($d['amount']) && $o) {
            $monto = min($monto, Base::r($d['amount']));
        }
        if ($monto <= 0) {
            RuleError::fail('RN-CAJ-05', $o ? "El pedido {$o->number} no tiene saldo por pagar." : 'Escribe el monto a pagar.');
        }
        $medio = $d['method'] ?? '';
        if (! isset(self::MEDIOS[$medio])) {
            RuleError::fail('RN-CAJ-01', 'Elige cómo pagará el cliente: Yape, Plin, Mercado Pago o transferencia.');
        }
        $cuentas = self::cuentas($medio, $marca);
        $c = ! empty($d['cash_account_id']) ? $cuentas->firstWhere('id', $d['cash_account_id']) : $cuentas->first();
        if (! $c) {
            RuleError::fail('RN-CAJ-01', 'La marca no tiene una cuenta activa para ese medio: pídele a gerencia que la configure en Cuentas.');
        }
        $nombreMarca = $marca ? DB::table('brands')->where('id', $marca)->value('name') : null;
        // A una empresa (RUC) se le saluda por su razón social; a una persona, por su primer nombre.
        $empresa = $cliente->doc_type === 'RUC' || preg_match('/\b(S\.?A\.?C?|E\.?I\.?R\.?L|S\.?R\.?L)\.?$/iu', trim($cliente->full_name));
        $pila = $empresa ? trim($cliente->full_name) : trim(explode(' ', trim($cliente->full_name))[0] ?? '');
        $ref = $o?->number;
        $lineas = ['Hola'.($pila !== '' ? " {$pila}" : '').' 👋', ''];
        $lineas[] = ($ref ? "El total por pagar de tu pedido {$ref}" : 'El monto por pagar').' es *'.Base::soles($monto).'*.';
        $lineas[] = '';
        switch ($medio) {
            case 'YAPE':
            case 'PLIN':
                $nombre = $medio === 'YAPE' ? 'Yape' : 'Plin';
                $lineas[] = "Puedes pagar por {$nombre} al número *".($c->account_number ?: '—').'*'.($c->holder_name ? " a nombre de *{$c->holder_name}*" : '').'.';
                $lineas[] = 'También puedes escanear el QR que te enviamos.';
                break;
            case 'MP':
                if (! $c->payment_link_base) {
                    RuleError::fail('RN-CAJ-01', 'La cuenta de Mercado Pago no tiene enlace de pago: pídele a gerencia que lo configure.');
                }
                $lineas[] = 'Puedes pagar con tarjeta en nuestro enlace de Mercado Pago:';
                $lineas[] = $c->payment_link_base;
                break;
            case 'TRANSFER':
                $lineas[] = 'Puedes transferir a nuestra cuenta '.($c->bank_name ?: $c->name).':';
                $lineas[] = 'Cuenta: *'.($c->account_number ?: '—').'*';
                if ($c->cci) {
                    $lineas[] = 'CCI: *'.$c->cci.'*';
                }
                if ($c->holder_name) {
                    $lineas[] = "Titular: {$c->holder_name}";
                }
                break;
        }
        $lineas[] = '';
        $lineas[] = $ref ? "Al pagar, envíanos la captura y el número de operación con la referencia {$ref}. ¡Gracias!" : 'Al pagar, envíanos la captura y el número de operación. ¡Gracias!';
        if ($nombreMarca) {
            $lineas[] = "— {$nombreMarca}";
        }
        $texto = implode("\n", $lineas);
        $tel = preg_replace('/\D/', '', (string) $cliente->phone);
        if ($tel !== '' && strlen($tel) === 9) {
            $tel = '51'.$tel;
        }

        return [
            'texto' => $texto, 'monto' => $monto, 'pedido' => $ref, 'cliente' => $cliente->full_name, 'telefono' => $cliente->phone,
            'whatsapp' => $tel !== '' ? 'https://wa.me/'.$tel.'?text='.rawurlencode($texto) : null,
            'cuenta' => ['id' => $c->id, 'name' => $c->name, 'account_type' => $c->account_type, 'holder_name' => $c->holder_name, 'account_number' => $c->account_number,
                'cci' => $c->cci, 'bank_name' => $c->bank_name, 'payment_link_base' => $c->payment_link_base, 'qr_payload' => in_array($medio, ['YAPE', 'PLIN'], true) ? $c->qr_payload : null],
        ];
    }
}
