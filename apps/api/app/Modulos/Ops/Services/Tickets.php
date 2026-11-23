<?php

namespace App\Modulos\Ops\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Tickets de soporte: OPS-15 Mis tickets (la empresa) y OPS-09 Bandeja de tickets (la consola).
 *  - La empresa abre un ticket (permiso ops.ticket.create), conversa, lo cierra y lo califica. Ve los suyos, o todos los
 *    de su empresa con ops.ticket.view_all.
 *  - La consola ve los de todas las empresas, responde, cambia el estado y asigna (rol con ticket.manage).
 *  - RN-OPS-15: la primera respuesta se mide contra ops_ticket_first_response_hours según la prioridad; urgente cuenta
 *    las 24 horas, el resto el horario hábil de soporte (lunes a sábado de 9 a 18, hora de Lima, D-OPS-04). Un ticket
 *    resuelto sin respuesta del cliente se cierra a los ops_ticket_auto_close_days días (tarea programada).
 */
final class Tickets
{
    public const CATEGORIAS = [
        'BILLING' => 'Facturación del servicio', 'ONBOARDING' => 'Alta e implementación', 'EINVOICE' => 'Comprobantes y SUNAT', 'WHATSAPP' => 'WhatsApp',
        'ORDERS' => 'Pedidos', 'INVENTORY' => 'Inventario', 'ACCOUNTING' => 'Contabilidad', 'API' => 'Integraciones', 'BUG' => 'Error del sistema',
        'FEATURE_REQUEST' => 'Pedido de mejora', 'OTHER' => 'Otro',
    ];

    public const PRIORIDADES = ['URGENT' => 'Urgente', 'HIGH' => 'Alta', 'NORMAL' => 'Normal', 'LOW' => 'Baja'];

    public const ESTADOS = ['OPEN' => 'Abierto', 'IN_PROGRESS' => 'En proceso', 'WAITING_CUSTOMER' => 'Espera respuesta del cliente', 'RESOLVED' => 'Resuelto', 'CLOSED' => 'Cerrado'];

    private const HORARIO = [9, 18];   // horario hábil de soporte (D-OPS-04)

    /* ------------------------------------------------------------------ OPS-15 la empresa */

    public static function abrir(User $u, array $d): array
    {
        $ahora = now();
        $id = DB::table('support_tickets')->insertGetId([
            'subject' => trim($d['subject']), 'description' => trim($d['description']), 'category' => $d['category'], 'priority' => $d['priority'],
            'status' => 'OPEN', 'opened_by' => $u->id, 'opened_by_name' => $u->name, 'opened_at' => $ahora,
            'first_response_due_at' => self::vencimiento($ahora, $d['priority']), 'created_at' => $ahora, 'updated_at' => $ahora,
        ], 'id');

        return self::detalle($id);
    }

    /** Los tickets que ve esta persona: los suyos, o los de toda la empresa con ops.ticket.view_all. */
    public static function deLaEmpresa(User $u): array
    {
        $q = DB::table('support_tickets')->orderByRaw("status IN ('RESOLVED','CLOSED')")->orderByDesc('opened_at');
        if (! Access::can($u, 'ops.ticket.view_all')) {
            $q->where('opened_by', $u->id);
        }

        return $q->limit(300)->get()->map(fn ($t) => self::fila($t))->all();
    }

    public static function verDeLaEmpresa(User $u, string $id): array
    {
        $t = DB::table('support_tickets')->where('id', $id)->first();
        if (! $t || ($t->opened_by !== $u->id && ! Access::can($u, 'ops.ticket.view_all'))) {
            abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        }

        return self::detalle($id, false);
    }

    /** El cliente escribe: si estaba resuelto lo reabre; esperando su respuesta, vuelve a «en proceso». */
    public static function responderEmpresa(User $u, string $id, string $texto): array
    {
        $t = self::verDeLaEmpresa($u, $id);
        if ($t['status'] === 'CLOSED') {
            RuleError::fail('RN-OPS-15', 'El ticket está cerrado: abre uno nuevo.');
        }
        self::mensaje($id, 'CUSTOMER', $u->name, $texto, $t['status'], 'IN_PROGRESS', userId: $u->id);
        DB::table('support_tickets')->where('id', $id)->update(['status' => 'IN_PROGRESS', 'resolved_at' => null, 'updated_at' => now()]);

        return self::detalle($id, false);
    }

