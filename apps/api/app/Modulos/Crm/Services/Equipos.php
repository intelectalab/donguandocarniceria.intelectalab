<?php

namespace App\Modulos\Crm\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * CRM-08 Equipos y turnos y el reparto de chats (RN-CRM-02 y RN-CRM-03).
 *
 * Un chat nuevo va a una vendedora del número que esté en turno (hora de Lima), en línea y con menos chats abiertos que su
 * tope. En «turno rotativo» gana la que recibió su última asignación hace más tiempo; en «menos chats abiertos», la que
 * tiene menos. En «manual», o si nadie cumple, el chat queda en cola. Sin turnos propios, vale el horario de atención.
 */
class Equipos
{
    public const ROLES = ['AGENT' => 'Vendedora', 'SUPERVISOR' => 'Supervisora'];

    public const ESTADOS_AGENTE = ['ONLINE' => 'En línea', 'AWAY' => 'Ausente', 'OFFLINE' => 'Desconectada'];

    public const DIAS = [1 => 'Lun', 2 => 'Mar', 3 => 'Mié', 4 => 'Jue', 5 => 'Vie', 6 => 'Sáb', 7 => 'Dom'];

    public static function tope(): int
    {
        return max(1, (int) (Params::get('crm_max_open_conversations') ?? 25));
    }

    /** CRM-08: los números con sus miembros, turnos, estado, chats abiertos y a quién iría el próximo chat. */
    public static function equipos(array $f, User $u): array
    {
        $ahora = now('America/Lima');
        $canales = Canales::visibles($u)->leftJoin('brands as b', 'b.id', '=', 'c.brand_id')
            ->when(! empty($f['marca']), fn ($q) => $q->where('c.brand_id', $f['marca']))
            ->orderByRaw("CASE c.kind WHEN 'WHATSAPP' THEN 0 ELSE 1 END")->orderBy('b.name')->orderBy('c.display_name')
            ->get(['c.id', 'c.kind', 'c.display_name', 'c.number', 'c.assignment_mode', 'c.status', 'c.brand_id', 'b.name as brand_name']);
        $ids = $canales->pluck('id')->all();
        $miembros = DB::table('channel_members as m')->join('users as x', 'x.id', '=', 'm.user_id')->whereIn('m.channel_id', $ids)
            ->orderByRaw("CASE m.member_role WHEN 'SUPERVISOR' THEN 1 ELSE 0 END")->orderBy('x.name')
            ->get(['m.id', 'm.channel_id', 'm.user_id', 'm.member_role', 'm.max_open_conversations', 'm.active', 'x.name', 'x.email', 'x.status as user_status']);
        $turnos = DB::table('channel_member_shifts')->whereIn('member_id', $miembros->pluck('id'))->orderBy('weekday')->get()->groupBy('member_id');
        $estados = self::estados($miembros->pluck('user_id')->unique()->all());
        $abiertos = self::abiertos($miembros->pluck('user_id')->unique()->all());

        $porCanal = [];
        foreach ($canales as $c) {
            $lista = [];
            foreach ($miembros->where('channel_id', $c->id) as $m) {
                $sus = collect($turnos[$m->id] ?? []);
                $lista[] = [
                    'id' => $m->id, 'user_id' => $m->user_id, 'name' => $m->name, 'email' => $m->email, 'member_role' => $m->member_role,
                    'role_name' => self::ROLES[$m->member_role] ?? $m->member_role, 'active' => (bool) $m->active, 'user_status' => $m->user_status,
                    'estado' => $estados[$m->user_id] ?? 'OFFLINE', 'estado_name' => self::ESTADOS_AGENTE[$estados[$m->user_id] ?? 'OFFLINE'],
                    'turnos' => $sus->map(fn ($s) => ['weekday' => (int) $s->weekday, 'from' => substr($s->time_from, 0, 5), 'to' => substr($s->time_to, 0, 5)])->values()->all(),
                    'turnos_texto' => self::textoTurnos($sus),
                    'en_turno' => self::enTurno($sus->all(), $ahora, $c->brand_id),
                    'abiertos' => (int) ($abiertos[$m->user_id] ?? 0), 'tope' => (int) $m->max_open_conversations,
                ];
            }
            $siguiente = self::elegir($c->id, $ahora);
            $porCanal[] = [
                'id' => $c->id, 'kind' => $c->kind, 'kind_name' => Canales::REDES[$c->kind] ?? $c->kind, 'display_name' => $c->display_name, 'number' => $c->number,
                'brand_id' => $c->brand_id, 'brand_name' => $c->brand_name, 'status' => $c->status,
                'assignment_mode' => $c->assignment_mode, 'assignment_name' => Canales::ASIGNACION[$c->assignment_mode] ?? $c->assignment_mode,
                'siguiente' => $siguiente ? collect($lista)->firstWhere('user_id', $siguiente)['name'] ?? null : null,
                'en_cola' => DB::table('conversations')->where('channel_id', $c->id)->where('status', '<>', 'CLOSED')->whereNull('assigned_user_id')->count(),
                'miembros' => $lista,
            ];
        }
        $activos = collect($porCanal)->flatMap(fn ($c) => collect($c['miembros'])->where('active', true));
        $agentes = $activos->where('member_role', 'AGENT');

        return [
            'data' => $porCanal,
            'cifras' => [
                'vendedoras' => $agentes->pluck('user_id')->unique()->count(),
                'en_linea' => $agentes->where('estado', 'ONLINE')->pluck('user_id')->unique()->count(),
                'en_turno' => $agentes->where('en_turno', true)->pluck('user_id')->unique()->count(),
                'abiertos' => $agentes->unique('user_id')->sum('abiertos'),
                'capacidad' => $agentes->unique('user_id')->sum('tope'),
                'en_cola' => collect($porCanal)->sum('en_cola'),
            ],
            'tope' => self::tope(), 'horario' => self::textoHorario(),
            'candidatos' => self::candidatos(),
            'asignacion' => collect(Canales::ASIGNACION)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all(),
            'puede' => Access::can($u, 'crm.channel.manage'),
            'ahora' => $ahora->toIso8601String(),
        ];
    }

