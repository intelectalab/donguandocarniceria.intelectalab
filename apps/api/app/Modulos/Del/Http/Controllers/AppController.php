<?php

namespace App\Modulos\Del\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Del\Services\App;
use App\Modulos\Del\Services\Base;
use App\Modulos\Del\Services\Consultas;
use App\Modulos\Del\Services\Extras;
use App\Modulos\Del\Services\Liquidaciones;
use App\Modulos\Del\Services\Rutas;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * App del repartidor: DEL-04 Mis rutas, DEL-05 Parada (llegué, cobro, entrega, no entregado, incidencia),
 * DEL-17 Gastos, DEL-18 Ticket, DEL-21 Mensajes, apoyo y derivación. Cada acción trae client_event_id.
 */
class AppController extends Controller
{
    use Entrada;

    private const EVENTO = ['client_event_id' => ['nullable', 'string', 'max:80'], 'lat' => ['nullable', 'numeric', 'between:-90,90'],
        'lng' => ['nullable', 'numeric', 'between:-180,180'], 'device_id' => ['nullable', 'string', 'max:80'], 'occurred_at' => ['nullable', 'date']];

    public function rutas(Request $request)
    {
        return response()->json(['data' => Consultas::misRutas($this->fecha($request), $request->user())]);
    }

    public function ruta(Request $request, string $id)
    {
        $h = Consultas::hoja($id, $request->user());
        $h['liquidacion_esperada'] = in_array($h['ruta']['status'], ['IN_ROUTE', 'RETURNED', 'SETTLED'], true) ? Liquidaciones::esperado($id) : null;

        return response()->json($h);
    }

    public function llegar(Request $request, string $id)
    {
        return response()->json(App::llegar($id, $request->validate(self::EVENTO), $request->user()));
    }

    public function cobrar(Request $request, string $id)
    {
        $d = $request->validate(self::EVENTO + ['method' => ['required', Rule::in(array_keys(Base::MEDIOS_COBRO))], 'amount' => ['required', 'numeric', 'min:0'],
            'reference' => ['nullable', 'string', 'max:60'], 'card_last4' => ['nullable', 'digits:4']]);
        if (in_array($d['method'], ['YAPE', 'PLIN'], true) && trim((string) ($d['reference'] ?? '')) === '') {
            RuleError::fail('RN-DEL-09', 'Con Yape o Plin escribe el número de operación.');
        }

        return response()->json(App::cobrar($id, $d, $request->user()));
    }

    public function entregar(Request $request, string $id)
    {
        $d = $request->validate(self::EVENTO + ['code' => ['nullable', 'string', 'max:10'], 'receiver' => ['nullable', 'string', 'max:120'],
            'photo' => ['nullable', 'file', 'max:8192'], 'photo_data' => ['nullable', 'string', 'max:12000000'],
            'signature' => ['nullable', 'file', 'max:4096'], 'signature_data' => ['nullable', 'string', 'max:4000000']]);

        return response()->json(App::entregar($id, $d, $this->imagen($request, 'photo'), $this->imagen($request, 'signature'), $request->user()));
    }

    public function noEntregar(Request $request, string $id)
    {
        $d = $request->validate(self::EVENTO + ['reason' => ['required', Rule::in(array_keys(Base::MOTIVOS))], 'notes' => ['nullable', 'string', 'max:500'],
            'photo' => ['nullable', 'file', 'max:8192'], 'photo_data' => ['nullable', 'string', 'max:12000000']]);

        return response()->json(App::noEntregar($id, $d, $this->imagen($request, 'photo'), $request->user()));
    }

    public function incidencia(Request $request, string $id)
    {
        $d = $request->validate(self::EVENTO + ['type' => ['required', Rule::in(array_keys(Base::INCIDENCIAS))], 'notes' => ['nullable', 'string', 'max:500']]);

        return response()->json(App::incidencia($id, $d, $request->user()));
    }

