<?php

namespace App\Modulos\Crm\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * CRM-17 Mis tareas: devolver llamada, recompra, seguimiento, seguimiento de encuesta, revisar alerta y chat sin
 * responder, con su vencimiento. La vendedora ve las suyas; la supervisión además las del equipo y las que no tienen
 * responsable. Una tarea se completa con su resultado y ya no cambia (RN-CRM-19); las tareas no se borran.
 *
 * El barrido (cada minuto) crea la tarea «chat sin responder» cuando un chat pasa crm_unanswered_alert_minutes en
 * horario sin respuesta y avisa a la supervisión, igual que cuando un chat lleva más de crm_unassigned_alert_minutes
 * en la cola (RN-CRM-02 y 14).
 */
class Tareas
{
    public const TIPOS = ['CALLBACK' => 'Devolver llamada', 'REBUY' => 'Recompra', 'FOLLOW_UP' => 'Seguimiento', 'SURVEY_FOLLOW_UP' => 'Seguimiento de encuesta',
        'ALERT_REVIEW' => 'Revisar alerta', 'UNANSWERED_CHAT' => 'Chat sin responder'];

    public const ESTADOS = ['OPEN' => 'Abierta', 'DONE' => 'Hecha'];

    private static function equipo(User $u): bool
    {
        return Access::can($u, 'crm.conversation.view_all');
    }

    /** Las tareas que ve la persona: en sus marcas; la vendedora, solo las suyas. */
    private static function base(User $u, string $alcance = 'mias')
    {
        $marcas = Access::for($u)['brands'];
        $q = DB::table('crm_tasks as t')->when($marcas, fn ($w) => $w->whereIn('t.brand_id', $marcas));
        if (! self::equipo($u)) {
            return $q->where('t.assigned_user_id', $u->id);
        }
        if ($alcance === 'mias') {
            $q->where(fn ($w) => $w->where('t.assigned_user_id', $u->id)->when(Access::can($u, 'crm.conversation.reassign'), fn ($x) => $x->orWhereNull('t.assigned_user_id')));
        }

        return $q;
    }

