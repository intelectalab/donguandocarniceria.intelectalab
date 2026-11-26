<?php

namespace App\Modulos\Cmp\Services;

use App\Models\User;
use App\Modulos\Canales\Soporte as S;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * CMP-01, 02, 11 y 12: estadísticas de compra por cliente (RFM), segmentos con reglas (RN-CMP-01),
 * consentimiento por marca (RN-CMP-03), bajas por palabra clave (RN-CMP-04), tope semanal (RN-CMP-05) y
 * recompra esperada. El registro de consentimientos es el de CRM (contact_consents), con la marca.
 */
final class Audiencia
{
    public const RFM = ['CHAMPION' => 'Campeones', 'LOYAL' => 'Leales', 'POTENTIAL' => 'Prometedores', 'NEW' => 'Nuevos', 'AT_RISK' => 'En riesgo', 'DORMANT' => 'Dormidos'];

    private static array $cache = [];

    public static function olvidar(): void
    {
        self::$cache = [];
    }

    /* ------------------------------------------------------------ estadísticas de compra */

    /** @return array<string, array> por cliente: n, spent, avg, first, last, recency, brands, byBrand, zones, channels, products, lines, rfm */
    public static function estadisticas(?string $hoy = null): array
    {
        $hoy = S::fecha($hoy);
        $k = 'st:'.$hoy.':'.DB::table('sales_orders')->count();
        if (isset(self::$cache[$k])) {
            return self::$cache[$k];
        }
        $fecha = "(o.created_at AT TIME ZONE 'America/Lima')::date";
        $base = fn () => DB::table('sales_orders as o')->whereNotIn('o.status', ['DRAFT', 'CANCELLED'])->whereNotNull('o.customer_id')->whereRaw("{$fecha} <= ?", [$hoy]);
        $st = [];
        foreach ($base()->groupBy('o.customer_id')->get([
            'o.customer_id', DB::raw('count(*) AS n'), DB::raw('sum(coalesce(o.final_total, o.estimated_total)) AS spent'),
            DB::raw("min({$fecha}) AS first"), DB::raw("max({$fecha}) AS last"),
            DB::raw("array_to_json(array_agg(DISTINCT o.zone_id) FILTER (WHERE o.zone_id IS NOT NULL)) AS zones"),
            DB::raw('array_to_json(array_agg(DISTINCT o.channel)) AS channels'),
        ]) as $r) {
            $st[$r->customer_id] = ['id' => $r->customer_id, 'n' => (int) $r->n, 'spent' => S::r($r->spent), 'avg' => S::r((float) $r->spent / max(1, (int) $r->n)),
                'first' => $r->first, 'last' => $r->last, 'recency' => S::dias($r->last, $hoy), 'zones' => json_decode($r->zones ?? '[]', true) ?: [],
                'channels' => json_decode($r->channels ?? '[]', true) ?: [], 'byBrand' => [], 'products' => [], 'lines' => []];
        }
        foreach ($base()->groupBy('o.customer_id', 'o.brand_id')->get(['o.customer_id', 'o.brand_id', DB::raw("max({$fecha}) AS last")]) as $r) {
            $st[$r->customer_id]['byBrand'][$r->brand_id] = $r->last;
        }
        foreach ($base()->join('sales_order_lines as l', 'l.sales_order_id', '=', 'o.id')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->join('products as p', 'p.id', '=', 'v.product_id')
            ->groupBy('o.customer_id', 'v.product_id', 'p.line')->get(['o.customer_id', 'v.product_id', 'p.line', DB::raw("array_to_json(array_agg(DISTINCT {$fecha} ORDER BY {$fecha})) AS dates")]) as $r) {
            $st[$r->customer_id]['products'][$r->product_id] = json_decode($r->dates, true);
            if ($r->line) {
                $st[$r->customer_id]['lines'][$r->line] = true;
            }
        }
        // RFM por quintiles, como el prototipo.
        $rs = array_column($st, 'recency');
        $fs = array_column($st, 'n');
        $ms = array_column($st, 'spent');
        sort($rs);
        sort($fs);
        sort($ms);
        $q = function (array $arr, $v, bool $inv) {
            $pos = count($arr);
            foreach ($arr as $i => $x) {
                if ($x >= $v) {
                    $pos = $i;
                    break;
                }
            }
            $sc = min(5, 1 + (int) floor($pos / max(1, count($arr)) * 5));

            return $inv ? 6 - $sc : $sc;
        };
        foreach ($st as &$s) {
            $s['r'] = $q($rs, $s['recency'], true);
            $s['f'] = $q($fs, $s['n'], false);
            $s['m'] = $q($ms, $s['spent'], false);
            $s['rfm'] = $s['r'] >= 4 && $s['f'] >= 4 ? 'CHAMPION' : ($s['f'] >= 4 ? 'LOYAL' : ($s['n'] === 1 && $s['r'] >= 4 ? 'NEW'
                : ($s['r'] <= 2 && $s['f'] >= 3 ? 'AT_RISK' : ($s['r'] <= 2 ? 'DORMANT' : 'POTENTIAL'))));
        }
        unset($s);

        return self::$cache[$k] = $st;
    }

