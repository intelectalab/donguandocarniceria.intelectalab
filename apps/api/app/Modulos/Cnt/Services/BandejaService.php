<?php

namespace App\Modulos\Cnt\Services;

use App\Models\User;
use App\Modulos\Com\Services\ComprobantesService;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * CNT-05 Bandeja de la contadora.
 *  RN-CNT-09  sin regla vigente, el documento entra con NO_RULE.
 *  RN-CNT-10  la practicante clasifica (cnt.entry.prepare) y la contadora aprueba (cnt.entry.approve); quien clasifica no aprueba.
 */
final class BandejaService
{
    public const MOTIVOS = [
        'NO_RULE' => 'Sin regla de asiento', 'MISSING_ACCOUNT' => 'Falta la cuenta', 'MISSING_COST_CENTER' => 'Falta el centro de costo', 'MISSING_BRAND' => 'Falta la marca',
        'PO_MISMATCH' => 'Observado en el cruce de tres vías', 'SIRE_DIFF' => 'Observado por SIRE', 'NO_VALID_RECEIPT' => 'Gasto sin comprobante válido',
    ];

    public const ABIERTOS = ['PENDING', 'CLASSIFIED', 'RETURNED'];

    /** Motivos que necesitan la clasificación de la practicante antes de aprobar. */
    public const CON_CLASIFICACION = ['NO_RULE', 'MISSING_ACCOUNT', 'MISSING_COST_CENTER', 'MISSING_BRAND'];

    /** El documento de origen como lo entiende el motor de asientos. */
    private const TIPO_MOTOR = ['PURCHASE_DOCUMENT' => 'PURCHASE', 'PURCHASE' => 'PURCHASE', 'EXPENSE' => 'EXPENSE', 'SALE' => 'SALE', 'COLLECTION' => 'COLLECTION',
        'SUPPLIER_PAYMENT' => 'SUPPLIER_PAYMENT', 'PAYROLL' => 'PAYROLL'];

    private static function alias(string $t): string
    {
        return $t === 'PURCHASE_DOCUMENT' ? 'PURCHASE' : $t;
    }

    private static function hist(?string $json, string $accion, ?User $quien): string
    {
        $h = json_decode($json ?: '[]', true) ?: [];
        $h[] = ['at' => now()->toIso8601String(), 'user' => $quien?->name ?? 'Sistema', 'action' => $accion];

        return json_encode($h, JSON_UNESCAPED_UNICODE);
    }

    /** Ingresa un ítem; si ya hay uno abierto por el mismo documento y motivo, devuelve ese. */
    public static function agregar(array $o): object
    {
        $alias = [self::alias($o['source_type']), $o['source_type'], $o['source_type'] === 'PURCHASE' ? 'PURCHASE_DOCUMENT' : $o['source_type']];
        $ex = DB::table('accountant_inbox_items')->whereIn('source_type', array_unique($alias))->where('source_id', $o['source_id'])->where('reason', $o['reason'])
            ->whereIn('status', self::ABIERTOS)->when($o['sire_line_id'] ?? null, fn ($q, $v) => $q->where('sire_line_id', $v))->first();
        if ($ex) {
            if (! empty($o['entry_id']) && ! $ex->entry_id) {
                DB::table('accountant_inbox_items')->where('id', $ex->id)->update(['entry_id' => $o['entry_id'], 'updated_at' => now()]);
            }

            return DB::table('accountant_inbox_items')->find($ex->id);
        }
        $fecha = $o['date'] ?? AsientosService::hoy();
        $empresa = $o['company_id'] ?? DB::table('companies')->orderBy('legal_name')->value('id');
        $id = DB::table('accountant_inbox_items')->insertGetId([
            'company_id' => $empresa, 'period' => AsientosService::mes($fecha), 'source_type' => $o['source_type'], 'source_id' => $o['source_id'], 'reason' => $o['reason'],
            'missing' => json_encode($o['missing'] ?? [$o['reason']]), 'status' => 'PENDING', 'notes' => $o['notes'] ?? null, 'ref_label' => isset($o['ref_label']) ? mb_substr($o['ref_label'], 0, 255) : null,
            'amount' => $o['amount'] ?? null, 'entry_id' => $o['entry_id'] ?? null, 'sire_line_id' => $o['sire_line_id'] ?? null,
            'history' => self::hist(null, 'Ingresó: '.(self::MOTIVOS[$o['reason']] ?? $o['reason']), null),
        ], 'id');
        DB::table('notifications')->insert([
            'role' => 'PRACTICANTE_CONTABLE', 'title' => 'Nuevo ítem en la bandeja contable', 'body' => (self::MOTIVOS[$o['reason']] ?? $o['reason']).' · '.($o['ref_label'] ?? ''),
            'ref' => json_encode(['module' => 'CNT', 'screen' => 'CNT-05', 'id' => $id]), 'tone' => 'info', 'module' => 'CNT', 'at' => now(), 'type' => 'ALERTS', 'in_app' => true,
        ]);
        Events::emit('accountant_inbox.added', 'accountant_inbox_items', $id, ['reason' => $o['reason'], 'source_type' => $o['source_type']]);

        return DB::table('accountant_inbox_items')->find($id);
    }