    /** El cliente da por terminado su ticket y, si quiere, lo califica (1 a 5). */
    public static function cerrarEmpresa(User $u, string $id, ?int $estrellas, ?string $comentario): array
    {
        $t = self::verDeLaEmpresa($u, $id);
        if ($t['status'] === 'CLOSED' && $estrellas === null) {
            RuleError::fail('RN-OPS-15', 'El ticket ya está cerrado.');
        }
        if ($estrellas !== null && ! in_array($t['status'], ['RESOLVED', 'CLOSED'], true)) {
            RuleError::fail('RN-OPS-15', 'Se califica cuando soporte marca el ticket como resuelto.');
        }
        if ($comentario) {
            self::mensaje($id, 'CUSTOMER', $u->name, $comentario, null, null, userId: $u->id);
        }
        if ($t['status'] !== 'CLOSED') {
            self::mensaje($id, 'SYSTEM', $u->name, 'Cerrado por el cliente', $t['status'], 'CLOSED', userId: $u->id);
        }
        DB::table('support_tickets')->where('id', $id)->update(['status' => 'CLOSED', 'closed_at' => $t['closed_at'] ?? now(),
            'satisfaction' => $estrellas ?? $t['satisfaction'], 'updated_at' => now()]);

        return self::detalle($id, false);
    }

    /* ------------------------------------------------------------------ OPS-09 la consola */

    public static function bandeja(array $f): array
    {
        $q = DB::table('support_tickets as k')->join('tenants as t', 't.id', '=', 'k.tenant_id')->leftJoin('platform_users as p', 'p.id', '=', 'k.assigned_platform_user')
            ->select('k.*', 't.short as tenant_short', 'p.full_name as assigned_name');
        if (! empty($f['status'])) {
            $f['status'] === 'ACTIVOS' ? $q->whereNotIn('k.status', ['RESOLVED', 'CLOSED']) : $q->where('k.status', $f['status']);
        }
        foreach (['priority' => 'k.priority', 'tenant' => 'k.tenant_id', 'category' => 'k.category'] as $k => $col) {
            if (! empty($f[$k])) {
                $q->where($col, $f[$k]);
            }
        }
        if (! empty($f['assigned'])) {
            $f['assigned'] === 'NONE' ? $q->whereNull('k.assigned_platform_user') : $q->where('k.assigned_platform_user', $f['assigned']);
        }
        if (! empty($f['search'])) {
            $texto = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower(trim($f['search']))).'%';
            $q->where(fn ($w) => $w->whereRaw('lower(k.subject) LIKE ?', [$texto])->orWhereRaw('lower(k.number) LIKE ?', [$texto])->orWhereRaw('lower(t.short) LIKE ?', [$texto]));
        }
        // Urgentes y los que vencen antes, primero; los cerrados al final.
        $filas = $q->orderByRaw("k.status IN ('RESOLVED','CLOSED')")
            ->orderByRaw("CASE k.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END")
            ->orderBy('k.first_response_due_at')->limit(500)->get()->map(fn ($t) => self::fila($t))->all();

