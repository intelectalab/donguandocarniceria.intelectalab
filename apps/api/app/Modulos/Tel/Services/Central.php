<?php

namespace App\Modulos\Tel\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * La central (RN-TEL-04 y 06): TEL-03 Números y desvíos, TEL-04 Menú de voz y horario y TEL-05 Grupos de llamada.
 *
 * Un número de la central atiende con el menú de voz (por defecto, uno general con una opción por marca, D-TEL-02) o
 * directo con el grupo de una marca. Los celulares de la publicidad se desvían a la central desde el operador. Cada marca
 * tiene su grupo de vendedoras con prioridad: por turno, cada una suena unos segundos en orden; o todas a la vez.
 */
class Central
{
    public const TIPOS = ['LANDLINE_LIMA' => 'Fijo de Lima', 'VIRTUAL_MOBILE' => 'Móvil virtual', 'TOLL_FREE' => 'Línea gratuita 0800'];

    public const ESTADOS = ['ACTIVE' => 'Activo', 'INACTIVE' => 'Inactivo'];

    public const FUERA_DE_HORARIO = ['CALLBACK_TASK' => 'Tarea de devolver la llamada', 'VOICEMAIL' => 'Buzón de voz (también deja la tarea)', 'FORWARD' => 'Desviar a la supervisora'];

    public const ESTRATEGIAS = ['ROUND_ROBIN' => 'Por turno', 'SIMULTANEOUS' => 'Todas a la vez'];

    public const DIGITOS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    private static function exigir(User $u): void
    {
        if (! Access::can($u, 'tel.settings.manage')) {
            RuleError::fail('RN-TEL-02', 'La central la configura el administrador del sistema.');
        }
    }

    /** Un celular o fijo peruano en E.164 (+51…); vacío si no se puede leer. */
    public static function e164(?string $n): string
    {
        $d = preg_replace('/[^\d+]/', '', (string) $n);
        if (str_starts_with($d, '+')) {
            return $d;
        }
        if (preg_match('/^9\d{8}$/', $d)) {
            return '+51'.$d;
        }
        if (preg_match('/^51\d{9}$/', $d)) {
            return '+'.$d;
        }
        if (preg_match('/^1\d{7}$/', $d)) {
            return '+51'.$d;
        }

        return $d === '' ? '' : '+'.$d;
    }

    private static function marcas(User $u): array
    {
        $ok = Access::for($u)['brands'];

        return DB::table('brands')->when($ok, fn ($w) => $w->whereIn('id', $ok))->where('status', 'ACTIVE')->orderBy('name')
            ->get(['id', 'name'])->map(fn ($b) => ['value' => $b->id, 'label' => $b->name])->all();
    }

    /* ------------------------------------------------------------------ TEL-03 Números */