    /** RN-CRM-03: solo vendedoras (de la marca del número) y supervisoras son miembros; una vez por número. */
    public static function agregarMiembro(string $canal, string $usuario, ?int $tope, User $quien): array
    {
        $c = DB::table('messaging_channels')->where('id', $canal)->first() ?? abort(404);
        $x = User::where('id', $usuario)->where('status', '<>', 'INACTIVE')->first() ?? RuleError::fail('RN-CRM-03', 'Esa persona no está activa.');
        $rol = self::rolDe($x);
        if (! $rol) {
            RuleError::fail('RN-CRM-03', "{$x->name} no es vendedora ni supervisora de ventas: no atiende chats.");
        }
        $marcas = Access::for($x)['brands'];
        if ($marcas && ! in_array($c->brand_id, $marcas, true)) {
            $marca = DB::table('brands')->where('id', $c->brand_id)->value('name');
            RuleError::fail('RN-CRM-03', "{$x->name} no atiende {$marca}: agrégale la marca en Usuarios primero.");
        }
        if (DB::table('channel_members')->where('channel_id', $canal)->where('user_id', $usuario)->exists()) {
            RuleError::fail('RN-CRM-03', "{$x->name} ya es miembro de {$c->display_name}.");
        }
        $tope = self::validarTope($tope ?? self::tope());
        $id = DB::table('channel_members')->insertGetId(['channel_id' => $canal, 'user_id' => $usuario, 'member_role' => $rol, 'role' => $rol, 'status' => 'ACTIVE',
            'max_open_conversations' => $tope, 'active' => true, 'created_at' => now(), 'updated_at' => now()], 'id');
        Events::emit('channel.member_added', 'channel_members', $id, ['channel' => $canal, 'user' => $usuario, 'by' => $quien->id]);

        return ['id' => $id];
    }

