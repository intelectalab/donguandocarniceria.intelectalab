<?php

namespace App\Modulos\Aud\Services;

use App\Models\User;
use App\Modulos\Seg\Services\Bitacora;
use App\Support\Access;
use App\Support\Events;
use App\Support\Exportar;
use App\Support\Paginas;
use App\Support\Params;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;

/**
 * AUD-05 Exportaciones (RN-AUD-05, RN-AUD-06).
 *  - Se solicitan con un motivo de al menos 10 caracteres (aud.export.request).
 *  - Las que traen datos personales necesitan la aprobación de otra persona con aud.export.approve si pasan de
 *    aud_export_personal_data_rows filas (500) o si quien la pide no tiene aud.export.personal_data. Quien solicita no
 *    aprueba ni rechaza la suya.
 *  - Al quedar lista se genera el archivo (Excel con el diseño de la empresa, App\Support\Exportar) con una marca de agua
 *    (quién, cuándo, número y motivo) y se guarda en el disco privado: lo que se aprueba es lo que se descarga.
 *  - Se descarga con un enlace firmado que vale aud_export_link_hours (24 horas); solo quien la pidió (o gerencia y
 *    administración del sistema). Cada descarga queda en la exportación y en la bitácora de accesos (AUD-04).
 */
final class Exportaciones
{
    public const ESTADOS = ['PENDING_APPROVAL' => 'Por aprobar', 'READY' => 'Lista', 'REJECTED' => 'Rechazada', 'EXPIRED' => 'Enlace vencido'];

    /** Quién descarga las de otros y ve todas. */
    public const VEN_TODAS = ['GERENTE', 'ADMIN_SISTEMA', 'AUDITOR'];

    public const DESCARGAN_OTRAS = ['GERENTE', 'ADMIN_SISTEMA'];

    private const DISCO = 'local';

    /** Reporte => [nombre, datos personales, filtros que usa]. Las columnas y filas salen de filas(). */
    public const REPORTES = [
        'order_contacts' => ['Contactos de clientes por pedido (nombre, celular y dirección)', true, ['desde', 'hasta', 'marca']],
        'customers' => ['Clientes con teléfono y correo', true, ['optin']],
        'employees' => ['Trabajadores con documento y celular', true, []],
        'orders' => ['Pedidos (sin datos personales)', false, ['desde', 'hasta', 'marca']],
        'payments' => ['Cobros', false, ['desde', 'hasta', 'marca']],
        'documents' => ['Comprobantes emitidos (sin datos del adquiriente)', false, ['desde', 'hasta', 'marca']],
        'change_log' => ['Bitácora de cambios', false, ['desde', 'hasta']],
    ];

    public static function umbral(): int
    {
        return max(1, (int) (Params::get('aud_export_personal_data_rows') ?? 500));
    }

    public static function horasEnlace(): int
    {
        return max(1, (int) (Params::get('aud_export_link_hours') ?? 24));
    }

    public static function solicitar(string $reporte, array $filtros, string $motivo, User $quien): array
    {
        [$nombre, $personal] = self::REPORTES[$reporte] ?? RuleError::fail('RN-AUD-05', 'Ese reporte no existe.');
        if (mb_strlen(trim($motivo)) < 10) {
            RuleError::fail('RN-AUD-05', 'Indica el motivo de la exportación (al menos 10 caracteres).');
        }
        $f = self::normalizar($reporte, $filtros);
        $filas = self::contar($reporte, $f);
        $aprobar = $personal && ($filas > self::umbral() || ! Access::can($quien, 'aud.export.personal_data'));
        $numero = self::siguienteNumero();
        $ahora = now();
        $id = DB::table('data_exports')->insertGetId([
            'number' => $numero, 'format' => 'XLSX', 'downloads' => '[]', 'file_name' => "{$numero}-{$reporte}.xlsx",
            'watermark' => mb_substr("{$quien->name} · ".$ahora->copy()->setTimezone('America/Lima')->format('d/m/Y H:i')." · {$numero}", 0, 255),
            'source_module' => 'AUD', 'report' => $reporte, 'report_name' => $nombre, 'filters' => json_encode($f, JSON_UNESCAPED_UNICODE), 'rows_count' => $filas,
            'contains_personal_data' => $personal, 'reason' => mb_substr(trim($motivo), 0, 300), 'status' => 'PENDING_APPROVAL', 'requested_by_id' => $quien->id,
            'requested_by' => mb_substr($quien->name, 0, 120), 'requested_role' => mb_substr((string) (Access::for($quien)['roles'][0] ?? $quien->role ?? ''), 0, 40),
            'requested_at' => $ahora, 'created_at' => $ahora, 'updated_at' => $ahora,
        ], 'id');
        Events::emit('export.requested', 'data_exports', $id, ['number' => $numero, 'personal' => $personal, 'rows' => $filas, 'by' => $quien->id]);
        if ($aprobar) {
            self::avisarAprobadores($id, $quien);
        } else {
            self::dejarLista($id);
        }

        return self::ver($id, $quien);
    }