    public static function numeros(array $f, User $u): array
    {
        $q = DB::table('tel_numbers as n')->leftJoin('brands as b', 'b.id', '=', 'n.brand_id')->leftJoin('tel_menus as m', 'm.id', '=', 'n.menu_id')
            ->leftJoin('tel_ring_groups as g', 'g.id', '=', 'n.ring_group_id');
        foreach (['estado' => 'n.status', 'tipo' => 'n.number_kind', 'marca' => 'n.brand_id'] as $k => $col) {
            if (! empty($f[$k])) {
                $f[$k] === 'GENERAL' && $k === 'marca' ? $q->whereNull('n.brand_id') : $q->where($col, $f[$k]);
            }
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes(preg_replace('/\s+/', '', $t), '%_\\').'%';
            $q->where(fn ($w) => $w->where('n.e164', 'ilike', $p)->orWhereRaw('n.forwarded_from::text ILIKE ?', [$p])->orWhere('n.provider_ref', 'ilike', $p));
        }
        $q->orderByRaw("CASE n.status WHEN 'ACTIVE' THEN 0 ELSE 1 END")->orderByRaw('n.brand_id IS NOT NULL')->orderBy('n.e164');
        Paginas::ordenar($q, ['numero' => 'n.e164', 'tipo' => 'n.number_kind', 'marca' => "coalesce(b.name, '')", 'estado' => 'n.status'], 'n.id', $f);
        $q->select(['n.*', 'b.name as marca', 'm.name as menu', 'g.name as grupo']);

        return Paginas::de($q, fn ($n) => [
            'id' => $n->id, 'e164' => $n->e164, 'number_kind' => $n->number_kind, 'tipo' => self::TIPOS[$n->number_kind] ?? $n->number_kind,
            'brand_id' => $n->brand_id, 'marca' => $n->marca ?? 'General', 'menu_id' => $n->menu_id, 'ring_group_id' => $n->ring_group_id,
            'atiende' => $n->menu_id ? 'Menú: '.$n->menu : ($n->ring_group_id ? 'Grupo: '.$n->grupo : '—'),
            'forwarded_from' => json_decode((string) $n->forwarded_from, true) ?: [], 'provider_ref' => $n->provider_ref, 'status' => $n->status,
        ], $f) + [
            'opciones' => [
                'tipos' => self::opciones(self::TIPOS), 'estados' => self::opciones(self::ESTADOS), 'marcas' => self::marcas($u),
                'menus' => DB::table('tel_menus')->orderBy('name')->get(['id', 'name', 'status'])->map(fn ($m) => ['value' => $m->id, 'label' => $m->name.($m->status !== 'ACTIVE' ? ' (inactivo)' : '')])->all(),
                'grupos' => DB::table('tel_ring_groups')->orderBy('name')->get(['id', 'name'])->map(fn ($g) => ['value' => $g->id, 'label' => $g->name])->all(),
            ],
            'whatsapp' => DB::table('messaging_channels')->where('kind', 'WHATSAPP')->orderBy('display_name')->get(['number', 'display_name'])
                ->map(fn ($c) => ['numero' => $c->number, 'nombre' => $c->display_name])->all(),
            'puede' => Access::can($u, 'tel.settings.manage'),
        ];
    }

