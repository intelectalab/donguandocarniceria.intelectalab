<?php

namespace App\Modulos\Tel\Services;

use App\Models\User;
use App\Modulos\Aud\Services\Retencion;
use App\Modulos\Crm\Services\Control;
use App\Modulos\Int\Services\Archivos;
use App\Modulos\Int\Services\Simulador;
use App\Modulos\Seg\Services\Bitacora;
use App\Support\Access;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * TEL-10 Grabación y transcripción y TEL-12 Escuchas y retención (RN-TEL-09, 10 y 11; Ley 29733).
 *
 *  - Escuchar: la vendedora sus grabaciones (tel.recording.listen_own); la supervisión y la gerencia todas las de sus
 *    marcas (listen_all). Descargar exige tel.recording.download y motivo. Cada escucha o descarga queda en la bitácora
 *    de la grabación (solo inserción) y en la bitácora de accesos de AUD.
 *  - Transcribir: con la transcripción encendida en Ajustes; el texto pasa por las reglas de control de CRM y cada
 *    coincidencia es una alerta de la llamada. Una sola vez por grabación.
 *  - Retención legal: la marca la supervisión o la gerencia, con motivo; la grabación no se purga mientras siga.
 *  - Purga: cada noche (y a pedido) la grabación vencida y sin retención legal pierde su audio y queda «purgada»; los
 *    datos de la llamada se conservan. Cada corrida queda en las corridas de depuración de AUD.
 */
class Grabaciones
{
    public const ESTADOS = ['AVAILABLE' => 'Disponible', 'PURGED' => 'Purgada'];

    public const ACCIONES = ['PLAY' => 'Escucha', 'DOWNLOAD' => 'Descarga'];

    /** Textos de muestra del proveedor de prueba (sin proveedor contratado no hay transcripción real). */
    private const MUESTRAS = [
        'Vendedora: Buenos días, habla la vendedora de la marca. Cliente: Quería dos cuyes enteros para el sábado. Vendedora: Claro, ¿a la misma dirección? Le confirmo la franja de 9 a 13 y le llega el resumen por WhatsApp.',
        'Cliente: ¿Tienen caldo de huesos congelado? Vendedora: Sí, de un litro a 18 soles. ¿Se lo agrego al pedido de mañana? Cliente: Sí, dos por favor.',
        'Cliente: El pollo llegó con menos peso. Vendedora: Le reviso el peso real en balanza y le devolvemos la diferencia como saldo a favor.',
        'Vendedora: Le llamo para confirmar su pedido de bondiola, son 1,5 kg; el peso final puede variar hasta 5 %.',
    ];

    /** Las grabaciones de las llamadas que la persona puede ver. */
    private static function base(User $u)
    {
        $marcas = Access::for($u)['brands'];
        $q = DB::table('tel_recordings as r')->join('tel_calls as c', 'c.id', '=', 'r.call_id')->when($marcas, fn ($w) => $w->whereIn('c.brand_id', $marcas));

        return Access::can($u, 'tel.recording.listen_all') || Access::can($u, 'tel.call.view_all') ? $q : $q->where('c.user_id', $u->id);
    }

    private static function conLlamada($q)
    {
        return $q->leftJoin('customers as cu', 'cu.id', '=', 'c.customer_id')->leftJoin('leads as l', 'l.id', '=', 'c.lead_id')
            ->leftJoin('users as x', 'x.id', '=', 'c.user_id')->leftJoin('brands as b', 'b.id', '=', 'c.brand_id')->leftJoin('sales_orders as o', 'o.id', '=', 'c.order_id');
    }

    private static function puedeEscuchar(object $r, User $u): bool
    {
        return Access::can($u, 'tel.recording.listen_all') || ($r->user_id === $u->id && Access::can($u, 'tel.recording.listen_own'));
    }

    private static function supervisa(User $u): bool
    {
        return Access::can($u, 'tel.recording.listen_all');
    }

