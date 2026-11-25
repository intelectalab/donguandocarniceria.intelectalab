<?php

namespace App\Modulos\Int\Services;

use App\Models\User;
use App\Modulos\Seg\Services\Bitacora;
use App\Support\Access;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\Params;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;

/**
 * INT-11 Archivos adjuntos: un panel que cualquier ficha puede usar (pedido, cobro, trabajador…).
 *  - RN-INT-16: solo los tipos de int_file_allowed_types y hasta int_file_max_mb. Se revisa el contenido real del archivo
 *    (no solo su extensión) y se guarda su huella SHA-256.
 *  - RN-INT-17: nunca hay una URL pública. Se descarga con un enlace firmado que vence a los int_file_link_minutes. Los
 *    confidenciales y de datos personales piden int.file.view_confidential, y cada descarga queda en la bitácora.
 *  - RN-INT-18: eliminar pide int.file.delete y un motivo de al menos 10 caracteres; se marca como eliminado y el
 *    contenido se depura por retención.
 * El archivo se guarda en el disco privado del servidor (storage/app/private/adjuntos/<empresa>/…), con un nombre propio:
 * nunca con el que trae quien lo sube.
 */
final class Archivos
{
    public const CLASIFICACIONES = ['PUBLIC' => 'Público', 'INTERNAL' => 'Interno', 'CONFIDENTIAL' => 'Confidencial', 'PERSONAL_DATA' => 'Datos personales'];

    public const SENSIBLES = ['CONFIDENTIAL', 'PERSONAL_DATA'];

    /** Registro => [nombre, tabla, columna con su nombre]. Los de la izquierda se pueden elegir para adjuntar. */
    public const REGISTROS = [
        'sales_orders' => ['Pedido', 'number'], 'payments' => ['Cobro', 'number'], 'sales_documents' => ['Comprobante', 'full_number'],
        'employees' => ['Trabajador', 'full_name'], 'suppliers' => ['Proveedor', 'trade_name'],
        'integration_runs' => ['Corrida', 'job'], 'brand_separations' => ['Separación de marca', null], 'data_imports' => ['Importación', null],
    ];

    public const ADJUNTABLES = ['sales_orders', 'payments', 'sales_documents', 'employees', 'suppliers'];

    /** Tipo permitido => tipos de contenido que se aceptan (lo que dice el propio archivo, no su nombre). */
    private const CONTENIDOS = [
        'JPG' => ['image/jpeg'], 'PNG' => ['image/png'], 'WEBP' => ['image/webp'], 'PDF' => ['application/pdf'],
        'MP3' => ['audio/mpeg', 'audio/mp3'], 'OGG' => ['audio/ogg', 'application/ogg', 'video/ogg'], 'WAV' => ['audio/wav', 'audio/x-wav', 'audio/vnd.wave'],
        'CSV' => ['text/csv', 'text/plain', 'application/csv'], 'XML' => ['text/xml', 'application/xml'],
        'XLSX' => ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/octet-stream'],
        'ZIP' => ['application/zip', 'application/x-zip-compressed'],
    ];

    private const DISCO = 'local';

    public static function permitidos(): array
    {
        return array_values(array_filter(array_map(fn ($x) => strtoupper(trim($x)), preg_split('/[,\s]+/', (string) (Params::get('int_file_allowed_types') ?? '')))));
    }

    public static function maxMb(): int
    {
        return max(1, (int) (Params::get('int_file_max_mb') ?? 20));
    }