    public static function guardarNumero(?string $id, array $d, User $u): array
    {
        self::exigir($u);
        $antes = $id ? (DB::table('tel_numbers')->where('id', $id)->first() ?? abort(404)) : null;
        $numero = self::e164($d['e164']);
        if (! preg_match('/^\+\d{8,15}$/', $numero)) {
            RuleError::fail('RN-TEL-03', 'El número va en formato internacional: + y de 8 a 15 dígitos (por ejemplo +5117085500).');
        }
        if (DB::table('tel_numbers')->where('e164', $numero)->when($id, fn ($q) => $q->where('id', '<>', $id))->exists()) {
            RuleError::fail('RN-TEL-03', "El número {$numero} ya está registrado.");
        }
        $marca = $d['brand_id'] ?? null;
        $permitidas = Access::for($u)['brands'];
        if ($marca && $permitidas && ! in_array($marca, $permitidas, true)) {
            RuleError::fail('RN-TEL-03', 'Esa marca no es tuya.');
        }
        $menu = $d['menu_id'] ?? null;
        $grupo = $d['ring_group_id'] ?? null;
        if ($d['status'] === 'ACTIVE' && ! $menu && ! $grupo) {
            RuleError::fail('RN-TEL-06', 'Elige con qué atiende el número: el menú de voz o un grupo de llamada.');
        }
        if ($menu && $grupo) {
            RuleError::fail('RN-TEL-06', 'Un número atiende con el menú de voz o con un grupo, no con los dos.');
        }
        if ($menu && ! DB::table('tel_menus')->where('id', $menu)->exists()) {
            abort(404);
        }
        if ($grupo && ! DB::table('tel_ring_groups')->where('id', $grupo)->exists()) {
            abort(404);
        }
        $desvios = [];
        foreach ($d['forwarded_from'] ?? [] as $x) {
            $n = self::e164($x);
            if (! preg_match('/^\+519\d{8}$/', $n)) {
                RuleError::fail('RN-TEL-03', "{$x} no es un celular peruano: se desvían los celulares de la publicidad (9 dígitos).");
            }
            if ($n === $numero) {
                RuleError::fail('RN-TEL-03', 'Un número no se desvía a sí mismo.');
            }
            $desvios[$n] = true;
        }
        $desvios = array_keys($desvios);
        foreach ($desvios as $n) {
            $otro = DB::table('tel_numbers')->whereRaw('forwarded_from @> ?::jsonb', [json_encode([$n])])->when($id, fn ($q) => $q->where('id', '<>', $id))->value('e164');
            if ($otro) {
                RuleError::fail('RN-TEL-03', "{$n} ya se desvía al número {$otro}.");
            }
        }
        $fila = ['e164' => $numero, 'number_kind' => $d['number_kind'], 'brand_id' => $marca, 'menu_id' => $menu, 'ring_group_id' => $grupo,
            'forwarded_from' => json_encode($desvios), 'provider_ref' => isset($d['provider_ref']) ? (mb_substr(trim($d['provider_ref']), 0, 60) ?: null) : null, 'status' => $d['status'], 'updated_at' => now()];
        if ($antes) {
            DB::table('tel_numbers')->where('id', $id)->update($fila);
        } else {
            $id = DB::table('tel_numbers')->insertGetId($fila + ['created_at' => now()], 'id');
        }
        Events::emit($antes ? 'tel.number_updated' : 'tel.number_created', 'tel_numbers', $id, ['by' => $u->id, 'e164' => $numero, 'status' => $d['status']]);

        return (array) DB::table('tel_numbers')->where('id', $id)->first();
    }

    /* ------------------------------------------------------------------ TEL-04 Menú de voz */

    public static function menu(User $u): array
    {
        $m = DB::table('tel_menus')->orderByRaw("CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END")->orderBy('created_at')->first();
        $grupos = DB::table('tel_ring_groups as g')->join('brands as b', 'b.id', '=', 'g.brand_id')->orderBy('b.name')->get(['g.id', 'g.name', 'g.brand_id', 'b.name as marca']);
        $sup = DB::table('users as x')->join('user_roles as ur', 'ur.user_id', '=', 'x.id')->join('roles as r', 'r.id', '=', 'ur.role_id')
            ->where('r.code', 'SUPERVISORA_VENTAS')->where('x.status', 'ACTIVE')->orderBy('x.name')->get(['x.id', 'x.name']);
        $ops = $m ? (json_decode((string) $m->options, true) ?: []) : [];
        $horas = $m ? (json_decode((string) $m->business_hours, true) ?: []) : [];
        $marcas = DB::table('brands')->pluck('name', 'id');
        $nombres = DB::table('users')->whereIn('id', array_filter(array_column($ops, 'direct_user_id')))->pluck('name', 'id');

        return [
            'id' => $m?->id, 'name' => $m->name ?? 'Menú general', 'greeting_text' => $m->greeting_text ?? '', 'after_hours_action' => $m->after_hours_action ?? 'CALLBACK_TASK',
            'status' => $m->status ?? 'ACTIVE',
            'horario' => ['lun_sab' => $horas['mon_sat'] ?? ['08:00', '20:00'], 'dom' => $horas['sun'] ?? null],
            'opciones' => array_map(fn ($o) => [
                'digit' => (int) $o['digit'], 'tipo' => ! empty($o['direct_user_id']) ? 'SUPERVISORA' : 'MARCA', 'brand_id' => $o['brand_id'] ?? null, 'direct_user_id' => $o['direct_user_id'] ?? null,
                'etiqueta' => ! empty($o['direct_user_id']) ? 'Supervisora: '.($nombres[$o['direct_user_id']] ?? '—') : ($marcas[$o['brand_id'] ?? ''] ?? ($o['label'] ?? '—')),
                'grupo' => collect($grupos)->firstWhere('id', $o['ring_group_id'] ?? null)?->name,
            ], $ops),
            'numeros' => $m ? DB::table('tel_numbers')->where('menu_id', $m->id)->where('status', 'ACTIVE')->pluck('e164')->all() : [],
            'grabacion' => (bool) DB::table('tel_settings')->value('recording_enabled'),
            'listas' => [
                'marcas' => $grupos->map(fn ($g) => ['value' => $g->brand_id, 'label' => $g->marca])->all(),
                'sin_grupo' => DB::table('brands')->where('status', 'ACTIVE')->whereNotIn('id', $grupos->pluck('brand_id'))->orderBy('name')->pluck('name')->all(),
                'supervisoras' => $sup->map(fn ($x) => ['value' => $x->id, 'label' => $x->name])->all(),
                'fuera_de_horario' => self::opciones(self::FUERA_DE_HORARIO),
            ],
            'puede' => Access::can($u, 'tel.settings.manage'),
        ];
    }

