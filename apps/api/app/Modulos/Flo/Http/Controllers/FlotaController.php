<?php

namespace App\Modulos\Flo\Http\Controllers;

use App\Modulos\Flo\Services\Alertas;
use App\Modulos\Flo\Services\Archivo;
use App\Modulos\Flo\Services\Consultas;
use App\Modulos\Flo\Services\Jornadas;
use App\Modulos\Flo\Services\Odometro;
use App\Modulos\Flo\Services\Temperatura;
use App\Modulos\Flo\Services\Vehiculos;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** FLO-01 Mapa en vivo, FLO-02 Recorrido, FLO-03 Jornadas, FLO-04 Ficha, FLO-13 Temperatura, FLO-14 Alertas y FLO-15 App. */
class FlotaController extends Controlador
{
    public function opciones(Request $request)
    {
        return response()->json(Consultas::opciones($request->user()));
    }

    /** Enlace temporal para ver una foto o documento de FLO (solo los que FLO guardó y el usuario puede ver). */
    public function enlace(Request $request, string $id)
    {
        $u = $request->user();
        $usado = DB::table('vehicle_trips')->where(fn ($w) => $w->where('start_photo_file_id', $id)->orWhere('end_photo_file_id', $id))->value('vehicle_id')
            ?? DB::table('fuel_loads')->where('photo_file_id', $id)->value('vehicle_id')
            ?? DB::table('vehicle_maintenances')->where('receipt_file_id', $id)->value('vehicle_id')
            ?? DB::table('vehicle_costs')->where('receipt_file_id', $id)->value('vehicle_id')
            ?? DB::table('traffic_fines')->where('acknowledgment_file_id', $id)->value('vehicle_id')
            ?? DB::table('vehicle_documents')->where('file_id', $id)->selectRaw("coalesce(vehicle_id::text, 'empleado') AS x")->value('x');
        if (! $usado) {
            abort(404, 'No se encontró el archivo.');
        }
        if ($usado !== 'empleado') {
            \App\Modulos\Flo\Services\Base::vehiculo($usado, $u);
        }

        return response()->json(Archivo::enlace($id, $u));
    }

    public function mapa(Request $request)
    {
        $f = $request->validate(['local' => ['nullable', 'uuid'], 'modalidad' => ['nullable', Rule::in(['OWN', 'RENTED'])], 'barrido' => ['nullable', 'boolean']]);
        if ($request->boolean('barrido')) {
            Alertas::barrido($request->user());
        }

        return response()->json(Consultas::mapa($request->user(), $f['local'] ?? null, $f['modalidad'] ?? null));
    }

    public function recorrido(Request $request, string $id)
    {
        $f = $request->validate(['fecha' => ['nullable', 'date_format:Y-m-d']]);

        return response()->json(Jornadas::recorrido($id, $f['fecha'] ?? \App\Modulos\Flo\Services\Base::hoy(), $request->user()));
    }

    public function jornadas(Request $request)
    {
        return response()->json(Jornadas::lista($request->user(), $this->filtros($request, ['estado' => ['nullable', Rule::in(['PLANNED', 'OPEN', 'CLOSED', 'CANCELLED'])]])));
    }

    public function vehiculos(Request $request)
    {
        return response()->json(['data' => Vehiculos::lista($request->user())]);
    }

    public function ficha(Request $request, string $id)
    {
        return response()->json(Vehiculos::ficha($id, $request->user()));
    }

    public function perfil(Request $request, string $id)
    {
        $request->validate([
            'internal_code' => ['nullable', 'string', 'max:20'], 'make' => ['nullable', 'string', 'max:60'], 'model' => ['nullable', 'string', 'max:80'],
            'year' => ['nullable', 'integer'], 'color' => ['nullable', 'string', 'max:30'], 'tank_capacity_gal' => ['nullable', 'numeric'], 'expected_km_per_gal' => ['nullable', 'numeric'],
            'temp_mode' => ['nullable', Rule::in(['CHILLED', 'FROZEN'])], 'temp_min_c' => ['nullable', 'numeric'], 'temp_max_c' => ['nullable', 'numeric'],
            'gps_source' => ['nullable', Rule::in(['APP_ANDROID', 'DEVICE'])], 'purchase_date' => ['nullable', 'date_format:Y-m-d'], 'purchase_cost' => ['nullable', 'numeric'],
            'residual_value' => ['nullable', 'numeric'], 'useful_life_months' => ['nullable', 'integer'],
        ]);

        return response()->json(Vehiculos::guardarPerfil($id, $request->all(), $request->user()));
    }

    public function programar(Request $request, string $id)
    {
        $request->validate(['date' => ['required', 'date_format:Y-m-d'], 'driver_user_id' => ['nullable', 'uuid'], 'route_id' => ['nullable', 'uuid']]);

        return response()->json(Vehiculos::programar($id, $request->only(['date', 'driver_user_id', 'route_id']), $request->user()));
    }

    public function rutasDelDia(Request $request, string $id)
    {
        $f = $request->validate(['fecha' => ['required', 'date_format:Y-m-d']]);
        $v = \App\Modulos\Flo\Services\Base::vehiculo($id, $request->user());

        return response()->json(['data' => DB::table('delivery_routes')->where('route_date', $f['fecha'])->where('establishment_id', $v->establishment_id)
            ->whereIn('status', ['PLANNED', 'LOADING'])->orderBy('code')->get(['id', 'code', 'mode', 'vehicle_id', 'driver_user_id'])->all()]);
    }

