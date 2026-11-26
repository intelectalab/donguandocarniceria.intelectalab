<?php

namespace App\Modulos\Cnt\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * CNT-01 Plan de cuentas y CNT-02 Reglas de asiento.
 *  RN-CNT-05  solo las cuentas de detalle reciben movimientos; una cuenta con movimientos no deja de recibirlos.
 *  RN-CNT-21  la practicante no cambia reglas ni el plan (cnt.account.manage y cnt.rule.manage son de la contadora).
 */
final class PlanService
{
    public const TIPOS = ['ASSET' => 'Activo', 'LIABILITY' => 'Pasivo', 'EQUITY' => 'Patrimonio', 'INCOME' => 'Ingreso', 'EXPENSE' => 'Gasto', 'COST' => 'Costo',
        'ANALYTIC' => 'Analítica (clase 9)', 'CONTROL' => 'Control'];

    public const ORIGENES = ['SALE' => 'Venta', 'PURCHASE' => 'Compra', 'NTI' => 'NTI de la granja', 'EXPENSE' => 'Gasto', 'COLLECTION' => 'Cobro y tesorería', 'PAYMENT' => 'Pago',
        'PAYROLL' => 'Planilla', 'CONSUMPTION' => 'Consumo de producción', 'PRODUCTION' => 'Producción', 'COGS' => 'Costo de ventas', 'INV_ADJUSTMENT' => 'Ajuste de inventario'];

    public const IMPORTES = ['BASE' => 'Base imponible', 'IGV' => 'IGV', 'TOTAL' => 'Total', 'COST' => 'Costo', 'DETAIL' => 'Importe de cada línea', 'TOTAL_PAYABLE' => 'Total a pagar',
        'WITHHOLDING' => 'Retención', 'FEE_IGV' => 'IGV de la comisión', 'ESSALUD' => 'EsSalud', 'PENSION' => 'Pensión retenida', 'CTS' => 'CTS', 'VAC' => 'Vacaciones', 'NET' => 'Neto a pagar'];

    /* ================================================================ plan de cuentas (CNT-01) */

