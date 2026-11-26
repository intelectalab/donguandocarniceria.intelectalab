<?php

namespace App\Modulos\Int\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * INT-06 Mensajes salientes (outbox) e INT-07 Cola muerta.
 *  - RN-INT-08: todo efecto externo se registra con encolar() dentro de la misma transacción del cambio de negocio; si
 *    esa transacción se revierte, el mensaje no existe y no se envía nada. El envío lo hace después el despacho.
 *  - RN-INT-09: un envío fallido se reintenta con espera int_outbox_base_delay_seconds (30) × 2^(intento − 1), con tope
 *    int_outbox_max_delay_seconds (3600). Al fallar int_outbox_max_attempts (8) veces pasa a la cola muerta y avisa con
 *    severidad crítica a la administración del sistema.
 *  - RN-INT-10: un mensaje de la cola muerta solo se reintenta o cancela a mano, con int.outbox.retry y un motivo de al
 *    menos 10 caracteres; queda en la bitácora.
 *  - RN-INT-11: cada mensaje tiene una clave de idempotencia única que va al proveedor.
 *  - RN-INT-14: con el módulo dueño (o el del conector) apagado, el mensaje no se crea.
 */
final class Salientes
{
    public const ESTADOS = ['PENDING' => 'Pendiente', 'RETRYING' => 'Reintentando', 'SENT' => 'Enviado', 'DEAD' => 'Cola muerta', 'CANCELLED' => 'Cancelado'];

    public const TIPOS = ['MESSAGE' => 'Mensaje', 'EINVOICE' => 'Comprobante', 'SYNC' => 'Sincronización', 'DOMAIN_EVENT' => 'Evento de dominio'];

    /**
     * Lo que hace cada módulo dueño cuando el proveedor acepta su mensaje (por ejemplo CRM marca el mensaje del chat como
     * enviado y registra su costo): módulo => callable(object $mensaje). Lo instala el módulo al arrancar.
     */
    public static array $alEnviar = [];

    /**
     * Registra un mensaje para enviar. Se llama dentro de la transacción del cambio de negocio (RN-INT-08).
     * Devuelve el id, o null si el módulo está apagado (RN-INT-14).
     */
    public static function encolar(string $conector, string $modulo, string $tipo, ?string $evento, array $contenido, ?string $ref = null, ?string $clave = null): ?string
    {
        $c = Conectores::fila($conector);
        if (! Conectores::moduloEncendido($modulo) || ! Conectores::moduloEncendido($c->owner_module)) {
            return null;
        }
        $clave ??= 'ob-'.bin2hex(random_bytes(12));
        if (DB::table('outbox_messages')->where('idempotency_key', $clave)->exists()) {
            RuleError::fail('RN-INT-11', "La clave de idempotencia {$clave} ya está en los mensajes salientes.");
        }

        return DB::transaction(fn () => DB::table('outbox_messages')->insertGetId([
            'number' => self::siguienteNumero(),
            'status' => 'PENDING', 'attempts' => 0, 'next_attempt_at' => now(), 'tries' => '[]', 'manual' => '[]', 'idempotency_key' => $clave,
            'connector_id' => $c->id, 'module' => $modulo, 'kind' => $tipo, 'event' => $evento ? mb_substr($evento, 0, 40) : null,
            'payload' => json_encode($contenido, JSON_UNESCAPED_UNICODE), 'ref' => $ref ? mb_substr($ref, 0, 40) : null, 'created_at' => now(), 'updated_at' => now(),
        ], 'id'));
    }

    /** OB-000168: el siguiente al último de la empresa. El bloqueo (hasta que termine la transacción) evita números repetidos. */
    private static function siguienteNumero(): string
    {
        DB::select("SELECT pg_advisory_xact_lock(hashtext('outbox_number:' || coalesce(app_tenant_id()::text, '')))");
        $ultimo = DB::table('outbox_messages')->where('number', '~', '^OB-[0-9]+$')->orderByRaw('length(number) DESC, number DESC')->value('number');

        return 'OB-'.str_pad((string) ((int) substr((string) $ultimo, 3) + 1), 6, '0', STR_PAD_LEFT);
    }

