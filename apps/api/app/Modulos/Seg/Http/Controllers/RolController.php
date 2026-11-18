<?php

namespace App\Modulos\Seg\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Seg\Services\Roles;
use App\Support\Exportar;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** SEG-10 Roles, SEG-11 Permisos del rol y SEG-12 Matriz de roles y permisos. Reglas en Roles. */
class RolController extends Controller
{
    /** Roles con sus cifras: usuarios, permisos especiales y módulos con acceso. */
    public function index()
    {
        $roles = $this->roles();
        $permisos = Roles::permisos($roles);
        $accesos = Roles::accesos($roles);
        $usuarios = DB::table('user_roles as ur')->join('users as u', 'u.id', '=', 'ur.user_id')->where('u.status', '<>', 'INACTIVE')
            ->groupBy('ur.role_id')->selectRaw('ur.role_id, count(*) n')->pluck('n', 'role_id');
        $todosLosTienen = DB::table('permissions')->where('everyone', true)->count();

        $filas = $roles->map(fn ($r) => (array) $r + [
            'users' => (int) ($usuarios[$r->id] ?? 0),
            // Permisos especiales propios del rol (sin los que tienen todos).
            'perms' => max(0, count($permisos[$r->id]) - ($r->code === 'GERENTE' ? 0 : $todosLosTienen)),
            'modules' => count(array_filter($accesos[$r->id], fn ($a) => $a !== '')),
            'editable' => ! in_array($r->code, Roles::FIJOS, true),
        ]);

        return response()->json([
            'data' => $filas->values(),
            'resumen' => [
                'sistema' => $roles->where('is_system', true)->count(), 'propios' => $roles->where('is_system', false)->count(),
                'exigen_2fa' => $roles->where('requires_mfa', true)->count(), 'asignado' => $roles->where('scope_mode', 'ASSIGNED')->count(),
            ],
        ]);
    }

    /** Un rol con su acceso a cada módulo y sus permisos especiales, para SEG-11. */
    public function show(string $id)
    {
        $r = Roles::fila($id);
        $roles = collect([$r]);
        $acceso = Roles::accesos($roles)[$r->id];
        $tiene = array_flip(Roles::permisos($roles)[$r->id]);
        $encendidos = DB::table('tenant_modules')->where('enabled', true)->pluck('module_code')->flip();

        return response()->json((array) $r + [
            'editable' => ! in_array($r->code, Roles::FIJOS, true),
            'users' => DB::table('user_roles')->where('role_id', $id)->count(),
            'modules' => DB::table('platform_modules')->orderBy('code')->get(['code', 'name'])
                ->map(fn ($m) => ['code' => $m->code, 'name' => $m->name, 'enabled' => isset($encendidos[$m->code]), 'actions' => $acceso[$m->code] ?? '']),
            'permissions' => DB::table('permissions')->orderBy('code')->get(['code', 'module_code', 'description', 'everyone'])
                ->map(fn ($p) => (array) $p + ['granted' => isset($tiene[$p->code])]),
        ]);
    }

    /** Todos los roles contra todos los módulos y permisos (SEG-12). Solo lectura. */
    public function matriz()
    {
        $roles = $this->roles();
        $accesos = Roles::accesos($roles);
        $permisos = Roles::permisos($roles);
        $encendidos = DB::table('tenant_modules')->where('enabled', true)->pluck('module_code')->flip();
        $porPermiso = [];
        foreach ($roles as $r) {
            foreach ($permisos[$r->id] as $p) {
                $porPermiso[$p][] = $r->code;
            }
        }

        return response()->json([
            'roles' => $roles->map(fn ($r) => ['id' => $r->id, 'code' => $r->code, 'name' => $r->name])->values(),
            'modules' => DB::table('platform_modules')->orderBy('code')->get(['code', 'name'])->map(fn ($m) => [
                'code' => $m->code, 'name' => $m->name, 'enabled' => isset($encendidos[$m->code]),
                'access' => $roles->mapWithKeys(fn ($r) => [$r->code => $accesos[$r->id][$m->code] ?? ''])]),
            'permissions' => DB::table('permissions')->orderBy('code')->get(['code', 'module_code', 'description', 'everyone'])->map(fn ($p) => (array) $p + [
                'enabled' => isset($encendidos[$p->module_code]), 'roles' => $porPermiso[$p->code] ?? []]),
        ]);
    }