    public static function lista(array $f, User $u): array
    {
        $alcance = self::equipo($u) && ($f['alcance'] ?? 'mias') === 'equipo' ? 'equipo' : 'mias';
        $ahora = now();
        $hoyFin = now('America/Lima')->endOfDay();
        $q = self::base($u, $alcance)
            ->leftJoin('customers as cu', 'cu.id', '=', 't.customer_id')->leftJoin('conversations as v', 'v.id', '=', 't.conversation_id')
            ->leftJoin('channel_contacts as k', 'k.id', '=', 'v.contact_id')->leftJoin('leads as l', 'l.id', '=', 't.lead_id')
            ->leftJoin('brands as b', 'b.id', '=', 't.brand_id')->leftJoin('users as x', 'x.id', '=', 't.assigned_user_id')
            ->leftJoin('users as hz', 'hz.id', '=', 't.done_by')->leftJoin('sales_orders as o', 'o.id', '=', 't.order_id');
        foreach (['tipo' => 't.task_type', 'marca' => 't.brand_id'] as $k => $col) {
            if (! empty($f[$k])) {
                $q->where($col, $f[$k]);
            }
        }
        if ($alcance === 'equipo' && ! empty($f['responsable'])) {
            $f['responsable'] === 'none' ? $q->whereNull('t.assigned_user_id') : $q->where('t.assigned_user_id', $f['responsable']);
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('cu.full_name', 'ilike', $p)->orWhere('cu.phone', 'ilike', $p)->orWhere('k.display_name', 'ilike', $p)
                ->orWhere('k.external_user_id', 'ilike', $p)->orWhere('l.full_name', 'ilike', $p)->orWhere('t.note', 'ilike', $p)->orWhere('o.number', 'ilike', $p));
        }
        $c = (clone $q)->selectRaw("count(*) FILTER (WHERE t.status = 'OPEN') AS abiertas, count(*) FILTER (WHERE t.status = 'OPEN' AND t.due_at < ?) AS vencidas,
            count(*) FILTER (WHERE t.status = 'OPEN' AND t.due_at >= ? AND t.due_at <= ?) AS hoy, count(*) FILTER (WHERE t.status = 'DONE') AS hechas", [$ahora, $ahora, $hoyFin])->first();
        match ($f['estado'] ?? 'OPEN') {
            'ALL' => null,
            'DONE' => $q->where('t.status', 'DONE'),
            default => $q->where('t.status', 'OPEN'),
        };
        match ($f['vence'] ?? '') {
            'vencidas' => $q->where('t.status', 'OPEN')->where('t.due_at', '<', $ahora),
            'hoy' => $q->where('t.status', 'OPEN')->whereBetween('t.due_at', [$ahora, $hoyFin]),
            default => null,
        };
        $q->orderByRaw("CASE t.status WHEN 'OPEN' THEN 0 ELSE 1 END")->orderBy('t.due_at')->orderBy('t.id');
        Paginas::ordenar($q, ['tipo' => 't.task_type', 'cliente' => 'coalesce(cu.full_name, l.full_name, k.display_name, k.external_user_id)', 'marca' => 'b.name',
            'responsable' => 'x.name', 'vence' => 't.due_at', 'estado' => 't.status'], 't.id', $f);
        $q->select(['t.*', 'b.name as marca', 'x.name as responsable', 'hz.name as hecha_por', 'o.number as pedido', 'cu.phone as celular',
            DB::raw('coalesce(cu.trade_name, cu.full_name, l.full_name, k.display_name, k.external_user_id) AS cliente')]);
        $r = Paginas::de($q, fn ($t) => self::presentar($t, $u, $ahora), $f);
        // Solo se enlaza el chat si la persona lo puede abrir.
        $ids = array_filter(array_column($r['data'], 'conversation_id'));
        $abribles = $ids ? Conversaciones::visibles($u)->whereIn('v.id', $ids)->pluck('v.id')->all() : [];
        foreach ($r['data'] as &$fila) {
            $fila['conversation_id'] = in_array($fila['conversation_id'], $abribles, true) ? $fila['conversation_id'] : null;
        }
        unset($fila);
        $marcas = Access::for($u)['brands'];

        return $r + [
            'cifras' => ['abiertas' => (int) $c->abiertas, 'vencidas' => (int) $c->vencidas, 'hoy' => (int) $c->hoy, 'hechas' => (int) $c->hechas],
            'alcance' => $alcance, 'equipo' => self::equipo($u),
            'telefonia' => DB::table('tenant_modules')->where('module_code', 'TEL')->where('enabled', true)->exists(),
            'ficha' => Access::can($u, 'crm.customer.view_full'),
            'opciones' => [
                'tipos' => collect(self::TIPOS)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all(),
                'marcas' => DB::table('brands')->when($marcas, fn ($w) => $w->whereIn('id', $marcas))->where('status', 'ACTIVE')->orderBy('name')
                    ->get(['id', 'name'])->map(fn ($b) => ['value' => $b->id, 'label' => $b->name])->all(),
                'responsables' => self::equipo($u) ? DB::table('users as x')->whereIn('x.id', self::base($u, 'equipo')->whereNotNull('t.assigned_user_id')->select('t.assigned_user_id'))
                    ->orderBy('x.name')->get(['x.id', 'x.name'])->map(fn ($x) => ['value' => $x->id, 'label' => $x->name])->prepend(['value' => 'none', 'label' => 'Sin responsable'])->values()->all() : [],
            ],
        ];
    }

    private static function presentar(object $t, User $u, Carbon $ahora): array
    {
        $abierta = $t->status === 'OPEN';

        return [
            'id' => $t->id, 'task_type' => $t->task_type, 'tipo' => self::TIPOS[$t->task_type] ?? $t->task_type, 'cliente' => $t->cliente, 'celular' => $t->celular,
            'customer_id' => $t->customer_id, 'conversation_id' => $t->conversation_id, 'pedido' => $t->pedido, 'marca' => $t->marca,
            'responsable' => $t->responsable, 'assigned_user_id' => $t->assigned_user_id, 'due_at' => $t->due_at, 'note' => $t->note,
            'status' => $t->status, 'vencida' => $abierta && Carbon::parse($t->due_at)->lt($ahora),
            'done_at' => $t->done_at, 'result' => $t->result, 'hecha_por' => $t->hecha_por,
            'puede_completar' => $abierta && self::puedeCompletar($t, $u),
        ];
    }

