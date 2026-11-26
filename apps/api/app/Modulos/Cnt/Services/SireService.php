<?php

namespace App\Modulos\Cnt\Services;

use App\Models\User;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * CNT-06 Propuesta SIRE de compras, CNT-07 SIRE de ventas y CNT-08 Envíos SIRE.
 *  RN-CNT-11  cada línea se busca por RUC del emisor, tipo, serie y número; si el total difiere más que
 *             cnt_sire_amount_tolerance_pen es AMOUNT_DIFF; si no existe, MISSING_IN_SYSTEM; lo registrado
 *             que no está en la propuesta es MISSING_IN_PROPOSAL.
 *  RN-CNT-18  un registro se envía solo con todas sus diferencias resueltas o justificadas.
 */
final class SireService
{
    public const CODIGO = ['INVOICE' => '01', 'RECEIPT' => '03', 'FEE_RECEIPT' => '02', 'CREDIT_NOTE' => '07', 'DEBIT_NOTE' => '08', 'PURCHASE_SETTLEMENT' => '04'];

    public const RESOLUCIONES = [
        'AMOUNT_DIFF' => ['KEEP_SYSTEM' => 'Ajustar la propuesta al importe registrado', 'FIX_SYSTEM' => 'Corregir el registro del sistema', 'JUSTIFIED' => 'Justificado (nota)'],
        'MISSING_IN_SYSTEM' => ['REGISTER' => 'Se registrará en el sistema', 'EXCLUDE' => 'Excluir: no corresponde al período o a la empresa', 'JUSTIFIED' => 'Justificado (nota)'],
        'MISSING_IN_PROPOSAL' => ['ADD_TO_REGISTER' => 'Agregar en el ajuste del registro', 'NEXT_PERIOD' => 'Se anota en el período siguiente', 'JUSTIFIED' => 'Justificado (nota)'],
    ];

    public static function clave(?string $ruc, string $tipo, ?string $serie, $numero): string
    {
        return implode('|', [trim((string) $ruc), $tipo, strtoupper(trim((string) $serie)), ltrim(trim((string) $numero), '0') ?: '0']);
    }

    private static function fin(string $periodo): string
    {
        return CarbonImmutable::parse($periodo)->endOfMonth()->toDateString();
    }

    private static function empresa(?string $id = null): object
    {
        return DB::table('companies')->when($id, fn ($q, $v) => $q->where('id', $v))->orderBy('legal_name')->first();
    }

    /** Comprobantes de compra registrados del período (COM y GAS). */
    public static function compras(string $periodo, ?string $companyId = null): Collection
    {
        $fin = self::fin($periodo);
        $doc = DB::table('purchase_documents as d')->join('suppliers as s', 's.id', '=', 'd.supplier_id')->where('d.status', '<>', 'VOIDED')
            ->whereIn('d.doc_type', array_keys(self::CODIGO))->where('d.doc_type', '<>', 'FEE_RECEIPT')
            ->when($companyId, fn ($q, $c) => $q->where('d.company_id', $c))
            ->whereRaw('coalesce(d.accounting_date, d.issue_date) BETWEEN ? AND ?', [$periodo, $fin])
            ->get(['d.id', 'd.doc_type', 'd.series', 'd.number', 'd.issue_date', 'd.base_taxed', 'd.igv', 'd.total', 'd.exchange_rate', 's.doc_number', 's.legal_name'])
            ->map(fn ($d) => (object) ['key' => self::clave($d->doc_number, self::CODIGO[$d->doc_type], $d->series, $d->number), 'kind' => 'PURCHASE', 'id' => $d->id, 'ruc' => $d->doc_number,
                'name' => $d->legal_name, 'type' => self::CODIGO[$d->doc_type], 'series' => $d->series, 'number' => $d->number, 'date' => $d->issue_date,
                'base' => round((float) $d->base_taxed * (float) $d->exchange_rate, 2), 'igv' => round((float) $d->igv * (float) $d->exchange_rate, 2), 'total' => round((float) $d->total * (float) $d->exchange_rate, 2)]);
        $gas = DB::table('expenses as e')->join('suppliers as s', 's.id', '=', 'e.supplier_id')->whereIn('e.status', ['SUBMITTED', 'APPROVED', 'PAID'])
            ->whereIn('e.doc_type', ['INVOICE', 'RECEIPT'])->where('s.doc_type', 'RUC')->when($companyId, fn ($q, $c) => $q->where('e.company_id', $c))
            ->whereBetween('e.issue_date', [$periodo, $fin])
            ->get(['e.id', 'e.doc_type', 'e.doc_series', 'e.doc_number', 'e.issue_date', 'e.net_pen', 'e.subtotal', 'e.igv', 'e.amount_pen', 'e.total', 's.doc_number as ruc', 's.legal_name'])
            ->map(fn ($e) => (object) ['key' => self::clave($e->ruc, self::CODIGO[$e->doc_type], $e->doc_series, $e->doc_number), 'kind' => 'EXPENSE', 'id' => $e->id, 'ruc' => $e->ruc,
                'name' => $e->legal_name, 'type' => self::CODIGO[$e->doc_type], 'series' => $e->doc_series, 'number' => $e->doc_number, 'date' => $e->issue_date,
                'base' => round((float) ($e->net_pen ?? $e->subtotal), 2), 'igv' => round((float) $e->igv, 2), 'total' => round((float) ($e->amount_pen ?? $e->total), 2)]);

        return $doc->concat($gas)->values();
    }