    /** Cambiar el tope o quitar/volver a activar. Quitar no borra: el miembro queda inactivo (su historial de chats sigue). */
    public static function cambiarMiembro(string $id, array $d, User $quien): array
    {
        $m = DB::table('channel_members')->where('id', $id)->first() ?? abort(404);
        $cambio = ['updated_at' => now()];
        if (array_key_exists('max_open_conversations', $d)) {
            $cambio['max_open_conversations'] = self::validarTope((int) $d['max_open_conversations']);
        }
        if (array_key_exists('active', $d)) {
            $activo = (bool) $d['active'];
            if (! $activo) {
                $abiertos = DB::table('conversations')->join('messaging_channels as c', 'c.id', '=', 'conversations.channel_id')
                    ->where('conversations.channel_id', $m->channel_id)->where('conversations.assigned_user_id', $m->user_id)->where('conversations.status', '<>', 'CLOSED')->count();
                if ($abiertos) {
                    RuleError::fail('RN-CRM-03', "Tiene {$abiertos} chat(s) abierto(s) en este número: reasígnalos antes de quitarla.");
                }
            }
            $cambio['active'] = $activo;
            $cambio['status'] = $activo ? 'ACTIVE' : 'INACTIVE';
        }
        DB::table('channel_members')->where('id', $id)->update($cambio);
        Events::emit('channel.member_changed', 'channel_members', $id, ['by' => $quien->id] + array_intersect_key($cambio, array_flip(['max_open_conversations', 'active'])));

        return ['id' => $id];
    }

