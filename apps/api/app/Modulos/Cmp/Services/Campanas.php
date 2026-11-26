<?php

namespace App\Modulos\Cmp\Services;

use App\Models\User;
use App\Modulos\Canales\Soporte as S;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * CMP-03 a CMP-06 y CMP-13: campañas por WhatsApp con estimación de costo antes de aprobar (RN-CMP-05, 06, 18),
 * aprobación con umbral y por otra persona (RN-CMP-02), envío solo a quien tiene consentimiento (RN-CMP-03, 17),
 * atribución de un pedido a una sola campaña (RN-CMP-15) y retorno sobre lo cobrado (RN-CMP-16).
 */
final class Campanas
{
    public const OBJETIVOS = ['REPURCHASE' => 'Recompra', 'REACTIVATION' => 'Reactivación', 'LAUNCH' => 'Lanzamiento', 'PROMOTION' => 'Promoción', 'LOYALTY' => 'Fidelización'];

    public static function tarifa(): float
    {
        return S::num('crm_wa_rate_marketing', 0.2339);
    }

    public static function comision(): float
    {
        return S::num('cmp_bsp_fee_pen', 0);
    }

    public static function umbral(): float
    {
        return S::num('cmp_approval_threshold_pen', 100);
    }

    public static function igv(): float
    {
        $v = S::num('fac_igv_rate', 0.18);

        return $v > 1 ? $v / 100 : $v;
    }

    /** Cálculo de la estimación: elegibles (con consentimiento y bajo el tope) → grupo de control y efectivos. */
    public static function estimar(int $elegibles, float $controlPct, int $sinConsentimiento = 0, int $porFrecuencia = 0): array
    {
        $control = (int) round($elegibles * $controlPct / 100);
        $efectivos = $elegibles - $control;
        $unit = S::r(self::tarifa() + self::comision(), 4);
        $costo = S::r($efectivos * $unit);

        return ['target' => $elegibles + $sinConsentimiento + $porFrecuencia, 'excluded_consent' => $sinConsentimiento, 'excluded_frequency' => $porFrecuencia,
            'eligible' => $elegibles, 'control' => $control, 'effective' => $efectivos, 'unit' => $unit, 'cost' => $costo,
            'threshold' => self::umbral(), 'needs_manager' => $costo > self::umbral() + 0.0001];
    }

    /** Destinatarios planificados (recalcula el segmento antes). El grupo de control es al azar, pero reproducible por campaña. */
    public static function planificar(object $c, ?string $fecha = null): array
    {
        $seg = DB::table('customer_segments')->where('id', $c->segment_id)->first() ?? RuleError::fail('RN-CMP-01', 'La campaña no tiene segmento.');
        $ids = Audiencia::refrescar($seg);
        $cons = Audiencia::consentimientos($c->brand_id, $ids);
        $semana = Audiencia::enLaSemana($fecha, $ids);
        $max = (int) S::num('cmp_max_marketing_per_week', 2);
        $filas = [];
        $eleg = [];
        foreach ($ids as $id) {
            if (! ($cons[$id] ?? false)) {
                $filas[$id] = 'SKIPPED_CONSENT';
            } elseif (($semana[$id] ?? 0) >= $max) {
                $filas[$id] = 'SKIPPED_FREQUENCY';
            } else {
                $eleg[] = $id;
            }
        }
        $cuenta = array_count_values($filas);
        $est = self::estimar(count($eleg), (float) $c->control_group_pct, $cuenta['SKIPPED_CONSENT'] ?? 0, $cuenta['SKIPPED_FREQUENCY'] ?? 0);
        usort($eleg, fn ($a, $b) => crc32($c->code.':'.$a) <=> crc32($c->code.':'.$b));
        $control = array_flip(array_slice($eleg, 0, $est['control']));
        foreach ($eleg as $id) {
            $filas[$id] = isset($control[$id]) ? 'CONTROL' : 'QUEUED';
        }

        return ['rows' => $filas, 'estimate' => $est, 'segment' => $seg];
    }