    public static function aprobar(string $id, User $quien): array
    {
        $x = self::fila($id);
        self::resolver($x, $quien);
        DB::table('data_exports')->where('id', $id)->update(['approved_by' => mb_substr($quien->name, 0, 120), 'approved_by_id' => $quien->id, 'approved_at' => now(), 'updated_at' => now()]);
        self::dejarLista($id);
        Events::emit('export.approved', 'data_exports', $id, ['by' => $quien->id, 'number' => $x->number]);
        $vence = Carbon::parse(DB::table('data_exports')->where('id', $id)->value('link_expires_at'))->setTimezone('America/Lima')->format('d/m/Y H:i');
        DB::table('notifications')->insert(['user_id' => $x->requested_by_id, 'module' => 'AUD', 'tone' => 'ok', 'severity' => 'OK', 'type' => 'EXPORTS', 'at' => now(),
            'title' => "Exportación {$x->number} aprobada", 'body' => "Descárgala antes del {$vence}.", 'ref' => json_encode(['href' => '/m/aud/aud-05'])]);

        return self::ver($id, $quien);
    }

    public static function rechazar(string $id, string $motivo, User $quien): array
    {
        $x = self::fila($id);
        self::resolver($x, $quien);
        if (mb_strlen(trim($motivo)) < 10) {
            RuleError::fail('RN-AUD-06', 'Indica el motivo del rechazo (al menos 10 caracteres).');
        }
        DB::table('data_exports')->where('id', $id)->update(['status' => 'REJECTED', 'rejected_by' => mb_substr($quien->name, 0, 120), 'rejected_at' => now(),
            'reject_reason' => mb_substr(trim($motivo), 0, 300), 'updated_at' => now()]);
        Events::emit('export.rejected', 'data_exports', $id, ['by' => $quien->id, 'number' => $x->number, 'reason' => trim($motivo)]);
        DB::table('notifications')->insert(['user_id' => $x->requested_by_id, 'module' => 'AUD', 'tone' => 'warn', 'severity' => 'WARNING', 'type' => 'EXPORTS', 'at' => now(),
            'title' => "Exportación {$x->number} rechazada", 'body' => trim($motivo), 'ref' => json_encode(['href' => '/m/aud/aud-05'])]);

        return self::ver($id, $quien);
    }

    /** El enlace firmado para descargar (vale hasta que vence la exportación). */
    public static function enlace(string $id, User $quien): array
    {
        $x = self::fila($id);
        if ($x->status === 'PENDING_APPROVAL') {
            RuleError::fail('RN-AUD-06', "La exportación {$x->number} tiene ".number_format($x->rows_count, 0, ',', '.').' filas con datos personales: necesita la aprobación de otra persona antes de descargarse.');
        }
        if ($x->status === 'REJECTED') {
            RuleError::fail('RN-AUD-06', "La exportación {$x->number} fue rechazada: {$x->reject_reason}");
        }
        if ($x->status === 'EXPIRED' || ($x->link_expires_at && now()->gt($x->link_expires_at))) {
            DB::table('data_exports')->where('id', $id)->where('status', 'READY')->update(['status' => 'EXPIRED', 'updated_at' => now()]);
            RuleError::fail('RN-AUD-05', "El enlace de {$x->number} venció el ".Carbon::parse($x->link_expires_at)->setTimezone('America/Lima')->format('d/m/Y H:i').': solicita la exportación de nuevo.');
        }
        if ($x->requested_by_id !== $quien->id && ! array_intersect(Access::for($quien)['roles'], self::DESCARGAN_OTRAS)) {
            RuleError::fail('RN-AUD-05', 'Solo quien la solicitó descarga la exportación.');
        }
        if (! $x->storage_key || ! Storage::disk(self::DISCO)->exists($x->storage_key)) {
            RuleError::fail('RN-AUD-05', 'Esta exportación es de los datos de demostración y no tiene archivo guardado: solicítala de nuevo.');
        }
        // Ruta relativa: la web la reenvía a la API (mismo dominio), aquí, en las pruebas y en el servidor.
        $url = URL::temporarySignedRoute('aud.exportacion', Carbon::parse($x->link_expires_at),
            ['id' => $id, 'e' => TenantContext::id(), 'u' => $quien->id], absolute: false);

        return ['url' => $url, 'expires_at' => Carbon::parse($x->link_expires_at)->toIso8601String(), 'file_name' => $x->file_name];
    }

