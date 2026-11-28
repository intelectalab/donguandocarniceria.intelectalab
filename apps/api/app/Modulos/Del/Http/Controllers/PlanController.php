<?php

namespace App\Modulos\Del\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Del\Services\Base;
use App\Modulos\Del\Services\Consultas;
use App\Modulos\Del\Services\Rutas;
use App\Modulos\Del\Services\Seguimiento;
use App\Support\Access;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** DEL-01 Planificador, DEL-02 Asignación y DEL-03 Hoja de ruta: armar, ordenar, asignar, cargar, salir y volver. */
class PlanController extends Controller
{
    use Entrada;

    /** Las abre quien tiene el módulo o una pantalla de DEL por permiso (costos, conciliación: administración y contadora). */
    public function opciones(Request $request)
    {
        $u = $request->user();
        $perms = ['del.cost.view', 'del.cost.manage', 'del.carrier.manage', 'del.carrier_invoice.reconcile', 'del.vehicle.manage', 'del.province.manage'];
        if (! Access::module($u, 'DEL') && ! collect($perms)->contains(fn ($p) => Access::can($u, $p))) {
            abort(403, 'No tienes acceso a Reparto.');
        }

        return response()->json(Consultas::opciones($this->fecha($request), $request->user()));
    }

    public function planificador(Request $request)
    {
        $d = $request->validate(['fecha' => ['nullable', 'date_format:Y-m-d'], 'establishment_id' => ['nullable', 'uuid']]);

        return response()->json(Consultas::planificador($d['fecha'] ?? Base::hoy(), $d['establishment_id'] ?? null, $request->user()));
    }

    public function rutas(Request $request)
    {
        $d = $request->validate(['fecha' => ['nullable', 'date_format:Y-m-d'], 'establishment_id' => ['nullable', 'uuid'], 'canceladas' => ['nullable', 'boolean']]);

        return response()->json(['data' => Consultas::rutas($d['fecha'] ?? Base::hoy(), $d['establishment_id'] ?? null, $request->user(), (bool) ($d['canceladas'] ?? false))]);
    }

    public function show(Request $request, string $id)
    {
        return response()->json(Consultas::hoja($id, $request->user()));
    }

    public function store(Request $request)
    {
        $d = $request->validate([
            'route_date' => ['required', 'date_format:Y-m-d'], 'establishment_id' => ['required', 'uuid'], 'slot_id' => ['nullable', 'uuid'],
            'mode' => ['nullable', Rule::in(array_keys(Base::MODOS))], 'code' => ['nullable', 'string', 'max:40'],
            'order_ids' => ['nullable', 'array', 'max:80'], 'order_ids.*' => ['uuid'],
        ]);
        if ($d['route_date'] < Base::hoy()) {
            RuleError::fail('RN-DEL-02', 'Las rutas se arman para hoy o días siguientes.');
        }
        $r = Rutas::crear($d, $request->user());

        return response()->json(Consultas::hoja($r->id, $request->user()), 201);
    }

    public function agregar(Request $request, string $id)
    {
        $d = $request->validate(['order_ids' => ['required', 'array', 'min:1', 'max:80'], 'order_ids.*' => ['uuid']]);
        $u = $request->user();
        Base::rutaVisible($id, $u);
        DB::transaction(function () use ($d, $id, $u) {
            foreach (array_unique($d['order_ids']) as $oid) {
                Rutas::agregar($id, $oid, $u);
            }
        });

        return response()->json(Consultas::hoja($id, $u));
    }