    private static function mediana(array $a): ?float
    {
        if (! $a) {
            return null;
        }
        sort($a);
        $m = intdiv(count($a), 2);

        return count($a) % 2 ? $a[$m] : ($a[$m - 1] + $a[$m]) / 2;
    }

    /** CMP-12: clientes que pasaron su intervalo habitual de recompra de un producto (el suyo o, si no tiene, el del producto). */
    public static function recompra(?string $hoy = null): array
    {
        $hoy = S::fecha($hoy);
        $st = self::estadisticas($hoy);
        $gaps = [];
        foreach ($st as $s) {
            foreach ($s['products'] as $pid => $ds) {
                for ($i = 1; $i < count($ds); $i++) {
                    $g = S::dias($ds[$i - 1], $ds[$i]);
                    $g >= 1 && $gaps[$pid][] = $g;
                }
            }
        }
        $intervalo = [];
        foreach ($gaps as $pid => $g) {
            count($g) >= 3 && $intervalo[$pid] = (int) round(self::mediana($g));
        }
        $productos = DB::table('products')->whereIn('id', array_keys($intervalo) ?: ['00000000-0000-0000-0000-000000000000'])->get(['id', 'name', 'brand_id'])->keyBy('id');
        $zonas = DB::table('customer_addresses')->where('is_default', true)->pluck('zone_id', 'customer_id');
        $out = [];
        foreach ($st as $s) {
            foreach ($s['products'] as $pid => $ds) {
                if (! isset($intervalo[$pid])) {
                    continue;
                }
                $propios = [];
                for ($i = 1; $i < count($ds); $i++) {
                    $g = S::dias($ds[$i - 1], $ds[$i]);
                    $g >= 1 && $propios[] = $g;
                }
                $int = $propios ? (int) round(self::mediana($propios)) : $intervalo[$pid];
                $ultima = end($ds);
                $proxima = S::masDias($ultima, $int);
                $pasado = S::dias($proxima, $hoy);
                if ($pasado <= 0) {
                    continue;
                }
                $p = $productos[$pid] ?? null;
                $out[] = ['customer_id' => $s['id'], 'product_id' => $pid, 'product_name' => $p->name ?? null, 'brand_id' => $p->brand_id ?? null,
                    'zone_id' => $zonas[$s['id']] ?? ($s['zones'][0] ?? null), 'last' => $ultima, 'interval' => $int, 'own' => (bool) $propios,
                    'next' => $proxima, 'over' => $pasado, 'status' => $pasado > $int ? 'AT_RISK' : 'DUE', 'purchases' => count($ds)];
            }
        }

        return $out;
    }

    /* ------------------------------------------------------------ consentimiento y frecuencia */