    /**
     * Un intento de envío. Toma el mensaje con bloqueo (dos despachos a la vez no lo envían dos veces) y lo deja
     * enviado, reintentando o en la cola muerta.
     */
    public static function despachar(string $id): ?object
    {
        return DB::transaction(function () use ($id) {
            $m = DB::table('outbox_messages')->where('id', $id)->whereIn('status', ['PENDING', 'RETRYING'])->lockForUpdate()->first();
            if (! $m) {
                return DB::table('outbox_messages')->where('id', $id)->first();
            }
            $c = Conectores::fila($m->connector_id);
            $r = $c->status === 'DISABLED' ? ['ok' => false, 'ref' => null, 'error' => 'El conector está desactivado.', 'del_proveedor' => false] : Adaptadores::enviar($c, $m);
            $intentos = (int) $m->attempts + 1;
            $hechos = json_decode($m->tries ?? '[]', true) ?: [];
            if ($r['ok']) {
                DB::table('outbox_messages')->where('id', $id)->update(['status' => 'SENT', 'attempts' => $intentos, 'sent_at' => now(), 'provider_ref' => mb_substr((string) $r['ref'], 0, 80),
                    'last_error' => null, 'next_attempt_at' => null, 'tries' => json_encode([...$hechos, ['at' => now()->toIso8601String(), 'ok' => true]]), 'updated_at' => now()]);
                Conectores::reportar($c->id, true);
                $enviado = DB::table('outbox_messages')->where('id', $id)->first();
                if (isset(self::$alEnviar[$m->module])) {
                    (self::$alEnviar[$m->module])($enviado);
                }

                return $enviado;
            }
            $max = self::maxIntentos();
            $espera = $intentos < $max ? self::espera($intentos) : null;
            $hechos[] = ['at' => now()->toIso8601String(), 'ok' => false, 'error' => $r['error'], 'delay' => $espera];
            if ($r['del_proveedor']) {
                Conectores::reportar($c->id, false, $r['error']);
            }
            if ($intentos >= $max) {
                DB::table('outbox_messages')->where('id', $id)->update(['status' => 'DEAD', 'attempts' => $intentos, 'last_error' => mb_substr($r['error'], 0, 255),
                    'dead_at' => now(), 'next_attempt_at' => null, 'tries' => json_encode($hechos, JSON_UNESCAPED_UNICODE), 'updated_at' => now()]);
                Events::emit('outbox.dead', 'outbox_messages', $id, ['number' => $m->number, 'attempts' => $intentos]);
                DB::table('notifications')->insert(['role' => 'ADMIN_SISTEMA', 'module' => 'INT', 'tone' => 'bad', 'severity' => 'CRITICAL', 'type' => 'INTEGRATIONS', 'at' => now(),
                    'title' => "Mensaje {$m->number} en la cola muerta", 'body' => "{$c->name} falló {$intentos} veces: {$r['error']} Reintenta o cancela con motivo.",
                    'ref' => json_encode(['href' => "/m/int/int-07?mensaje={$id}"])]);
            } else {
                DB::table('outbox_messages')->where('id', $id)->update(['status' => 'RETRYING', 'attempts' => $intentos, 'last_error' => mb_substr($r['error'], 0, 255),
                    'next_attempt_at' => now()->addSeconds($espera), 'tries' => json_encode($hechos, JSON_UNESCAPED_UNICODE), 'updated_at' => now()]);
            }

            return DB::table('outbox_messages')->where('id', $id)->first();
        });
    }

