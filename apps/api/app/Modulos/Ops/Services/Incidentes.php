<?php

namespace App\Modulos\Ops\Services;

use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * OPS-08 Incidentes: alta, severidad, componente, empresas afectadas, línea de tiempo, mensaje público, causa raíz y
 * post mortem (rol con incident.manage: ingeniería y administración).
 *  - RN-OPS-08: se resuelve con hora de cierre posterior al inicio y causa raíz (también lo exige la base).
 *  - RN-OPS-14: un SEV1 o SEV2 se avisa a los clientes afectados antes de ops_incident_notify_minutes (30). Publicar un
 *    mensaje lo muestra como anuncio en el sistema de las empresas afectadas y, en SEV1/SEV2, avisa en la campana a
 *    sus administradores. Los tickets que abran por esa causa se vinculan al incidente.
 */
final class Incidentes
{
    public const SEVERIDADES = ['SEV1' => 'SEV1 · Crítico', 'SEV2' => 'SEV2 · Mayor', 'SEV3' => 'SEV3 · Menor', 'SEV4' => 'SEV4 · Bajo'];

    public const ESTADOS = ['INVESTIGATING' => 'Investigando', 'IDENTIFIED' => 'Causa identificada', 'MONITORING' => 'En observación', 'RESOLVED' => 'Resuelto'];

    /** Roles de la empresa que reciben el aviso de un incidente grave. */
    private const ADMINISTRADORES = ['GERENTE', 'ADMIN_SISTEMA', 'ADMINISTRACION'];

    public static function lista(array $f): array
    {
        $q = DB::table('platform_incidents as i')->leftJoin('platform_components as c', 'c.code', '=', 'i.component_code')->select('i.*', 'c.name as component_name');
        if (! empty($f['status'])) {
            $f['status'] === 'ABIERTOS' ? $q->where('i.status', '!=', 'RESOLVED') : $q->where('i.status', $f['status']);
        }
        if (! empty($f['severity'])) {
            $q->where('i.severity', $f['severity']);
        }
        $filas = $q->orderByRaw("i.status = 'RESOLVED'")->orderBy('i.severity')->orderByDesc('i.started_at')->limit(200)->get();
        $afectadas = DB::table('platform_incident_tenants')->whereIn('incident_id', $filas->pluck('id'))->selectRaw('incident_id, count(*) AS n')->groupBy('incident_id')->pluck('n', 'incident_id');
        $tickets = DB::table('support_tickets')->whereIn('incident_id', $filas->pluck('id'))->selectRaw('incident_id, count(*) AS n')->groupBy('incident_id')->pluck('n', 'incident_id');

        return $filas->map(fn ($i) => self::presentar($i) + ['empresas' => (int) ($afectadas[$i->id] ?? 0), 'tickets' => (int) ($tickets[$i->id] ?? 0)])->all();
    }

