<?php

namespace App\Modulos\Aud\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\Params;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * AUD-06 Políticas de retención y AUD-07 Corridas de depuración (RN-AUD-02, RN-AUD-08).
 *
 * La base decide qué se borra (audit.purge_rows: empresa de la sesión, fecha de corte desde la política, lista cerrada
 * de categorías). Aquí se archivan las filas borradas en un archivo comprimido y cifrado dentro de la misma transacción:
 * si el archivo no se puede guardar, no se borra nada. Cada corrida queda en audit_purge_runs (solo inserción).
 */
class Retencion
{
    /** Categoría => [nombre, qué se depura, tabla para contar las filas actuales]. */
    public const CATEGORIAS = [
        'CHANGE_LOG' => ['Auditoría de cambios', 'Cada alta, cambio y borrado de los registros.', 'audit.change_log'],
        'ACCESS_LOG' => ['Bitácora de accesos', 'Ingresos, bloqueos, accesos denegados y a datos sensibles.', 'access_log'],
        'EXPORTS' => ['Exportaciones', 'Las ya resueltas, con su archivo. Las que esperan aprobación se conservan.', 'data_exports'],
        'NOTIFICATIONS' => ['Notificaciones leídas', 'Solo las leídas; las que nadie leyó se conservan.', 'notifications'],
        'WEBHOOKS' => ['Webhooks recibidos', 'Los procesados o ignorados; los fallidos se conservan para revisarlos.', 'webhook_events'],
        'OUTBOX' => ['Mensajes salientes', 'Solo los enviados o cancelados; los pendientes y en cola muerta se conservan.', 'outbox_messages'],
        'DOMAIN_EVENTS' => ['Eventos de dominio', 'El registro interno de lo que pasó en cada módulo.', 'domain_events'],
        'RECORDINGS' => ['Grabaciones de llamadas', 'Menos las retenidas por un caso legal.', 'tel_recordings'],
        'FILES' => ['Archivos eliminados', 'Los adjuntos ya eliminados; el archivo se borra del almacenamiento.', 'file_attachments'],
    ];

    /** La política con que empieza una empresa: [plazo, unidad, archivar antes, motivo]. */
    private const DEFECTO = [
        'CHANGE_LOG' => [60, 'MONTHS', true, '5 años (a confirmar por la contadora)'],
        'ACCESS_LOG' => [60, 'MONTHS', true, '5 años (a confirmar por la contadora)'],
        'EXPORTS' => [12, 'MONTHS', true, 'Puesta en marcha'],
        'NOTIFICATIONS' => [90, 'DAYS', false, 'Puesta en marcha'],
        'WEBHOOKS' => [6, 'MONTHS', true, 'Puesta en marcha'],
        'OUTBOX' => [6, 'MONTHS', false, 'Puesta en marcha'],
        'DOMAIN_EVENTS' => [12, 'MONTHS', true, 'Puesta en marcha'],
        'RECORDINGS' => [12, 'MONTHS', true, '12 meses, validar con abogado de datos personales'],
        'FILES' => [1, 'MONTHS', true, 'Puesta en marcha'],
    ];

    /** Cambios y accesos se conservan al menos estos años (RN-AUD-08). */
    public const AUDITORIA = ['CHANGE_LOG', 'ACCESS_LOG'];

    public const ESTADOS = ['COMPLETED' => 'Completada', 'FAILED' => 'Falló'];

    private const DISCO = 'local';

    public static function anios(): int
    {
        return max(1, (int) (Params::get('aud_retention_years') ?? 5));
    }

    /** AUD-06: las políticas con su fecha de corte, filas actuales, filas para depurar y la última corrida. */
    public static function politicas(): array
    {
        self::asegurar();
        $ultimas = DB::table('audit_purge_runs')->selectRaw('category, max(started_at) AS at')->groupBy('category')->pluck('at', 'category');
        $filas = DB::table('audit_retention_policies')->get()->keyBy('category');
        $out = [];
        foreach (self::CATEGORIAS as $cat => [$nombre, $que, $tabla]) {
            $p = $filas[$cat] ?? null;
            if (! $p) {
                continue;
            }
            $out[] = [
                'category' => $cat, 'nombre' => $nombre, 'que' => $que, 'months' => (int) $p->months, 'unit' => $p->unit,
                'plazo' => self::plazo((int) $p->months, $p->unit), 'archive_before_purge' => (bool) $p->archive_before_purge,
                // Sin códigos internos de decisiones («D-AUD-01: …») en pantalla.
                'reason' => preg_replace('/^[A-Z]-[A-Z]{2,4}-\d+:\s*/u', '', (string) $p->reason), 'updated_by' => $p->updated_by, 'updated_at' => $p->updated_at ?? $p->created_at,
                'corte' => DB::selectOne('SELECT audit.retention_cutoff(?) AS c', [$cat])->c,
                'total' => self::existe($tabla) ? DB::table($tabla)->count() : 0,
                'para_depurar' => (int) DB::selectOne('SELECT audit.purge_count(?) AS n', [$cat])->n,
                'ultima' => $ultimas[$cat] ?? null,
                'minimo' => in_array($cat, self::AUDITORIA, true) ? self::anios() * 12 : 1,
            ];
        }

        return $out;
    }

