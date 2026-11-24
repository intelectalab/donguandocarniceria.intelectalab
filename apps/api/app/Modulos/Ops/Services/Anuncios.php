<?php

namespace App\Modulos\Ops\Services;

use App\Support\Paginas;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * OPS-11 Anuncios: se redactan, se programan y se publican para todas las empresas, por plan o para una lista de
 * empresas (rol con announce.manage). La empresa ve solo lo publicado, vigente y dirigido a ella (RLS, RN-OPS-06),
 * como una franja en su sistema. RN-OPS-18: un mantenimiento se anuncia con al menos ops_maintenance_notice_hours (48).
 */
final class Anuncios
{
    public const TIPOS = ['INFO' => 'Información', 'MAINTENANCE' => 'Mantenimiento', 'INCIDENT' => 'Incidente', 'FEATURE' => 'Novedad'];

    public const PUBLICOS = ['ALL' => 'Todas las empresas', 'PLANS' => 'Por plan', 'TENANTS' => 'Empresas elegidas'];

    public const ESTADOS = ['DRAFT' => 'Borrador', 'SCHEDULED' => 'Programado', 'ACTIVE' => 'Publicado', 'ENDED' => 'Terminado', 'CANCELLED' => 'Cancelado'];

    public static function lista(array $f = []): array
    {
        $q = DB::table('platform_announcements as a')->leftJoin('platform_incidents as i', 'i.id', '=', 'a.incident_id')
            ->select('a.*', 'i.number as incident_number')->orderByDesc('a.created_at')->orderBy('a.id');
        if (! empty($f['kind'])) {
            $q->where('a.kind', $f['kind']);
        }
        match ($f['status'] ?? null) {
            'CANCELLED' => $q->whereNotNull('a.cancelled_at'),
            'DRAFT' => $q->whereNull('a.cancelled_at')->where('a.published', false),
            'ENDED' => $q->whereNull('a.cancelled_at')->where('a.published', true)->whereNotNull('a.ends_at')->where('a.ends_at', '<', now()),
            'SCHEDULED' => $q->whereNull('a.cancelled_at')->where('a.published', true)->where('a.starts_at', '>', now())
                ->where(fn ($w) => $w->whereNull('a.ends_at')->orWhere('a.ends_at', '>=', now())),
            'ACTIVE' => $q->whereNull('a.cancelled_at')->where('a.published', true)->where('a.starts_at', '<=', now())
                ->where(fn ($w) => $w->whereNull('a.ends_at')->orWhere('a.ends_at', '>=', now())),
            default => null,
        };
        Paginas::ordenar($q, ['title' => 'a.title', 'kind' => 'a.kind', 'audience' => 'a.audience', 'starts_at' => 'a.starts_at'], 'a.id', $f);

        return Paginas::de($q, fn ($a) => self::presentar($a), $f) + [
            'planes' => DB::table('saas_plans')->orderBy('sort_order')->get(['code', 'name']),
            'empresas' => DB::table('tenants')->where('status', 'ACTIVE')->orderBy('short')->get(['id', 'short']),
            'aviso_horas' => self::anticipacion(),
        ];
    }

    /** Crea o cambia un anuncio (no uno cancelado o terminado). Queda como borrador hasta publicarlo. */
    public static function guardar(array $quien, array $d, ?string $id = null): array
    {
        Consola::exigir($quien, 'announce.manage');
        if ($id) {
            $a = self::fila($id);
            if (in_array(self::estado($a), ['CANCELLED', 'ENDED'], true)) {
                RuleError::fail('RN-OPS-18', 'Un anuncio cancelado o terminado no se cambia: crea otro.');
            }
        }
        $fila = self::validar($d) + ['updated_at' => now()];
        if ($id) {
            if ($a->published && $fila['kind'] === 'MAINTENANCE') {
                self::exigirAnticipacion($fila, max(Carbon::parse($a->published_at), Carbon::parse($fila['starts_at'])));
            }
            DB::table('platform_announcements')->where('id', $id)->update($fila);
        } else {
            $id = DB::table('platform_announcements')->insertGetId($fila + ['created_by' => $quien['id'], 'created_by_name' => $quien['full_name'], 'created_at' => now()], 'id');
        }
        Consola::bitacora('ANNOUNCEMENT_SAVED', $quien, ['entity' => 'platform_announcements', 'entity_id' => $id, 'reason' => $fila['title']]);

        return self::ver($id);
    }

    public static function publicar(string $id, array $quien): array
    {
        Consola::exigir($quien, 'announce.manage');
        $a = self::fila($id);
        if ($a->published || $a->cancelled_at) {
            RuleError::fail('RN-OPS-18', 'El anuncio ya está publicado o cancelado.');
        }
        if ($a->kind === 'MAINTENANCE') {
            self::exigirAnticipacion((array) $a, max(now(), Carbon::parse($a->starts_at)));
        }
        DB::table('platform_announcements')->where('id', $id)->update(['published' => true, 'published_at' => now(), 'updated_at' => now()]);
        Consola::bitacora('ANNOUNCEMENT_PUBLISHED', $quien, ['entity' => 'platform_announcements', 'entity_id' => $id, 'reason' => $a->title,
            'detail' => ['publico' => $a->audience, 'desde' => $a->starts_at]]);

        return self::ver($id);
    }

    public static function cancelar(string $id, array $quien): array
    {
        Consola::exigir($quien, 'announce.manage');
        $a = self::fila($id);
        if ($a->cancelled_at) {
            RuleError::fail('RN-OPS-18', 'El anuncio ya está cancelado.');
        }
        DB::table('platform_announcements')->where('id', $id)->update(['cancelled_at' => now(), 'updated_at' => now()]);
        Consola::bitacora('ANNOUNCEMENT_CANCELLED', $quien, ['entity' => 'platform_announcements', 'entity_id' => $id, 'reason' => $a->title]);

        return self::ver($id);
    }