    /** Cierra los ítems abiertos de un documento (lo resolvió su módulo: diferencia aceptada, anulación). */
    public static function cerrarPorOrigen(string $tipo, string $id, ?string $motivo, ?User $quien, string $nota): int
    {
        $n = 0;
        foreach (DB::table('accountant_inbox_items')->whereIn('source_type', array_unique([$tipo, self::alias($tipo)]))->where('source_id', $id)
            ->when($motivo, fn ($q, $m) => $q->where('reason', $m))->whereIn('status', self::ABIERTOS)->get() as $it) {
            $n += DB::table('accountant_inbox_items')->where('id', $it->id)->update([
                'status' => 'APPROVED', 'approved_by' => $quien?->id, 'approved_at' => now(), 'history' => self::hist($it->history, $nota, $quien), 'updated_at' => now(),
            ]);
        }

        return $n;
    }

    public static function item(string $id): object
    {
        return DB::table('accountant_inbox_items')->where('id', $id)->lockForUpdate()->first() ?? abort(404);
    }

    /** La practicante (o la contadora) clasifica: cuenta, centro de costo, marca y nota. */
    public static function clasificar(string $id, array $c, User $quien): object
    {
        return DB::transaction(function () use ($id, $c, $quien) {
            if (! Access::can($quien, 'cnt.entry.prepare')) {
                RuleError::fail('RN-CNT-10', 'Clasificar es de la practicante contable o de la contadora.');
            }
            $it = self::item($id);
            if (! in_array($it->status, self::ABIERTOS, true)) {
                RuleError::fail('RN-CNT-10', 'El ítem ya está resuelto.');
            }
            $falta = json_decode($it->missing ?: '[]', true) ?: [$it->reason];
            if ((in_array('MISSING_ACCOUNT', $falta, true) || $it->reason === 'NO_RULE') && empty($c['account_code'])) {
                RuleError::fail('RN-CNT-05', 'Elige la cuenta contable.');
            }
            if (! empty($c['account_code'])) {
                $a = DB::table('gl_accounts')->where('code', $c['account_code'])->where('company_id', $it->company_id)->first();
                if (! $a || ! $a->postable) {
                    RuleError::fail('RN-CNT-05', "La cuenta {$c['account_code']} no recibe movimientos: elige una cuenta de detalle.");
                }
            }
            if (in_array('MISSING_COST_CENTER', $falta, true) && empty($c['cost_center_id'])) {
                RuleError::fail('RN-CNT-05', 'Elige el centro de costo.');
            }
            if (in_array('MISSING_BRAND', $falta, true) && empty($c['brand_id'])) {
                RuleError::fail('RN-CNT-16', 'Elige la marca de la línea de ingresos, costos o gastos.');
            }
            if (in_array($it->reason, ['PO_MISMATCH', 'SIRE_DIFF', 'NO_VALID_RECEIPT'], true) && trim((string) ($c['note'] ?? '')) === '') {
                RuleError::fail('RN-CNT-10', 'Indica la nota de clasificación.');
            }
            $cls = ['account_code' => $c['account_code'] ?? null, 'cost_center_id' => $c['cost_center_id'] ?? null, 'brand_id' => $c['brand_id'] ?? null,
                'note' => $c['note'] ?? null, 'remember' => (bool) ($c['remember'] ?? false), 'action' => $c['action'] ?? null];
            $marca = $cls['brand_id'] ? DB::table('brands')->where('id', $cls['brand_id'])->value('name') : null;
            DB::table('accountant_inbox_items')->where('id', $id)->update([
                'status' => 'CLASSIFIED', 'classification' => json_encode($cls, JSON_UNESCAPED_UNICODE), 'classified_by' => $quien->id, 'classified_at' => now(), 'returned_reason' => null,
                'history' => self::hist($it->history, 'Clasificado'.($cls['account_code'] ? ' · cuenta '.$cls['account_code'] : '').($marca ? ' · '.$marca : '').($cls['note'] ? ' · '.$cls['note'] : ''), $quien),
                'updated_at' => now(),
            ]);

            return self::ver($id);
        });
    }