    /** RN-AUD-08: cambiar el plazo o el archivado exige motivo; cambios y accesos no bajan de aud_retention_years. */
    public static function actualizar(string $cat, int $plazo, bool $archivar, string $motivo, User $quien): array
    {
        self::asegurar();
        $p = DB::table('audit_retention_policies')->where('category', $cat)->first() ?? RuleError::fail('RN-AUD-08', 'Esa categoría no tiene política.');
        $minimo = in_array($cat, self::AUDITORIA, true) ? self::anios() * 12 : 1;
        $maximo = $p->unit === 'DAYS' ? 3650 : 240;
        if ($plazo < $minimo) {
            RuleError::fail('RN-AUD-08', in_array($cat, self::AUDITORIA, true)
                ? "La auditoría de cambios y la bitácora de accesos se conservan al menos {$minimo} meses (".self::anios().' años).'
                : 'El plazo debe ser mayor que cero.');
        }
        if ($plazo > $maximo) {
            RuleError::fail('RN-AUD-08', $p->unit === 'DAYS' ? 'El plazo no puede pasar de 3650 días.' : 'El plazo no puede pasar de 240 meses (20 años).');
        }
        if (in_array($cat, self::AUDITORIA, true) && ! $archivar) {
            RuleError::fail('RN-AUD-08', 'La auditoría de cambios y la bitácora de accesos se archivan siempre antes de depurarse.');
        }
        if (mb_strlen(trim($motivo)) < 10) {
            RuleError::fail('RN-AUD-08', 'Cambiar una política de retención exige motivo (al menos 10 caracteres).');
        }
        DB::table('audit_retention_policies')->where('id', $p->id)->update([
            'months' => $plazo, 'archive_before_purge' => $archivar, 'reason' => mb_substr(trim($motivo), 0, 300),
            'updated_by' => mb_substr($quien->name, 0, 120), 'updated_at' => now(),
        ]);
        Events::emit('retention.policy_changed', 'audit_retention_policies', $p->id, ['category' => $cat, 'before' => ['months' => (int) $p->months, 'archive' => (bool) $p->archive_before_purge],
            'after' => ['months' => $plazo, 'archive' => $archivar], 'by' => $quien->id]);

        return collect(self::politicas())->firstWhere('category', $cat);
    }