    private static function puedeCompletar(object $t, User $u): bool
    {
        return $t->assigned_user_id === $u->id || Access::can($u, 'crm.conversation.reassign');
    }

    /** Completar con el resultado: la responsable o la supervisión. Una tarea hecha no se reabre (RN-CRM-19). */
    public static function completar(string $id, string $resultado, User $u): array
    {
        $t = self::base($u, 'equipo')->where('t.id', $id)->first(['t.*']) ?? abort(404);
        if ($t->status !== 'OPEN') {
            RuleError::fail('RN-CRM-19', 'La tarea ya está hecha: no se reabre ni cambia su resultado.');
        }
        if (! self::puedeCompletar($t, $u)) {
            RuleError::fail('RN-CRM-03', 'Solo la responsable de la tarea o la supervisión la completan.');
        }
        $resultado = trim($resultado);
        if (mb_strlen($resultado) < 3) {
            RuleError::fail('RN-CRM-19', 'Anota el resultado de la tarea.');
        }
        $n = DB::table('crm_tasks')->where('id', $id)->where('status', 'OPEN')
            ->update(['status' => 'DONE', 'done_at' => DB::raw('clock_timestamp()'), 'done_by' => $u->id, 'result' => mb_substr($resultado, 0, 1000), 'updated_at' => now()]);
        if (! $n) {
            RuleError::fail('RN-CRM-19', 'La tarea ya está hecha: no se reabre ni cambia su resultado.');
        }
        Events::emit('crm.task_done', 'crm_tasks', $id, ['type' => $t->task_type, 'by' => $u->id]);
        $fila = self::base($u, 'equipo')->where('t.id', $id)->leftJoin('brands as b', 'b.id', '=', 't.brand_id')->leftJoin('users as x', 'x.id', '=', 't.assigned_user_id')
            ->leftJoin('users as hz', 'hz.id', '=', 't.done_by')->leftJoin('sales_orders as o', 'o.id', '=', 't.order_id')->leftJoin('customers as cu', 'cu.id', '=', 't.customer_id')
            ->first(['t.*', 'b.name as marca', 'x.name as responsable', 'hz.name as hecha_por', 'o.number as pedido', 'cu.phone as celular', DB::raw('coalesce(cu.trade_name, cu.full_name) AS cliente')]);

        return self::presentar($fila, $u, now());
    }