    public function contacto(Request $request, string $id)
    {
        $d = $request->validate(['via' => ['required', Rule::in(['CALL', 'WHATSAPP'])]]);

        return response()->json(App::contacto($id, $d['via'], $request->user()));
    }

    public function posicion(Request $request, string $id)
    {
        $d = $request->validate(self::EVENTO + ['lat' => ['required', 'numeric', 'between:-90,90'], 'lng' => ['required', 'numeric', 'between:-180,180']]);

        return response()->json(App::posicion($id, $d, $request->user()));
    }

    /** Cola sin conexión: cada evento se aplica por separado y responde su resultado (CA-DEL-09). */
    public function sincronizar(Request $request)
    {
        $d = $request->validate(['events' => ['required', 'array', 'min:1', 'max:50'], 'events.*.client_event_id' => ['required', 'string', 'max:80'],
            'events.*.type' => ['required', 'string', 'max:20'], 'events.*.stop_id' => ['nullable', 'uuid'], 'events.*.route_id' => ['nullable', 'uuid'],
            'events.*.payload' => ['nullable', 'array']]);
        $out = [];
        foreach ($d['events'] as $e) {
            try {
                $r = App::sincronizar($e, $request->user());
                $out[] = ['client_event_id' => $e['client_event_id'], 'ok' => true, 'duplicate' => (bool) ($r['duplicate'] ?? false)];
            } catch (RuleError $x) {
                $out[] = ['client_event_id' => $e['client_event_id'], 'ok' => false, 'code' => $x->rule ?? null, 'message' => $x->getMessage()];
            } catch (HttpException $x) {
                $out[] = ['client_event_id' => $e['client_event_id'], 'ok' => false, 'code' => (string) $x->getStatusCode(), 'message' => $x->getMessage() ?: 'No encontrado.'];
            }
        }

        return response()->json(['results' => $out]);
    }

    /* ---------- DEL-18 Ticket ---------- */

    public function ticket(Request $request, string $id)
    {
        $s = Rutas::parada($id);
        Base::rutaVisible($s->route_id, $request->user());
        $o = DB::table('sales_orders')->where('id', $s->order_id)->first();

        $tel = preg_replace('/\D/', '', (string) ($o->contact_phone ?: DB::table('customers')->where('id', $o->customer_id)->value('phone')));

        return response()->json(Extras::ticket($o) + ['stop_id' => $s->id, 'route_id' => $s->route_id, 'seq' => $s->seq, 'status' => $s->status,
            'telefono' => $tel !== '' ? (strlen($tel) === 9 ? '51'.$tel : $tel) : null]);
    }

    public function ticketEntregado(Request $request, string $id)
    {
        $d = $request->validate(['via' => ['required', Rule::in(['SHOWN', 'WHATSAPP'])], 'client_event_id' => ['nullable', 'string', 'max:80']]);

        return response()->json(Extras::ticketEntregado($id, $d['via'], $d['client_event_id'] ?? null, $request->user()));
    }

    /* ---------- DEL-17 Gastos de la ruta ---------- */

    public function gastos(Request $request, string $id)
    {
        Base::rutaVisible($id, $request->user());
        $g = DB::table('driver_expenses')->where('route_id', $id)->orderByDesc('created_at')->get();

        return response()->json(['data' => $g->map(fn ($x) => (array) $x + ['categoria' => Extras::GASTOS[$x->category][0] ?? $x->category,
            'pagado' => Extras::PAGADO_CON[$x->paid_with] ?? $x->paid_with]), 'liquidacion' => Liquidaciones::esperado($id)]);
    }

