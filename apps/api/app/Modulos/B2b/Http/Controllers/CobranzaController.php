<?php

namespace App\Modulos\B2b\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\B2b\Services\Cobranza;
use App\Modulos\B2b\Services\Portal;
use App\Modulos\B2b\Services\Reclamos;
use App\Modulos\Canales\Soporte as S;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/** B2B-07 estado de cuenta, B2B-08 cartera, B2B-09 recordatorios y promesas, B2B-10 reclamos, B2B-11 accesos al portal. */
class CobranzaController extends Controller
{
    public function estadoCuenta(string $customerId)
    {
        DB::table('customers')->where('id', $customerId)->exists() || abort(404);

        return response()->json(Cobranza::estadoDeCuenta($customerId));
    }

    /** B2B-07: exporta a CSV (se abre en Excel). */
    public function exportarEstado(string $customerId)
    {
        $e = Cobranza::estadoDeCuenta($customerId);
        $nombre = 'estado-de-cuenta-'.preg_replace('/[^a-z0-9]+/', '-', mb_strtolower($e['customer']->full_name ?? 'cliente')).'.csv';
        $tipos = ['DOC' => 'Comprobante', 'NC' => 'Nota de crédito', 'PAY' => 'Cobro'];

        return response()->streamDownload(function () use ($e, $tipos) {
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF");
            fputcsv($out, ['Fecha', 'Tipo', 'Referencia', 'Vence', 'Cargo', 'Abono', 'Saldo', 'Días de mora'], ';');
            foreach ($e['movements'] as $m) {
                fputcsv($out, [S::dmy($m['date']), $tipos[$m['kind']], $m['ref'], isset($m['due_date']) ? S::dmy($m['due_date']) : '',
                    number_format($m['charge'], 2, '.', ''), number_format($m['credit'], 2, '.', ''), number_format($m['balance'], 2, '.', ''), $m['days_overdue'] ?? ''], ';');
            }
            fclose($out);
        }, $nombre, ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /** B2B-08 */
    public function antiguedad(Request $r)
    {
        $por = in_array($r->query('by'), ['customer', 'seller', 'brand'], true) ? $r->query('by') : 'customer';

        return response()->json(Cobranza::antiguedad($por, null, $r->query('seller_id')));
    }

    /** B2B-09 */
    public function recordatorios(Request $r)
    {
        return response()->json([
            'reminders' => Cobranza::recordatorios($r->only(['status', 'customer_id', 'desde', 'hasta'])),
            'promises' => Cobranza::promesas($r->only(['customer_id'])),
            'types' => Cobranza::TIPOS,
            'open_documents' => DB::table('b2b_receivables_v as d')->join('customers as c', 'c.id', '=', 'd.customer_id')->whereIn('d.doc_type', ['INVOICE', 'RECEIPT'])
                ->orderBy('c.full_name')->orderBy('d.due_date')->get(['d.document_id', 'd.full_number', 'd.customer_id', 'c.full_name as customer_name', 'd.balance', 'd.due_date']),
        ]);
    }

    public function enviar()
    {
        $prog = Cobranza::programarTodos();

        return response()->json(Cobranza::enviarPendientes() + ['scheduled' => $prog]);
    }

    public function evaluar()
    {
        return response()->json(['updated' => Cobranza::evaluarPromesas()]);
    }

    public function prometer(Request $r)
    {
        $d = $r->validate(['document_id' => 'nullable|uuid', 'customer_id' => 'nullable|uuid', 'promised_date' => 'required|date', 'amount' => 'required|numeric|gt:0', 'notes' => 'nullable|string|max:500']);

        return response()->json(Cobranza::prometer($d, $r->user()), 201);
    }

    public function cancelarPromesa(Request $r, string $id)
    {
        return response()->json(Cobranza::cancelarPromesa($id, $r->user()));
    }

    /** B2B-10 */
    public function reclamos(Request $r)
    {
        return response()->json(['data' => Reclamos::lista($r->query('customer_id'), $r->only(['status', 'claim_type'])), 'types' => Reclamos::TIPOS]);
    }

    public function responder(Request $r, string $id)
    {
        $d = $r->validate(['response' => 'nullable|string|max:2000']);

        return response()->json(Reclamos::responder($id, $d['response'] ?? null, $r->user()));
    }

    public function resolver(Request $r, string $id)
    {
        $d = $r->validate(['resolution' => 'nullable|in:CREDIT_NOTE,REPLACEMENT,NO_ACTION', 'note' => 'nullable|string|max:500', 'amount' => 'nullable|numeric|min:0',
            'credit_note_number' => 'nullable|string|max:30', 'reject' => 'nullable|boolean']);

        return response()->json(Reclamos::resolver($id, $d, $r->user()));
    }

    public static function servirFoto(?object $c, int $n)
    {
        $fotos = $c ? (json_decode($c->photo_urls ?? '[]', true) ?: []) : [];
        $ruta = $fotos[$n] ?? null;
        abort_unless($ruta && ! str_contains($ruta, '..') && Storage::disk('local')->exists($ruta), 404);

        return response()->file(Storage::disk('local')->path($ruta), ['Cache-Control' => 'private, max-age=3600', 'X-Content-Type-Options' => 'nosniff']);
    }

    public function foto(string $id, int $n)
    {
        return self::servirFoto(DB::table('b2b_claims')->where('id', $id)->first(), $n);
    }

    /** B2B-11 */
    public function accesos(Request $r)
    {
        return response()->json(['data' => Portal::usuarios($r->query('customer_id')), 'roles' => Portal::ROLES]);
    }

    public function invitar(Request $r)
    {
        $d = $r->validate(['customer_id' => 'required|uuid', 'name' => 'required|string|max:255', 'email' => 'required|string|max:255', 'portal_role' => 'required|in:BUYER,ACCOUNTING,OWNER']);
        if ($d['portal_role'] === 'OWNER') {
            $d['portal_role'] = 'BUYER';
            $owner = true;
        }
        $a = Portal::invitar($d['customer_id'], $d, $r->user());
        if (! empty($owner)) {
            DB::table('b2b_portal_accounts')->where('customer_id', $d['customer_id'])->where('portal_role', 'OWNER')->exists()
                || DB::table('b2b_portal_accounts')->where('id', $a->id)->update(['portal_role' => 'OWNER']);
        }

        return response()->json(DB::table('b2b_portal_accounts')->where('id', $a->id)->first(), 201);
    }

    public function activar(Request $r, string $id)
    {
        $d = $r->validate(['active' => 'required|boolean']);

        return response()->json(Portal::activar($id, $d['active'], $r->user()));
    }
}
