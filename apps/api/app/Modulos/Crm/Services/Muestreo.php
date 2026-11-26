<?php

namespace App\Modulos\Crm\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * CRM-14 Revisión por muestreo (RN-CRM-18): cada lunes se revisa una muestra del crm_review_sample_pct (10 %, mínimo
 * crm_review_sample_min = 3) de las conversaciones cerradas sin pedido de cada vendedora en la semana anterior. La
 * muestra sale siempre igual para la misma semana (orden fijo por un resumen del chat y la semana), así que no se
 * guarda. Un resultado distinto de OK exige nota y cada conversación se revisa una vez por semana.
 */
class Muestreo
{
    public const RESULTADOS = ['OK' => 'Sin observaciones', 'OBSERVED' => 'Observada', 'INCIDENT' => 'Incidente'];

    private static function lunes(?string $semana = null): Carbon
    {
        return ($semana ? Carbon::parse($semana, 'America/Lima') : now('America/Lima'))->startOfWeek(Carbon::MONDAY)->startOfDay();
    }

    /** Las conversaciones cerradas sin pedido de la semana anterior al lunes, por vendedora y con su muestra. */
    private static function muestra(Carbon $lunes, User $u): array
    {
        $pct = (float) (Params::get('crm_review_sample_pct') ?? 10);
        $min = (int) (Params::get('crm_review_sample_min') ?? 3);
        $vendedoras = DB::table('user_roles as ur')->join('roles as r', 'r.id', '=', 'ur.role_id')->where('r.code', 'VENDEDORA')->select('ur.user_id');
        $universo = Conversaciones::visibles($u)->where('v.status', 'CLOSED')->whereBetween('v.closed_at', [$lunes->copy()->subDays(7), $lunes->copy()->subSecond()])
            ->whereNotExists(fn ($x) => $x->from('conversation_orders as o')->whereColumn('o.conversation_id', 'v.id'))
            ->whereIn('v.assigned_user_id', $vendedoras)->get(['v.id', 'v.assigned_user_id'])->groupBy('assigned_user_id');
        $semana = $lunes->toDateString();
        $out = [];
        foreach ($universo as $vendedora => $chats) {
            $n = $chats->count();
            $tam = min($n, max($min, (int) ceil($n * $pct / 100)));
            $ids = $chats->sortBy(fn ($c) => md5($c->id.$semana))->take($tam)->pluck('id')->all();
            $out[$vendedora] = ['universo' => $n, 'ids' => $ids];
        }

        return $out;
    }

