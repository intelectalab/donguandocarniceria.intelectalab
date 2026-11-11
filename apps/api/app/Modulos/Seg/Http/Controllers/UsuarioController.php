<?php

namespace App\Modulos\Seg\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Modulos\Seg\Services\Bitacora;
use App\Modulos\Seg\Services\Sesiones;
use App\Modulos\Seg\Services\Usuarios;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * SEG-08 Usuarios y SEG-09 Ficha del usuario. Los usuarios del portal de clientes (B2B, con
 * customer_id) no salen aquí: son del módulo B2B. El estado que se muestra es el efectivo: un usuario activo con un
 * bloqueo por intentos vigente se ve como bloqueado.
 */
class UsuarioController extends Controller
{
    private const ESTADO = "CASE WHEN u.status = 'ACTIVE' AND u.locked_until > now() THEN 'LOCKED' ELSE u.status END";

    public function index(Request $request)
    {
        $q = $this->base()
            ->when($request->query('role'), fn ($x, $v) => $x->whereExists(fn ($s) => $s->from('user_roles as fr')->join('roles as frr', 'frr.id', '=', 'fr.role_id')
                ->whereColumn('fr.user_id', 'u.id')->where('frr.code', $v)))
            ->when($request->query('establishment_id'), fn ($x, $v) => $x->whereExists(fn ($s) => $s->from('user_scopes as fs')->whereColumn('fs.user_id', 'u.id')->where('fs.establishment_id', $v)))
            ->when($request->query('brand_id'), fn ($x, $v) => $x->whereExists(fn ($s) => $s->from('user_scopes as fb')->whereColumn('fb.user_id', 'u.id')->where('fb.brand_id', $v)))
            ->when($request->query('status'), fn ($x, $v) => $x->whereRaw(self::ESTADO.' = ?', [$v]));

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $request, buscar: ['name', 'email', 'roles_names'],
            ordenar: ['name', 'email', 'estado', 'last_login', 'roles_names'], porDefecto: 'name'));
    }

    /** Cifras de la cabecera (KPI-SEG-01 cobertura del segundo factor, KPI-SEG-03 sin uso). */
    public function resumen()
    {
        $dias = Usuarios::diasSinUso();
        $t = DB::table('users as u')->where(fn ($w) => $w->whereNull('u.user_type')->orWhere('u.user_type', '<>', 'B2B_CUSTOMER'))->whereNull('u.customer_id')
            ->selectRaw('count(*) total,
                count(*) filter (where '.self::ESTADO." = 'ACTIVE') activos,
                count(*) filter (where ".self::ESTADO." = 'LOCKED') bloqueados,
                count(*) filter (where u.status = 'INACTIVE') inactivos,
                count(*) filter (where u.status = 'INVITED') invitados,
                count(*) filter (where u.status = 'ACTIVE' and (u.last_login is null or u.last_login < now() - make_interval(days => ?))) sin_uso,
                count(*) filter (where u.status = 'ACTIVE' and exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id and r.requires_mfa)) exigen_2fa,
                count(*) filter (where u.status = 'ACTIVE' and u.twofa_enabled and exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id and r.requires_mfa)) con_2fa",
                [$dias])->first();

        return response()->json([
            'total' => (int) $t->total, 'activos' => (int) $t->activos, 'bloqueados' => (int) $t->bloqueados, 'inactivos' => (int) $t->inactivos,
            'invitados' => (int) $t->invitados, 'sin_uso' => (int) $t->sin_uso, 'dias_sin_uso' => $dias,
            'exigen_2fa' => (int) $t->exigen_2fa, 'con_2fa' => (int) $t->con_2fa,
            'cobertura_2fa' => $t->exigen_2fa ? round($t->con_2fa / $t->exigen_2fa * 100, 1) : 100.0,
        ]);
    }

    /** Roles, trabajadores, marcas y locales para el formulario. */
    public function opciones()
    {
        $vinculados = DB::table('users')->whereNotNull('employee_id')->pluck('id', 'employee_id');

        return response()->json([
            'roles' => DB::table('roles')->where('status', 'ACTIVE')->whereNotIn('code', Usuarios::NO_ASIGNABLES)->orderBy('name')
                ->get(['id', 'code', 'name', 'scope_mode', 'requires_mfa', 'is_system', 'description']),
            'employees' => DB::table('employees')->where('status', 'ACTIVE')->orderBy('full_name')->get(['id', 'full_name', 'position', 'establishment_id'])
                ->map(fn ($e) => (array) $e + ['user_id' => $vinculados[$e->id] ?? null]),
            'brands' => DB::table('brands')->where('status', 'ACTIVE')->orderBy('sort_order')->get(['id', 'code', 'name']),
            'establishments' => DB::table('establishments')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'code', 'short', 'name']),
        ]);
    }

    public function show(string $id)
    {
        $u = $this->base()->where('u.id', $id)->first() ?? abort(404, 'Usuario no encontrado.');
        // Un solo rol por usuario; si los datos antiguos traen más, el principal es el de users.role y la ficha avisa.
        $u->role_ids = DB::table('user_roles')->where('user_id', $id)->pluck('role_id');
        $u->role_id = DB::table('roles')->where('code', DB::table('users')->where('id', $id)->value('role'))->value('id') ?? $u->role_ids->first();
        $u->brand_ids = DB::table('user_scopes')->where('user_id', $id)->whereNotNull('brand_id')->pluck('brand_id');
        $u->establishment_ids = DB::table('user_scopes')->where('user_id', $id)->whereNotNull('establishment_id')->pluck('establishment_id');
        // La sesión con la que se está mirando la ficha se marca como «actual».
        $actual = request()->user()?->currentAccessToken()?->id;
        // Abiertas (sin vencer por fecha ni por inactividad, RN-SEG-09) y anteriores (archivadas al cerrarse o vencer).
        $ses = Sesiones::delUsuario($id, $actual, 30);
        $u->sessions = $ses['abiertas']->concat($ses['anteriores'])->values();
        $u->devices = DB::table('user_devices as d')->leftJoin('users as a', 'a.id', '=', 'd.approved_by')->where('d.user_id', $id)->orderByDesc('d.last_seen_at')
            ->get(['d.id', 'd.name', 'd.platform', 'd.status', 'd.fingerprint_hint', 'd.requested_at', 'd.approved_at', 'a.name as approved_by_name',
                'd.revoked_at', 'd.revoke_reason', 'd.last_seen_at']);

        return response()->json($u);
    }

    /** Bitácora de accesos del usuario (AUD-03), paginada. */
    public function accesos(Request $request, string $id)
    {
        $u = User::findOrFail($id);
        // Lo que hizo el usuario, lo que intentaron con su correo y lo que otros hicieron sobre su cuenta.
        $q = DB::table('access_log')->where(fn ($w) => $w->where('user_id', $id)->orWhereRaw('lower(email_attempted) = ?', [mb_strtolower($u->email)])
            ->orWhere(fn ($x) => $x->where('entity', 'users')->where('entity_id', $id)))
            ->when($request->query('event'), fn ($x, $v) => $x->where('event', $v))
            ->select(['id', 'event', 'result', 'ip', 'device', 'user_agent', 'detail', 'details', 'at', 'user_name']);

        $pagina = Listado::de($q, $request, buscar: ['detail', 'ip'], ordenar: ['at', 'event'], porDefecto: '-at');
        $pagina->getCollection()->transform(function ($f) {
            $f->event_name = Bitacora::EVENTOS[$f->event] ?? $f->event;
            $f->details = $f->details ? json_decode($f->details, true) : null;

            return $f;
        });

        return response()->json($pagina);
    }

    public function store(Request $request)
    {
        $u = Usuarios::crear($this->datos($request), $request->user());

        return response()->json($this->show($u->id)->getData(), 201);
    }

    public function update(Request $request, string $id)
    {
        Usuarios::actualizar(User::findOrFail($id), $this->datos($request, false), $request->user());

        return $this->show($id);
    }

    public function bloquear(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:80']], ['reason.min' => 'Escribe el motivo (al menos 5 letras).']);
        Usuarios::bloquear(User::findOrFail($id), $d['reason'], $request->user());

        return $this->show($id);
    }

    public function desbloquear(Request $request, string $id)
    {
        Usuarios::desbloquear(User::findOrFail($id), $request->user());

        return $this->show($id);
    }

    public function desactivar(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:255']], ['reason.min' => 'Escribe el motivo (al menos 5 letras).']);
        Usuarios::desactivar(User::findOrFail($id), $d['reason'], $request->user());

        return $this->show($id);
    }

    public function reactivar(Request $request, string $id)
    {
        Usuarios::reactivar(User::findOrFail($id), $request->user());

        return $this->show($id);
    }

    public function reinvitar(Request $request, string $id)
    {
        Usuarios::reinvitar(User::findOrFail($id), $request->user());

        return response()->json(['message' => 'Invitación enviada otra vez.']);
    }

    public function cerrarSesiones(Request $request, string $id, ?string $tokenId = null)
    {
        $n = Usuarios::cerrarSesiones(User::findOrFail($id), $request->user(), $tokenId);

        return response()->json(['cerradas' => $n]);
    }

    public function reiniciarSegundoFactor(Request $request, string $id)
    {
        Usuarios::reiniciarSegundoFactor(User::findOrFail($id), $request->user());

        return $this->show($id);
    }

    /** Usuarios de la empresa con sus roles y alcance en texto, para la lista y la ficha. */
    private function base()
    {
        return DB::table('users as u')
            ->leftJoin('employees as e', 'e.id', '=', 'u.employee_id')
            ->where(fn ($w) => $w->whereNull('u.user_type')->orWhere('u.user_type', '<>', 'B2B_CUSTOMER'))->whereNull('u.customer_id')
            ->selectRaw('u.id, u.name, u.email, u.status, '.self::ESTADO.' as estado, u.twofa_enabled, u.twofa_required, u.mfa_enrolled_at, u.last_login,
                u.locked_until, u.lock_reason, u.failed_logins, u.deactivated_at, u.deactivated_reason, u.invited_at, u.invited_by, u.employee_id,
                u.password_changed_at, u.created_at, e.full_name as employee_name, e.position as employee_position,
                (select string_agg(r.code, \',\' order by r.code) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id) as roles_codes,
                (select string_agg(r.name, \', \' order by r.name) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id) as roles_names,
                (select bool_or(r.requires_mfa) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id) as exige_2fa,
                (select bool_and(r.scope_mode = \'ASSIGNED\') from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id) as alcance_asignado,
                (select string_agg(b.name, \', \' order by b.sort_order) from user_scopes s join brands b on b.id = s.brand_id where s.user_id = u.id) as scope_brands,
                (select string_agg(es.short, \', \' order by es.code) from user_scopes s join establishments es on es.id = s.establishment_id where s.user_id = u.id) as scope_sites,
                coalesce(ses.n, 0) as sesiones')
            ->leftJoinSub(Sesiones::vigentes(DB::table('personal_access_tokens'))->selectRaw('tokenable_id, count(*) n')->groupBy('tokenable_id'), 'ses', 'ses.tokenable_id', '=', 'u.id');
    }

    private function datos(Request $request, bool $nuevo = true): array
    {
        $request->merge(['email' => mb_strtolower(trim((string) $request->input('email')))]);

        return $request->validate([
            'name' => [$nuevo ? 'required' : 'sometimes', 'string', 'min:3', 'max:255'],
            'email' => [$nuevo ? 'required' : 'prohibited', 'email:rfc', 'max:80'],
            'role_id' => ['required', 'uuid'],
            'employee_id' => ['nullable', 'uuid'],
            'brand_ids' => ['nullable', 'array', 'max:50'],
            'brand_ids.*' => ['uuid', 'exists:brands,id'],
            'establishment_ids' => ['nullable', 'array', 'max:50'],
            'establishment_ids.*' => ['uuid', 'exists:establishments,id'],
        ], [
            'email.email' => 'Escribe un correo válido.',
            'email.prohibited' => 'El correo no se cambia desde aquí.',
            'role_id.required' => 'Elige el rol.',
        ]);
    }
}