    /**
     * La matriz en Excel con el diseño de reporte (SEG-12, para la revisión de accesos AUD-08): permisos
     * especiales, acceso por módulo y el detalle de los roles. Los módulos van en el orden de la plataforma.
     */
    public function exportar(Request $request)
    {
        $roles = $this->roles();
        $accesos = Roles::accesos($roles);
        $permisos = Roles::permisos($roles);
        $encendidos = DB::table('tenant_modules')->where('enabled', true)->pluck('module_code')->flip();
        $modulos = DB::table('platform_modules')->orderBy('phase')->orderBy('sort_order')->orderBy('code')->get(['code', 'name'])
            ->map(fn ($m) => (object) ['code' => $m->code, 'name' => trim(explode(':', $m->name)[0]), 'on' => isset($encendidos[$m->code])]);
        $orden = $modulos->pluck('code')->flip();
        $nombreModulo = $modulos->pluck('name', 'code');
        $tiene = [];
        foreach ($roles as $r) {
            $tiene[$r->code] = array_flip($permisos[$r->id]);
        }
        $usuarios = DB::table('user_roles as ur')->join('users as u', 'u.id', '=', 'ur.user_id')->where('u.status', '<>', 'INACTIVE')
            ->groupBy('ur.role_id')->selectRaw('ur.role_id, count(*) n')->pluck('n', 'role_id');
        $columnasRol = $roles->map(fn ($r) => ['titulo' => $r->name, 'ancho' => 5, 'girar' => true])->all();
        $lista = DB::table('permissions')->get(['code', 'module_code', 'description', 'everyone'])
            ->sortBy(fn ($p) => sprintf('%03d %s', $orden[$p->module_code] ?? 999, $p->code))->values();
        $leyenda = 'Acceso por módulo: C crear · L leer · E editar · A aprobar o anular. Un módulo apagado no concede accesos ni permisos. '
            .'La gerencia tiene todo por contrato del núcleo.';

        return Exportar::libro('Matriz de roles y permisos', $request->user())
            ->hoja('Permisos especiales',
                columnas: array_merge([
                    ['titulo' => 'Módulo', 'ancho' => 16], ['titulo' => 'Permiso', 'ancho' => 28], ['titulo' => 'Para qué', 'ancho' => 40], ['titulo' => 'Encendido', 'ancho' => 12, 'tipo' => 'centro'],
                ], array_map(fn ($c) => $c + ['tipo' => 'marca'], $columnasRol)),
                filas: $lista->map(fn ($p) => array_merge(
                    [$nombreModulo[$p->module_code] ?? $p->module_code, $p->code, $p->description, isset($encendidos[$p->module_code]) ? 'Sí' : 'No'],
                    $roles->map(fn ($r) => isset($tiene[$r->code][$p->code]))->all())),
                descripcion: 'Qué rol tiene cada permiso especial. ● = lo tiene. Para la revisión periódica de accesos.',
                resumen: ['Roles' => $roles->count(), 'Roles propios' => $roles->where('is_system', false)->count(), 'Permisos especiales' => $lista->count(), 'Módulos encendidos' => $encendidos->count()],
                fijas: 2, notas: $leyenda)
            ->hoja('Acceso por módulo',
                columnas: array_merge([['titulo' => 'Código', 'ancho' => 8, 'tipo' => 'centro'], ['titulo' => 'Módulo', 'ancho' => 24], ['titulo' => 'Encendido', 'ancho' => 12, 'tipo' => 'centro']],
                    array_map(fn ($c) => $c + ['tipo' => 'centro'], $columnasRol)),
                filas: $modulos->map(fn ($m) => array_merge([$m->code, $m->name, $m->on ? 'Sí' : 'No'],
                    $roles->map(fn ($r) => $m->on ? ($accesos[$r->id][$m->code] ?? '') : '')->all())),
                descripcion: 'Qué puede hacer cada rol en cada módulo.',
                fijas: 2, notas: $leyenda)
            ->hoja('Roles',
                columnas: [['titulo' => 'Código', 'ancho' => 24], ['titulo' => 'Rol', 'ancho' => 30], ['titulo' => 'Descripción', 'ancho' => 46], ['titulo' => 'Tipo', 'ancho' => 13, 'tipo' => 'centro'],
                    ['titulo' => 'Alcance', 'ancho' => 11, 'tipo' => 'centro'], ['titulo' => 'Segundo factor', 'ancho' => 13, 'tipo' => 'centro'], ['titulo' => 'Usuarios', 'ancho' => 10, 'tipo' => 'numero'],
                    ['titulo' => 'Permisos especiales', 'ancho' => 12, 'tipo' => 'numero'], ['titulo' => 'Estado', 'ancho' => 10, 'tipo' => 'centro']],
                filas: $roles->map(fn ($r) => [$r->code, $r->name, $r->description, $r->is_system ? 'Del sistema' : 'Propio', $r->scope_mode === 'ASSIGNED' ? 'Asignado' : 'Todo',
                    $r->requires_mfa ? 'Exige' : 'No', (int) ($usuarios[$r->id] ?? 0), count($permisos[$r->id]), $r->status === 'ACTIVE' ? 'Activo' : 'Inactivo']),
                descripcion: 'Los roles de la empresa con su alcance, segundo factor y cantidad de usuarios activos.')
            ->descargar('matriz-roles-permisos');
    }