    /** Comprobantes emitidos del período (FAC). */
    public static function ventas(string $periodo, ?string $companyId = null): Collection
    {
        $ruc = self::empresa($companyId)->ruc;

        return DB::table('sales_documents')->where('status', '<>', 'VOIDED')->whereNotIn('sunat_status', ['REJECTED'])->whereIn('doc_type', array_keys(self::CODIGO))
            ->when($companyId, fn ($q, $c) => $q->where('company_id', $c))->whereBetween('issue_date', [$periodo, self::fin($periodo)])
            ->get(['id', 'doc_type', 'series', 'number', 'issue_date', 'subtotal', 'igv', 'total', 'customer_doc_number', 'customer_name', 'sunat_status'])
            ->map(fn ($d) => (object) ['key' => self::clave($ruc, self::CODIGO[$d->doc_type], $d->series, $d->number), 'kind' => 'SALE', 'id' => $d->id, 'ruc' => $ruc, 'name' => $d->customer_name,
                'cust' => $d->customer_doc_number, 'type' => self::CODIGO[$d->doc_type], 'series' => $d->series, 'number' => $d->number, 'date' => $d->issue_date,
                'base' => (float) $d->subtotal, 'igv' => (float) $d->igv, 'total' => (float) $d->total, 'sunat' => $d->sunat_status]);
    }

    /** Archivo de la propuesta: RUC|Razón social|Tipo|Serie|Número|Fecha|Base|IGV|Total. */
    public static function leer(string $texto, string $registro): array
    {
        $out = [];
        $errores = [];
        foreach (preg_split('/\r?\n/', $texto) as $i => $ln) {
            $s = trim($ln);
            if ($s === '' || preg_match('/^ruc\|/i', $s)) {
                continue;
            }
            $c = array_map('trim', explode('|', $s));
            $n = $i + 1;
            if (count($c) < 9) {
                $errores[] = "Línea {$n}: se esperaban 9 columnas separadas por «|».";

                continue;
            }
            [$ruc, $nombre, $tipo, $serie, $numero, $fecha, $base, $igv, $total] = $c;
            if (! preg_match($registro === 'SALES' ? '/^\d{8,11}$/' : '/^\d{11}$/', $ruc)) {
                $errores[] = "Línea {$n}: ".($registro === 'SALES' ? 'documento del cliente' : 'RUC')." {$ruc} inválido.";

                continue;
            }
            if (! preg_match('/^\d{2}$/', $tipo)) {
                $errores[] = "Línea {$n}: tipo de comprobante {$tipo} inválido (01, 03, 07…).";

                continue;
            }
            if (! is_numeric($total)) {
                $errores[] = "Línea {$n}: total inválido.";

                continue;
            }
            $iso = preg_match('#^(\d{2})/(\d{2})/(\d{4})$#', $fecha, $m) ? "{$m[3]}-{$m[2]}-{$m[1]}" : $fecha;
            $out[] = ['issuer_ruc' => $ruc, 'issuer_name' => mb_substr($nombre, 0, 255), 'doc_type_code' => $tipo, 'series' => strtoupper($serie), 'number' => ltrim($numero, '0') ?: '0',
                'issue_date' => $iso, 'base' => (float) $base, 'igv' => (float) $igv, 'total' => (float) $total];
        }

        return ['lines' => $out, 'errors' => $errores];
    }

