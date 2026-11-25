<?php

namespace App\Modulos\Tel\Services;

use App\Models\User;
use App\Modulos\Int\Services\Simulador;
use App\Support\Access;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Las llamadas (RN-TEL-04 a 08): TEL-06 Teléfono en la app y TEL-07 Llamar desde la ficha o el pedido.
 *
 * Una llamada entrante llega a un número de la central, el cliente marca la opción del menú y suena el grupo de la marca
 * en su orden. Al sonar se busca al cliente por su celular; si no existe, se crea un lead con origen teléfono. Atendida,
 * se graba solo si se reprodujo el aviso. Perdida, sin respuesta o al buzón, deja una tarea de devolver la llamada que se
 * cierra sola si el mismo número vuelve a llamar y lo atienden. Fuera del horario del menú pasa lo que el menú diga.
 *
 * El «Llamar» sale con el número de la marca del cliente o del pedido: el cliente nunca ve el celular de la vendedora.
 * Todo pasa por el proveedor de telefonía (RN-TEL-03): mientras no esté contratado, en el entorno de prueba se usa el
 * adaptador falso y el simulador; en producción, sin proveedor no se cursan llamadas.
 */
class Llamadas
{
    public const ESTADOS = ['RINGING' => 'Sonando', 'IN_PROGRESS' => 'En curso', 'COMPLETED' => 'Atendida', 'MISSED' => 'Perdida', 'VOICEMAIL' => 'Buzón',
        'FAILED' => 'Fallida', 'BUSY' => 'Ocupado', 'NO_ANSWER' => 'Sin respuesta'];

    /** Las que dejan tarea de devolver (RN-TEL-07). */
    public const PERDIDAS = ['MISSED', 'NO_ANSWER', 'VOICEMAIL'];

    public const FINALES = ['COMPLETED', 'MISSED', 'VOICEMAIL', 'FAILED', 'BUSY', 'NO_ANSWER'];

    private static function ajustes(): object
    {
        $s = DB::table('tel_settings')->first();
        if (! $s || $s->stage !== 'LIVE') {
            RuleError::fail('RN-TEL-02', 'Telefonía está en configuración: se prepara todo, pero todavía no se cursan llamadas. Pásala a en vivo en la Lista de activación.');
        }

        return $s;
    }

    /** Con el proveedor real sin instalar, solo el adaptador de prueba (y fuera de producción) cursa llamadas. */
    private static function proveedorListo(object $s): void
    {
        $prueba = $s->provider === 'FAKE' || ($s->connector_id && DB::table('integration_connectors')->where('id', $s->connector_id)
            ->where(fn ($w) => $w->where('environment', 'SANDBOX')->orWhere('adapter', 'FAKE'))->exists());
        if (! $prueba || ! Simulador::disponible()) {
            RuleError::fail('RN-TEL-03', 'El proveedor de telefonía todavía no está conectado: falta contratarlo e instalar su adaptador.');
        }
    }

    private static function tarifas(object $s): array
    {
        return array_merge(Ajustes::TARIFAS, (array) json_decode((string) $s->rates, true));
    }

    /** USD de la llamada: minutos redondeados hacia arriba por la tarifa, más la grabación (CA-TEL-07). */
    public static function costo(object $s, string $direccion, string $destino, int $segundos, bool $grabada): float
    {
        $r = self::tarifas($s);
        $min = (int) ceil($segundos / 60);
        $voz = $direccion === 'OUTBOUND' ? (str_starts_with($destino, '+519') ? $r['out_mobile'] : $r['out_landline']) : $r['inbound'];

        return round($min * $voz + ($grabada ? $min * $r['recording'] : 0), 4);
    }

    /** ¿Quién llama? Cliente por su celular; si no, un lead abierto con ese número. */
    public static function quien(string $numero): array
    {
        $c = DB::table('customers')->where('phone', $numero)->where('status', '<>', 'INACTIVE')->whereNull('merged_into_id')->first(['id', 'full_name', 'trade_name']);
        if ($c) {
            return ['customer' => $c];
        }
        $l = DB::table('leads')->where('phone', $numero)->whereNotIn('status', ['WON', 'LOST', 'DISCARDED'])->orderByDesc('first_contact_at')->first(['id', 'full_name', 'brand_id']);

        return $l ? ['lead' => $l] : [];
    }