    /**
     * Archiva (si la política lo pide) y depura lo vencido de una categoría. Devuelve la corrida.
     * Si algo falla no se borra nada y queda una corrida «Falló» con el motivo.
     */
    public static function depurar(string $cat, string $quien): array
    {
        if (! isset(self::CATEGORIAS[$cat])) {
            RuleError::fail('RN-AUD-08', 'Esa categoría no existe.');
        }
        self::asegurar();
        $p = DB::table('audit_retention_policies')->where('category', $cat)->first();
        $inicio = now();
        $ruta = null;
        try {
            [$corrida, $filas] = DB::transaction(function () use ($cat, $p, $quien, $inicio, &$ruta) {
                $numero = self::siguienteNumero();
                $corte = DB::selectOne('SELECT audit.retention_cutoff(?) AS c', [$cat])->c;
                $filas = array_map(fn ($r) => $r->j, DB::select('SELECT j FROM audit.purge_rows(?) AS j', [$cat]));
                $huella = null;
                if ($filas && $p->archive_before_purge) {
                    $cifrado = Crypt::encryptString(gzencode(implode("\n", $filas)."\n", 9));
                    $ruta = 'archivo/'.TenantContext::id().'/'.strtolower($cat).'/'.now('America/Lima')->format('Y-m-d')."-{$numero}.jsonl.gz.enc";
                    if (! Storage::disk(self::DISCO)->put($ruta, $cifrado)) {
                        throw new \RuntimeException('No se pudo guardar el archivo.');
                    }
                    $huella = hash('sha256', $cifrado);
                }
                $id = DB::table('audit_purge_runs')->insertGetId([
                    'number' => $numero, 'category' => $cat, 'cutoff_date' => $corte, 'archived_rows' => $huella ? count($filas) : 0, 'purged_rows' => count($filas),
                    'archive_file' => $huella ? $ruta : null, 'archive_sha256' => $huella, 'status' => 'COMPLETED', 'started_at' => $inicio, 'finished_at' => now(),
                    'run_by' => mb_substr($quien, 0, 120), 'created_at' => now(),
                ], 'id');

                return [DB::table('audit_purge_runs')->where('id', $id)->first(), $filas];
            });
        } catch (RuleError $e) {
            throw $e;
        } catch (\Throwable $e) {
            if ($ruta) {
                Storage::disk(self::DISCO)->delete($ruta);
            }
            report($e);
            $corrida = DB::transaction(function () use ($cat, $quien, $inicio, $e) {
                $numero = self::siguienteNumero();
                $id = DB::table('audit_purge_runs')->insertGetId([
                    'number' => $numero, 'category' => $cat, 'cutoff_date' => now('America/Lima')->toDateString(), 'archived_rows' => 0, 'purged_rows' => 0,
                    'status' => 'FAILED', 'started_at' => $inicio, 'finished_at' => now(), 'run_by' => mb_substr($quien, 0, 120), 'created_at' => now(),
                    'error_message' => mb_substr(class_basename($e).': '.$e->getMessage(), 0, 500),
                ], 'id');

                return DB::table('audit_purge_runs')->where('id', $id)->first();
            });
            Events::emit('purge.failed', 'audit_purge_runs', $corrida->id, ['category' => $cat]);

            return self::presentar($corrida);
        }

        // Ya confirmada la transacción: los archivos de las exportaciones y adjuntos depurados se borran del almacenamiento.
        if (in_array($cat, ['EXPORTS', 'FILES'], true)) {
            foreach ($filas as $j) {
                $clave = (string) (json_decode($j, true)['storage_key'] ?? '');
                $clave = str_starts_with($clave, 'local://') ? substr($clave, 8) : $clave;
                if ($clave !== '' && ! str_contains($clave, '..')) {
                    Storage::disk(self::DISCO)->delete($clave);
                }
            }
        }
        Events::emit('purge.completed', 'audit_purge_runs', $corrida->id, ['category' => $cat, 'purged' => (int) $corrida->purged_rows, 'archived' => (int) $corrida->archived_rows]);

        return self::presentar($corrida);
    }

    /** Todas las categorías con filas vencidas. Devuelve las corridas hechas. */
    public static function depurarVencidas(string $quien): array
    {
        self::asegurar();
        $hechas = [];
        foreach (array_keys(self::CATEGORIAS) as $cat) {
            if ((int) DB::selectOne('SELECT audit.purge_count(?) AS n', [$cat])->n > 0) {
                $hechas[] = self::depurar($cat, $quien);
            }
        }

        return $hechas;
    }

    /** AUD-07: las corridas, con cifras y filtros. */
    public static function corridas(array $f): array
    {
        $q = DB::table('audit_purge_runs');
        if (! empty($f['categoria'])) {
            $q->where('category', $f['categoria']);
        }
        if (! empty($f['estado'])) {
            $q->where('status', $f['estado']);
        }
        if (! empty($f['desde'])) {
            $q->where('started_at', '>=', Carbon::parse($f['desde'], 'America/Lima')->startOfDay());
        }
        if (! empty($f['hasta'])) {
            $q->where('started_at', '<=', Carbon::parse($f['hasta'], 'America/Lima')->endOfDay());
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $cats = array_keys(array_filter(self::CATEGORIAS, fn ($c) => mb_stripos($c[0], $t) !== false));
            $q->where(fn ($w) => $w->where('number', 'ilike', $p)->orWhere('run_by', 'ilike', $p)->orWhere('archive_file', 'ilike', $p)
                ->orWhere('error_message', 'ilike', $p)->when($cats, fn ($x) => $x->orWhereIn('category', $cats)));
        }
        $cifras = (clone $q)->selectRaw('count(*) AS corridas, coalesce(sum(purged_rows), 0) AS depuradas, coalesce(sum(archived_rows), 0) AS archivadas, count(*) FILTER (WHERE status = ?) AS fallidas', ['FAILED'])->first();
        $q->orderByDesc('started_at')->orderByDesc('id');
        Paginas::ordenar($q, ['number' => 'number', 'started_at' => 'started_at', 'category' => 'category', 'cutoff_date' => 'cutoff_date',
            'archived_rows' => 'archived_rows', 'purged_rows' => 'purged_rows', 'run_by' => 'run_by', 'status' => 'status'], 'id', $f);
        $pendiente = 0;
        foreach (array_keys(self::CATEGORIAS) as $cat) {
            $pendiente += (int) DB::selectOne('SELECT audit.purge_count(?) AS n', [$cat])->n;
        }

        return Paginas::de($q, fn ($r) => self::presentar($r), $f) + [
            'cifras' => ['corridas' => (int) $cifras->corridas, 'depuradas' => (int) $cifras->depuradas, 'archivadas' => (int) $cifras->archivadas,
                'fallidas' => (int) $cifras->fallidas, 'pendiente' => $pendiente],
            'categorias' => collect(self::CATEGORIAS)->map(fn ($c, $k) => ['value' => $k, 'label' => $c[0]])->values()->all(),
            'estados' => collect(self::ESTADOS)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all(),
        ];
    }