    public static function importar(array $d, User $quien): array
    {
        if (! Access::can($quien, 'cnt.sire.manage')) {
            RuleError::fail('RN-CNT-18', 'Importar propuestas SIRE es de la contadora o la practicante.');
        }

        return DB::transaction(function () use ($d, $quien) {
            $periodo = substr($d['period'], 0, 7).'-01';
            $reg = $d['register'] ?? 'PURCHASES';
            $emp = self::empresa($d['company_id'] ?? null);
            $x = isset($d['lines']) ? ['lines' => $d['lines'], 'errors' => []] : self::leer((string) ($d['text'] ?? ''), $reg);
            if ($x['errors']) {
                RuleError::fail('RN-CNT-11', implode(' ', array_slice($x['errors'], 0, 3)));
            }
            if (! $x['lines']) {
                RuleError::fail('RN-CNT-11', 'El archivo no tiene comprobantes.');
            }
            DB::table('sire_proposals')->where('company_id', $emp->id)->where('register', $reg)->where('period', $periodo)->where('status', '<>', 'SUBMITTED')
                ->where('superseded', false)->update(['superseded' => true, 'updated_at' => now()]);
            $id = DB::table('sire_proposals')->insertGetId([
                'company_id' => $emp->id, 'register' => $reg, 'period' => $periodo, 'file_name' => $d['file_name'] ?? 'propuesta-'.($reg === 'SALES' ? 'rvie' : 'rce').'-'.substr($periodo, 0, 7).'.txt',
                'imported_at' => now(), 'imported_by' => $quien->id, 'line_count' => count($x['lines']), 'total_amount' => round(array_sum(array_column($x['lines'], 'total')), 2),
                'status' => 'IMPORTED', 'superseded' => false, 'matched_at' => now(), 'system_count' => 0,
            ], 'id');
            foreach ($x['lines'] as $i => $l) {
                $fila = $l + ['proposal_id' => $id, 'origin' => 'PROPOSAL', 'seq' => $i + 1, 'match_status' => 'MISSING_IN_SYSTEM'];
                if ($reg === 'SALES') {
                    $fila['counterparty_doc'] = $l['issuer_ruc'];
                    $fila['issuer_ruc'] = $emp->ruc;
                }
                $fila['key'] = self::clave($fila['issuer_ruc'], $l['doc_type_code'], $l['series'], $l['number']);
                DB::table('sire_proposal_lines')->insert($fila);
            }
            $res = self::cruzar($id, $d['inbox'] ?? true);
            Events::emit('sire_proposal.imported', 'sire_proposals', $id, ['register' => $reg, 'period' => $periodo, 'lines' => count($x['lines'])] + $res);

            return ['proposal' => self::ver($id), 'summary' => $res];
        });
    }