    /** Último registro de marketing por cliente (de la marca o de todas). Sin registro vale customers.marketing_opt_in. */
    public static function consentimientos(?string $brandId, array $clientes = []): array
    {
        $rows = DB::table('contact_consents')->where('purpose', 'MARKETING')->where(fn ($q) => $q->whereNull('channel')->orWhere('channel', 'WHATSAPP'))
            ->when($brandId, fn ($q, $b) => $q->where(fn ($w) => $w->whereNull('brand_id')->orWhere('brand_id', $b)))
            ->when($clientes, fn ($q) => $q->whereIn('customer_id', $clientes))
            ->orderBy('recorded_at')->orderBy('created_at')->get(['customer_id', 'granted']);
        $m = [];
        foreach ($rows as $r) {
            $m[$r->customer_id] = (bool) $r->granted;
        }
        $faltan = DB::table('customers')->when($clientes, fn ($q) => $q->whereIn('id', $clientes))->pluck('marketing_opt_in', 'id');
        foreach ($faltan as $id => $opt) {
            $m[$id] ??= (bool) $opt;
        }

        return $m;
    }

    public static function tieneConsentimiento(string $customerId, ?string $brandId): bool
    {
        return self::consentimientos($brandId, [$customerId])[$customerId] ?? false;
    }

    /** Mensajes de marketing que recibió cada cliente en los 7 días que terminan en la fecha (todas las marcas). */
    public static function enLaSemana(?string $fecha = null, array $clientes = []): array
    {
        $f = S::fecha($fecha);

        return DB::table('messages')->where('kind', 'MARKETING')->where('direction', '<>', 'IN')->where('status', '<>', 'FAILED')
            ->whereRaw("(coalesce(sent_at, created_at) AT TIME ZONE 'America/Lima')::date BETWEEN ?::date - 6 AND ?::date", [$f, $f])
            ->when($clientes, fn ($q) => $q->whereIn('customer_id', $clientes))->groupBy('customer_id')->selectRaw('customer_id, count(*) AS n')->pluck('n', 'customer_id')->map(fn ($n) => (int) $n)->all();
    }

    private static function normalizar(string $s): string
    {
        $s = strtoupper(\Normalizer::normalize($s, \Normalizer::FORM_D) ?: $s);
        $s = preg_replace('/[^A-Z ]/', ' ', preg_replace('/\p{Mn}/u', '', $s));

        return trim(preg_replace('/\s+/', ' ', $s));
    }

    public static function esBaja(string $texto): bool
    {
        $t = self::normalizar($texto);
        $claves = json_decode(S::texto('cmp_optout_keywords', '["BAJA","STOP","NO QUIERO"]'), true) ?: ['BAJA', 'STOP', 'NO QUIERO'];
        foreach ($claves as $k) {
            $k = self::normalizar($k);
            if ($t === $k || str_starts_with($t, $k.' ')) {
                return true;
            }
        }

        return false;
    }