    /** Guarda la estimación en la campaña y el descuento esperado por el cupón. */
    public static function aplicarEstimacion(object $c): array
    {
        $p = self::planificar($c);
        $e = $p['estimate'];
        $desc = null;
        if ($c->coupon_id) {
            $cp = DB::table('coupons')->where('id', $c->coupon_id)->first();
            $ticket = (float) (DB::table('sales_orders')->where('brand_id', $c->brand_id)->whereNotIn('status', ['DRAFT', 'CANCELLED'])->avg('estimated_total') ?? 0);
            $canje = 0.08;  // canje esperado de cupones de campaña, referencia KPI-CMP-05 del prototipo
            $porPedido = match ($cp->discount_type ?? null) {
                'PCT' => min($ticket * (float) $cp->value / 100, $cp->max_discount !== null ? (float) $cp->max_discount : INF),
                'AMOUNT' => (float) $cp->value,
                'FREE_DELIVERY' => (float) (DB::table('sales_orders')->where('brand_id', $c->brand_id)->avg('delivery_fee') ?? 0),
                default => 0,
            };
            $desc = S::r($e['effective'] * $canje * $porPedido);
        }
        DB::table('campaigns')->where('id', $c->id)->update([
            'target_count' => $e['target'], 'control_count' => $e['control'], 'excluded_consent_count' => $e['excluded_consent'], 'excluded_frequency_count' => $e['excluded_frequency'],
            'effective_count' => $e['effective'], 'unit_cost' => $e['unit'], 'estimated_cost' => $e['cost'], 'estimated_discount' => $desc, 'estimated_at' => now(), 'updated_at' => now(),
        ]);

        return $e + ['estimated_discount' => $desc];
    }

    private static function plantillaValida(?object $t, string $brandId, ?string $channelId): bool
    {
        return $t && $t->category === 'MARKETING' && $t->provider_status === 'APPROVED' && $t->brand_id === $brandId && (! $t->channel_id || ! $channelId || $t->channel_id === $channelId);
    }

    private static function historia(object $c, string $a, ?string $motivo, User $quien): string
    {
        return S::historial($c->history, ['at' => S::ahora()->format('Y-m-d\TH:i'), 'from' => $c->status, 'to' => $a, 'user' => $quien->name, 'reason' => $motivo]);
    }