    /** La descarga desde el enlace firmado: queda en la exportación y en la bitácora de accesos. */
    public static function descargar(string $id, string $empresa, string $usuario)
    {
        TenantContext::set(TenantContext::find($empresa));
        $x = DB::table('data_exports')->where('id', $id)->where('status', 'READY')->first();
        $u = User::find($usuario);
        if (! $x || ! $u || ! $x->storage_key || ! Storage::disk(self::DISCO)->exists($x->storage_key)) {
            abort(404);
        }
        TenantContext::setUser($u->id);
        $descargas = [...(json_decode($x->downloads ?? '[]', true) ?: []), ['at' => now()->toIso8601String(), 'by' => $u->name]];
        DB::table('data_exports')->where('id', $id)->update(['downloads' => json_encode(array_slice($descargas, -50), JSON_UNESCAPED_UNICODE), 'updated_at' => now()]);
        Bitacora::registrar($x->contains_personal_data ? 'EXPORT_DOWNLOADED' : 'REPORT_EXPORTED', ['user' => $u, 'entity' => 'data_exports', 'entity_id' => $id,
            'detail' => "{$x->number} · {$x->report_name} · ".number_format($x->rows_count, 0, ',', '.').' filas'.($x->contains_personal_data ? ' con datos personales' : '')]);

        $contentType = match (strtolower(pathinfo($x->file_name, PATHINFO_EXTENSION))) {
            'zip' => 'application/zip',
            'csv' => 'text/csv; charset=UTF-8',
            default => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        };

        return Storage::disk(self::DISCO)->download($x->storage_key, $x->file_name, [
            'Content-Type' => $contentType, 'X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'private, no-store',
        ]);
    }

    public static function lista(array $f, User $quien): array
    {
        $roles = Access::for($quien)['roles'];
        $aprueba = Access::can($quien, 'aud.export.approve');
        $todas = (bool) array_intersect($roles, self::VEN_TODAS);
        $alcance = $f['scope'] ?? 'mine';
        if (($alcance === 'pending' && ! $aprueba) || ($alcance === 'all' && ! $todas)) {
            $alcance = 'mine';
        }
        $q = DB::table('data_exports');
        match ($alcance) {
            'pending' => $q->where('status', 'PENDING_APPROVAL')->where('requested_by_id', '<>', $quien->id),
            'all' => null,
            default => $q->where('requested_by_id', $quien->id),
        };
        if (! empty($f['status'])) {
            $f['status'] === 'EXPIRED'
                ? $q->where(fn ($w) => $w->where('status', 'EXPIRED')->orWhere(fn ($x) => $x->where('status', 'READY')->where('link_expires_at', '<', now())))
                : $q->where('status', $f['status'])->when($f['status'] === 'READY', fn ($w) => $w->where(fn ($x) => $x->whereNull('link_expires_at')->orWhere('link_expires_at', '>=', now())));
        }
        if (! empty($f['report'])) {
            $q->where('report', $f['report']);
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('number', 'ilike', $p)->orWhere('report_name', 'ilike', $p)->orWhere('requested_by', 'ilike', $p)->orWhere('reason', 'ilike', $p));
        }
        $q->orderByDesc('requested_at')->orderBy('id');
        Paginas::ordenar($q, ['number' => 'number', 'requested_at' => 'requested_at', 'requested_by' => 'requested_by', 'report_name' => 'report_name',
            'rows_count' => 'rows_count', 'status' => 'status'], 'id', $f);