    /**
     * RN-CMP-04: mensaje entrante al número de una marca. Si es palabra de baja, registra la baja de esa marca al instante,
     * la atribuye a la última campaña que recibió el cliente y la confirma por WhatsApp.
     */
    public static function entrante(array $d): array
    {
        return DB::transaction(function () use ($d) {
            $c = DB::table('customers')->where('id', $d['customer_id'] ?? null)->first() ?? RuleError::fail('RN-CMP-04', 'Cliente no encontrado.');
            $marca = $d['brand_id'] ?? null;
            $texto = (string) ($d['text'] ?? '');
            $canal = DB::table('messaging_channels')->where('kind', 'WHATSAPP')->where('brand_id', $marca)->value('id');
            DB::table('messages')->insert(['customer_id' => $c->id, 'channel_id' => $canal, 'direction' => 'IN', 'kind' => 'SESSION', 'text' => $texto, 'sent_at' => now(), 'status' => 'RECEIVED', 'cost' => 0]);
            if (! self::esBaja($texto)) {
                return ['optout' => false];
            }
            $camp = ! empty($d['campaign_id']) ? DB::table('campaigns')->where('id', $d['campaign_id'])->first() : self::ultimaCampana($c->id, $marca);
            $id = DB::table('contact_consents')->insertGetId([
                'customer_id' => $c->id, 'purpose' => 'MARKETING', 'granted' => false, 'channel' => 'WHATSAPP', 'brand_id' => $marca,
                'evidence_text' => 'Escribió «'.mb_substr($texto, 0, 60).'» al número de '.(DB::table('brands')->where('id', $marca)->value('name') ?? 'la marca'),
                'recorded_at' => now(), 'source' => 'KEYWORD',
            ], 'id');
            if ($camp) {
                DB::table('campaign_recipients')->where('campaign_id', $camp->id)->where('customer_id', $c->id)->update(['opted_out' => true, 'updated_at' => now()]);
            }
            S::whatsapp()->enviar(['customer_id' => $c->id, 'brand_id' => $marca, 'channel_id' => $canal, 'kind' => 'SESSION', 'template' => 'confirmacion_baja',
                'text' => 'Listo, '.strtok((string) $c->full_name, ' ').': ya no te enviaremos promociones de '.(DB::table('brands')->where('id', $marca)->value('name') ?? 'esta marca').'. Si cambias de opinión, escribe ALTA.', 'ref' => 'CMP-BAJA', 'cost' => 0]);
            Events::emit('consent.opted_out', 'contact_consents', $id, ['customer_id' => $c->id, 'brand_id' => $marca, 'campaign_id' => $camp->id ?? null, 'source' => 'CMP']);
            self::olvidar();

            return ['optout' => true, 'consent_id' => $id, 'campaign_id' => $camp->id ?? null];
        });
    }

    public static function ultimaCampana(string $customerId, ?string $brandId): ?object
    {
        return DB::table('campaign_recipients as r')->join('campaigns as c', 'c.id', '=', 'r.campaign_id')->where('r.customer_id', $customerId)
            ->where('r.is_control', false)->whereNotNull('r.sent_at')->when($brandId, fn ($q, $b) => $q->where('c.brand_id', $b))
            ->orderByDesc('r.sent_at')->first(['c.*']);
    }

    /** CMP-11: consentimiento o baja manual, con evidencia. */
    public static function registrarConsentimiento(array $d, User $quien): object
    {
        $ev = S::motivo($d['evidence'] ?? null, 'RN-CMP-03', 'Indica la evidencia del consentimiento o de la baja (mensaje, formulario o llamada).');
        DB::table('customers')->where('id', $d['customer_id'] ?? null)->exists() || abort(404);
        $id = DB::table('contact_consents')->insertGetId([
            'customer_id' => $d['customer_id'], 'purpose' => 'MARKETING', 'granted' => (bool) ($d['granted'] ?? false), 'channel' => 'WHATSAPP',
            'brand_id' => $d['brand_id'] ?? null, 'evidence_text' => mb_substr($ev, 0, 500), 'recorded_at' => now(), 'source' => 'MANUAL', 'recorded_by' => $quien->id,
        ], 'id');
        if (empty($d['granted'])) {
            Events::emit('consent.opted_out', 'contact_consents', $id, ['customer_id' => $d['customer_id'], 'brand_id' => $d['brand_id'] ?? null, 'source' => 'CMP']);
        }
        self::olvidar();

        return DB::table('contact_consents')->where('id', $id)->first();
    }

    /* ------------------------------------------------------------ segmentos */

    /** Clientes que entran a la campaña: activos, con celular y que no son «varios». */
    private static function universo()
    {
        return DB::table('customers')->where('status', 'ACTIVE')->whereNotNull('phone')->where('phone', '<>', '')
            ->whereNotIn('customer_type', ['OTHER'])->get(['id', 'customer_type', 'source_channel']);
    }