    /** El orden de timbre del grupo: las activas con usuario activo, por prioridad. */
    private static function quienesSuenan(?string $grupo): array
    {
        if (! $grupo) {
            return [];
        }

        return DB::table('tel_ring_members as m')->join('users as x', 'x.id', '=', 'm.user_id')->where('m.group_id', $grupo)->where('m.active', true)
            ->where('x.status', 'ACTIVE')->orderBy('m.priority')->pluck('m.user_id')->all();
    }

    /** ¿Dentro del horario del menú? (hora de Lima; feriados no se manejan aquí todavía). */
    public static function enHorario(?object $menu, Carbon $cuando): bool
    {
        if (! $menu) {
            return true;
        }
        $h = json_decode((string) $menu->business_hours, true) ?: [];
        $l = $cuando->copy()->setTimezone('America/Lima');
        $rango = $l->isSunday() ? ($h['sun'] ?? null) : ($h['mon_sat'] ?? null);
        if (! $rango) {
            return false;
        }
        $hora = $l->format('H:i');

        return $hora >= $rango[0] && $hora < $rango[1];
    }

    /**
     * Llamada entrante (la avisa el proveedor; en prueba, el simulador). $d: from, number_id?, option?, resultado
     * (COMPLETED, MISSED, NO_ANSWER, VOICEMAIL, BUSY), segundos?, espera?, user_id? (quien contesta), cuando?.
     */
    public static function entrante(array $d): array
    {
        $s = self::ajustes();
        $desde = Central::e164($d['from']);
        if (! preg_match('/^\+\d{8,15}$/', $desde)) {
            RuleError::fail('RN-TEL-08', 'El número de quien llama no es válido.');
        }
        $cuando = isset($d['cuando']) ? Carbon::parse($d['cuando']) : now();
        $num = ! empty($d['number_id']) ? DB::table('tel_numbers')->where('id', $d['number_id'])->where('status', 'ACTIVE')->first()
            : DB::table('tel_numbers')->where('status', 'ACTIVE')->orderByRaw('brand_id IS NOT NULL')->orderBy('created_at')->first();
        if (! $num) {
            RuleError::fail('RN-TEL-03', 'No hay números de la central activos (Números y desvíos).');
        }
        $menu = $num->menu_id ? DB::table('tel_menus')->where('id', $num->menu_id)->first() : null;
        $opcion = null;
        if ($menu && ! empty($d['option'])) {
            $opcion = collect(json_decode((string) $menu->options, true) ?: [])->firstWhere('digit', (int) $d['option']);
        }
        $quien = self::quien($desde);
        $marca = $opcion['brand_id'] ?? $num->brand_id ?? ($quien['lead']->brand_id ?? null)
            ?? DB::table('brands')->where('status', 'ACTIVE')->orderBy('name')->value('id');
        $grupo = $opcion['ring_group_id'] ?? $num->ring_group_id ?? DB::table('tel_ring_groups')->where('brand_id', $marca)->value('id');
        $suenan = ! empty($opcion['direct_user_id']) ? [$opcion['direct_user_id']] : self::quienesSuenan($grupo);
        $resultado = $d['resultado'];
        // Fuera de horario: lo que diga el menú (RN-TEL-07).
        $fuera = ! self::enHorario($menu, $cuando);
        if ($fuera) {
            $accion = $menu->after_hours_action ?? 'CALLBACK_TASK';
            if ($accion === 'FORWARD') {
                $sup = DB::table('users as x')->join('user_roles as ur', 'ur.user_id', '=', 'x.id')->join('roles as r', 'r.id', '=', 'ur.role_id')
                    ->where('r.code', 'SUPERVISORA_VENTAS')->where('x.status', 'ACTIVE')->orderBy('x.name')->value('x.id');
                $suenan = $sup ? [$sup] : [];
            } else {
                $resultado = $accion === 'VOICEMAIL' ? 'VOICEMAIL' : 'MISSED';
            }
        }
        $atiende = $resultado === 'COMPLETED' ? ($d['user_id'] ?? ($suenan[0] ?? null)) : ($suenan[0] ?? null);
        $timbre = (int) (DB::table('tel_ring_groups')->where('id', $grupo)->value('ring_timeout_s') ?? $s->ring_timeout_s ?? 25);
        $espera = (int) ($d['espera'] ?? ($resultado === 'COMPLETED' ? 12 : max(1, count($suenan)) * $timbre));
        $segundos = $resultado === 'COMPLETED' ? (int) ($d['segundos'] ?? 120) : 0;
        $aviso = (bool) $s->recording_enabled && $resultado === 'COMPLETED';

        return DB::transaction(function () use ($s, $desde, $cuando, $num, $opcion, $quien, $marca, $resultado, $atiende, $espera, $segundos, $aviso, $fuera, $d) {
            $lead = $quien['lead'] ?? null;
            $nuevoLead = false;
            if (empty($quien['customer']) && ! $lead) {
                // RN-TEL-08: un número desconocido es un lead con origen teléfono (RN-CRM-10).
                $id = DB::table('leads')->insertGetId(['brand_id' => $marca, 'channel_id' => null, 'full_name' => 'Llamada de '.$desde, 'phone' => $desde, 'source' => 'PHONE',
                    'status' => 'NEW', 'first_contact_at' => $cuando, 'notes' => 'Lead creado al sonar una llamada.', 'created_at' => now(), 'updated_at' => now()], 'id');
                $lead = (object) ['id' => $id, 'full_name' => 'Llamada de '.$desde, 'brand_id' => $marca];
                $nuevoLead = true;
                Events::emit('lead.created', 'leads', $id, ['source' => 'PHONE', 'by' => 'TEL']);
            }
            $atendida = $resultado === 'COMPLETED';
            $id = DB::table('tel_calls')->insertGetId([
                'provider_call_id' => 'FAKE-'.bin2hex(random_bytes(8)), 'preview' => false, 'number_id' => $num->id, 'direction' => 'INBOUND', 'from_e164' => $desde, 'to_e164' => $num->e164,
                'brand_id' => $marca, 'customer_id' => $quien['customer']->id ?? null, 'lead_id' => $lead->id ?? null, 'lead_phone' => $nuevoLead ? $desde : null,
                'order_id' => $d['order_id'] ?? null, 'user_id' => $atiende, 'status' => $resultado, 'notice_played' => $aviso, 'started_at' => $cuando,
                'answered_at' => $atendida ? $cuando->copy()->addSeconds($espera) : null, 'ended_at' => $cuando->copy()->addSeconds($espera + $segundos),
                'wait_seconds' => $espera, 'duration_seconds' => $segundos, 'cost_usd' => self::costo($s, 'INBOUND', $desde, $segundos, $aviso),
                'menu_option' => isset($d['option']) ? (int) $d['option'] : null, 'created_at' => now(), 'updated_at' => now(),
            ], 'id');
            $tarea = null;
            if ($atendida) {
                self::grabar($id, $s, $cuando, $segundos, $aviso);
                self::cerrarDevoluciones($desde, $id);
                Events::emit('call.completed', 'tel_calls', $id, ['user' => $atiende, 'customer' => $quien['customer']->id ?? null]);
            } elseif (in_array($resultado, self::PERDIDAS, true)) {
                $tarea = self::tareaDeDevolver($id, $s, $cuando, $marca, $quien['customer']->id ?? null, $lead->id ?? null, $atiende, $desde, $fuera);
                Events::emit('call.missed', 'tel_calls', $id, ['from' => $desde]);
            }

            return ['id' => $id, 'estado' => $resultado, 'estado_name' => self::ESTADOS[$resultado], 'fuera_de_horario' => $fuera, 'tarea' => $tarea, 'nuevo_lead' => $nuevoLead];
        });
    }