    public static function subir(UploadedFile $archivo, ?string $registro, ?string $registroId, string $clasificacion, User $quien): array
    {
        $nombre = mb_substr(trim(str_replace(['/', '\\', "\0"], '-', $archivo->getClientOriginalName())), 0, 255) ?: 'archivo';
        $ext = strtoupper(pathinfo($nombre, PATHINFO_EXTENSION));
        $ext = $ext === 'JPEG' ? 'JPG' : $ext;
        $permitidos = self::permitidos();
        if (! in_array($ext, $permitidos, true)) {
            RuleError::fail('RN-INT-16', 'El tipo .'.strtolower($ext ?: '?').' no está permitido. Tipos válidos: '.implode(', ', $permitidos).'.');
        }
        $bytes = (int) $archivo->getSize();
        if ($bytes <= 0) {
            RuleError::fail('RN-INT-16', 'El archivo está vacío.');
        }
        if ($bytes > self::maxMb() * 1048576) {
            RuleError::fail('RN-INT-16', 'El archivo pesa '.number_format($bytes / 1048576, 1, ',', '.').' MB y el máximo es '.self::maxMb().' MB.');
        }
        // Lo que dice el contenido del archivo (sus primeros bytes), no su nombre ni lo que manda el navegador.
        $contenido = (string) (new \finfo(FILEINFO_MIME_TYPE))->file($archivo->getRealPath());
        if (! in_array($contenido, self::CONTENIDOS[$ext] ?? [], true)) {
            RuleError::fail('RN-INT-16', 'El contenido del archivo no corresponde a un .'.strtolower($ext).'. Revisa que no esté dañado ni renombrado.');
        }
        if ($registro !== null) {
            if (! in_array($registro, self::ADJUNTABLES, true) || ! $registroId || ! DB::table($registro)->where('id', $registroId)->exists()) {
                RuleError::fail('RN-INT-16', 'El registro al que quieres adjuntar no existe.');
            }
        }
        $huella = hash_file('sha256', $archivo->getRealPath());
        // El mismo archivo (misma huella) ya adjunto y vigente en ese registro: no se guarda otra copia.
        if ($registro !== null && DB::table('file_attachments')->where('entity', $registro)->where('entity_id', $registroId)
            ->where('sha256', $huella)->where('status', 'ACTIVE')->exists()) {
            RuleError::fail('RN-INT-16', 'Este archivo ya está adjunto a este registro.');
        }
        $id = (string) Str::uuid();
        $ruta = 'adjuntos/'.TenantContext::id().'/'.now()->format('Y/m').'/'.$id.'.'.strtolower($ext);
        Storage::disk(self::DISCO)->putFileAs(dirname($ruta), $archivo, basename($ruta));
        DB::table('file_attachments')->insert([
            'id' => $id, 'entity' => $registro, 'entity_id' => $registroId, 'file_name' => $nombre, 'ext' => $ext, 'mime' => mb_substr($contenido, 0, 100),
            'size_bytes' => $bytes, 'sha256' => $huella, 'classification' => $clasificacion, 'storage_key' => 'local://'.$ruta, 'status' => 'ACTIVE',
            'uploaded_by' => mb_substr($quien->name, 0, 120), 'uploaded_at' => now(), 'links' => '[]', 'created_at' => now(), 'updated_at' => now(),
        ]);
        Events::emit('file.uploaded', 'file_attachments', $id, ['by' => $quien->id, 'name' => $nombre, 'classification' => $clasificacion, 'entity' => $registro]);

        return self::ver($id);
    }

    /** RN-INT-17: enlace firmado y temporal; los sensibles piden permiso y quedan en la bitácora (también el intento sin permiso). */
    public static function enlace(string $id, User $quien): array
    {
        $f = self::fila($id);
        if ($f->status !== 'ACTIVE') {
            RuleError::fail('RN-INT-18', 'El archivo fue eliminado.');
        }
        $sensible = in_array($f->classification, self::SENSIBLES, true);
        if ($sensible && ! Access::can($quien, 'int.file.view_confidential')) {
            Events::emit('file.download_denied', 'file_attachments', $id, ['by' => $quien->id, 'name' => $f->file_name, 'classification' => $f->classification]);
            RuleError::fail('RN-INT-17', "{$f->file_name} es ".mb_strtolower(self::CLASIFICACIONES[$f->classification]).': descargarlo pide el permiso de ver archivos confidenciales.');
        }
        if (! str_starts_with((string) $f->storage_key, 'local://') || ! Storage::disk(self::DISCO)->exists(substr($f->storage_key, 8))) {
            RuleError::fail('RN-INT-17', 'Este archivo es de los datos de demostración y no tiene contenido guardado para descargar.');
        }
        $minutos = max(1, (int) (Params::get('int_file_link_minutes') ?? 10));
        $vence = now()->addMinutes($minutos);
        // Ruta relativa: la web la reenvía a la API (mismo dominio), aquí, en las pruebas y en el servidor.
        $url = URL::temporarySignedRoute('int.archivo', $vence, ['id' => $id, 'e' => TenantContext::id()], absolute: false);
        $enlaces = array_slice([...(json_decode($f->links ?? '[]', true) ?: []), ['at' => now()->toIso8601String(), 'by' => $quien->name, 'expires_at' => $vence->toIso8601String()]], -20);
        DB::table('file_attachments')->where('id', $id)->update(['links' => json_encode($enlaces, JSON_UNESCAPED_UNICODE), 'updated_at' => now()]);
        if ($sensible) {
            Bitacora::registrar('FILE_DOWNLOADED', ['user' => $quien, 'entity' => 'file_attachments', 'entity_id' => $id,
                'detail' => "{$f->file_name} · ".self::CLASIFICACIONES[$f->classification]." · enlace de {$minutos} minutos"]);
            Events::emit('file.downloaded', 'file_attachments', $id, ['by' => $quien->id, 'name' => $f->file_name, 'classification' => $f->classification, 'minutes' => $minutos]);
        }

        return ['url' => $url, 'expires_at' => $vence->toIso8601String(), 'minutos' => $minutos];
    }