    public static function guardar(array $d, ?string $id, User $quien): object
    {
        return S::base(fn () => DB::transaction(function () use ($d, $id, $quien) {
            $actual = $id ? (DB::table('campaigns')->where('id', $id)->lockForUpdate()->first() ?? abort(404)) : null;
            if ($actual && $actual->status !== 'DRAFT') {
                RuleError::fail('RN-CMP-02', 'Solo se edita una campaña en borrador.');
            }
            $marca = $d['brand_id'] ?? null;
            $marca && DB::table('brands')->where('id', $marca)->exists() || RuleError::fail('RN-CMP-19', 'Elige la marca.');
            trim((string) ($d['name'] ?? '')) !== '' || RuleError::fail('RN-CMP-01', 'Ponle nombre a la campaña.');
            $seg = DB::table('customer_segments')->where('id', $d['segment_id'] ?? null)->first() ?? RuleError::fail('RN-CMP-01', 'Elige un segmento.');
            if ($seg->brand_id && $seg->brand_id !== $marca) {
                RuleError::fail('RN-CMP-19', "El segmento {$seg->code} es de otra marca.");
            }
            ($d['channel'] ?? 'WHATSAPP') === 'WHATSAPP' || RuleError::fail('RN-CMP-17', 'Por ahora las campañas van solo por WhatsApp.');
            $canal = DB::table('messaging_channels')->where('id', $d['channel_id'] ?? null)->first();
            ($canal && $canal->brand_id === $marca && $canal->kind === 'WHATSAPP') || RuleError::fail('RN-CMP-17', 'Elige un número de WhatsApp de la marca.');
            $t = DB::table('message_templates')->where('id', $d['template_id'] ?? null)->first();
            self::plantillaValida($t, $marca, $canal->id) || RuleError::fail('RN-CMP-17', 'La plantilla '.($t->name ?? '').' no es de marketing aprobada por Meta para el número de la marca.');
            if (! empty($d['coupon_id'])) {
                $cp = DB::table('coupons')->where('id', $d['coupon_id'])->first();
                ($cp && (! $cp->brand_id || $cp->brand_id === $marca)) || RuleError::fail('RN-CMP-08', 'El cupón no es de la marca de la campaña.');
            }
            $ventana = (int) ($d['attribution_window_days'] ?? S::num('cmp_attribution_window_days', 7));
            ($ventana >= 1 && $ventana <= 60) || RuleError::fail('RN-CMP-15', 'La ventana de atribución va de 1 a 60 días.');
            $control = (float) ($d['control_group_pct'] ?? S::num('cmp_control_group_pct', 10));
            ($control >= 0 && $control <= 50) || RuleError::fail('RN-CMP-18', 'El grupo de control va de 0 % a 50 %.');
            $obj = $d['objective'] ?? 'PROMOTION';
            isset(self::OBJETIVOS[$obj]) || RuleError::fail('RN-CMP-01', 'Elige el objetivo.');
            $fila = ['name' => mb_substr(trim($d['name']), 0, 255), 'brand_id' => $marca, 'segment_id' => $seg->id, 'channel' => 'WHATSAPP', 'channel_id' => $canal->id,
                'template_id' => $t->id, 'objective' => $obj, 'coupon_id' => $d['coupon_id'] ?? null, 'scheduled_at' => $d['scheduled_at'] ?? null,
                'attribution_window_days' => $ventana, 'control_group_pct' => $control, 'updated_at' => now()];
            if ($actual) {
                DB::table('campaigns')->where('id', $id)->update($fila);
            } else {
                $id = DB::table('campaigns')->insertGetId($fila + ['code' => S::numero('campaigns', 'CMP-', 4, 'code'), 'status' => 'DRAFT', 'created_by_user' => $quien->id,
                    'history' => json_encode([['at' => S::ahora()->format('Y-m-d\TH:i'), 'to' => 'DRAFT', 'user' => $quien->name]], JSON_UNESCAPED_UNICODE)], 'id');
            }
            if (! empty($d['coupon_id'])) {
                DB::table('coupons')->where('id', $d['coupon_id'])->whereNull('campaign_id')->update(['campaign_id' => $id, 'updated_at' => now()]);
            }
            self::aplicarEstimacion(DB::table('campaigns')->where('id', $id)->first());

            return DB::table('campaigns')->where('id', $id)->first();
        }));
    }

    public static function enviarAAprobacion(string $id, User $quien): object
    {
        return DB::transaction(function () use ($id, $quien) {
            $c = DB::table('campaigns')->where('id', $id)->lockForUpdate()->first() ?? abort(404);
            $c->status === 'DRAFT' || RuleError::fail('RN-CMP-02', 'Solo una campaña en borrador se envía a aprobación.');
            $e = self::aplicarEstimacion($c);
            DB::table('campaigns')->where('id', $id)->update(['status' => 'PENDING_APPROVAL', 'history' => self::historia($c, 'PENDING_APPROVAL', null, $quien), 'updated_at' => now()]);
            S::avisar('CMP', ['role' => $e['needs_manager'] ? 'GERENTE' : 'ADMINISTRACION'], "Campaña {$c->code} por aprobar", "{$c->name}: {$e['effective']} destinatarios, costo estimado ".S::soles($e['cost']), 'CMP-05', $id, 'info');

            return DB::table('campaigns')->where('id', $id)->first();
        });
    }

