<?php

namespace App\Modulos\B2b\Services;

use App\Models\User;
use App\Modulos\Canales\Soporte as S;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * B2B-10 y B2B-16: reclamos del cliente empresarial con evidencia, plazo de respuesta y resolución (RN-B2B-17).
 * La nota de crédito la emite FAC; mientras FAC no exista se registra su serie y número y se enlaza si ya existe.
 */
final class Reclamos
{
    public const TIPOS = ['QUALITY' => 'Calidad', 'WEIGHT' => 'Peso', 'LATE' => 'Atraso', 'BILLING' => 'Facturación', 'OTHER' => 'Otro'];

    public static function vence(object $c): string
    {
        return \Carbon\CarbonImmutable::parse($c->opened_at)->addHours((int) S::num('b2b_claim_response_hours', 48))->toIso8601String();
    }

    public static function lista(?string $customerId = null, array $f = []): array
    {
        $rows = DB::table('b2b_claims as r')->join('customers as c', 'c.id', '=', 'r.customer_id')
            ->leftJoin('sales_orders as o', 'o.id', '=', 'r.order_id')->leftJoin('sales_documents as d', 'd.id', '=', 'r.document_id')
            ->when($customerId, fn ($q, $c) => $q->where('r.customer_id', $c))
            ->when($f['status'] ?? null, fn ($q, $s) => $q->where('r.status', $s))
            ->when($f['claim_type'] ?? null, fn ($q, $s) => $q->where('r.claim_type', $s))
            ->orderByRaw("CASE r.status WHEN 'OPEN' THEN 0 WHEN 'IN_REVIEW' THEN 1 ELSE 2 END")->orderByDesc('r.opened_at')
            ->get(['r.*', 'c.full_name as customer_name', 'o.number as order_number', 'd.full_number as document_number']);
        $ahora = now()->timestamp;

        return $rows->map(function ($r) use ($ahora) {
            $r->photo_urls = json_decode($r->photo_urls ?? '[]', true);
            $r->due_at = self::vence($r);
            $r->late = in_array($r->status, ['OPEN'], true) && ! $r->first_response_at && strtotime($r->due_at) < $ahora;
            $r->type_label = self::TIPOS[$r->claim_type] ?? $r->claim_type;
            $r->assigned_name = S::nombre($r->assigned_user_id);

            return $r;
        })->all();
    }

    public static function abrir(string $customerId, array $d, User $quien, ?string $accountId = null): object
    {
        return S::base(fn () => DB::transaction(function () use ($customerId, $d, $quien, $accountId) {
            $tipo = $d['claim_type'] ?? null;
            isset(self::TIPOS[$tipo]) || RuleError::fail('RN-B2B-17', 'Elige el tipo de reclamo.');
            $texto = trim((string) ($d['description'] ?? ''));
            $texto !== '' || RuleError::fail('RN-B2B-17', 'Describe el reclamo.');
            $fotos = array_values(array_filter((array) ($d['photo_urls'] ?? [])));
            if (in_array($tipo, ['QUALITY', 'WEIGHT'], true) && ! $fotos) {
                RuleError::fail('RN-B2B-17', 'Un reclamo de '.mb_strtolower(self::TIPOS[$tipo]).' exige al menos una foto.');
            }
            if (! empty($d['order_id'])) {
                DB::table('sales_orders')->where('id', $d['order_id'])->where('customer_id', $customerId)->exists()
                    || RuleError::fail('RN-B2B-12', 'El pedido no es de este cliente.');
            }
            if (! empty($d['document_id'])) {
                DB::table('sales_documents')->where('id', $d['document_id'])->where('customer_id', $customerId)->exists()
                    || RuleError::fail('RN-B2B-12', 'El comprobante no es de este cliente.');
            }
            $resp = DB::table('customer_credit_profiles')->where('customer_id', $customerId)->value('seller_user_id')
                ?? DB::table('customers')->where('id', $customerId)->value('seller_user_id');
            $id = DB::table('b2b_claims')->insertGetId([
                'number' => S::numero('b2b_claims', 'RB-', 4), 'customer_id' => $customerId, 'order_id' => $d['order_id'] ?? null,
                'document_id' => $d['document_id'] ?? null, 'portal_account_id' => $accountId, 'claim_type' => $tipo, 'description' => $texto,
                'photo_urls' => json_encode($fotos), 'status' => 'OPEN', 'opened_at' => now(), 'assigned_user_id' => $resp,
            ], 'id');
            $c = DB::table('b2b_claims')->where('id', $id)->first();
            Events::emit('b2b_claim.opened', 'b2b_claims', $id, ['customer_id' => $customerId, 'type' => $tipo]);
            S::avisar('B2B', ['role' => 'SUPERVISORA_VENTAS'], 'Nuevo reclamo B2B', DB::table('customers')->where('id', $customerId)->value('full_name').' · '.self::TIPOS[$tipo].': '.mb_substr($texto, 0, 80), 'B2B-10', $id, 'warning');

            return $c;
        }));
    }