        return [
            'data' => $filas,
            'cifras' => [
                'abiertos' => count(array_filter($filas, fn ($t) => ! in_array($t['status'], ['RESOLVED', 'CLOSED'], true))),
                'sin_respuesta' => count(array_filter($filas, fn ($t) => $t['plazo']['estado'] === 'PENDIENTE' || $t['plazo']['estado'] === 'VENCIDO')),
                'vencidos' => count(array_filter($filas, fn ($t) => $t['plazo']['estado'] === 'VENCIDO')),
                'sin_asignar' => count(array_filter($filas, fn ($t) => ! $t['assigned_platform_user'] && ! in_array($t['status'], ['RESOLVED', 'CLOSED'], true))),
            ],
            'personal' => DB::table('platform_users')->where('status', 'ACTIVE')->orderBy('full_name')->get(['id', 'full_name', 'role']),
            'empresas' => DB::table('tenants')->orderBy('short')->get(['id', 'short']),
        ];
    }

    public static function verConsola(string $id): array
    {
        return self::detalle($id);
    }

    /** Soporte responde: cuenta como primera respuesta, se asigna si nadie lo tenía y avisa a quien abrió el ticket. */
    public static function responderConsola(string $id, array $quien, string $texto, string $estado): array
    {
        Consola::exigir($quien, 'ticket.manage');
        $t = self::detalle($id);
        if ($t['status'] === 'CLOSED') {
            RuleError::fail('RN-OPS-15', 'El ticket está cerrado.');
        }
        $ahora = now();
        self::mensaje($id, 'PLATFORM', $quien['full_name'], $texto, $t['status'], $estado, platformUserId: $quien['id'], tenant: $t['tenant_id']);
        DB::table('support_tickets')->where('id', $id)->update([
            'status' => $estado, 'first_response_at' => $t['first_response_at'] ?? $ahora, 'assigned_platform_user' => $t['assigned_platform_user'] ?? $quien['id'],
            'resolved_at' => $estado === 'RESOLVED' ? $ahora : null, 'updated_at' => $ahora,
        ]);
        Consola::bitacora('TICKET_ANSWERED', $quien, ['tenant' => $t['tenant_id'], 'entity' => 'support_tickets', 'entity_id' => $id,
            'reason' => "Respuesta al ticket {$t['number']}", 'detail' => ['estado' => $estado]]);
        self::avisar($t, $estado === 'RESOLVED' ? "Tu ticket {$t['number']} quedó resuelto" : "Soporte respondió tu ticket {$t['number']}", $texto);

        return self::detalle($id);
    }

    public static function asignar(string $id, array $quien, ?string $a): array
    {
        Consola::exigir($quien, 'ticket.manage');
        $t = self::detalle($id);
        if ($a && ! DB::table('platform_users')->where('id', $a)->where('status', 'ACTIVE')->exists()) {
            RuleError::fail('RN-OPS-10', 'Elige a alguien activo del equipo.');
        }
        DB::table('support_tickets')->where('id', $id)->update(['assigned_platform_user' => $a, 'updated_at' => now()]);
        $nombre = $a ? DB::table('platform_users')->where('id', $a)->value('full_name') : 'nadie';
        Consola::bitacora('TICKET_ASSIGNED', $quien, ['tenant' => $t['tenant_id'], 'entity' => 'support_tickets', 'entity_id' => $id, 'reason' => "Ticket {$t['number']} asignado a {$nombre}"]);

        return self::detalle($id);
    }

    /** RN-OPS-15: resueltos sin respuesta del cliente en N días pasan a cerrados. Devuelve cuántos. */
    public static function cerrarResueltos(): int
    {
        $dias = (int) Consola::param('ops_ticket_auto_close_days', 7);
        TenantContext::platform();
        $n = 0;
        foreach (DB::table('support_tickets')->where('status', 'RESOLVED')->where('resolved_at', '<=', now()->subDays($dias))->get() as $t) {
            self::mensaje($t->id, 'SYSTEM', 'Sistema', "Cerrado: el cliente no respondió en {$dias} días", 'RESOLVED', 'CLOSED', tenant: $t->tenant_id);
            DB::table('support_tickets')->where('id', $t->id)->update(['status' => 'CLOSED', 'closed_at' => now(), 'updated_at' => now()]);
            $n++;
        }
        TenantContext::set(null);

        return $n;
    }

    /* ------------------------------------------------------------------ plazo */

    /** RN-OPS-15: cuándo vence la primera respuesta. Urgente: horas corridas; el resto, horario hábil de lunes a sábado. */
    public static function vencimiento(Carbon|string $abierto, string $prioridad): Carbon
    {
        $horas = (float) (((array) Consola::param('ops_ticket_first_response_hours', []))[$prioridad] ?? ['URGENT' => 1, 'HIGH' => 4, 'NORMAL' => 8, 'LOW' => 24][$prioridad]);
        $t = Carbon::parse($abierto)->timezone('America/Lima');
        if ($prioridad === 'URGENT') {
            return $t->copy()->addMinutes((int) round($horas * 60))->timezone(config('app.timezone'));
        }
        $resto = (int) round($horas * 60);
        for ($i = 0; $i < 400 && $resto > 0; $i++) {
            if (! $t->isSunday()) {
                $inicio = $t->copy()->setTime(self::HORARIO[0], 0);
                $fin = $t->copy()->setTime(self::HORARIO[1], 0);
                $desde = $t->greaterThan($inicio) ? $t->copy() : $inicio;
                if ($fin->greaterThan($desde)) {
                    $disponible = (int) $desde->diffInMinutes($fin, true);
                    if ($disponible >= $resto) {
                        return $desde->addMinutes($resto)->timezone(config('app.timezone'));
                    }
                    $resto -= $disponible;
                }
            }
            $t = $t->copy()->addDay()->startOfDay();
        }

        return $t->timezone(config('app.timezone'));
    }

    /* ------------------------------------------------------------------ internos */

    private static function fila(object $t): array
    {
        $vence = Carbon::parse($t->first_response_due_at);
        $plazo = match (true) {
            $t->first_response_at !== null => Carbon::parse($t->first_response_at)->lessThanOrEqualTo($vence) ? 'CUMPLIDO' : 'FUERA_DE_PLAZO',
            in_array($t->status, ['RESOLVED', 'CLOSED'], true) => 'SIN_RESPUESTA',
            now()->greaterThan($vence) => 'VENCIDO',
            default => 'PENDIENTE',
        };

        return [
            'id' => $t->id, 'tenant_id' => $t->tenant_id, 'tenant_short' => $t->tenant_short ?? null, 'number' => $t->number, 'subject' => $t->subject,
            'category' => $t->category, 'category_name' => self::CATEGORIAS[$t->category] ?? $t->category,
            'priority' => $t->priority, 'priority_name' => self::PRIORIDADES[$t->priority], 'status' => $t->status, 'status_name' => self::ESTADOS[$t->status],
            'opened_by_name' => $t->opened_by_name, 'opened_at' => $t->opened_at, 'assigned_platform_user' => $t->assigned_platform_user,
            'assigned_name' => $t->assigned_name ?? null, 'first_response_at' => $t->first_response_at, 'resolved_at' => $t->resolved_at, 'closed_at' => $t->closed_at,
            'satisfaction' => $t->satisfaction, 'plazo' => ['estado' => $plazo, 'vence' => $t->first_response_due_at],
        ];
    }

    private static function detalle(string $id, bool $consola = true): array
    {
        $t = DB::table('support_tickets as k')->leftJoin('platform_users as p', 'p.id', '=', 'k.assigned_platform_user')->where('k.id', $id)
            ->select('k.*', 'p.full_name as assigned_name')->first();
        if (! $t) {
            abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        }
        if ($consola) {
            $t->tenant_short = DB::table('tenants')->where('id', $t->tenant_id)->value('short');
        }

        return self::fila($t) + [
            'description' => $t->description,
            'mensajes' => DB::table('support_ticket_messages')->where('ticket_id', $id)->orderBy('created_at')
                ->get(['author_type', 'author_name', 'body', 'status_from', 'status_to', 'created_at'])
                ->map(fn ($m) => (array) $m + ['status_to_name' => $m->status_to ? self::ESTADOS[$m->status_to] : null])->all(),
        ];
    }

    private static function mensaje(string $ticket, string $tipo, string $autor, string $texto, ?string $de, ?string $a, ?string $userId = null,
        ?string $platformUserId = null, ?string $tenant = null): void
    {
        DB::table('support_ticket_messages')->insert(array_filter([
            'ticket_id' => $ticket, 'author_type' => $tipo, 'author_name' => mb_substr($autor, 0, 120), 'author_user_id' => $userId,
            'author_platform_user_id' => $platformUserId, 'body' => trim($texto), 'status_from' => $de !== $a ? $de : null, 'status_to' => $de !== $a ? $a : null,
            'tenant_id' => $tenant, 'created_at' => now(),
        ], fn ($v) => $v !== null));
    }

    /** Aviso en la campana para quien abrió el ticket (las notificaciones son de su empresa: se escribe con su contexto). */
    private static function avisar(array $t, string $titulo, string $texto): void
    {
        $abrio = DB::table('support_tickets')->where('id', $t['id'])->value('opened_by');
        if (! $abrio) {
            return;
        }
        TenantContext::set(TenantContext::find($t['tenant_id']));
        try {
            DB::table('notifications')->insert(['user_id' => $abrio, 'module' => 'OPS', 'tone' => 'info', 'at' => now(), 'title' => $titulo,
                'body' => mb_substr(trim($texto), 0, 240), 'ref' => json_encode(['href' => "/soporte?ticket={$t['id']}"])]);
        } finally {
            TenantContext::platform();
        }
    }
}