    /** RN-CMP-02: con costo estimado; sobre el umbral solo GERENTE; quien la creó no la aprueba. */
    public static function aprobar(string $id, User $quien): object
    {
        return S::base(fn () => DB::transaction(function () use ($id, $quien) {
            $c = DB::table('campaigns')->where('id', $id)->lockForUpdate()->first() ?? abort(404);
            in_array($c->status, ['PENDING_APPROVAL', 'DRAFT'], true) || RuleError::fail('RN-CMP-02', 'La campaña ya no está por aprobar.');
            $c->estimated_cost !== null || RuleError::fail('RN-CMP-02', 'Sin costo estimado no se aprueba: calcula la estimación primero.');
            Access::can($quien, 'cmp.campaign.approve') || RuleError::fail('RN-CMP-02', 'Tu rol no aprueba campañas.');
            if ((float) $c->estimated_cost > self::umbral() + 0.0001 && ! Access::can($quien, 'cmp.campaign.approve_over_threshold')) {
                RuleError::fail('RN-CMP-02', 'El costo estimado '.S::soles($c->estimated_cost).' supera el umbral de '.S::soles(self::umbral()).': solo la aprueba gerencia.');
            }
            $c->created_by_user !== $quien->id || RuleError::fail('RN-CMP-02', 'Quien creó la campaña no la aprueba: pide la aprobación a otra persona.');
            DB::table('campaigns')->where('id', $id)->update(['status' => 'APPROVED', 'approved_by' => $quien->id, 'approved_at' => now(), 'history' => self::historia($c, 'APPROVED', null, $quien), 'updated_at' => now()]);
            Events::emit('campaign.approved', 'campaigns', $id, ['code' => $c->code, 'estimated_cost' => (float) $c->estimated_cost]);

            return DB::table('campaigns')->where('id', $id)->first();
        }));
    }

    public static function cancelar(string $id, ?string $motivo, User $quien): object
    {
        $motivo = S::motivo($motivo, 'RN-CMP-02', 'Indica el motivo de la cancelación.');
        $c = DB::table('campaigns')->where('id', $id)->first() ?? abort(404);
        in_array($c->status, ['SENT', 'CANCELLED'], true) && RuleError::fail('RN-CMP-02', 'Una campaña enviada o cancelada no se cancela.');
        DB::table('campaigns')->where('id', $id)->update(['status' => 'CANCELLED', 'cancel_reason' => mb_substr($motivo, 0, 255), 'history' => self::historia($c, 'CANCELLED', $motivo, $quien), 'updated_at' => now()]);

        return DB::table('campaigns')->where('id', $id)->first();
    }