    /** @return string[] ids de clientes que cumplen las reglas */
    public static function evaluar(array $r, ?string $hoy = null): array
    {
        $hoy = S::fecha($hoy);
        $st = self::estadisticas($hoy);
        $marcas = array_values(array_filter((array) ($r['brands'] ?? [])));
        $vence = null;
        if (! empty($r['rebuy_product']) || ! empty($r['rebuy_due'])) {
            $vence = [];
            foreach (self::recompra($hoy) as $x) {
                if ((empty($r['rebuy_product']) || $x['product_id'] === $r['rebuy_product']) && (! $marcas || in_array($x['brand_id'], $marcas, true))) {
                    $vence[$x['customer_id']] = true;
                }
            }
        }
        $inactivo = (int) S::num('cmp_inactive_days', 60);
        $zonaPorDefecto = DB::table('customer_addresses')->where('is_default', true)->pluck('zone_id', 'customer_id');
        $out = [];
        foreach (self::universo() as $c) {
            $s = $st[$c->id] ?? null;
            if (! empty($r['customer_types']) && ! in_array($c->customer_type, $r['customer_types'], true)) {
                continue;
            }
            if (($r['b2b'] ?? null) === 'ONLY' && $c->customer_type === 'PERSON') {
                continue;
            }
            if (($r['b2b'] ?? null) === 'EXCLUDE' && $c->customer_type !== 'PERSON') {
                continue;
            }
            if (! empty($r['never_bought'])) {
                $s || $out[] = $c->id;

                continue;
            }
            if (! $s) {
                continue;
            }
            if ($marcas && ! array_intersect($marcas, array_keys($s['byBrand']))) {
                continue;
            }
            $rec = count($marcas) === 1 && isset($s['byBrand'][$marcas[0]]) ? S::dias($s['byBrand'][$marcas[0]], $hoy) : $s['recency'];
            $lp = $r['last_purchase_days'] ?? null;
            if ($lp) {
                if (isset($lp['min']) && $lp['min'] !== '' && $lp['min'] !== null && $rec < (int) $lp['min']) {
                    continue;
                }
                if (isset($lp['max']) && $lp['max'] !== '' && $lp['max'] !== null && $rec > (int) $lp['max']) {
                    continue;
                }
            }
            if (! empty($r['inactive']) && $rec < $inactivo) {
                continue;
            }
            if (! empty($r['zones']) && ! in_array($zonaPorDefecto[$c->id] ?? null, $r['zones'], true) && ! array_intersect($r['zones'], $s['zones'])) {
                continue;
            }
            if (! empty($r['products']) && ! array_intersect($r['products'], array_keys($s['products']))) {
                continue;
            }
            if (! empty($r['lines']) && ! array_intersect($r['lines'], array_keys($s['lines']))) {
                continue;
            }
            if (! empty($r['channels']) && ! array_intersect($r['channels'], $s['channels']) && ! in_array($c->source_channel, $r['channels'], true)) {
                continue;
            }
            if (! empty($r['min_avg_ticket']) && $s['avg'] < (float) $r['min_avg_ticket']) {
                continue;
            }
            if (! empty($r['min_orders']) && $s['n'] < (int) $r['min_orders']) {
                continue;
            }
            if (! empty($r['rfm']) && ! in_array($s['rfm'], $r['rfm'], true)) {
                continue;
            }
            if ($vence !== null && ! isset($vence[$c->id])) {
                continue;
            }
            $out[] = $c->id;
        }

        return $out;
    }

