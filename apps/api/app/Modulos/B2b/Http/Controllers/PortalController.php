<?php

namespace App\Modulos\B2b\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\B2b\Services\Cobranza;
use App\Modulos\B2b\Services\Portal;
use App\Modulos\B2b\Services\Reclamos;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * B2B-12 a B2B-17: el portal. El cliente sale siempre de la cuenta de la sesión (atributo portal_account que pone
 * el middleware «portal»), nunca de la petición (RN-B2B-12).
 */
class PortalController extends Controller
{
    private function cuenta(Request $r): object
    {
        return $r->attributes->get('portal_account') ?? abort(403);
    }

    public function resumen(Request $r)
    {
        return response()->json(Portal::resumen($this->cuenta($r)));
    }

    /** B2B-12 */
    public function catalogo(Request $r)
    {
        $c = $this->cuenta($r);

        return response()->json(['data' => Portal::catalogo($c->customer_id, $r->query('date'), $r->query('q')), 'earliest_date' => Portal::fechaMinima()]);
    }

    /** B2B-13 */
    public function repetir(Request $r, string $orderId)
    {
        return response()->json(Portal::repetir($this->cuenta($r)->customer_id, $orderId));
    }

    public function pedir(Request $r)
    {
        $d = $r->validate(['delivery_date' => 'nullable|date', 'slot_from' => 'nullable|date_format:H:i', 'notes' => 'nullable|string|max:500', 'pay' => 'nullable|in:AUTO,CREDIT,TRANSFER',
            'repeat_of' => 'nullable|uuid', 'lines' => 'required|array|min:1', 'lines.*.variant_id' => 'required|uuid', 'lines.*.qty' => 'required|numeric|min:0',
            'lines.*.est_weight_kg' => 'nullable|numeric|min:0', 'lines.*.cut_notes' => 'nullable|string|max:255']);

        return response()->json(['orders' => Portal::pedir($this->cuenta($r), $d, $r->user())], 201);
    }

    /** B2B-14 */
    public function pedidos(Request $r)
    {
        return response()->json(['data' => Portal::pedidos($this->cuenta($r)->customer_id)]);
    }

    public function pedido(Request $r, string $id)
    {
        return response()->json(Portal::pedido($this->cuenta($r)->customer_id, $id));
    }

    /** B2B-15 */
    public function cuentaCorriente(Request $r)
    {
        $c = $this->cuenta($r);
        $c->can_view_statement || RuleError::fail('RN-B2B-12', 'Tu usuario no tiene acceso al estado de cuenta.');
        $e = Cobranza::estadoDeCuenta($c->customer_id);
        unset($e['promises']);

        return response()->json($e + ['documents' => Portal::documentos($c->customer_id)]);
    }

    public function descargar(Request $r, string $id, string $tipo)
    {
        $d = Portal::descargar($this->cuenta($r)->customer_id, $id, $tipo);
        // FAC guarda el PDF, el XML y el CDR. Mientras FAC no exista, se entrega un resumen en texto con el nombre oficial del archivo.
        $doc = $d['document'];
        $texto = "Comprobante {$doc->full_number}\nEmitido: {$doc->issue_date}\nCliente: {$doc->customer_name}\nTotal: S/ ".number_format((float) $doc->total, 2)."\nSUNAT: aceptado\n";

        return response($texto, 200, ['Content-Type' => 'text/plain; charset=UTF-8', 'Content-Disposition' => 'attachment; filename="'.$d['name'].'.txt"', 'X-File-Name' => $d['name']]);
    }

    /** B2B-16 */
    public function reclamos(Request $r)
    {
        $c = $this->cuenta($r);

        return response()->json(['data' => Reclamos::lista($c->customer_id), 'types' => Reclamos::TIPOS,
            'orders' => DB::table('sales_orders')->where('customer_id', $c->customer_id)->orderByDesc('delivery_date')->limit(30)->get(['id', 'number', 'delivery_date', 'status']),
            'documents' => DB::table('sales_documents')->where('customer_id', $c->customer_id)->whereIn('doc_type', ['INVOICE', 'RECEIPT'])->orderByDesc('issue_date')->limit(30)->get(['id', 'full_number', 'issue_date', 'total'])]);
    }

    public function abrirReclamo(Request $r)
    {
        $c = $this->cuenta($r);
        $d = $r->validate([
            'claim_type' => 'required|in:QUALITY,WEIGHT,LATE,BILLING,OTHER', 'description' => 'required|string|max:2000', 'order_id' => 'nullable|uuid', 'document_id' => 'nullable|uuid',
            'photos' => 'nullable|array|max:4', 'photos.*' => ['file', 'max:2048', 'mimes:png,jpg,jpeg,webp'],
        ], ['photos.*.max' => 'Cada foto puede pesar hasta 2 MB.', 'photos.*.mimes' => 'Las fotos deben ser PNG, JPG o WEBP.']);
        $d['photo_urls'] = [];
        foreach ($r->file('photos', []) as $f) {
            $d['photo_urls'][] = $f->store('b2b/reclamos/'.$r->attributes->get('tenant_id'), 'local');
        }
        unset($d['photos']);

        return response()->json(Reclamos::abrir($c->customer_id, $d, $r->user(), $c->id), 201);
    }

    public function foto(Request $r, string $id, int $n)
    {
        return CobranzaController::servirFoto(DB::table('b2b_claims')->where('id', $id)->where('customer_id', $this->cuenta($r)->customer_id)->first(), $n);
    }

    /** B2B-17: el dueño de la cuenta invita o desactiva a compradores y contabilidad de su empresa. */
    private function dueno(Request $r): object
    {
        $c = $this->cuenta($r);
        $c->portal_role === 'OWNER' || RuleError::fail('RN-B2B-12', 'Solo el dueño de la cuenta administra los usuarios de la empresa.');

        return $c;
    }

    public function usuarios(Request $r)
    {
        $c = $this->cuenta($r);

        return response()->json(['data' => Portal::usuarios($c->customer_id), 'roles' => Portal::ROLES, 'is_owner' => $c->portal_role === 'OWNER']);
    }

    public function invitar(Request $r)
    {
        $c = $this->dueno($r);
        $d = $r->validate(['name' => 'required|string|max:255', 'email' => 'required|string|max:255', 'portal_role' => 'required|in:BUYER,ACCOUNTING']);

        return response()->json(Portal::invitar($c->customer_id, $d, $r->user()), 201);
    }

    public function activar(Request $r, string $id)
    {
        $c = $this->dueno($r);
        $d = $r->validate(['active' => 'required|boolean']);

        return response()->json(Portal::activar($id, $d['active'], $r->user(), $c->customer_id));
    }
}
