<?php

namespace App\Modulos\Ops\Services;

use App\Modulos\Mae\Services\CatalogosGlobales;
use App\Modulos\Plt\Services\Ruc;
use App\Support\Paginas;
use App\Support\RuleError;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * OPS-13 Bitácora de la consola, OPS-16 Parámetros de plataforma y la importación de catálogos globales.
 *  - La bitácora es de solo lectura (RN-OPS-05): la consultan todos los roles de la consola.
 *  - Un parámetro de plataforma cambia con motivo y deja su historial de solo inserción (RN-OPS-05).
 *  - Los catálogos globales (RN-MAE-11) se revisan antes de grabar y la importación queda en la bitácora.
 */
final class Plataforma
{
    /** Acciones de la bitácora con su nombre en español. */
    public const ACCIONES = [
        'CONSOLE_LOGIN' => 'Ingreso a la consola', 'CONSOLE_LOGOUT' => 'Salida de la consola', 'CONSOLE_LOGIN_FAILED' => 'Intento de ingreso fallido',
        'CONSOLE_LOGIN_BLOCKED' => 'Ingreso bloqueado', 'CONSOLE_LOCKED' => 'Cuenta bloqueada por intentos',
        'PLATFORM_USER_CREATED' => 'Alta de usuario de plataforma', 'PLATFORM_USER_UPDATED' => 'Usuario de plataforma editado',
        'PLATFORM_USER_INVITED' => 'Invitación enviada', 'PLATFORM_USER_ACTIVATED' => 'Cuenta activada', 'PLATFORM_USER_ACTIVE' => 'Usuario reactivado',
        'PLATFORM_USER_LOCKED' => 'Usuario bloqueado', 'PLATFORM_USER_DISABLED' => 'Usuario dado de baja', 'PLATFORM_USER_2FA_RESET' => 'Segundo factor reiniciado',
        'TENANT_CREATED' => 'Alta de empresa', 'TENANT_SUSPENDED' => 'Empresa suspendida', 'TENANT_REACTIVATED' => 'Empresa reactivada',
        'SUBSCRIPTION_STATUS' => 'Cambio de estado de suscripción', 'TRIAL_EXTENDED' => 'Prueba extendida', 'SUBSCRIPTION_DISCOUNT' => 'Descuento pactado',
        'PLAN_DRAFT_CREATED' => 'Borrador de plan', 'PLAN_DRAFT_DELETED' => 'Borrador de plan borrado', 'PLAN_PUBLISHED' => 'Plan publicado',
        'PLAN_RETIRED' => 'Plan retirado', 'PARAMETER_CHANGED' => 'Parámetro cambiado', 'CATALOG_IMPORTED' => 'Catálogo global importado',
        'TENANT_SIGNUP' => 'Empresa creada por registro', 'SIGNUP_REJECTED' => 'Registro rechazado', 'DEMO_ATTENDED' => 'Pedido de demo atendido', 'DEMO_REOPENED' => 'Pedido de demo reabierto',
        'DUNNING_RUN' => 'Proceso de mora ejecutado', 'HEALTH_RECOMPUTED' => 'Salud de las empresas recalculada', 'DUNNING_REMINDER' => 'Recordatorio de pago enviado', 'DUNNING_EXTENSION' => 'Prórroga de mora',
        'TICKET_ANSWERED' => 'Ticket respondido', 'TICKET_ASSIGNED' => 'Ticket asignado',
        'ACCESS_REQUESTED' => 'Acceso de soporte pedido', 'ACCESS_CANCELLED' => 'Acceso de soporte cancelado', 'ACCESS_SESSION_STARTED' => 'Sesión de soporte iniciada',
        'ACCESS_FINISHED' => 'Acceso de soporte terminado',
        'HEALTH_RECORDED' => 'Lectura de salud registrada', 'INCIDENT_OPENED' => 'Incidente abierto', 'INCIDENT_EDITED' => 'Incidente editado',
        'INCIDENT_UPDATED' => 'Actualización de incidente', 'INCIDENT_RESOLVED' => 'Incidente resuelto',
        'ANNOUNCEMENT_SAVED' => 'Anuncio guardado', 'ANNOUNCEMENT_PUBLISHED' => 'Anuncio publicado', 'ANNOUNCEMENT_CANCELLED' => 'Anuncio cancelado',
        'BILLING_RUN' => 'Corrida de facturación', 'INVOICE_DRAFT_DELETED' => 'Borrador de comprobante borrado', 'CREDIT_NOTE_ISSUED' => 'Nota de crédito emitida',
        'PAYMENT_ATTEMPTED' => 'Cobro intentado', 'PAYMENTS_RECONCILED' => 'Cobros conciliados con un abono', 'METRICS_FROZEN' => 'Métricas congeladas',
        'ADDON_SAVED' => 'Complemento guardado', 'ADDON_PUBLISHED' => 'Complemento publicado', 'ADDON_RETIRED' => 'Complemento retirado',
    ];