    /** Descripción legible de las reglas. */
    public static function describir(array $r): string
    {
        $nom = fn (string $t, array $ids) => DB::table($t)->whereIn('id', $ids)->pluck('name')->implode(', ');
        $p = [];
        ! empty($r['brands']) && $p[] = 'compró '.str_replace(', ', ' o ', $nom('brands', $r['brands']));
        $lp = $r['last_purchase_days'] ?? null;
        if ($lp && (($lp['min'] ?? null) || ($lp['max'] ?? null))) {
            $p[] = 'última compra hace '.($lp['min'] ?? 0).'–'.(($lp['max'] ?? null) ?: '∞').' días';
        }
        ! empty($r['inactive']) && $p[] = 'inactivo ('.(int) S::num('cmp_inactive_days', 60).' días o más sin comprar)';
        ! empty($r['never_bought']) && $p[] = 'nunca compró';
        if (! empty($r['rebuy_product'])) {
            $p[] = 'recompra vencida de '.(DB::table('products')->where('id', $r['rebuy_product'])->value('name') ?? 'un producto');
        } elseif (! empty($r['rebuy_due'])) {
            $p[] = 'con alguna recompra vencida';
        }
        ! empty($r['products']) && $p[] = 'compró '.$nom('products', $r['products']);
        ! empty($r['lines']) && $p[] = 'línea '.implode(', ', $r['lines']);
        ! empty($r['zones']) && $p[] = 'zona '.$nom('delivery_zones', $r['zones']);
        ! empty($r['channels']) && $p[] = 'canal '.implode(', ', $r['channels']);
        ! empty($r['min_avg_ticket']) && $p[] = 'ticket promedio desde '.S::soles($r['min_avg_ticket']);
        ! empty($r['min_orders']) && $p[] = "{$r['min_orders']} pedidos o más";
        ! empty($r['rfm']) && $p[] = 'grupo: '.implode(', ', array_map(fn ($x) => self::RFM[$x] ?? $x, $r['rfm']));
        ($r['b2b'] ?? null) === 'ONLY' && $p[] = 'solo clientes empresa';
        ($r['b2b'] ?? null) === 'EXCLUDE' && $p[] = 'solo personas';

        return $p ? implode(' · ', $p) : 'Todos los clientes con celular';
    }

    public static function miembros(string $segmentId): array
    {
        return DB::table('customer_segment_members')->where('segment_id', $segmentId)->pluck('customer_id')->all();
    }

    /** RN-CMP-01: dinámico = se recalcula con sus reglas; estático = conserva su lista. */
    public static function refrescar(string|object $seg, ?string $hoy = null): array
    {
        $seg = is_string($seg) ? (DB::table('customer_segments')->where('id', $seg)->first() ?? abort(404)) : $seg;
        if ($seg->segment_type === 'STATIC') {
            $ids = self::miembros($seg->id);
        } else {
            $ids = self::evaluar(json_decode($seg->rules ?? '{}', true) ?: [], $hoy);
            DB::table('customer_segment_members')->where('segment_id', $seg->id)->whereNotIn('customer_id', $ids ?: ['00000000-0000-0000-0000-000000000000'])->delete();
            $ya = array_flip(self::miembros($seg->id));
            $nuevos = array_values(array_filter($ids, fn ($i) => ! isset($ya[$i])));
            foreach (array_chunk($nuevos, 500) as $lote) {
                DB::table('customer_segment_members')->insert(array_map(fn ($i) => ['segment_id' => $seg->id, 'customer_id' => $i, 'added_at' => now()], $lote));
            }
        }
        $cons = self::consentimientos($seg->brand_id, $ids);
        DB::table('customer_segments')->where('id', $seg->id)->update(['member_count' => count($ids), 'consent_count' => count(array_filter($ids, fn ($i) => $cons[$i] ?? false)),
            'last_refreshed_at' => now(), 'updated_at' => now()]);

        return $ids;
    }

    /** Segmentos dinámicos que pasaron su intervalo de actualización. */
    public static function refrescarVencidos(): int
    {
        $n = 0;
        foreach (DB::table('customer_segments')->where('status', 'ACTIVE')->where('segment_type', 'DYNAMIC')->get() as $s) {
            $horas = (int) ($s->refresh_hours ?: S::num('cmp_segment_refresh_hours', 24));
            if (! $s->last_refreshed_at || strtotime($s->last_refreshed_at) <= now()->subHours($horas)->timestamp) {
                self::refrescar($s);
                $n++;
            }
        }

        return $n;
    }