    /** La contadora aprueba: genera o completa el asiento según el motivo. */
    public static function aprobar(string $id, User $quien, ?string $nota = null): object
    {
        return DB::transaction(function () use ($id, $quien, $nota) {
            $it = self::item($id);
            if ($it->classified_by && $it->classified_by === $quien->id) {
                $n = DB::table('users')->where('id', $it->classified_by)->value('name');
                RuleError::fail('RN-CNT-10', "Quien clasifica no aprueba: {$n} clasificó este ítem y lo aprueba otra persona (la contadora).");
            }
            if (! Access::can($quien, 'cnt.entry.approve')) {
                RuleError::fail('RN-CNT-10', 'La practicante clasifica y la contadora aprueba: tu rol no aprueba ítems de la bandeja.');
            }
            if (! in_array($it->status, self::ABIERTOS, true)) {
                RuleError::fail('RN-CNT-10', 'El ítem ya está resuelto.');
            }
            $c = json_decode($it->classification ?: '{}', true) ?: [];
            $necesita = in_array($it->reason, self::CON_CLASIFICACION, true);
            if ($necesita && $it->status !== 'CLASSIFIED') {
                RuleError::fail('RN-CNT-10', 'Primero lo clasifica la practicante (cuenta, centro de costo y marca); luego lo apruebas.');
            }
            $tipo = self::TIPO_MOTOR[$it->source_type] ?? $it->source_type;
            $ov = ['account' => $c['account_code'] ?? null, 'cc' => $c['cost_center_id'] ?? null, 'brand' => $c['brand_id'] ?? null];
            $preparo = $it->classified_by ? User::find($it->classified_by) : null;
            $entry = null;
            if ($it->reason === 'NO_RULE') {
                $entry = AsientosService::generar($tipo, $it->source_id, $preparo, ['fallback' => true, 'override' => $ov, 'prepared_by' => $it->classified_by])['entry'] ?? null;
            } elseif ($necesita) {
                if (! empty($c['remember']) && ! empty($c['account_code']) && $tipo === 'PURCHASE') {
                    self::recordarCuenta($it->source_id, $c['account_code']);
                }
                $entry = AsientosService::generar($tipo, $it->source_id, $preparo, ['override' => $ov, 'prepared_by' => $it->classified_by, 'replace' => $it->entry_id])['entry'] ?? null;
                if (! $entry || $entry->blocked) {
                    RuleError::fail('RN-CNT-05', 'La clasificación no completa todos los datos del asiento: devuélvelo con la indicación.');
                }
            } elseif ($it->reason === 'PO_MISMATCH') {
                $doc = DB::table('purchase_documents')->where('id', $it->source_id)->first();
                if ($doc && $doc->match_status === 'OBSERVED') {
                    // aprobarDiferencia genera el asiento y cierra este ítem
                    ComprobantesService::aprobarDiferencia($doc->id, $c['note'] ?? $nota ?? 'Diferencia aceptada por la contadora', $quien);
                }
                $entry = DB::table('journal_entries')->where('source_kind', 'PURCHASE')->where('source_id', $it->source_id)->whereIn('status', AsientosService::ESTADOS_VIVOS)->orderByDesc('created_at')->first();
            } elseif ($it->reason === 'NO_VALID_RECEIPT') {
                DB::table('expenses')->where('id', $it->source_id)->update(['accounting_reviewed_at' => now(), 'accounting_reviewed_by' => $quien->id, 'updated_at' => now()]);
            } elseif ($it->reason === 'SIRE_DIFF' && $it->sire_line_id) {
                DB::table('sire_proposal_lines')->where('id', $it->sire_line_id)->whereNull('resolution')->update([
                    'resolution' => 'KEEP_SYSTEM', 'resolution_note' => mb_substr($c['note'] ?? $nota ?? 'Justificado en la bandeja', 0, 255), 'resolved_by' => $quien->id, 'resolved_at' => now(),
                ]);
            }
            if ($entry && $entry->status === 'PENDING_APPROVAL' && ! $entry->blocked && $entry->prepared_by !== $quien->id) {
                $entry = AsientosService::aprobar($entry->id, $quien);
            }
            $fresco = DB::table('accountant_inbox_items')->find($id);
            DB::table('accountant_inbox_items')->where('id', $id)->update([
                'status' => 'APPROVED', 'approved_by' => $quien->id, 'approved_at' => now(), 'entry_id' => $entry->id ?? $it->entry_id,
                'history' => $fresco->status === 'APPROVED' ? $fresco->history : self::hist($fresco->history, 'Aprobado'.($entry && ($entry->number ?? null) ? ' · asiento '.$entry->number : ''), $quien),
                'updated_at' => now(),
            ]);
            Events::emit('accountant_inbox.approved', 'accountant_inbox_items', $id, ['entry_id' => $entry->id ?? null]);

            return self::ver($id);
        });
    }