    /** La transcripción encendida en Ajustes (el parámetro manda; si no está, la fila de ajustes). */
    private static function transcripcionEncendida(): bool
    {
        $v = Params::get('tel_transcription_enabled') ?? Ajustes::fila()?->transcription_enabled ?? false;

        return in_array($v, [true, 1, '1', 'true', 'sí', 'si'], true);
    }

    private static function hoy(): string
    {
        return now('America/Lima')->toDateString();
    }

    private static function buscar($q, ?string $t): void
    {
        $t = trim((string) $t);
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('c.from_e164', 'ilike', $p)->orWhere('c.to_e164', 'ilike', $p)->orWhere('cu.full_name', 'ilike', $p)->orWhere('cu.trade_name', 'ilike', $p)
                ->orWhere('l.full_name', 'ilike', $p)->orWhere('o.number', 'ilike', $p)->orWhere('x.name', 'ilike', $p));
        }
    }

    private static function columnas(): array
    {
        return ['r.*', 'c.direction', 'c.from_e164', 'c.to_e164', 'c.started_at', 'c.user_id', 'c.brand_id', 'c.customer_id', 'c.lead_id', 'c.notice_played',
            'x.name as vendedora', 'b.name as marca', 'o.number as pedido', DB::raw('coalesce(cu.trade_name, cu.full_name, l.full_name) AS cliente')];
    }

    private static function presentar(object $r, User $u): array
    {
        $vence = Carbon::parse($r->retention_until, 'America/Lima');

        return [
            'id' => $r->id, 'call_id' => $r->call_id, 'status' => $r->status, 'estado' => self::ESTADOS[$r->status] ?? $r->status,
            'direccion' => $r->direction === 'INBOUND' ? 'Entrante' : 'Saliente', 'numero' => $r->direction === 'INBOUND' ? $r->from_e164 : $r->to_e164,
            'cliente' => $r->cliente, 'vendedora' => $r->vendedora, 'marca' => $r->marca, 'pedido' => $r->pedido, 'started_at' => $r->started_at,
            'duration_seconds' => (int) $r->duration_seconds, 'retention_until' => $r->retention_until, 'dias' => $r->status === 'AVAILABLE' ? (int) now('America/Lima')->startOfDay()->diffInDays($vence, false) : null,
            'legal_hold' => (bool) $r->legal_hold, 'legal_hold_reason' => $r->legal_hold_reason, 'purged_at' => $r->purged_at, 'preview' => (bool) $r->preview,
            'transcrita' => (bool) ($r->transcrita ?? false), 'alertas' => (int) ($r->alertas ?? 0), 'puede' => self::puedeEscuchar($r, $u),
        ];
    }

    /** Cuántas alertas tiene cada grabación: las de control de su llamada y las de demostración de su transcripción. */
    private static function conCifras($q)
    {
        return $q->addSelect([
            DB::raw('EXISTS (SELECT 1 FROM tel_transcripts t WHERE t.recording_id = r.id) AS transcrita'),
            DB::raw("((SELECT count(*) FROM control_alerts a WHERE a.call_id = r.call_id AND a.source_type = 'CALL_TRANSCRIPT')
                + coalesce((SELECT jsonb_array_length(t.preview_alerts) FROM tel_transcripts t WHERE t.recording_id = r.id), 0)) AS alertas"),
        ]);
    }

    /* ------------------------------------------------------------------ TEL-10 */

    public static function lista(array $f, User $u): array
    {
        $q = self::conLlamada(self::base($u));
        foreach (['marca' => 'c.brand_id', 'vendedora' => 'c.user_id', 'estado' => 'r.status'] as $k => $col) {
            if (! empty($f[$k])) {
                $q->where($col, $f[$k]);
            }
        }
        if (! empty($f['desde'])) {
            $q->where('c.started_at', '>=', Carbon::parse($f['desde'], 'America/Lima')->startOfDay());
        }
        if (! empty($f['hasta'])) {
            $q->where('c.started_at', '<=', Carbon::parse($f['hasta'], 'America/Lima')->endOfDay());
        }
        self::buscar($q, $f['buscar'] ?? null);
        $c = (clone $q)->selectRaw("count(*) FILTER (WHERE r.status = 'AVAILABLE') AS disponibles,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM tel_transcripts t WHERE t.recording_id = r.id)) AS transcritas,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM control_alerts a WHERE a.call_id = r.call_id AND a.source_type = 'CALL_TRANSCRIPT')
                OR EXISTS (SELECT 1 FROM tel_transcripts t WHERE t.recording_id = r.id AND jsonb_array_length(t.preview_alerts) > 0)) AS con_alertas,
            count(*) FILTER (WHERE r.legal_hold) AS retenidas")->first();
        match ($f['texto'] ?? '') {
            '1' => $q->whereExists(fn ($w) => $w->from('tel_transcripts as t')->whereColumn('t.recording_id', 'r.id')),
            '0' => $q->whereNotExists(fn ($w) => $w->from('tel_transcripts as t')->whereColumn('t.recording_id', 'r.id')),
            default => null,
        };
        if (($f['alertas'] ?? '') === '1') {
            $q->where(fn ($w) => $w->whereExists(fn ($x) => $x->from('control_alerts as a')->whereColumn('a.call_id', 'r.call_id')->where('a.source_type', 'CALL_TRANSCRIPT'))
                ->orWhereExists(fn ($x) => $x->from('tel_transcripts as t')->whereColumn('t.recording_id', 'r.id')->whereRaw('jsonb_array_length(t.preview_alerts) > 0')));
        }
        $q->orderByDesc('c.started_at')->orderBy('r.id');
        Paginas::ordenar($q, ['inicio' => 'c.started_at', 'cliente' => 'coalesce(cu.trade_name, cu.full_name, l.full_name)', 'vendedora' => 'x.name', 'marca' => 'b.name',
            'duracion' => 'r.duration_seconds', 'retencion' => 'r.retention_until', 'estado' => 'r.status'], 'r.id', $f);
        $q->select(self::columnas());
        self::conCifras($q);
        $marcas = Access::for($u)['brands'];

        return Paginas::de($q, fn ($r) => self::presentar($r, $u), $f) + [
            'cifras' => ['disponibles' => (int) $c->disponibles, 'transcritas' => (int) $c->transcritas, 'con_alertas' => (int) $c->con_alertas, 'retenidas' => (int) $c->retenidas],
            'transcripcion' => self::transcripcionEncendida(),
            'opciones' => [
                'marcas' => DB::table('brands')->when($marcas, fn ($w) => $w->whereIn('id', $marcas))->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name'])
                    ->map(fn ($b) => ['value' => $b->id, 'label' => $b->name])->all(),
                'vendedoras' => self::supervisa($u) ? DB::table('users as x')->whereIn('x.id', self::base($u)->whereNotNull('c.user_id')->select('c.user_id'))->orderBy('x.name')
                    ->get(['x.id', 'x.name'])->map(fn ($x) => ['value' => $x->id, 'label' => $x->name])->all() : [],
            ],
        ];
    }

    private static function fila(string $id, User $u): object
    {
        $q = self::conLlamada(self::base($u))->where('r.id', $id)->select(self::columnas());

        return self::conCifras($q)->first() ?? abort(404);
    }

    public static function ver(string $id, User $u): array
    {
        $r = self::fila($id, $u);
        $t = DB::table('tel_transcripts')->where('recording_id', $r->id)->first();
        $alertas = DB::table('control_alerts as a')->leftJoin('control_alert_rules as k', 'k.id', '=', 'a.rule_id')->where('a.call_id', $r->call_id)->where('a.source_type', 'CALL_TRANSCRIPT')
            ->orderBy('a.raised_at')->get(['a.id', 'a.severity', 'a.matched_text', 'a.status', 'a.raised_at', 'k.name as regla'])
            ->map(fn ($a) => ['id' => $a->id, 'regla' => $a->regla ?? 'Regla de control', 'gravedad' => $a->severity, 'coincidencia' => $a->matched_text,
                'estado' => Control::ESTADOS[$a->status] ?? $a->status, 'status' => $a->status, 'raised_at' => $a->raised_at, 'demo' => false])->all();
        foreach (json_decode((string) ($t->preview_alerts ?? '[]'), true) ?: [] as $a) {
            $alertas[] = ['id' => null, 'regla' => $a['label'] ?? 'Regla de control', 'gravedad' => $a['severity'] ?? 'MEDIUM', 'coincidencia' => $a['matched_text'] ?? '',
                'estado' => Control::ESTADOS[$a['status'] ?? 'OPEN'] ?? 'Abierta', 'status' => $a['status'] ?? 'OPEN', 'raised_at' => $a['raised_at'] ?? null, 'demo' => true];
        }
        // La bitácora completa de la grabación la ve la supervisión; la vendedora, solo sus propias escuchas.
        $accesos = DB::table('tel_recording_access_log as g')->leftJoin('users as x', 'x.id', '=', 'g.user_id')->where('g.recording_id', $r->id)
            ->when(! self::supervisa($u), fn ($w) => $w->where('g.user_id', $u->id))->orderByDesc('g.accessed_at')->limit(50)
            ->get(['g.action', 'g.reason', 'g.accessed_at', 'x.name as quien'])
            ->map(fn ($g) => ['accion' => self::ACCIONES[$g->action] ?? $g->action, 'action' => $g->action, 'motivo' => $g->reason, 'accessed_at' => $g->accessed_at, 'quien' => $g->quien])->all();

        return self::presentar($r, $u) + [
            'notice_played' => (bool) $r->notice_played, 'customer_id' => $r->customer_id, 'lead_id' => $r->lead_id,
            'transcripcion' => $t ? ['texto' => $t->transcript, 'proveedor' => $t->provider === 'FAKE' ? 'Proveedor de prueba' : 'Twilio Voice Intelligence', 'idioma' => $t->language,
                'cost_usd' => (float) $t->cost_usd, 'created_at' => $t->created_at, 'preview' => (bool) $t->preview] : null,
            'alertas_lista' => $alertas, 'accesos' => $accesos,
            'permisos' => ['escuchar' => self::puedeEscuchar($r, $u) && $r->status === 'AVAILABLE', 'descargar' => Access::can($u, 'tel.recording.download') && $r->status === 'AVAILABLE',
                'transcribir' => ! $t && $r->status === 'AVAILABLE' && self::supervisa($u) && self::transcripcionEncendida(),
                'retencion' => self::supervisa($u) && $r->status === 'AVAILABLE'],
        ];
    }

    /** Escuchar o descargar: queda en la bitácora y devuelve el enlace temporal del audio (si el proveedor lo guardó). */
    public static function acceder(string $id, string $accion, ?string $motivo, User $u): array
    {
        $r = self::fila($id, $u);
        if ($r->status === 'PURGED') {
            RuleError::fail('RN-TEL-10', 'La grabación se purgó el '.Carbon::parse($r->purged_at)->setTimezone('America/Lima')->format('d/m/Y').' al vencer su retención: ya no se puede escuchar. Los datos de la llamada se conservan.');
        }
        if ($accion === 'DOWNLOAD' && ! Access::can($u, 'tel.recording.download')) {
            RuleError::fail('RN-TEL-11', 'Descargar grabaciones exige el permiso de descarga (gerencia).');
        }
        if (! self::puedeEscuchar($r, $u)) {
            RuleError::fail('RN-TEL-11', 'Solo escuchas tus grabaciones; las de otras vendedoras las escucha la supervisión.');
        }
        $motivo = $motivo !== null ? trim($motivo) : null;
        if ($accion === 'DOWNLOAD' && mb_strlen((string) $motivo) < 5) {
            RuleError::fail('RN-TEL-11', 'Para descargar una grabación indica el motivo (reclamo, pedido de autoridad, revisión).');
        }
        DB::table('tel_recording_access_log')->insert(['recording_id' => $r->id, 'user_id' => $u->id, 'action' => $accion, 'reason' => $motivo ? mb_substr($motivo, 0, 255) : null,
            'accessed_at' => DB::raw('clock_timestamp()'), 'preview' => false, 'created_at' => now()]);
        Bitacora::registrar($accion === 'PLAY' ? 'RECORDING_PLAYED' : 'RECORDING_DOWNLOADED', ['user' => $u, 'entity' => 'tel_recordings', 'entity_id' => $r->id, 'modulo' => 'TEL',
            'detail' => ($r->direction === 'INBOUND' ? $r->from_e164 : $r->to_e164).' · '.Carbon::parse($r->started_at)->setTimezone('America/Lima')->format('d/m/Y H:i').($motivo ? " · {$motivo}" : '')]);
        Events::emit('recording.accessed', 'tel_recordings', $r->id, ['action' => $accion, 'by' => $u->id]);

        $enlace = null;
        if ($r->file_id && preg_match('/^[0-9a-f-]{36}$/', (string) $r->file_id) && DB::table('file_attachments')->where('id', $r->file_id)->where('status', 'ACTIVE')->exists()) {
            try {
                $enlace = Archivos::enlace($r->file_id, $u, autorizado: true)['url'];
            } catch (\Throwable) {
                $enlace = null;
            }
        }

        return ['url' => $enlace, 'prueba' => $enlace === null, 'duracion' => (int) $r->duration_seconds];
    }

    /** Transcribe con el proveedor (en prueba, un texto de muestra) y pasa el texto por las reglas de control. */
    public static function transcribir(string $id, User $u, ?string $texto = null): array
    {
        $r = self::fila($id, $u);
        if (! self::supervisa($u)) {
            RuleError::fail('RN-TEL-09', 'Transcribir lo pide la supervisión o la gerencia.');
        }
        if (! self::transcripcionEncendida()) {
            RuleError::fail('RN-TEL-09', 'La transcripción está apagada. Enciéndela en Ajustes de Telefonía.');
        }
        if ($r->status === 'PURGED') {
            RuleError::fail('RN-TEL-10', 'La grabación fue purgada: ya no se puede transcribir.');
        }
        if (DB::table('tel_transcripts')->where('recording_id', $r->id)->exists()) {
            RuleError::fail('RN-TEL-09', 'Esta grabación ya tiene su transcripción.');
        }
        $s = Ajustes::fila();
        $tarifas = array_merge(Ajustes::TARIFAS, (array) json_decode((string) ($s->rates ?? '{}'), true));
        $prov = $s->provider ?? 'FAKE';
        if ($prov !== 'FAKE' && ! Simulador::disponible()) {
            RuleError::fail('RN-TEL-03', 'El proveedor de telefonía todavía no está conectado: la transcripción llega con él.');
        }
        $texto ??= self::MUESTRAS[hexdec(substr(md5($r->id), 0, 2)) % count(self::MUESTRAS)];
        $minutos = (int) ceil(max(1, (int) $r->duration_seconds) / 60);
        try {
            $tid = DB::transaction(function () use ($r, $texto, $minutos, $tarifas, $prov) {
                $tid = DB::table('tel_transcripts')->insertGetId(['call_id' => $r->call_id, 'recording_id' => $r->id, 'provider' => $prov === 'FAKE' ? 'FAKE' : 'TWILIO_VOICE_INTELLIGENCE',
                    'language' => 'es', 'transcript' => $texto, 'cost_usd' => round($minutos * (float) $tarifas['transcription'], 4), 'preview' => false, 'preview_alerts' => '[]',
                    'created_at' => now()], 'id');
                $celular = $r->customer_id ? DB::table('customers')->where('id', $r->customer_id)->value('phone') : ($r->lead_id ? DB::table('leads')->where('id', $r->lead_id)->value('phone') : null);
                Control::revisarLlamada($r->call_id, $texto, $r->user_id, $r->brand_id, $celular ?? ($r->direction === 'INBOUND' ? $r->from_e164 : $r->to_e164));

                return $tid;
            });
        } catch (\Illuminate\Database\QueryException $e) {
            if (($e->errorInfo[0] ?? '') === '23505') {
                RuleError::fail('RN-TEL-09', 'Esta grabación ya tiene su transcripción.');
            }
            throw $e;
        }
        Events::emit('recording.transcribed', 'tel_transcripts', $tid, ['recording' => $r->id, 'by' => $u->id]);

        return self::ver($id, $u);
    }

    /** Retención legal (reclamo, proceso, pedido de autoridad): con motivo; la grabación no se purga mientras siga. */
    public static function retencion(string $id, bool $activa, string $motivo, User $u): array
    {
        $r = self::fila($id, $u);
        if (! self::supervisa($u)) {
            RuleError::fail('RN-TEL-10', 'La retención legal la marca la supervisión o la gerencia.');
        }
        if ($r->status === 'PURGED') {
            RuleError::fail('RN-TEL-10', 'La grabación ya fue purgada.');
        }
        $motivo = trim($motivo);
        if (mb_strlen($motivo) < 5) {
            RuleError::fail('RN-TEL-10', 'Indica el motivo de la retención legal (reclamo, proceso o pedido de autoridad).');
        }
        if ((bool) $r->legal_hold === $activa) {
            RuleError::fail('RN-TEL-10', $activa ? 'La grabación ya está en retención legal.' : 'La grabación no está en retención legal.');
        }
        DB::table('tel_recordings')->where('id', $r->id)->update(['legal_hold' => $activa, 'legal_hold_reason' => mb_substr($activa ? $motivo : "Retención levantada: {$motivo}", 0, 255),
            'updated_at' => now()]);
        Events::emit($activa ? 'recording.legal_hold' : 'recording.legal_hold_released', 'tel_recordings', $r->id, ['by' => $u->id, 'reason' => $motivo]);

        return self::ver($id, $u);
    }

    /**
     * La purga del día dentro de la empresa ya fijada: audio vencido y sin retención legal → purgada. Devuelve la
     * corrida (o null si no había nada y es la automática).
     */
    public static function purgar(string $quien, bool $siempre = true): ?array
    {
        $hoy = self::hoy();
        $vencidas = DB::table('tel_recordings')->where('status', 'AVAILABLE')->where('legal_hold', false)->where('retention_until', '<', $hoy)->get(['id', 'file_id']);
        if ($vencidas->isEmpty() && ! $siempre) {
            return null;
        }
        $inicio = now();
        $id = DB::transaction(function () use ($vencidas, $hoy, $quien, $inicio) {
            foreach ($vencidas as $g) {
                DB::table('tel_recordings')->where('id', $g->id)->where('status', 'AVAILABLE')->where('legal_hold', false)
                    ->update(['status' => 'PURGED', 'purged_at' => now(), 'updated_at' => now()]);
                if ($g->file_id && preg_match('/^[0-9a-f-]{36}$/', (string) $g->file_id)) {
                    DB::table('file_attachments')->where('id', $g->file_id)->where('status', 'ACTIVE')
                        ->update(['status' => 'DELETED', 'deleted_at' => now(), 'deleted_reason' => 'Retención de la grabación vencida (Ley 29733)', 'updated_at' => now()]);
                }
            }

            return DB::table('audit_purge_runs')->insertGetId(['number' => Retencion::siguienteNumero(), 'category' => 'RECORDINGS', 'cutoff_date' => $hoy, 'archived_rows' => 0,
                'purged_rows' => $vencidas->count(), 'status' => 'COMPLETED', 'started_at' => $inicio, 'finished_at' => now(), 'run_by' => mb_substr($quien, 0, 120), 'created_at' => now()], 'id');
        });
        Events::emit('recording.purge_run', 'audit_purge_runs', $id, ['purged' => $vencidas->count(), 'by' => $quien]);

        return ['id' => $id, 'purgadas' => $vencidas->count()];
    }

    /* ------------------------------------------------------------------ TEL-12 */

    /** Escuchas y retención: bitácora, por vencer, retención legal, corridas de purga y purgadas. */
    public static function retencionPanel(array $f, User $u): array
    {
        if (! self::supervisa($u)) {
            abort(403);
        }
        $vista = $f['vista'] ?? 'bitacora';
        $hoy = self::hoy();
        $limite = Carbon::parse($hoy)->addDays(30)->toDateString();
        $base = self::base($u);
        $cifras = [
            'disponibles' => (clone $base)->where('r.status', 'AVAILABLE')->count(),
            'por_vencer' => (clone $base)->where('r.status', 'AVAILABLE')->where('r.legal_hold', false)->whereBetween('r.retention_until', [$hoy, $limite])->count(),
            'retenidas' => (clone $base)->where('r.legal_hold', true)->count(),
            'purgadas' => (clone $base)->where('r.status', 'PURGED')->count(),
            'accesos' => DB::table('tel_recording_access_log as g')->whereIn('g.recording_id', (clone $base)->select('r.id'))->count(),
        ];
        if ($vista === 'bitacora') {
            $q = self::conLlamada(DB::table('tel_recording_access_log as g')->join('tel_recordings as r', 'r.id', '=', 'g.recording_id')->join('tel_calls as c', 'c.id', '=', 'r.call_id'))
                ->leftJoin('users as qn', 'qn.id', '=', 'g.user_id')->whereIn('g.recording_id', (clone $base)->select('r.id'));
            if (! empty($f['accion'])) {
                $q->where('g.action', $f['accion']);
            }
            if (! empty($f['persona'])) {
                $q->where('g.user_id', $f['persona']);
            }
            if (! empty($f['desde'])) {
                $q->where('g.accessed_at', '>=', Carbon::parse($f['desde'], 'America/Lima')->startOfDay());
            }
            if (! empty($f['hasta'])) {
                $q->where('g.accessed_at', '<=', Carbon::parse($f['hasta'], 'America/Lima')->endOfDay());
            }
            $t = trim((string) ($f['buscar'] ?? ''));
            if (mb_strlen($t) >= 2) {
                $p = '%'.addcslashes($t, '%_\\').'%';
                $q->where(fn ($w) => $w->where('qn.name', 'ilike', $p)->orWhere('g.reason', 'ilike', $p)->orWhere('c.from_e164', 'ilike', $p)->orWhere('c.to_e164', 'ilike', $p)
                    ->orWhere('cu.full_name', 'ilike', $p)->orWhere('l.full_name', 'ilike', $p));
            }
            $q->orderByDesc('g.accessed_at')->orderBy('g.id');
            Paginas::ordenar($q, ['fecha' => 'g.accessed_at', 'persona' => 'qn.name', 'accion' => 'g.action'], 'g.id', $f);
            $q->select(['g.id', 'g.action', 'g.reason', 'g.accessed_at', 'g.preview', 'qn.name as persona', 'r.id as recording_id', 'c.direction', 'c.from_e164', 'c.to_e164', 'c.started_at',
                'x.name as vendedora', DB::raw('coalesce(cu.trade_name, cu.full_name, l.full_name) AS cliente')]);
            $r = Paginas::de($q, fn ($g) => ['id' => $g->id, 'recording_id' => $g->recording_id, 'accessed_at' => $g->accessed_at, 'persona' => $g->persona, 'action' => $g->action,
                'accion' => self::ACCIONES[$g->action] ?? $g->action, 'motivo' => $g->reason, 'numero' => $g->direction === 'INBOUND' ? $g->from_e164 : $g->to_e164, 'cliente' => $g->cliente,
                'vendedora' => $g->vendedora, 'llamada_at' => $g->started_at, 'preview' => (bool) $g->preview], $f);
        } elseif ($vista === 'corridas') {
            $q = DB::table('audit_purge_runs')->where('category', 'RECORDINGS');
            if (! empty($f['desde'])) {
                $q->where('started_at', '>=', Carbon::parse($f['desde'], 'America/Lima')->startOfDay());
            }
            if (! empty($f['hasta'])) {
                $q->where('started_at', '<=', Carbon::parse($f['hasta'], 'America/Lima')->endOfDay());
            }
            $t = trim((string) ($f['buscar'] ?? ''));
            if (mb_strlen($t) >= 2) {
                $p = '%'.addcslashes($t, '%_\\').'%';
                $q->where(fn ($w) => $w->where('number', 'ilike', $p)->orWhere('run_by', 'ilike', $p));
            }
            $q->orderByDesc('started_at')->orderBy('id');
            Paginas::ordenar($q, ['fecha' => 'started_at', 'numero' => 'number', 'purgadas' => 'purged_rows'], 'id', $f);
            $r = Paginas::de($q, fn ($c) => ['id' => $c->id, 'number' => $c->number, 'started_at' => $c->started_at, 'cutoff_date' => $c->cutoff_date, 'purgadas' => (int) $c->purged_rows,
                'status' => $c->status, 'estado' => Retencion::ESTADOS[$c->status] ?? $c->status, 'run_by' => $c->run_by, 'error' => $c->error_message ?? null], $f);
        } else {
            $q = self::conLlamada(self::base($u));
            match ($vista) {
                'por_vencer' => $q->where('r.status', 'AVAILABLE')->where('r.legal_hold', false)->whereBetween('r.retention_until', [$hoy, $limite]),
                'retenidas' => $q->where('r.legal_hold', true),
                default => $q->where('r.status', 'PURGED'),
            };
            if (! empty($f['persona'])) {
                $q->where('c.user_id', $f['persona']);
            }
            self::buscar($q, $f['buscar'] ?? null);
            $vista === 'purgadas' ? $q->orderByDesc('r.purged_at') : $q->orderBy('r.retention_until');
            $q->orderBy('r.id');
            Paginas::ordenar($q, ['retencion' => 'r.retention_until', 'inicio' => 'c.started_at', 'vendedora' => 'x.name', 'purgada' => 'r.purged_at'], 'r.id', $f);
            $q->select(self::columnas());
            self::conCifras($q);
            $r = Paginas::de($q, fn ($g) => self::presentar($g, $u), $f);
        }
        $ultima = DB::table('audit_purge_runs')->where('category', 'RECORDINGS')->orderByDesc('started_at')->first(['started_at', 'purged_rows']);

        return $r + [
            'vista' => $vista, 'cifras' => $cifras, 'dias' => (int) (Params::get('tel_retention_days') ?? Ajustes::fila()?->retention_days ?? 180),
            'ultima' => $ultima ? ['started_at' => $ultima->started_at, 'purgadas' => (int) $ultima->purged_rows] : null,
            'puede_purgar' => Access::can($u, 'tel.settings.manage') || self::supervisa($u),
            'opciones' => ['personas' => DB::table('users as x')->whereIn('x.id', DB::table('tel_recording_access_log')->select('user_id'))
                ->orWhereIn('x.id', (clone $base)->whereNotNull('c.user_id')->select('c.user_id'))->orderBy('x.name')->get(['x.id', 'x.name'])
                ->map(fn ($x) => ['value' => $x->id, 'label' => $x->name])->all()],
        ];
    }
}