    public static function guardarSegmento(array $d, ?string $id, User $quien): object
    {
        return S::base(fn () => DB::transaction(function () use ($d, $id, $quien) {
            $code = strtoupper(trim((string) ($d['code'] ?? '')));
            $nombre = trim((string) ($d['name'] ?? ''));
            ($code !== '' && $nombre !== '') || RuleError::fail('RN-CMP-01', 'El segmento necesita código y nombre.');
            preg_match('/^[A-Z0-9-]{3,30}$/', $code) || RuleError::fail('RN-CMP-01', 'El código va en mayúsculas, con letras, números o guiones.');
            DB::table('customer_segments')->where('code', $code)->when($id, fn ($q) => $q->where('id', '<>', $id))->exists()
                && RuleError::fail('RN-CMP-01', "Ya existe un segmento con el código {$code}.");
            $tipo = $d['segment_type'] ?? 'DYNAMIC';
            $fila = ['code' => $code, 'name' => mb_substr($nombre, 0, 255), 'brand_id' => $d['brand_id'] ?? null, 'segment_type' => $tipo,
                'rules' => json_encode($tipo === 'STATIC' ? [] : (object) self::limpiar($d['rules'] ?? []), JSON_UNESCAPED_UNICODE),
                'refresh_hours' => (int) ($d['refresh_hours'] ?? S::num('cmp_segment_refresh_hours', 24)), 'status' => $d['status'] ?? 'ACTIVE', 'updated_at' => now()];
            if ($id) {
                DB::table('customer_segments')->where('id', $id)->update($fila);
            } else {
                $id = DB::table('customer_segments')->insertGetId($fila + ['created_by_user' => $quien->id, 'member_count' => 0, 'consent_count' => 0], 'id');
            }
            if ($tipo === 'STATIC' && isset($d['static_ids'])) {
                $ids = array_values(array_unique(array_filter((array) $d['static_ids'])));
                DB::table('customer_segment_members')->where('segment_id', $id)->delete();
                foreach (array_chunk(DB::table('customers')->whereIn('id', $ids ?: ['00000000-0000-0000-0000-000000000000'])->pluck('id')->all(), 500) as $lote) {
                    DB::table('customer_segment_members')->insert(array_map(fn ($i) => ['segment_id' => $id, 'customer_id' => $i, 'added_at' => now()], $lote));
                }
            }
            self::refrescar($id);

            return DB::table('customer_segments')->where('id', $id)->first();
        }));
    }

    /** Deja solo las reglas conocidas y sin valores vacíos. */
    public static function limpiar(array $r): array
    {
        $ok = ['brands', 'last_purchase_days', 'inactive', 'never_bought', 'rebuy_product', 'rebuy_due', 'products', 'lines', 'zones', 'channels', 'min_avg_ticket', 'min_orders', 'rfm', 'b2b', 'customer_types'];
        $out = [];
        foreach ($ok as $k) {
            $v = $r[$k] ?? null;
            if ($v === null || $v === '' || $v === false || $v === []) {
                continue;
            }
            if ($k === 'last_purchase_days') {
                $v = ['min' => isset($v['min']) && $v['min'] !== '' ? (int) $v['min'] : null, 'max' => isset($v['max']) && $v['max'] !== '' ? (int) $v['max'] : null];
                if ($v['min'] === null && $v['max'] === null) {
                    continue;
                }
            }
            $out[$k] = $v;
        }

        return $out;
    }

    /** CMP-02: vista previa sin guardar. */
    public static function vistaPrevia(array $reglas, ?string $brandId): array
    {
        $ids = self::evaluar(self::limpiar($reglas));
        $cons = self::consentimientos($brandId, $ids);
        $st = self::estadisticas();
        $muestra = DB::table('customers')->whereIn('id', array_slice($ids, 0, 12) ?: ['00000000-0000-0000-0000-000000000000'])->get(['id', 'full_name', 'customer_type'])
            ->map(fn ($c) => ['id' => $c->id, 'full_name' => $c->full_name, 'last' => $st[$c->id]['last'] ?? null, 'n' => $st[$c->id]['n'] ?? 0,
                'rfm' => $st[$c->id]['rfm'] ?? null, 'consent' => $cons[$c->id] ?? false]);

        return ['size' => count($ids), 'consent' => count(array_filter($ids, fn ($i) => $cons[$i] ?? false)), 'description' => self::describir(self::limpiar($reglas)), 'sample' => $muestra];
    }
}
