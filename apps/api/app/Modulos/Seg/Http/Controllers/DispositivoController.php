<?php

namespace App\Modulos\Seg\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Seg\Services\Dispositivos;
use App\Support\Access;
use App\Support\Listado;
use App\Support\Params;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * SEG-13 Dispositivos de la app: celulares de repartidores y visitadores pendientes, aprobados y
 * revocados, con aprobar y revocar (que también usa la ficha del usuario, SEG-09). Reglas en Dispositivos.
 * Como el prototipo, la lista es de celulares: los equipos web no piden aprobación (D-SEG-03).
 */
class DispositivoController extends Controller
{
    public function index(Request $request)
    {
        $this->puedeVer($request);
        $q = DB::table('user_devices as d')->join('users as u', 'u.id', '=', 'd.user_id')->leftJoin('users as a', 'a.id', '=', 'd.approved_by')
            ->where('d.platform', '<>', 'WEB')
            ->when($request->query('status'), fn ($x, $v) => $x->where('d.status', $v))
            ->when($request->query('platform'), fn ($x, $v) => $x->where('d.platform', $v))
            ->selectRaw('d.id, d.user_id, u.name as user_name, u.email,
                (select string_agg(r.name, \', \' order by r.name) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id) as roles_names,
                d.name, d.platform, d.status, d.fingerprint_hint, d.requested_at, d.approved_at, a.name as approved_by_name, d.revoked_at, d.revoke_reason, d.last_seen_at');

        $pagina = Listado::de(DB::query()->fromSub($q, 's'), $request, buscar: ['user_name', 'email', 'name', 'roles_names'],
            ordenar: ['user_name', 'name', 'status', 'requested_at', 'last_seen_at'], porDefecto: '-requested_at');
        $cuenta = DB::table('user_devices')->where('platform', '<>', 'WEB')->selectRaw("count(*) filter (where status = 'PENDING') pendientes,
            count(*) filter (where status = 'APPROVED') aprobados, count(*) filter (where status = 'REVOKED') revocados")->first();
        $exigida = Params::get('seg_mobile_device_approval');

        return response()->json($pagina->toArray() + [
            'resumen' => [
                'pendientes' => (int) $cuenta->pendientes, 'aprobados' => (int) $cuenta->aprobados, 'revocados' => (int) $cuenta->revocados,
                'aprobacion_exigida' => ! in_array(strtolower((string) ($exigida ?? 'true')), ['false', 'no', 'n', '0'], true),
            ],
        ]);
    }

    public function aprobar(Request $request, string $id)
    {
        return response()->json(Dispositivos::aprobar($id, $request->user()));
    }

    public function revocar(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:80']], ['reason.min' => 'Escribe el motivo (al menos 5 letras).']);

        return response()->json(Dispositivos::revocar($id, $d['reason'], $request->user()));
    }

    /** Ve la lista quien tiene el módulo de Seguridad o quien aprueba celulares (el coordinador de delivery). */
    private function puedeVer(Request $request): void
    {
        $u = $request->user();
        abort_unless(Access::module($u, 'SEG') || Access::can($u, Dispositivos::PERMISO),
            response()->json(['message' => 'No tienes acceso a los dispositivos.', 'code' => 'PERMISSION_DENIED'], 403));
    }
}