        $c = DB::table('data_exports')->selectRaw("
            count(*) FILTER (WHERE status = 'PENDING_APPROVAL' AND requested_by_id <> ?) AS por_aprobar,
            count(*) FILTER (WHERE status = 'READY' AND contains_personal_data AND requested_at >= date_trunc('month', now() AT TIME ZONE 'America/Lima') AT TIME ZONE 'America/Lima') AS personales_mes,
            count(*) FILTER (WHERE requested_by_id = ?) AS mias,
            count(*) FILTER (WHERE status = 'REJECTED') AS rechazadas", [$quien->id, $quien->id])->first();

        return Paginas::de($q, fn ($x) => self::presentar($x, $quien), $f) + [
            'cifras' => ['por_aprobar' => (int) $c->por_aprobar, 'personales_mes' => (int) $c->personales_mes, 'mias' => (int) $c->mias, 'rechazadas' => (int) $c->rechazadas],
            'alcance' => $alcance, 'puede' => ['solicitar' => Access::can($quien, 'aud.export.request'), 'aprobar' => $aprueba, 'todas' => $todas,
                'datos_personales' => Access::can($quien, 'aud.export.personal_data')],
            'umbral' => self::umbral(), 'horas' => self::horasEnlace(), 'estados' => self::ESTADOS, 'reportes' => self::reportes(),
            'marcas' => DB::table('brands')->where('status', 'ACTIVE')->orderBy('name')->get(['id as value', 'name as label']),
        ];
    }

    public static function ver(string $id, User $quien): array
    {
        $x = self::fila($id);
        // La ve quien la pidió, quien puede aprobarla mientras está pendiente, y gerencia, administración y auditoría.
        $todas = (bool) array_intersect(Access::for($quien)['roles'], self::VEN_TODAS);
        if ($x->requested_by_id !== $quien->id && ! $todas && ! ($x->status === 'PENDING_APPROVAL' && Access::can($quien, 'aud.export.approve'))) {
            abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        }
        $marca = ($m = json_decode($x->filters ?? '{}', true)['marca'] ?? null) ? DB::table('brands')->where('id', $m)->value('name') : null;

        return self::presentar($x, $quien) + ['filtros_texto' => self::filtrosTexto(json_decode($x->filters ?? '{}', true) ?: [], $marca),
            'downloads' => json_decode($x->downloads ?? '[]', true) ?: [], 'watermark' => $x->watermark, 'file_name' => $x->file_name, 'format' => $x->format,
            'source_module' => $x->source_module, 'requested_role' => $x->requested_role, 'reject_reason' => $x->reject_reason, 'rejected_by' => $x->rejected_by, 'rejected_at' => $x->rejected_at];
    }

    public static function reportes(): array
    {
        return collect(self::REPORTES)->map(fn ($r, $k) => ['value' => $k, 'label' => $r[0], 'personal' => $r[1], 'filtros' => $r[2]])->values()->all();
    }

    /* ------------------------------------------------------------------ apoyo */

    private static function fila(string $id): object
    {
        return DB::table('data_exports')->where('id', $id)->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
    }

    /** RN-AUD-06: solo otra persona con el permiso resuelve una exportación pendiente. */
    private static function resolver(object $x, User $quien): void
    {
        if (! Access::can($quien, 'aud.export.approve')) {
            RuleError::fail('RN-AUD-06', 'Aprobar o rechazar exportaciones pide el permiso de aprobar exportaciones.');
        }
        if ($x->requested_by_id === $quien->id) {
            RuleError::fail('RN-AUD-06', 'Quien solicita una exportación no la aprueba ni la rechaza: pide la revisión a otra persona.');
        }
        if ($x->status !== 'PENDING_APPROVAL') {
            RuleError::fail('RN-AUD-06', 'La exportación no está pendiente de aprobación.');
        }
    }