    /**
     * Envía una campaña aprobada: recalcula, arma los destinatarios y deja cada mensaje en manos del enviador de WhatsApp.
     * Antes de cada mensaje vuelve a mirar el consentimiento (RN-CMP-03): una baja de último minuto no recibe nada.
     */
    public static function enviar(string $id, User $quien): array
    {
        return DB::transaction(function () use ($id, $quien) {
            $c = DB::table('campaigns')->where('id', $id)->lockForUpdate()->first() ?? abort(404);
            $c->status === 'APPROVED' || RuleError::fail('RN-CMP-02', 'Solo se envía una campaña aprobada y con costo estimado.');
            $c->estimated_cost !== null || RuleError::fail('RN-CMP-02', 'La campaña no tiene costo estimado.');
            $t = DB::table('message_templates')->where('id', $c->template_id)->first();
            self::plantillaValida($t, $c->brand_id, $c->channel_id) || RuleError::fail('RN-CMP-17', 'La plantilla ya no está aprobada para el número de la marca.');
            $p = self::planificar($c);
            $cupon = $c->coupon_id ? DB::table('coupons')->where('id', $c->coupon_id)->value('code') : '';
            $clientes = DB::table('customers')->whereIn('id', array_keys($p['rows']) ?: ['00000000-0000-0000-0000-000000000000'])->get(['id', 'full_name', 'phone'])->keyBy('id');
            $real = 0.0;
            $env = 0;
            DB::table('campaign_recipients')->where('campaign_id', $id)->delete();
            foreach ($p['rows'] as $cid => $estado) {
                $fila = ['campaign_id' => $id, 'customer_id' => $cid, 'phone' => $clientes[$cid]->phone ?? null, 'is_control' => $estado === 'CONTROL', 'status' => $estado, 'message_cost' => 0, 'opted_out' => false];
                if ($estado === 'QUEUED') {
                    if (! Audiencia::tieneConsentimiento($cid, $c->brand_id)) {
                        $fila['status'] = 'SKIPPED_CONSENT';
                    } else {
                        $nombre = strtok((string) ($clientes[$cid]->full_name ?? ''), ' ');
                        $m = S::whatsapp()->enviar(['customer_id' => $cid, 'brand_id' => $c->brand_id, 'channel_id' => $c->channel_id, 'kind' => 'MARKETING', 'template' => $t->name,
                            'text' => str_replace(['{{1}}', '{{2}}'], [$nombre, $cupon], (string) $t->body), 'ref' => $c->code, 'cost' => self::tarifa()]);
                        $fila = ['status' => 'SENT', 'sent_at' => now(), 'message_cost' => self::tarifa(), 'provider_message_id' => $m['provider_message_id']] + $fila;
                        $real += self::tarifa() + self::comision();
                        $env++;
                    }
                }
                DB::table('campaign_recipients')->insert($fila);
            }
            $e = $p['estimate'];
            DB::table('campaigns')->where('id', $id)->update([
                'status' => 'SENT', 'sent_at' => now(), 'actual_cost' => S::r($real), 'target_count' => $e['target'], 'control_count' => $e['control'],
                'excluded_consent_count' => $e['excluded_consent'], 'excluded_frequency_count' => $e['excluded_frequency'], 'effective_count' => $e['effective'],
                'history' => self::historia($c, 'SENT', null, $quien), 'updated_at' => now(),
            ]);
            Events::emit('campaign.sent', 'campaigns', $id, ['code' => $c->code, 'sent' => $env, 'actual_cost' => S::r($real)]);

            return ['sent' => $env, 'actual_cost' => S::r($real), 'estimate' => $e];
        });
    }

    /* ------------------------------------------------------------ atribución y resultados */

    private static function cobradoSinIgv(object $o): float
    {
        $total = (float) ($o->final_total ?? $o->estimated_total ?? 0);

        return S::r(min((float) ($o->paid_amount ?? 0), $total) / (1 + self::igv()));
    }

    /** RN-CMP-15: un pedido se atribuye a una sola campaña: la del cupón usado o la del último mensaje entregado en la ventana. */
    public static function atribuir(string $orderId): ?object
    {
        $o = DB::table('sales_orders')->where('id', $orderId)->first();
        if (! $o || ! $o->customer_id || in_array($o->status, ['DRAFT', 'CANCELLED'], true)) {
            return null;
        }
        if ($a = DB::table('campaign_attributions')->where('order_id', $o->id)->first()) {
            $monto = self::cobradoSinIgv($o);
            if (abs((float) $a->collected_amount - $monto) > 0.004) {
                DB::table('campaign_attributions')->where('id', $a->id)->update(['collected_amount' => $monto, 'updated_at' => now()]);
            }

            return DB::table('campaign_attributions')->where('id', $a->id)->first();
        }
        $red = DB::table('coupon_redemptions')->where('order_id', $o->id)->where('status', 'APPLIED')->first();
        $camp = null;
        $regla = null;
        $rec = null;
        if ($red && ($cid = DB::table('coupons')->where('id', $red->coupon_id)->value('campaign_id'))) {
            $camp = DB::table('campaigns')->where('id', $cid)->first();
            $regla = 'COUPON';
            $rec = DB::table('campaign_recipients')->where('campaign_id', $cid)->where('customer_id', $o->customer_id)->first();
        }
        if (! $camp) {
            $en = $o->confirmed_at ?? $o->created_at;
            $rec = DB::table('campaign_recipients as r')->join('campaigns as c', 'c.id', '=', 'r.campaign_id')->where('r.customer_id', $o->customer_id)
                ->where('r.is_control', false)->whereRaw('coalesce(r.delivered_at, r.sent_at) <= ?', [$en])
                ->whereRaw("(?::timestamptz AT TIME ZONE 'America/Lima')::date - (coalesce(r.delivered_at, r.sent_at) AT TIME ZONE 'America/Lima')::date <= c.attribution_window_days", [$en])
                ->whereNotIn('r.status', ['FAILED', 'SKIPPED_CONSENT', 'SKIPPED_FREQUENCY', 'QUEUED'])
                ->orderByRaw('coalesce(r.delivered_at, r.sent_at) DESC')->first(['r.*']);
            if ($rec) {
                $camp = DB::table('campaigns')->where('id', $rec->campaign_id)->first();
                $regla = 'WINDOW';
            }
        }
        if (! $camp) {
            return null;
        }
        $id = DB::table('campaign_attributions')->insertGetId([
            'campaign_id' => $camp->id, 'recipient_id' => $rec->id ?? null, 'order_id' => $o->id, 'customer_id' => $o->customer_id, 'rule' => $regla,
            'collected_amount' => self::cobradoSinIgv($o), 'discount_amount' => $red ? (float) $red->discount_amount : 0, 'attributed_at' => now(),
        ], 'id');

        return DB::table('campaign_attributions')->where('id', $id)->first();
    }