    /** RN-TEL-04: con grabación y aviso, la grabación queda guardada hasta su retención; sin aviso, no. */
    private static function grabar(string $llamada, object $s, Carbon $cuando, int $segundos, bool $aviso): void
    {
        if (! $s->recording_enabled || ! $aviso || $segundos <= 0) {
            return;
        }
        $dias = (int) (Params::get('tel_retention_days') ?? $s->retention_days ?? 180);
        DB::table('tel_recordings')->insert(['call_id' => $llamada, 'file_id' => null, 'duration_seconds' => $segundos, 'provider_recording_id' => 'FAKE-RE-'.bin2hex(random_bytes(6)),
            'retention_until' => $cuando->copy()->setTimezone('America/Lima')->startOfDay()->addDays($dias)->toDateString(), 'legal_hold' => false, 'status' => 'AVAILABLE',
            'preview' => false, 'created_at' => now(), 'updated_at' => now()]);
    }

    /** RN-TEL-07: una tarea de devolver por llamada perdida, que vence a los minutos del parámetro. */
    private static function tareaDeDevolver(string $llamada, object $s, Carbon $cuando, string $marca, ?string $cliente, ?string $lead, ?string $quien, string $numero, bool $fuera): array
    {
        $min = (int) (Params::get('tel_callback_due_minutes') ?? $s->callback_due_minutes ?? 30);
        $vence = $cuando->copy()->addMinutes($min);
        $id = DB::table('crm_tasks')->insertGetId(['task_type' => 'CALLBACK', 'status' => 'OPEN', 'customer_id' => $cliente, 'lead_id' => $lead, 'brand_id' => $marca,
            'assigned_user_id' => $quien, 'due_at' => $vence, 'call_id' => $llamada,
            'note' => mb_substr('Llamada perdida de '.$numero.($fuera ? ' (fuera de horario)' : ''), 0, 255), 'created_at' => now(), 'updated_at' => now()], 'id');
        if ($quien) {
            DB::table('notifications')->insert(['user_id' => $quien, 'module' => 'TEL', 'tone' => 'warn', 'severity' => 'WARNING', 'type' => 'ORDERS', 'at' => now(),
                'title' => 'Devolver una llamada perdida', 'body' => "{$numero} · vence a las ".$vence->copy()->setTimezone('America/Lima')->format('H:i'),
                'ref' => json_encode(['href' => '/m/crm/crm-17'])]);
        }

        return ['id' => $id, 'vence' => $vence->toIso8601String()];
    }

