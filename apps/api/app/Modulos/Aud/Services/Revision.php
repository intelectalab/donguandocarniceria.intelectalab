<?php

namespace App\Modulos\Aud\Services;

use App\Models\User;
use App\Modulos\Seg\Services\Usuarios;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * AUD-08 Revisión de accesos (RN-AUD-10, CA-AUD-06). Cada trimestre la gerencia revisa usuarios, roles, alcance y
 * último ingreso; se propone desactivar a quien no ingresa hace seg_inactive_user_days días o tiene su trabajador cesado.
 * Mientras está abierta, las decisiones se guardan (no se pierden al salir); al cerrarla se desactiva a los marcados
 * (con SEG: motivo, sesiones cerradas, celulares revocados) y queda una foto de lo revisado con sus hallazgos.
 */
class Revision
{
    public const DECISIONES = ['KEEP' => 'Mantener', 'CHANGE' => 'Cambiar', 'DEACTIVATE' => 'Desactivar'];

    /** Roles que deberían tener segundo factor. */
    private const SENSIBLES = ['GERENTE', 'ADMIN_SISTEMA', 'CONTADORA', 'ADMINISTRACION'];

    public static function trimestre(?Carbon $d = null): string
    {
        $d ??= now('America/Lima');

        return $d->year.'-T'.(int) ceil($d->month / 3);
    }

    public static function diasInactivo(): int
    {
        return max(1, (int) (Params::get('seg_inactive_user_days') ?? 60));
    }

    /** AUD-08: la revisión del trimestre (con sus usuarios si está abierta), las cifras y las cerradas. */
    public static function panel(User $quien): array
    {
        $q = self::trimestre();
        $actual = DB::table('access_reviews')->where('quarter', $q)->first();
        $abierta = $actual && $actual->status === 'OPEN';
        $todos = self::items($abierta ? self::borrador($actual) : []);
        $cerradas = DB::table('access_reviews')->where('status', 'COMPLETED')->orderByDesc('quarter')->get()->map(fn ($r) => self::resumen($r))->all();

        return [
            'trimestre' => $q,
            'actual' => $actual ? self::resumen($actual) : null,
            'items' => $abierta ? $todos : null,
            'cifras' => self::aTiempo() + ['inactivos' => count(array_filter($todos, fn ($i) => $i['inactivo'] && $i['status'] === 'ACTIVE')), 'dias' => self::diasInactivo()],
            'cerradas' => $cerradas,
            'decisiones' => collect(self::DECISIONES)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all(),
        ];
    }

    /** Abre la revisión del trimestre (si ya existe, la devuelve). */
    public static function iniciar(?User $quien = null): object
    {
        $q = self::trimestre();
        if ($r = DB::table('access_reviews')->where('quarter', $q)->first()) {
            return $r;
        }
        $hoy = now('America/Lima');
        $fin = $hoy->copy()->firstOfQuarter()->addMonths(3)->subDay()->toDateString();
        $id = DB::table('access_reviews')->insertGetId(['number' => "RA-{$q}", 'quarter' => $q, 'status' => 'OPEN', 'opened_at' => now(), 'due_date' => $fin,
            'items' => json_encode((object) []), 'created_at' => now(), 'updated_at' => now()], 'id');
        Events::emit('access_review.due', 'access_reviews', $id, ['quarter' => $q, 'by' => $quien?->id]);

        return DB::table('access_reviews')->where('id', $id)->first();
    }

    /** Guarda la decisión sobre una persona mientras la revisión está abierta. */
    public static function decidir(string $id, string $usuario, string $decision, ?string $nota): array
    {
        $r = self::abierta($id);
        if (! isset(self::DECISIONES[$decision])) {
            RuleError::fail('RN-AUD-10', 'La decisión es mantener, cambiar o desactivar.');
        }
        if (! DB::table('users')->where('id', $usuario)->where('status', '<>', 'INACTIVE')->exists()) {
            RuleError::fail('RN-AUD-10', 'Esa persona no está en la revisión.');
        }
        DB::transaction(function () use ($r, $usuario, $decision, $nota) {
            DB::table('access_reviews')->where('id', $r->id)->lockForUpdate()->first();
            $b = self::borrador(DB::table('access_reviews')->where('id', $r->id)->first());
            $b[$usuario] = ['decision' => $decision, 'note' => mb_substr(trim((string) $nota), 0, 300)];
            DB::table('access_reviews')->where('id', $r->id)->update(['items' => json_encode($b, JSON_UNESCAPED_UNICODE), 'updated_at' => now()]);
        });

        return collect(self::items(self::borrador(self::abierta($id))))->firstWhere('user_id', $usuario);
    }

