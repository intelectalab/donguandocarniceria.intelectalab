<?php

namespace App\Modulos\Flo\Http\Controllers;

use App\Modulos\Flo\Services\Base;
use App\Modulos\Flo\Services\Combustible;
use App\Modulos\Flo\Services\Costos;
use App\Modulos\Flo\Services\Documentos;
use App\Modulos\Flo\Services\Gastos;
use App\Modulos\Flo\Services\Mantenimiento;
use App\Modulos\Flo\Services\Multas;
use App\Support\Exportar;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** FLO-05 a FLO-12: combustible, rendimiento, mantenimiento, documentos, multas, otros costos y costo total. */
class CostoController extends Controlador
{
    private const GASTO = ['expense_id', 'create_expense', 'doc_type', 'doc_series', 'doc_number', 'supplier_doc', 'supplier_name'];

    private function reglasGasto(): array
    {
        return ['expense_id' => ['nullable', 'uuid'], 'create_expense' => ['nullable', 'boolean'], 'doc_type' => ['nullable', 'string', 'max:20'],
            'doc_series' => ['nullable', 'string', 'max:20'], 'doc_number' => ['nullable', 'string', 'max:20'], 'supplier_doc' => ['nullable', 'string', 'max:15'],
            'supplier_name' => ['nullable', 'string', 'max:160']];
    }

    // FLO-05 Cargas
    public function cargas(Request $request)
    {
        return response()->json(Combustible::lista($request->user(), $this->filtros($request, ['estado' => ['nullable', Rule::in(['ACTIVE', 'VOIDED', 'TODAS'])], 'gasto' => ['nullable', Rule::in(['SIN'])]])));
    }

    public function previa(Request $request)
    {
        $request->validate(['vehicle_id' => ['required', 'uuid'], 'loaded_at' => ['nullable', 'string', 'max:40'], 'odometer_km' => ['nullable', 'numeric'], 'gallons' => ['nullable', 'numeric']]);

        return response()->json(Combustible::previa($request->all(), $request->user()));
    }

    public function registrarCarga(Request $request)
    {
        $request->validate($this->reglasGasto() + ['vehicle_id' => ['required', 'uuid'], 'loaded_at' => ['nullable', 'string', 'max:40'], 'odometer_km' => ['required', 'numeric'],
            'gallons' => ['required', 'numeric'], 'price_per_gal' => ['nullable', 'numeric'], 'amount' => ['nullable', 'numeric'], 'full_tank' => ['nullable', 'boolean'],
            'station_supplier_id' => ['nullable', 'uuid'], 'station_name' => ['nullable', 'string', 'max:120'], 'voucher_no' => ['nullable', 'string', 'max:30'],
            'driver_user_id' => ['nullable', 'uuid'], 'source' => ['nullable', Rule::in(['APP', 'WEB'])]]);
        $d = $this->datos($request, array_merge(self::GASTO, ['vehicle_id', 'loaded_at', 'odometer_km', 'gallons', 'price_per_gal', 'amount', 'full_tank', 'station_supplier_id',
            'station_name', 'voucher_no', 'driver_user_id', 'source']));

        return response()->json(Combustible::registrar($d, $this->archivo($request), $request->user()), 201);
    }

    public function anularCarga(Request $request, string $id)
    {
        $request->validate(['reason' => ['required', 'string', 'max:500']]);

        return response()->json(Combustible::anular($id, $request->input('reason'), $request->user()));
    }

    public function gastoCarga(Request $request, string $id)
    {
        $request->validate($this->reglasGasto());

        return response()->json(Combustible::enlazarGasto($id, $this->datos($request, self::GASTO), $request->user()));
    }

    public function candidatos(Request $request)
    {
        $f = $request->validate(['tipo' => ['required', Rule::in(array_keys(Gastos::TIPO_COSTO))], 'vehiculo' => ['required', 'uuid']]);

        return response()->json(['data' => Gastos::candidatos($f['tipo'], $f['vehiculo'], $request->user())]);
    }