    public static function guardarMenu(array $d, User $u): array
    {
        self::exigir($u);
        $saludo = trim($d['greeting_text']);
        if (DB::table('tel_settings')->value('recording_enabled') && ! preg_match('/grabad/iu', $saludo)) {
            RuleError::fail('RN-TEL-04', 'Con grabación, el saludo incluye el aviso: «Esta llamada puede ser grabada para fines de calidad».');
        }
        $hora = '/^([01]\d|2[0-3]):[0-5]\d$/';
        $lunSab = $d['horario']['lun_sab'] ?? null;
        $dom = $d['horario']['dom'] ?? null;
        foreach (['de lunes a sábado' => $lunSab, 'del domingo' => $dom] as $nombre => $h) {
            if ($h === null) {
                continue;
            }
            if (! is_array($h) || count($h) !== 2 || ! preg_match($hora, (string) $h[0]) || ! preg_match($hora, (string) $h[1])) {
                RuleError::fail('RN-TEL-06', "El horario {$nombre} va con hora de inicio y fin (HH:MM).");
            }
            if ($h[0] >= $h[1]) {
                RuleError::fail('RN-TEL-06', "En el horario {$nombre}, la hora final debe ser después de la inicial.");
            }
        }
        if (! $lunSab) {
            RuleError::fail('RN-TEL-06', 'Indica el horario de atención de lunes a sábado.');
        }
        $grupos = DB::table('tel_ring_groups')->pluck('id', 'brand_id');
        $digitos = [];
        $marcas = [];
        $ops = [];
        foreach ($d['opciones'] ?? [] as $o) {
            $dig = (int) $o['digit'];
            if (! in_array($dig, self::DIGITOS, true) || isset($digitos[$dig])) {
                RuleError::fail('RN-TEL-06', 'Cada opción va con un dígito del 1 al 9, sin repetir.');
            }
            $digitos[$dig] = true;
            if ($o['tipo'] === 'SUPERVISORA') {
                $sup = DB::table('users as x')->join('user_roles as ur', 'ur.user_id', '=', 'x.id')->join('roles as r', 'r.id', '=', 'ur.role_id')
                    ->where('x.id', $o['direct_user_id'] ?? null)->where('r.code', 'SUPERVISORA_VENTAS')->where('x.status', 'ACTIVE')->first(['x.id', 'x.name']);
                if (! $sup) {
                    RuleError::fail('RN-TEL-06', "En la opción {$dig}, elige una supervisora de ventas activa.");
                }
                $ops[] = ['digit' => $dig, 'label' => 'Supervisora', 'brand_id' => null, 'ring_group_id' => null, 'direct_user_id' => $sup->id];

                continue;
            }
            $b = $o['brand_id'] ?? null;
            if (! $b || ! isset($grupos[$b])) {
                RuleError::fail('RN-TEL-06', "La marca de la opción {$dig} no tiene grupo de llamada: créalo primero en Grupos de llamada.");
            }
            if (isset($marcas[$b])) {
                RuleError::fail('RN-TEL-06', 'Una marca está en dos opciones del menú.');
            }
            $marcas[$b] = true;
            $ops[] = ['digit' => $dig, 'label' => (string) DB::table('brands')->where('id', $b)->value('name'), 'brand_id' => $b, 'ring_group_id' => $grupos[$b]];
        }
        if (! $ops) {
            RuleError::fail('RN-TEL-06', 'El menú lleva al menos una opción.');
        }
        usort($ops, fn ($a, $b) => $a['digit'] <=> $b['digit']);
        $fila = ['name' => mb_substr(trim($d['name']), 0, 120), 'greeting_text' => mb_substr($saludo, 0, 1000), 'after_hours_action' => $d['after_hours_action'],
            'business_hours' => json_encode(['mon_sat' => $lunSab, 'sun' => $dom, 'holidays' => 'closed']), 'options' => json_encode($ops, JSON_UNESCAPED_UNICODE),
            'status' => 'ACTIVE', 'updated_at' => now()];
        $id = DB::table('tel_menus')->orderByRaw("CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END")->orderBy('created_at')->value('id');
        if ($id) {
            DB::table('tel_menus')->where('id', $id)->update($fila);
        } else {
            $id = DB::table('tel_menus')->insertGetId($fila + ['created_at' => now()], 'id');
        }
        Events::emit('tel.menu_saved', 'tel_menus', $id, ['by' => $u->id, 'options' => count($ops)]);

        return self::menu($u);
    }