    /**
     * Cierra la revisión: desactiva a los marcados «Desactivar» (menos a quien cierra y a quien SEG no deja, como el único
     * administrador) y guarda la foto de lo revisado con los hallazgos.
     */
    public static function cerrar(string $id, string $hallazgos, User $quien): array
    {
        $r = self::abierta($id);
        if (mb_strlen(trim($hallazgos)) < 10) {
            RuleError::fail('RN-AUD-10', 'Escribe los hallazgos y acuerdos de la revisión (al menos 10 caracteres).');
        }
        $items = self::items(self::borrador($r));
        $desactivados = [];
        foreach ($items as &$it) {
            if ($it['decision'] !== 'DEACTIVATE') {
                continue;
            }
            if ($it['user_id'] === $quien->id) {
                $it['resultado'] = 'No se desactivó: es quien cierra la revisión.';

                continue;
            }
            $motivo = "Revisión de accesos {$r->quarter}: ".($it['flags'] ? implode('; ', $it['flags']) : ($it['last_login'] ? "sin ingreso hace {$it['days_inactive']} días" : 'nunca ingresó'));
            try {
                Usuarios::desactivar(User::findOrFail($it['user_id']), $motivo, $quien);
                $it['resultado'] = 'Desactivado';
                $desactivados[] = $it['user_id'];
            } catch (RuleError $e) {
                $it['resultado'] = 'No se desactivó: '.$e->getMessage();
            }
        }
        unset($it);
        $cambios = count(array_filter($items, fn ($i) => $i['decision'] === 'CHANGE'));
        $auto = count($items).' usuarios revisados; '.count($desactivados).' desactivado(s); '.$cambios.' con cambios de rol o alcance pendientes.';
        $foto = array_map(fn ($i) => array_intersect_key($i, array_flip(['user_id', 'name', 'email', 'role', 'role_name', 'alcance', 'last_login', 'days_inactive',
            'flags', 'proposal', 'decision', 'note', 'resultado'])), $items);
        DB::table('access_reviews')->where('id', $r->id)->update([
            'status' => 'COMPLETED', 'closed_at' => now(), 'reviewer' => mb_substr($quien->name, 0, 120), 'reviewer_id' => $quien->id,
            'items' => json_encode($foto, JSON_UNESCAPED_UNICODE), 'deactivated' => json_encode($desactivados), 'findings' => $auto.' '.trim($hallazgos), 'updated_at' => now(),
        ]);
        Events::emit('access_review.closed', 'access_reviews', $r->id, ['quarter' => $r->quarter, 'reviewed' => count($items), 'deactivated' => count($desactivados), 'by' => $quien->id]);

        return self::ver($r->id);
    }

    /** Una revisión cerrada, con lo revisado. */
    public static function ver(string $id): array
    {
        $r = DB::table('access_reviews')->where('id', $id)->first() ?? abort(404);
        $items = $r->status === 'COMPLETED' ? array_values((array) json_decode((string) $r->items, true)) : self::items(self::borrador($r));
        $nombres = DB::table('users')->whereIn('id', array_filter((array) json_decode((string) $r->deactivated, true), fn ($x) => is_string($x) && strlen($x) === 36))->pluck('name')->all();

        return self::resumen($r) + ['items' => array_map(fn ($i) => $i + ['role_name' => $i['role_name'] ?? ($i['role'] ?? ''), 'decision_name' => self::DECISIONES[$i['decision'] ?? 'KEEP'] ?? ''], $items),
            'desactivados_nombres' => $nombres];
    }

