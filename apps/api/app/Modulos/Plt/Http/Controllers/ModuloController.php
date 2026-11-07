<?php

namespace App\Modulos\Plt\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Plt\Services\Modulos;
use App\Support\Access;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** PLT-12 Módulos: encender y apagar con sus dependencias, y la lista de activación de Telefonía. */
class ModuloController extends Controller
{
    /** Catálogo con el estado de la empresa, quién depende de quién, las cifras y la lista de TEL. */
    public function index()
    {
        $catalogo = Modulos::catalogo();
        $on = Modulos::encendidos();
        $estado = DB::table('tenant_modules')->get()->keyBy('module_code');

        $modulos = array_values(array_map(function ($m) use ($catalogo, $on, $estado) {
            $t = $estado->get($m->code);

            return [
                'code' => $m->code, 'name' => Modulos::corto($m->name), 'description' => trim(explode(':', $m->name, 2)[1] ?? ''),
                'is_core' => (bool) $m->is_core, 'plataforma' => in_array($m->code, Modulos::DE_LA_PLATAFORMA, true),
                'enabled' => ! empty($on[$m->code]),
                'depends_on' => $m->depends_on, 'uses' => $m->uses,
                'dependientes' => Modulos::dependientes($m->code, $catalogo),
                'changed_at' => $t?->changed_at, 'changed_by' => $t?->changed_by, 'reason' => $t?->reason,
            ];
        }, $catalogo));

        $apagados = array_values(array_filter($modulos, fn ($m) => ! $m['enabled']));

        return response()->json([
            'modulos' => $modulos,
            'resumen' => [
                'total' => count($modulos),
                'encendidos' => count($modulos) - count($apagados),
                'apagados' => array_column($apagados, 'code'),
                'nucleo' => array_column(array_filter($modulos, fn ($m) => $m['is_core']), 'code'),
            ],
            'tel' => Modulos::pasosTel(),
            // Quién puede marcar pasos: personas activas de gerencia, sistemas, ventas y administración.
            'responsables' => DB::table('users')->where('status', 'ACTIVE')
                ->whereIn('role', ['ADMIN_SISTEMA', 'GERENTE', 'SUPERVISORA_VENTAS', 'ADMINISTRACION'])->orderBy('name')->get(['id', 'name']),
        ]);
    }

    /** Eventos de encendido y apagado de un módulo. */
    public function eventos(string $code)
    {
        return response()->json(DB::table('domain_events')->whereIn('event_name', ['module.enabled', 'module.disabled'])
            ->whereRaw("payload->>'module' = ?", [$code])->orderByDesc('occurred_at')->limit(30)
            ->get(['event_name', 'payload', 'occurred_at']));
    }

    public function cambiar(Request $request, string $code)
    {
        $datos = $request->validate([
            'enabled' => ['required', 'boolean'],
            'reason' => ['required', 'string', 'max:255'],
        ], ['reason.required' => 'Escribe el motivo.']);

        return response()->json(Modulos::cambiar($code, $datos['enabled'], $datos['reason'], $request->user()));
    }

    /** Marcar un paso de la lista de TEL (plt.module.toggle o tel.settings.manage). */
    public function marcarPaso(Request $request, string $paso)
    {
        $this->exigirPermisoTel($request);
        $datos = $request->validate([
            'notes' => ['required', 'string', 'max:2000'],
            'done_by' => ['nullable', 'uuid', Rule::exists('users', 'id')],
        ], ['notes.required' => 'Escribe la evidencia: documento, constancia o prueba realizada.']);
        abort_if($paso === 'SWITCH_ON', response()->json(['message' => 'El encendido se marca al encender Telefonía.', 'code' => 'RN-TEL-02'], 422));
        Modulos::marcarPaso($paso, $request->user(), $datos['notes'], $datos['done_by'] ?? null);

        return response()->json(Modulos::pasosTel());
    }

    public function deshacerPaso(Request $request, string $paso)
    {
        $this->exigirPermisoTel($request);
        Modulos::deshacerPaso($paso);

        return response()->json(Modulos::pasosTel());
    }

    private function exigirPermisoTel(Request $request): void
    {
        $u = $request->user();
        // tel.settings.manage es de TEL, que puede estar apagado: por eso se mira también plt.module.toggle.
        abort_unless(Access::can($u, 'plt.module.toggle') || Access::can($u, 'tel.settings.manage'),
            response()->json(['message' => 'No tienes el permiso plt.module.toggle.', 'code' => 'PERMISSION_DENIED'], 403));
    }
}