    /** Genera el archivo con la marca de agua, lo guarda y deja la exportación lista con su enlace por 24 horas. */
    private static function dejarLista(string $id): void
    {
        $x = self::fila($id);
        $f = json_decode($x->filters ?? '{}', true) ?: [];
        [$columnas, $filas] = self::filas($x->report, $f);
        $quien = User::find($x->requested_by_id);
        $empresa = TenantContext::tenant()['name'] ?? 'la empresa';
        $notas = "Exportado por {$x->watermark} · Motivo: {$x->reason}".($x->contains_personal_data
            ? ". Contiene datos personales: uso interno de {$empresa}, Ley 29733 de Protección de Datos Personales." : '.');
        $ruta = 'exportaciones/'.TenantContext::id().'/'.$x->number.'.xlsx';
        $r = Exportar::libro($x->report_name, $quien)
            ->hoja('Datos', columnas: $columnas, filas: $filas, descripcion: self::filtrosTexto($f, ($f['marca'] ?? null) ? DB::table('brands')->where('id', $f['marca'])->value('name') : null),
                resumen: ['Filas' => count($filas), 'Exportación' => $x->number], notas: $notas)
            ->guardar(self::DISCO, $ruta);
        DB::table('data_exports')->where('id', $id)->update(['status' => 'READY', 'rows_count' => count($filas), 'storage_key' => $ruta, 'sha256' => $r['sha256'],
            'size_bytes' => $r['size'], 'link_expires_at' => now()->addHours(self::horasEnlace()), 'updated_at' => now()]);
        Events::emit('export.ready', 'data_exports', $id, ['number' => $x->number]);
    }

    /** Aviso a quienes pueden aprobar (menos quien la pidió). */
    private static function avisarAprobadores(string $id, User $quien): void
    {
        $x = self::fila($id);
        $roles = DB::table('role_permissions as rp')->join('permissions as p', 'p.id', '=', 'rp.permission_id')->join('roles as r', 'r.id', '=', 'rp.role_id')
            ->where('p.code', 'aud.export.approve')->pluck('r.id')->merge(DB::table('roles')->where('code', 'GERENTE')->pluck('id'))->unique()->all();
        $personas = DB::table('users as u')->join('user_roles as ur', 'ur.user_id', '=', 'u.id')->whereIn('ur.role_id', $roles)->where('u.status', 'ACTIVE')
            ->where('u.id', '<>', $quien->id)->distinct()->pluck('u.id');
        $cuerpo = "{$x->requested_by} pidió «{$x->report_name}» (".number_format($x->rows_count, 0, ',', '.')." filas con datos personales): {$x->reason}";
        foreach ($personas as $p) {
            DB::table('notifications')->insert(['user_id' => $p, 'module' => 'AUD', 'tone' => 'info', 'severity' => 'INFO', 'type' => 'APPROVALS', 'at' => now(),
                'title' => "Exportación {$x->number} por aprobar", 'body' => mb_substr($cuerpo, 0, 1000), 'ref' => json_encode(['href' => '/m/aud/aud-05?scope=pending'])]);
        }
    }

    /** EXP-0010: el siguiente de la empresa, con bloqueo hasta el fin de la transacción. */
    private static function siguienteNumero(): string
    {
        return DB::transaction(function () {
            DB::select("SELECT pg_advisory_xact_lock(hashtext('data_exports:' || coalesce(app_tenant_id()::text, '')))");
            $ultimo = DB::table('data_exports')->where('number', '~', '^EXP-[0-9]+$')->orderByRaw('length(number) DESC, number DESC')->value('number');

            return 'EXP-'.str_pad((string) ((int) substr((string) $ultimo, 4) + 1), 4, '0', STR_PAD_LEFT);
        });
    }

    /** Los filtros que usa el reporte, con el mes en curso por defecto. */
    private static function normalizar(string $reporte, array $f): array
    {
        $usa = self::REPORTES[$reporte][2];
        $out = [];
        if (in_array('desde', $usa, true)) {
            $out['desde'] = $f['desde'] ?? now('America/Lima')->startOfMonth()->toDateString();
            $out['hasta'] = $f['hasta'] ?? now('America/Lima')->toDateString();
            if ($out['hasta'] < $out['desde']) {
                RuleError::fail('RN-AUD-05', 'La fecha final es anterior a la inicial.');
            }
        }
        if (in_array('marca', $usa, true) && ! empty($f['marca'])) {
            $out['marca'] = $f['marca'];
        }
        if (in_array('optin', $usa, true) && ! empty($f['optin'])) {
            $out['optin'] = true;
        }

        return $out;
    }