    /** cnt_match_sire_purchases y su par de ventas. */
    public static function cruzar(string $id, bool $bandeja = false): array
    {
        $p = DB::table('sire_proposals')->where('id', $id)->first() ?? abort(404);
        $tol = (float) (Params::get('cnt_sire_amount_tolerance_pen') ?? 1);
        $sis = $p->register === 'SALES' ? self::ventas($p->period, $p->company_id) : self::compras($p->period, $p->company_id);
        $mapa = $sis->keyBy('key');
        $vistos = [];
        $res = ['MATCHED' => 0, 'AMOUNT_DIFF' => 0, 'MISSING_IN_SYSTEM' => 0, 'MISSING_IN_PROPOSAL' => 0];
        foreach (DB::table('sire_proposal_lines')->where('proposal_id', $id)->where('origin', 'PROPOSAL')->get() as $l) {
            $s = $mapa[$l->key] ?? null;
            if (! $s) {
                $st = 'MISSING_IN_SYSTEM';
                $patch = ['system_kind' => null, 'system_id' => null, 'system_total' => null, 'diff' => null];
            } else {
                $vistos[$s->key] = true;
                $dif = round((float) $l->total - (float) $s->total, 2);
                $st = abs($dif) > $tol + 1e-9 ? 'AMOUNT_DIFF' : 'MATCHED';
                $patch = ['system_kind' => $s->kind, 'system_id' => $s->id, 'system_total' => $s->total, 'diff' => $dif];
            }
            $res[$st]++;
            DB::table('sire_proposal_lines')->where('id', $l->id)->update($patch + ['match_status' => $st, 'updated_at' => now()] + ($st === 'MATCHED' ? ['resolution' => null] : []));
        }
        $derivadas = DB::table('sire_proposal_lines')->where('proposal_id', $id)->where('origin', 'SYSTEM')->get()->keyBy('key');
        $n = 0;
        foreach ($sis as $s) {
            if (isset($vistos[$s->key])) {
                if (isset($derivadas[$s->key])) {
                    DB::table('sire_proposal_lines')->where('id', $derivadas[$s->key]->id)->delete();
                }

                continue;
            }
            $res['MISSING_IN_PROPOSAL']++;
            if (! isset($derivadas[$s->key])) {
                DB::table('sire_proposal_lines')->insert(['proposal_id' => $id, 'origin' => 'SYSTEM', 'key' => $s->key, 'seq' => 100000 + (++$n), 'issuer_ruc' => $s->ruc,
                    'issuer_name' => mb_substr((string) $s->name, 0, 255), 'counterparty_doc' => $s->cust ?? null, 'doc_type_code' => $s->type, 'series' => $s->series,
                    'number' => (string) $s->number, 'issue_date' => $s->date, 'base' => $s->base, 'igv' => $s->igv, 'total' => null, 'match_status' => 'MISSING_IN_PROPOSAL',
                    'system_kind' => $s->kind, 'system_id' => $s->id, 'system_total' => $s->total]);
            }
        }
        $claves = $sis->pluck('key')->all();
        foreach ($derivadas as $k => $dl) {
            if (! in_array($k, $claves, true)) {
                DB::table('sire_proposal_lines')->where('id', $dl->id)->delete();
            }
        }
        $pend = self::sinResolver($id)->count();
        DB::table('sire_proposals')->where('id', $id)->update(['matched_at' => now(), 'summary' => json_encode($res), 'system_count' => $sis->count(), 'updated_at' => now(),
            'status' => $p->status === 'SUBMITTED' ? 'SUBMITTED' : ($pend ? 'WITH_DIFFS' : 'RECONCILED')]);
        if ($bandeja) {
            $nombre = Periodos::nombre($p->period);
            foreach (DB::table('sire_proposal_lines')->where('proposal_id', $id)->whereIn('match_status', ['AMOUNT_DIFF', 'MISSING_IN_SYSTEM'])->whereNull('resolution')->get() as $l) {
                BandejaService::agregar(['source_type' => 'SIRE', 'source_id' => $id, 'sire_line_id' => $l->id, 'reason' => 'SIRE_DIFF', 'date' => $p->period, 'company_id' => $p->company_id,
                    'notes' => ($l->match_status === 'AMOUNT_DIFF' ? 'Diferencia de importe' : 'Falta en el sistema')." · {$l->issuer_ruc} {$l->doc_type_code} {$l->series}-{$l->number}"
                        .($l->diff !== null ? ' · diferencia S/ '.number_format((float) $l->diff, 2, ',', ' ') : ''),
                    'ref_label' => 'SIRE '.($p->register === 'SALES' ? 'ventas' : 'compras')." {$nombre} · {$l->series}-{$l->number}", 'amount' => $l->total]);
            }
        }

        return $res;
    }

    public static function sinResolver(string $id): Collection
    {
        return DB::table('sire_proposal_lines')->where('proposal_id', $id)->whereNotNull('match_status')->where('match_status', '<>', 'MATCHED')->whereNull('resolution')->get();
    }

