<?php

namespace App\Modulos\Aud\Services;

use App\Models\User;
use App\Modulos\Seg\Services\Bitacora;
use App\Support\Access;
use App\Support\Paginas;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AUD-01 Consulta de cambios y AUD-02 Historia del registro, sobre audit.change_log (la llena un trigger; la aplicación
 * solo la lee, RN-AUD-02).
 *  - RN-AUD-07: los secretos llegan enmascarados desde la base («***»). Además, aquí se vuelve a enmascarar por nombre
 *    de campo, por si una fila antigua trae alguno.
 *  - Datos personales (celular, documento, correo, dirección): enmascarados; se ven completos solo con
 *    aud.export.personal_data y pidiéndolo, y esa vista queda en la bitácora de accesos (SENSITIVE_VIEW).
 *  - RN-AUD-09: la consulta completa es de aud.change_log.view (administración del sistema, gerencia y auditoría). La
 *    historia de un registro, de aud.record_history.view; las tablas de seguridad (usuarios, credenciales…) solo con
 *    la consulta completa.
 * Las filas sin usuario son la carga inicial o procesos del sistema: se muestran como «Sistema».
 */
final class Cambios
{
    public const ACCIONES = ['I' => 'Alta', 'U' => 'Cambio', 'D' => 'Borrado'];

    /** Tabla => nombre en pantalla (las demás se muestran con su nombre técnico legible). */
    public const TABLAS = [
        'sales_orders' => 'Pedidos', 'customers' => 'Clientes', 'brands' => 'Marcas', 'establishments' => 'Locales', 'parameters' => 'Parámetros',
        'sales_documents' => 'Comprobantes', 'payments' => 'Cobros', 'employees' => 'Trabajadores', 'users' => 'Usuarios', 'user_roles' => 'Roles de usuarios',
        'roles' => 'Roles', 'role_permissions' => 'Permisos de roles', 'exchange_rates' => 'Tipo de cambio', 'payment_methods' => 'Medios de pago',
        'payment_method_fees' => 'Comisiones', 'price_list_items' => 'Precios', 'accounting_periods' => 'Períodos contables', 'tenant_modules' => 'Módulos',
        'integration_credentials' => 'Credenciales', 'integration_connectors' => 'Conectores', 'webhook_endpoints' => 'Webhooks de entrada',
        'data_exports' => 'Exportaciones', 'products' => 'Productos', 'product_variants' => 'Presentaciones', 'suppliers' => 'Proveedores',
        'units_of_measure' => 'Unidades', 'unit_conversions' => 'Conversiones', 'mfa_recovery_codes' => 'Códigos de recuperación',
        'password_reset_tokens' => 'Recuperación de contraseña', 'file_attachments' => 'Archivos adjuntos', 'document_series' => 'Series',
        'cost_centers' => 'Centros de costo', 'warehouses' => 'Almacenes', 'lots' => 'Lotes', 'delivery_zones' => 'Zonas de reparto',
    ];

    /** Tablas de seguridad: su historia solo con la consulta completa (RN-AUD-09). */
    public const RESERVADAS = ['users', 'user_roles', 'roles', 'role_permissions', 'integration_credentials', 'webhook_endpoints', 'mfa_recovery_codes',
        'password_reset_tokens', 'personal_access_tokens'];

    /** Registros que se pueden elegir en AUD-02 (tabla => columna con su nombre). */
    public const ELEGIBLES = [
        'sales_orders' => 'number', 'customers' => 'full_name', 'brands' => 'name', 'sales_documents' => 'full_number', 'employees' => 'full_name',
        'exchange_rates' => 'date', 'payment_methods' => 'name', 'products' => 'name', 'suppliers' => 'trade_name', 'accounting_periods' => 'period',
        'parameters' => 'key', 'users' => 'name',
    ];

    /** Campos que nunca se muestran en el detalle (técnicos). */
    private const OCULTOS = ['id', 'tenant_id', 'created_at', 'updated_at'];

