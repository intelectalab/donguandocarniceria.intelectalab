<?php

namespace App\Modulos\Cli\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cli\Models\Customer;
use App\Modulos\Cli\Services\Clientes;
use App\Modulos\Cli\Services\Documentos;
use App\Support\Access;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * CLI-04 Validar documento: consulta DNI (RENIEC) o RUC (SUNAT) con el proveedor y guarda fuente y
 * fecha (RN-CLI-12). D-CLI-01: adaptador de prueba; la validación manual exige
 * cli.customer.validate_manual y una nota.
 */
class DocumentoController extends Controller
{
    /** Pregunta al proveedor sin guardar nada (para ver la respuesta antes de guardarla). */
    public function consultar(Request $request)
    {
        $d = $request->validate(['doc_type' => ['required', Rule::in(['DNI', 'RUC', 'CE', 'PASSPORT'])], 'doc_number' => ['required', 'string', 'max:20']]);

        return response()->json(Documentos::consultar($d['doc_type'], $d['doc_number']) + ['consultado' => now()->toIso8601String()]);
    }

    /** Guarda el documento validado en el cliente. */
    public function validar(Request $request, string $id)
    {
        $d = $request->validate([
            'doc_type' => ['required', Rule::in(['DNI', 'RUC', 'CE', 'PASSPORT'])], 'doc_number' => ['required', 'string', 'max:20'],
            'manual' => ['boolean'], 'nota' => ['nullable', 'string', 'max:255'],
        ]);
        $manual = (bool) ($d['manual'] ?? false);
        $permiso = $manual ? 'cli.customer.validate_manual' : 'cli.customer.manage';
        if (! Access::can($request->user(), $permiso)) {
            RuleError::fail('RN-CLI-12', "Tu rol no tiene el permiso {$permiso}.");
        }
        $r = Clientes::validarDocumento(Customer::findOrFail($id), $d['doc_type'], $d['doc_number'], $manual, $d['nota'] ?? null, $request->user());

        return response()->json(['respuesta' => $r, 'customer' => Customer::find($id)]);
    }

    /** Clientes con documento escrito pero sin validar, y la bitácora de consultas (Ley 29733). */
    public function pendientes()
    {
        return response()->json([
            'sin_validar' => DB::table('customers')->whereNull('merged_into_id')->where('status', '<>', 'INACTIVE')
                ->where('doc_type', '<>', 'NONE')->whereNotNull('doc_number')->whereNull('doc_validated_at')
                ->orderBy('full_name')->limit(12)->get(['id', 'full_name', 'trade_name', 'doc_type', 'doc_number']),
            'total_sin_validar' => DB::table('customers')->whereNull('merged_into_id')->where('status', '<>', 'INACTIVE')
                ->where('doc_type', '<>', 'NONE')->whereNotNull('doc_number')->whereNull('doc_validated_at')->count(),
            'bitacora' => DB::table('domain_events as e')->where('e.event_name', 'customer.document_checked')
                ->leftJoin('customers as c', 'c.id', '=', 'e.aggregate_id')
                ->orderByDesc('e.occurred_at')->limit(10)
                ->get(['e.id', 'e.occurred_at', 'e.payload', 'c.id as customer_id', 'c.full_name'])
                ->map(fn ($e) => ['id' => $e->id, 'at' => $e->occurred_at, 'customer_id' => $e->customer_id, 'cliente' => $e->full_name] + json_decode($e->payload, true)),
        ]);
    }
}