    /* ------------------------------------------------------------------ TEL-05 Grupos */

    /** El orden en que suena un grupo (RN-TEL-06): por turno, cada una sus segundos en orden; o todas a la vez. */
    public static function plan(object $g, array $miembros): array
    {
        // Solo suenan las activas en el grupo cuyo usuario sigue activo.
        $activos = array_values(array_filter($miembros, fn ($m) => $m['active'] && ($m['usuario_activo'] ?? true)));
        $s = (int) $g->ring_timeout_s;
        if ($g->strategy === 'SIMULTANEOUS') {
            return $activos ? [['nombres' => array_column($activos, 'nombre'), 'desde' => 0, 'hasta' => $s]] : [];
        }

        return array_map(fn ($m, $i) => ['nombres' => [$m['nombre']], 'desde' => $i * $s, 'hasta' => ($i + 1) * $s], $activos, array_keys($activos));
    }

    public static function grupos(array $f, User $u): array
    {
        $ok = Access::for($u)['brands'];
        $q = DB::table('tel_ring_groups as g')->join('brands as b', 'b.id', '=', 'g.brand_id')->when($ok, fn ($w) => $w->whereIn('g.brand_id', $ok))
            ->when(! empty($f['marca']), fn ($w) => $w->where('g.brand_id', $f['marca']))->when(! empty($f['estrategia']), fn ($w) => $w->where('g.strategy', $f['estrategia']));
        $t = mb_strtolower(trim((string) ($f['buscar'] ?? '')));
        $grupos = $q->orderBy('b.name')->get(['g.*', 'b.name as marca']);
        $miembros = DB::table('tel_ring_members as m')->join('users as x', 'x.id', '=', 'm.user_id')->whereIn('m.group_id', $grupos->pluck('id'))
            ->orderBy('m.priority')->get(['m.id', 'm.group_id', 'm.user_id', 'm.priority', 'm.active', 'x.name', 'x.status as user_status'])->groupBy('group_id');
        $datos = [];
        foreach ($grupos as $g) {
            $ms = collect($miembros[$g->id] ?? [])->map(fn ($m) => ['id' => $m->id, 'user_id' => $m->user_id, 'nombre' => $m->name, 'priority' => (int) $m->priority,
                'active' => (bool) $m->active, 'usuario_activo' => $m->user_status === 'ACTIVE'])->values()->all();
            if (mb_strlen($t) >= 2 && ! str_contains(mb_strtolower($g->name.' '.$g->marca.' '.implode(' ', array_column($ms, 'nombre'))), $t)) {
                continue;
            }
            $datos[] = ['id' => $g->id, 'name' => $g->name, 'brand_id' => $g->brand_id, 'marca' => $g->marca, 'strategy' => $g->strategy,
                'estrategia' => self::ESTRATEGIAS[$g->strategy] ?? $g->strategy, 'ring_timeout_s' => (int) $g->ring_timeout_s, 'miembros' => $ms, 'plan' => self::plan($g, $ms),
                'numeros' => DB::table('tel_numbers')->where('ring_group_id', $g->id)->where('status', 'ACTIVE')->pluck('e164')->all()];
        }

        return [
            'data' => $datos,
            'opciones' => ['marcas' => self::marcas($u), 'estrategias' => self::opciones(self::ESTRATEGIAS),
                'sin_grupo' => collect(self::marcas($u))->whereNotIn('value', DB::table('tel_ring_groups')->pluck('brand_id'))->values()->all()],
            'puede' => Access::can($u, 'tel.settings.manage'),
        ];
    }