    /**
     * El barrido de cada minuto (RN-CRM-02 y 14), dentro de la empresa ya fijada:
     *  - un chat abierto sin respuesta más de crm_unanswered_alert_minutes en horario recibe su tarea «chat sin
     *    responder» (una por cada mensaje del cliente que quedó sin respuesta, y una sola abierta por chat);
     *  - la supervisión recibe un aviso con los chats nuevos sin responder y los que pasaron el tiempo en la cola.
     * Devuelve [tareas creadas, chats en cola avisados].
     */
    public static function barrer(?Carbon $ahora = null): array
    {
        $ahora ??= now();
        $lim = (int) (Params::get('crm_unanswered_alert_minutes') ?? 15);
        $limCola = (int) (Params::get('crm_unassigned_alert_minutes') ?? 5);
        $candidatos = DB::table('conversations')->where('status', '<>', 'CLOSED')->whereNotNull('last_inbound_at')
            ->where(fn ($w) => $w->whereNull('last_reply_at')->orWhereColumn('last_reply_at', '<', 'last_inbound_at'))
            ->where(fn ($w) => $w->whereNull('unanswered_flag_for')->orWhereColumn('unanswered_flag_for', '<>', 'last_inbound_at'))
            ->where('last_inbound_at', '<', $ahora->copy()->subMinutes($lim))
            ->get(['id', 'brand_id', 'customer_id', 'lead_id', 'assigned_user_id', 'last_inbound_at']);
        $creadas = 0;
        $porMarca = [];
        foreach ($candidatos as $cv) {
            $m = Conversaciones::minutosHabiles(Carbon::parse($cv->last_inbound_at), $ahora, $cv->brand_id);
            if ($m <= $lim) {
                continue;
            }
            DB::transaction(function () use ($cv, $m, $ahora, &$creadas, &$porMarca) {
                DB::table('conversations')->where('id', $cv->id)->update(['unanswered_flag_for' => $cv->last_inbound_at]);
                $desde = Carbon::parse($cv->last_inbound_at)->setTimezone('America/Lima')->format('H:i');
                $n = DB::table('crm_tasks')->insertOrIgnore(['task_type' => 'UNANSWERED_CHAT', 'status' => 'OPEN', 'customer_id' => $cv->customer_id, 'lead_id' => $cv->lead_id,
                    'conversation_id' => $cv->id, 'brand_id' => $cv->brand_id, 'assigned_user_id' => $cv->assigned_user_id, 'due_at' => $ahora,
                    'note' => mb_substr("Sin respuesta desde las {$desde} ({$m} min en horario)", 0, 255), 'created_at' => now(), 'updated_at' => now()]);
                if ($n) {
                    $creadas++;
                    $porMarca[$cv->brand_id] = ($porMarca[$cv->brand_id] ?? 0) + 1;
                    // Y la alerta de control de baja gravedad para la vendedora asignada (la de la cola no tiene a quién).
                    $ultimo = DB::table('conversation_messages')->where('conversation_id', $cv->id)->where('direction', 'IN')->orderByDesc('sent_at')->value('body');
                    Control::senal('UNANSWERED_CHAT', "Sin respuesta {$m} min en horario", $cv->assigned_user_id, $ultimo, $cv);
                }
            });
        }
        foreach ($porMarca as $marca => $n) {
            self::avisar($marca, $n === 1 ? '1 chat sin responder' : "{$n} chats sin responder",
                "Pasaron más de {$lim} min en horario sin respuesta. Quedó una tarea para cada uno.", '/m/crm/crm-06');
        }

        // Cola: un aviso por chat y por cada vez que entra a la cola.
        $cola = DB::table('conversations')->where('status', '<>', 'CLOSED')->whereNull('assigned_user_id')->whereNotNull('queued_at')
            ->where('queued_at', '<', $ahora->copy()->subMinutes($limCola))->get(['id', 'brand_id', 'queued_at']);
        $avisados = 0;
        foreach ($cola->groupBy('brand_id') as $marca => $xs) {
            $nuevos = $xs->filter(fn ($v) => ! DB::table('notifications')->where('module', 'CRM')->where('ref->cola', $v->id.'@'.Carbon::parse($v->queued_at)->toIso8601String())->exists());
            foreach ($nuevos as $v) {
                DB::table('notifications')->insert(['role' => 'SUPERVISORA_VENTAS', 'module' => 'CRM', 'tone' => 'warn', 'severity' => 'WARNING', 'type' => 'ORDERS', 'at' => now(),
                    'title' => 'Chat en cola', 'body' => "Lleva más de {$limCola} min sin asignar: nadie del número está en turno y en línea.",
                    'ref' => json_encode(['href' => "/m/crm/crm-02?id={$v->id}", 'cola' => $v->id.'@'.Carbon::parse($v->queued_at)->toIso8601String(), 'brand_id' => $marca])]);
                $avisados++;
            }
        }

        return [$creadas, $avisados];
    }

    private static function avisar(string $marca, string $titulo, string $cuerpo, string $href): void
    {
        DB::table('notifications')->insert(['role' => 'SUPERVISORA_VENTAS', 'module' => 'CRM', 'tone' => 'warn', 'severity' => 'WARNING', 'type' => 'ORDERS', 'at' => now(),
            'title' => $titulo, 'body' => $cuerpo, 'ref' => json_encode(['href' => $href, 'brand_id' => $marca])]);
    }
}