    public static function resolver(string $lineId, string $resolucion, string $nota, User $quien): object
    {
        if (! Access::can($quien, 'cnt.sire.manage')) {
            RuleError::fail('RN-CNT-18', 'Resolver diferencias SIRE es de la contadora o la practicante.');
        }

        return DB::transaction(function () use ($lineId, $resolucion, $nota, $quien) {
            $l = DB::table('sire_proposal_lines')->where('id', $lineId)->first() ?? abort(404);
            if ($l->match_status === 'MATCHED') {
                RuleError::fail('RN-CNT-18', 'La línea coincide: no hay diferencia que resolver.');
            }
            if (! isset(self::RESOLUCIONES[$l->match_status][$resolucion])) {
                RuleError::fail('RN-CNT-18', 'Elige cómo se resuelve.');
            }
            if (mb_strlen(trim($nota)) < 5) {
                RuleError::fail('RN-CNT-18', 'Indica la nota de sustento.');
            }
            DB::table('sire_proposal_lines')->where('id', $lineId)->update(['resolution' => $resolucion, 'resolution_note' => mb_substr($nota, 0, 255), 'resolved_by' => $quien->id,
                'resolved_at' => now(), 'updated_at' => now()]);
            foreach (DB::table('accountant_inbox_items')->where('sire_line_id', $lineId)->whereIn('status', BandejaService::ABIERTOS)->pluck('id') as $it) {
                DB::table('accountant_inbox_items')->where('id', $it)->update(['status' => 'APPROVED', 'approved_by' => $quien->id, 'approved_at' => now(), 'updated_at' => now()]);
            }
            $p = DB::table('sire_proposals')->find($l->proposal_id);
            if (self::sinResolver($p->id)->isEmpty() && $p->status === 'WITH_DIFFS') {
                DB::table('sire_proposals')->where('id', $p->id)->update(['status' => 'RECONCILED', 'updated_at' => now()]);
            }

            return DB::table('sire_proposal_lines')->find($lineId);
        });
    }

    public static function vigente(string $registro, string $periodo, ?string $companyId = null): ?object
    {
        return DB::table('sire_proposals')->where('register', $registro)->where('period', substr($periodo, 0, 7).'-01')->where('superseded', false)
            ->when($companyId, fn ($q, $c) => $q->where('company_id', $c))->orderByDesc('imported_at')->first();
    }

    public static function preparar(array $d, User $quien): object
    {
        if (! Access::can($quien, 'cnt.sire.manage')) {
            RuleError::fail('RN-CNT-18', 'Preparar envíos SIRE es de la contadora o la practicante.');
        }
        $periodo = substr($d['period'], 0, 7).'-01';
        $reg = $d['register'];
        $p = self::vigente($reg, $periodo, $d['company_id'] ?? null) ?? RuleError::fail('RN-CNT-18', 'No hay propuesta de '.($reg === 'SALES' ? 'ventas' : 'compras').' de '.Periodos::nombre($periodo).' importada.');
        $pend = self::sinResolver($p->id)->count();
        if ($pend) {
            RuleError::fail('RN-CNT-18', "Quedan {$pend} diferencia(s) sin resolver o justificar en la propuesta de ".Periodos::nombre($periodo).': resuélvelas antes de preparar el envío.');
        }
        $lineas = DB::table('sire_proposal_lines')->where('proposal_id', $p->id)->orderBy('seq')->get();
        $difs = $lineas->where('match_status', '<>', 'MATCHED')->count();
        $accion = $d['action'] ?? ($difs ? 'ADJUST' : 'ACCEPT');
        if ($accion === 'ACCEPT' && $difs) {
            RuleError::fail('RN-CNT-18', 'Hay diferencias resueltas: el envío es de ajuste o de reemplazo, no de aceptación.');
        }
        $ruc = DB::table('companies')->where('id', $p->company_id)->value('ruc');
        $cod = $reg === 'SALES' ? '140400' : '080400';
        $contenido = $lineas->map(fn ($l) => implode('|', [$l->key, $l->total, $l->resolution ?? '']))->implode("\n");
        $id = DB::table('sire_submissions')->insertGetId([
            'company_id' => $p->company_id, 'register' => $reg, 'period' => $periodo, 'proposal_id' => $p->id, 'action' => $accion,
            'file_name' => 'LE'.$ruc.substr($periodo, 0, 4).substr($periodo, 5, 2).'00'.$cod.($accion === 'ACCEPT' ? '1' : '2').'.zip', 'file_hash' => hash('sha256', $contenido),
            'line_count' => $lineas->count(), 'adjustments' => $difs, 'generated_at' => now(), 'prepared_by' => $quien->id, 'status' => 'PREPARED',
        ], 'id');

        return DB::table('sire_submissions')->find($id);
    }

