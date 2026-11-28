<?php

namespace App\Modulos\Pos\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Cajas registradoras del mostrador (POS-11): local, almacén del que descuenta, caja de efectivo,
 * cuenta del adquirente del POS de tarjeta, series, modo de balanza y lista de precios por defecto.
 * La caja dice de dónde sale el stock (RN-POS-10), a qué cuenta va cada cobro y con qué serie se
 * emite el comprobante.
 */
final class Cajas
{
    public const MODOS_BALANZA = ['MANUAL', 'SCALE', 'LABEL'];

    public const EPS = 0.005;

    /** La caja con su alcance: una caja de un local fuera del alcance del usuario no existe para él. */
    public static function caja(?string $id, ?User $u = null): object
    {
        $t = $id ? DB::table('pos_terminals')->where('id', $id)->first() : null;
        if (! $t || ($u && ! self::enAlcance($t->establishment_id, $u))) {
            abort(404, 'Caja registradora no encontrada.');
        }

        return $t;
    }

    public static function enAlcance(?string $establishmentId, User $u): bool
    {
        $a = Access::for($u);

        return ! $a['establishments'] || in_array($establishmentId, $a['establishments'], true);
    }

    /** Cajas visibles para el usuario, con los nombres de lo que tienen configurado. */
    public static function visibles(User $u, bool $soloActivas = false): Collection
    {
        $a = Access::for($u);

        return DB::table('pos_terminals as t')
            ->leftJoin('establishments as e', 'e.id', '=', 't.establishment_id')
            ->leftJoin('warehouses as w', 'w.id', '=', 't.warehouse_id')
            ->leftJoin('cash_accounts as c', 'c.id', '=', 't.cash_account_id')
            ->leftJoin('cash_accounts as k', 'k.id', '=', 't.card_account_id')
            ->leftJoin('document_series as rs', 'rs.id', '=', 't.receipt_series_id')
            ->leftJoin('document_series as fs', 'fs.id', '=', 't.invoice_series_id')
            ->leftJoin('price_lists as pl', 'pl.id', '=', 't.default_price_list_id')
            ->when($a['establishments'], fn ($q) => $q->whereIn('t.establishment_id', $a['establishments']))
            ->when($soloActivas, fn ($q) => $q->where('t.status', 'ACTIVE'))
            ->orderBy('t.code')
            ->get(['t.*', 'e.name as local', 'w.name as almacen', 'w.code as almacen_code', 'c.name as caja_efectivo', 'k.name as cuenta_tarjeta',
                'rs.series as serie_boleta', 'fs.series as serie_factura', 'pl.name as lista_precios',
                DB::raw("(select s.number from pos_shifts s where s.terminal_id = t.id and s.status = 'OPEN' limit 1) as turno_abierto"),
                DB::raw("(select s.cashier_name from pos_shifts s where s.terminal_id = t.id and s.status = 'OPEN' limit 1) as turno_cajera")]);
    }