    public static function responder(string $id, ?string $texto, User $quien): object
    {
        $texto = S::motivo($texto, 'RN-B2B-17', 'Escribe la respuesta.');
        $c = DB::table('b2b_claims')->where('id', $id)->first() ?? abort(404);
        in_array($c->status, ['OPEN', 'IN_REVIEW'], true) || RuleError::fail('RN-B2B-17', 'El reclamo ya está cerrado.');
        DB::table('b2b_claims')->where('id', $id)->update([
            'response' => $texto, 'first_response_at' => $c->first_response_at ?? now(), 'status' => 'IN_REVIEW',
            'assigned_user_id' => $c->assigned_user_id ?? $quien->id, 'updated_at' => now(),
        ]);

        return DB::table('b2b_claims')->where('id', $id)->first();
    }

    /**
     * @param  array{resolution?: string, note?: ?string, amount?: mixed, credit_note_number?: ?string, reject?: bool}  $d
     */
    public static function resolver(string $id, array $d, User $quien): object
    {
        return S::base(fn () => DB::transaction(function () use ($id, $d, $quien) {
            $c = DB::table('b2b_claims')->where('id', $id)->lockForUpdate()->first() ?? abort(404);
            in_array($c->status, ['OPEN', 'IN_REVIEW'], true) || RuleError::fail('RN-B2B-17', 'El reclamo ya está cerrado.');
            $base = ['resolved_by' => $quien->id, 'resolved_at' => now(), 'first_response_at' => $c->first_response_at ?? now(), 'updated_at' => now()];
            if (! empty($d['reject'])) {
                $nota = S::motivo($d['note'] ?? null, 'RN-B2B-17', 'Indica por qué se rechaza el reclamo.');
                DB::table('b2b_claims')->where('id', $id)->update($base + ['status' => 'REJECTED', 'resolution' => 'NO_ACTION', 'resolution_note' => mb_substr($nota, 0, 500)]);

                return DB::table('b2b_claims')->where('id', $id)->first();
            }
            $res = $d['resolution'] ?? null;
            in_array($res, ['CREDIT_NOTE', 'REPLACEMENT', 'NO_ACTION'], true) || RuleError::fail('RN-B2B-17', 'Elige cómo se resuelve el reclamo.');
            $extra = [];
            if ($res === 'CREDIT_NOTE') {
                $monto = (float) ($d['amount'] ?? 0);
                $monto > 0 || RuleError::fail('RN-B2B-17', 'Un reclamo resuelto con abono exige el monto de la nota de crédito.');
                $doc = $c->document_id ? DB::table('sales_documents')->where('id', $c->document_id)->first()
                    : ($c->order_id ? DB::table('sales_documents')->where('order_id', $c->order_id)->whereIn('doc_type', ['INVOICE', 'RECEIPT'])->where('status', '<>', 'VOIDED')->first() : null);
                $doc || RuleError::fail('RN-B2B-17', 'El reclamo no tiene comprobante para emitir la nota de crédito.');
                $monto <= (float) $doc->total + 0.005 || RuleError::fail('RN-B2B-17', 'El abono supera el comprobante.');
                $numero = strtoupper(trim((string) ($d['credit_note_number'] ?? '')));
                $numero !== '' || RuleError::fail('RN-B2B-17', 'Un reclamo resuelto con abono exige la nota de crédito enlazada: indica su serie y número.');
                preg_match('/^[A-Z0-9]{4}-\d{1,8}$/', $numero) || RuleError::fail('RN-B2B-17', 'La nota de crédito se escribe como serie-número, por ejemplo FC01-00000012.');
                $nc = DB::table('sales_documents')->where('doc_type', 'CREDIT_NOTE')->where('full_number', $numero)->first();
                if ($nc && $nc->customer_id !== $c->customer_id) {
                    RuleError::fail('RN-B2B-17', 'Esa nota de crédito es de otro cliente.');
                }
                $extra = ['credit_note_id' => $nc->id ?? null, 'credit_note_number' => $numero, 'credit_amount' => S::r($monto), 'document_id' => $c->document_id ?? $doc->id];
            }
            DB::table('b2b_claims')->where('id', $id)->update($base + $extra + ['status' => 'RESOLVED', 'resolution' => $res, 'resolution_note' => isset($d['note']) ? mb_substr((string) $d['note'], 0, 500) : null]);
            Events::emit('b2b_claim.resolved', 'b2b_claims', $id, ['resolution' => $res]);

            return DB::table('b2b_claims')->where('id', $id)->first();
        }));
    }

    /** Reclamos abiertos sin primera respuesta pasado el plazo: aviso a la supervisora (una vez por reclamo). */
    public static function avisarAtrasados(): int
    {
        $n = 0;
        foreach (self::lista(null, ['status' => 'OPEN']) as $r) {
            if ($r->late && S::avisar('B2B', ['role' => 'SUPERVISORA_VENTAS'], 'Reclamo B2B sin respuesta', "{$r->number} · {$r->customer_name}: pasó el plazo de respuesta.", 'B2B-10', $r->id, 'danger', 'reclamo-atrasado-'.$r->id)) {
                $n++;
            }
        }

        return $n;
    }
}