    /** RN-TEL-07: si el número vuelve a llamar y lo atienden, sus tareas de devolver se cierran solas. */
    private static function cerrarDevoluciones(string $numero, string $llamada): int
    {
        $ids = DB::table('crm_tasks as t')->join('tel_calls as c', 'c.id', '=', 't.call_id')->where('t.task_type', 'CALLBACK')->where('t.status', 'OPEN')
            ->where('c.from_e164', $numero)->where('c.id', '<>', $llamada)->pluck('t.id')->all();
        if ($ids) {
            DB::table('crm_tasks')->whereIn('id', $ids)->update(['status' => 'DONE', 'done_at' => now(),
                'result' => 'Se cerró sola: el cliente volvió a llamar y lo atendieron.', 'updated_at' => now()]);
        }

        return count($ids);
    }

    /** El destino de un «Llamar»: el cliente, el lead o el pedido, su celular y el número de la marca con que sale. */
    public static function destino(array $ref, User $u): array
    {
        $o = ! empty($ref['order_id']) ? DB::table('sales_orders')->where('id', $ref['order_id'])->first(['id', 'number', 'customer_id', 'brand_id', 'contact_phone', 'status']) : null;
        $marcas = Access::for($u)['brands'];
        if ($o && $marcas && ! in_array($o->brand_id, $marcas, true)) {
            abort(404);
        }
        $c = DB::table('customers')->where('id', $ref['customer_id'] ?? $o?->customer_id)->first(['id', 'full_name', 'trade_name', 'phone']);
        $l = ! $c && ! empty($ref['lead_id']) ? DB::table('leads')->where('id', $ref['lead_id'])->first(['id', 'full_name', 'phone', 'brand_id']) : null;
        $s = DB::table('tel_settings')->first();
        $registrado = (bool) ($c || $l);
        $celular = Central::e164($o?->contact_phone ?: ($c->phone ?? ($l->phone ?? null)));
        $marca = $o->brand_id ?? $l->brand_id ?? null;
        $num = DB::table('tel_numbers')->where('status', 'ACTIVE')->where(fn ($w) => $marca ? $w->where('brand_id', $marca)->orWhereNull('brand_id') : $w->whereNull('brand_id'))
            ->orderByRaw('brand_id IS NULL')->orderBy('created_at')->first(['id', 'e164', 'brand_id']);

        return [
            'pedido' => $o ? ['id' => $o->id, 'number' => $o->number, 'status' => $o->status] : null,
            'cliente' => $c ? ['id' => $c->id, 'nombre' => $c->trade_name ?: $c->full_name] : null,
            'lead' => $l ? ['id' => $l->id, 'nombre' => $l->full_name] : null,
            'celular' => $celular ?: null, 'marca' => $marca ? DB::table('brands')->where('id', $marca)->value('name') : null,
            'sale_con' => $num ? ['id' => $num->id, 'e164' => $num->e164, 'de' => $num->brand_id ? 'de la marca' : 'general'] : null,
            'brand_id' => $marca, 'registrado' => $registrado, 'solo_registrados' => (bool) ($s?->outbound_registered_only ?? true),
            'puede' => Access::can($u, 'tel.call.make') && $s?->stage === 'LIVE',
        ];
    }