    /** RN-AUD-07: nombre de campo secreto (si una fila antigua lo trae sin enmascarar). */
    private const SECRETO = '/(password|remember_token|secret|token|totp_secret|totp_pending|api_key|code_hash|_enc$)/i';

    /** Datos personales => cómo se enmascaran. */
    private const PERSONALES = ['phone' => 'tel', 'contact_phone' => 'tel', 'mobile' => 'tel', 'whatsapp' => 'tel', 'doc_number' => 'doc', 'customer_doc_number' => 'doc',
        'email' => 'correo', 'email_attempted' => 'correo', 'address_line' => 'dir', 'address' => 'dir', 'reference' => 'dir'];

    public static function nombreTabla(string $t): string
    {
        return self::TABLAS[$t] ?? ucfirst(str_replace('_', ' ', $t));
    }

    /** AUD-01: la consulta completa, con filtros. */
    public static function lista(array $f, User $quien): array
    {
        $revelar = self::revelar($f, $quien, 'AUD-01');
        [$desde, $hasta] = self::rango($f, 30);
        // Por defecto, solo lo que hicieron las personas; la carga inicial y los procesos automáticos, si se piden.
        $sistema = ! empty($f['sistema']) || ($f['usuario'] ?? '') === 'SISTEMA';
        $q = self::base()->whereBetween('a.changed_at', [$desde, $hasta])->when(! $sistema, fn ($w) => $w->whereNotNull('a.changed_by'));
        foreach (['tabla' => 'a.table_name', 'accion' => 'a.action', 'registro' => 'a.row_id'] as $k => $col) {
            if (! empty($f[$k])) {
                $q->where($col, $f[$k]);
            }
        }
        if (! empty($f['usuario'])) {
            $f['usuario'] === 'SISTEMA' ? $q->whereNull('a.changed_by') : $q->where('a.changed_by', $f['usuario']);
            Bitacora::registrar('AUDIT_VIEWED', ['user' => $quien, 'detail' => 'Consulta de cambios filtrada por usuario: '.self::nombreUsuario($f['usuario'])]);
        }
        $q->orderByDesc('a.changed_at')->orderByDesc('a.id');
        Paginas::ordenar($q, ['changed_at' => 'a.changed_at', 'usuario' => 'u.name', 'accion' => 'a.action', 'tabla' => 'a.table_name'], 'a.id', $f);

        $c = DB::table('audit.change_log')->whereBetween('changed_at', [$desde, $hasta])
            ->when(! empty($f['tabla']), fn ($w) => $w->where('table_name', $f['tabla']))->when(! empty($f['accion']), fn ($w) => $w->where('action', $f['accion']))
            ->when(! empty($f['registro']), fn ($w) => $w->where('row_id', $f['registro']))
            ->when(! empty($f['usuario']), fn ($w) => $f['usuario'] === 'SISTEMA' ? $w->whereNull('changed_by') : $w->where('changed_by', $f['usuario']))
            ->when(! $sistema, fn ($w) => $w->whereNotNull('changed_by'))
            ->selectRaw("count(*) AS total, count(DISTINCT changed_by) AS usuarios, count(DISTINCT table_name) AS tablas,
                count(*) FILTER (WHERE (changed_at AT TIME ZONE 'America/Lima')::date = (now() AT TIME ZONE 'America/Lima')::date) AS hoy")->first();

        $pagina = Paginas::de($q, fn ($a) => (array) $a, $f);
        $etiquetas = self::etiquetas($pagina['data']);
        $pagina['data'] = array_map(fn ($a) => self::presentar((object) $a, $revelar, $etiquetas), $pagina['data']);

        return $pagina + [
            'cifras' => ['total' => (int) $c->total, 'usuarios' => (int) $c->usuarios, 'tablas' => (int) $c->tablas, 'hoy' => (int) $c->hoy],
            'desde' => $desde->toDateString(), 'hasta' => $hasta->toDateString(), 'revelado' => $revelar, 'sistema' => $sistema,
            'puede_revelar' => Access::can($quien, 'aud.export.personal_data'),
            'tablas' => collect(DB::table('audit.change_log')->distinct()->orderBy('table_name')->pluck('table_name'))
                ->map(fn ($t) => ['value' => $t, 'label' => self::nombreTabla($t)])->sortBy('label')->values(),
            'usuarios' => DB::table('users')->whereIn('id', DB::table('audit.change_log')->whereNotNull('changed_by')->distinct()->select('changed_by'))
                ->orderBy('name')->get(['id as value', 'name as label']),
            'acciones' => self::ACCIONES,
        ];
    }

    public static function ver(int $id, array $f, User $quien): array
    {
        $a = self::base()->where('a.id', $id)->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        $revelar = self::revelar($f, $quien, 'AUD-01');

        return self::presentar($a, $revelar, self::etiquetas([(array) $a]), completo: true);
    }

    /** AUD-02: cambios y accesos de un registro, en orden, y el registro como está ahora. */
    public static function historia(string $tabla, string $id, array $f, User $quien): array
    {
        if (! Access::can($quien, 'aud.record_history.view')) {
            RuleError::fail('RN-AUD-09', 'Tu rol no ve la historia de los registros.');
        }
        if (in_array($tabla, self::RESERVADAS, true) && ! Access::can($quien, 'aud.change_log.view')) {
            RuleError::fail('RN-AUD-09', 'La historia de '.mb_strtolower(self::nombreTabla($tabla)).' es solo para administración del sistema, gerencia y auditoría.');
        }
        $revelar = self::revelar($f, $quien, 'AUD-02');
        // Desde su alta más reciente: si la base se volvió a cargar con el mismo registro, la historia es la de hoy.
        $alta = DB::table('audit.change_log')->where(['table_name' => $tabla, 'row_id' => $id, 'action' => 'I'])->max('changed_at');
        $cambios = self::base()->where('a.table_name', $tabla)->where('a.row_id', $id)->when($alta, fn ($w) => $w->where('a.changed_at', '>=', $alta))
            ->orderBy('a.changed_at')->orderBy('a.id')->limit(500)->get();
        $etiquetas = self::etiquetas($cambios->map(fn ($a) => (array) $a)->all());
        $items = $cambios->map(fn ($a) => ['tipo' => 'cambio', 'at' => $a->changed_at] + self::presentar($a, $revelar, $etiquetas))->all();
        foreach (DB::table('access_log')->where('entity', $tabla)->where('entity_id', $id)->when($alta, fn ($w) => $w->where('at', '>=', $alta))->orderBy('at')->limit(200)->get() as $l) {
            $items[] = ['tipo' => 'acceso', 'at' => $l->at, 'evento' => $l->event, 'evento_nombre' => Accesos::nombreEvento($l->event), 'usuario' => $l->user_name,
                'detalle' => $l->detail, 'resultado' => $l->result];
        }
        usort($items, fn ($x, $y) => strcmp((string) $x['at'], (string) $y['at']));

        $actual = Schema::hasTable($tabla) ? DB::table($tabla)->where('id', $id)->first() : null;

        return [
            'tabla' => $tabla, 'tabla_nombre' => self::nombreTabla($tabla), 'id' => $id, 'registro' => self::etiquetas([['table_name' => $tabla, 'row_id' => $id]])[$tabla][$id] ?? null,
            'items' => $items, 'revelado' => $revelar, 'puede_revelar' => Access::can($quien, 'aud.export.personal_data'),
            'actual' => $actual ? collect((array) $actual)->except(self::OCULTOS)->filter(fn ($v) => ! is_array($v))->take(20)
                ->map(fn ($v, $k) => ['campo' => $k, 'valor' => self::mostrar($k, $v, $revelar)])->values() : null,
        ];
    }

    /** AUD-02: los registros de un tipo que tienen cambios, para elegir (con buscador). */
    public static function registros(string $tabla, ?string $buscar, User $quien): array
    {
        $col = self::ELEGIBLES[$tabla] ?? null;
        if (! $col || ! Schema::hasTable($tabla) || (in_array($tabla, self::RESERVADAS, true) && ! Access::can($quien, 'aud.change_log.view'))) {
            return [];
        }
        $q = DB::table("{$tabla} as r")->whereExists(fn ($w) => $w->from('audit.change_log as a')->whereColumn('a.row_id', 'r.id')->where('a.table_name', $tabla))
            ->select('r.id', DB::raw("r.{$col}::text AS label"));
        if ($buscar) {
            $q->whereRaw("r.{$col}::text ILIKE ?", ['%'.addcslashes(trim($buscar), '%_\\').'%']);
        }

        return $q->orderByDesc(Schema::hasColumn($tabla, 'updated_at') ? 'r.updated_at' : 'r.id')->limit(40)->get()
            ->map(fn ($r) => ['id' => $r->id, 'label' => $r->label ?? $r->id])->all();
    }

    public static function elegibles(User $quien): array
    {
        $conHistoria = DB::table('audit.change_log')->whereIn('table_name', array_keys(self::ELEGIBLES))->distinct()->pluck('table_name')->all();

        return collect(self::ELEGIBLES)->keys()->filter(fn ($t) => in_array($t, $conHistoria, true))
            ->filter(fn ($t) => ! in_array($t, self::RESERVADAS, true) || Access::can($quien, 'aud.change_log.view'))
            ->map(fn ($t) => ['value' => $t, 'label' => self::nombreTabla($t)])->values()->all();
    }

    /* ------------------------------------------------------------------ apoyo */

    private static function base()
    {
        return DB::table('audit.change_log as a')->leftJoin('users as u', 'u.id', '=', 'a.changed_by')
            ->select('a.id', 'a.table_name', 'a.row_id', 'a.action', 'a.old_data', 'a.new_data', 'a.changed_columns', 'a.changed_by', 'a.changed_at', 'u.name as usuario',
                DB::raw("(SELECT string_agg(r.name, ', ') FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = a.changed_by) AS rol"));
    }

    /** Desde y hasta (fechas de Lima); por defecto los últimos $dias días. */
    private static function rango(array $f, int $dias): array
    {
        $hasta = ! empty($f['hasta']) ? Carbon::parse($f['hasta'], 'America/Lima')->endOfDay() : now('America/Lima')->endOfDay();
        $desde = ! empty($f['desde']) ? Carbon::parse($f['desde'], 'America/Lima')->startOfDay() : $hasta->copy()->subDays($dias - 1)->startOfDay();

        return [$desde, $hasta];
    }

    /** Ver datos personales completos: con permiso y pidiéndolo; queda en la bitácora de accesos. */
    private static function revelar(array $f, User $quien, string $pantalla): bool
    {
        if (empty($f['revelar'])) {
            return false;
        }
        if (! Access::can($quien, 'aud.export.personal_data')) {
            RuleError::fail('RN-AUD-07', 'Ver datos personales sin enmascarar pide el permiso de exportar datos personales.');
        }
        Bitacora::registrar('SENSITIVE_VIEW', ['user' => $quien, 'detail' => "Datos personales sin enmascarar en {$pantalla}"]);

        return true;
    }

    /** Nombre de cada registro (número de pedido, nombre del cliente…), en una consulta por tabla. */
    private static function etiquetas(array $filas): array
    {
        $out = [];
        foreach (collect($filas)->groupBy('table_name') as $tabla => $grupo) {
            if (! Schema::hasTable($tabla)) {
                continue;
            }
            $col = self::ELEGIBLES[$tabla] ?? collect(['number', 'full_number', 'code', 'full_name', 'trade_name', 'name', 'key', 'email', 'date'])
                ->first(fn ($c) => Schema::hasColumn($tabla, $c));
            $ids = $grupo->pluck('row_id')->filter()->unique()->values()->all();
            if ($col && $ids) {
                $out[$tabla] = DB::table($tabla)->whereIn('id', $ids)->pluck($col, 'id')->map(fn ($v) => (string) $v)->all();
            }
        }

        return $out;
    }

    private static function presentar(object $a, bool $revelar, array $etiquetas, bool $completo = false): array
    {
        $antes = json_decode($a->old_data ?? 'null', true) ?? [];
        $despues = json_decode($a->new_data ?? 'null', true) ?? [];
        $campos = match ($a->action) {
            'U' => self::arregloPg($a->changed_columns) ?: array_keys(array_diff_assoc(array_map('json_encode', $despues), array_map('json_encode', $antes))),
            'I' => array_keys($despues),
            default => array_keys($antes),
        };
        $campos = array_values(array_diff($campos, self::OCULTOS));
        if (! $completo && $a->action !== 'U') {
            $campos = array_slice($campos, 0, 8);
        }
        $etiqueta = $etiquetas[$a->table_name][$a->row_id] ?? ($despues['number'] ?? $antes['number'] ?? $despues['name'] ?? $antes['name'] ?? null);

        return [
            'id' => (int) $a->id, 'changed_at' => $a->changed_at, 'usuario' => $a->usuario ?? 'Sistema', 'rol' => $a->changed_by ? ($a->rol ?? null) : 'Carga inicial o proceso automático',
            'accion' => $a->action, 'accion_nombre' => self::ACCIONES[$a->action] ?? $a->action, 'tabla' => $a->table_name, 'tabla_nombre' => self::nombreTabla($a->table_name),
            'row_id' => $a->row_id, 'registro' => $etiqueta ? (string) $etiqueta : null,
            'cambios' => array_map(fn ($k) => ['campo' => $k, 'antes' => $a->action === 'I' ? null : self::mostrar($k, $antes[$k] ?? null, $revelar),
                'despues' => $a->action === 'D' ? null : self::mostrar($k, $despues[$k] ?? null, $revelar)], $campos),
            'mas_campos' => ! $completo && $a->action !== 'U' ? max(0, count(array_diff(array_keys($a->action === 'D' ? $antes : $despues), self::OCULTOS)) - 8) : 0,
        ];
    }

    /** text[] de Postgres («{a,b}») a lista. */
    private static function arregloPg(?string $v): array
    {
        return $v ? array_filter(str_getcsv(trim($v, '{}'))) : [];
    }

    /** Valor para pantalla: secretos como «***», datos personales enmascarados, objetos resumidos. */
    private static function mostrar(string $campo, mixed $v, bool $revelar): ?string
    {
        if ($v === null) {
            return null;
        }
        if (preg_match(self::SECRETO, $campo) || (is_string($v) && str_starts_with($v, 'enc:v'))) {
            return '***';
        }
        if (is_bool($v)) {
            return $v ? 'Sí' : 'No';
        }
        if (is_array($v)) {
            return mb_substr(json_encode($v, JSON_UNESCAPED_UNICODE), 0, 200);
        }
        $s = (string) $v;
        // Fechas en hora de Lima, como en el resto del sistema.
        if (preg_match('/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/', $s)) {
            try {
                return Carbon::parse($s)->setTimezone('America/Lima')->format('d/m/Y H:i:s');
            } catch (\Throwable) {
            }
        } elseif (preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) {
            return Carbon::parse($s)->format('d/m/Y');
        }
        if (! $revelar && isset(self::PERSONALES[$campo]) && $s !== '') {
            return match (self::PERSONALES[$campo]) {
                'tel' => mb_substr($s, 0, 4).'•••••'.mb_substr($s, -3),
                'doc' => '••••'.mb_substr($s, -4),
                'correo' => mb_substr($s, 0, 1).'•••@'.(explode('@', $s)[1] ?? ''),
                default => mb_substr($s, 0, 8).'…',
            };
        }

        return mb_substr($s, 0, 300);
    }

    private static function nombreUsuario(string $id): string
    {
        return $id === 'SISTEMA' ? 'Sistema' : (DB::table('users')->where('id', $id)->value('name') ?? $id);
    }
}
