<?php

namespace App\Modulos\B2b\Services;

use App\Models\User;
use App\Modulos\Canales\Soporte as S;
use App\Modulos\Cat\Services\Precios;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * B2B-11 a B2B-17: portal del cliente empresarial. Todo lo que lee o escribe el portal se filtra por el cliente
 * de la cuenta del usuario en sesión (RN-B2B-12); ningún parámetro de la petición reemplaza a ese cliente.
 */
final class Portal
{
    public const ROLES = ['OWNER' => 'Dueño', 'BUYER' => 'Comprador', 'ACCOUNTING' => 'Contabilidad'];

    public static function esUsuarioDelPortal(User $u): bool
    {
        return $u->user_type === 'B2B_CUSTOMER' || $u->role === 'CLIENTE_B2B'
            || DB::table('b2b_portal_accounts')->where('user_id', $u->id)->exists();
    }

    /** Cuenta del portal del usuario (la primera vez que entra, la invitación pasa a activa). */
    public static function cuentaDe(User $u): ?object
    {
        $a = DB::table('b2b_portal_accounts')->where('user_id', $u->id)->where('status', '<>', 'DISABLED')->first();
        if ($a && $a->status === 'INVITED') {
            DB::table('b2b_portal_accounts')->where('id', $a->id)->update(['status' => 'ACTIVE', 'updated_at' => now()]);
            $a->status = 'ACTIVE';
        }

        return $a;
    }

    /** RN-B2B-14: antes de la hora de corte se entrega mañana; después, pasado mañana. */
    public static function fechaMinima(?\DateTimeInterface $at = null): string
    {
        $at = $at ? \Carbon\CarbonImmutable::instance($at)->setTimezone('America/Lima') : S::ahora();
        $corte = S::texto('b2b_cutoff_time', '16:00');

        return $at->addDays($at->format('H:i') < $corte ? 1 : 2)->toDateString();
    }

    public static function resumen(object $cuenta): array
    {
        $cid = $cuenta->customer_id;
        $c = DB::table('customers')->where('id', $cid)->first(['id', 'full_name', 'doc_number', 'customer_type']);
        $credito = Credito::resumen($cid);

        return [
            'customer' => $c, 'account' => $cuenta, 'role_label' => self::ROLES[$cuenta->portal_role] ?? $cuenta->portal_role,
            'credit' => $cuenta->can_view_statement ? $credito : null,
            'earliest_date' => self::fechaMinima(), 'cutoff' => S::texto('b2b_cutoff_time', '16:00'), 'min_order' => S::num('b2b_min_order_amount', 150),
            'open_orders' => DB::table('sales_orders')->where('customer_id', $cid)->whereNotIn('status', ['DELIVERED', 'CANCELLED', 'CLOSED'])->count(),
            'open_claims' => DB::table('b2b_claims')->where('customer_id', $cid)->whereIn('status', ['OPEN', 'IN_REVIEW'])->count(),
            'last_orders' => self::pedidos($cid, 5),
        ];
    }

