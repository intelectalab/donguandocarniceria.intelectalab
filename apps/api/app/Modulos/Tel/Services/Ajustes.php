<?php

namespace App\Modulos\Tel\Services;

use App\Models\User;
use App\Modulos\Int\Services\Archivos;
use App\Modulos\Plt\Services\Modulos;
use App\Modulos\Plt\Services\Parametros;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * TEL-01 Lista de activación y TEL-02 Ajustes (RN-TEL-01 a 04).
 *
 * La lista de 6 pasos se llena en Módulos activables (PLT-12): encender Telefonía exige los 5 primeros y marca el sexto.
 * Al encender quedan los ajustes en configuración (SETUP): se prepara todo, pero no se cursan llamadas. Pasar a en vivo
 * (LIVE) exige los 6 pasos con responsable y fecha. Apagar el módulo lo devuelve a configuración y conserva lo registrado.
 * Los plazos (retención, devolución, timbre, transcripción, solo registrados) son parámetros de la empresa (PLT-10):
 * cambiarlos aquí queda en su historial con el motivo.
 */
class Ajustes
{
    public const ETAPAS = ['SETUP' => 'En configuración', 'LIVE' => 'En vivo'];

    public const PROVEEDORES = ['TWILIO' => 'Twilio', 'FAKE' => 'Adaptador de prueba (sin llamadas reales)', 'OTHER' => 'Otro con números de Lima'];

    public const REPARTOS = ['ROUND_ROBIN' => 'Por turno (prioridad)', 'SIMULTANEOUS' => 'A todas a la vez'];

    public const TARIFAS = ['out_mobile' => 0.074, 'out_landline' => 0.0158, 'inbound' => 0.0085, 'recording' => 0.0025, 'transcription' => 0.05];

    public const AVISO = 'Gracias por llamar. Esta llamada puede ser grabada para fines de calidad.';

    /** Ajuste => parámetro de la empresa que lo guarda. */
    private const PARAMETROS = ['retention_days' => 'tel_retention_days', 'callback_due_minutes' => 'tel_callback_due_minutes', 'ring_timeout_s' => 'tel_ring_timeout_s',
        'transcription_enabled' => 'tel_transcription_enabled', 'outbound_registered_only' => 'tel_outbound_registered_only'];

    public static function fila(): ?object
    {
        return DB::table('tel_settings')->first();
    }

    /**
     * Al encender Telefonía (lo llama Módulos): los ajustes en configuración, con los valores de los parámetros. Si ya
     * existían, quedan como estaban (en configuración si no estaban en vivo).
     */
    public static function preparar(): void
    {
        $s = self::fila();
        if (! $s) {
            DB::table('tel_settings')->insert(['singleton' => true, 'provider' => 'TWILIO', 'stage' => 'SETUP', 'recording_enabled' => true,
                'transcription_enabled' => self::si(Params::get('tel_transcription_enabled') ?? false), 'recording_notice_text' => self::AVISO,
                'retention_days' => (int) (Params::get('tel_retention_days') ?? 180), 'ring_strategy' => 'ROUND_ROBIN', 'ring_timeout_s' => (int) (Params::get('tel_ring_timeout_s') ?? 25),
                'callback_due_minutes' => (int) (Params::get('tel_callback_due_minutes') ?? 30), 'outbound_registered_only' => self::si(Params::get('tel_outbound_registered_only') ?? true),
                'rates' => json_encode(self::TARIFAS), 'preview' => false, 'created_at' => now(), 'updated_at' => now()]);
        } elseif ($s->preview) {
            DB::table('tel_settings')->where('id', $s->id)->update(['preview' => false, 'updated_at' => now()]);
        }
    }

    /** Antes de apagar Telefonía (lo llama Módulos, con el módulo todavía encendido): vuelve a configuración. */
    public static function alApagar(string $motivo): void
    {
        $s = self::fila();
        if ($s && $s->stage === 'LIVE') {
            DB::table('tel_settings')->where('id', $s->id)->update(['stage' => 'SETUP', 'setup_reason' => mb_substr('Módulo apagado: '.trim($motivo), 0, 500), 'updated_at' => now()]);
        }
    }