    /** Para la tarea programada: abre la revisión del trimestre y avisa a quienes la hacen. Devuelve si la abrió. */
    public static function abrirDelTrimestre(): bool
    {
        if (DB::table('access_reviews')->where('quarter', self::trimestre())->exists()) {
            return false;
        }
        $r = self::iniciar();
        $roles = DB::table('role_permissions as rp')->join('permissions as p', 'p.id', '=', 'rp.permission_id')->where('p.code', 'aud.access_review.run')->pluck('rp.role_id');
        $personas = DB::table('users as u')->join('user_roles as ur', 'ur.user_id', '=', 'u.id')->whereIn('ur.role_id', $roles)->where('u.status', 'ACTIVE')->distinct()->pluck('u.id');
        $inactivos = count(array_filter(self::items([]), fn ($i) => $i['inactivo'] && $i['status'] === 'ACTIVE'));
        foreach ($personas as $p) {
            DB::table('notifications')->insert(['user_id' => $p, 'module' => 'AUD', 'tone' => 'info', 'severity' => 'INFO', 'type' => 'APPROVALS', 'at' => now(),
                'title' => "Revisión de accesos {$r->quarter} pendiente", 'body' => "Revisa usuarios, roles y alcance antes del ".Carbon::parse($r->due_date)->format('d/m/Y').". {$inactivos} usuario(s) sin ingreso reciente.",
                'ref' => json_encode(['href' => '/m/aud/aud-08'])]);
        }

        return true;
    }