    /** La descarga misma, desde el enlace firmado (la firma ya se validó y lleva la empresa). */
    public static function descargar(string $id, string $empresa)
    {
        TenantContext::set(TenantContext::find($empresa));
        $f = DB::table('file_attachments')->where('id', $id)->where('status', 'ACTIVE')->first();
        if (! $f || ! str_starts_with((string) $f->storage_key, 'local://')) {
            abort(404);
        }
        $ruta = substr($f->storage_key, 8);
        if (! Storage::disk(self::DISCO)->exists($ruta)) {
            abort(404);
        }

        return Storage::disk(self::DISCO)->download($ruta, $f->file_name, [
            'Content-Type' => $f->mime ?: 'application/octet-stream', 'X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'private, no-store',
        ]);
    }

    public static function eliminar(string $id, string $motivo, User $quien): array
    {
        $f = self::fila($id);
        if ($f->status !== 'ACTIVE') {
            RuleError::fail('RN-INT-18', 'El archivo ya estaba eliminado.');
        }
        if (mb_strlen(trim($motivo)) < 10) {
            RuleError::fail('RN-INT-18', 'Eliminar un archivo pide un motivo de al menos 10 caracteres.');
        }
        DB::table('file_attachments')->where('id', $id)->update(['status' => 'DELETED', 'deleted_reason' => mb_substr(trim($motivo), 0, 300),
            'deleted_by' => mb_substr($quien->name, 0, 120), 'deleted_at' => now(), 'updated_at' => now()]);
        Events::emit('file.deleted', 'file_attachments', $id, ['by' => $quien->id, 'name' => $f->file_name, 'reason' => trim($motivo)]);

        return self::ver($id);
    }

    public static function lista(array $f): array
    {
        $q = DB::table('file_attachments');
        foreach (['entity' => 'entity', 'entity_id' => 'entity_id', 'classification' => 'classification', 'status' => 'status'] as $k => $col) {
            if (! empty($f[$k])) {
                $q->where($col, $f[$k]);
            }
        }
        if (! empty($f['buscar'])) {
            $q->where('file_name', 'ilike', '%'.addcslashes(trim($f['buscar']), '%_\\').'%');
        }
        $q->orderByDesc('uploaded_at')->orderBy('id');
        Paginas::ordenar($q, ['file_name' => 'file_name', 'entity' => 'entity', 'size_bytes' => 'size_bytes', 'classification' => 'classification',
            'uploaded_at' => 'uploaded_at', 'status' => 'status'], 'id', $f);
        $pagina = Paginas::de($q, fn ($x) => (array) $x, $f);
        $etiquetas = self::etiquetas(collect($pagina['data']));
        $pagina['data'] = array_map(fn ($x) => self::presentar((object) $x, $etiquetas), $pagina['data']);

        $c = DB::table('file_attachments')->selectRaw(<<<'SQL'
            count(*) FILTER (WHERE status = 'ACTIVE') AS activos, coalesce(sum(size_bytes) FILTER (WHERE status = 'ACTIVE'), 0) AS bytes,
            count(*) FILTER (WHERE status = 'ACTIVE' AND classification IN ('CONFIDENTIAL','PERSONAL_DATA')) AS sensibles,
            count(*) FILTER (WHERE status = 'DELETED') AS eliminados
            SQL)->first();

        return $pagina + [
            'cifras' => ['activos' => (int) $c->activos, 'bytes' => (int) $c->bytes, 'sensibles' => (int) $c->sensibles, 'eliminados' => (int) $c->eliminados],
            'clasificaciones' => self::CLASIFICACIONES, 'registros' => collect(self::REGISTROS)->map(fn ($r) => $r[0]),
            'adjuntables' => collect(self::ADJUNTABLES)->mapWithKeys(fn ($r) => [$r => self::REGISTROS[$r][0]]),
            'permitidos' => self::permitidos(), 'max_mb' => self::maxMb(), 'minutos' => (int) (Params::get('int_file_link_minutes') ?? 10),
        ];
    }