    // FLO-06 Rendimiento
    public function rendimiento(Request $request)
    {
        $f = $this->filtros($request);

        return response()->json(Combustible::rendimientos($request->user(), $f['desde'] ?? null, $f['hasta'] ?? null));
    }

    // FLO-07 Planes y FLO-08 Órdenes
    public function planes(Request $request)
    {
        $f = $request->validate(['vehiculo' => ['nullable', 'uuid'], 'estado' => ['nullable', Rule::in(['OK', 'DUE_SOON', 'OVERDUE', 'OVERDUE_BLOCK', 'INACTIVE', 'ALERT'])]]);

        return response()->json(['data' => Mantenimiento::planes($request->user(), $f['vehiculo'] ?? null, $f['estado'] ?? null)]);
    }

    public function guardarPlan(Request $request, ?string $id = null)
    {
        $request->validate(['vehicle_id' => [$id ? 'nullable' : 'required', 'uuid'], 'task' => ['required', 'string', 'max:120'], 'interval_km' => ['nullable', 'numeric'],
            'interval_days' => ['nullable', 'integer'], 'last_done_km' => ['nullable', 'numeric'], 'last_done_on' => ['nullable', 'date_format:Y-m-d'],
            'status' => ['nullable', Rule::in(['ACTIVE', 'INACTIVE'])], 'notes' => ['nullable', 'string', 'max:1000']]);
        $p = Mantenimiento::guardarPlan($id, $this->datos($request, ['vehicle_id', 'task', 'interval_km', 'interval_days', 'last_done_km', 'last_done_on', 'status', 'notes']), $request->user());

        return response()->json($p, $id ? 200 : 201);
    }

    public function ordenes(Request $request)
    {
        $f = $request->validate(['vehiculo' => ['nullable', 'uuid'], 'estado' => ['nullable', Rule::in(['IN_PROGRESS', 'DONE', 'VOIDED'])], 'tipo' => ['nullable', Rule::in(['PREVENTIVE', 'CORRECTIVE'])]]);

        return response()->json(['data' => Mantenimiento::ordenes($request->user(), $f)]);
    }

    public function abrirOrden(Request $request)
    {
        $request->validate(['vehicle_id' => ['required', 'uuid'], 'kind' => ['required', Rule::in(['PREVENTIVE', 'CORRECTIVE'])], 'plan_id' => ['nullable', 'uuid'],
            'description' => ['nullable', 'string', 'max:2000'], 'workshop_supplier_id' => ['nullable', 'uuid'], 'workshop_name' => ['nullable', 'string', 'max:120'],
            'opened_on' => ['nullable', 'date_format:Y-m-d'], 'in_workshop' => ['nullable', 'boolean']]);

        return response()->json(Mantenimiento::abrir($this->datos($request, ['vehicle_id', 'kind', 'plan_id', 'description', 'workshop_supplier_id', 'workshop_name', 'opened_on', 'in_workshop']), $request->user()), 201);
    }

    public function cerrarOrden(Request $request, string $id)
    {
        $request->validate($this->reglasGasto() + ['done_on' => ['nullable', 'date_format:Y-m-d'], 'odometer_km' => ['required', 'numeric'], 'labor_amount' => ['nullable', 'numeric', 'min:0'],
            'days_out_of_service' => ['nullable', 'integer', 'min:0'], 'parts' => ['nullable', 'array', 'max:40'], 'parts.*.description' => ['nullable', 'string', 'max:120'],
            'parts.*.qty' => ['nullable', 'numeric'], 'parts.*.unit_cost' => ['nullable', 'numeric']]);
        $d = $this->datos($request, array_merge(self::GASTO, ['done_on', 'odometer_km', 'labor_amount', 'days_out_of_service', 'parts']));

        return response()->json(Mantenimiento::cerrar($id, $d, $this->archivo($request), $request->user()));
    }

    public function anularOrden(Request $request, string $id)
    {
        $request->validate(['reason' => ['required', 'string', 'max:500']]);

        return response()->json(Mantenimiento::anular($id, $request->input('reason'), $request->user()));
    }

