<?php

namespace App\Modulos\Seg\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Modulos\Seg\Services\Sesiones;
use App\Modulos\Seg\Services\Usuarios;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * SEG-15 Sesiones activas de la empresa (seg.session.view_all para ver, seg.session.revoke para
 * cerrar) y SEG-07 Mis sesiones y dispositivos (cada persona, las suyas).
 */
class SesionController extends Controller
{
    /** Sesiones vigentes de toda la empresa, con su usuario, cliente, dispositivo e IP. */
    public function index(Request $request)
    {
        $actual = $request->user()->currentAccessToken()?->id;
        $q = Sesiones::vigentes(DB::table('personal_access_tokens as t'), 't')->join('users as u', 'u.id', '=', 't.tokenable_id')
            ->when($request->query('user_id'), fn ($x, $v) => $x->where('t.tokenable_id', $v))
            ->when($request->query('client'), fn ($x, $v) => $x->where('t.name', $v))
            ->when($request->query('role'), fn ($x, $v) => $x->whereExists(fn ($s) => $s->from('user_roles as ur')->join('roles as r', 'r.id', '=', 'ur.role_id')
                ->whereColumn('ur.user_id', 'u.id')->where('r.code', $v)))
            ->selectRaw('t.id, t.tokenable_id as user_id, u.name as user_name, u.email, u.role, t.name as client, t.ip, t.device,
                t.created_at, coalesce(t.last_used_at, t.created_at) as last_used_at, t.expires_at, (t.id = ?) as actual,
                count(*) over (partition by t.tokenable_id) as sesiones_usuario', [$actual]);

        $pagina = Listado::de(DB::query()->fromSub($q, 's'), $request, buscar: ['user_name', 'email', 'ip', 'device'],
            ordenar: ['user_name', 'created_at', 'last_used_at', 'expires_at'], porDefecto: '-last_used_at');

        $vigentes = Sesiones::vigentes(DB::table('personal_access_tokens'));
        $politica = Sesiones::politica();

        return response()->json($pagina->toArray() + [
            'resumen' => [
                'sesiones' => (clone $vigentes)->count(),
                'usuarios' => (clone $vigentes)->distinct()->count('tokenable_id'),
                'moviles' => (clone $vigentes)->whereIn('name', Sesiones::MOVILES)->count(),
            ],
            'politica' => $politica,
            'usuarios' => DB::table('users')->whereIn('id', (clone $vigentes)->select('tokenable_id'))->orderBy('name')->get(['id', 'name']),
            'roles' => DB::table('roles')->where('status', 'ACTIVE')->orderBy('name')->get(['code', 'name']),
        ]);
    }

    /** Cierra una sesión de otra persona (o todas las de un usuario con ?user_id). Nunca la propia actual. */
    public function cerrar(Request $request, string $tokenId)
    {
        $userId = DB::table('personal_access_tokens')->where('id', $tokenId)->value('tokenable_id') ?? abort(404, 'Sesión no encontrada.');
        $n = Usuarios::cerrarSesiones(User::findOrFail($userId), $request->user(), $tokenId);

        return response()->json(['cerradas' => $n]);
    }

    /** SEG-07: mis sesiones vigentes, mis dispositivos y la política que rige. */
    public function mias(Request $request)
    {
        $u = $request->user();
        $actual = $u->currentAccessToken()?->id;

        $ses = Sesiones::delUsuario($u->id, $actual);

        return response()->json([
            'sesiones' => $ses['abiertas'],
            'anteriores' => $ses['anteriores'],
            'dispositivos' => DB::table('user_devices as d')->leftJoin('users as a', 'a.id', '=', 'd.approved_by')->where('d.user_id', $u->id)
                ->orderByDesc('d.last_seen_at')->get(['d.id', 'd.name', 'd.platform', 'd.status', 'd.requested_at', 'd.approved_at', 'a.name as approved_by_name',
                    'd.revoke_reason', 'd.last_seen_at']),
            'ultimo_ingreso' => $u->last_login,
            'politica' => Sesiones::politica(),
        ]);
    }

    public function cerrarMia(Request $request, string $tokenId)
    {
        Sesiones::cerrarPropia($request->user(), $tokenId);

        return response()->json(['cerradas' => 1]);
    }

    public function cerrarLasDemas(Request $request)
    {
        return response()->json(['cerradas' => Sesiones::cerrarLasDemas($request->user())]);
    }
}