    /** La contadora devuelve un ítem clasificado con lo que debe corregirse. */
    public static function devolver(string $id, string $motivo, User $quien): object
    {
        return DB::transaction(function () use ($id, $motivo, $quien) {
            if (! Access::can($quien, 'cnt.entry.approve')) {
                RuleError::fail('RN-CNT-10', 'Devolver un ítem es de la contadora.');
            }
            $it = self::item($id);
            if ($it->status !== 'CLASSIFIED') {
                RuleError::fail('RN-CNT-10', 'Solo se devuelve un ítem clasificado.');
            }
            if (mb_strlen(trim($motivo)) < 5) {
                RuleError::fail('RN-CNT-10', 'Indica qué debe corregirse.');
            }
            DB::table('accountant_inbox_items')->where('id', $id)->update([
                'status' => 'RETURNED', 'returned_reason' => mb_substr($motivo, 0, 255), 'history' => self::hist($it->history, 'Devuelto: '.$motivo, $quien), 'updated_at' => now(),
            ]);
            if ($it->classified_by) {
                DB::table('notifications')->insert([
                    'user_id' => $it->classified_by, 'title' => 'La contadora devolvió un ítem', 'body' => $motivo, 'ref' => json_encode(['module' => 'CNT', 'screen' => 'CNT-05', 'id' => $id]),
                    'tone' => 'warn', 'module' => 'CNT', 'at' => now(), 'type' => 'ALERTS', 'in_app' => true,
                ]);
            }

            return self::ver($id);
        });
    }

    /** Asigna el ítem a una persona del equipo contable. */
    public static function asignar(string $id, ?string $usuario, User $quien): object
    {
        $it = DB::table('accountant_inbox_items')->where('id', $id)->first() ?? abort(404);
        DB::table('accountant_inbox_items')->where('id', $id)->update(['assigned_to' => $usuario, 'updated_at' => now(),
            'history' => self::hist($it->history, $usuario ? 'Asignado a '.DB::table('users')->where('id', $usuario)->value('name') : 'Sin asignar', $quien)]);

        return self::ver($id);
    }

    /** "Recordar para este proveedor": la regla de compras usa esa cuenta en adelante. */
    private static function recordarCuenta(string $docId, string $cuenta): void
    {
        $doc = DB::table('purchase_documents')->where('id', $docId)->first();
        $f = AsientosService::hechos('PURCHASE', $docId);
        if (! $doc || ! $f || isset($f['skip'])) {
            return;
        }
        $regla = AsientosService::regla($f['source'], $f['subtype'], $f['date'], $doc->company_id);
        if (! $regla) {
            return;
        }
        $m = json_decode($regla->account_map ?: '{}', true) ?: [];
        $m['suppliers'] = array_merge($m['suppliers'] ?? [], [$doc->supplier_id => $cuenta]);
        DB::table('journal_rules')->where('id', $regla->id)->update(['account_map' => json_encode($m), 'updated_at' => now()]);
    }

    public static function ver(string $id): object
    {
        $it = DB::table('accountant_inbox_items as i')->leftJoin('users as c', 'c.id', '=', 'i.classified_by')->leftJoin('users as a', 'a.id', '=', 'i.approved_by')
            ->leftJoin('users as s', 's.id', '=', 'i.assigned_to')->leftJoin('journal_entries as e', 'e.id', '=', 'i.entry_id')->where('i.id', $id)
            ->first(['i.*', 'c.name as classified_by_name', 'a.name as approved_by_name', 's.name as assigned_to_name', 'e.number as entry_number', 'e.status as entry_status']) ?? abort(404);
        $it->missing = json_decode($it->missing ?: '[]', true);
        $it->classification = $it->classification ? json_decode($it->classification, true) : null;
        $it->history = json_decode($it->history ?: '[]', true);
        $it->reason_label = self::MOTIVOS[$it->reason] ?? $it->reason;
        $it->entry = $it->entry_id ? AsientosService::ver($it->entry_id) : null;

        return $it;
    }
}