    /** El estado para TEL-01: módulo, etapa, pasos y quién puede qué. */
    public static function activacion(User $u): array
    {
        $s = self::fila();
        $pasos = Modulos::pasosTel();
        $hechos = count(array_filter($pasos, fn ($p) => $p['done']));
        $live = $s?->live_by ? DB::table('users')->where('id', $s->live_by)->value('name') : null;

        return [
            'encendido' => ! empty(Modulos::encendidos()['TEL']),
            'etapa' => $s->stage ?? 'SETUP', 'etapa_name' => self::ETAPAS[$s->stage ?? 'SETUP'],
            'en_vivo_desde' => $s?->live_at, 'en_vivo_por' => $live, 'motivo_configuracion' => $s?->setup_reason,
            'proveedor' => self::PROVEEDORES[$s->provider ?? 'TWILIO'] ?? $s?->provider, 'hechos' => $hechos, 'total' => count($pasos), 'pasos' => $pasos,
            'puede' => Access::can($u, 'tel.settings.manage'),
            'responsables' => DB::table('users')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name'])->map(fn ($x) => ['value' => $x->id, 'label' => $x->name])->all(),
        ];
    }

    private static function exigir(User $u): void
    {
        if (! Access::can($u, 'tel.settings.manage')) {
            RuleError::fail('RN-TEL-02', 'La lista de activación y los ajustes los maneja el administrador del sistema.');
        }
    }

    /** Marcar un paso desde TEL-01 (el sexto, «Encendido», se marca al encender en Módulos activables). */
    public static function marcarPaso(string $codigo, string $evidencia, ?string $responsable, User $u): array
    {
        self::exigir($u);
        if ($codigo === 'SWITCH_ON') {
            RuleError::fail('RN-TEL-02', 'El paso «Encendido» se marca solo al encender Telefonía en Módulos activables.');
        }
        if (mb_strlen(trim($evidencia)) < 5) {
            RuleError::fail('RN-TEL-02', 'Cada paso exige responsable, fecha y evidencia: escribe qué se hizo y dónde está el respaldo.');
        }
        if ($responsable && ! DB::table('users')->where('id', $responsable)->where('status', 'ACTIVE')->exists()) {
            RuleError::fail('RN-TEL-02', 'El responsable debe ser un usuario activo de la empresa.');
        }
        Modulos::marcarPaso($codigo, $u, mb_substr(trim($evidencia), 0, 1000), $responsable);
        Events::emit('tel.step_done', 'tel_activation_steps', null, ['step' => $codigo, 'by' => $u->id]);

        return self::activacion($u);
    }

    /** Pasar a en vivo: los 6 pasos con responsable y fecha (RN-TEL-02, CA-TEL-02). */
    public static function enVivo(User $u): array
    {
        self::exigir($u);
        $faltan = array_filter(Modulos::pasosTel(), fn ($p) => ! $p['done'] || ! $p['done_at']);
        if ($faltan) {
            RuleError::fail('RN-TEL-02', 'Para pasar a en vivo faltan '.count($faltan).' de 6 pasos: '.implode(', ', array_map(fn ($p) => $p['no'].'. '.$p['nombre'], $faltan)).'.');
        }
        $s = self::fila() ?? abort(404);
        if ($s->stage === 'LIVE') {
            RuleError::fail('RN-TEL-02', 'Telefonía ya está en vivo.');
        }
        DB::table('tel_settings')->where('id', $s->id)->update(['stage' => 'LIVE', 'live_at' => now(), 'live_by' => $u->id, 'setup_reason' => null, 'updated_at' => now()]);
        Events::emit('tel.live', 'tel_settings', $s->id, ['by' => $u->id]);

        return self::activacion($u);
    }