    // FLO-09 Documentos
    public function documentos(Request $request)
    {
        $f = $request->validate(['tipo' => ['nullable', Rule::in(array_keys(Base::DOCUMENTOS))], 'estado' => ['nullable', Rule::in(['EXPIRED', 'D7', 'D15', 'D30', 'VALID', 'NO_EXPIRY', 'ALERT'])]]);

        return response()->json(Documentos::lista($request->user(), $f['tipo'] ?? null, $f['estado'] ?? null));
    }

    public function guardarDocumento(Request $request)
    {
        $request->validate(['doc_type' => ['required', Rule::in(array_keys(Base::DOCUMENTOS))], 'vehicle_id' => ['nullable', 'uuid'], 'employee_id' => ['nullable', 'uuid'],
            'number' => ['required', 'string', 'max:40'], 'issuer' => ['nullable', 'string', 'max:120'], 'license_class' => ['nullable', 'string', 'max:20'],
            'issued_on' => ['nullable', 'date_format:Y-m-d'], 'expires_on' => ['nullable', 'date_format:Y-m-d'], 'notes' => ['nullable', 'string', 'max:1000']]);
        $d = $this->datos($request, ['doc_type', 'vehicle_id', 'employee_id', 'number', 'issuer', 'license_class', 'issued_on', 'expires_on', 'notes']);

        return response()->json(Documentos::guardar($d, $this->archivo($request, 'archivo'), $request->user()), 201);
    }

    public function anularDocumento(Request $request, string $id)
    {
        $request->validate(['reason' => ['required', 'string', 'max:500']]);

        return response()->json(Documentos::anular($id, $request->input('reason'), $request->user()));
    }

    // FLO-10 Multas
    public function multas(Request $request)
    {
        $f = $request->validate(['estado' => ['nullable', Rule::in(array_keys(Multas::ESTADOS))], 'vehiculo' => ['nullable', 'uuid']]);

        return response()->json(Multas::lista($request->user(), $f));
    }

    public function registrarMulta(Request $request)
    {
        $request->validate(['ballot_number' => ['required', 'string', 'max:30'], 'fine_date' => ['required', 'date_format:Y-m-d'], 'entity' => ['required', Rule::in(array_keys(Base::ENTIDADES))],
            'infraction_code' => ['nullable', 'string', 'max:20'], 'infraction' => ['required', 'string', 'max:255'], 'vehicle_id' => ['required', 'uuid'],
            'driver_user_id' => ['nullable', 'uuid'], 'employee_id' => ['nullable', 'uuid'], 'amount' => ['required', 'numeric'], 'early_discount_pct' => ['nullable', 'numeric'],
            'early_discount_until' => ['nullable', 'date_format:Y-m-d'], 'notes' => ['nullable', 'string', 'max:1000']]);
        $d = $this->datos($request, ['ballot_number', 'fine_date', 'entity', 'infraction_code', 'infraction', 'vehicle_id', 'driver_user_id', 'employee_id', 'amount',
            'early_discount_pct', 'early_discount_until', 'notes']);

        return response()->json(Multas::registrar($d, $request->user()), 201);
    }

    public function pagarMulta(Request $request, string $id)
    {
        $request->validate($this->reglasGasto() + ['paid_on' => ['nullable', 'date_format:Y-m-d']]);

        return response()->json(Multas::pagar($id, $this->datos($request, array_merge(self::GASTO, ['paid_on'])), $request->user()));
    }

    public function descontarMulta(Request $request, string $id)
    {
        return response()->json(Multas::descontar($id, $this->archivo($request, 'acta'), $request->user()));
    }

    public function cambiarMulta(Request $request, string $id)
    {
        $d = $request->validate(['accion' => ['required', Rule::in(['apelar', 'reactivar', 'anular'])], 'note' => ['required', 'string', 'max:1000']]);

        return response()->json(Multas::cambiar($id, $d['accion'], $d['note'], $request->user()));
    }

