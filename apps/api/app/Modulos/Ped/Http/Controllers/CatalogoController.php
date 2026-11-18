<?php

namespace App\Modulos\Ped\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** PED-13 Motivos y límites: motivos de cancelación y no entrega (RN-PED-13) y límites de descuento por rol y marca (RN-PED-11). */
class CatalogoController extends Controller
{
    public const ROLES_CON_LIMITE = ['VENDEDORA', 'SUPERVISORA_VENTAS', 'CAJERO', 'GERENTE', 'COORDINADOR_DELIVERY'];

    public function index()
    {
        $usos = DB::table('sales_orders')->whereNotNull('cancel_reason')->groupBy('cancel_reason')->selectRaw('cancel_reason as code, count(*) as n')->pluck('n', 'code');
        $usosNe = DB::table('sales_orders')->whereNotNull('not_delivered_reason_code')->groupBy('not_delivered_reason_code')->selectRaw('not_delivered_reason_code as code, count(*) as n')->pluck('n', 'code');

        return response()->json([
            'motivos' => DB::table('order_cancel_reasons')->orderBy('applies_to')->orderBy('name')->get()
                ->map(fn ($m) => (array) $m + ['usos' => ($usos[$m->code] ?? 0) + ($usosNe[$m->code] ?? 0)]),
            'limites' => DB::table('discount_limits as l')->leftJoin('brands as b', 'b.id', '=', 'l.brand_id')->orderBy('l.role')->orderByRaw('l.brand_id is not null')
                ->get(['l.id', 'l.role', 'l.brand_id', 'l.max_pct', 'l.max_amount', 'l.status', 'b.name as marca']),
            'roles' => DB::table('roles')->whereIn('code', self::ROLES_CON_LIMITE)->orderBy('name')->get(['id', 'code', 'name']),
            'marcas' => DB::table('brands')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name']),
        ]);
    }

    public function guardarMotivo(Request $request, ?string $id = null)
    {
        $d = $request->validate([
            'code' => ['required', 'string', 'max:40', 'regex:/^[A-Z0-9_]+$/'], 'name' => ['required', 'string', 'max:80'],
            'applies_to' => ['required', Rule::in(['CANCEL', 'NOT_DELIVERED', 'BOTH'])], 'requires_note' => ['boolean'], 'counts_as_loss' => ['boolean'],
            'status' => ['nullable', Rule::in(['ACTIVE', 'INACTIVE'])],
        ]);
        if (DB::table('order_cancel_reasons')->where('code', $d['code'])->when($id, fn ($q) => $q->where('id', '<>', $id))->exists()) {
            RuleError::fail('RN-PED-13', "Ya existe el motivo {$d['code']}.");
        }
        if ($id && DB::table('order_cancel_reasons')->where('id', $id)->value('code') === 'BORRADOR_VENCIDO' && ($d['status'] ?? 'ACTIVE') !== 'ACTIVE') {
            RuleError::fail('RN-PED-18', '«Borrador vencido» lo usa el sistema: no se desactiva.');
        }
        $datos = $d + ['requires_note' => false, 'counts_as_loss' => false, 'status' => 'ACTIVE', 'updated_at' => now()];
        if ($id) {
            DB::table('order_cancel_reasons')->where('id', $id)->update($datos);
        } else {
            $id = DB::table('order_cancel_reasons')->insertGetId($datos + ['created_at' => now()], 'id');
        }

        return response()->json(DB::table('order_cancel_reasons')->where('id', $id)->first(), $request->isMethod('post') ? 201 : 200);
    }

    public function guardarLimite(Request $request, ?string $id = null)
    {
        $d = $request->validate([
            'role' => ['required', Rule::in(self::ROLES_CON_LIMITE)], 'brand_id' => ['nullable', 'uuid'],
            'max_pct' => ['required', 'numeric', 'min:0', 'max:100'], 'max_amount' => ['required', 'numeric', 'min:0', 'max:99999'],
            'status' => ['nullable', Rule::in(['ACTIVE', 'INACTIVE'])],
        ]);
        $rol = DB::table('roles')->where('code', $d['role'])->value('id') ?? RuleError::fail('RN-PED-11', 'El rol no existe en la empresa.');
        $repetido = DB::table('discount_limits')->where('role', $d['role'])->where('status', 'ACTIVE')
            ->where(fn ($q) => empty($d['brand_id']) ? $q->whereNull('brand_id') : $q->where('brand_id', $d['brand_id']))
            ->when($id, fn ($q) => $q->where('id', '<>', $id))->exists();
        if ($repetido && ($d['status'] ?? 'ACTIVE') === 'ACTIVE') {
            RuleError::fail('RN-PED-11', 'Ya hay un límite activo para ese rol y marca: edítalo.');
        }
        $datos = ['role' => $d['role'], 'role_id' => $rol, 'brand_id' => $d['brand_id'] ?? null, 'max_pct' => $d['max_pct'], 'max_amount' => $d['max_amount'],
            'status' => $d['status'] ?? 'ACTIVE', 'updated_at' => now()];
        if ($id) {
            DB::table('discount_limits')->where('id', $id)->update($datos);
        } else {
            $id = DB::table('discount_limits')->insertGetId($datos + ['created_at' => now()], 'id');
        }

        return response()->json(DB::table('discount_limits')->where('id', $id)->first(), $request->isMethod('post') ? 201 : 200);
    }
}