    /**
     * Despacha los mensajes que tocan (la tarea programada, cada minuto). Con $todos, también los que esperan su próximo
     * intento («Procesar ahora», a mano).
     */
    public static function procesar(bool $todos = false, int $limite = 200): int
    {
        $q = DB::table('outbox_messages')->whereIn('status', ['PENDING', 'RETRYING']);
        if (! $todos) {
            $q->where(fn ($w) => $w->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', now()));
        }
        $n = 0;
        foreach ($q->orderBy('next_attempt_at')->limit($limite)->pluck('id') as $id) {
            self::despachar($id);
            $n++;
        }

        return $n;
    }

    /** RN-INT-09: espera antes del intento siguiente, en segundos. */
    public static function espera(int $intento): int
    {
        $base = (int) (Params::get('int_outbox_base_delay_seconds') ?? 30);
        $tope = (int) (Params::get('int_outbox_max_delay_seconds') ?? 3600);

        return (int) min($tope, $base * (2 ** max(0, $intento - 1)));
    }

    /** RN-INT-10: reintento a mano de un mensaje de la cola muerta. Si vuelve a fallar, sigue en la cola muerta. */
    public static function reintentar(string $id, string $motivo, User $quien): array
    {
        $m = self::muerto($id, $motivo);
        self::accionManual($m, 'RETRY', $motivo, $quien, ['status' => 'PENDING', 'attempts' => self::maxIntentos() - 1]);
        $r = self::despachar($id);
        if ($r->status !== 'SENT') {
            DB::table('outbox_messages')->where('id', $id)->update(['status' => 'DEAD', 'next_attempt_at' => null, 'dead_at' => now(), 'updated_at' => now()]);
        }

        return self::ver($id);
    }

    public static function cancelar(string $id, string $motivo, User $quien): array
    {
        $m = self::muerto($id, $motivo);
        self::accionManual($m, 'CANCEL', $motivo, $quien, ['status' => 'CANCELLED', 'cancel_reason' => trim($motivo), 'next_attempt_at' => null]);

        return self::ver($id);
    }

    public static function lista(array $f): array
    {
        $q = DB::table('outbox_messages as m')->join('integration_connectors as c', 'c.id', '=', 'm.connector_id')
            ->select('m.id', 'm.number', 'm.status', 'm.attempts', 'm.next_attempt_at', 'm.last_error', 'm.module', 'm.kind', 'm.event', 'm.ref', 'm.sent_at', 'm.dead_at',
                'm.created_at', 'm.connector_id', 'c.name as connector_name');
        foreach (['status' => 'm.status', 'connector' => 'm.connector_id', 'module' => 'm.module', 'kind' => 'm.kind'] as $k => $col) {
            if (! empty($f[$k])) {
                $q->where($col, $f[$k]);
            }
        }
        if (! empty($f['dia'])) {
            $q->whereRaw("(m.created_at AT TIME ZONE 'America/Lima')::date = ?", [$f['dia']]);
        }
        if (! empty($f['muertos'])) {
            $q->where(fn ($w) => $w->where('m.status', 'DEAD')->orWhereRaw('jsonb_array_length(m.manual) > 0'));
        }
        $q->orderByDesc('m.created_at')->orderBy('m.id');
        Paginas::ordenar($q, ['number' => 'm.number', 'created_at' => 'm.created_at', 'module' => 'm.module', 'event' => 'm.event', 'kind' => 'm.kind',
            'connector' => 'c.name', 'ref' => 'm.ref', 'attempts' => 'm.attempts', 'next_attempt_at' => 'm.next_attempt_at', 'status' => 'm.status',
            'last_error' => 'm.last_error', 'dead_at' => 'm.dead_at'], 'm.id', $f);

        return Paginas::de($q, fn ($m) => (array) $m + ['status_name' => self::ESTADOS[$m->status] ?? $m->status, 'kind_name' => self::TIPOS[$m->kind] ?? $m->kind,
            'attempts' => (int) $m->attempts], $f) + [
                'cifras' => self::cifras(), 'max_intentos' => self::maxIntentos(),
                'conectores' => DB::table('integration_connectors as c')->whereExists(fn ($w) => $w->from('outbox_messages as x')->whereColumn('x.connector_id', 'c.id'))->orderBy('c.name')->get(['c.id', 'c.name']),
                'modulos' => DB::table('outbox_messages')->distinct()->orderBy('module')->pluck('module'),
                'estados' => self::ESTADOS, 'tipos' => self::TIPOS,
            ];
    }

    public static function ver(string $id): array
    {
        $m = DB::table('outbox_messages as m')->join('integration_connectors as c', 'c.id', '=', 'm.connector_id')->where('m.id', $id)
            ->select('m.*', 'c.name as connector_name')->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));