    public function cambioTablero(Request $request, string $id)
    {
        $request->validate(['km' => ['required', 'numeric', 'min:0'], 'reason' => ['required', 'string', 'max:500']]);

        return response()->json(Odometro::cambioTablero($id, $request->only(['km', 'reason']), $request->user()));
    }

    // FLO-15 App · Jornada
    public function app(Request $request)
    {
        $f = $request->validate(['conductor' => ['nullable', 'uuid']]);

        return response()->json(Jornadas::app($request->user(), $f['conductor'] ?? null));
    }

    public function iniciar(Request $request)
    {
        $request->validate(['vehicle_id' => ['required', 'uuid'], 'driver_user_id' => ['nullable', 'uuid'], 'odometer' => ['required', 'numeric'],
            'checklist' => ['nullable', 'array'], 'notes' => ['nullable', 'string', 'max:1000'], 'source' => ['nullable', Rule::in(['APP', 'WEB'])]]);

        return response()->json(Jornadas::iniciar($request->only(['vehicle_id', 'driver_user_id', 'odometer', 'checklist', 'notes', 'source']), $this->archivo($request), $request->user()), 201);
    }

    public function cerrar(Request $request, string $id)
    {
        $request->validate(['odometer' => ['required', 'numeric'], 'checklist' => ['nullable', 'array'], 'notes' => ['nullable', 'string', 'max:1000']]);

        return response()->json(Jornadas::cerrar($id, $request->only(['odometer', 'checklist', 'notes']), $this->archivo($request), $request->user()));
    }

    public function posiciones(Request $request)
    {
        $d = $request->validate(['posiciones' => ['required', 'array', 'min:1', 'max:500'], 'posiciones.*.vehicle_id' => ['required', 'uuid'],
            'posiciones.*.recorded_at' => ['required', 'string', 'max:40'], 'posiciones.*.lat' => ['required', 'numeric'], 'posiciones.*.lng' => ['required', 'numeric'],
            'posiciones.*.speed_kmh' => ['nullable', 'numeric'], 'posiciones.*.heading' => ['nullable', 'numeric'], 'posiciones.*.accuracy_m' => ['nullable', 'numeric']]);

        return response()->json(Jornadas::lote($d['posiciones'], $request->user()));
    }

    // FLO-13 Temperatura
    public function temperatura(Request $request)
    {
        $f = $request->validate(['vehiculo' => ['nullable', 'uuid'], 'fecha' => ['nullable', 'date_format:Y-m-d']]);

        return response()->json(Temperatura::vista($f['vehiculo'] ?? null, $f['fecha'] ?? null, $request->user()));
    }

    public function lectura(Request $request)
    {
        $request->validate(['vehicle_id' => ['required', 'uuid'], 'read_at' => ['required', 'string', 'max:40'], 'temp_c' => ['required', 'numeric'], 'source' => ['nullable', Rule::in(['SENSOR', 'MANUAL'])]]);
        $r = Temperatura::registrar($request->only(['vehicle_id', 'read_at', 'temp_c']), $request->user(), $request->input('source', 'MANUAL'));

        return response()->json(['lectura' => $r['lectura'], 'alerta' => $r['alerta'] ? Alertas::aFila($r['alerta']) : null], 201);
    }

    // FLO-14 Alertas
    public function alertas(Request $request)
    {
        $f = $request->validate(['estado' => ['nullable', Rule::in(['ABIERTAS', 'OPEN', 'ACK', 'CLOSED', 'TODAS'])], 'tipo' => ['nullable', Rule::in(array_keys(\App\Modulos\Flo\Services\Base::ALERTAS))],
            'vehiculo' => ['nullable', 'uuid'], 'barrido' => ['nullable', 'boolean']]);
        if ($request->boolean('barrido')) {
            Alertas::barrido($request->user());
        }

        return response()->json(Alertas::lista($request->user(), $f));
    }

    public function barrido(Request $request)
    {
        return response()->json(['abiertas' => Alertas::barrido($request->user())]);
    }

    public function atender(Request $request, string $id)
    {
        $request->validate(['note' => ['nullable', 'string', 'max:1000']]);

        return response()->json(Alertas::aFila(Alertas::atender($id, $request->input('note'), $request->user())));
    }

    public function cerrarAlerta(Request $request, string $id)
    {
        $request->validate(['resolution' => ['nullable', 'string', 'max:1000']]);

        return response()->json(Alertas::aFila(Alertas::cerrar($id, $request->input('resolution'), $request->user())));
    }

    public function revisarPedido(Request $request, string $id)
    {
        $d = $request->validate(['order_id' => ['required', 'uuid'], 'decision' => ['required', Rule::in(['RELEASED', 'REJECTED'])], 'note' => ['nullable', 'string', 'max:1000']]);

        return response()->json(Alertas::aFila(Alertas::revisarPedido($id, $d['order_id'], $d['decision'], $d['note'] ?? null, $request->user())));
    }
}