    /** Volver a configuración, con motivo (por ejemplo, para cambiar de proveedor). */
    public static function aConfiguracion(string $motivo, User $u): array
    {
        self::exigir($u);
        if (mb_strlen(trim($motivo)) < 10) {
            RuleError::fail('RN-TEL-02', 'Volver a configuración exige el motivo (al menos 10 caracteres).');
        }
        $s = self::fila() ?? abort(404);
        if ($s->stage !== 'LIVE') {
            RuleError::fail('RN-TEL-02', 'Telefonía ya está en configuración.');
        }
        DB::table('tel_settings')->where('id', $s->id)->update(['stage' => 'SETUP', 'setup_reason' => mb_substr(trim($motivo), 0, 500), 'updated_at' => now()]);
        Events::emit('tel.setup', 'tel_settings', $s->id, ['by' => $u->id, 'reason' => trim($motivo)]);

        return self::activacion($u);
    }

    /** TEL-02: los ajustes con los parámetros vigentes, los conectores de telefonía y el aviso. */
    public static function ver(User $u): array
    {
        $s = self::fila() ?? abort(404);
        $tarifas = array_merge(self::TARIFAS, (array) json_decode((string) $s->rates, true));
        $central = DB::table('tel_numbers')->where('status', 'ACTIVE')->orderByRaw('brand_id IS NOT NULL')->value('e164');
        $audio = $s->notice_audio_file_id ? DB::table('file_attachments')->where('id', $s->notice_audio_file_id)->where('status', 'ACTIVE')->first(['id', 'file_name', 'size_bytes', 'uploaded_at', 'uploaded_by']) : null;

        return [
            'provider' => $s->provider, 'connector_id' => $s->connector_id, 'stage' => $s->stage, 'stage_name' => self::ETAPAS[$s->stage] ?? $s->stage,
            'recording_enabled' => (bool) $s->recording_enabled, 'recording_notice_text' => $s->recording_notice_text, 'ring_strategy' => $s->ring_strategy,
            'retention_days' => (int) (Params::get('tel_retention_days') ?? $s->retention_days), 'callback_due_minutes' => (int) (Params::get('tel_callback_due_minutes') ?? $s->callback_due_minutes),
            'ring_timeout_s' => (int) (Params::get('tel_ring_timeout_s') ?? $s->ring_timeout_s), 'transcription_enabled' => self::si(Params::get('tel_transcription_enabled') ?? $s->transcription_enabled),
            'outbound_registered_only' => self::si(Params::get('tel_outbound_registered_only') ?? $s->outbound_registered_only),
            'tarifas' => array_map('floatval', $tarifas),
            'audio' => $audio ? ['id' => $audio->id, 'nombre' => $audio->file_name, 'bytes' => (int) $audio->size_bytes, 'subido' => $audio->uploaded_at, 'por' => $audio->uploaded_by] : null,
            'central' => $central,
            'conectores' => DB::table('integration_connectors')->where('kind', 'TELEPHONY')->orderBy('code')->get(['id', 'code', 'name', 'status', 'environment', 'adapter'])
                ->map(fn ($c) => ['value' => $c->id, 'label' => "{$c->code} · {$c->name}".($c->environment === 'SANDBOX' ? ' (prueba)' : ''), 'status' => $c->status])->all(),
            'opciones' => ['proveedores' => self::opciones(self::PROVEEDORES), 'repartos' => self::opciones(self::REPARTOS)],
            'puede' => Access::can($u, 'tel.settings.manage'),
        ];
    }