    private static function filtrosTexto(array $f, ?string $marca): string
    {
        $p = [];
        if (! empty($f['desde'])) {
            $p[] = 'Del '.Carbon::parse($f['desde'])->format('d/m/Y').' al '.Carbon::parse($f['hasta'])->format('d/m/Y');
        }
        if ($marca) {
            $p[] = "Marca {$marca}";
        }
        if (! empty($f['optin'])) {
            $p[] = 'Solo quienes aceptan publicidad';
        }

        return $p ? implode(' · ', $p) : 'Sin filtros';
    }

    private static function contar(string $reporte, array $f): int
    {
        return self::consulta($reporte, $f)->count();
    }

    /** Consulta base de cada reporte (para contar y para generar). */
    private static function consulta(string $reporte, array $f)
    {
        $rango = fn ($q, $col) => isset($f['desde']) ? $q->whereRaw("({$col} AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$f['desde'], $f['hasta']]) : $q;
        $marca = fn ($q, $col) => ! empty($f['marca']) ? $q->where($col, $f['marca']) : $q;

        return match ($reporte) {
            'order_contacts', 'orders' => $marca($rango(DB::table('sales_orders as o'), 'o.created_at'), 'o.brand_id'),
            'customers' => DB::table('customers as c')->where('c.status', 'ACTIVE')->whereNotNull('c.phone')->when(! empty($f['optin']), fn ($q) => $q->where('c.marketing_opt_in', true)),
            'employees' => DB::table('employees as e'),
            'payments' => $marca($rango(DB::table('payments as p'), 'p.paid_at'), 'p.brand_id'),
            'documents' => $marca(DB::table('sales_documents as d')->when(isset($f['desde']), fn ($q) => $q->whereBetween('d.issue_date', [$f['desde'], $f['hasta']])), 'd.brand_id'),
            'change_log' => $rango(DB::table('audit.change_log as a'), 'a.changed_at'),
        };
    }

    /** Columnas y filas del reporte (como texto o número, listas para el Excel). */
    private static function filas(string $reporte, array $f): array
    {
        $q = self::consulta($reporte, $f);
        $c = fn (string $t, int $a = 18, string $tipo = 'texto') => ['titulo' => $t, 'ancho' => $a, 'tipo' => $tipo];

        return match ($reporte) {
            'order_contacts' => [[$c('Pedido', 14), $c('Fecha', 12, 'fecha'), $c('Marca', 18), $c('Cliente', 30), $c('Celular', 16), $c('Dirección', 40)],
                $q->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')->leftJoin('customer_addresses as ad', 'ad.id', '=', 'o.address_id')->leftJoin('brands as b', 'b.id', '=', 'o.brand_id')
                    ->orderBy('o.created_at')->get(['o.number', 'o.created_at', 'b.name as marca', 'c.full_name', DB::raw('coalesce(o.contact_phone, c.phone) as celular'), 'ad.address_line'])
                    ->map(fn ($r) => [$r->number, Carbon::parse($r->created_at)->setTimezone('America/Lima')->toDateString(), $r->marca, $r->full_name, $r->celular, $r->address_line ?? ''])->all()],
            'customers' => [[$c('Cliente', 32), $c('Documento', 14), $c('Celular', 16), $c('Correo', 28), $c('Acepta publicidad', 16, 'centro')],
                $q->orderBy('c.full_name')->get(['c.full_name', 'c.doc_number', 'c.phone', 'c.email', 'c.marketing_opt_in'])
                    ->map(fn ($r) => [$r->full_name, $r->doc_number ?? '', $r->phone, $r->email ?? '', $r->marketing_opt_in ? 'Sí' : 'No'])->all()],
            'employees' => [[$c('Documento', 16), $c('Nombre', 32), $c('Cargo', 22), $c('Celular', 16), $c('Estado', 12)],
                $q->orderBy('e.full_name')->get(['e.doc_type', 'e.doc_number', 'e.full_name', 'e.position', 'e.phone', 'e.status'])
                    ->map(fn ($r) => [trim("{$r->doc_type} {$r->doc_number}"), $r->full_name, $r->position, $r->phone ?? '', $r->status === 'ACTIVE' ? 'Activo' : 'De baja'])->all()],
            'orders' => [[$c('Pedido', 14), $c('Fecha', 12, 'fecha'), $c('Marca', 18), $c('Canal', 14), $c('Estado', 16), $c('Total', 14, 'soles')],
                $q->leftJoin('brands as b', 'b.id', '=', 'o.brand_id')->orderBy('o.created_at')
                    ->get(['o.number', 'o.created_at', 'b.name as marca', 'o.channel', 'o.status', DB::raw('coalesce(o.final_total, o.estimated_total) as total')])
                    ->map(fn ($r) => [$r->number, Carbon::parse($r->created_at)->setTimezone('America/Lima')->toDateString(), $r->marca, $r->channel, $r->status, (float) $r->total])->all()],
            'payments' => [[$c('Cobro', 14), $c('Fecha', 12, 'fecha'), $c('Medio', 20), $c('Monto', 14, 'soles'), $c('Operación', 20)],
                $q->leftJoin('payment_methods as m', 'm.id', '=', 'p.payment_method_id')->orderBy('p.paid_at')->get(['p.number', 'p.paid_at', 'm.name as medio', 'p.amount', 'p.reference'])
                    ->map(fn ($r) => [$r->number, Carbon::parse($r->paid_at)->setTimezone('America/Lima')->toDateString(), $r->medio, (float) $r->amount, $r->reference ?? ''])->all()],
            'documents' => [[$c('Comprobante', 16), $c('Fecha', 12, 'fecha'), $c('Tipo', 12), $c('Subtotal', 14, 'soles'), $c('IGV', 12, 'soles'), $c('Total', 14, 'soles'), $c('SUNAT', 14)],
                $q->orderBy('d.issue_date')->get(['d.full_number', 'd.issue_date', 'd.doc_type', 'd.subtotal', 'd.igv', 'd.total', 'd.sunat_status'])
                    ->map(fn ($r) => [$r->full_number, (string) $r->issue_date, $r->doc_type, (float) $r->subtotal, (float) $r->igv, (float) $r->total, $r->sunat_status])->all()],
            'change_log' => [[$c('Fecha y hora', 20), $c('Usuario', 26), $c('Operación', 12), $c('Tabla', 24), $c('Registro', 38)],
                $q->leftJoin('users as u', 'u.id', '=', 'a.changed_by')->whereNotNull('a.changed_by')->orderBy('a.changed_at')->limit(50000)
                    ->get(['a.changed_at', 'u.name', 'a.action', 'a.table_name', 'a.row_id'])
                    ->map(fn ($r) => [Carbon::parse($r->changed_at)->setTimezone('America/Lima')->format('d/m/Y H:i:s'), $r->name, Cambios::ACCIONES[$r->action] ?? $r->action,
                        Cambios::nombreTabla($r->table_name), (string) $r->row_id])->all()],
        };
    }

    private static function presentar(object $x, User $quien): array
    {
        $vencida = $x->status === 'EXPIRED' || ($x->status === 'READY' && $x->link_expires_at && now()->gt($x->link_expires_at));
        $estado = $vencida ? 'EXPIRED' : $x->status;
        $roles = Access::for($quien)['roles'];

        return [
            'id' => $x->id, 'number' => $x->number, 'requested_at' => $x->requested_at, 'requested_by' => $x->requested_by, 'report' => $x->report, 'report_name' => $x->report_name,
            'rows_count' => (int) $x->rows_count, 'contains_personal_data' => (bool) $x->contains_personal_data, 'reason' => $x->reason, 'status' => $estado,
            'status_name' => self::ESTADOS[$estado] ?? $estado, 'approved_by' => $x->approved_by, 'approved_at' => $x->approved_at, 'link_expires_at' => $x->link_expires_at,
            'mia' => $x->requested_by_id === $quien->id, 'descargas' => count(json_decode($x->downloads ?? '[]', true) ?: []),
            'puede_aprobar' => $estado === 'PENDING_APPROVAL' && $x->requested_by_id !== $quien->id && Access::can($quien, 'aud.export.approve'),
            'puede_descargar' => $estado === 'READY' && ($x->requested_by_id === $quien->id || (bool) array_intersect($roles, self::DESCARGAN_OTRAS)),
            'tiene_archivo' => (bool) $x->storage_key,
        ];
    }
}