    /** AUD-06: cómo queda en la auditoría un registro con secretos y datos personales (RN-AUD-07). */
    public static function muestraDeEnmascarado(): array
    {
        $demo = ['name' => 'Ana Torres Lazo', 'phone' => '+51991203711', 'doc_number' => '40124371', 'email' => 'atorres@donguando.pe',
            'password' => '$2y$12$9a8bQx…', 'totp_secret' => 'JBSWY3DPEHPK3PXP', 'secret_enc' => 'enc:v1:Q0FTSA==', 'api_key' => 'AIzaSyD-…'];
        $guardado = json_decode(DB::selectOne('SELECT audit.mask_sensitive(?::jsonb) AS d', [json_encode($demo)])->d, true);
        $out = [];
        foreach ($demo as $campo => $valor) {
            $out[] = ['campo' => $campo, 'original' => $valor, 'en_auditoria' => Cambios::enmascarar($campo, $guardado[$campo] ?? null)];
        }

        return $out;
    }

    public static function nombre(string $cat): string
    {
        return self::CATEGORIAS[$cat][0] ?? $cat;
    }

    /** Crea las políticas que falten (una empresa nueva empieza con las de la puesta en marcha). */
    private static function asegurar(): void
    {
        $hay = DB::table('audit_retention_policies')->pluck('category')->all();
        foreach (array_diff(array_keys(self::DEFECTO), $hay) as $cat) {
            [$plazo, $unidad, $archivar, $motivo] = self::DEFECTO[$cat];
            DB::table('audit_retention_policies')->insertOrIgnore(['category' => $cat, 'months' => $plazo, 'unit' => $unidad, 'archive_before_purge' => $archivar,
                'reason' => $motivo, 'updated_by' => 'Puesta en marcha', 'created_at' => now(), 'updated_at' => now()]);
        }
    }

    private static function plazo(int $n, string $unidad): string
    {
        if ($unidad === 'DAYS') {
            return $n === 1 ? '1 día' : "{$n} días";
        }
        if ($n >= 12 && $n % 12 === 0) {
            return $n === 12 ? '1 año' : ($n / 12).' años';
        }

        return $n === 1 ? '1 mes' : "{$n} meses";
    }

    private static function existe(string $tabla): bool
    {
        return (bool) DB::selectOne('SELECT to_regclass(?) IS NOT NULL AS e', [str_contains($tabla, '.') ? $tabla : "public.{$tabla}"])->e;
    }

    /** DEP-0011: el siguiente de la empresa, con bloqueo hasta el fin de la transacción. También lo usa la purga de grabaciones de TEL. */
    public static function siguienteNumero(): string
    {
        DB::select("SELECT pg_advisory_xact_lock(hashtext('audit_purge_runs:' || coalesce(app_tenant_id()::text, '')))");
        $ultimo = DB::table('audit_purge_runs')->where('number', '~', '^DEP-[0-9]+$')->orderByRaw('length(number) DESC, number DESC')->value('number');

        return 'DEP-'.str_pad((string) ((int) substr((string) $ultimo, 4) + 1), 4, '0', STR_PAD_LEFT);
    }

    private static function presentar(object $r): array
    {
        return [
            'id' => $r->id, 'number' => $r->number, 'category' => $r->category, 'category_name' => self::nombre($r->category),
            'cutoff_date' => $r->cutoff_date, 'archived_rows' => (int) $r->archived_rows, 'purged_rows' => (int) $r->purged_rows,
            // Solo el nombre del archivo: la ruta interna del almacenamiento no se muestra.
            'archivo' => $r->archive_file ? basename((string) $r->archive_file) : null, 'archive_sha256' => $r->archive_sha256,
            'status' => $r->status, 'status_name' => self::ESTADOS[$r->status] ?? $r->status, 'started_at' => $r->started_at, 'finished_at' => $r->finished_at,
            'segundos' => max(0, Carbon::parse($r->started_at)->diffInSeconds(Carbon::parse($r->finished_at))), 'run_by' => $r->run_by,
            'error' => $r->error_message ?? null,
        ];
    }
}