    public static function marcarEnviado(string $id, string $ticket, User $quien): object
    {
        $s = DB::table('sire_submissions')->where('id', $id)->first() ?? abort(404);
        if (! Access::can($quien, 'cnt.sire.submit')) {
            RuleError::fail('RN-CNT-18', 'Marcar el envío como presentado es de la contadora.');
        }
        if ($s->status !== 'PREPARED') {
            RuleError::fail('RN-CNT-18', 'Solo se presenta un archivo preparado.');
        }
        if (self::sinResolver($s->proposal_id)->isNotEmpty()) {
            RuleError::fail('RN-CNT-18', 'La propuesta tiene diferencias sin resolver.');
        }
        if (trim($ticket) === '') {
            RuleError::fail('RN-CNT-18', 'Indica el número de ticket que devolvió SUNAT.');
        }
        DB::table('sire_submissions')->where('id', $id)->update(['status' => 'SENT', 'ticket' => $ticket, 'submitted_by' => $quien->id, 'submitted_at' => now(), 'updated_at' => now()]);

        return DB::table('sire_submissions')->find($id);
    }

    public static function marcarResultado(string $id, bool $ok, string $ref, User $quien): object
    {
        $s = DB::table('sire_submissions')->where('id', $id)->first() ?? abort(404);
        if (! Access::can($quien, 'cnt.sire.submit')) {
            RuleError::fail('RN-CNT-18', 'Registrar la constancia es de la contadora.');
        }
        if ($s->status !== 'SENT') {
            RuleError::fail('RN-CNT-18', 'Solo se registra la respuesta de un envío presentado.');
        }
        if (trim($ref) === '') {
            RuleError::fail('RN-CNT-18', $ok ? 'Indica el número de constancia.' : 'Indica el motivo del rechazo.');
        }
        DB::table('sire_submissions')->where('id', $id)->update($ok ? ['status' => 'ACCEPTED', 'receipt_number' => $ref, 'accepted_at' => now(), 'updated_at' => now()]
            : ['status' => 'REJECTED', 'receipt_number' => mb_substr('Rechazo: '.$ref, 0, 255), 'updated_at' => now()]);
        if ($ok) {
            DB::table('sire_proposals')->where('id', $s->proposal_id)->update(['status' => 'SUBMITTED', 'updated_at' => now()]);
        }

        return DB::table('sire_submissions')->find($id);
    }

    /** Texto de ejemplo como lo descarga la contadora de SUNAT (para la demo y las pruebas). */
    public static function ejemplo(string $registro, string $periodo): string
    {
        $sis = $registro === 'SALES' ? self::ventas($periodo)->filter(fn ($s) => $s->sunat !== 'PENDING') : self::compras($periodo);
        $filas = $sis->map(fn ($s) => [$registro === 'SALES' ? ($s->cust ?: '00000000') : $s->ruc, $s->name, $s->type, $s->series, $s->number,
            CarbonImmutable::parse($s->date)->format('d/m/Y'), $s->base, $s->igv, $s->total])->values()->all();
        if ($registro !== 'SALES' && count($filas) > 3) {
            $filas[1][8] = round((float) $filas[1][8] + 12.5, 2);
            $filas[] = ['20331898008', 'LUZ DEL SUR SAA', '01', 'F104', '880415', CarbonImmutable::parse($periodo)->addDays(20)->format('d/m/Y'), 186.44, 33.56, 220.0];
            array_splice($filas, 2, 1);
        }

        return "RUC|Razon social|Tipo|Serie|Numero|Fecha|Base|IGV|Total\n".implode("\n", array_map(fn ($f) => implode('|', $f), $filas));
    }

    public static function ver(string $id): object
    {
        $p = DB::table('sire_proposals as p')->leftJoin('users as u', 'u.id', '=', 'p.imported_by')->where('p.id', $id)->first(['p.*', 'u.name as imported_by_name']) ?? abort(404);
        $p->summary = json_decode($p->summary ?: '{}', true);
        $p->pending = self::sinResolver($id)->count();

        return $p;
    }
}