    /** Reglas de cada parámetro de plataforma: tipo y rango, para no guardar un valor que rompa la consola. */
    private const REGLAS = [
        'ops_console_session_minutes' => ['entero', 5, 240],
        'ops_console_session_max_hours' => ['entero', 1, 24],
        'ops_platform_user_invite_hours' => ['entero', 1, 168],
        'ops_console_ip_allowlist' => ['redes'],
        'ops_platform_email_domains' => ['dominios'],
        'onb_signup_code_hours' => ['entero', 1, 168],
        'onb_signup_expire_days' => ['entero', 1, 30],
        'sus_trial_days_default' => ['entero', 1, 30],
        'sus_trial_max_days' => ['entero', 1, 90],
        'ops_ticket_auto_close_days' => ['entero', 1, 60],
        'ops_support_max_hours' => ['entero', 1, 168],
        'ops_incident_notify_minutes' => ['entero', 5, 240],
        'ops_maintenance_notice_hours' => ['entero', 1, 336],
        'ops_component_check_seconds' => ['entero', 60, 3600],
        'ops_health_weight_activity' => ['entero', 0, 100],
        'ops_health_weight_billing' => ['entero', 0, 100],
        'ops_health_weight_support' => ['entero', 0, 100],
        'ops_health_risk_below' => ['entero', 1, 100],
        'ops_health_critical_below' => ['entero', 1, 100],
        'sus_invoice_due_days' => ['entero', 1, 60],
        'sus_grace_days' => ['entero', 1, 60],
        'sus_read_only_days' => ['entero', 1, 90],
        'sus_max_extension_days' => ['entero', 1, 60],
        'sus_issuer_ruc' => ['ruc'],
        'sus_issuer_name' => ['texto', 200],
    ];

    /* ------------------------------------------------------------------ OPS-13 */

    public static function bitacora(array $f): array
    {
        $q = DB::table('platform_audit_log as a')->leftJoin('tenants as t', 't.id', '=', 'a.target_tenant_id')
            ->select('a.id', 'a.action', 'a.actor_name', 'a.platform_user_id', 'a.target_tenant_id', 't.short as tenant_short', 'a.entity', 'a.entity_id',
                'a.reason', 'a.ip', 'a.detail', 'a.occurred_at');
        if (! empty($f['action'])) {
            $q->where('a.action', $f['action']);
        }
        if (! empty($f['user'])) {
            $q->where('a.platform_user_id', $f['user']);
        }
        if (! empty($f['tenant'])) {
            $q->where('a.target_tenant_id', $f['tenant']);
        }
        if (! empty($f['desde'])) {
            $q->where('a.occurred_at', '>=', Carbon::parse($f['desde'], 'America/Lima')->startOfDay());
        }
        if (! empty($f['hasta'])) {
            $q->where('a.occurred_at', '<=', Carbon::parse($f['hasta'], 'America/Lima')->endOfDay());
        }
        if (! empty($f['search'])) {
            $texto = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower(trim($f['search']))).'%';
            $q->where(fn ($w) => $w->whereRaw('lower(a.actor_name) LIKE ?', [$texto])->orWhereRaw('lower(a.reason) LIKE ?', [$texto])
                ->orWhereRaw('lower(t.short) LIKE ?', [$texto])->orWhereRaw('a.ip LIKE ?', [$texto]));
        }
        $q->orderByDesc('a.occurred_at')->orderBy('a.id');
        Paginas::ordenar($q, ['occurred_at' => 'a.occurred_at', 'action_name' => 'a.action', 'actor_name' => 'a.actor_name', 'tenant_short' => 't.short', 'ip' => 'a.ip'], 'a.id', $f);
        $pagina = $q->paginate(min(100, max(10, (int) ($f['per_page'] ?? 25))));
        // array_merge (no «+»): el detalle viene como texto JSON y debe reemplazarse por su valor.
        // Las filas viejas de la primera cuenta guardaron el nombre del comando: se muestran como «Instalación del servidor».
        $pagina->getCollection()->transform(fn ($r) => array_merge((array) $r, ['action_name' => self::ACCIONES[$r->action] ?? $r->action,
            'actor_name' => $r->actor_name === 'Servidor (ops:crear-admin)' ? UsuariosPlataforma::INSTALACION : $r->actor_name,
            'detail' => json_decode($r->detail, true)]));