    /** «Llamar» (click-to-call, RN-TEL-05): sale con el número de la marca; queda sonando hasta que el proveedor avise. */
    public static function llamar(array $ref, User $u): array
    {
        if (! Access::can($u, 'tel.call.make')) {
            RuleError::fail('RN-TEL-05', 'Tu rol no hace llamadas.');
        }
        $s = self::ajustes();
        self::proveedorListo($s);
        $dest = self::destino($ref, $u);
        if ($dest['solo_registrados'] && ! $dest['registrado']) {
            RuleError::fail('RN-TEL-05', 'Solo se llama a clientes o leads registrados.');
        }
        if (! $dest['celular'] || ! preg_match('/^\+\d{8,15}$/', $dest['celular'])) {
            RuleError::fail('RN-TEL-05', 'El cliente no tiene un celular válido.');
        }
        if (! $dest['sale_con']) {
            RuleError::fail('RN-TEL-03', 'No hay números de la central activos (Números y desvíos).');
        }
        $marca = DB::table('tel_numbers')->where('id', $dest['sale_con']['id'])->value('brand_id') ?? $dest['brand_id']
            ?? DB::table('brands')->where('status', 'ACTIVE')->orderBy('name')->value('id');
        $id = DB::table('tel_calls')->insertGetId([
            'provider_call_id' => 'FAKE-'.bin2hex(random_bytes(8)), 'preview' => false, 'number_id' => $dest['sale_con']['id'], 'direction' => 'OUTBOUND',
            'from_e164' => $dest['sale_con']['e164'], 'to_e164' => $dest['celular'], 'brand_id' => $marca, 'customer_id' => $dest['cliente']['id'] ?? null,
            'lead_id' => $dest['lead']['id'] ?? null, 'order_id' => $dest['pedido']['id'] ?? null, 'user_id' => $u->id, 'status' => 'RINGING', 'notice_played' => false,
            'started_at' => now(), 'wait_seconds' => 0, 'duration_seconds' => 0, 'cost_usd' => 0, 'created_at' => now(), 'updated_at' => now(),
        ], 'id');
        Events::emit('call.started', 'tel_calls', $id, ['by' => $u->id, 'to' => $dest['celular']]);

        return self::ver($id, $u) + ['simulador' => Simulador::disponible()];
    }

