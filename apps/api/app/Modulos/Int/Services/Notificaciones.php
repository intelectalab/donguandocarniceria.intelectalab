<?php

namespace App\Modulos\Int\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Paginas;
use App\Support\RuleError;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * INT-09 Centro de notificaciones e INT-10 Preferencias (RN-INT-15).
 *  - Cada aviso llega solo a su destinatario: a la persona (user_id) o a su rol (role, sin user_id).
 *  - Respeta las preferencias de la persona por tipo de aviso: si apagó «en la app» un tipo, no lo ve. Los críticos llegan
 *    siempre y su preferencia no se puede apagar.
 *  - Gerencia, administración del sistema y auditoría pueden ver todas las de la empresa, con su destinatario.
 *  - El correo y el push se guardan como preferencia; se envían cuando estén sus conectores (correo y Firebase).
 */
final class Notificaciones
{
    public const TIPOS = [
        'ORDERS' => 'Pedidos y entregas', 'STOCK' => 'Stock y vencimientos', 'DOCUMENTS' => 'Comprobantes y SUNAT', 'PAYMENTS' => 'Cobros y conciliación',
        'APPROVALS' => 'Aprobaciones pendientes', 'INTEGRATIONS' => 'Integraciones', 'SECURITY' => 'Seguridad y accesos', 'EXPORTS' => 'Exportaciones',
        'CRITICAL' => 'Avisos críticos',
    ];

    public const SEVERIDADES = ['CRITICAL' => 'Crítica', 'WARNING' => 'Advertencia', 'INFO' => 'Información', 'OK' => 'Correcto'];

    /** Roles que ven todas las notificaciones de la empresa (con su destinatario). */
    public const VEN_TODAS = ['GERENTE', 'ADMIN_SISTEMA', 'AUDITOR'];

    /** Roles que cambian las preferencias de otra persona. */
    public const CAMBIAN_PREFERENCIAS = ['GERENTE', 'ADMIN_SISTEMA'];

    /** Severidad de un aviso: la guardada, o la que dice su tono (los avisos antiguos no la traen). */
    private const SEVERIDAD_SQL = "coalesce(n.severity, CASE n.tone WHEN 'bad' THEN 'CRITICAL' WHEN 'warn' THEN 'WARNING' WHEN 'ok' THEN 'OK' ELSE 'INFO' END)";

    /**
     * Las notificaciones de la persona (suyas y de su rol), con cuándo la leyó ella (leida_en) y sin los tipos que apagó
     * en la app, salvo los críticos. Lo usan este centro y la campana.
     */
    public static function mias(User $u): Builder
    {
        $roles = Access::for($u)['roles'];
        $q = DB::table('notifications as n')
            ->leftJoin('notification_reads as r', fn ($j) => $j->on('r.notification_id', '=', 'n.id')->where('r.user_id', $u->id))
            ->where(fn ($w) => $w->where('n.user_id', $u->id)->orWhere(fn ($x) => $x->whereNull('n.user_id')->whereIn('n.role', $roles)))
            ->where(fn ($w) => $w->whereRaw(self::SEVERIDAD_SQL." = 'CRITICAL'")->orWhereNull('n.type')
                ->orWhereNotExists(fn ($p) => $p->from('notification_preferences as p')->whereColumn('p.type', 'n.type')->where('p.user_id', $u->id)->where('p.in_app', false)))
            ->select(['n.id', 'n.user_id', 'n.role', 'n.title', 'n.body', 'n.module', 'n.tone', 'n.type', 'n.ref', 'n.at'])
            ->selectRaw(self::SEVERIDAD_SQL.' AS severidad')
            ->selectRaw('CASE WHEN n.user_id IS NULL THEN r.read_at ELSE n.read_at END AS leida_en');

        return DB::query()->fromSub($q, 's');
    }