    /**
     * Turnos de la semana: [{weekday 1-7, from HH:MM, to HH:MM}]; sin turnos vale el horario de atención.
     *
     * @param  array<int, array{weekday: int, from: string, to: string}>  $turnos
     */
    public static function turnos(string $id, array $turnos, User $quien): array
    {
        DB::table('channel_members')->where('id', $id)->first() ?? abort(404);
        $vistos = [];
        foreach ($turnos as $t) {
            $dia = (int) $t['weekday'];
            if ($dia < 1 || $dia > 7 || isset($vistos[$dia])) {
                RuleError::fail('RN-CRM-02', 'Un turno por día de la semana.');
            }
            if (! preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $t['from']) || ! preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $t['to']) || $t['from'] >= $t['to']) {
                RuleError::fail('RN-CRM-02', 'El turno del '.mb_strtolower(self::DIAS[$dia]).' termina antes de empezar.');
            }
            $vistos[$dia] = true;
        }
        DB::transaction(function () use ($id, $turnos) {
            DB::table('channel_member_shifts')->where('member_id', $id)->delete();
            foreach ($turnos as $t) {
                DB::table('channel_member_shifts')->insert(['member_id' => $id, 'weekday' => (int) $t['weekday'], 'time_from' => $t['from'], 'time_to' => $t['to'], 'created_at' => now(), 'updated_at' => now()]);
            }
        });
        Events::emit('channel.shifts_changed', 'channel_members', $id, ['by' => $quien->id, 'days' => count($turnos)]);

        return ['id' => $id];
    }

    public static function modoAsignacion(string $canal, string $modo, User $quien): array
    {
        if (! isset(Canales::ASIGNACION[$modo])) {
            RuleError::fail('RN-CRM-02', 'La asignación es turno rotativo, menos chats abiertos o manual.');
        }
        DB::table('messaging_channels')->where('id', $canal)->update(['assignment_mode' => $modo, 'updated_at' => now()]) || abort(404);
        Events::emit('channel.assignment_mode', 'messaging_channels', $canal, ['mode' => $modo, 'by' => $quien->id]);

        return ['id' => $canal, 'assignment_mode' => $modo];
    }

    /** Cada vendedora o supervisora marca su propio estado (en línea, ausente, desconectada). Solo se agrega al historial. */
    public static function marcarEstado(User $u, string $estado): array
    {
        if (! isset(self::ESTADOS_AGENTE[$estado])) {
            RuleError::fail('RN-CRM-02', 'El estado es en línea, ausente o desconectada.');
        }
        if (! DB::table('channel_members')->where('user_id', $u->id)->where('active', true)->exists()) {
            RuleError::fail('RN-CRM-03', 'No eres miembro de ningún número: no atiendes chats.');
        }
        DB::table('crm_agent_status')->insert(['user_id' => $u->id, 'status' => $estado, 'changed_at' => DB::raw('clock_timestamp()'), 'created_at' => now()]);

        return ['estado' => $estado, 'estado_name' => self::ESTADOS_AGENTE[$estado]];
    }

    public static function miEstado(User $u): array
    {
        $e = self::estados([$u->id])[$u->id] ?? 'OFFLINE';

        return ['estado' => $e, 'estado_name' => self::ESTADOS_AGENTE[$e],
            'miembro' => DB::table('channel_members')->where('user_id', $u->id)->where('active', true)->exists()];
    }

    /**
     * RN-CRM-02: a quién va el próximo chat del número; null si es manual o nadie cumple (queda en cola).
     */
    public static function elegir(string $canal, ?Carbon $cuando = null): ?string
    {
        $cuando ??= now('America/Lima');
        $c = DB::table('messaging_channels')->where('id', $canal)->first(['assignment_mode', 'brand_id', 'status']);
        if (! $c || $c->assignment_mode === 'MANUAL' || $c->status !== 'ACTIVE') {
            return null;
        }
        $ms = DB::table('channel_members as m')->join('users as x', 'x.id', '=', 'm.user_id')->where('m.channel_id', $canal)->where('m.active', true)
            ->where('m.member_role', 'AGENT')->where('x.status', 'ACTIVE')->get(['m.id', 'm.user_id', 'm.max_open_conversations']);
        if ($ms->isEmpty()) {
            return null;
        }
        $turnos = DB::table('channel_member_shifts')->whereIn('member_id', $ms->pluck('id'))->get()->groupBy('member_id');
        $estados = self::estados($ms->pluck('user_id')->all());
        $abiertos = self::abiertos($ms->pluck('user_id')->all());
        $ultimas = DB::table('conversation_assignments')->where('channel_id', $canal)->whereIn('to_user_id', $ms->pluck('user_id'))
            ->selectRaw('to_user_id, max(assigned_at) AS at')->groupBy('to_user_id')->pluck('at', 'to_user_id');
        $candidatas = $ms->filter(fn ($m) => ($estados[$m->user_id] ?? 'OFFLINE') === 'ONLINE' && self::enTurno(collect($turnos[$m->id] ?? [])->all(), $cuando, $c->brand_id)
            && (int) ($abiertos[$m->user_id] ?? 0) < (int) $m->max_open_conversations)
            ->map(fn ($m) => ['user' => $m->user_id, 'abiertos' => (int) ($abiertos[$m->user_id] ?? 0), 'ultima' => (string) ($ultimas[$m->user_id] ?? '')])->values()->all();
        if (! $candidatas) {
            return null;
        }
        usort($candidatas, $c->assignment_mode === 'LEAST_OPEN'
            ? fn ($a, $b) => [$a['abiertos'], $a['ultima']] <=> [$b['abiertos'], $b['ultima']]
            : fn ($a, $b) => [$a['ultima'], $a['abiertos']] <=> [$b['ultima'], $b['abiertos']]);

        return $candidatas[0]['user'];
    }

    /** ¿Está en turno? Con turnos propios, el del día; sin ellos, el horario de atención (crm_business_hours). */
    public static function enTurno(array $turnos, Carbon $cuando, ?string $marca = null): bool
    {
        $l = $cuando->copy()->setTimezone('America/Lima');
        $dia = (int) $l->isoWeekday();
        $hora = $l->format('H:i');
        if ($turnos) {
            foreach ($turnos as $t) {
                $t = (object) $t;
                if ((int) $t->weekday === $dia && $hora >= substr($t->time_from, 0, 5) && $hora < substr($t->time_to, 0, 5)) {
                    return true;
                }
            }

            return false;
        }
        $h = self::horario($marca)[$dia] ?? null;

        return $h !== null && $hora >= $h[0] && $hora < $h[1];
    }

    /** «lun-sáb 08:00-20:00, dom 09:00-14:00» => [1 => ['08:00', '20:00'], …, 7 => ['09:00', '14:00']]. */
    public static function horario(?string $marca = null): array
    {
        $txt = (string) (Params::get('crm_business_hours', $marca ? ['brand' => $marca] : []) ?? 'lun-sáb 08:00-20:00, dom 09:00-14:00');
        $dias = ['lun' => 1, 'mar' => 2, 'mie' => 3, 'mié' => 3, 'jue' => 4, 'vie' => 5, 'sab' => 6, 'sáb' => 6, 'dom' => 7];
        $out = [];
        foreach (preg_split('/\s*,\s*/', mb_strtolower($txt)) as $parte) {
            if (! preg_match('/^([a-záéíóú]+)(?:\s*-\s*([a-záéíóú]+))?\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/u', trim($parte), $m)) {
                continue;
            }
            $desde = $dias[$m[1]] ?? null;
            $hasta = $dias[$m[2] ?: $m[1]] ?? null;
            if ($desde && $hasta) {
                for ($d = $desde; $d <= $hasta; $d++) {
                    $out[$d] = [$m[3], $m[4]];
                }
            }
        }

        return $out;
    }

    private static function textoHorario(): string
    {
        return (string) (Params::get('crm_business_hours') ?? 'lun-sáb 08:00-20:00, dom 09:00-14:00');
    }

    /** «Lun a Vie 08:00–14:00 · Sáb 09:00–13:00»: agrupa los días seguidos con el mismo horario. */
    private static function textoTurnos($turnos): string
    {
        if ($turnos->isEmpty()) {
            return 'Horario de atención';
        }
        $grupos = [];
        foreach ($turnos->sortBy('weekday') as $t) {
            $h = substr($t->time_from, 0, 5).'–'.substr($t->time_to, 0, 5);
            $ult = count($grupos) - 1;
            if ($ult >= 0 && $grupos[$ult]['h'] === $h && $grupos[$ult]['hasta'] === (int) $t->weekday - 1) {
                $grupos[$ult]['hasta'] = (int) $t->weekday;
            } else {
                $grupos[] = ['desde' => (int) $t->weekday, 'hasta' => (int) $t->weekday, 'h' => $h];
            }
        }

        return implode(' · ', array_map(fn ($g) => self::DIAS[$g['desde']].($g['hasta'] > $g['desde'] ? ($g['hasta'] - $g['desde'] > 1 ? ' a ' : ' y ').self::DIAS[$g['hasta']] : '').' '.$g['h'], $grupos));
    }

    /** El último estado de cada persona (sin registro: desconectada). */
    public static function estados(array $usuarios): array
    {
        if (! $usuarios) {
            return [];
        }

        return DB::table('crm_agent_status')->whereIn('user_id', $usuarios)->selectRaw('DISTINCT ON (user_id) user_id, status')
            ->orderBy('user_id')->orderByDesc('changed_at')->orderByDesc('created_at')->pluck('status', 'user_id')->all();
    }

    public static function abiertos(array $usuarios): array
    {
        return DB::table('conversations')->whereIn('assigned_user_id', $usuarios)->where('status', '<>', 'CLOSED')
            ->selectRaw('assigned_user_id, count(*) AS n')->groupBy('assigned_user_id')->pluck('n', 'assigned_user_id')->all();
    }

    /** Vendedoras y supervisoras activas que se pueden agregar, con sus marcas. */
    private static function candidatos(): array
    {
        $roles = DB::table('user_roles as ur')->join('roles as r', 'r.id', '=', 'ur.role_id')->whereIn('r.code', ['VENDEDORA', 'SUPERVISORA_VENTAS'])
            ->pluck('r.code', 'ur.user_id');
        $marcas = DB::table('user_scopes as s')->join('brands as b', 'b.id', '=', 's.brand_id')->whereIn('s.user_id', $roles->keys())
            ->get(['s.user_id', 's.brand_id', 'b.name'])->groupBy('user_id');

        return DB::table('users')->whereIn('id', $roles->keys())->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name'])
            ->map(fn ($x) => ['value' => $x->id, 'label' => $x->name, 'rol' => $roles[$x->id] === 'VENDEDORA' ? 'Vendedora' : 'Supervisora',
                'marcas' => collect($marcas[$x->id] ?? [])->pluck('brand_id')->all(), 'marcas_texto' => collect($marcas[$x->id] ?? [])->pluck('name')->implode(', ') ?: 'Todas las marcas'])->all();
    }

    private static function rolDe(User $x): ?string
    {
        $roles = Access::for($x)['roles'];

        return in_array('VENDEDORA', $roles, true) ? 'AGENT' : (in_array('SUPERVISORA_VENTAS', $roles, true) ? 'SUPERVISOR' : null);
    }

    private static function validarTope(int $n): int
    {
        if ($n < 1 || $n > 100) {
            RuleError::fail('RN-CRM-02', 'El tope de chats abiertos va de 1 a 100.');
        }

        return $n;
    }
}