    /** Cómo terminó una llamada saliente (lo avisa el proveedor; en prueba, el simulador). */
    public static function resultado(string $id, string $estado, int $segundos, User $u): array
    {
        if (! Simulador::disponible()) {
            abort(404);
        }
        $s = self::ajustes();
        $c = DB::table('tel_calls')->where('id', $id)->first() ?? abort(404);
        if ($c->user_id !== $u->id && ! Access::can($u, 'tel.call.view_all')) {
            abort(404);
        }
        if ($c->direction !== 'OUTBOUND' || in_array($c->status, self::FINALES, true)) {
            RuleError::fail('RN-TEL-05', 'Esa llamada ya terminó.');
        }
        $atendida = $estado === 'COMPLETED';
        $segundos = $atendida ? max(1, $segundos) : 0;
        $aviso = (bool) $s->recording_enabled && $atendida;
        $inicio = Carbon::parse($c->started_at);
        DB::transaction(function () use ($c, $s, $estado, $atendida, $segundos, $aviso, $inicio) {
            DB::table('tel_calls')->where('id', $c->id)->update(['status' => $estado, 'notice_played' => $aviso, 'answered_at' => $atendida ? $inicio->copy()->addSeconds(12) : null,
                'ended_at' => $inicio->copy()->addSeconds(($atendida ? 12 : 25) + $segundos), 'wait_seconds' => $atendida ? 12 : 25, 'duration_seconds' => $segundos,
                'cost_usd' => self::costo($s, 'OUTBOUND', $c->to_e164, $segundos, $aviso), 'updated_at' => now()]);
            if ($atendida) {
                self::grabar($c->id, $s, $inicio, $segundos, $aviso);
                // Devolvió la llamada y el cliente contestó: sus tareas de devolver quedan hechas (RN-TEL-07).
                if ($c->customer_id || $c->lead_id) {
                    DB::table('crm_tasks')->where('task_type', 'CALLBACK')->where('status', 'OPEN')
                        ->where(fn ($w) => $w->when($c->customer_id, fn ($x) => $x->where('customer_id', $c->customer_id))->when(! $c->customer_id && $c->lead_id, fn ($x) => $x->where('lead_id', $c->lead_id)))
                        ->update(['status' => 'DONE', 'done_at' => now(), 'done_by' => $c->user_id, 'result' => 'Llamada devuelta: el cliente contestó.', 'updated_at' => now()]);
                }
                Events::emit('call.completed', 'tel_calls', $c->id, ['user' => $c->user_id]);
            }
        });

        return self::ver($id, $u);
    }

    private static function base(User $u)
    {
        $marcas = Access::for($u)['brands'];
        $q = DB::table('tel_calls as c')->when($marcas, fn ($w) => $w->whereIn('c.brand_id', $marcas));

        return Access::can($u, 'tel.call.view_all') ? $q : $q->where('c.user_id', $u->id);
    }

    public static function ver(string $id, User $u): array
    {
        $c = self::base($u)->where('c.id', $id)->leftJoin('customers as cu', 'cu.id', '=', 'c.customer_id')->leftJoin('leads as l', 'l.id', '=', 'c.lead_id')
            ->leftJoin('users as x', 'x.id', '=', 'c.user_id')->leftJoin('brands as b', 'b.id', '=', 'c.brand_id')->leftJoin('sales_orders as o', 'o.id', '=', 'c.order_id')
            ->first(['c.*', 'x.name as vendedora', 'b.name as marca', 'o.number as pedido', DB::raw('coalesce(cu.trade_name, cu.full_name) AS cliente'), 'l.full_name as lead']) ?? abort(404);

        $g = DB::table('tel_recordings')->where('call_id', $c->id)->first(['id', 'status', 'retention_until', 'legal_hold']);
        $t = DB::table('crm_tasks as t')->leftJoin('users as x', 'x.id', '=', 't.assigned_user_id')->where('t.call_id', $c->id)->orderByDesc('t.created_at')
            ->first(['t.id', 't.status', 't.due_at', 't.done_at', 't.result', 'x.name as responsable']);

        return self::presentar($c) + ['ficha' => self::ficha($c), 'answered_at' => $c->answered_at, 'ended_at' => $c->ended_at, 'provider_call_id' => $c->provider_call_id,
            'grabacion' => $g ? ['id' => $g->id, 'status' => $g->status, 'retention_until' => $g->retention_until, 'legal_hold' => (bool) $g->legal_hold] : null,
            'tarea' => $t ? (array) $t : null];
    }

    private static function presentar(object $c): array
    {
        return [
            'id' => $c->id, 'direction' => $c->direction, 'direccion' => $c->direction === 'INBOUND' ? 'Entrante' : 'Saliente', 'from_e164' => $c->from_e164, 'to_e164' => $c->to_e164,
            'cliente' => $c->cliente, 'customer_id' => $c->customer_id, 'lead' => $c->lead, 'lead_id' => $c->lead_id, 'marca' => $c->marca, 'vendedora' => $c->vendedora,
            'pedido' => $c->pedido, 'order_id' => $c->order_id, 'status' => $c->status, 'estado' => self::ESTADOS[$c->status] ?? $c->status, 'started_at' => $c->started_at,
            'wait_seconds' => (int) $c->wait_seconds, 'duration_seconds' => (int) $c->duration_seconds, 'notice_played' => (bool) $c->notice_played,
            'cost_usd' => $c->cost_usd !== null ? (float) $c->cost_usd : null, 'menu_option' => $c->menu_option, 'preview' => (bool) $c->preview,
        ];
    }

