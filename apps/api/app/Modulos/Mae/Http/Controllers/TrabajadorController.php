<?php

namespace App\Modulos\Mae\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Modulos\Mae\Services\ImportarTrabajadores;
use App\Modulos\Mae\Services\Trabajadores;
use App\Modulos\Seg\Services\Usuarios;
use App\Support\Access;
use App\Support\Importar;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * MAE-01 Trabajadores, MAE-02 Ficha del trabajador y MAE-10 Importar trabajadores. Reglas en Services\Trabajadores.
 * Las listas respetan el alcance por local del usuario. El sueldo no se muestra (es de PER).
 */
class TrabajadorController extends Controller
{
    private const COLUMNAS = ['e.id', 'e.doc_type', 'e.doc_number', 'e.full_name', 'e.position', 'e.establishment_id', 'e.cost_center_id',
        'e.hire_date', 'e.phone', 'e.email', 'e.status', 'e.terminated_on', 'e.termination_reason', 'e.created_at'];

    private function consulta(Request $request)
    {
        $locales = Access::for($request->user())['establishments'];

        return DB::table('employees as e')
            ->leftJoin('establishments as s', 's.id', '=', 'e.establishment_id')
            ->leftJoin('cost_centers as cc', 'cc.id', '=', 'e.cost_center_id')
            ->when($locales, fn ($q) => $q->whereIn('e.establishment_id', $locales))
            ->select(array_merge(self::COLUMNAS, ['s.short as local', 'cc.code as centro_costo', 'cc.name as centro_costo_nombre']));
    }

    private function usuarios(array $ids): array
    {
        return User::whereIn('employee_id', $ids)->orderByRaw("CASE WHEN status = 'INACTIVE' THEN 1 ELSE 0 END")
            ->get(['id', 'employee_id', 'name', 'email', 'status', 'role'])->groupBy('employee_id')->map->values()->all();
    }

    public function index(Request $request)
    {
        $f = $request->validate([
            'establishment_id' => ['nullable', 'uuid'], 'position' => ['nullable', 'string', 'max:80'], 'status' => ['nullable', Rule::in(['ACTIVE', 'INACTIVE'])],
        ]);
        $q = $this->consulta($request)
            ->when($f['establishment_id'] ?? null, fn ($w, $v) => $w->where('e.establishment_id', $v))
            ->when($f['position'] ?? null, fn ($w, $v) => $w->where('e.position', $v))
            ->when($f['status'] ?? null, fn ($w, $v) => $w->where('e.status', $v));
        $pagina = Listado::de($q, $request, buscar: ['e.full_name', 'e.doc_number', 'e.position', 'e.email'],
            ordenar: ['full_name', 'doc_number', 'position', 'hire_date', 'status', 'local'], porDefecto: 'full_name');
        $usuarios = $this->usuarios($pagina->getCollection()->pluck('id')->all());
        $pagina->getCollection()->transform(fn ($e) => (array) $e + ['usuario' => ($usuarios[$e->id] ?? collect())->first()]);

        return response()->json($pagina);
    }