    /** Atribuye los pedidos de los últimos días a las campañas enviadas (lo corre la tarea diaria). */
    public static function atribuirRecientes(int $dias = 60): int
    {
        $desde = now()->subDays($dias);
        $clientes = DB::table('campaign_recipients')->where('is_control', false)->whereNotNull('sent_at')->where('sent_at', '>=', $desde)->distinct()->pluck('customer_id');
        $n = 0;
        foreach (DB::table('sales_orders')->whereIn('customer_id', $clientes)->where('created_at', '>=', $desde)->whereNotIn('status', ['DRAFT', 'CANCELLED'])->pluck('id') as $oid) {
            self::atribuir($oid) && $n++;
        }

        return $n;
    }

    public static function roi(float $cobrado, float $costo): ?float
    {
        return $costo > 0 ? S::r(($cobrado - $costo) / $costo, 2) : null;
    }

    /** CMP-06: resultados con lo cobrado (no lo pedido) e incremento frente al grupo de control. */
    public static function resultados(object $c): array
    {
        $recs = DB::table('campaign_recipients')->where('campaign_id', $c->id)->get();
        $atts = DB::table('campaign_attributions')->where('campaign_id', $c->id)->get();
        $env = $recs->filter(fn ($x) => ! $x->is_control && $x->sent_at);
        $entregados = $env->filter(fn ($x) => in_array($x->status, ['DELIVERED', 'READ', 'REPLIED'], true));
        $leidos = $env->filter(fn ($x) => in_array($x->status, ['READ', 'REPLIED'], true))->count();
        $resp = $env->where('status', 'REPLIED')->count();
        $bajas = $recs->where('opted_out', true)->count();
        $cobrado = S::r($atts->sum('collected_amount'));
        $desc = S::r($atts->sum('discount_amount'));
        $mensajes = $c->actual_cost !== null ? S::r($c->actual_cost) : S::r($entregados->count() * self::tarifa());
        $total = S::r($mensajes + $desc);
        $ventana = (int) ($c->attribution_window_days ?: 7);
        $compraron = [];
        if ($c->sent_at) {
            $hasta = S::masDias(S::fecha($c->sent_at), $ventana);
            $compraron = DB::table('sales_orders')->whereIn('customer_id', $recs->pluck('customer_id'))->whereNotIn('status', ['DRAFT', 'CANCELLED'])
                ->whereRaw('coalesce(confirmed_at, created_at) > ?', [$c->sent_at])->whereRaw("(coalesce(confirmed_at, created_at) AT TIME ZONE 'America/Lima')::date <= ?", [$hasta])
                ->distinct()->pluck('customer_id')->flip()->all();
        }
        $ctrl = $recs->where('is_control', true);
        $tasaD = $entregados->count() ? S::r($entregados->filter(fn ($x) => isset($compraron[$x->customer_id]))->count() / $entregados->count() * 100, 1) : 0.0;
        $tasaC = $ctrl->count() ? S::r($ctrl->filter(fn ($x) => isset($compraron[$x->customer_id]))->count() / $ctrl->count() * 100, 1) : 0.0;
        $canjes = $c->coupon_id ? DB::table('coupon_redemptions')->where('coupon_id', $c->coupon_id)->where('status', 'APPLIED')->count() : 0;

        return ['sent' => $env->count(), 'delivered' => $entregados->count(), 'read' => $leidos, 'replied' => $resp, 'optouts' => $bajas,
            'orders' => $atts->count(), 'paid_orders' => $atts->filter(fn ($a) => (float) $a->collected_amount > 0)->count(), 'by_coupon' => $atts->where('rule', 'COUPON')->count(),
            'collected' => $cobrado, 'discounts' => $desc, 'message_cost' => $mensajes, 'total_cost' => $total, 'roi' => self::roi($cobrado, $total),
            'buy_rate' => $tasaD, 'control_rate' => $tasaC, 'lift' => S::r($tasaD - $tasaC, 1), 'control' => $ctrl->count(),
            'window_end' => $c->sent_at ? S::masDias(S::fecha($c->sent_at), $ventana) : null, 'redemptions' => $canjes,
            'cost_per_order' => $atts->count() ? S::r($total / $atts->count()) : null,
            'optout_rate' => $entregados->count() ? S::r($bajas / $entregados->count() * 100, 2) : 0.0];
    }