    // FLO-11 Otros costos
    public function costos(Request $request)
    {
        return response()->json(Costos::lista($request->user(), $this->filtros($request, ['tipo' => ['nullable', Rule::in(array_keys(Base::COSTOS))], 'estado' => ['nullable', Rule::in(['ACTIVE', 'VOIDED', 'TODOS'])]])));
    }

    public function registrarCosto(Request $request)
    {
        $request->validate($this->reglasGasto() + ['vehicle_id' => ['required', 'uuid'], 'cost_type' => ['required', Rule::in(array_keys(Base::COSTOS))],
            'cost_date' => ['required', 'date_format:Y-m-d'], 'period' => ['nullable', 'date_format:Y-m'], 'amount' => ['required', 'numeric'], 'supplier_id' => ['nullable', 'uuid'],
            'notes' => ['nullable', 'string', 'max:1000']]);
        $d = $this->datos($request, array_merge(self::GASTO, ['vehicle_id', 'cost_type', 'cost_date', 'period', 'amount', 'supplier_id', 'notes']));

        return response()->json(Costos::registrar($d, $this->archivo($request), $request->user()), 201);
    }

    public function anularCosto(Request $request, string $id)
    {
        $request->validate(['reason' => ['required', 'string', 'max:500']]);

        return response()->json(Costos::anular($id, $request->input('reason'), $request->user()));
    }

    // FLO-12 Costo total y comparativo
    public function tablero(Request $request)
    {
        $f = $request->validate(['mes' => ['nullable', 'date_format:Y-m'], 'local' => ['nullable', 'uuid']]);

        return response()->json(Costos::tablero($request->user(), $f['mes'] ?? substr(Base::hoy(), 0, 7), $f['local'] ?? null));
    }

    public function exportar(Request $request)
    {
        $f = $request->validate(['mes' => ['nullable', 'date_format:Y-m'], 'local' => ['nullable', 'uuid']]);
        $t = Costos::tablero($request->user(), $f['mes'] ?? substr(Base::hoy(), 0, 7), $f['local'] ?? null);
        $filas = array_map(fn ($c) => [$c['vehiculo'], $c['modalidad'], $c['combustible'], $c['mantenimiento'], $c['multas'], $c['alquiler'], $c['peajes'], $c['seguros'],
            $c['otros'], $c['depreciacion'], $c['conductor'], $c['total'], $c['km'], $c['entregas'], $c['por_km'], $c['por_entrega']], $t['filas']);
        $cols = [['titulo' => 'Vehículo', 'ancho' => 22], ['titulo' => 'Modalidad', 'ancho' => 12]];
        foreach (['Combustible', 'Mantenimiento', 'Multas', 'Alquiler', 'Peajes y cochera', 'Seguros e impuestos', 'Otros', 'Depreciación', 'Conductor', 'Total'] as $n) {
            $cols[] = ['titulo' => $n, 'ancho' => 14, 'tipo' => 'soles'];
        }
        $cols[] = ['titulo' => 'Km reales', 'ancho' => 11, 'tipo' => 'numero'];
        $cols[] = ['titulo' => 'Entregas', 'ancho' => 10, 'tipo' => 'numero'];
        $cols[] = ['titulo' => 'S/ por km', 'ancho' => 11, 'tipo' => 'soles'];
        $cols[] = ['titulo' => 'S/ por entrega', 'ancho' => 13, 'tipo' => 'soles'];
        $tt = $t['totales'];

        return Exportar::libro('Costo total de la flota', $request->user())
            ->hoja('Costo por vehículo', columnas: $cols, filas: $filas, descripcion: 'RN-FLO-16 · mes '.substr($t['mes'], 0, 7),
                resumen: ['Total' => Base::soles($tt['total']), 'S/ por km' => $tt['por_km'] !== null ? Base::soles($tt['por_km']) : '—', 'S/ por entrega' => $tt['por_entrega'] !== null ? Base::soles($tt['por_entrega']) : '—'])
            ->descargar('costo-flota-'.substr($t['mes'], 0, 7));
    }
}