    public function quitar(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['nullable', 'string', 'max:255']]);
        $s = Rutas::parada($id);
        Base::rutaVisible($s->route_id, $request->user());
        Rutas::quitar($id, $d['reason'] ?? null, $request->user());

        return response()->json(Consultas::hoja($s->route_id, $request->user()));
    }

    public function mover(Request $request, string $id)
    {
        $d = $request->validate(['route_id' => ['required', 'uuid']]);
        $s = Rutas::parada($id);
        Base::rutaVisible($s->route_id, $request->user());
        Rutas::mover($id, $d['route_id'], $request->user());

        return response()->json(['ok' => true]);
    }

    public function ordenar(Request $request, string $id)
    {
        $d = $request->validate(['stop_ids' => ['nullable', 'array', 'max:80'], 'stop_ids.*' => ['uuid']]);
        $u = $request->user();
        DB::transaction(function () use ($id, $d, $u) {
            $r = Base::rutaVisible($id, $u, true);
            if (! in_array($r->status, ['PLANNED', 'LOADING'], true)) {
                RuleError::fail('RN-DEL-02', "La ruta {$r->code} está ".Base::ruta($r->status).': ya no se reordena.');
            }
            Rutas::ordenar($id, ! empty($d['stop_ids']) ? $d['stop_ids'] : null);
        });

        return response()->json(Consultas::hoja($id, $u));
    }

    public function asignar(Request $request, string $id)
    {
        $d = $request->validate([
            'mode' => ['required', Rule::in(array_keys(Base::MODOS))], 'vehicle_id' => ['nullable', 'uuid'], 'driver_user_id' => ['nullable', 'uuid'],
            'carrier_supplier_id' => ['nullable', 'uuid'], 'driver_pay_mode' => ['nullable', Rule::in(['DAILY', 'PER_DELIVERY'])],
            'driver_pay_rate' => ['nullable', 'numeric', 'min:0', 'max:9999'],
        ]);
        $x = Rutas::asignar($id, $d, $request->user());

        return response()->json(['warnings' => $x['warnings']] + Consultas::hoja($id, $request->user()));
    }

    public function cancelar(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:255']]);
        Rutas::cancelar($id, $d['reason'], $request->user());

        return response()->json(['ok' => true]);
    }

    public function cargar(Request $request, string $id)
    {
        $d = $request->validate(['code' => ['required', 'string', 'max:80']]);
        $res = Rutas::cargar($id, $d['code'], $request->user());

        return response()->json($res + Consultas::hoja($id, $request->user()));
    }

    public function salir(Request $request, string $id)
    {
        $d = $request->validate(['odometer' => ['nullable', 'numeric', 'min:0', 'max:9999999']]);
        Rutas::salir($id, isset($d['odometer']) ? (float) $d['odometer'] : null, $request->user());

        return response()->json(Consultas::hoja($id, $request->user()));
    }

    public function volver(Request $request, string $id)
    {
        $d = $request->validate(['odometer' => ['nullable', 'numeric', 'min:0', 'max:9999999']]);
        Rutas::volver($id, isset($d['odometer']) ? (float) $d['odometer'] : null, $request->user());

        return response()->json(Consultas::hoja($id, $request->user()));
    }

    /**
     * Aviso «va en camino» por WhatsApp desde el número de la empresa, con el enlace de seguimiento y el código
     * de entrega (RN-DEL-04). Mientras CRM no envíe la plantilla, la coordinación lo manda con este enlace.
     */
    public function aviso(Request $request, string $id)
    {
        $d = $request->validate(['origin' => ['required', 'url', 'max:200']]);
        $s = Rutas::parada($id);
        $r = Base::rutaVisible($s->route_id, $request->user());
        if ($r->status !== 'IN_ROUTE' || ! in_array($s->status, Base::ABIERTAS, true)) {
            RuleError::fail('RN-DEL-04', 'El aviso «va en camino» se envía con la ruta en ruta y la parada pendiente.');
        }
        $o = DB::table('sales_orders')->where('id', $s->order_id)->first();
        $tel = preg_replace('/\D/', '', (string) ($o->contact_phone ?: DB::table('customers')->where('id', $o->customer_id)->value('phone')));
        if ($tel === '') {
            RuleError::fail('RN-DEL-04', 'El pedido no tiene teléfono de contacto.');
        }
        $t = Seguimiento::enlace($o->id);
        $url = rtrim($d['origin'], '/').'/s/'.$t->token;
        $nombre = Base::primerNombre(Base::cliente($o->customer_id));
        $marca = DB::table('brands')->where('id', $o->brand_id)->value('name');
        $texto = "Hola {$nombre}, tu pedido {$o->number} de {$marca} va en camino. Síguelo aquí: {$url} . Al recibirlo, da al repartidor el código {$s->delivery_code}.";
        Base::evento(['route_id' => $r->id, 'stop_id' => $s->id, 'event_type' => 'WHATSAPP', 'notes' => 'Aviso «va en camino» enviado por la coordinación'], $request->user());
        $intl = strlen($tel) === 9 ? '51'.$tel : $tel;

        return response()->json(['url' => "https://wa.me/{$intl}?text=".rawurlencode($texto), 'tracking_url' => $url]);
    }
}