    /** CMP-13: campañas del mes por marca y clientes que recibirían dos o más en la misma semana. */
    public static function calendario(string $mes): array
    {
        $desde = $mes.'-01';
        $hasta = \Carbon\CarbonImmutable::parse($desde)->endOfMonth()->toDateString();
        $rows = DB::table('campaigns as c')->join('brands as b', 'b.id', '=', 'c.brand_id')->leftJoin('customer_segments as s', 's.id', '=', 'c.segment_id')
            ->where('c.status', '<>', 'CANCELLED')
            ->whereRaw("(coalesce(c.sent_at, c.scheduled_at, c.created_at) AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$desde, $hasta])
            ->orderByRaw('coalesce(c.sent_at, c.scheduled_at, c.created_at)')
            ->get(['c.id', 'c.code', 'c.name', 'c.status', 'c.brand_id', 'b.name as brand_name', 'c.segment_id', 's.code as segment_code', 'c.effective_count',
                DB::raw("(coalesce(c.sent_at, c.scheduled_at, c.created_at) AT TIME ZONE 'America/Lima')::date AS day")]);
        // Superposición: mismos clientes en campañas de la misma semana.
        $porSemana = [];
        foreach ($rows as $r) {
            $porSemana[\Carbon\CarbonImmutable::parse($r->day)->format('o-W')][] = $r;
        }
        $choques = [];
        foreach ($porSemana as $sem => $cs) {
            if (count($cs) < 2) {
                continue;
            }
            $segs = array_values(array_unique(array_filter(array_map(fn ($x) => $x->segment_id, $cs))));
            if (count($segs) < 2) {
                $comunes = count($segs) ? DB::table('customer_segment_members')->where('segment_id', $segs[0])->count() : 0;
            } else {
                $comunes = DB::table('customer_segment_members')->whereIn('segment_id', $segs)->groupBy('customer_id')->havingRaw('count(DISTINCT segment_id) >= 2')->get(['customer_id'])->count();
            }
            $comunes && $choques[] = ['week' => $sem, 'campaigns' => array_map(fn ($x) => $x->code, $cs), 'customers' => $comunes];
        }

        return ['data' => $rows, 'overlaps' => $choques, 'max_per_week' => (int) S::num('cmp_max_marketing_per_week', 2)];
    }
}