    /**
     * Los usuarios vigentes con rol, alcance, último ingreso, hallazgos y la propuesta; con la decisión guardada si la hay.
     *
     * @param  array<string, array{decision: string, note?: string}>  $borrador
     */
    public static function items(array $borrador): array
    {
        $lim = self::diasInactivo();
        $hoy = now('America/Lima')->startOfDay();
        $usuarios = DB::table('users as u')->where('u.status', '<>', 'INACTIVE')
            ->leftJoin('employees as e', 'e.id', '=', 'u.employee_id')
            ->selectRaw("u.id, u.name, u.email, u.status, u.employee_id, u.user_type, u.twofa_enabled, u.totp_secret_enc IS NOT NULL AND u.totp_secret_enc <> '' AS con_totp,
                u.created_at, e.status AS empleado, greatest(u.last_login, (SELECT max(a.at) FROM access_log a WHERE a.user_id = u.id AND a.event = 'LOGIN_OK')) AS ultimo")
            ->orderBy('u.name')->get();
        $roles = DB::table('user_roles as ur')->join('roles as r', 'r.id', '=', 'ur.role_id')->get(['ur.user_id', 'r.code', 'r.name'])->groupBy('user_id');
        $alcance = DB::table('user_scopes as s')->leftJoin('brands as b', 'b.id', '=', 's.brand_id')->leftJoin('establishments as l', 'l.id', '=', 's.establishment_id')
            ->get(['s.user_id', 'b.name as marca', 'l.name as local'])->groupBy('user_id');
        $out = [];
        foreach ($usuarios as $u) {
            $rol = $roles[$u->id][0] ?? null;
            $codigo = $rol->code ?? '';
            $marcas = collect($alcance[$u->id] ?? [])->pluck('marca')->filter()->unique()->values()->all();
            $locales = collect($alcance[$u->id] ?? [])->pluck('local')->filter()->unique()->values()->all();
            $ultimo = $u->ultimo;
            $desde = Carbon::parse($ultimo ?? $u->created_at)->setTimezone('America/Lima')->startOfDay();
            $dias = (int) $desde->diffInDays($hoy);
            $b2b = $u->user_type === 'B2B_CUSTOMER' || $codigo === 'CLIENTE_B2B';
            $flags = [];
            if (in_array($codigo, self::SENSIBLES, true) && ! ($u->twofa_enabled && $u->con_totp)) {
                $flags[] = 'Rol sensible sin segundo factor';
            }
            if ($codigo === 'SOPORTE_PLATAFORMA') {
                $flags[] = 'Acceso de soporte permanente: debe ser temporal';
            }
            if ($codigo === 'VENDEDORA' && ! $marcas) {
                $flags[] = 'Vendedora sin restricción de marca';
            }
            if ($u->status === 'LOCKED') {
                $flags[] = 'Cuenta bloqueada';
            }
            if (! $u->employee_id && ! $b2b) {
                $flags[] = 'Sin trabajador vinculado';
            }
            if ($u->employee_id && $u->empleado === 'INACTIVE') {
                $flags[] = 'Trabajador cesado con usuario vigente';
            }
            $inactivo = $dias >= $lim;
            $propuesta = $inactivo || in_array('Trabajador cesado con usuario vigente', $flags, true) ? 'DEACTIVATE' : ($flags ? 'CHANGE' : 'KEEP');
            $guardada = $borrador[$u->id] ?? null;
            $out[] = [
                'user_id' => $u->id, 'name' => $u->name, 'email' => $u->email, 'status' => $u->status, 'role' => $codigo, 'role_name' => $rol->name ?? 'Sin rol',
                'alcance' => ($marcas ? implode(', ', $marcas) : 'Todas las marcas').' · '.($locales ? implode(', ', $locales) : 'Todos los locales'),
                'last_login' => $ultimo, 'days_inactive' => $dias, 'inactivo' => $inactivo, 'flags' => $flags, 'proposal' => $propuesta,
                'decision' => $guardada['decision'] ?? $propuesta, 'note' => $guardada['note'] ?? '', 'decidida' => (bool) $guardada,
            ];
        }

        return $out;
    }

    /** KPI-AUD-02: revisiones cerradas dentro de su trimestre / trimestres que debían revisarse. */
    private static function aTiempo(): array
    {
        $primera = DB::table('access_reviews')->min('quarter');
        if (! $primera) {
            return ['a_tiempo' => null, 'a_tiempo_ok' => 0, 'a_tiempo_de' => 0];
        }
        [$anio, $t] = array_map('intval', explode('-T', $primera));
        $m = Carbon::create($anio, ($t - 1) * 3 + 1, 1, 0, 0, 0, 'America/Lima');
        $hoy = now('America/Lima')->toDateString();
        $hechas = DB::table('access_reviews')->where('status', 'COMPLETED')->get(['quarter', 'closed_at', 'due_date'])->keyBy('quarter');
        $de = 0;
        $ok = 0;
        while ($m->toDateString() <= $hoy) {
            $fin = $m->copy()->addMonths(3)->subDay()->toDateString();
            $q = self::trimestre($m);
            if ($fin <= $hoy || isset($hechas[$q])) {
                $de++;
                $h = $hechas[$q] ?? null;
                if ($h && Carbon::parse($h->closed_at)->setTimezone('America/Lima')->toDateString() <= $fin) {
                    $ok++;
                }
            }
            $m->addMonths(3);
        }

        return ['a_tiempo' => $de ? round($ok / $de * 100, 1) : null, 'a_tiempo_ok' => $ok, 'a_tiempo_de' => $de];
    }

    private static function abierta(string $id): object
    {
        $r = DB::table('access_reviews')->where('id', $id)->first() ?? abort(404);
        if ($r->status !== 'OPEN') {
            RuleError::fail('RN-AUD-10', 'La revisión ya está cerrada.');
        }

        return $r;
    }

    /** Las decisiones guardadas de una revisión abierta: {user_id: {decision, note}}. */
    private static function borrador(object $r): array
    {
        $b = json_decode((string) ($r->items ?? ''), true);

        return is_array($b) && ! array_is_list($b) ? $b : [];
    }

    private static function resumen(object $r): array
    {
        $items = json_decode((string) ($r->items ?? ''), true);
        $lista = is_array($items) && array_is_list($items) ? $items : [];
        $cierre = $r->closed_at ? Carbon::parse($r->closed_at)->setTimezone('America/Lima')->toDateString() : null;

        return [
            'id' => $r->id, 'number' => $r->number, 'quarter' => $r->quarter, 'status' => $r->status, 'opened_at' => $r->opened_at, 'due_date' => $r->due_date,
            'closed_at' => $r->closed_at, 'reviewer' => $r->reviewer, 'findings' => $r->findings,
            'revisados' => count($lista), 'desactivados' => count((array) json_decode((string) ($r->deactivated ?? '[]'), true)),
            'a_tiempo' => $cierre ? $cierre <= $r->due_date : null,
        ];
    }
}