        return array_merge((array) $m, ['status_name' => self::ESTADOS[$m->status] ?? $m->status, 'kind_name' => self::TIPOS[$m->kind] ?? $m->kind,
            'attempts' => (int) $m->attempts, 'max_intentos' => self::maxIntentos(), 'tries' => json_decode($m->tries ?? '[]', true) ?: [],
            'manual' => json_decode($m->manual ?? '[]', true) ?: [], 'payload' => json_decode($m->payload ?? '{}', true)]);
    }

    /** Eventos de dominio que registran los módulos (Events::emit), de solo lectura. */
    public static function eventos(array $f): array
    {
        $q = DB::table('domain_events')->select('id', 'event_name', 'aggregate_type', 'aggregate_id', 'payload', 'user_id', 'occurred_at');
        if (! empty($f['evento'])) {
            $q->where('event_name', $f['evento']);
        }
        $q->orderByDesc('occurred_at')->orderByDesc('id');
        Paginas::ordenar($q, ['occurred_at' => 'occurred_at', 'event_name' => 'event_name'], 'id', $f);
        $usuarios = [];

        $pagina = Paginas::de($q, fn ($e) => array_merge((array) $e, ['payload' => json_decode($e->payload ?? '{}', true)]), $f);
        $ids = array_filter(array_unique(array_column($pagina['data'], 'user_id')));
        if ($ids) {
            $usuarios = DB::table('users')->whereIn('id', $ids)->pluck('name', 'id')->all();
        }
        $pagina['data'] = array_map(fn ($e) => $e + ['user_name' => $usuarios[$e['user_id'] ?? ''] ?? null], $pagina['data']);

        return $pagina + ['eventos' => DB::table('domain_events')->distinct()->orderBy('event_name')->pluck('event_name')];
    }

    /**
     * KPI-INT-01 (éxito de entrega en 30 días) y los mensajes por estado. Los 30 días terminan en el último mensaje
     * registrado: en operación es hoy, y en una empresa sin movimiento reciente sigue mostrando su último mes.
     */
    public static function cifras(): array
    {
        $r = DB::selectOne(<<<'SQL'
            SELECT count(*) FILTER (WHERE status = 'PENDING') AS pendientes, count(*) FILTER (WHERE status = 'RETRYING') AS reintentando,
                   count(*) FILTER (WHERE status = 'DEAD') AS muertos,
                   count(*) FILTER (WHERE status <> 'DEAD' AND jsonb_array_length(manual) > 0) AS atendidos,
                   max(created_at) AS hasta,
                   count(*) FILTER (WHERE status = 'SENT' AND created_at >= (SELECT max(created_at) FROM outbox_messages) - interval '30 days') AS enviados_30,
                   count(*) FILTER (WHERE status = 'DEAD' AND created_at >= (SELECT max(created_at) FROM outbox_messages) - interval '30 days') AS muertos_30
            FROM outbox_messages
            SQL);
        $base = (int) $r->enviados_30 + (int) $r->muertos_30;

        return ['pendientes' => (int) $r->pendientes, 'reintentando' => (int) $r->reintentando, 'muertos' => (int) $r->muertos, 'atendidos' => (int) $r->atendidos,
            'exito' => $base ? round((int) $r->enviados_30 / $base * 100, 2) : null, 'enviados_30' => (int) $r->enviados_30, 'base_30' => $base, 'hasta' => $r->hasta];
    }

    private static function muerto(string $id, string $motivo): object
    {
        $m = DB::table('outbox_messages')->where('id', $id)->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        if ($m->status !== 'DEAD') {
            RuleError::fail('RN-INT-10', 'Solo se reintentan o cancelan los mensajes de la cola muerta.');
        }
        if (mb_strlen(trim($motivo)) < 10) {
            RuleError::fail('RN-INT-10', 'El motivo tiene al menos 10 caracteres.');
        }

        return $m;
    }

    private static function accionManual(object $m, string $accion, string $motivo, User $quien, array $cambios): void
    {
        $manual = [...(json_decode($m->manual ?? '[]', true) ?: []), ['at' => now()->toIso8601String(), 'by' => $quien->name, 'action' => $accion, 'reason' => trim($motivo)]];
        DB::table('outbox_messages')->where('id', $m->id)->update($cambios + ['manual' => json_encode($manual, JSON_UNESCAPED_UNICODE), 'updated_at' => now()]);
        Events::emit($accion === 'RETRY' ? 'outbox.retried' : 'outbox.cancelled', 'outbox_messages', $m->id, ['by' => $quien->id, 'number' => $m->number, 'reason' => trim($motivo)]);
    }

    private static function maxIntentos(): int
    {
        return max(1, (int) (Params::get('int_outbox_max_attempts') ?? 8));
    }
}