    public static function guardarCuenta(array $d, ?string $id, User $quien): object
    {
        if (! Access::can($quien, 'cnt.account.manage')) {
            RuleError::fail('RN-CNT-21', 'El plan de cuentas lo edita la contadora.');
        }
        $empresa = $d['company_id'] ?? DB::table('companies')->orderBy('legal_name')->value('id');
        $actual = $id ? (DB::table('gl_accounts')->where('id', $id)->first() ?? abort(404)) : null;
        $codigo = $actual->code ?? trim((string) ($d['code'] ?? ''));
        if (! preg_match('/^\d{2,10}$/', $codigo)) {
            RuleError::fail('RN-CNT-05', 'El código de la cuenta tiene de 2 a 10 dígitos.');
        }
        if (! $actual && DB::table('gl_accounts')->where('company_id', $empresa)->where('code', $codigo)->exists()) {
            RuleError::fail('RN-CNT-05', "La cuenta {$codigo} ya existe.");
        }
        $padre = null;
        if (strlen($codigo) > 2) {
            $padre = DB::table('gl_accounts')->where('company_id', $empresa)->whereRaw('? LIKE code || \'%\'', [$codigo])->where('code', '<>', $codigo)
                ->orderByRaw('length(code) desc')->first();
            if (! $padre) {
                RuleError::fail('RN-CNT-05', "La cuenta {$codigo} no tiene una cuenta madre en el plan.");
            }
        }
        $recibe = (bool) ($d['postable'] ?? $actual->postable ?? true);
        if ($actual && $actual->postable && ! $recibe && DB::table('journal_lines')->where('account_code', $codigo)->exists()) {
            RuleError::fail('RN-CNT-05', "La cuenta {$codigo} ya tiene movimientos: no deja de recibirlos. Crea subcuentas nuevas y desactívala.");
        }
        if (! $actual && $padre && DB::table('journal_lines')->where('account_code', $padre->code)->exists()) {
            RuleError::fail('RN-CNT-05', "La cuenta madre {$padre->code} ya tiene movimientos: no se le crean subcuentas.");
        }
        $fila = [
            'name' => trim((string) ($d['name'] ?? $actual->name ?? '')), 'acc_type' => $d['acc_type'] ?? $actual->acc_type ?? 'ASSET', 'nature' => $d['nature'] ?? $actual->nature ?? 'DEBIT',
            'postable' => $recibe, 'requires_cost_center' => (bool) ($d['requires_cost_center'] ?? $actual->requires_cost_center ?? false),
            'requires_third_party' => (bool) ($d['requires_third_party'] ?? $actual->requires_third_party ?? false), 'requires_brand' => (bool) ($d['requires_brand'] ?? $actual->requires_brand ?? false),
            'dest_debit_code' => $d['dest_debit_code'] ?? $actual->dest_debit_code ?? null, 'dest_credit_code' => $d['dest_credit_code'] ?? $actual->dest_credit_code ?? null,
            'status' => $d['status'] ?? $actual->status ?? 'ACTIVE', 'updated_at' => now(),
        ];
        if ($fila['name'] === '') {
            RuleError::fail('RN-CNT-05', 'Indica el nombre de la cuenta.');
        }
        foreach (['dest_debit_code', 'dest_credit_code'] as $k) {
            if ($fila[$k] && $fila[$k] !== 'CC' && ! DB::table('gl_accounts')->where('company_id', $empresa)->where('code', $fila[$k])->where('postable', true)->exists()) {
                RuleError::fail('RN-CNT-05', "La cuenta de destino {$fila[$k]} no existe o no recibe movimientos.");
            }
        }
        if ($actual) {
            DB::table('gl_accounts')->where('id', $actual->id)->update($fila);
        } else {
            $id = DB::table('gl_accounts')->insertGetId($fila + ['company_id' => $empresa, 'code' => $codigo, 'parent_code' => $padre->code ?? null, 'level' => ($padre->level ?? 0) + 1], 'id');
            if ($padre && $padre->postable) {
                DB::table('gl_accounts')->where('id', $padre->id)->update(['postable' => false, 'updated_at' => now()]);
            }
        }
        AsientosService::olvidarCuentas();
        Events::emit('gl_account.saved', 'gl_accounts', $id, ['code' => $codigo]);

        return DB::table('gl_accounts')->find($id);
    }

    /* ================================================================ reglas (CNT-02) */