        return $pagina->toArray() + [
            'cifras' => self::cifrasBitacora(),
            'acciones' => collect(self::ACCIONES)->map(fn ($n, $c) => ['code' => $c, 'name' => $n])->values(),
            'usuarios' => DB::table('platform_users')->orderBy('full_name')->get(['id', 'full_name']),
            'empresas' => DB::table('tenants')->orderBy('short')->get(['id', 'short']),
        ];
    }

    /**
     * Cifras de cabecera de la bitácora, como en el prototipo (OPS-13); no dependen de los filtros:
     * acciones registradas, las de hoy (hora de Lima), acciones del soporte dentro de empresas (consultas, cambios y
     * exportaciones de los accesos aprobados) e intentos rechazados (ingresos fallidos o bloqueados y pedidos del
     * soporte fuera de lo aprobado).
     */
    private static function cifrasBitacora(): array
    {
        $hoy = Carbon::now('America/Lima')->startOfDay();
        $a = DB::table('platform_audit_log')->selectRaw(
            "count(*) AS registradas, count(*) FILTER (WHERE occurred_at >= ?) AS hoy,
             count(*) FILTER (WHERE action IN ('CONSOLE_LOGIN_FAILED', 'CONSOLE_LOGIN_BLOCKED')) AS rechazados", [$hoy]
        )->first();
        $s = DB::table('support_access_events')->selectRaw(
            "count(*) FILTER (WHERE kind IN ('READ', 'WRITE', 'EXPORT')) AS soporte, count(*) FILTER (WHERE kind = 'DENIED') AS denegados"
        )->first();

        return ['registradas' => (int) $a->registradas, 'hoy' => (int) $a->hoy, 'soporte' => (int) $s->soporte,
            'rechazados' => (int) $a->rechazados + (int) $s->denegados];
    }

    /* ------------------------------------------------------------------ OPS-16 */

    public static function parametros(): array
    {
        $nombres = DB::table('platform_users')->pluck('full_name', 'id');

        return DB::table('platform_parameters')->orderBy('key')->get()->map(fn ($p) => [
            'key' => $p->key, 'value' => json_decode($p->value, true), 'description' => trim(preg_replace('/\s*\((RN|D)-[A-Z]+-\d+\)/', '', $p->description)), 'updated_at' => $p->updated_at,
            'updated_by' => $p->updated_by ? ($nombres[$p->updated_by] ?? null) : null, 'regla' => self::REGLAS[$p->key] ?? null,
            'historial' => DB::table('platform_parameter_history')->where('key', $p->key)->orderByDesc('changed_at')->limit(10)
                ->get(['old_value', 'new_value', 'reason', 'changed_by_name', 'changed_at'])
                ->map(fn ($h) => array_merge((array) $h, ['old_value' => json_decode($h->old_value ?? 'null', true), 'new_value' => json_decode($h->new_value, true),
                    'changed_by_name' => $h->changed_by_name === 'Servidor (ops:crear-admin)' ? UsuariosPlataforma::INSTALACION : $h->changed_by_name])),
        ])->all();
    }

    public static function cambiarParametro(string $key, mixed $valor, string $motivo, array $quien): array
    {
        Consola::exigir($quien, 'params.manage');
        $actual = DB::table('platform_parameters')->where('key', $key)->first();
        if (! $actual) {
            abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        }
        $valor = self::validar($key, $valor);
        if ($key === 'sus_trial_days_default' && $valor > (int) Consola::param('sus_trial_max_days', 30)) {
            RuleError::fail('RN-OPS-05', 'Los días de prueba por defecto no pueden pasar el tope de días de prueba.');
        }
        if ($key === 'sus_trial_max_days' && $valor < (int) Consola::param('sus_trial_days_default', 14)) {
            RuleError::fail('RN-OPS-05', 'El tope no puede ser menor que los días de prueba por defecto.');
        }
        if ($key === 'ops_health_critical_below' && $valor >= (int) Consola::param('ops_health_risk_below', 70)) {
            RuleError::fail('RN-OPS-05', 'El corte de «crítica» tiene que ser menor que el de «en riesgo».');
        }
        if ($key === 'ops_health_risk_below' && $valor <= (int) Consola::param('ops_health_critical_below', 40)) {
            RuleError::fail('RN-OPS-05', 'El corte de «en riesgo» tiene que ser mayor que el de «crítica».');
        }
        $pesos = ['ops_health_weight_activity', 'ops_health_weight_billing', 'ops_health_weight_support'];
        if (in_array($key, $pesos, true) && $valor + array_sum(array_map(fn ($k) => (int) Consola::param($k, 0), array_diff($pesos, [$key]))) === 0) {
            RuleError::fail('RN-OPS-05', 'Al menos una parte de la salud tiene que pesar algo.');
        }
        // RN-OPS-16: quien cambia las redes permitidas no puede dejarse afuera a sí mismo.
        if ($key === 'ops_console_ip_allowlist' && $valor && ! Consola::ipPermitida(request()?->ip(), $valor)) {
            RuleError::fail('RN-OPS-16', 'Tu IP actual ('.request()?->ip().') no está en la lista: te quedarías sin acceso. Agrégala primero.');
        }
        if (json_encode($valor) === json_encode(json_decode($actual->value, true))) {
            RuleError::fail('RN-OPS-05', 'El valor es el mismo que ya tiene.');
        }
        DB::transaction(function () use ($key, $valor, $motivo, $quien, $actual) {
            DB::table('platform_parameters')->where('key', $key)->update(['value' => json_encode($valor), 'updated_by' => $quien['id'], 'updated_at' => now()]);
            DB::table('platform_parameter_history')->insert(['key' => $key, 'old_value' => $actual->value, 'new_value' => json_encode($valor), 'reason' => $motivo,
                'changed_by' => $quien['id'], 'changed_by_name' => $quien['full_name'], 'changed_at' => now()]);
            Consola::bitacora('PARAMETER_CHANGED', $quien, ['entity' => 'platform_parameters', 'entity_id' => $key, 'reason' => $motivo,
                'detail' => ['antes' => json_decode($actual->value, true), 'despues' => $valor]]);
        });

        return collect(self::parametros())->firstWhere('key', $key);
    }

    /* ------------------------------------------------------------------ catálogos globales */

    /** Revisa el archivo sin grabar: filas válidas, errores por línea y qué cambiaría. */
    public static function revisarCatalogo(string $tabla, UploadedFile $archivo, array $quien): array
    {
        Consola::exigir($quien, 'catalogs.import');
        ['filas' => $filas, 'errores' => $errores] = CatalogosGlobales::leer($tabla, (string) file_get_contents($archivo->getRealPath()));

        return ['tabla' => $tabla, 'tabla_nombre' => CatalogosGlobales::TABLAS[$tabla], 'validas' => count($filas), 'errores' => array_slice($errores, 0, 200),
            'total_errores' => count($errores), 'previa' => CatalogosGlobales::vistaPrevia($tabla, $filas), 'huella' => hash_file('sha256', $archivo->getRealPath())];
    }

    /** Graba solo si el archivo no tiene errores (se corrige y se vuelve a subir); queda en la bitácora con su huella. */
    public static function importarCatalogo(string $tabla, UploadedFile $archivo, string $motivo, array $quien): array
    {
        $r = self::revisarCatalogo($tabla, $archivo, $quien);
        if ($r['total_errores'] > 0) {
            RuleError::fail('RN-MAE-11', "El archivo tiene {$r['total_errores']} línea(s) con error: corrígelas y vuelve a subirlo. No se grabó nada.");
        }
        if ($r['validas'] === 0) {
            RuleError::fail('RN-MAE-11', 'El archivo no trae filas.');
        }
        ['filas' => $filas] = CatalogosGlobales::leer($tabla, (string) file_get_contents($archivo->getRealPath()));
        CatalogosGlobales::importar($tabla, $filas);
        Consola::bitacora('CATALOG_IMPORTED', $quien, ['entity' => $tabla, 'reason' => $motivo, 'detail' => ['filas' => $r['validas'],
            'nuevas' => $r['previa']['nuevas'], 'cambian' => $r['previa']['cambian'], 'archivo' => mb_substr($archivo->getClientOriginalName(), 0, 120), 'sha256' => $r['huella']]]);

        return $r;
    }

    private static function validar(string $key, mixed $valor): mixed
    {
        $regla = self::REGLAS[$key] ?? null;
        if (! $regla) {
            RuleError::fail('RN-OPS-05', 'Ese parámetro todavía no se cambia desde la consola.');
        }
        // RUC emisor: vacío (no se emite) o un RUC válido.
        if ($regla[0] === 'ruc') {
            $ruc = trim((string) $valor);
            if ($ruc !== '' && ! Ruc::valido($ruc)) {
                RuleError::fail('RN-SUS-19', 'El RUC no es válido.');
            }

            return $ruc;
        }
        if ($regla[0] === 'texto') {
            $texto = trim((string) $valor);
            if (mb_strlen($texto) > $regla[1]) {
                RuleError::fail('RN-OPS-05', "Máximo {$regla[1]} caracteres.");
            }

            return $texto;
        }
        if ($regla[0] === 'entero') {
            if (! is_numeric($valor) || (int) $valor != $valor || $valor < $regla[1] || $valor > $regla[2]) {
                RuleError::fail('RN-OPS-05', "Debe ser un número entero entre {$regla[1]} y {$regla[2]}.");
            }

            return (int) $valor;
        }
        $lista = is_array($valor) ? $valor : preg_split('/[\s,;]+/', (string) $valor, -1, PREG_SPLIT_NO_EMPTY);
        $lista = array_values(array_unique(array_map(fn ($x) => mb_strtolower(trim(ltrim(trim($x), '@'))), $lista)));
        // Dominios de correo: nombre de dominio válido (sin @), máximo 20.
        if ($regla[0] === 'dominios') {
            foreach ($lista as $dom) {
                if (! preg_match('/^(?=.{3,120}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/', $dom)) {
                    RuleError::fail('RN-OPS-01', "«{$dom}» no es un dominio válido (por ejemplo intelectalab.com).");
                }
            }
            if (count($lista) > 20) {
                RuleError::fail('RN-OPS-01', 'Máximo 20 dominios.');
            }

            return $lista;
        }
        // Redes: lista de IP o CIDR (IPv4).
        foreach ($lista as $red) {
            [$ip, $bits] = array_pad(explode('/', $red), 2, null);
            if (! filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) || ($bits !== null && (! ctype_digit($bits) || (int) $bits > 32))) {
                RuleError::fail('RN-OPS-16', "«{$red}» no es una IP ni una red válida (por ejemplo 190.237.14.22 o 10.0.0.0/8).");
            }
        }
        if (count($lista) > 50) {
            RuleError::fail('RN-OPS-16', 'Máximo 50 redes.');
        }

        return $lista;
    }
}