    public static function lista(array $f, User $u): array
    {
        $todas = ($f['scope'] ?? 'mine') === 'all';
        if ($todas && ! self::veTodas($u)) {
            RuleError::fail('RN-INT-15', 'Tu rol solo ve sus propias notificaciones.');
        }
        $q = $todas ? self::todas() : self::mias($u);
        if (! empty($f['severidad'])) {
            $q->where('severidad', $f['severidad']);
        }
        if (! empty($f['tipo'])) {
            $q->where('type', $f['tipo']);
        }
        if (! $todas && ! empty($f['lectura'])) {
            $f['lectura'] === 'U' ? $q->whereNull('leida_en') : $q->whereNotNull('leida_en');
        }
        if (! empty($f['buscar'])) {
            $t = '%'.addcslashes(trim($f['buscar']), '%_\\').'%';
            $q->where(fn ($w) => $w->where('title', 'ilike', $t)->orWhere('body', 'ilike', $t));
        }
        $q->orderByDesc('at')->orderBy('id');
        Paginas::ordenar($q, ['at' => 'at', 'severidad' => 'severidad', 'title' => 'title', 'type' => 'type', 'module' => 'module'], 'id', $f);

        $mias = self::mias($u);
        $c = DB::query()->fromSub($mias, 'm')->selectRaw(<<<'SQL'
            count(*) FILTER (WHERE leida_en IS NULL) AS sin_leer,
            count(*) FILTER (WHERE leida_en IS NULL AND severidad = 'CRITICAL') AS criticas,
            count(*) FILTER (WHERE at >= (SELECT coalesce(max(at), now()) FROM notifications) - interval '30 days') AS recibidas_30
            SQL)->first();
        $nombres = $todas ? self::nombresDestino() : [];
        $roles = Access::for($u)['roles'];

        return Paginas::de($q, fn ($n) => self::fila($n, $u->id, $roles, $nombres), $f) + [
            'cifras' => ['sin_leer' => (int) $c->sin_leer, 'criticas' => (int) $c->criticas, 'recibidas_30' => (int) $c->recibidas_30],
            've_todas' => self::veTodas($u), 'tipos' => self::TIPOS, 'severidades' => self::SEVERIDADES,
        ];
    }

    /** Marca una como leída o no leída, para esta persona (las de rol se marcan solo para ella). */
    public static function marcar(string $id, bool $leida, User $u): void
    {
        $n = DB::query()->fromSub(self::mias($u), 'm')->where('id', $id)->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        if ($n->user_id !== null) {
            DB::table('notifications')->where('id', $id)->where('user_id', $u->id)->update(['read_at' => $leida ? now() : null, 'updated_at' => now()]);
        } elseif ($leida) {
            DB::table('notification_reads')->insertOrIgnore(['notification_id' => $id, 'user_id' => $u->id, 'read_at' => now()]);
        } else {
            DB::table('notification_reads')->where('notification_id', $id)->where('user_id', $u->id)->delete();
        }
    }

    public static function marcarTodas(User $u): int
    {
        $pendientes = DB::query()->fromSub(self::mias($u), 'm')->whereNull('leida_en')->get(['id', 'user_id']);
        foreach ($pendientes as $n) {
            self::marcar($n->id, true, $u);
        }

        return $pendientes->count();
    }