    /** Guarda los ajustes; los que son parámetros quedan en su historial con el motivo. */
    public static function guardar(array $d, User $u): array
    {
        self::exigir($u);
        $s = self::fila() ?? abort(404);
        if ($d['recording_enabled'] && mb_strlen(trim((string) $d['recording_notice_text'])) < 10) {
            RuleError::fail('RN-TEL-04', 'Con grabación, el aviso es obligatorio: toda llamada grabada lo reproduce primero (Ley 29733).');
        }
        if ($d['provider'] === 'FAKE' && app()->environment('production')) {
            RuleError::fail('RN-TEL-03', 'El adaptador de prueba no existe en producción: elige el proveedor contratado.');
        }
        if (! empty($d['connector_id']) && ! DB::table('integration_connectors')->where('id', $d['connector_id'])->where('kind', 'TELEPHONY')->exists()) {
            RuleError::fail('RN-TEL-03', 'El conector debe ser de telefonía (Integraciones).');
        }
        if ($s->stage === 'LIVE' && ($d['provider'] !== $s->provider || ($d['connector_id'] ?? null) !== $s->connector_id)) {
            RuleError::fail('RN-TEL-03', 'Con Telefonía en vivo no se cambia el proveedor ni el conector: vuelve primero a configuración.');
        }
        $normal = fn (string $p, mixed $v) => Parametros::validar(Parametros::definicion($p), $v);
        $cambianParametros = collect(self::PARAMETROS)->filter(fn ($p, $k) => $normal($p, $d[$k]) !== $normal($p, Params::get($p) ?? Parametros::definicion($p)->default_value))->all();
        $motivo = trim((string) ($d['motivo'] ?? ''));
        if ($cambianParametros && mb_strlen($motivo) < (int) (Params::get('plt_parameter_reason_min_length') ?? 10)) {
            RuleError::fail('RN-PLT-06', 'Los plazos y la transcripción son parámetros de la empresa: escribe el motivo del cambio.');
        }
        DB::transaction(function () use ($s, $d, $u, $cambianParametros, $motivo) {
            foreach ($cambianParametros as $k => $p) {
                Parametros::cambiar($p, $d[$k], $motivo, $u);
            }
            DB::table('tel_settings')->where('id', $s->id)->update([
                'provider' => $d['provider'], 'connector_id' => $d['connector_id'] ?? null, 'recording_enabled' => (bool) $d['recording_enabled'],
                'recording_notice_text' => mb_substr(trim((string) $d['recording_notice_text']), 0, 500), 'ring_strategy' => $d['ring_strategy'],
                'retention_days' => $d['retention_days'], 'callback_due_minutes' => $d['callback_due_minutes'], 'ring_timeout_s' => $d['ring_timeout_s'],
                'transcription_enabled' => (bool) $d['transcription_enabled'], 'outbound_registered_only' => (bool) $d['outbound_registered_only'],
                'rates' => json_encode(array_map('floatval', array_intersect_key($d['tarifas'], self::TARIFAS)) + self::TARIFAS), 'updated_at' => now(),
            ]);
            Events::emit('tel.settings_changed', 'tel_settings', $s->id, ['by' => $u->id, 'params' => array_values($cambianParametros)]);
        });

        return self::ver($u);
    }

    /** El audio del aviso de grabación (paso 3): mp3, ogg o wav, guardado con los archivos de la empresa. */
    public static function subirAudio(UploadedFile $archivo, User $u): array
    {
        self::exigir($u);
        if (! in_array(strtoupper($archivo->getClientOriginalExtension()), ['MP3', 'OGG', 'WAV'], true)) {
            RuleError::fail('RN-TEL-04', 'El aviso va en audio: mp3, ogg o wav.');
        }
        $s = self::fila() ?? abort(404);
        $f = Archivos::subir($archivo, null, null, 'INTERNAL', $u);
        DB::table('tel_settings')->where('id', $s->id)->update(['notice_audio_file_id' => $f['id'], 'updated_at' => now()]);
        Events::emit('tel.notice_audio', 'tel_settings', $s->id, ['by' => $u->id, 'file' => $f['id']]);

        return self::ver($u);
    }

    /** Enlace temporal para escuchar el aviso. */
    public static function enlaceAudio(User $u): array
    {
        $s = self::fila() ?? abort(404);
        if (! $s->notice_audio_file_id) {
            abort(404);
        }

        return Archivos::enlace($s->notice_audio_file_id, $u);
    }

    /** Un parámetro de sí o no (llega como texto «true» o «false»). */
    private static function si(mixed $v): bool
    {
        return in_array($v, [true, 1, '1', 'true', 'sí', 'si'], true);
    }

    private static function opciones(array $xs): array
    {
        return collect($xs)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all();
    }
}