    public static function guardarGrupo(?string $id, array $d, User $u): array
    {
        self::exigir($u);
        $antes = $id ? (DB::table('tel_ring_groups')->where('id', $id)->first() ?? abort(404)) : null;
        $marca = $antes->brand_id ?? $d['brand_id'];
        $ok = Access::for($u)['brands'];
        if ($ok && ! in_array($marca, $ok, true)) {
            RuleError::fail('RN-TEL-06', 'Esa marca no es tuya.');
        }
        if (! $antes && DB::table('tel_ring_groups')->where('brand_id', $marca)->exists()) {
            RuleError::fail('RN-TEL-06', 'Esa marca ya tiene su grupo de llamada.');
        }
        $fila = ['name' => mb_substr(trim($d['name']), 0, 120), 'strategy' => $d['strategy'], 'ring_timeout_s' => (int) $d['ring_timeout_s'], 'updated_at' => now()];
        if ($antes) {
            DB::table('tel_ring_groups')->where('id', $id)->update($fila);
        } else {
            $id = DB::table('tel_ring_groups')->insertGetId($fila + ['brand_id' => $marca, 'created_at' => now()], 'id');
        }
        Events::emit($antes ? 'tel.group_updated' : 'tel.group_created', 'tel_ring_groups', $id, ['by' => $u->id]);

        return (array) DB::table('tel_ring_groups')->where('id', $id)->first();
    }

    /** Agregar una vendedora (de la marca del grupo) o una supervisora de ventas al final de la prioridad. */
    public static function agregarMiembro(string $grupo, string $usuario, User $u): array
    {
        self::exigir($u);
        $g = DB::table('tel_ring_groups')->where('id', $grupo)->first() ?? abort(404);
        $x = DB::table('users')->where('id', $usuario)->where('status', 'ACTIVE')->first(['id', 'name']) ?? RuleError::fail('RN-TEL-06', 'La persona debe ser un usuario activo.');
        $roles = DB::table('user_roles as ur')->join('roles as r', 'r.id', '=', 'ur.role_id')->where('ur.user_id', $usuario)->pluck('r.code')->all();
        if (! array_intersect($roles, ['VENDEDORA', 'SUPERVISORA_VENTAS'])) {
            RuleError::fail('RN-TEL-06', "{$x->name} no es vendedora ni supervisora de ventas.");
        }
        if (in_array('VENDEDORA', $roles, true)) {
            $alcance = DB::table('user_scopes')->where('user_id', $usuario)->whereNotNull('brand_id')->pluck('brand_id')->all();
            if ($alcance && ! in_array($g->brand_id, $alcance, true)) {
                RuleError::fail('RN-TEL-06', "{$x->name} no atiende esa marca (se cambia en Usuarios).");
            }
        }
        if (DB::table('tel_ring_members')->where('group_id', $grupo)->where('user_id', $usuario)->exists()) {
            RuleError::fail('RN-TEL-06', "{$x->name} ya está en el grupo.");
        }
        $prioridad = (int) DB::table('tel_ring_members')->where('group_id', $grupo)->max('priority') + 1;
        $id = DB::table('tel_ring_members')->insertGetId(['group_id' => $grupo, 'user_id' => $usuario, 'priority' => min($prioridad, 99), 'active' => true,
            'created_at' => now(), 'updated_at' => now()], 'id');
        Events::emit('tel.member_added', 'tel_ring_members', $id, ['by' => $u->id, 'group' => $grupo, 'user' => $usuario]);

        return self::grupos([], $u);
    }