    /** INT-10: las preferencias de una persona, un renglón por tipo; sin fila guardada, en la app sí y lo demás no. */
    public static function preferencias(string $userId, User $quien): array
    {
        $persona = self::persona($userId, $quien);
        $guardadas = DB::table('notification_preferences')->where('user_id', $persona->id)->get()->keyBy('type');
        $filas = collect(self::TIPOS)->map(function ($nombre, $tipo) use ($guardadas) {
            $p = $guardadas[$tipo] ?? null;
            $critico = $tipo === 'CRITICAL';

            return ['type' => $tipo, 'name' => $nombre, 'fijo' => $critico, 'in_app' => $critico || ($p ? (bool) $p->in_app : true),
                'email' => $critico || ($p && $p->email), 'push' => $critico || ($p && $p->push)];
        })->values();

        return ['usuario' => ['id' => $persona->id, 'name' => $persona->name], 'data' => $filas, 'puede_elegir' => self::cambiaOtras($quien),
            'usuarios' => self::cambiaOtras($quien) ? DB::table('users')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name']) : []];
    }

    public static function guardarPreferencia(string $userId, string $tipo, array $canales, User $quien): array
    {
        $persona = self::persona($userId, $quien);
        if ($tipo === 'CRITICAL') {
            RuleError::fail('RN-INT-15', 'Los avisos críticos llegan siempre: no se pueden apagar.');
        }
        $actual = DB::table('notification_preferences')->where('user_id', $persona->id)->where('type', $tipo)->first();
        $valores = ['in_app' => $canales['in_app'] ?? ($actual ? (bool) $actual->in_app : true), 'email' => $canales['email'] ?? ($actual ? (bool) $actual->email : false),
            'push' => $canales['push'] ?? ($actual ? (bool) $actual->push : false)];
        if ($actual) {
            DB::table('notification_preferences')->where('id', $actual->id)->update($valores + ['updated_at' => now()]);
        } else {
            DB::table('notification_preferences')->insert($valores + ['user_id' => $persona->id, 'type' => $tipo, 'created_at' => now(), 'updated_at' => now()]);
        }

        return self::preferencias($persona->id, $quien);
    }

    /**
     * Sin códigos internos de reglas en pantalla: los avisos de la demostración (y algunos antiguos) los traen al final
     * entre paréntesis o al inicio («RN-INT-04: …»).
     */
    public static function sinCodigos(?string $t): string
    {
        $t = preg_replace('/\s*\((?:[A-Z]{2,4}-)?RN-[A-Z]{2,4}-\d+[a-z]?\)/u', '', (string) $t);
        $t = preg_replace('/^RN-[A-Z]{2,4}-\d+[a-z]?:\s*/u', '', $t);

        return trim((string) $t);
    }

    public static function veTodas(User $u): bool
    {
        return (bool) array_intersect(Access::for($u)['roles'], self::VEN_TODAS);
    }

    private static function cambiaOtras(User $u): bool
    {
        return (bool) array_intersect(Access::for($u)['roles'], self::CAMBIAN_PREFERENCIAS);
    }

    /** La persona cuyas preferencias se ven o cambian: uno mismo, o cualquiera si es gerencia o administración del sistema. */
    private static function persona(string $userId, User $quien): object
    {
        if ($userId !== $quien->id && ! self::cambiaOtras($quien)) {
            RuleError::fail('RN-INT-15', 'Solo puedes cambiar tus propias preferencias.');
        }

        return DB::table('users')->where('id', $userId)->first(['id', 'name']) ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
    }

    /** Todas las de la empresa, para quien las puede ver (sin marca de lectura propia). */
    private static function todas(): Builder
    {
        $q = DB::table('notifications as n')->select(['n.id', 'n.user_id', 'n.role', 'n.title', 'n.body', 'n.module', 'n.tone', 'n.type', 'n.ref', 'n.at', 'n.read_at as leida_en'])
            ->selectRaw(self::SEVERIDAD_SQL.' AS severidad');

        return DB::query()->fromSub($q, 's');
    }

    private static function nombresDestino(): array
    {
        return ['users' => DB::table('users')->pluck('name', 'id')->all(), 'roles' => DB::table('roles')->pluck('name', 'code')->all()];
    }

    private static function fila(object $n, string $yo, array $roles, array $nombres): array
    {
        $ref = json_decode($n->ref ?? 'null', true);

        return [
            'id' => $n->id, 'title' => self::sinCodigos($n->title), 'body' => self::sinCodigos($n->body), 'module' => $n->module, 'tone' => $n->tone, 'type' => $n->type,
            'type_name' => self::TIPOS[$n->type ?? ''] ?? 'General', 'severity' => $n->severidad, 'severity_name' => self::SEVERIDADES[$n->severidad] ?? $n->severidad,
            'read' => $n->leida_en !== null, 'at' => $n->at, 'mia' => $n->user_id === $yo || ($n->user_id === null && in_array($n->role, $roles, true)),
            'destino' => $nombres ? ($n->user_id ? ($nombres['users'][$n->user_id] ?? 'Persona') : 'Rol '.($nombres['roles'][$n->role] ?? $n->role)) : null,
            'link' => is_array($ref) && isset($ref['href']) ? $ref['href'] : ($n->module ? '/m/'.strtolower($n->module) : null),
        ];
    }
}