    /** Registros recientes de un tipo, para elegir a cuál adjuntar (con buscador). */
    public static function registros(string $registro, ?string $buscar): array
    {
        if (! in_array($registro, self::ADJUNTABLES, true)) {
            return [];
        }
        $col = self::REGISTROS[$registro][1];
        $q = DB::table($registro)->select('id', DB::raw("{$col} AS label"));
        if ($buscar) {
            $q->where($col, 'ilike', '%'.addcslashes(trim($buscar), '%_\\').'%');
        }

        return $q->orderByDesc('created_at')->limit(30)->get()->map(fn ($r) => ['id' => $r->id, 'label' => (string) $r->label])->all();
    }

    public static function ver(string $id): array
    {
        $f = self::fila($id);

        return self::presentar($f, self::etiquetas(collect([(array) $f]))) + ['links' => json_decode($f->links ?? '[]', true) ?: []];
    }

    private static function fila(string $id): object
    {
        return DB::table('file_attachments')->where('id', $id)->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
    }

    /** Nombre de cada registro (el número del pedido, el nombre del trabajador…), en una consulta por tipo. */
    private static function etiquetas($filas): array
    {
        $out = [];
        foreach ($filas->groupBy('entity') as $registro => $grupo) {
            $col = self::REGISTROS[$registro][1] ?? null;
            if (! $registro || ! $col) {
                continue;
            }
            $ids = $grupo->pluck('entity_id')->filter()->unique()->values()->all();
            $out[$registro] = $ids ? DB::table($registro)->whereIn('id', $ids)->pluck($col, 'id')->all() : [];
        }

        return $out;
    }

    private static function presentar(object $f, array $etiquetas): array
    {
        $nombre = $f->entity ? (self::REGISTROS[$f->entity][0] ?? $f->entity) : null;
        $detalle = $f->entity ? ($etiquetas[$f->entity][$f->entity_id] ?? null) : null;
        if ($f->entity === 'integration_runs' && $detalle) {
            $detalle = Corridas::PROCESOS[$detalle][0] ?? $detalle;
        }

        return [
            'id' => $f->id, 'file_name' => $f->file_name, 'ext' => $f->ext, 'size_bytes' => (int) $f->size_bytes, 'sha256' => $f->sha256,
            'classification' => $f->classification, 'classification_name' => self::CLASIFICACIONES[$f->classification] ?? $f->classification,
            'sensible' => in_array($f->classification, self::SENSIBLES, true), 'entity' => $f->entity, 'entity_id' => $f->entity_id,
            'registro' => $nombre ? trim($nombre.' '.($detalle ?? '')) : 'Sin registro', 'status' => $f->status, 'uploaded_by' => $f->uploaded_by,
            'uploaded_at' => $f->uploaded_at, 'deleted_reason' => $f->deleted_reason, 'deleted_by' => $f->deleted_by, 'deleted_at' => $f->deleted_at,
            'descargable' => str_starts_with((string) $f->storage_key, 'local://'),
        ];
    }
}