    /** Opciones del formulario de POS-11. */
    public static function opciones(User $u): array
    {
        $a = Access::for($u);
        $locales = DB::table('establishments')->where('status', 'ACTIVE')
            ->when($a['establishments'], fn ($q) => $q->whereIn('id', $a['establishments']))->orderBy('name')->get(['id', 'code', 'name']);

        return [
            'locales' => $locales,
            'almacenes' => DB::table('warehouses')->where('status', 'ACTIVE')->where('allows_sale', true)->whereIn('establishment_id', $locales->pluck('id'))
                ->orderBy('code')->get(['id', 'code', 'name', 'establishment_id', 'wh_type']),
            'cajas_efectivo' => DB::table('cash_accounts')->where('status', 'ACTIVE')->where('account_type', 'CASH_REGISTER')->orderBy('code')
                ->get(['id', 'code', 'name', 'establishment_id']),
            'cuentas_tarjeta' => DB::table('cash_accounts')->where('status', 'ACTIVE')->where('account_type', 'CARD_ACQUIRER')->orderBy('code')
                ->get(['id', 'code', 'name', 'establishment_id', 'fee_pct']),
            'series_boleta' => self::series('RECEIPT'),
            'series_factura' => self::series('INVOICE'),
            'listas' => DB::table('price_lists')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'code', 'name', 'brand_id', 'channels']),
            'modos_balanza' => [['MANUAL', 'Peso digitado'], ['SCALE', 'Balanza conectada'], ['LABEL', 'Etiqueta de balanza']],
        ];
    }

    private static function series(string $tipo): Collection
    {
        return DB::table('document_series as s')->leftJoin('brands as b', 'b.id', '=', 's.brand_id')
            ->where('s.doc_type', $tipo)->where('s.status', 'ACTIVE')->orderBy('s.series')
            ->get(['s.id', 's.series', 's.brand_id', 's.establishment_id', 's.all_sites', 's.note', 'b.name as marca']);
    }

    /** Crea o edita una caja (POS-11). Valida que cada pieza sea del mismo local y del tipo correcto. */
    public static function guardar(?string $id, array $d, User $u): object
    {
        return DB::transaction(function () use ($id, $d, $u) {
            $antes = $id ? self::caja($id, $u) : null;
            $v = fn (string $k) => array_key_exists($k, $d) ? ($d[$k] === '' ? null : $d[$k]) : ($antes->{$k} ?? null);

            $code = strtoupper(trim((string) $v('code')));
            $name = trim((string) $v('name'));
            if ($code === '' || $name === '') {
                RuleError::fail('RN-POS-01', 'Escribe el código y el nombre de la caja.');
            }
            if (mb_strlen($code) > 20 || mb_strlen($name) > 80) {
                RuleError::fail('RN-POS-01', 'El código va hasta 20 caracteres y el nombre hasta 80.');
            }
            if (DB::table('pos_terminals')->where('code', $code)->when($antes, fn ($q) => $q->where('id', '<>', $antes->id))->exists()) {
                RuleError::fail('RN-POS-01', "Ya existe una caja con el código {$code}.");
            }

            $local = $v('establishment_id');
            $e = $local ? DB::table('establishments')->where('id', $local)->first(['id', 'status', 'company_id']) : null;
            if (! $e || $e->status !== 'ACTIVE' || ! self::enAlcance($e->id, $u)) {
                RuleError::fail('RN-POS-01', 'Elige un local activo de tu alcance.');
            }

            $alm = $v('warehouse_id');
            $w = $alm ? DB::table('warehouses')->where('id', $alm)->first(['id', 'establishment_id', 'allows_sale', 'status', 'name']) : null;
            if (! $w || $w->establishment_id !== $e->id || ! $w->allows_sale || $w->status !== 'ACTIVE') {
                RuleError::fail('RN-POS-10', 'El almacén del que descuenta la caja debe ser del mismo local, estar activo y permitir la venta.');
            }

            $caja = $v('cash_account_id');
            if ($caja) {
                $c = DB::table('cash_accounts')->where('id', $caja)->first(['account_type', 'status', 'establishment_id']);
                if (! $c || $c->account_type !== 'CASH_REGISTER' || $c->status !== 'ACTIVE' || ($c->establishment_id && $c->establishment_id !== $e->id)) {
                    RuleError::fail('RN-CAJ-01', 'La caja de efectivo debe ser una caja registradora activa del mismo local.');
                }
            }
            $tarjeta = $v('card_account_id');
            if ($tarjeta) {
                $c = DB::table('cash_accounts')->where('id', $tarjeta)->first(['account_type', 'status']);
                if (! $c || $c->account_type !== 'CARD_ACQUIRER' || $c->status !== 'ACTIVE') {
                    RuleError::fail('RN-CAJ-01', 'La cuenta del POS de tarjeta debe ser una cuenta de adquirente activa.');
                }
            }

            $boleta = $v('receipt_series_id');
            self::validarSerie($boleta, 'RECEIPT', $e, true);
            $factura = $v('invoice_series_id');
            self::validarSerie($factura, 'INVOICE', $e, false);

            $lista = $v('default_price_list_id');
            if ($lista && ! DB::table('price_lists')->where('id', $lista)->where('status', 'ACTIVE')->exists()) {
                RuleError::fail('RN-CAT-05', 'La lista de precios por defecto debe estar activa.');
            }

            $modo = $v('scale_mode') ?: 'MANUAL';
            if (! in_array($modo, self::MODOS_BALANZA, true)) {
                RuleError::fail('RN-POS-04', 'Modo de balanza no válido.');
            }
            $estado = $v('status') ?: 'ACTIVE';
            if (! in_array($estado, ['ACTIVE', 'INACTIVE'], true)) {
                RuleError::fail('RN-POS-01', 'Estado no válido.');
            }
            if ($antes && $estado === 'INACTIVE' && DB::table('pos_shifts')->where('terminal_id', $antes->id)->where('status', 'OPEN')->exists()) {
                RuleError::fail('RN-POS-01', 'La caja tiene un turno abierto: ciérralo antes de desactivarla.');
            }
            if ($antes && ($antes->establishment_id !== $e->id || $antes->warehouse_id !== $w->id)
                && DB::table('pos_shifts')->where('terminal_id', $antes->id)->where('status', 'OPEN')->exists()) {
                RuleError::fail('RN-POS-01', 'La caja tiene un turno abierto: no cambies su local ni su almacén hasta cerrarlo.');
            }

            $datos = [
                'code' => $code, 'name' => $name, 'establishment_id' => $e->id, 'warehouse_id' => $w->id,
                'cash_account_id' => $caja, 'card_account_id' => $tarjeta, 'receipt_series_id' => $boleta, 'invoice_series_id' => $factura,
                'scale_mode' => $modo, 'default_price_list_id' => $lista, 'status' => $estado, 'updated_at' => now(),
            ];
            if ($antes) {
                DB::table('pos_terminals')->where('id', $antes->id)->update($datos);
                $tid = $antes->id;
            } else {
                $tid = DB::table('pos_terminals')->insertGetId($datos + ['created_at' => now()], 'id');
            }
            Events::emit($antes ? 'pos.terminal.updated' : 'pos.terminal.created', 'pos_terminals', $tid, ['code' => $code]);

            return DB::table('pos_terminals')->where('id', $tid)->first();
        });
    }

    /** RN-FAC-02: la serie es del tipo, está activa y sirve para el local (o para todos). */
    private static function validarSerie(?string $id, string $tipo, object $local, bool $obligatoria): void
    {
        $nombre = $tipo === 'RECEIPT' ? 'boleta' : 'factura';
        if (! $id) {
            if ($obligatoria) {
                RuleError::fail('RN-FAC-02', "Elige la serie de {$nombre} de la caja.");
            }

            return;
        }
        $s = DB::table('document_series')->where('id', $id)->first(['doc_type', 'status', 'establishment_id', 'all_sites', 'company_id']);
        if (! $s || $s->doc_type !== $tipo || $s->status !== 'ACTIVE') {
            RuleError::fail('RN-FAC-02', "La serie de {$nombre} debe ser una serie de {$nombre} activa.");
        }
        if ($s->company_id !== $local->company_id || ($s->establishment_id && $s->establishment_id !== $local->id && ! $s->all_sites)) {
            RuleError::fail('RN-FAC-02', "La serie de {$nombre} no es de la empresa ni del local de la caja.");
        }
    }

    /** Medios de pago del mostrador: los activos que admiten el canal COUNTER, más el saldo a favor. */
    public static function medios(): Collection
    {
        return DB::table('payment_methods')->whereIn('status', ['ACTIVE', 'INTERNAL'])->orderBy('sort_order')->orderBy('name')
            ->get(['id', 'code', 'name', 'kind', 'requires_reference', 'allowed_channels'])
            ->filter(function ($m) {
                if ($m->code === 'BALANCE') {
                    return true;
                }
                $c = is_string($m->allowed_channels) ? json_decode($m->allowed_channels, true) : $m->allowed_channels;

                return is_array($c) && in_array('COUNTER', $c, true) && $m->kind !== 'CREDIT';
            })
            ->map(fn ($m) => ['id' => $m->id, 'code' => $m->code, 'name' => $m->name, 'kind' => $m->kind, 'requires_reference' => (bool) $m->requires_reference])
            ->values();
    }

    /** Medios que se cuentan en el arqueo (todo menos el saldo a favor, que no entra a la caja). */
    public static function mediosDeArqueo(): Collection
    {
        return self::medios()->where('code', '<>', 'BALANCE')->values();
    }

    /** La cuenta a la que va un cobro del mostrador según el medio (RN-CAJ-01). */
    public static function cuentaDelCobro(object $caja, array $medio): string
    {
        $id = match ($medio['kind']) {
            'CASH' => $caja->cash_account_id,
            'CARD' => $caja->card_account_id,
            default => null,
        };
        if (! $id) {
            $tipo = match ($medio['kind']) {
                'CASH' => 'CASH_REGISTER', 'CARD' => 'CARD_ACQUIRER', 'WALLET' => 'WALLET', 'GATEWAY' => 'GATEWAY', default => 'BANK',
            };
            $id = DB::table('cash_accounts')->where('status', 'ACTIVE')->where('account_type', $tipo)
                ->when($tipo === 'CASH_REGISTER', fn ($q) => $q->where('establishment_id', $caja->establishment_id))
                ->orderByRaw('code = ? desc', [$medio['code']])->orderBy('code')->value('id');
        }
        if (! $id) {
            RuleError::fail('RN-CAJ-01', "No hay una cuenta activa para cobrar con {$medio['name']}: configúrala en la caja (POS-11) o en Cajas y cuentas.");
        }

        return $id;
    }

    /** «Clientes varios (mostrador)»: el cliente de la venta sin identificar. Se crea la primera vez. */
    public static function clienteVarios(): string
    {
        $id = DB::table('customers')->where('customer_type', 'OTHER')->where('doc_type', 'NONE')
            ->where('full_name', 'Clientes varios (mostrador)')->whereNull('merged_into_id')->value('id');
        if ($id) {
            return $id;
        }

        return DB::table('customers')->insertGetId([
            'doc_type' => 'NONE', 'full_name' => 'Clientes varios (mostrador)', 'customer_type' => 'OTHER', 'status' => 'ACTIVE',
            'source_channel' => 'COUNTER', 'marketing_opt_in' => false, 'orders_count' => 0, 'segment_brands' => '[]',
            'created_by' => 'Mostrador', 'created_at' => now(),
        ], 'id');
    }
}