    public static function guardarRegla(array $d, ?string $id, User $quien): object
    {
        if (! Access::can($quien, 'cnt.rule.manage')) {
            RuleError::fail('RN-CNT-21', 'Las reglas de asiento las crea y aprueba la contadora.');
        }

        return DB::transaction(function () use ($d, $id, $quien) {
            $empresa = $d['company_id'] ?? DB::table('companies')->orderBy('legal_name')->value('id');
            $actual = $id ? (DB::table('journal_rules')->where('id', $id)->lockForUpdate()->first() ?? abort(404)) : null;
            if (! isset(self::ORIGENES[$d['source'] ?? $actual->source ?? ''])) {
                RuleError::fail('RN-CNT-09', 'Elige el origen de la regla.');
            }
            $lineas = array_values(array_filter($d['lines'] ?? [], fn ($l) => ! empty($l['side'])));
            if (count($lineas) < 2 || ! collect($lineas)->contains('side', 'D') || ! collect($lineas)->contains('side', 'C')) {
                RuleError::fail('RN-CNT-01', 'La regla necesita al menos una línea al debe y otra al haber.');
            }
            foreach ($lineas as $l) {
                if (($l['account_from'] ?? 'FIXED') === 'FIXED') {
                    $c = DB::table('gl_accounts')->where('company_id', $empresa)->where('code', $l['account_code'] ?? null)->first();
                    if (! $c || ! $c->postable) {
                        RuleError::fail('RN-CNT-05', 'La cuenta '.($l['account_code'] ?? '—').' no existe o no recibe movimientos.');
                    }
                }
                if (! isset(self::IMPORTES[$l['amount_key'] ?? ''])) {
                    RuleError::fail('RN-CNT-09', 'Elige qué importe toma cada línea.');
                }
            }
            $desde = $d['valid_from'] ?? AsientosService::hoy();
            $fila = ['company_id' => $empresa, 'source' => $d['source'] ?? $actual->source, 'subtype' => $d['subtype'] ?? $actual->subtype ?? '*', 'name' => $d['name'] ?? $actual->name,
                'auto_approve' => (bool) ($d['auto_approve'] ?? false), 'allocate_common' => (bool) ($d['allocate_common'] ?? false), 'status' => 'ACTIVE', 'valid_from' => $desde,
                'valid_to' => $d['valid_to'] ?? null, 'approved_by' => $quien->id, 'approved_at' => now(), 'account_map' => json_encode($d['account_map'] ?? json_decode($actual->account_map ?? '[]', true) ?: [])];
            // Una regla con asientos no se edita: se crea la versión siguiente y la anterior termina el día previo.
            if ($actual && DB::table('journal_entries')->where('rule_id', $actual->id)->exists()) {
                $fin = \Carbon\CarbonImmutable::parse($desde)->subDay()->toDateString();
                if ($fin < $actual->valid_from) {
                    RuleError::fail('RN-CNT-09', 'La regla ya generó asientos: la nueva versión debe regir desde una fecha posterior al '.\Carbon\CarbonImmutable::parse($actual->valid_from)->format('d/m/Y').'.');
                }
                DB::table('journal_rules')->where('id', $actual->id)->update(['valid_to' => $fin, 'updated_at' => now()]);
                $nuevo = DB::table('journal_rules')->insertGetId($fila + ['code' => $actual->code, 'version' => $actual->version + 1], 'id');
            } elseif ($actual) {
                DB::table('journal_rules')->where('id', $actual->id)->update($fila + ['updated_at' => now()]);
                DB::table('journal_rule_lines')->where('rule_id', $actual->id)->delete();
                $nuevo = $actual->id;
            } else {
                $n = DB::table('journal_rules')->where('company_id', $empresa)->count() + 1;
                $nuevo = DB::table('journal_rules')->insertGetId($fila + ['code' => $d['code'] ?? 'R-'.str_pad((string) $n, 3, '0', STR_PAD_LEFT), 'version' => 1], 'id');
            }
            foreach ($lineas as $i => $l) {
                DB::table('journal_rule_lines')->insert(['rule_id' => $nuevo, 'seq' => $i + 1, 'side' => $l['side'], 'account_from' => $l['account_from'] ?? 'FIXED',
                    'account_code' => $l['account_code'] ?? null, 'param_key' => $l['param_key'] ?? null, 'amount_key' => $l['amount_key'], 'third' => $l['third'] ?? null]);
            }
            Events::emit('journal_rule.saved', 'journal_rules', $nuevo, ['source' => $fila['source'], 'subtype' => $fila['subtype']]);

            return self::verRegla($nuevo);
        });
    }

    public static function estadoRegla(string $id, string $estado, User $quien): object
    {
        if (! Access::can($quien, 'cnt.rule.manage')) {
            RuleError::fail('RN-CNT-21', 'Las reglas de asiento las crea y aprueba la contadora.');
        }
        DB::table('journal_rules')->where('id', $id)->update(['status' => $estado, 'updated_at' => now()]) || abort(404);

        return self::verRegla($id);
    }

    public static function verRegla(string $id): object
    {
        $r = DB::table('journal_rules as r')->leftJoin('users as u', 'u.id', '=', 'r.approved_by')->where('r.id', $id)->first(['r.*', 'u.name as approved_by_name']) ?? abort(404);
        $r->account_map = json_decode($r->account_map ?: '[]', true) ?: [];
        $r->lines = DB::table('journal_rule_lines as l')->leftJoin('gl_accounts as a', fn ($j) => $j->on('a.code', '=', 'l.account_code')->where('a.company_id', $r->company_id))
            ->where('l.rule_id', $id)->orderBy('l.seq')->get(['l.*', 'a.name as account_name']);
        $r->entries = DB::table('journal_entries')->where('rule_id', $id)->count();
        $r->source_label = self::ORIGENES[$r->source] ?? $r->source;

        return $r;
    }
}