    /** Catálogo con el precio que rige para el cliente en la fecha (el suyo antes que la lista, RN-B2B-06). */
    public static function catalogo(string $customerId, ?string $fecha = null, ?string $buscar = null): array
    {
        $fecha = S::fecha($fecha);
        $tipo = DB::table('customers')->where('id', $customerId)->value('customer_type') ?? 'BUSINESS';
        $vs = DB::table('product_variants as v')->leftJoin('brands as b', 'b.id', '=', 'v.brand_id')
            ->where('v.status', 'ACTIVE')->where('v.sellable', true)
            ->when($buscar, fn ($q, $b) => $q->where(fn ($w) => $w->where('v.name', 'ilike', "%{$b}%")->orWhere('v.sku', 'ilike', "%{$b}%")))
            ->orderBy('b.name')->orderBy('v.name')->get(['v.id', 'v.sku', 'v.name', 'v.sale_mode', 'v.nominal_weight_kg', 'v.brand_id', 'b.name as brand_name']);
        $lista = Precios::vigentes($vs->pluck('id')->all(), ['canal' => 'B2B', 'tipo_cliente' => $tipo, 'fecha' => $fecha]);
        $propios = DB::table('customer_prices')->where('customer_id', $customerId)->where('status', 'ACTIVE')->where('valid_from', '<=', $fecha)
            ->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $fecha))->get()->keyBy('variant_id');
        $out = [];
        foreach ($vs as $v) {
            $p = $propios[$v->id] ?? null;
            $l = $lista[$v->id] ?? null;
            if (! $p && ! $l) {
                continue;
            }
            $out[] = (array) $v + [
                'price' => $p ? (float) $p->unit_price : (float) $l['price'], 'basis' => $p ? $p->price_basis : $l['basis'],
                'list_price' => $l['price'] ?? null, 'own_price' => (bool) $p,
            ];
        }

        return $out;
    }

    public static function pedidos(string $customerId, ?int $limite = null): array
    {
        return DB::table('sales_orders as o')->leftJoin('brands as b', 'b.id', '=', 'o.brand_id')->where('o.customer_id', $customerId)
            ->orderByDesc('o.created_at')->when($limite, fn ($q, $n) => $q->limit($n))
            ->get(['o.id', 'o.number', 'o.status', 'o.delivery_date', 'o.slot_from', 'o.slot_to', 'o.estimated_total', 'o.final_total', 'o.created_at', 'o.origin_ref', 'o.portal_account_id', 'b.name as brand_name'])->all();
    }

    public static function pedido(string $customerId, string $orderId): object
    {
        $o = DB::table('sales_orders')->where('id', $orderId)->where('customer_id', $customerId)->first()
            ?? RuleError::fail('RN-B2B-12', 'Ese pedido no pertenece a tu empresa.');
        $o->lines = Pedidos::lineas($o->id);
        $o->documents = DB::table('sales_documents')->where('order_id', $o->id)->where('customer_id', $customerId)
            ->get(['id', 'doc_type', 'full_number', 'issue_date', 'total', 'sunat_status', 'status'])->all();

        return $o;
    }

    /** Líneas para repetir un pedido, con el precio de hoy y la diferencia contra el que se pagó. */
    public static function repetir(string $customerId, string $orderId): array
    {
        $o = self::pedido($customerId, $orderId);
        $fecha = self::fechaMinima();
        $out = [];
        foreach ($o->lines as $l) {
            $p = PreciosCliente::precio($customerId, $l->variant_id, $fecha);
            $activa = $l->variant_status === 'ACTIVE' && $l->sellable && $p;
            $out[] = [
                'variant_id' => $l->variant_id, 'variant_name' => $l->variant_name, 'sale_mode' => $l->sale_mode, 'qty' => (float) $l->qty,
                'est_weight_kg' => $l->est_weight_kg !== null ? (float) $l->est_weight_kg : null, 'old_price' => (float) $l->unit_price,
                'new_price' => $p['price'] ?? null, 'basis' => $p['basis'] ?? $l->price_basis,
                'diff' => $p ? S::r($p['price'] - (float) $l->unit_price) : null, 'active' => (bool) $activa,
            ];
        }

        return ['order' => ['id' => $o->id, 'number' => $o->number], 'lines' => $out, 'earliest_date' => $fecha];
    }

    /**
     * Pedido del portal (RN-B2B-13, 14): pedido mínimo y hora de corte. Un pedido por marca. Se confirma solo si tiene
     * los datos completos y pasa el control de crédito; si no, queda en borrador y pasa a la vendedora.
     *
     * @param  array{lines: array, delivery_date: ?string, slot_from?: ?string, notes?: ?string, pay?: ?string, repeat_of?: ?string}  $d
     */
    public static function pedir(object $cuenta, array $d, User $quien): array
    {
        $cid = $cuenta->customer_id;
        $cuenta->can_order || RuleError::fail('RN-B2B-12', 'Tu usuario del portal no tiene permiso para hacer pedidos.');
        $lineas = array_values(array_filter($d['lines'] ?? [], fn ($l) => (float) ($l['qty'] ?? 0) > 0));
        $lineas || RuleError::fail('RN-B2B-14', 'El carrito está vacío.');
        $minima = self::fechaMinima();
        $entrega = $d['delivery_date'] ?? null;
        if (! $entrega || S::fecha($entrega) < $minima) {
            RuleError::fail('RN-B2B-14', 'Con la hora de corte de las '.S::texto('b2b_cutoff_time', '16:00').' el pedido se entrega desde el '.S::dmy($minima).'. Elige esa fecha o una posterior.');
        }
        $total = 0.0;
        $porMarca = [];
        foreach ($lineas as $l) {
            $v = DB::table('product_variants')->where('id', $l['variant_id'] ?? null)->where('status', 'ACTIVE')->where('sellable', true)->first()
                ?? RuleError::fail('RN-B2B-14', 'Uno de los productos ya no está disponible.');
            $p = PreciosCliente::precio($cid, $v->id, $entrega) ?? RuleError::fail('RN-B2B-06', "{$v->name} no tiene precio para tu empresa.");
            $q = (float) $l['qty'];
            $kg = $v->sale_mode === 'KG' ? $q : ($v->nominal_weight_kg ? $q * (float) $v->nominal_weight_kg : $q);
            $total += ($p['basis'] === 'KG' ? $kg : $q) * $p['price'];
            $porMarca[$v->brand_id ?? ''][] = ['variant_id' => $v->id, 'qty' => $q, 'est_weight_kg' => $l['est_weight_kg'] ?? null, 'cut_notes' => $l['cut_notes'] ?? null];
        }
        $min = S::num('b2b_min_order_amount', 150);
        S::r($total) + 0.005 >= $min || RuleError::fail('RN-B2B-14', 'El pedido mínimo en el portal es '.S::soles($min).'; tu carrito suma '.S::soles($total).'.');

        $ficha = Credito::ficha($cid);
        $pago = match ($d['pay'] ?? 'AUTO') {
            'CASH', 'TRANSFER' => DB::table('payment_methods')->where('code', 'TRANSFER')->value('id'),
            default => $ficha ? Credito::metodoCredito() : DB::table('payment_methods')->where('code', 'TRANSFER')->value('id'),
        };
        $origen = ! empty($d['repeat_of']) ? 'Repetir '.(DB::table('sales_orders')->where('id', $d['repeat_of'])->where('customer_id', $cid)->value('number') ?? 'pedido') : 'Portal B2B';
        $res = [];
        foreach ($porMarca as $marca => $ls) {
            $o = Pedidos::crear([
                'customer_id' => $cid, 'brand_id' => $marca ?: null, 'delivery_date' => $entrega, 'slot_from' => $d['slot_from'] ?? null,
                'payment_method_id' => $pago, 'requested_doc_type' => 'INVOICE', 'notes' => $d['notes'] ?? 'Pedido del portal B2B',
                'seller_id' => $ficha->seller_user_id ?? null, 'portal_account_id' => $cuenta->id, 'origin_ref' => $origen, 'lines' => $ls,
            ], $quien);
            $falta = Pedidos::faltantes($o);
            $motivo = null;
            $confirmado = false;
            if ($falta) {
                $motivo = 'Falta '.implode(', ', $falta).'.';
            } else {
                $r = Credito::revisar($o);
                if ($r['ok']) {
                    Credito::confirmar($o->id, $quien, 'Pedido del portal B2B');
                    $confirmado = true;
                } else {
                    $motivo = $r['message'];
                }
            }
            if (! $confirmado && $o->seller_id) {
                S::avisar('B2B', ['user_id' => $o->seller_id], 'Pedido del portal por revisar', DB::table('customers')->where('id', $cid)->value('full_name')." · {$o->number}: {$motivo}", 'B2B-01', $o->id, 'warning');
            }
            Events::emit('b2b_portal.order_placed', 'sales_orders', $o->id, ['customer_id' => $cid, 'confirmed' => $confirmado]);
            $res[] = ['order' => DB::table('sales_orders')->where('id', $o->id)->first(['id', 'number', 'status', 'delivery_date', 'estimated_total']), 'confirmed' => $confirmado, 'reason' => $motivo];
        }

        return $res;
    }

    public static function documentos(string $customerId): array
    {
        return DB::table('sales_documents as d')->leftJoin('sales_orders as o', 'o.id', '=', 'd.order_id')->where('d.customer_id', $customerId)
            ->whereIn('d.doc_type', ['INVOICE', 'RECEIPT', 'CREDIT_NOTE', 'DEBIT_NOTE'])->orderByDesc('d.issue_date')->orderByDesc('d.number')
            ->get(['d.id', 'd.doc_type', 'd.full_number', 'd.issue_date', 'd.due_date', 'd.total', 'd.balance', 'd.payment_terms', 'd.sunat_status', 'd.status', 'o.number as order_number'])->all();
    }

    /** RN-B2B-18: solo se descarga un comprobante aceptado por la SUNAT y de la propia empresa. */
    public static function descargar(string $customerId, string $docId, string $tipo): array
    {
        $d = DB::table('sales_documents')->where('id', $docId)->where('customer_id', $customerId)->first()
            ?? RuleError::fail('RN-B2B-12', 'Ese comprobante no pertenece a tu empresa.');
        $d->sunat_status === 'ACCEPTED' || RuleError::fail('RN-B2B-18', "{$d->full_number} aún no está aceptado por la SUNAT: podrás descargarlo cuando tenga su constancia.");
        $ruc = DB::table('companies')->where('id', $d->company_id)->value('ruc') ?? '20';
        $cod = ['INVOICE' => '01', 'RECEIPT' => '03', 'CREDIT_NOTE' => '07', 'DEBIT_NOTE' => '08'][$d->doc_type] ?? '00';
        $ext = ['PDF' => 'pdf', 'XML' => 'xml', 'CDR' => 'zip'][strtoupper($tipo)] ?? 'pdf';

        return ['name' => "{$ruc}-{$cod}-{$d->series}-".str_pad((string) $d->number, 8, '0', STR_PAD_LEFT).".{$ext}", 'document' => $d];
    }

    /* ------------------------------------------------------------ usuarios del portal (B2B-11 y B2B-17) */

    public static function usuarios(?string $customerId = null): array
    {
        return DB::table('b2b_portal_accounts as a')->join('users as u', 'u.id', '=', 'a.user_id')->join('customers as c', 'c.id', '=', 'a.customer_id')
            ->when($customerId, fn ($q, $c) => $q->where('a.customer_id', $c))->orderBy('c.full_name')->orderBy('a.portal_role')->orderBy('u.name')
            ->get(['a.*', 'u.name', 'u.email', 'u.last_login', 'c.full_name as customer_name'])->all();
    }

    /** Invita a un usuario del cliente: crea su usuario del portal ligado a ese solo cliente (RN-B2B-12). */
    public static function invitar(string $customerId, array $d, User $quien): object
    {
        return DB::transaction(function () use ($customerId, $d, $quien) {
            $nombre = trim((string) ($d['name'] ?? ''));
            $correo = mb_strtolower(trim((string) ($d['email'] ?? '')));
            ($nombre && $correo) || RuleError::fail('RN-B2B-12', 'Nombre y correo son obligatorios.');
            filter_var($correo, FILTER_VALIDATE_EMAIL) || RuleError::fail('RN-B2B-12', 'El correo no es válido.');
            $rol = $d['portal_role'] ?? 'BUYER';
            in_array($rol, ['BUYER', 'ACCOUNTING'], true) || RuleError::fail('RN-B2B-12', 'El rol debe ser comprador o contabilidad.');
            DB::table('customers')->where('id', $customerId)->exists() || abort(404);
            DB::table('users')->whereRaw('lower(email) = ?', [$correo])->exists() && RuleError::fail('RN-B2B-12', 'Ya existe un usuario con ese correo.');
            $uid = (string) Str::uuid();
            DB::table('users')->insert([
                'id' => $uid, 'name' => $nombre, 'email' => $correo, 'role' => 'CLIENTE_B2B', 'user_type' => 'B2B_CUSTOMER', 'customer_id' => $customerId,
                'status' => 'ACTIVE', 'twofa_enabled' => false, 'must_change_password' => true, 'password' => Hash::make(Str::random(24)),
                'invited_at' => now(), 'invited_by' => $quien->id, 'created_at' => now(), 'updated_at' => now(),
            ]);
            $rolId = DB::table('roles')->where('code', 'CLIENTE_B2B')->value('id');
            $rolId && DB::table('user_roles')->insert(['user_id' => $uid, 'role_id' => $rolId]);
            $id = DB::table('b2b_portal_accounts')->insertGetId([
                'customer_id' => $customerId, 'user_id' => $uid, 'portal_role' => $rol, 'can_order' => $rol !== 'ACCOUNTING', 'can_view_statement' => true,
                'invited_by' => $quien->id, 'invited_at' => now(), 'status' => 'INVITED',
            ], 'id');
            Events::emit('b2b_portal.user_invited', 'b2b_portal_accounts', $id, ['customer_id' => $customerId, 'email' => $correo]);

            return DB::table('b2b_portal_accounts')->where('id', $id)->first();
        });
    }

    public static function activar(string $accountId, bool $activo, User $quien, ?string $customerId = null): object
    {
        return DB::transaction(function () use ($accountId, $activo, $quien, $customerId) {
            $a = DB::table('b2b_portal_accounts')->where('id', $accountId)->when($customerId, fn ($q, $c) => $q->where('customer_id', $c))->lockForUpdate()->first() ?? abort(404);
            $a->portal_role !== 'OWNER' || ! $customerId || RuleError::fail('RN-B2B-12', 'El dueño de la cuenta no se desactiva desde el portal.');
            $a->user_id !== $quien->id || RuleError::fail('RN-B2B-12', 'No puedes desactivar tu propio usuario.');
            DB::table('b2b_portal_accounts')->where('id', $a->id)->update(['status' => $activo ? 'ACTIVE' : 'DISABLED', 'disabled_at' => $activo ? null : now(), 'updated_at' => now()]);
            DB::table('users')->where('id', $a->user_id)->update(['status' => $activo ? 'ACTIVE' : 'INACTIVE', 'deactivated_at' => $activo ? null : now(), 'updated_at' => now()]);

            return DB::table('b2b_portal_accounts')->where('id', $a->id)->first();
        });
    }
}