    /** Lo que ve la vendedora al sonar: el cliente con sus pedidos, o el lead (nuevo o ya registrado). */
    private static function ficha(object $c): array
    {
        if ($c->customer_id) {
            $ped = DB::table('sales_orders')->where('customer_id', $c->customer_id)->orderByDesc('created_at')->limit(30)->get(['id', 'number', 'status', 'created_at']);

            return ['tipo' => 'CLIENTE', 'id' => $c->customer_id, 'nombre' => $c->cliente, 'pedidos' => DB::table('sales_orders')->where('customer_id', $c->customer_id)->whereNotIn('status', ['CANCELLED', 'DRAFT'])->count(),
                'ultimo' => $ped->first()?->created_at,
                'en_curso' => $ped->whereNotIn('status', ['CLOSED', 'CANCELLED', 'DELIVERED', 'DRAFT'])->take(3)->map(fn ($o) => ['id' => $o->id, 'number' => $o->number, 'status' => $o->status])->values()->all()];
        }

        return ['tipo' => 'LEAD', 'id' => $c->lead_id, 'nombre' => $c->lead, 'nuevo' => (bool) $c->lead_phone];
    }

    /** TEL-06: el estado del teléfono, las últimas entrantes y lo que necesita el simulador. */
    public static function telefono(User $u): array
    {
        $s = DB::table('tel_settings')->first();
        $menu = DB::table('tel_menus')->where('status', 'ACTIVE')->orderBy('created_at')->first();
        $ultimas = self::base($u)->where('c.direction', 'INBOUND')->leftJoin('customers as cu', 'cu.id', '=', 'c.customer_id')->leftJoin('leads as l', 'l.id', '=', 'c.lead_id')
            ->leftJoin('users as x', 'x.id', '=', 'c.user_id')->leftJoin('brands as b', 'b.id', '=', 'c.brand_id')->leftJoin('sales_orders as o', 'o.id', '=', 'c.order_id')
            ->orderByDesc('c.started_at')->limit(8)
            ->get(['c.*', 'x.name as vendedora', 'b.name as marca', 'o.number as pedido', DB::raw('coalesce(cu.trade_name, cu.full_name) AS cliente'), 'l.full_name as lead'])
            ->map(fn ($c) => self::presentar($c))->all();

        return [
            'en_vivo' => $s?->stage === 'LIVE', 'proveedor' => Ajustes::PROVEEDORES[$s->provider ?? 'TWILIO'] ?? $s?->provider,
            'central' => DB::table('tel_numbers')->where('status', 'ACTIVE')->orderByRaw('brand_id IS NOT NULL')->value('e164'),
            'numeros' => DB::table('tel_numbers')->where('status', 'ACTIVE')->orderByRaw('brand_id IS NOT NULL')->orderBy('e164')->get(['id', 'e164'])->map(fn ($n) => ['value' => $n->id, 'label' => $n->e164])->all(),
            'opciones' => collect($menu ? (json_decode((string) $menu->options, true) ?: []) : [])->map(fn ($o) => ['value' => (string) $o['digit'],
                'label' => $o['digit'].' · '.(! empty($o['direct_user_id']) ? 'Supervisora' : (DB::table('brands')->where('id', $o['brand_id'] ?? null)->value('name') ?? ($o['label'] ?? '')))])->values()->all(),
            'en_horario' => self::enHorario($menu, now()),
            'ultimas' => $ultimas,
            'simulador' => Simulador::disponible() && Access::can($u, 'tel.call.make'),
            'resultados' => collect(['COMPLETED', 'MISSED', 'NO_ANSWER', 'VOICEMAIL', 'BUSY'])->map(fn ($k) => ['value' => $k, 'label' => self::ESTADOS[$k]])->all(),
        ];
    }