    public function gasto(Request $request, string $id)
    {
        $d = $request->validate(['client_event_id' => ['nullable', 'string', 'max:80'], 'category' => ['required', Rule::in(array_keys(Extras::GASTOS))],
            'amount' => ['required', 'numeric', 'min:0', 'max:5000'], 'paid_with' => ['required', Rule::in(array_keys(Extras::PAGADO_CON))],
            'note' => ['nullable', 'string', 'max:255'], 'fuel_gallons' => ['nullable', 'numeric', 'min:0', 'max:200'], 'voucher_no' => ['nullable', 'string', 'max:40'],
            'photo' => ['nullable', 'file', 'max:8192'], 'photo_data' => ['nullable', 'string', 'max:12000000']]);

        return response()->json(Extras::gasto($id, $d, $this->imagen($request, 'photo'), $request->user()), 201);
    }

    /* ---------- DEL-21 Mensajes a control ---------- */

    public function mensajes(Request $request, string $id)
    {
        Base::rutaVisible($id, $request->user());
        $m = DB::table('driver_messages as m')->leftJoin('delivery_stops as s', 's.id', '=', 'm.stop_id')->leftJoin('users as a', 'a.id', '=', 'm.ack_by')
            ->where('m.route_id', $id)->orderByDesc('m.created_at')->limit(100)->get(['m.*', 's.seq', 'a.name as atendido_por']);

        return response()->json(['data' => $m]);
    }

    public function mensaje(Request $request, string $id)
    {
        $d = $request->validate(['client_event_id' => ['nullable', 'string', 'max:80'], 'kind' => ['required', Rule::in(['TEXT', 'AUDIO', 'CAPTURE'])],
            'text' => ['nullable', 'string', 'max:2000'], 'stop_id' => ['nullable', 'uuid'], 'amount' => ['nullable', 'numeric', 'min:0'],
            'to_role' => ['nullable', Rule::in(array_keys(Extras::DESTINOS))], 'audio_sec' => ['nullable', 'integer', 'min:1', 'max:300'],
            'audio' => ['nullable', 'file', 'max:6144'], 'photo' => ['nullable', 'file', 'max:8192'], 'photo_data' => ['nullable', 'string', 'max:12000000']]);

        return response()->json(Extras::mensaje($id, $d, $this->imagen($request, 'photo'), $request->file('audio'), $request->user()), 201);
    }

    /* ---------- DEL-20 Apoyo y derivación (desde la app) ---------- */

    public function apoyo(Request $request, string $id)
    {
        $d = $request->validate(['client_event_id' => ['nullable', 'string', 'max:80'], 'stop_ids' => ['required', 'array', 'min:1', 'max:40'], 'stop_ids.*' => ['uuid'],
            'reason' => ['required', 'string', 'min:3', 'max:255'], 'late_min' => ['nullable', 'integer', 'min:0', 'max:600']]);

        return response()->json(Extras::pedirApoyo($id, $d, $request->user()), 201);
    }

    public function derivar(Request $request, string $id)
    {
        $d = $request->validate(['client_event_id' => ['nullable', 'string', 'max:80'], 'courier_name' => ['required', 'string', 'max:120'],
            'courier_phone' => ['nullable', 'string', 'max:20'], 'plate' => ['required', 'string', 'max:12'], 'shipping_cost' => ['required', 'numeric', 'min:0', 'max:500'],
            'paid_with' => ['nullable', Rule::in(array_keys(Extras::PAGADO_CON))], 'note' => ['nullable', 'string', 'max:255'],
            'photo_courier' => ['nullable', 'file', 'max:8192'], 'photo_plate' => ['nullable', 'file', 'max:8192'], 'photo_product' => ['nullable', 'file', 'max:8192'],
            'photo_courier_data' => ['nullable', 'string'], 'photo_plate_data' => ['nullable', 'string'], 'photo_product_data' => ['nullable', 'string']]);
        $fotos = ['courier' => $this->imagen($request, 'photo_courier'), 'plate' => $this->imagen($request, 'photo_plate'), 'product' => $this->imagen($request, 'photo_product')];

        return response()->json(Extras::derivar($id, $d, $fotos, $request->user()), 201);
    }
}