    public static function ver(string $id): array
    {
        $i = DB::table('platform_incidents as i')->leftJoin('platform_components as c', 'c.code', '=', 'i.component_code')->where('i.id', $id)
            ->select('i.*', 'c.name as component_name')->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));

        return self::presentar($i) + [
            'empresas' => DB::table('platform_incident_tenants as x')->join('tenants as t', 't.id', '=', 'x.tenant_id')->where('x.incident_id', $id)->orderBy('t.short')->get(['t.id', 't.short']),
            'linea' => DB::table('platform_incident_updates')->where('incident_id', $id)->orderByDesc('at')->get(['status', 'message', 'public', 'author_name', 'at'])
                ->map(fn ($u) => (array) $u + ['status_name' => self::ESTADOS[$u->status]]),
            'tickets' => DB::table('support_tickets as k')->join('tenants as t', 't.id', '=', 'k.tenant_id')->where('k.incident_id', $id)->orderByDesc('k.opened_at')
                ->get(['k.id', 'k.number', 'k.subject', 'k.status', 't.short as tenant_short']),
            'anuncio' => DB::table('platform_announcements')->where('incident_id', $id)->whereNull('cancelled_at')->value('id'),
        ];
    }

    public static function crear(array $quien, array $d): array
    {
        Consola::exigir($quien, 'incident.manage');
        $inicio = isset($d['started_at']) ? Carbon::parse($d['started_at']) : now();
        if ($inicio->isFuture()) {
            RuleError::fail('RN-OPS-08', 'El inicio no puede ser en el futuro.');
        }
        $id = DB::table('platform_incidents')->insertGetId([
            'title' => trim($d['title']), 'severity' => $d['severity'], 'component_code' => $d['component_code'] ?? null, 'affects_all' => (bool) $d['affects_all'],
            'started_at' => $inicio, 'created_by' => $quien['id'], 'created_by_name' => $quien['full_name'], 'created_at' => now(), 'updated_at' => now(),
        ], 'id');
        self::afectadas($id, (bool) $d['affects_all'], $d['tenants'] ?? []);
        DB::table('platform_incident_updates')->insert(['incident_id' => $id, 'status' => 'INVESTIGATING', 'message' => trim($d['message'] ?? '') ?: 'Se abrió el incidente.',
            'public' => false, 'author_name' => $quien['full_name'], 'at' => now()]);
        $n = DB::table('platform_incidents')->where('id', $id)->value('number');
        Consola::bitacora('INCIDENT_OPENED', $quien, ['entity' => 'platform_incidents', 'entity_id' => $id, 'reason' => "{$n} · ".trim($d['title']), 'detail' => ['severidad' => $d['severity']]]);

        return self::ver($id);
    }

    /** Cambia los datos (título, severidad, componente, empresas afectadas) de un incidente abierto. */
    public static function editar(string $id, array $quien, array $d): array
    {
        Consola::exigir($quien, 'incident.manage');
        $i = self::fila($id);
        DB::table('platform_incidents')->where('id', $id)->update(['title' => trim($d['title']), 'severity' => $d['severity'], 'component_code' => $d['component_code'] ?? null,
            'affects_all' => (bool) $d['affects_all'], 'updated_at' => now()]);
        self::afectadas($id, (bool) $d['affects_all'], $d['tenants'] ?? []);
        if ($i->severity !== $d['severity']) {
            DB::table('platform_incident_updates')->insert(['incident_id' => $id, 'status' => $i->status, 'message' => "Severidad: {$i->severity} → {$d['severity']}",
                'public' => false, 'author_name' => $quien['full_name'], 'at' => now()]);
        }
        Consola::bitacora('INCIDENT_EDITED', $quien, ['entity' => 'platform_incidents', 'entity_id' => $id, 'reason' => "{$i->number} actualizado"]);

        return self::ver($id);
    }

    /** Nueva entrada de la línea de tiempo; si es pública, se avisa a los clientes afectados. */
    public static function actualizar(string $id, array $quien, array $d): array
    {
        Consola::exigir($quien, 'incident.manage');
        $i = self::fila($id);
        if ($i->status === 'RESOLVED' && $d['status'] !== 'RESOLVED') {
            RuleError::fail('RN-OPS-08', 'El incidente ya está resuelto.');
        }
        if ($d['status'] === 'RESOLVED') {
            RuleError::fail('RN-OPS-08', 'Para resolverlo usa «Resolver», con la hora de cierre y la causa raíz.');
        }
        DB::table('platform_incidents')->where('id', $id)->update(['status' => $d['status'], 'updated_at' => now()]
            + (! empty($d['public']) ? ['public_message' => trim($d['message'])] : []));
        DB::table('platform_incident_updates')->insert(['incident_id' => $id, 'status' => $d['status'], 'message' => trim($d['message']), 'public' => (bool) ($d['public'] ?? false),
            'author_name' => $quien['full_name'], 'at' => now()]);
        if (! empty($d['public'])) {
            self::publicar(self::fila($id), $quien, trim($d['message']));
        }
        Consola::bitacora('INCIDENT_UPDATED', $quien, ['entity' => 'platform_incidents', 'entity_id' => $id, 'reason' => "{$i->number} · ".self::ESTADOS[$d['status']],
            'detail' => ['publico' => (bool) ($d['public'] ?? false)]]);

        return self::ver($id);
    }

    /** RN-OPS-08: hora de cierre posterior al inicio y causa raíz. Avisa el cierre si ya se había avisado a los clientes. */
    public static function resolver(string $id, array $quien, array $d): array
    {
        Consola::exigir($quien, 'incident.manage');
        $i = self::fila($id);
        if ($i->status === 'RESOLVED') {
            RuleError::fail('RN-OPS-08', 'El incidente ya está resuelto.');
        }
        $fin = isset($d['resolved_at']) ? Carbon::parse($d['resolved_at']) : now();
        if ($fin->lessThanOrEqualTo(Carbon::parse($i->started_at))) {
            RuleError::fail('RN-OPS-08', 'La hora de cierre debe ser posterior al inicio.');
        }
        if ($fin->isFuture()) {
            RuleError::fail('RN-OPS-08', 'La hora de cierre no puede ser en el futuro.');
        }
        $mensaje = trim($d['message'] ?? '') ?: 'El servicio está normalizado.';
        DB::table('platform_incidents')->where('id', $id)->update(['status' => 'RESOLVED', 'resolved_at' => $fin, 'root_cause' => trim($d['root_cause']),
            'postmortem' => isset($d['postmortem']) ? trim($d['postmortem']) : $i->postmortem, 'updated_at' => now()]);
        DB::table('platform_incident_updates')->insert(['incident_id' => $id, 'status' => 'RESOLVED', 'message' => $mensaje, 'public' => $i->customers_notified_at !== null,
            'author_name' => $quien['full_name'], 'at' => now()]);
        if ($i->customers_notified_at) {
            self::publicar(self::fila($id), $quien, "Resuelto: {$mensaje}", cerrado: true);
        }
        Consola::bitacora('INCIDENT_RESOLVED', $quien, ['entity' => 'platform_incidents', 'entity_id' => $id, 'reason' => "{$i->number} resuelto: ".trim($d['root_cause'])]);

        return self::ver($id);
    }

    /** El post mortem se puede completar después de resolver. */
    public static function postmortem(string $id, array $quien, string $texto): array
    {
        Consola::exigir($quien, 'incident.manage');
        self::fila($id);
        DB::table('platform_incidents')->where('id', $id)->update(['postmortem' => trim($texto), 'updated_at' => now()]);

        return self::ver($id);
    }

    /** CA-OPS-07: incidente SEV2 abierto solo cuando un componente cae (si no hay otro abierto para él). */
    public static function automatico(string $componente, ?string $detalle): void
    {
        if (DB::table('platform_incidents')->where('component_code', $componente)->where('status', '!=', 'RESOLVED')->exists()) {
            return;
        }
        $nombre = DB::table('platform_components')->where('code', $componente)->value('name');
        $id = DB::table('platform_incidents')->insertGetId(['title' => "{$nombre}: caído", 'severity' => 'SEV2', 'component_code' => $componente, 'affects_all' => true,
            'started_at' => now(), 'source' => 'AUTO', 'created_by_name' => 'Sistema', 'created_at' => now(), 'updated_at' => now()], 'id');
        DB::table('platform_incident_updates')->insert(['incident_id' => $id, 'status' => 'INVESTIGATING',
            'message' => 'Abierto solo por la lectura de salud'.($detalle ? ": {$detalle}" : '.'), 'public' => false, 'author_name' => 'Sistema', 'at' => now()]);
        Consola::bitacora('INCIDENT_OPENED', null, ['actor' => 'Sistema', 'entity' => 'platform_incidents', 'entity_id' => $id, 'reason' => "{$nombre} caído (lectura de salud)"]);
    }

    /** RN-OPS-14: vincula (o desvincula) un ticket con el incidente que lo causó. */
    public static function vincularTicket(string $ticket, ?string $incidente, array $quien): void
    {
        Consola::exigir($quien, 'ticket.manage');
        if ($incidente) {
            self::fila($incidente);
        }
        DB::table('support_tickets')->where('id', $ticket)->update(['incident_id' => $incidente, 'updated_at' => now()]);
    }

    /** Abiertos y recientes, para elegir al vincular un ticket. */
    public static function paraVincular(): array
    {
        return DB::table('platform_incidents')->where(fn ($q) => $q->where('status', '!=', 'RESOLVED')->orWhere('resolved_at', '>=', now()->subDays(3)))
            ->orderByDesc('started_at')->get(['id', 'number', 'title', 'status'])->all();
    }

    /* ------------------------------------------------------------------ internos */

    /** Anuncio del incidente en las empresas afectadas y, en SEV1/SEV2, aviso a sus administradores. */
    private static function publicar(object $i, array $quien, string $mensaje, bool $cerrado = false): void
    {
        $empresas = $i->affects_all ? [] : DB::table('platform_incident_tenants')->where('incident_id', $i->id)->pluck('tenant_id')->all();
        $anuncio = ['title' => $cerrado ? "Resuelto: {$i->title}" : $i->title, 'body' => $mensaje, 'kind' => 'INCIDENT', 'audience' => $i->affects_all ? 'ALL' : 'TENANTS',
            'audience_tenants' => json_encode(array_values($empresas)), 'ends_at' => $cerrado ? now()->addHours(6) : null, 'published' => true, 'updated_at' => now()];
        $existe = DB::table('platform_announcements')->where('incident_id', $i->id)->whereNull('cancelled_at')->value('id');
        $existe
            ? DB::table('platform_announcements')->where('id', $existe)->update($anuncio)
            : DB::table('platform_announcements')->insert($anuncio + ['starts_at' => now(), 'published_at' => now(), 'incident_id' => $i->id,
                'created_by' => $quien['id'], 'created_by_name' => $quien['full_name'], 'created_at' => now()]);
        if (! $i->customers_notified_at) {
            DB::table('platform_incidents')->where('id', $i->id)->update(['customers_notified_at' => now()]);
        }
        if (in_array($i->severity, ['SEV1', 'SEV2'], true)) {
            $ids = $i->affects_all ? DB::table('tenants')->where('status', 'ACTIVE')->pluck('id')->all() : $empresas;
            foreach ($ids as $t) {
                self::avisarEmpresa($t, $cerrado ? "Resuelto: {$i->title}" : "Incidente en GestionCarnica: {$i->title}", $mensaje);
            }
        }
    }

    private static function avisarEmpresa(string $tenant, string $titulo, string $texto): void
    {
        TenantContext::set(TenantContext::find($tenant));
        try {
            $ids = DB::table('user_roles')->join('roles', 'roles.id', '=', 'user_roles.role_id')->join('users', 'users.id', '=', 'user_roles.user_id')
                ->where('users.status', 'ACTIVE')->whereIn('roles.code', self::ADMINISTRADORES)->distinct()->pluck('users.id');
            $filas = $ids->map(fn ($id) => ['user_id' => $id, 'module' => 'OPS', 'tone' => 'bad', 'at' => now(), 'title' => mb_substr($titulo, 0, 255),
                'body' => mb_substr($texto, 0, 240), 'ref' => json_encode(['href' => '/inicio'])])->all();
            if ($filas) {
                DB::table('notifications')->insert($filas);
            }
        } finally {
            TenantContext::platform();
        }
    }

    private static function afectadas(string $id, bool $todas, array $tenants): void
    {
        DB::table('platform_incident_tenants')->where('incident_id', $id)->delete();
        if (! $todas && $tenants) {
            $validos = DB::table('tenants')->whereIn('id', $tenants)->pluck('id');
            DB::table('platform_incident_tenants')->insert($validos->map(fn ($t) => ['incident_id' => $id, 'tenant_id' => $t])->all());
        }
    }

    private static function fila(string $id): object
    {
        return DB::table('platform_incidents')->where('id', $id)->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
    }

    /** RN-OPS-14: plazo del aviso a clientes en SEV1/SEV2. */
    private static function aviso(object $i): array
    {
        if (! in_array($i->severity, ['SEV1', 'SEV2'], true)) {
            return ['estado' => $i->customers_notified_at ? 'AVISADO' : 'NO_APLICA', 'vence' => null];
        }
        $vence = Carbon::parse($i->started_at)->addMinutes((int) Consola::param('ops_incident_notify_minutes', 30));
        $estado = match (true) {
            $i->customers_notified_at !== null => Carbon::parse($i->customers_notified_at)->lessThanOrEqualTo($vence) ? 'A_TIEMPO' : 'FUERA_DE_PLAZO',
            $i->status === 'RESOLVED' => 'SIN_AVISO',
            now()->greaterThan($vence) => 'VENCIDO',
            default => 'PENDIENTE',
        };

        return ['estado' => $estado, 'vence' => $vence->toIso8601String()];
    }

    private static function presentar(object $i): array
    {
        $fin = $i->resolved_at ? Carbon::parse($i->resolved_at) : now();

        return [
            'id' => $i->id, 'number' => $i->number, 'title' => $i->title, 'severity' => $i->severity, 'severity_name' => self::SEVERIDADES[$i->severity],
            'component_code' => $i->component_code, 'component_name' => $i->component_name ?? null, 'status' => $i->status, 'status_name' => self::ESTADOS[$i->status],
            'affects_all' => (bool) $i->affects_all, 'started_at' => $i->started_at, 'resolved_at' => $i->resolved_at,
            'duracion_min' => (int) Carbon::parse($i->started_at)->diffInMinutes($fin, true), 'public_message' => $i->public_message,
            'customers_notified_at' => $i->customers_notified_at, 'aviso' => self::aviso($i), 'root_cause' => $i->root_cause, 'postmortem' => $i->postmortem,
            'source' => $i->source, 'created_by_name' => $i->created_by_name,
        ];
    }
}