    /** Cifras de MAE-01 y opciones de los filtros y formularios. */
    public function resumen(Request $request)
    {
        $todos = $this->consulta($request)->get(['e.id', 'e.status', 'e.terminated_on', 'e.position']);
        $activos = $todos->where('status', 'ACTIVE');
        $conUsuario = User::whereIn('employee_id', $activos->pluck('id'))->whereIn('status', Trabajadores::USUARIO_VIGENTE)->distinct()->count('employee_id');
        $anio = now('America/Lima')->format('Y');

        return response()->json([
            'activos' => $activos->count(), 'de_baja' => $todos->count() - $activos->count(), 'con_usuario' => $conUsuario,
            'sin_usuario' => $activos->count() - $conUsuario,
            'ceses_del_anio' => $todos->filter(fn ($e) => $e->terminated_on && substr($e->terminated_on, 0, 4) === $anio)->count(),
            'cargos' => $todos->pluck('position')->unique()->sort()->values(),
            'locales' => DB::table('establishments')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'code', 'short', 'name']),
            'centros' => DB::table('cost_centers')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'code', 'name']),
            'motivos' => Trabajadores::MOTIVOS_CESE,
        ]);
    }

    public function show(Request $request, string $id)
    {
        $e = $this->consulta($request)->where('e.id', $id)->first() ?? abort(404);
        $usuarios = User::where('employee_id', $id)->orderByRaw("CASE WHEN status = 'INACTIVE' THEN 1 ELSE 0 END")
            ->get(['id', 'name', 'email', 'status', 'role', 'last_login', 'deactivated_reason', 'deactivated_at'])
            ->map(fn ($u) => $u->toArray() + $this->alcanceDe($u) + ['sesiones' => DB::table('personal_access_tokens')->where('tokenable_type', User::class)
                ->where('tokenable_id', $u->id)->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()))->count()]);
        $verHistoria = Access::can($request->user(), 'aud.record_history.view');

        return response()->json([
            'trabajador' => $e, 'usuarios' => $usuarios,
            'historia' => $verHistoria ? $this->historia($request, $id, $usuarios->pluck('id')->all()) : null,
        ]);
    }

    /** Rol y alcance del usuario: marcas y locales asignados, o «todas» si su rol ve todo (RN-SEG-13). */
    private function alcanceDe(User $u): array
    {
        $rol = DB::table('user_roles as ur')->join('roles as r', 'r.id', '=', 'ur.role_id')->where('ur.user_id', $u->id)
            ->orderBy('r.code')->first(['r.name', 'r.scope_mode']);
        $total = ! $rol || $rol->scope_mode !== 'ASSIGNED';
        $nombres = fn (string $tabla, string $columna) => $total ? null : DB::table('user_scopes as us')
            ->join("{$tabla} as t", 't.id', '=', "us.{$columna}")->where('us.user_id', $u->id)->orderBy('t.name')->pluck('t.name')->all();

        return ['rol_nombre' => $rol->name ?? $u->role, 'marcas' => $nombres('brands', 'brand_id'), 'locales' => $nombres('establishments', 'establishment_id')];
    }

    private const CAMPOS_HISTORIA = [
        'doc_type' => 'Tipo de documento', 'doc_number' => 'Documento', 'full_name' => 'Nombre', 'position' => 'Cargo',
        'establishment_id' => 'Local', 'cost_center_id' => 'Centro de costo', 'hire_date' => 'Fecha de ingreso', 'phone' => 'Celular',
        'email' => 'Correo', 'status' => 'Estado', 'terminated_on' => 'Fecha de cese', 'termination_reason' => 'Motivo del cese',
    ];

    private const DATOS_PERSONALES = ['doc_number', 'phone', 'email'];

    /**
     * MAE-02 Historia (RN-AUD-09): la bitácora de cambios del trabajador y los vínculos de usuarios con él, en orden.
     * Sin sueldo (es de PER); documento, celular y correo enmascarados si el rol no ve datos personales (RN-AUD-07).
     */
    private function historia(Request $request, string $id, array $usuarios): array
    {
        $personales = Access::can($request->user(), 'aud.export.personal_data');
        $locales = DB::table('establishments')->pluck('short', 'id');
        $centros = DB::table('cost_centers')->pluck('code', 'id');
        $estados = ['ACTIVE' => 'Activo', 'INACTIVE' => 'Cesado', 'TERMINATED' => 'Cesado', 'LOCKED' => 'Bloqueado', 'INVITED' => 'Invitado'];
        $mostrar = function (string $campo, $valor) use ($personales, $locales, $centros, $estados) {
            if ($valor === null || $valor === '') {
                return '—';
            }
            $valor = (string) $valor;

            return match (true) {
                $campo === 'establishment_id' => $locales[$valor] ?? 'otro local',
                $campo === 'cost_center_id' => $centros[$valor] ?? 'otro centro',
                $campo === 'status' => $estados[$valor] ?? $valor,
                in_array($campo, ['hire_date', 'terminated_on'], true) && preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $valor, $m) => "{$m[3]}/{$m[2]}/{$m[1]}",
                in_array($campo, self::DATOS_PERSONALES, true) && ! $personales => mb_substr($valor, 0, 2).str_repeat('•', max(3, mb_strlen($valor) - 4)).mb_substr($valor, -2),
                default => $valor,
            };
        };

        // La bitácora no se borra al rehacer la base: lo anterior a la última alta es de una copia que ya no existe.
        $desde = DB::table('audit.change_log')->where(['table_name' => 'employees', 'row_id' => $id, 'action' => 'I'])->max('changed_at');
        $filas = DB::table('audit.change_log as a')
            ->leftJoin('users as u', 'u.id', '=', 'a.changed_by')
            ->leftJoin('roles as r', 'r.code', '=', 'u.role')
            ->where(fn ($q) => $q->where(fn ($w) => $w->where('a.table_name', 'employees')->where('a.row_id', $id))
                ->orWhere(fn ($w) => $w->where('a.table_name', 'users')->whereIn('a.row_id', $usuarios ?: ['00000000-0000-0000-0000-000000000000'])
                    ->where(fn ($c) => $c->where('a.new_data->employee_id', $id)->orWhere('a.old_data->employee_id', $id))))
            ->when($desde, fn ($q, $d) => $q->where('a.changed_at', '>=', $d))
            ->orderByDesc('a.changed_at')->orderByDesc('a.id')->limit(50)
            ->get(['a.id', 'a.table_name', 'a.action', 'a.old_data', 'a.new_data', 'a.changed_at', 'u.name as usuario', DB::raw('coalesce(r.name, u.role) as rol')]);

        return $filas->map(function ($a) use ($id, $mostrar) {
            $antes = json_decode($a->old_data ?? 'null', true) ?? [];
            $despues = json_decode($a->new_data ?? 'null', true) ?? [];
            if ($a->table_name === 'users') {
                $vinculado = ($despues['employee_id'] ?? null) === $id;
                if ($vinculado === (($antes['employee_id'] ?? null) === $id) && $a->action === 'U') {
                    return null; // otro cambio del usuario que no toca el vínculo
                }

                return ['id' => $a->id, 'fecha' => $a->changed_at, 'usuario' => $a->usuario, 'rol' => $a->rol, 'tipo' => 'usuario',
                    'detalle' => ($vinculado ? 'Vinculó el usuario ' : 'Desvinculó el usuario ').($despues['email'] ?? $antes['email'] ?? ''), 'cambios' => []];
            }
            $cambios = [];
            foreach (self::CAMPOS_HISTORIA as $campo => $etiqueta) {
                $a1 = $antes[$campo] ?? null;
                $d1 = $despues[$campo] ?? null;
                if ($a->action === 'I' ? $d1 !== null && $d1 !== '' : (string) $a1 !== (string) $d1) {
                    $cambios[] = ['campo' => $etiqueta, 'antes' => $a->action === 'I' ? null : $mostrar($campo, $a1), 'despues' => $mostrar($campo, $d1)];
                }
            }
            if (! $cambios && $a->action === 'U') {
                return null; // solo cambió el sueldo o la fecha de actualización
            }
            $tipo = $a->action === 'I' ? 'alta' : (($antes['status'] ?? null) === 'ACTIVE' && ($despues['status'] ?? null) !== 'ACTIVE' ? 'baja' : 'cambio');

            return ['id' => $a->id, 'fecha' => $a->changed_at, 'usuario' => $a->usuario, 'rol' => $a->rol, 'tipo' => $tipo, 'detalle' => null, 'cambios' => $cambios];
        })->filter()->values()->all();
    }

    private function reglas(bool $alta): array
    {
        return array_merge($alta ? [
            'doc_type' => ['required', Rule::in(Trabajadores::TIPOS_DOC)], 'doc_number' => ['required', 'string', 'max:20'],
        ] : [], [
            'full_name' => ['required', 'string', 'min:3', 'max:120'], 'position' => ['required', 'string', 'min:2', 'max:80'],
            'establishment_id' => ['required', 'uuid'], 'cost_center_id' => ['required', 'uuid'], 'hire_date' => ['required', 'date_format:Y-m-d', 'before_or_equal:today'],
            'phone' => ['nullable', 'string', 'max:20'], 'email' => ['nullable', 'email', 'max:80'],
        ]);
    }

    private function trabajador(Request $request, string $id): object
    {
        return $this->consulta($request)->where('e.id', $id)->first() ?? abort(404);
    }

    public function store(Request $request)
    {
        $e = Trabajadores::crear($request->validate($this->reglas(true)), $request->user());

        return response()->json(['id' => $e->id], 201);
    }

    public function update(Request $request, string $id)
    {
        Trabajadores::actualizar($this->trabajador($request, $id), $request->validate($this->reglas(false)));

        return response()->noContent();
    }

    public function baja(Request $request, string $id)
    {
        $d = $request->validate([
            'date' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:today'], 'reason' => ['required', Rule::in(Trabajadores::MOTIVOS_CESE)],
            'detail' => ['nullable', 'string', 'max:200'],
        ]);
        $motivo = $d['reason'].(! empty($d['detail']) ? ' · '.trim($d['detail']) : '');
        $r = Trabajadores::darDeBaja($this->trabajador($request, $id), $d['date'] ?? null, $motivo, $request->user());

        return response()->json(['usuarios' => $r['usuarios'], 'sesiones' => $r['sesiones']]);
    }

    /** Usuarios que se pueden vincular: vigentes, que no sean del portal B2B ni estén con otro trabajador activo. */
    public function usuariosLibres(Request $request, string $id)
    {
        $this->trabajador($request, $id);
        $activos = DB::table('employees')->where('status', 'ACTIVE')->where('id', '<>', $id)->pluck('id');

        // Sin los usuarios de Intelectalab ni los de clientes B2B: no son trabajadores de la empresa.
        return response()->json(DB::table('users as u')->leftJoin('roles as r', 'r.code', '=', 'u.role')
            ->whereNull('u.customer_id')->whereIn('u.status', Trabajadores::USUARIO_VIGENTE)->whereNotIn('u.role', Usuarios::NO_ASIGNABLES)
            ->where(fn ($q) => $q->whereNull('u.employee_id')->orWhere('u.employee_id', $id)->orWhereNotIn('u.employee_id', $activos))
            ->orderBy('u.name')->get(['u.id', 'u.name', 'u.email', DB::raw('coalesce(r.name, u.role) as role')]));
    }

    public function vincular(Request $request, string $id)
    {
        $d = $request->validate(['user_id' => ['required', 'uuid']]);
        $u = Trabajadores::vincularUsuario($this->trabajador($request, $id), $d['user_id']);

        return response()->json(['email' => $u->email]);
    }

    /** MAE-10: plantilla Excel con instrucciones, ejemplos y las listas de la empresa. */
    public function plantilla()
    {
        return Importar::plantilla('plantilla-trabajadores', 'Importar trabajadores', ImportarTrabajadores::columnasConListas(), [
            ['DNI', '72651034', 'Jhon Huamaní Tito', 'Preparador', 'L1', 'ALM-L1', '2026-10-12', '+51984551230', ''],
            ['CE', '002315478', 'Andreína Pérez Gil', 'Operaria de empaque', 'L2', 'PROD-L2', '12/10/2026', '984551232', 'aperez@correo.pe'],
        ], [
            'Llena una fila por trabajador desde la fila de abajo de los títulos. Puedes borrar los dos ejemplos.',
            'Tipo de documento: DNI (8 dígitos), CE o PASAPORTE (6 a 15 letras o números). Local y centro de costo: elige de la lista.',
            'Fecha de ingreso: AAAA-MM-DD o DD/MM/AAAA. Celular con o sin +51. Correo opcional. Hasta '.ImportarTrabajadores::MAX_FILAS.' filas.',
        ]);
    }

    /** MAE-10: convierte el Excel o CSV subido al texto que se revisa e importa. */
    public function leerArchivo(Request $request)
    {
        $request->validate(['archivo' => Importar::REGLAS_ARCHIVO]);

        return response()->json(['texto' => Importar::aTexto($request->file('archivo'), ImportarTrabajadores::COLUMNAS, ImportarTrabajadores::MAX_FILAS)]);
    }

    public function revisarImportacion(Request $request)
    {
        $d = $request->validate(['texto' => ['required', 'string', 'max:200000']]);

        return response()->json(['filas' => ImportarTrabajadores::revisar($d['texto'])]);
    }

    public function importar(Request $request)
    {
        $d = $request->validate(['texto' => ['required', 'string', 'max:200000']]);

        return response()->json(ImportarTrabajadores::importar($d['texto'], $request->user()), 201);
    }
}
