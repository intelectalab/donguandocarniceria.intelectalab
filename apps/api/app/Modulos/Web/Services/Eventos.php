<?php

namespace App\Modulos\Web\Services;

use App\Models\User;
use App\Modulos\Int\Services\Webhooks;
use App\Support\Access;
use App\Support\Paginas;
use Illuminate\Support\Facades\DB;

/**
 * WEB-07 Eventos webhook: la bitácora de INT (INT-05) filtrada a los webhooks de WEB (WooCommerce y Mercado Pago), con
 * el pedido web o el pago al que llevó cada uno. El evento crudo no se modifica (RN-INT-06); el reproceso de un fallido
 * es el de INT (RN-INT-07, int.webhook.reprocess).
 */
final class Eventos
{
    public const PROVEEDORES = ['WOOCOMMERCE' => 'WooCommerce', 'MERCADOPAGO' => 'Mercado Pago'];

    /** Conectores de las tiendas que el usuario ve. */
    private static function conectores(User $u): array
    {
        $ids = [];
        foreach (Base::tiendasDe($u) as $s) {
            $ids[] = $s->connector_id;
            $ids[] = $s->payment_connector_id;
        }

        return array_values(array_unique(array_filter($ids)));
    }

    public static function lista(User $u, array $f): array
    {
        $q = DB::table('webhook_events as w')->join('integration_connectors as c', 'c.id', '=', 'w.connector_id')
            ->where('w.owner_module', 'WEB')->whereIn('w.connector_id', self::conectores($u) ?: ['00000000-0000-0000-0000-000000000000'])
            ->select('w.id', 'w.received_at', 'w.event_key', 'w.status', 'w.http_status', 'w.duplicates', 'w.attempts', 'w.processed_at', 'w.result', 'w.last_error',
                'c.provider', 'c.name as conector', 'c.environment')
            ->addSelect('w.body')
            ->selectRaw('extract(epoch FROM (w.processed_at - w.received_at)) AS segundos');
        if (! empty($f['proveedor'])) {
            $q->where('c.provider', $f['proveedor']);
        }
        if (! empty($f['estado'])) {
            $q->where('w.status', $f['estado']);
        }
        if (! empty($f['dia']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $f['dia'])) {
            $q->whereRaw("(w.received_at AT TIME ZONE 'America/Lima')::date = ?", [$f['dia']]);
        }
        if (! empty($f['q'])) {
            $t = '%'.addcslashes(trim($f['q']), '%_\\').'%';
            $q->where(fn ($w) => $w->where('w.body', 'ilike', $t)->orWhere('w.event_key', 'ilike', $t));
        }
        $q->orderByDesc('w.received_at')->orderBy('w.id');
        Paginas::ordenar($q, ['received_at' => 'w.received_at', 'status' => 'w.status', 'duplicates' => 'w.duplicates', 'attempts' => 'w.attempts'], 'w.id', $f);
        $base = DB::table('webhook_events as w')->where('w.owner_module', 'WEB')->whereIn('w.connector_id', self::conectores($u) ?: ['00000000-0000-0000-0000-000000000000']);
        $r = (clone $base)->selectRaw("count(*) filter (where (w.received_at AT TIME ZONE 'America/Lima')::date = ?) as hoy", [Base::hoy()])
            ->selectRaw("count(*) filter (where w.status = 'FAILED') as fallidos")->selectRaw("count(*) filter (where w.status = 'REJECTED') as rechazados")
            ->selectRaw('coalesce(sum(w.duplicates), 0) as repetidos')->first();

        return Paginas::de($q, function ($w) {
            $b = json_decode((string) $w->body, true);
            $ref = is_array($b) ? ($w->provider === 'MERCADOPAGO' ? ($b['data']['id'] ?? null) : ($b['number'] ?? $b['id'] ?? null)) : null;
            unset($w->body);

            return array_merge((array) $w, ['referencia' => is_scalar($ref) ? (string) $ref : null, 'proveedor_nombre' => self::PROVEEDORES[$w->provider] ?? $w->provider,
                'segundos' => $w->segundos === null ? null : round((float) $w->segundos, 1)]);
        }, $f) + [
            'cifras' => ['hoy' => (int) $r->hoy, 'fallidos' => (int) $r->fallidos, 'rechazados' => (int) $r->rechazados, 'repetidos' => (int) $r->repetidos],
            'estados' => Webhooks::ESTADOS, 'proveedores' => self::PROVEEDORES,
        ];
    }

    public static function ver(string $id, User $u): array
    {
        $ev = DB::table('webhook_events')->where('id', $id)->where('owner_module', 'WEB')->first(['id', 'connector_id']);
        if (! $ev || ! in_array($ev->connector_id, self::conectores($u), true)) {
            abort(response()->json(['message' => 'Evento no encontrado.', 'code' => 'NOT_FOUND'], 404));
        }
        $w = Webhooks::ver($id);
        $ib = DB::table('web_order_inbox')->whereRaw('webhook_event_ids @> ?::jsonb', [Base::enc([$id])])->first(['id', 'external_order_id', 'status']);
        $tx = DB::table('gateway_transactions')->whereRaw('webhook_event_ids @> ?::jsonb', [Base::enc([$id])])->first(['id', 'external_payment_id', 'status']);

        return $w + ['bandeja' => $ib, 'pago' => $tx, 'puede_reprocesar' => $w['status'] === 'FAILED' && Access::can($u, 'int.webhook.reprocess')];
    }
}