    public function store(Request $request)
    {
        $d = $request->validate([
            'base_id' => ['required', 'uuid'],
            'code' => ['required', 'string', 'max:25'],
            'name' => ['required', 'string', 'min:3', 'max:80'],
        ], ['base_id.required' => 'Elige el rol que vas a copiar.']);

        return response()->json(Roles::copiar($d['base_id'], $d['code'], $d['name'], $request->user()), 201);
    }

    public function update(Request $request, string $id)
    {
        $d = $request->validate(['name' => ['required', 'string', 'min:3', 'max:80'], 'description' => ['nullable', 'string', 'max:500']]);

        return response()->json(Roles::editar($id, $d['name'], $d['description'] ?? null, $request->user()));
    }

    public function destroy(Request $request, string $id)
    {
        Roles::borrar($id, $request->user());

        return response()->noContent();
    }

    public function acceso(Request $request, string $id)
    {
        $d = $request->validate([
            'module_code' => ['required', 'string', 'max:10', 'regex:/^[A-Za-z]{3}$/'],
            'actions' => ['present', 'nullable', 'string', 'max:4', 'regex:/^[CLEAclea]*$/'],
        ]);

        return response()->json(Roles::cambiarAcceso($id, $d['module_code'], (string) ($d['actions'] ?? ''), $request->user()));
    }

    public function permiso(Request $request, string $id)
    {
        $d = $request->validate(['permission_code' => ['required', 'string', 'max:80', 'regex:/^[a-z0-9_.]+$/'], 'granted' => ['required', 'boolean']]);

        return response()->json(Roles::cambiarPermiso($id, $d['permission_code'], (bool) $d['granted'], $request->user()));
    }

    /** Roles del sistema primero, luego los propios, por nombre. */
    private function roles()
    {
        return DB::table('roles')->orderByDesc('is_system')->orderBy('name')
            ->get(['id', 'code', 'name', 'description', 'is_system', 'requires_mfa', 'scope_mode', 'status']);
    }
}