    public static function semana(array $f, User $u): array
    {
        $hoy = self::lunes();
        $semanas = collect(range(0, 9))->map(fn ($i) => $hoy->copy()->subWeeks($i));
        $lunes = ! empty($f['semana']) ? self::lunes($f['semana']) : null;
        if ($lunes && $lunes->gt($hoy)) {
            RuleError::fail('RN-CRM-18', 'La semana de revisión no puede ser futura.');
        }
        if (! $lunes) {
            // Por defecto, la última semana que tiene conversaciones que revisar.
            $lunes = $semanas->first(fn ($s) => self::muestra($s, $u) !== []) ?? $hoy;
        }
        $semana = $lunes->toDateString();
        // Una semana más antigua, elegida por fecha, también aparece en la lista para que se vea cuál es.
        if (! $semanas->contains(fn ($x) => $x->toDateString() === $semana)) {
            $semanas = $semanas->push($lunes->copy())->sortByDesc(fn ($x) => $x->timestamp)->values();
        }
        $grupos = self::muestra($lunes, $u);
        // Las ya revisadas esa semana también se listan (por ejemplo, las de una muestra anterior), si la persona ve el chat.
        $hechas = DB::table('conversation_reviews as r')->leftJoin('users as x', 'x.id', '=', 'r.reviewer_user_id')->where('r.sample_week', $semana)
            ->whereIn('r.conversation_id', Conversaciones::visibles($u)->select('v.id'))
            ->get(['r.conversation_id', 'r.result', 'r.notes', 'r.reviewed_at', 'x.name as reviso'])->keyBy('conversation_id');
        $ids = collect($grupos)->flatMap(fn ($g) => $g['ids'])->merge($hechas->keys())->unique()->values()->all();
        $chats = $ids ? DB::table('conversations as v')->join('messaging_channels as c', 'c.id', '=', 'v.channel_id')->leftJoin('customers as cu', 'cu.id', '=', 'v.customer_id')
            ->leftJoin('leads as l', 'l.id', '=', 'v.lead_id')->leftJoin('channel_contacts as k', 'k.id', '=', 'v.contact_id')->leftJoin('users as x', 'x.id', '=', 'v.assigned_user_id')
            ->leftJoin('brands as b', 'b.id', '=', 'v.brand_id')->whereIn('v.id', $ids)
            ->get(['v.id', 'v.closed_at', 'v.close_reason', 'v.assigned_user_id', 'c.kind', 'c.display_name', 'x.name as vendedora', 'b.name as marca',
                DB::raw('coalesce(cu.full_name, l.full_name, k.display_name, k.external_user_id) AS contacto'), 'k.external_user_id'])->keyBy('id') : collect();
        $filas = [];
        foreach ($ids as $id) {
            $c = $chats[$id];
            $r = $hechas[$id] ?? null;
            $filas[] = ['id' => $id, 'contacto' => $c->contacto ?: 'Cliente', 'celular' => $c->kind === 'WHATSAPP' ? $c->external_user_id : null,
                'canal' => (Canales::REDES[$c->kind] ?? $c->kind).' · '.$c->display_name, 'kind' => $c->kind, 'marca' => $c->marca, 'vendedora' => $c->vendedora, 'user_id' => $c->assigned_user_id,
                'cerrada' => $c->closed_at, 'motivo' => Conversaciones::CIERRES[$c->close_reason] ?? $c->close_reason,
                'resultado' => $r?->result, 'resultado_name' => $r ? self::RESULTADOS[$r->result] ?? $r->result : 'Pendiente', 'nota' => $r?->notes, 'reviso' => $r?->reviso, 'reviewed_at' => $r?->reviewed_at];
        }
        $porVendedora = collect($grupos)->map(fn ($g, $id) => ['id' => $id, 'nombre' => DB::table('users')->where('id', $id)->value('name'), 'universo' => $g['universo'],
            'muestra' => count($g['ids']), 'revisadas' => collect($g['ids'])->filter(fn ($x) => isset($hechas[$x]))->count()])->sortBy('nombre')->values()->all();
        $cifras = ['vendedoras' => count($grupos), 'a_revisar' => count($ids), 'revisadas' => collect($filas)->whereNotNull('resultado')->count(),
            'observadas' => collect($filas)->whereIn('resultado', ['OBSERVED', 'INCIDENT'])->count(), 'incidentes' => collect($filas)->where('resultado', 'INCIDENT')->count(),
            'universo' => collect($grupos)->sum('universo')];
        if (! empty($f['vendedora'])) {
            $filas = array_values(array_filter($filas, fn ($x) => $x['user_id'] === $f['vendedora']));
        }
        match ($f['resultado'] ?? '') {
            '' => null,
            'PENDING' => $filas = array_values(array_filter($filas, fn ($x) => $x['resultado'] === null)),
            default => $filas = array_values(array_filter($filas, fn ($x) => $x['resultado'] === $f['resultado'])),
        };
        $t = mb_strtolower(trim((string) ($f['buscar'] ?? '')));
        if (mb_strlen($t) >= 2) {
            $filas = array_values(array_filter($filas, fn ($x) => str_contains(mb_strtolower($x['contacto'].' '.$x['celular'].' '.$x['vendedora'].' '.$x['canal']), $t)));
        }
        $desde = $lunes->copy()->subDays(7);

        return Paginas::deLista(Paginas::ordenarLista($filas, ['contacto', 'vendedora', 'canal', 'cerrada', 'resultado_name'], $f), $f) + [
            'semana' => $semana, 'desde' => $desde->toDateString(), 'hasta' => $lunes->copy()->subDay()->toDateString(),
            'semanas' => $semanas->map(fn ($s) => ['value' => $s->toDateString(), 'label' => 'Lunes '.$s->format('d/m').' · cerradas del '.$s->copy()->subDays(7)->format('d/m').' al '.$s->copy()->subDay()->format('d/m')])->all(),
            'cifras' => $cifras, 'por_vendedora' => $porVendedora,
            'reglas' => ['pct' => (float) (Params::get('crm_review_sample_pct') ?? 10), 'min' => (int) (Params::get('crm_review_sample_min') ?? 3)],
            'opciones' => ['resultados' => collect(self::RESULTADOS)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all(),
                'vendedoras' => collect($porVendedora)->map(fn ($v) => ['value' => $v['id'], 'label' => $v['nombre']])->all()],
            'puede' => Access::can($u, 'crm.review.perform'),
        ];
    }

    public static function registrar(string $conversacion, string $semana, string $resultado, ?string $nota, User $u): array
    {
        if (! Access::can($u, 'crm.review.perform')) {
            RuleError::fail('RN-CRM-18', 'Tu rol no hace la revisión por muestreo.');
        }
        $lunes = self::lunes($semana);
        if ($lunes->toDateString() !== $semana || $lunes->gt(self::lunes())) {
            RuleError::fail('RN-CRM-18', 'La semana de revisión es un lunes que ya llegó.');
        }
        $enMuestra = collect(self::muestra($lunes, $u))->contains(fn ($g) => in_array($conversacion, $g['ids'], true));
        if (! $enMuestra) {
            RuleError::fail('RN-CRM-18', 'Esa conversación no está en la muestra de la semana.');
        }
        $nota = trim((string) $nota);
        if ($resultado !== 'OK' && mb_strlen($nota) < 5) {
            RuleError::fail('RN-CRM-18', 'Una conversación observada o con incidente exige una nota (al menos 5 caracteres).');
        }
        if (DB::table('conversation_reviews')->where('conversation_id', $conversacion)->where('sample_week', $semana)->exists()) {
            RuleError::fail('RN-CRM-18', 'Esta conversación ya se revisó esta semana.');
        }
        $id = DB::table('conversation_reviews')->insertGetId(['conversation_id' => $conversacion, 'reviewer_user_id' => $u->id, 'sample_week' => $semana, 'result' => $resultado,
            'notes' => $nota !== '' ? mb_substr($nota, 0, 2000) : null, 'reviewed_at' => now(), 'created_at' => now()], 'id');
        Events::emit('conversation.reviewed', 'conversation_reviews', $id, ['result' => $resultado, 'week' => $semana, 'by' => $u->id]);

        return ['id' => $id, 'resultado' => $resultado, 'resultado_name' => self::RESULTADOS[$resultado]];
    }
}