    /** Simula que alguien llama al teléfono de quien está en la app (solo fuera de producción). */
    public static function simularEntrante(array $d, User $u): array
    {
        if (! Simulador::disponible()) {
            abort(404);
        }
        if (! Access::can($u, 'tel.call.make')) {
            RuleError::fail('RN-TEL-05', 'Tu rol no atiende llamadas.');
        }
        self::proveedorListo(self::ajustes());
        $r = self::entrante(['from' => $d['from'], 'number_id' => $d['number_id'] ?? null, 'option' => $d['option'] ?? null, 'resultado' => $d['resultado'],
            'segundos' => $d['segundos'] ?? 120, 'user_id' => $d['resultado'] === 'COMPLETED' ? $u->id : null]);

        return $r + ['llamada' => self::ver($r['id'], $u)];
    }

    /** TEL-07: las salientes, con buscador y filtros. */
    public static function salientes(array $f, User $u): array
    {
        $q = self::base($u)->where('c.direction', 'OUTBOUND')->leftJoin('customers as cu', 'cu.id', '=', 'c.customer_id')->leftJoin('leads as l', 'l.id', '=', 'c.lead_id')
            ->leftJoin('users as x', 'x.id', '=', 'c.user_id')->leftJoin('brands as b', 'b.id', '=', 'c.brand_id')->leftJoin('sales_orders as o', 'o.id', '=', 'c.order_id');
        if (! empty($f['estado'])) {
            $q->where('c.status', $f['estado']);
        }
        if (! empty($f['vendedora'])) {
            $q->where('c.user_id', $f['vendedora']);
        }
        if (! empty($f['desde'])) {
            $q->where('c.started_at', '>=', Carbon::parse($f['desde'], 'America/Lima')->startOfDay());
        }
        if (! empty($f['hasta'])) {
            $q->where('c.started_at', '<=', Carbon::parse($f['hasta'], 'America/Lima')->endOfDay());
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes(str_replace(' ', '', $t), '%_\\').'%';
            $pn = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('c.to_e164', 'ilike', $p)->orWhere('cu.full_name', 'ilike', $pn)->orWhere('l.full_name', 'ilike', $pn)->orWhere('o.number', 'ilike', $pn));
        }
        $q->orderByDesc('c.started_at')->orderBy('c.id');
        Paginas::ordenar($q, ['inicio' => 'c.started_at', 'cliente' => 'coalesce(cu.full_name, l.full_name)', 'vendedora' => 'x.name', 'estado' => 'c.status', 'duracion' => 'c.duration_seconds'], 'c.id', $f);
        $q->select(['c.*', 'x.name as vendedora', 'b.name as marca', 'o.number as pedido', DB::raw('coalesce(cu.trade_name, cu.full_name) AS cliente'), 'l.full_name as lead']);

        return Paginas::de($q, fn ($c) => self::presentar($c), $f) + [
            'opciones' => [
                'estados' => collect(self::ESTADOS)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all(),
                'vendedoras' => Access::can($u, 'tel.call.view_all') ? DB::table('users as x')->whereIn('x.id', self::base($u)->where('c.direction', 'OUTBOUND')->whereNotNull('c.user_id')->select('c.user_id'))
                    ->orderBy('x.name')->get(['x.id', 'x.name'])->map(fn ($x) => ['value' => $x->id, 'label' => $x->name])->all() : [],
            ],
            'simulador' => Simulador::disponible(),
        ];
    }

    /** TEL-07: pedidos para llamar (los de hoy, o buscando por número o cliente). */
    public static function pedidos(?string $buscar, User $u): array
    {
        $marcas = Access::for($u)['brands'];
        $q = DB::table('sales_orders as o')->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')->leftJoin('brands as b', 'b.id', '=', 'o.brand_id')
            ->when($marcas, fn ($w) => $w->whereIn('o.brand_id', $marcas))->whereNotIn('o.status', ['CANCELLED']);
        $t = trim((string) $buscar);
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('o.number', 'ilike', $p)->orWhere('c.full_name', 'ilike', $p)->orWhere('c.phone', 'ilike', $p));
        } else {
            $q->whereDate('o.delivery_date', now('America/Lima')->toDateString());
        }

        return $q->orderByDesc('o.created_at')->limit(30)->get(['o.id', 'o.number', 'o.status', 'b.name as marca', DB::raw('coalesce(c.trade_name, c.full_name) AS cliente')])
            ->map(fn ($o) => ['value' => $o->id, 'label' => "{$o->number} · {$o->cliente} · {$o->marca}"])->all();
    }
}