    public static function ver(string $id): array
    {
        $a = DB::table('platform_announcements as a')->leftJoin('platform_incidents as i', 'i.id', '=', 'a.incident_id')->where('a.id', $id)
            ->select('a.*', 'i.number as incident_number')->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));

        return self::presentar($a);
    }

    /** Lo que ve la empresa: RLS deja solo lo publicado y dirigido a ella; aquí, lo que está en su ventana. */
    public static function paraEmpresa(): array
    {
        return DB::table('platform_announcements')->where('starts_at', '<=', now())->where(fn ($q) => $q->whereNull('ends_at')->orWhere('ends_at', '>', now()))
            ->orderByRaw("CASE kind WHEN 'INCIDENT' THEN 0 WHEN 'MAINTENANCE' THEN 1 ELSE 2 END")->orderByDesc('starts_at')->limit(5)
            ->get(['id', 'title', 'body', 'kind', 'starts_at', 'ends_at', 'maintenance_starts_at', 'maintenance_ends_at'])->all();
    }

    /* ------------------------------------------------------------------ internos */

    private static function validar(array $d): array
    {
        $inicio = isset($d['starts_at']) ? Carbon::parse($d['starts_at']) : now();
        $fin = isset($d['ends_at']) ? Carbon::parse($d['ends_at']) : null;
        if ($fin && $fin->lessThanOrEqualTo($inicio)) {
            RuleError::fail('RN-OPS-18', 'El fin del anuncio debe ser posterior a su inicio.');
        }
        $planes = $d['audience'] === 'PLANS' ? array_values(array_unique($d['audience_plans'] ?? [])) : [];
        $empresas = $d['audience'] === 'TENANTS' ? array_values(array_unique($d['audience_tenants'] ?? [])) : [];
        if ($d['audience'] === 'PLANS' && (! $planes || DB::table('saas_plans')->whereIn('code', $planes)->count() !== count($planes))) {
            RuleError::fail('RN-OPS-18', 'Elige al menos un plan válido.');
        }
        if ($d['audience'] === 'TENANTS' && (! $empresas || DB::table('tenants')->whereIn('id', $empresas)->count() !== count($empresas))) {
            RuleError::fail('RN-OPS-18', 'Elige al menos una empresa válida.');
        }
        $fila = ['title' => trim($d['title']), 'body' => trim($d['body']), 'kind' => $d['kind'], 'audience' => $d['audience'],
            'audience_plans' => json_encode($planes), 'audience_tenants' => json_encode($empresas), 'starts_at' => $inicio, 'ends_at' => $fin,
            'maintenance_starts_at' => null, 'maintenance_ends_at' => null];
        if ($d['kind'] === 'MAINTENANCE') {
            if (empty($d['maintenance_starts_at']) || empty($d['maintenance_ends_at'])) {
                RuleError::fail('RN-OPS-18', 'Un mantenimiento lleva su inicio y su fin.');
            }
            $mi = Carbon::parse($d['maintenance_starts_at']);
            $mf = Carbon::parse($d['maintenance_ends_at']);
            if ($mf->lessThanOrEqualTo($mi)) {
                RuleError::fail('RN-OPS-18', 'El fin del mantenimiento debe ser posterior a su inicio.');
            }
            $fila['maintenance_starts_at'] = $mi;
            $fila['maintenance_ends_at'] = $mf;
            $fila['ends_at'] ??= $mf;   // el anuncio se ve hasta que termina el mantenimiento
        }

        return $fila;
    }

    /** RN-OPS-18: entre que el anuncio se ve y el inicio del mantenimiento, al menos ops_maintenance_notice_hours. */
    private static function exigirAnticipacion(array $a, Carbon $visibleDesde): void
    {
        $horas = self::anticipacion();
        if (Carbon::parse($a['maintenance_starts_at'])->lessThan($visibleDesde->copy()->addHours($horas))) {
            RuleError::fail('RN-OPS-18', "Un mantenimiento se anuncia con al menos {$horas} horas de anticipación.");
        }
    }

    private static function anticipacion(): int
    {
        return (int) Consola::param('ops_maintenance_notice_hours', 48);
    }

    private static function estado(object $a): string
    {
        return match (true) {
            $a->cancelled_at !== null => 'CANCELLED',
            ! $a->published => 'DRAFT',
            $a->ends_at !== null && Carbon::parse($a->ends_at)->isPast() => 'ENDED',
            Carbon::parse($a->starts_at)->isFuture() => 'SCHEDULED',
            default => 'ACTIVE',
        };
    }

    private static function fila(string $id): object
    {
        return DB::table('platform_announcements')->where('id', $id)->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
    }

    private static function presentar(object $a): array
    {
        $estado = self::estado($a);

        return [
            'id' => $a->id, 'title' => $a->title, 'body' => $a->body, 'kind' => $a->kind, 'kind_name' => self::TIPOS[$a->kind],
            'audience' => $a->audience, 'audience_name' => self::PUBLICOS[$a->audience], 'audience_plans' => json_decode($a->audience_plans, true),
            'audience_tenants' => json_decode($a->audience_tenants, true), 'starts_at' => $a->starts_at, 'ends_at' => $a->ends_at,
            'maintenance_starts_at' => $a->maintenance_starts_at, 'maintenance_ends_at' => $a->maintenance_ends_at, 'status' => $estado,
            'status_name' => self::ESTADOS[$estado], 'published_at' => $a->published_at, 'incident_id' => $a->incident_id,
            'incident_number' => $a->incident_number ?? null, 'created_by_name' => $a->created_by_name, 'created_at' => $a->created_at,
        ];
    }
}