    /** Pausar o activar, o subir o bajar en la prioridad (intercambia con la vecina). */
    public static function cambiarMiembro(string $id, array $d, User $u): array
    {
        self::exigir($u);
        $m = DB::table('tel_ring_members')->where('id', $id)->first() ?? abort(404);
        DB::transaction(function () use ($m, $d, $u) {
            if (isset($d['active'])) {
                DB::table('tel_ring_members')->where('id', $m->id)->update(['active' => (bool) $d['active'], 'updated_at' => now()]);
            }
            if (! empty($d['mover'])) {
                $vecina = DB::table('tel_ring_members')->where('group_id', $m->group_id)
                    ->where('priority', $d['mover'] === 'subir' ? '<' : '>', $m->priority)->orderBy('priority', $d['mover'] === 'subir' ? 'desc' : 'asc')->first();
                if ($vecina) {
                    DB::table('tel_ring_members')->where('id', $vecina->id)->update(['priority' => $m->priority, 'updated_at' => now()]);
                    DB::table('tel_ring_members')->where('id', $m->id)->update(['priority' => $vecina->priority, 'updated_at' => now()]);
                }
            }
            Events::emit('tel.member_changed', 'tel_ring_members', $m->id, ['by' => $u->id] + $d);
        });

        return self::grupos([], $u);
    }

    /** Personas que se pueden agregar a un grupo: vendedoras de la marca (o de todas) y supervisoras de ventas. */
    public static function candidatos(string $grupo): array
    {
        $g = DB::table('tel_ring_groups')->where('id', $grupo)->first() ?? abort(404);
        $ya = DB::table('tel_ring_members')->where('group_id', $grupo)->pluck('user_id')->all();

        return DB::table('users as x')->join('user_roles as ur', 'ur.user_id', '=', 'x.id')->join('roles as r', 'r.id', '=', 'ur.role_id')
            ->whereIn('r.code', ['VENDEDORA', 'SUPERVISORA_VENTAS'])->where('x.status', 'ACTIVE')->whereNotIn('x.id', $ya)
            ->where(fn ($w) => $w->where('r.code', 'SUPERVISORA_VENTAS')->orWhereNotExists(fn ($s) => $s->from('user_scopes as s')->whereColumn('s.user_id', 'x.id')->whereNotNull('s.brand_id'))
                ->orWhereExists(fn ($s) => $s->from('user_scopes as s')->whereColumn('s.user_id', 'x.id')->where('s.brand_id', $g->brand_id)))
            ->orderBy('x.name')->get(['x.id', 'x.name', 'r.code'])
            ->map(fn ($x) => ['value' => $x->id, 'label' => $x->name.($x->code === 'SUPERVISORA_VENTAS' ? ' (supervisora)' : '')])->unique('value')->values()->all();
    }

    private static function opciones(array $xs): array
    {
        return collect($xs)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all();
    }
}
