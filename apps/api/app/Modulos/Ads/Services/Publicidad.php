<?php

namespace App\Modulos\Ads\Services;

use App\Models\User;
use App\Modulos\Gas\Services\Base as GasBase;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Access;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * ADS · Gasto de anuncios y atribución a ventas cobradas (ADS-01 a ADS-09; RN-ADS-01 a 12; CA-ADS-01 a 07).
 *
 *  - Cuentas publicitarias de Google Ads, Meta Ads y TikTok Ads por marca, con moneda (PEN o USD), zona horaria,
 *    proveedor para la factura y estado de la última importación (ADS-01).
 *  - Campañas y anuncios con destino (WhatsApp, web, TikTok…), número de WhatsApp de la marca, código de rastreo único
 *    (formato XX-XXXX) y parámetros UTM; marca los anuncios activos sin rastreo (ADS-02, RN-ADS-03).
 *  - Enlaces wa.me con el mensaje «Hola, vi el anuncio …» y URL con UTM para cada anuncio (ADS-03).
 *  - Importación diaria del gasto con tipo de cambio de venta del día (MAE) y reemplazo idempotente por campaña, anuncio
 *    y fecha al reimportar un día o rango (ADS-04, RN-ADS-01, RN-ADS-02).
 *  - Resultados por anuncio y campaña con retorno (ROAS) sobre ventas COBRADAS (pagos CONFIRMED aplicados a pedidos
 *    atribuidos no anulados; RN-ADS-07, RN-ADS-09; ADS-05).
 *  - Embudo de atribución (referral de clic a WhatsApp → código en el primer mensaje → UTM → TikTok → heredado del lead
 *    dentro de la ventana de 30 días) y corrección manual con motivo y auditoría (ADS-06, RN-ADS-04, 05 y 06).
 *  - Conciliación de facturas de plataformas frente al gasto importado con tolerancia max(S/ 5, 2 %) y envío a GAS como
 *    gasto con documento FOREIGN_INVOICE (ADS-07, RN-ADS-08).
 *  - Gastos de creadores de contenido (recibo por honorarios con campaña obligatoria) y su peso en el costo de cada
 *    campaña (ADS-08, RN-ADS-10).
 *  - Comparativo de plataformas lado a lado: inversión, ventas cobradas, retorno, inversión sobre ventas del período y
 *    porcentaje de leads por anuncios de clic a WhatsApp (ADS-09, RN-ADS-11, KPI-ADS-06 y 09).
 */
final class Publicidad
{
    public const PLATAFORMAS = [
        'GOOGLE' => 'Google Ads',
        'META' => 'Meta Ads',
        'TIKTOK' => 'TikTok Ads',
    ];

    public const DESTINOS = [
        'WHATSAPP' => 'WhatsApp',
        'WEB' => 'Web (WooCommerce)',
        'TIKTOK_DM' => 'Mensaje de TikTok',
        'MESSENGER' => 'Messenger',
        'INSTAGRAM_DM' => 'Mensaje de Instagram',
        'LEAD_FORM' => 'Formulario',
        'OTHER' => 'Otro',
    ];

    public const METODOS = [
        'CTWA_REFERRAL' => 'Referral de clic a WhatsApp',
        'TRACKING_CODE' => 'Código en el mensaje',
        'UTM' => 'UTM de la web',
        'TIKTOK_DM' => 'Mensaje de TikTok',
        'INHERITED_FROM_LEAD' => 'Heredado del lead',
        'MANUAL' => 'Corrección manual',
        'NONE' => 'Sin atribución',
    ];

    public const ESTADOS_CUENTA = ['ACTIVE' => 'Activa', 'PAUSED' => 'Pausada', 'DISCONNECTED' => 'Desconectada'];

    public const ESTADOS_ANUNCIO = ['ACTIVE' => 'Activo', 'PAUSED' => 'Pausado', 'ENDED' => 'Terminado', 'REMOVED' => 'Eliminado'];

    public const ESTADOS_CORRIDA = ['OK' => 'OK', 'FAILED' => 'Fallida', 'PARTIAL' => 'Parcial', 'RUNNING' => 'En curso'];

    public const ESTADOS_FACTURA = ['PENDING' => 'Pendiente', 'RECONCILED' => 'Conciliada', 'OBSERVED' => 'Observada'];

    public const CANALES_DIGITALES = ['WEB', 'WHATSAPP', 'TIKTOK', 'FACEBOOK', 'INSTAGRAM'];

    public const REGEX_CODIGO = '/^[A-Z0-9]{2,6}-[A-Z0-9]{2,8}$/';

    public static function hoy(): string
    {
        return now('America/Lima')->toDateString();
    }

    /** Tipo de cambio de VENTA del día (RN-ADS-01); si no hay del día, el último anterior; si no, el primero posterior. */
    public static function tcVenta(string $fecha, string $moneda = 'USD'): float
    {
        if ($moneda === '' || $moneda === 'PEN') {
            return 1.0;
        }
        $anterior = DB::table('exchange_rates')->where('currency', $moneda)->where('date', '<=', $fecha)->orderByDesc('date')->value('sell');
        if ($anterior !== null) {
            return (float) $anterior;
        }
        $posterior = DB::table('exchange_rates')->where('currency', $moneda)->where('date', '>', $fecha)->orderBy('date')->value('sell');

        return $posterior !== null ? (float) $posterior : 3.75;
    }

    /** Rango de fechas por defecto: si no se pasa, toma septiembre 2026 si hay gasto allí (datos de demo) o el mes actual. */
    public static function rangoPorDefecto(array $f): array
    {
        if (! empty($f['desde']) && ! empty($f['hasta'])) {
            return [$f['desde'], $f['hasta']];
        }
        $maxFecha = DB::table('ad_spend_daily')->max('spend_date');
        if ($maxFecha && $maxFecha <= '2026-10-31') {
            $desde = $f['desde'] ?? '2026-09-01';
            $hasta = $f['hasta'] ?? '2026-09-30';

            return [$desde, $hasta];
        }
        $hoy = self::hoy();

        return [$f['desde'] ?? substr($hoy, 0, 8).'01', $f['hasta'] ?? $hoy];
    }

    private static function marcasAlcance(User $u): array
    {
        return Access::for($u)['brands'] ?: [];
    }

    private static function marcasMapa(): array
    {
        return DB::table('brands')->orderBy('name')->get(['id', 'code', 'name'])->keyBy('id')->all();
    }

    /** Cobrado por pedido: suma de aplicaciones de pagos CONFIRMED (los revertidos no suman, RN-ADS-07). */
    public static function mapaCobradoPorPedido(array $orderIds = []): array
    {
        $q = DB::table('payment_allocations as a')
            ->join('payments as p', 'p.id', '=', 'a.payment_id')
            ->where('p.status', 'CONFIRMED')
            ->whereNotNull('a.order_id');
        if ($orderIds) {
            $q->whereIn('a.order_id', $orderIds);
        }

        return $q->groupBy('a.order_id')
            ->selectRaw('a.order_id, coalesce(sum(a.amount), 0) as total')
            ->pluck('total', 'order_id')
            ->map(fn ($v) => round((float) $v, 2))
            ->all();
    }

    /** Cobros CONFIRMED totales del período (por fecha de pago), opcionalmente por marca y local (RN-ADS-11). */
    public static function totalCobradoPeriodo(string $desde, string $hasta, ?string $marca = null, array $marcasAlcance = []): float
    {
        $q = DB::table('payments')
            ->where('status', 'CONFIRMED')
            ->whereRaw("(paid_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$desde, $hasta]);
        if ($marca) {
            $q->where('brand_id', $marca);
        } elseif ($marcasAlcance) {
            $q->whereIn('brand_id', $marcasAlcance);
        }

        return round((float) ($q->sum('amount') ?? 0), 2);
    }

    /** Problemas de rastreo de un anuncio activo (RN-ADS-03). */
    public static function problemasRastreo(object $ad, array $canalesWa = [], array $conteoCodigos = []): array
    {
        if ($ad->status !== 'ACTIVE') {
            return [];
        }
        $problemas = [];
        $codigo = trim((string) ($ad->tracking_code ?? ''));
        if (in_array($ad->destination, ['WHATSAPP', 'TIKTOK_DM'], true)) {
            if ($ad->destination === 'WHATSAPP' && empty($ad->channel_id)) {
                $problemas[] = 'sin número de WhatsApp';
            }
            if ($ad->destination === 'WHATSAPP' && ! empty($ad->channel_id) && isset($canalesWa[$ad->channel_id])) {
                if ($canalesWa[$ad->channel_id]->brand_id !== $ad->brand_id) {
                    $problemas[] = 'el número es de otra marca';
                }
            }
            if ($codigo === '' && ! $ad->is_ctwa) {
                $problemas[] = 'sin código de rastreo';
            }
            if ($codigo !== '' && ! preg_match(self::REGEX_CODIGO, strtoupper($codigo))) {
                $problemas[] = 'código con formato inválido';
            }
            if ($codigo !== '' && ($conteoCodigos[strtoupper($codigo)] ?? 0) > 1) {
                $problemas[] = 'código repetido';
            }
        }
        if ($ad->destination === 'WEB' && (trim((string) ($ad->utm_source ?? '')) === '' || trim((string) ($ad->utm_campaign ?? '')) === '')) {
            $problemas[] = 'sin UTM';
        }

        return $problemas;
    }

    public static function enlaceWa(object $ad, ?string $numeroWa): ?string
    {
        $codigo = trim((string) ($ad->tracking_code ?? ''));
        if (! $numeroWa || $codigo === '') {
            return null;
        }
        $limpio = preg_replace('/\D/', '', $numeroWa);

        return "https://wa.me/{$limpio}?text=".rawurlencode("Hola, vi el anuncio {$codigo}");
    }

    public static function urlUtm(object $ad): ?string
    {
        $src = trim((string) ($ad->utm_source ?? ''));
        if ($src === '') {
            return null;
        }
        $base = trim((string) ($ad->landing_url ?? '')) ?: 'https://www.donguando.com/tienda/';
        $params = array_filter([
            'utm_source' => $src,
            'utm_medium' => trim((string) ($ad->utm_medium ?? '')) ?: null,
            'utm_campaign' => trim((string) ($ad->utm_campaign ?? '')) ?: null,
            'utm_content' => trim((string) ($ad->utm_content ?? '')) ?: null,
        ]);

        return $base.(str_contains($base, '?') ? '&' : '?').http_build_query($params);
    }

    /* ------------------------------------------------------------------ ADS-01 Cuentas publicitarias */

    public static function cuentas(array $f, User $u): array
    {
        $alcance = self::marcasAlcance($u);
        $q = DB::table('ad_accounts as a')
            ->join('brands as b', 'b.id', '=', 'a.brand_id')
            ->leftJoin('suppliers as s', 's.id', '=', 'a.supplier_id');
        if ($alcance) {
            $q->whereIn('a.brand_id', $alcance);
        }
        if (! empty($f['plataforma'])) {
            $q->where('a.platform', $f['plataforma']);
        }
        if (! empty($f['marca'])) {
            $q->where('a.brand_id', $f['marca']);
        }
        if (! empty($f['estado'])) {
            $q->where('a.status', $f['estado']);
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('a.name', 'ilike', $p)->orWhere('a.external_id', 'ilike', $p)->orWhere('b.name', 'ilike', $p));
        }

        $cuentas = $q->orderBy('b.name')->orderBy('a.platform')->get([
            'a.*', 'b.name as brand_name', 'b.code as brand_code', 's.trade_name as supplier_trade', 's.legal_name as supplier_legal',
        ]);

        // Última corrida por cuenta
        $ultimas = DB::table('ad_import_runs')
            ->orderByDesc('started_at')
            ->get()
            ->unique('account_id')
            ->keyBy('account_id');

        // Gasto del último mes con datos (o mes en curso)
        $maxMes = substr((string) (DB::table('ad_spend_daily')->max('spend_date') ?? self::hoy()), 0, 7);
        $gastoMes = DB::table('ad_spend_daily as d')
            ->join('ad_campaigns as c', 'c.id', '=', 'd.campaign_id')
            ->where('d.spend_date', '>=', "{$maxMes}-01")
            ->groupBy('c.account_id')
            ->selectRaw('c.account_id, coalesce(sum(d.spend_pen), 0) as pen')
            ->pluck('pen', 'account_id')
            ->all();

        $conteoCampanas = DB::table('ad_campaigns')->groupBy('account_id')->selectRaw('account_id, count(*) as n')->pluck('n', 'account_id')->all();
        $tcHoy = self::tcVenta(self::hoy(), 'USD');

        $filas = $cuentas->map(function ($a) use ($ultimas, $gastoMes, $conteoCampanas) {
            $ur = $ultimas[$a->id] ?? null;

            return [
                'id' => $a->id,
                'platform' => $a->platform,
                'plataforma' => self::PLATAFORMAS[$a->platform] ?? $a->platform,
                'brand_id' => $a->brand_id,
                'brand_name' => $a->brand_name,
                'brand_code' => $a->brand_code,
                'name' => $a->name,
                'external_id' => $a->external_id,
                'currency' => $a->currency,
                'timezone' => $a->timezone,
                'supplier_id' => $a->supplier_id,
                'proveedor' => $a->supplier_trade ?: $a->supplier_legal ?: '—',
                'connector_id' => $a->connector_id,
                'connected_at' => $a->connected_at,
                'last_import_at' => $a->last_import_at,
                'ultimo_estado' => $ur?->status,
                'ultimo_error' => $ur?->error,
                'gasto_mes_pen' => round((float) ($gastoMes[$a->id] ?? 0), 2),
                'campanas_count' => (int) ($conteoCampanas[$a->id] ?? 0),
                'status' => $a->status,
                'estado' => self::ESTADOS_CUENTA[$a->status] ?? $a->status,
            ];
        })->all();

        $fallidas = array_values(array_filter($filas, fn ($x) => $x['ultimo_estado'] === 'FAILED'));

        return [
            'data' => $filas,
            'cifras' => [
                'conectadas' => count(array_filter($filas, fn ($x) => $x['status'] === 'ACTIVE')),
                'total' => count($filas),
                'gasto_mes_pen' => round(array_sum(array_column($filas, 'gasto_mes_pen')), 2),
                'mes_etiqueta' => $maxMes,
                'en_dolares' => count(array_filter($filas, fn ($x) => $x['currency'] === 'USD')),
                'fallidas' => count($fallidas),
                'fallidas_nombres' => array_column($fallidas, 'name'),
            ],
            'tc_hoy' => $tcHoy,
            'hora_importacion' => (string) (Params::get('ads_import_time') ?? '06:00'),
            'opciones' => [
                'marcas' => DB::table('brands')->where('status', 'ACTIVE')->when($alcance, fn ($w) => $w->whereIn('id', $alcance))->orderBy('name')->get(['id', 'name'])->map(fn ($b) => ['value' => $b->id, 'label' => $b->name])->all(),
                'proveedores' => DB::table('suppliers')->where('supplier_type', 'ADVERTISING')->where('status', 'ACTIVE')->orderBy('legal_name')->get(['id', 'trade_name', 'legal_name'])->map(fn ($s) => ['value' => $s->id, 'label' => $s->trade_name ?: $s->legal_name])->all(),
            ],
            'puede' => Access::can($u, 'ads.account.manage'),
        ];
    }

    public static function verCuenta(string $id, User $u): array
    {
        $a = DB::table('ad_accounts as a')
            ->join('brands as b', 'b.id', '=', 'a.brand_id')
            ->leftJoin('suppliers as s', 's.id', '=', 'a.supplier_id')
            ->where('a.id', $id)
            ->first(['a.*', 'b.name as brand_name', 'b.code as brand_code', 's.trade_name as supplier_trade', 's.legal_name as supplier_legal']) ?? abort(404);

        $campanas = DB::table('ad_campaigns as c')
            ->where('c.account_id', $a->id)
            ->orderBy('c.name')
            ->get()
            ->map(fn ($c) => [
                'id' => $c->id,
                'code' => $c->code,
                'name' => $c->name,
                'objective' => $c->objective,
                'daily_budget' => (float) $c->daily_budget,
                'status' => $c->status,
                'anuncios_count' => DB::table('ad_ads')->where('campaign_id', $c->id)->count(),
            ])->all();

        return [
            'id' => $a->id,
            'platform' => $a->platform,
            'plataforma' => self::PLATAFORMAS[$a->platform] ?? $a->platform,
            'brand_id' => $a->brand_id,
            'brand_name' => $a->brand_name,
            'name' => $a->name,
            'external_id' => $a->external_id,
            'currency' => $a->currency,
            'tc_hoy' => self::tcVenta(self::hoy(), $a->currency),
            'timezone' => $a->timezone,
            'proveedor' => $a->supplier_trade ?: $a->supplier_legal ?: '—',
            'connected_at' => $a->connected_at,
            'last_import_at' => $a->last_import_at,
            'status' => $a->status,
            'estado' => self::ESTADOS_CUENTA[$a->status] ?? $a->status,
            'campanas' => $campanas,
            'puede' => Access::can($u, 'ads.account.manage'),
        ];
    }

    public static function conectarCuenta(array $d, User $u): array
    {
        if (! Access::can($u, 'ads.account.manage')) {
            RuleError::fail('RN-SEG-12', 'Conectar cuentas publicitarias exige el permiso ads.account.manage.');
        }
        $ext = trim((string) $d['external_id']);
        if (DB::table('ad_accounts')->where('platform', $d['platform'])->where('external_id', $ext)->exists()) {
            $plat = self::PLATAFORMAS[$d['platform']] ?? $d['platform'];
            RuleError::fail('RN-ADS-01', "Ya existe una cuenta de {$plat} con el identificador {$ext}.");
        }
        $ahora = now();
        $id = DB::table('ad_accounts')->insertGetId([
            'platform' => $d['platform'],
            'brand_id' => $d['brand_id'],
            'name' => mb_substr(trim((string) $d['name']), 0, 120),
            'external_id' => mb_substr($ext, 0, 80),
            'currency' => $d['currency'],
            'timezone' => $d['timezone'] ?? 'America/Lima',
            'supplier_id' => $d['supplier_id'] ?? null,
            'status' => 'ACTIVE',
            'connected_at' => $ahora,
            'last_import_at' => $ahora,
            'created_at' => $ahora,
            'updated_at' => $ahora,
        ], 'id');
        Events::emit('ads.account_connected', 'ad_accounts', $id, ['platform' => $d['platform'], 'external_id' => $ext]);

        return self::verCuenta($id, $u);
    }

    public static function estadoCuenta(string $id, string $estado, User $u): array
    {
        if (! Access::can($u, 'ads.account.manage')) {
            RuleError::fail('RN-SEG-12', 'Cambiar el estado de una cuenta publicitaria exige el permiso ads.account.manage.');
        }
        $a = DB::table('ad_accounts')->where('id', $id)->first() ?? abort(404);
        DB::table('ad_accounts')->where('id', $id)->update(['status' => $estado, 'updated_at' => now()]);
        Events::emit('ads.account_status', 'ad_accounts', $id, ['from' => $a->status, 'to' => $estado]);

        return self::verCuenta($id, $u);
    }

    /* ------------------------------------------------------------------ ADS-02 Campañas y anuncios y ADS-03 Enlaces */

    public static function campanasYAnuncios(array $f, User $u): array
    {
        $alcance = self::marcasAlcance($u);
        $canalesWa = DB::table('messaging_channels')->where('kind', 'WHATSAPP')->get(['id', 'brand_id', 'number', 'display_name'])->keyBy('id')->all();
        $todosAnuncios = DB::table('ad_ads')->get(['id', 'tracking_code']);
        $conteoCodigos = [];
        foreach ($todosAnuncios as $x) {
            $c = strtoupper(trim((string) ($x->tracking_code ?? '')));
            if ($c !== '') {
                $conteoCodigos[$c] = ($conteoCodigos[$c] ?? 0) + 1;
            }
        }

        $q = DB::table('ad_ads as a')
            ->join('ad_campaigns as c', 'c.id', '=', 'a.campaign_id')
            ->join('brands as b', 'b.id', '=', 'a.brand_id');
        if ($alcance) {
            $q->whereIn('a.brand_id', $alcance);
        }
        if (! empty($f['plataforma'])) {
            $q->where('a.platform', $f['plataforma']);
        }
        if (! empty($f['marca'])) {
            $q->where('a.brand_id', $f['marca']);
        }
        if (! empty($f['destino'])) {
            $q->where('a.destination', $f['destino']);
        }
        if (! empty($f['estado'])) {
            $q->where('a.status', $f['estado']);
        }
        if (! empty($f['campana'])) {
            $q->where('a.campaign_id', $f['campana']);
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('a.name', 'ilike', $p)->orWhere('a.code', 'ilike', $p)->orWhere('a.tracking_code', 'ilike', $p)->orWhere('c.name', 'ilike', $p));
        }

        $anuncios = $q->orderBy('b.name')->orderBy('a.platform')->orderBy('a.code')->get([
            'a.*', 'c.name as campaign_name', 'c.code as campaign_code', 'b.name as brand_name', 'b.code as brand_code',
        ])->map(function ($a) use ($canalesWa, $conteoCodigos) {
            $problemas = self::problemasRastreo($a, $canalesWa, $conteoCodigos);
            $waNum = $a->channel_id && isset($canalesWa[$a->channel_id]) ? $canalesWa[$a->channel_id]->number : null;
            $waLink = self::enlaceWa($a, $waNum);
            $utmUrl = self::urlUtm($a);

            return [
                'id' => $a->id,
                'campaign_id' => $a->campaign_id,
                'campaign_name' => $a->campaign_name,
                'campaign_code' => $a->campaign_code,
                'brand_id' => $a->brand_id,
                'brand_name' => $a->brand_name,
                'brand_code' => $a->brand_code,
                'platform' => $a->platform,
                'plataforma' => self::PLATAFORMAS[$a->platform] ?? $a->platform,
                'code' => $a->code,
                'name' => $a->name,
                'external_id' => $a->external_id,
                'ad_group_name' => $a->ad_group_name,
                'destination' => $a->destination,
                'destino' => (self::DESTINOS[$a->destination] ?? $a->destination).($a->is_ctwa ? ' (clic a WA)' : ''),
                'is_ctwa' => (bool) $a->is_ctwa,
                'channel_id' => $a->channel_id,
                'whatsapp_number' => $waNum,
                'tracking_code' => $a->tracking_code,
                'utm_source' => $a->utm_source,
                'utm_medium' => $a->utm_medium,
                'utm_campaign' => $a->utm_campaign,
                'utm_content' => $a->utm_content,
                'landing_url' => $a->landing_url,
                'wa_link' => $waLink,
                'utm_url' => $utmUrl,
                'enlace' => $waLink ?: $utmUrl,
                'problemas' => $problemas,
                'sin_rastreo' => count($problemas) > 0,
                'status' => $a->status,
                'estado' => self::ESTADOS_ANUNCIO[$a->status] ?? $a->status,
            ];
        })->all();

        $sinRastreo = array_values(array_filter($anuncios, fn ($a) => $a['sin_rastreo']));

        $campanas = DB::table('ad_campaigns as c')
            ->join('ad_accounts as ac', 'ac.id', '=', 'c.account_id')
            ->join('brands as b', 'b.id', '=', 'c.brand_id')
            ->when($alcance, fn ($w) => $w->whereIn('c.brand_id', $alcance))
            ->when(! empty($f['plataforma']), fn ($w) => $w->where('c.platform', $f['plataforma']))
            ->when(! empty($f['marca']), fn ($w) => $w->where('c.brand_id', $f['marca']))
            ->orderBy('b.name')->orderBy('c.name')
            ->get(['c.*', 'ac.currency', 'ac.name as account_name', 'b.name as brand_name'])
            ->map(fn ($c) => [
                'id' => $c->id,
                'code' => $c->code,
                'name' => $c->name,
                'platform' => $c->platform,
                'plataforma' => self::PLATAFORMAS[$c->platform] ?? $c->platform,
                'brand_id' => $c->brand_id,
                'brand_name' => $c->brand_name,
                'account_name' => $c->account_name,
                'currency' => $c->currency,
                'objective' => $c->objective,
                'daily_budget' => (float) $c->daily_budget,
                'status' => $c->status,
                'estado' => self::ESTADOS_ANUNCIO[$c->status] ?? $c->status,
                'anuncios_count' => DB::table('ad_ads')->where('campaign_id', $c->id)->count(),
            ])->all();

        return [
            'anuncios' => $anuncios,
            'sin_rastreo' => $sinRastreo,
            'campanas' => $campanas,
            'cifras' => [
                'campanas_activas' => count(array_filter($campanas, fn ($c) => $c['status'] === 'ACTIVE')),
                'anuncios_activos' => count(array_filter($anuncios, fn ($a) => $a['status'] === 'ACTIVE')),
                'clic_whatsapp' => count(array_filter($anuncios, fn ($a) => $a['is_ctwa'])),
                'sin_rastreo' => count($sinRastreo),
            ],
            'opciones' => [
                'canales_wa' => array_values(array_map(fn ($ch) => ['value' => $ch->id, 'label' => "{$ch->number} · {$ch->display_name}", 'brand_id' => $ch->brand_id], $canalesWa)),
                'destinos' => collect(self::DESTINOS)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all(),
                'marcas' => DB::table('brands')->where('status', 'ACTIVE')->when($alcance, fn ($w) => $w->whereIn('id', $alcance))->orderBy('name')->get(['id', 'name'])->map(fn ($b) => ['value' => $b->id, 'label' => $b->name])->all(),
            ],
            'puede' => Access::can($u, 'ads.account.manage'),
        ];
    }

    /** Edita el rastreo de un anuncio validando RN-ADS-03. */
    public static function guardarRastreo(string $adId, array $d, User $u): array
    {
        if (! Access::can($u, 'ads.account.manage')) {
            RuleError::fail('RN-SEG-12', 'Editar el rastreo de anuncios exige el permiso ads.account.manage.');
        }
        $ad = DB::table('ad_ads')->where('id', $adId)->first() ?? abort(404);
        $destino = $d['destination'] ?? $ad->destination;
        $estado = $d['status'] ?? $ad->status;
        $esCtwa = ! empty($d['is_ctwa']);
        $codigo = isset($d['tracking_code']) && trim((string) $d['tracking_code']) !== '' ? strtoupper(trim((string) $d['tracking_code'])) : null;
        $canalId = ! empty($d['channel_id']) ? $d['channel_id'] : null;

        if ($codigo !== null) {
            if (! preg_match(self::REGEX_CODIGO, $codigo)) {
                RuleError::fail('RN-ADS-03', 'El código de rastreo debe tener el formato XX-XXXX (letras, números y un guion, por ejemplo DG-A12).');
            }
            $dup = DB::table('ad_ads')->where('id', '<>', $ad->id)->whereRaw('upper(btrim(tracking_code)) = ?', [$codigo])->exists();
            if ($dup) {
                RuleError::fail('RN-ADS-03', "El código {$codigo} ya lo usa otro anuncio de la empresa.");
            }
        }

        if ($destino === 'WHATSAPP' && $estado === 'ACTIVE') {
            if (! $canalId) {
                RuleError::fail('RN-ADS-03', 'Un anuncio activo con destino WhatsApp necesita el número de WhatsApp de su marca.');
            }
            $ch = DB::table('messaging_channels')->where('id', $canalId)->first();
            if (! $ch || $ch->brand_id !== $ad->brand_id) {
                RuleError::fail('RN-ADS-03', 'El número de WhatsApp elegido pertenece a otra marca.');
            }
            if (! $codigo && ! $esCtwa) {
                RuleError::fail('RN-ADS-03', 'Un anuncio activo con destino WhatsApp necesita un código de rastreo (o ser de clic a WhatsApp).');
            }
        }

        $utmSource = isset($d['utm_source']) && trim((string) $d['utm_source']) !== '' ? trim((string) $d['utm_source']) : null;
        $utmMedium = isset($d['utm_medium']) && trim((string) $d['utm_medium']) !== '' ? trim((string) $d['utm_medium']) : null;
        $utmCampaign = isset($d['utm_campaign']) && trim((string) $d['utm_campaign']) !== '' ? trim((string) $d['utm_campaign']) : null;
        $utmContent = isset($d['utm_content']) && trim((string) $d['utm_content']) !== '' ? trim((string) $d['utm_content']) : null;
        $landing = isset($d['landing_url']) && trim((string) $d['landing_url']) !== '' ? trim((string) $d['landing_url']) : null;

        if ($destino === 'WEB' && $estado === 'ACTIVE' && (! $utmSource || ! $utmCampaign)) {
            RuleError::fail('RN-ADS-03', 'Un anuncio activo hacia la web necesita parámetros UTM (al menos utm_source y utm_campaign).');
        }

        DB::table('ad_ads')->where('id', $ad->id)->update([
            'destination' => $destino,
            'is_ctwa' => $esCtwa,
            'channel_id' => $destino === 'WHATSAPP' ? $canalId : null,
            'tracking_code' => $codigo,
            'utm_source' => $utmSource,
            'utm_medium' => $utmMedium,
            'utm_campaign' => $utmCampaign,
            'utm_content' => $utmContent,
            'landing_url' => $landing,
            'status' => $estado,
            'updated_at' => now(),
        ]);
        Events::emit('ads.tracking_updated', 'ad_ads', $ad->id, ['tracking_code' => $codigo, 'destination' => $destino, 'status' => $estado]);

        return self::campanasYAnuncios([], $u);
    }

    /* ------------------------------------------------------------------ ADS-04 Importaciones (RN-ADS-01, RN-ADS-02) */

    private static function gastoSimuladoPen(object $ad, object $camp, object $acc, string $fecha): float
    {
        if ($camp->status === 'REMOVED') {
            return 0.0;
        }
        if ($camp->paused_from && $fecha >= $camp->paused_from) {
            return 0.0;
        }
        if ($ad->status !== 'ACTIVE' && $ad->paused_from && $fecha >= $ad->paused_from) {
            return 0.0;
        }
        $hs = hexdec(substr(hash('sha256', "{$ad->id}|{$fecha}"), 0, 4));
        $base = max(15.0, (float) ($camp->daily_budget ?: 40) * 0.45);
        $factor = 0.75 + (($hs % 50) / 100);

        return round($base * $factor, 2);
    }

    /**
     * Importa (o reimporta) un día de una cuenta: una sola fila por campaña, anuncio y fecha (RN-ADS-02, CA-ADS-02, CA-ADS-06).
     * Si se pasa $filas, usa esas filas `[{campaign_id, ad_id, spend, impressions, clicks, platform_leads, platform_conversions}]`.
     */
    public static function importarDia(string $accountId, string $fecha, ?array $filas = null, ?string $runId = null, ?float $tcForzado = null): array
    {
        $acc = DB::table('ad_accounts')->where('id', $accountId)->first() ?? RuleError::fail('RN-ADS-01', 'Cuenta publicitaria no encontrada.');
        $tc = $tcForzado !== null ? $tcForzado : self::tcVenta($fecha, $acc->currency);

        if ($filas === null) {
            $filas = [];
            $campanas = DB::table('ad_campaigns')->where('account_id', $acc->id)->get()->keyBy('id');
            foreach ($campanas as $camp) {
                foreach (DB::table('ad_ads')->where('campaign_id', $camp->id)->get() as $ad) {
                    $pen = self::gastoSimuladoPen($ad, $camp, $acc, $fecha);
                    if ($pen <= 0) {
                        continue;
                    }
                    $gastoMoneda = $acc->currency === 'PEN' ? $pen : round($pen / $tc, 2);
                    $imp = (int) round($pen * 110);
                    $clicks = (int) round($imp * 0.018);
                    $filas[] = [
                        'campaign_id' => $camp->id,
                        'ad_id' => $ad->id,
                        'spend' => $gastoMoneda,
                        'impressions' => $imp,
                        'clicks' => $clicks,
                        'platform_leads' => max(0, (int) round($clicks * 0.08)),
                        'platform_conversions' => max(0, (int) round($clicks * 0.02)),
                    ];
                }
            }
        }

        $actualizadas = 0;
        foreach ($filas as $x) {
            $gasto = round((float) ($x['spend'] ?? 0), 2);
            if ($gasto < 0) {
                RuleError::fail('RN-ADS-02', 'El gasto no puede ser negativo.');
            }
            $gastoPen = round($gasto * $tc, 2);
            $previa = DB::table('ad_spend_daily')
                ->where('campaign_id', $x['campaign_id'])
                ->where('ad_id', $x['ad_id'])
                ->where('spend_date', $fecha)
                ->first();

            $datos = [
                'currency' => $acc->currency,
                'spend' => $gasto,
                'exchange_rate' => $tc,
                'spend_pen' => $gastoPen,
                'impressions' => (int) ($x['impressions'] ?? 0),
                'clicks' => (int) ($x['clicks'] ?? 0),
                'platform_leads' => (float) ($x['platform_leads'] ?? 0),
                'platform_conversions' => (float) ($x['platform_conversions'] ?? 0),
                'updated_at' => now(),
            ];
            if ($runId) {
                $datos['import_run_id'] = $runId;
            }

            if ($previa) {
                if (abs((float) $previa->spend - $gasto) > 0.001 || abs((float) $previa->exchange_rate - $tc) > 0.0001) {
                    DB::table('ad_spend_daily')->where('id', $previa->id)->update($datos);
                    $actualizadas++;
                }
            } else {
                DB::table('ad_spend_daily')->insert($datos + [
                    'campaign_id' => $x['campaign_id'],
                    'ad_id' => $x['ad_id'],
                    'spend_date' => $fecha,
                    'created_at' => now(),
                ]);
                $actualizadas++;
            }
        }

        return ['leidas' => count($filas), 'actualizadas' => $actualizadas, 'exchange_rate' => $tc];
    }

    /** Reimporta un rango de fechas para una cuenta activa y registra la corrida en ad_import_runs (RN-ADS-01, RN-ADS-02). */
    public static function importarRango(string $accountId, string $desde, string $hasta, ?User $u = null): object
    {
        if ($u && ! Access::can($u, 'ads.account.manage')) {
            RuleError::fail('RN-SEG-12', 'Reimportar gastos exige el permiso ads.account.manage.');
        }
        $acc = DB::table('ad_accounts')->where('id', $accountId)->first() ?? RuleError::fail('RN-ADS-01', 'Cuenta publicitaria no encontrada.');
        if ($hasta < $desde) {
            RuleError::fail('RN-ADS-02', 'La fecha final no puede ser anterior a la inicial.');
        }
        if ($hasta >= self::hoy()) {
            RuleError::fail('RN-ADS-01', 'Solo se importan días cerrados (hasta ayer).');
        }
        if ($acc->status === 'DISCONNECTED') {
            RuleError::fail('RN-ADS-01', "La cuenta {$acc->name} está desconectada: reconéctala en Cuentas publicitarias antes de importar.");
        }
        if ($acc->status === 'PAUSED') {
            DB::table('ad_accounts')->where('id', $acc->id)->update(['status' => 'ACTIVE', 'updated_at' => now()]);
        }

        $ahora = now();
        $runId = DB::table('ad_import_runs')->insertGetId([
            'account_id' => $acc->id,
            'date_from' => $desde,
            'date_to' => $hasta,
            'status' => 'OK',
            'rows_read' => 0,
            'rows_upserted' => 0,
            'error' => null,
            'started_at' => $ahora,
            'finished_at' => $ahora,
            'user' => $u ? mb_substr($u->name, 0, 120) : 'Programador de tareas',
            'created_at' => $ahora,
        ], 'id');

        $leidas = 0;
        $actualizadas = 0;
        for ($d = Carbon::parse($desde); $d->lte(Carbon::parse($hasta)); $d->addDay()) {
            $r = self::importarDia($acc->id, $d->toDateString(), null, $runId);
            $leidas += $r['leidas'];
            $actualizadas += $r['actualizadas'];
        }

        $fin = now();
        DB::table('ad_import_runs')->where('id', $runId)->update([
            'status' => 'OK',
            'rows_read' => $leidas,
            'rows_upserted' => $actualizadas,
            'finished_at' => $fin,
            'updated_at' => $fin,
        ]);
        DB::table('ad_accounts')->where('id', $acc->id)->update(['last_import_at' => $fin, 'updated_at' => $fin]);
        Events::emit('ad_spend.imported', 'ad_import_runs', $runId, ['account_id' => $acc->id, 'from' => $desde, 'to' => $hasta, 'rows' => $actualizadas]);

        return DB::table('ad_import_runs')->where('id', $runId)->first();
    }

    /** Corrida diaria (RN-ADS-01): importa los últimos ads_import_lookback_days (3) días de cada cuenta activa. */
    public static function correrImportacionDiaria(?User $u = null): array
    {
        if ($u && ! Access::can($u, 'ads.account.manage')) {
            RuleError::fail('RN-SEG-12', 'Correr la importación diaria exige el permiso ads.account.manage.');
        }
        $dias = max(1, (int) (Params::get('ads_import_lookback_days') ?? 3));
        $ayer = Carbon::parse(self::hoy())->subDay()->toDateString();
        $desde = Carbon::parse(self::hoy())->subDays($dias)->toDateString();
        $cuentas = DB::table('ad_accounts')->where('status', 'ACTIVE')->get();
        $corridas = [];
        foreach ($cuentas as $a) {
            $corridas[] = self::importarRango($a->id, $desde, $ayer, $u);
        }

        return ['ok' => count($corridas), 'desde' => $desde, 'hasta' => $ayer];
    }

    public static function listaImportaciones(array $f, User $u): array
    {
        $alcance = self::marcasAlcance($u);
        $q = DB::table('ad_import_runs as r')
            ->join('ad_accounts as a', 'a.id', '=', 'r.account_id')
            ->join('brands as b', 'b.id', '=', 'a.brand_id');
        if ($alcance) {
            $q->whereIn('a.brand_id', $alcance);
        }
        if (! empty($f['estado'])) {
            $q->where('r.status', $f['estado']);
        }
        if (! empty($f['cuenta'])) {
            $q->where('r.account_id', $f['cuenta']);
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('a.name', 'ilike', $p)->orWhere('r.user', 'ilike', $p)->orWhere('r.error', 'ilike', $p));
        }

        $tot = DB::table('ad_import_runs as r')->join('ad_accounts as a', 'a.id', '=', 'r.account_id')
            ->when($alcance, fn ($w) => $w->whereIn('a.brand_id', $alcance))
            ->selectRaw("count(*) as total,
                count(*) FILTER (WHERE r.status = 'OK') as ok,
                count(*) FILTER (WHERE r.status IN ('FAILED','PARTIAL')) as fallidas")->first();
        $totalGastoFilas = DB::table('ad_spend_daily')->count();
        $ultimoDia = DB::table('ad_spend_daily')->max('spend_date');

        $q->orderByDesc('r.started_at')->orderByDesc('r.id');
        $q->select(['r.*', 'a.name as account_name', 'a.platform', 'b.name as brand_name']);

        return Paginas::de($q, fn ($r) => [
            'id' => $r->id,
            'account_id' => $r->account_id,
            'account_name' => $r->account_name,
            'platform' => $r->platform,
            'plataforma' => self::PLATAFORMAS[$r->platform] ?? $r->platform,
            'brand_name' => $r->brand_name,
            'date_from' => $r->date_from,
            'date_to' => $r->date_to,
            'rows_read' => (int) $r->rows_read,
            'rows_upserted' => (int) $r->rows_upserted,
            'status' => $r->status,
            'estado' => self::ESTADOS_CORRIDA[$r->status] ?? $r->status,
            'error' => $r->error,
            'started_at' => $r->started_at,
            'finished_at' => $r->finished_at,
            'user' => $r->user ?: 'Programador de tareas',
        ], $f) + [
            'cifras' => [
                'total' => (int) $tot->total,
                'ok' => (int) $tot->ok,
                'fallidas' => (int) $tot->fallidas,
                'filas_gasto' => $totalGastoFilas,
                'ultimo_dia' => $ultimoDia,
            ],
            'hora_importacion' => (string) (Params::get('ads_import_time') ?? '06:00'),
            'dias_ventana' => (int) (Params::get('ads_import_lookback_days') ?? 3),
            'opciones' => [
                'cuentas' => DB::table('ad_accounts')->when($alcance, fn ($w) => $w->whereIn('brand_id', $alcance))->orderBy('name')->get(['id', 'name'])->map(fn ($a) => ['value' => $a->id, 'label' => $a->name])->all(),
            ],
            'ayer' => Carbon::parse(self::hoy())->subDay()->toDateString(),
            'hace_3_dias' => Carbon::parse(self::hoy())->subDays(3)->toDateString(),
            'puede' => Access::can($u, 'ads.account.manage'),
        ];
    }

    /* ------------------------------------------------------------------ Atribución de leads y pedidos (RN-ADS-04, 05, 06 y 09) */

    public static function anuncioPorCodigo(?string $codigo): ?object
    {
        $c = strtoupper(trim((string) $codigo));
        if ($c === '') {
            return null;
        }

        return DB::table('ad_ads')
            ->whereRaw('upper(btrim(code)) = ? OR upper(btrim(coalesce(tracking_code, \'\'))) = ?', [$c, $c])
            ->first();
    }

    /**
     * Atribuye un lead o conversación en el orden de RN-ADS-04 (CA-ADS-04):
     * 1. Referral del anuncio de clic a WhatsApp (`referral_ad_id`)
     * 2. Código de rastreo en el primer mensaje del cliente (`first_message`, sin importar mayúsculas)
     * 3. UTM del pedido o sesión web (`utm.content` o `utm.campaign`)
     * 4. Conversación de TikTok desde un anuncio (`tiktok_ad_id`)
     */
    public static function atribuirLead(array $d): object
    {
        $ad = null;
        $metodo = 'NONE';
        if (! empty($d['referral_ad_id'])) {
            $ad = (preg_match('/^[0-9a-f-]{36}$/i', (string) $d['referral_ad_id']) ? DB::table('ad_ads')->where('id', $d['referral_ad_id'])->first() : null)
                ?? self::anuncioPorCodigo((string) $d['referral_ad_id']);
            if ($ad) {
                $metodo = 'CTWA_REFERRAL';
            }
        }
        if (! $ad && ! empty($d['first_message'])) {
            if (preg_match_all('/\b[A-Z0-9]{2,6}-[A-Z0-9]{2,8}\b/i', (string) $d['first_message'], $m)) {
                foreach ($m[0] as $cand) {
                    $encontrado = self::anuncioPorCodigo($cand);
                    if ($encontrado) {
                        $ad = $encontrado;
                        $metodo = 'TRACKING_CODE';
                        break;
                    }
                }
            }
        }
        if (! $ad && ! empty($d['utm']) && is_array($d['utm'])) {
            $ad = self::anuncioPorCodigo($d['utm']['content'] ?? null) ?? self::anuncioPorCodigo($d['utm']['campaign'] ?? null);
            if ($ad) {
                $metodo = 'UTM';
            }
        }
        if (! $ad && ! empty($d['tiktok_ad_id'])) {
            $ad = (preg_match('/^[0-9a-f-]{36}$/i', (string) $d['tiktok_ad_id']) ? DB::table('ad_ads')->where('id', $d['tiktok_ad_id'])->first() : null)
                ?? self::anuncioPorCodigo((string) $d['tiktok_ad_id']);
            if ($ad) {
                $metodo = 'TIKTOK_DM';
            }
        }

        $cuando = isset($d['at']) ? Carbon::parse($d['at']) : now();
        $marca = $ad?->brand_id ?? ($d['brand_id'] ?? DB::table('brands')->value('id'));
        $id = DB::table('ad_attributions')->insertGetId([
            'lead_id' => $d['lead_id'] ?? null,
            'order_id' => null,
            'conversation_id' => $d['conversation_id'] ?? null,
            'ad_id' => $ad?->id,
            'campaign_id' => $ad?->campaign_id,
            'platform' => $ad?->platform,
            'brand_id' => $marca,
            'method' => $metodo,
            'is_new_customer' => false,
            'attributed_at' => $cuando,
            'lead_at' => $cuando,
            'lead_origin' => true,
            'customer_id' => $d['customer_id'] ?? null,
            'phone' => $d['phone'] ?? null,
            'manual_reason' => null,
            'created_at' => $cuando,
        ], 'id');

        if ($metodo !== 'NONE') {
            Events::emit('attribution.created', 'ad_attributions', $id, ['ad_id' => $ad?->id, 'method' => $metodo]);
        }

        return DB::table('ad_attributions')->where('id', $id)->first();
    }

    /** Busca el lead atribuido más reciente del cliente dentro de ads_attribution_window_days (30 días, RN-ADS-05, CA-ADS-07). */
    public static function leadRecienteDeCliente(?string $customerId, Carbon $momentoPedido): ?object
    {
        if (! $customerId) {
            return null;
        }
        $ventanaDias = max(1, (int) (Params::get('ads_attribution_window_days') ?? 30));
        $desde = $momentoPedido->copy()->subDays($ventanaDias)->startOfDay();

        return DB::table('ad_attributions')
            ->where('lead_origin', true)
            ->where('customer_id', $customerId)
            ->whereNotNull('ad_id')
            ->where('method', '<>', 'NONE')
            ->where('lead_at', '<=', $momentoPedido)
            ->where('lead_at', '>=', $desde)
            ->orderByDesc('lead_at')
            ->first();
    }

    /** ¿Es este el primer pedido no anulado del cliente? (RN-ADS-09). */
    public static function esClienteNuevo(?string $customerId, string $orderId): bool
    {
        if (! $customerId) {
            return false;
        }
        $primero = DB::table('sales_orders')
            ->where('customer_id', $customerId)
            ->whereNotIn('status', ['CANCELLED', 'DRAFT'])
            ->orderBy('created_at')
            ->orderBy('id')
            ->value('id');

        return $primero === $orderId;
    }

    /** Atribuye un pedido (último toque antes del pedido o heredado del lead dentro de 30 días, RN-ADS-05, RN-ADS-09, CA-ADS-07). */
    public static function atribuirPedido(string $orderId, array $opc = []): ?object
    {
        $o = DB::table('sales_orders')->where('id', $orderId)->first();
        if (! $o) {
            return null;
        }
        $existente = DB::table('ad_attributions')->where('order_id', $o->id)->first();
        if ($existente && empty($opc['force'])) {
            return $existente;
        }
        $codigo = $opc['origin_ad_code'] ?? ($o->origin_ad_code ?? null);
        $ad = $codigo ? self::anuncioPorCodigo((string) $codigo) : null;
        if (! $ad && ! empty($o->origin_utm)) {
            $utm = is_string($o->origin_utm) ? (json_decode($o->origin_utm, true) ?: []) : (array) $o->origin_utm;
            $ad = self::anuncioPorCodigo($utm['content'] ?? null) ?? self::anuncioPorCodigo($utm['campaign'] ?? null);
        }
        $metodo = 'NONE';
        $lead = null;
        if ($ad) {
            $metodo = $o->channel === 'WEB' ? 'UTM' : ($ad->is_ctwa && $o->channel === 'WHATSAPP' ? 'CTWA_REFERRAL' : ($o->channel === 'TIKTOK' || $ad->destination === 'TIKTOK_DM' ? 'TIKTOK_DM' : 'TRACKING_CODE'));
        } else {
            $lead = self::leadRecienteDeCliente($o->customer_id, Carbon::parse($o->created_at));
            if ($lead && $lead->ad_id) {
                $ad = DB::table('ad_ads')->where('id', $lead->ad_id)->first();
                if ($ad) {
                    $metodo = 'INHERITED_FROM_LEAD';
                }
            }
        }
        if (! $ad && ! in_array($o->channel, self::CANALES_DIGITALES, true)) {
            return null;
        }
        $esNuevo = self::esClienteNuevo($o->customer_id, $o->id);
        $datos = [
            'lead_id' => $lead?->lead_id,
            'order_id' => $o->id,
            'ad_id' => $ad?->id,
            'campaign_id' => $ad?->campaign_id,
            'platform' => $ad?->platform,
            'brand_id' => $o->brand_id,
            'method' => $metodo,
            'is_new_customer' => $esNuevo,
            'attributed_at' => $o->created_at,
            'lead_at' => $lead?->lead_at ?? $o->created_at,
            'lead_origin' => ! $lead && (bool) $ad,
            'customer_id' => $o->customer_id,
            'updated_at' => now(),
        ];

        if ($existente) {
            DB::table('ad_attributions')->where('id', $existente->id)->update($datos);
            $id = $existente->id;
        } else {
            $id = DB::table('ad_attributions')->insertGetId($datos + ['created_at' => now()], 'id');
        }

        return DB::table('ad_attributions')->where('id', $id)->first();
    }

    /** Corrección manual de la atribución de un pedido con motivo obligatorio y registro del valor anterior (RN-ADS-06). */
    public static function corregirAtribucion(string $orderId, ?string $adId, string $motivo, User $u): array
    {
        if (! Access::can($u, 'ads.attribution.correct')) {
            RuleError::fail('RN-ADS-06', 'Corregir la atribución de un pedido exige el permiso ads.attribution.correct.');
        }
        $motivo = trim($motivo);
        if (mb_strlen($motivo) < 5) {
            RuleError::fail('RN-ADS-06', 'La corrección manual exige un motivo de al menos 5 caracteres.');
        }
        $o = DB::table('sales_orders')->where('id', $orderId)->first() ?? RuleError::fail('RN-ADS-06', 'El pedido no existe.');
        $ad = $adId ? DB::table('ad_ads')->where('id', $adId)->first() : null;
        if ($adId && ! $ad) {
            RuleError::fail('RN-ADS-06', 'El anuncio seleccionado no existe.');
        }
        if ($ad && $ad->brand_id !== $o->brand_id) {
            RuleError::fail('RN-ADS-06', 'El anuncio elegido pertenece a otra marca distinta a la del pedido.');
        }

        $previa = DB::table('ad_attributions')->where('order_id', $o->id)->first();
        $anterior = $previa ? ['ad_id' => $previa->ad_id, 'method' => $previa->method] : ['ad_id' => null, 'method' => 'NONE'];
        $esNuevo = self::esClienteNuevo($o->customer_id, $o->id);
        $ahora = now();

        $cambios = [
            'ad_id' => $ad?->id,
            'campaign_id' => $ad?->campaign_id,
            'platform' => $ad?->platform,
            'method' => $ad ? 'MANUAL' : 'NONE',
            'manual_reason' => mb_substr($motivo, 0, 255),
            'corrected_by' => mb_substr($u->name, 0, 120),
            'corrected_at' => $ahora,
            'previous' => json_encode($anterior),
            'is_new_customer' => $esNuevo,
            'updated_at' => $ahora,
        ];

        if ($previa) {
            DB::table('ad_attributions')->where('id', $previa->id)->update($cambios);
            $id = $previa->id;
        } else {
            $id = DB::table('ad_attributions')->insertGetId($cambios + [
                'lead_id' => null,
                'order_id' => $o->id,
                'brand_id' => $o->brand_id,
                'attributed_at' => $o->created_at,
                'lead_at' => $o->created_at,
                'lead_origin' => false,
                'customer_id' => $o->customer_id,
                'created_at' => $ahora,
            ], 'id');
        }
        Events::emit('ads.attribution_corrected', 'ad_attributions', $id, ['order_id' => $o->id, 'before' => $anterior, 'after' => ['ad_id' => $ad?->id, 'method' => $cambios['method']], 'reason' => $motivo, 'by' => $u->id]);

        return ['id' => $id, 'order_id' => $o->id, 'ad_id' => $ad?->id, 'method' => $cambios['method']];
    }

    /* ------------------------------------------------------------------ ADS-05 Resultados por anuncio y campaña (RN-ADS-07, 09, 12; CA-ADS-01, CA-ADS-05) */

    public static function resultados(array $f, User $u): array
    {
        if (! Access::can($u, 'ads.result.view') && ! Access::can($u, 'ads.account.manage')) {
            abort(403, 'Ver resultados publicitarios exige el permiso ads.result.view.');
        }
        [$desde, $hasta] = self::rangoPorDefecto($f);
        $por = ($f['por'] ?? 'ad') === 'campaign' ? 'campaign' : (($f['por'] ?? 'ad') === 'platform' ? 'platform' : 'ad');
        $alcance = self::marcasAlcance($u);
        $marcas = self::marcasMapa();

        $anuncios = DB::table('ad_ads')->get()->keyBy('id')->all();
        $campanas = DB::table('ad_campaigns')->get()->keyBy('id')->all();
        $canalesWa = DB::table('messaging_channels')->where('kind', 'WHATSAPP')->get(['id', 'brand_id', 'number'])->keyBy('id')->all();
        $conteoCodigos = [];
        foreach ($anuncios as $x) {
            $c = strtoupper(trim((string) ($x->tracking_code ?? '')));
            if ($c !== '') {
                $conteoCodigos[$c] = ($conteoCodigos[$c] ?? 0) + 1;
            }
        }

        $pasaFiltro = function (?object $ad, ?object $camp) use ($f, $alcance): bool {
            if (! $camp) {
                return false;
            }
            if ($alcance && ! in_array($camp->brand_id, $alcance, true)) {
                return false;
            }
            if (! empty($f['marca']) && $camp->brand_id !== $f['marca']) {
                return false;
            }
            if (! empty($f['plataforma']) && $camp->platform !== $f['plataforma']) {
                return false;
            }
            if (! empty($f['campana']) && $camp->id !== $f['campana']) {
                return false;
            }
            if (! empty($f['anuncio']) && (! $ad || $ad->id !== $f['anuncio'])) {
                return false;
            }

            return true;
        };

        $grupos = [];
        $asegurar = function (string $k) use (&$grupos): void {
            if (! isset($grupos[$k])) {
                $grupos[$k] = ['key' => $k, 'spend' => 0.0, 'leads' => 0, 'orders' => 0, 'new_customers' => 0, 'collected' => 0.0, 'order_ids' => []];
            }
        };

        $gastos = DB::table('ad_spend_daily')->whereBetween('spend_date', [$desde, $hasta])->get();
        foreach ($gastos as $s) {
            $camp = $campanas[$s->campaign_id] ?? null;
            $ad = $s->ad_id ? ($anuncios[$s->ad_id] ?? null) : null;
            if (! $pasaFiltro($ad, $camp) || ($por === 'ad' && ! $ad)) {
                continue;
            }
            $k = $por === 'ad' ? $ad->id : ($por === 'campaign' ? $camp->id : $camp->platform);
            $asegurar($k);
            $grupos[$k]['spend'] += (float) $s->spend_pen;
        }

        $atribuciones = DB::table('ad_attributions')
            ->whereNotNull('ad_id')
            ->where('method', '<>', 'NONE')
            ->get();

        // Pre-cargar pedidos referenciados
        $orderIdsRef = $atribuciones->pluck('order_id')->filter()->unique()->values()->all();
        $pedidosMapa = $orderIdsRef
            ? DB::table('sales_orders')->whereIn('id', $orderIdsRef)->get(['id', 'number', 'status', 'customer_id', 'establishment_id', 'created_at', 'final_total', 'estimated_total'])->keyBy('id')->all()
            : [];
        $cobradoMapa = self::mapaCobradoPorPedido($orderIdsRef);

        // Primer pedido no anulado por cliente (RN-ADS-09)
        $customerIdsRef = collect($pedidosMapa)->pluck('customer_id')->filter()->unique()->values()->all();
        $primerPedidoCliente = [];
        if ($customerIdsRef) {
            foreach (DB::table('sales_orders')->whereIn('customer_id', $customerIdsRef)->whereNotIn('status', ['CANCELLED', 'DRAFT'])->orderBy('created_at')->orderBy('id')->get(['id', 'customer_id']) as $po) {
                $primerPedidoCliente[$po->customer_id] ??= $po->id;
            }
        }

        foreach ($atribuciones as $at) {
            $ad = $anuncios[$at->ad_id] ?? null;
            $camp = $ad ? ($campanas[$ad->campaign_id] ?? null) : null;
            if (! $ad || ! $pasaFiltro($ad, $camp)) {
                continue;
            }
            $k = $por === 'ad' ? $ad->id : ($por === 'campaign' ? $camp->id : $camp->platform);

            $fechaLead = substr((string) ($at->lead_at ?? $at->attributed_at), 0, 10);
            if ($at->lead_origin && $fechaLead >= $desde && $fechaLead <= $hasta) {
                $asegurar($k);
                $grupos[$k]['leads']++;
            }

            if ($at->order_id) {
                $fechaAt = substr((string) $at->attributed_at, 0, 10);
                if ($fechaAt >= $desde && $fechaAt <= $hasta) {
                    $o = $pedidosMapa[$at->order_id] ?? null;
                    if (! $o || in_array($o->status, ['CANCELLED', 'DRAFT'], true)) {
                        continue;
                    }
                    $asegurar($k);
                    $grupos[$k]['orders']++;
                    $esNuevo = (bool) $at->is_new_customer || (($primerPedidoCliente[$o->customer_id] ?? null) === $o->id);
                    if ($esNuevo) {
                        $grupos[$k]['new_customers']++;
                    }
                    $grupos[$k]['collected'] += (float) ($cobradoMapa[$o->id] ?? 0);
                    $grupos[$k]['order_ids'][] = $o->id;
                }
            }
        }

        // Gasto de creadores por campaña en el período
        $creadoresPorCampana = DB::table('expenses')
            ->whereNotNull('ad_campaign_id')
            ->whereIn('status', ['APPROVED', 'PAID'])
            ->whereBetween('issue_date', [$desde, $hasta])
            ->groupBy('ad_campaign_id')
            ->selectRaw('ad_campaign_id, coalesce(sum(amount_pen), 0) as pen')
            ->pluck('pen', 'ad_campaign_id')
            ->all();

        $filas = [];
        $totSpend = 0.0;
        $totLeads = 0;
        $totOrders = 0;
        $totNew = 0;
        $totCollected = 0.0;

        foreach ($grupos as $k => $g) {
            $spend = round($g['spend'], 2);
            $collected = round($g['collected'], 2);
            $leads = $g['leads'];
            $orders = $g['orders'];
            $newCust = $g['new_customers'];

            $totSpend += $spend;
            $totLeads += $leads;
            $totOrders += $orders;
            $totNew += $newCust;
            $totCollected += $collected;

            $cpl = $leads > 0 ? round($spend / $leads, 2) : null;
            $cpo = $orders > 0 ? round($spend / $orders, 2) : null;
            $cpn = $newCust > 0 ? round($spend / $newCust, 2) : null;
            $roas = $spend > 0 ? round($collected / $spend, 2) : null;

            if ($por === 'ad') {
                $ad = $anuncios[$k];
                $camp = $campanas[$ad->campaign_id] ?? null;
                $sinRastreo = count(self::problemasRastreo($ad, $canalesWa, $conteoCodigos)) > 0;
                $filas[] = [
                    'key' => $k,
                    'code' => $ad->tracking_code ?: $ad->code,
                    'name' => $ad->name,
                    'campaign_id' => $ad->campaign_id,
                    'campaign_name' => $camp?->name ?? '—',
                    'platform' => $ad->platform,
                    'plataforma' => self::PLATAFORMAS[$ad->platform] ?? $ad->platform,
                    'brand_id' => $ad->brand_id,
                    'brand_name' => $marcas[$ad->brand_id]->name ?? '—',
                    'sin_rastreo' => $sinRastreo,
                    'spend' => $spend,
                    'leads' => $leads,
                    'orders' => $orders,
                    'new_customers' => $newCust,
                    'collected' => $collected,
                    'cpl' => $cpl,
                    'cpo' => $cpo,
                    'cpn' => $cpn,
                    'roas' => $sinRastreo ? null : $roas,
                    'order_ids' => $g['order_ids'],
                ];
            } elseif ($por === 'campaign') {
                $camp = $campanas[$k];
                $filas[] = [
                    'key' => $k,
                    'code' => $camp->code,
                    'name' => $camp->name,
                    'campaign_id' => $camp->id,
                    'campaign_name' => $camp->name,
                    'platform' => $camp->platform,
                    'plataforma' => self::PLATAFORMAS[$camp->platform] ?? $camp->platform,
                    'brand_id' => $camp->brand_id,
                    'brand_name' => $marcas[$camp->brand_id]->name ?? '—',
                    'creators_pen' => round((float) ($creadoresPorCampana[$k] ?? 0), 2),
                    'spend' => $spend,
                    'leads' => $leads,
                    'orders' => $orders,
                    'new_customers' => $newCust,
                    'collected' => $collected,
                    'cpl' => $cpl,
                    'cpo' => $cpo,
                    'cpn' => $cpn,
                    'roas' => $roas,
                    'order_ids' => $g['order_ids'],
                ];
            } else {
                $filas[] = [
                    'key' => $k,
                    'code' => $k,
                    'name' => self::PLATAFORMAS[$k] ?? $k,
                    'platform' => $k,
                    'plataforma' => self::PLATAFORMAS[$k] ?? $k,
                    'spend' => $spend,
                    'leads' => $leads,
                    'orders' => $orders,
                    'new_customers' => $newCust,
                    'collected' => $collected,
                    'cpl' => $cpl,
                    'cpo' => $cpo,
                    'cpn' => $cpn,
                    'roas' => $roas,
                    'order_ids' => $g['order_ids'],
                ];
            }
        }

        usort($filas, fn ($a, $b) => $b['spend'] <=> $a['spend']);
        $totSpend = round($totSpend, 2);
        $totCollected = round($totCollected, 2);

        return [
            'desde' => $desde,
            'hasta' => $hasta,
            'por' => $por,
            'data' => $filas,
            'totales' => [
                'spend' => $totSpend,
                'leads' => $totLeads,
                'orders' => $totOrders,
                'new_customers' => $totNew,
                'collected' => $totCollected,
                'cpl' => $totLeads > 0 ? round($totSpend / $totLeads, 2) : null,
                'cpo' => $totOrders > 0 ? round($totSpend / $totOrders, 2) : null,
                'cpn' => $totNew > 0 ? round($totSpend / $totNew, 2) : null,
                'roas' => $totSpend > 0 ? round($totCollected / $totSpend, 2) : null,
            ],
            'opciones' => [
                'campanas' => DB::table('ad_campaigns')->when($alcance, fn ($w) => $w->whereIn('brand_id', $alcance))->orderBy('name')->get(['id', 'name', 'platform'])->map(fn ($c) => ['value' => $c->id, 'label' => "{$c->name} · ".(self::PLATAFORMAS[$c->platform] ?? $c->platform)])->all(),
                'marcas' => DB::table('brands')->where('status', 'ACTIVE')->when($alcance, fn ($w) => $w->whereIn('id', $alcance))->orderBy('name')->get(['id', 'name'])->map(fn ($b) => ['value' => $b->id, 'label' => $b->name])->all(),
            ],
        ];
    }

    /** Detalle de los pedidos atribuidos a un anuncio o campaña (bajada al detalle desde ADS-05). */
    public static function pedidosDeResultado(array $f, User $u): array
    {
        [$desde, $hasta] = self::rangoPorDefecto($f);
        $q = DB::table('ad_attributions as at')
            ->join('sales_orders as o', 'o.id', '=', 'at.order_id')
            ->leftJoin('customers as cu', 'cu.id', '=', 'o.customer_id')
            ->whereNotIn('o.status', ['CANCELLED', 'DRAFT'])
            ->whereRaw("(at.attributed_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$desde, $hasta]);
        if (! empty($f['ad_id'])) {
            $q->where('at.ad_id', $f['ad_id']);
        }
        if (! empty($f['campaign_id'])) {
            $q->where('at.campaign_id', $f['campaign_id']);
        }
        $filas = $q->orderByDesc('o.created_at')->limit(100)->get([
            'o.id', 'o.number', 'o.created_at', 'o.status', 'cu.full_name', 'cu.trade_name', 'at.method', 'at.is_new_customer',
        ]);
        $cobrado = self::mapaCobradoPorPedido($filas->pluck('id')->all());

        return [
            'data' => $filas->map(fn ($x) => [
                'id' => $x->id,
                'number' => $x->number,
                'created_at' => $x->created_at,
                'customer' => $x->trade_name ?: $x->full_name ?: '—',
                'method' => $x->method,
                'metodo' => self::METODOS[$x->method] ?? $x->method,
                'is_new_customer' => (bool) $x->is_new_customer,
                'status' => $x->status,
                'collected' => (float) ($cobrado[$x->id] ?? 0),
            ])->all(),
        ];
    }

    /* ------------------------------------------------------------------ ADS-06 Embudo de atribución */

    public static function embudo(array $f, User $u): array
    {
        [$desde, $hasta] = self::rangoPorDefecto($f);
        $alcance = self::marcasAlcance($u);
        $marcas = self::marcasMapa();
        $anuncios = DB::table('ad_ads')->get()->keyBy('id')->all();

        $res = self::resultados(['desde' => $desde, 'hasta' => $hasta, 'marca' => $f['marca'] ?? null], $u);
        $tot = $res['totales'];

        $qPedidos = DB::table('sales_orders as o')
            ->leftJoin('customers as cu', 'cu.id', '=', 'o.customer_id')
            ->leftJoin('ad_attributions as at', 'at.order_id', '=', 'o.id')
            ->whereIn('o.channel', self::CANALES_DIGITALES)
            ->whereNotIn('o.status', ['CANCELLED', 'DRAFT'])
            ->whereRaw("(o.created_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$desde, $hasta]);
        if ($alcance) {
            $qPedidos->whereIn('o.brand_id', $alcance);
        }
        if (! empty($f['marca'])) {
            $qPedidos->where('o.brand_id', $f['marca']);
        }

        $digitales = $qPedidos->orderByDesc('o.created_at')->get([
            'o.id', 'o.number', 'o.created_at', 'o.channel', 'o.brand_id', 'o.status', 'o.customer_id',
            'cu.full_name', 'cu.trade_name',
            'at.ad_id', 'at.method', 'at.is_new_customer', 'at.manual_reason', 'at.corrected_by', 'at.corrected_at', 'at.previous',
        ]);

        $cobradoMapa = self::mapaCobradoPorPedido($digitales->pluck('id')->all());
        $sinAtribucion = [];
        $atribuidos = [];
        $porMetodo = array_fill_keys(array_keys(self::METODOS), 0);
        $pedidosConCobro = 0;

        foreach ($digitales as $d) {
            $tiene = ! empty($d->ad_id) && $d->method && $d->method !== 'NONE';
            $ad = $tiene ? ($anuncios[$d->ad_id] ?? null) : null;
            $metodo = $tiene ? $d->method : 'NONE';
            $porMetodo[$metodo] = ($porMetodo[$metodo] ?? 0) + 1;
            $cobrado = (float) ($cobradoMapa[$d->id] ?? 0);
            if ($tiene && $cobrado > 0) {
                $pedidosConCobro++;
            }

            $item = [
                'order_id' => $d->id,
                'number' => $d->number,
                'created_at' => $d->created_at,
                'channel' => $d->channel,
                'brand_id' => $d->brand_id,
                'brand_name' => $marcas[$d->brand_id]->name ?? '—',
                'customer' => $d->trade_name ?: $d->full_name ?: '—',
                'status' => $d->status,
                'ad_id' => $d->ad_id,
                'ad_label' => $ad ? (($ad->tracking_code ?: $ad->code).' · '.$ad->name) : '—',
                'method' => $metodo,
                'metodo' => self::METODOS[$metodo] ?? $metodo,
                'is_new_customer' => (bool) $d->is_new_customer,
                'manual_reason' => $d->manual_reason,
                'corrected_by' => $d->corrected_by,
                'corrected_at' => $d->corrected_at,
                'collected' => $cobrado,
            ];
            if ($tiene) {
                $atribuidos[] = $item;
            } else {
                $sinAtribucion[] = $item;
            }
        }

        $totalDig = count($digitales);
        $conAtrib = count($atribuidos);

        return [
            'desde' => $desde,
            'hasta' => $hasta,
            'pasos' => [
                'inversion' => $tot['spend'],
                'leads' => $tot['leads'],
                'pedidos' => $tot['orders'],
                'pedidos_con_cobro' => $pedidosConCobro,
                'cobrado' => $tot['collected'],
                'roas' => $tot['roas'],
            ],
            'cobertura' => [
                'digitales' => $totalDig,
                'con_atribucion' => $conAtrib,
                'sin_atribucion' => count($sinAtribucion),
                'cobertura_pct' => $totalDig > 0 ? round($conAtrib / $totalDig * 100, 1) : null,
                'ventana_dias' => (int) (Params::get('ads_attribution_window_days') ?? 30),
            ],
            'por_metodo' => collect(self::METODOS)->map(fn ($label, $code) => [
                'code' => $code,
                'label' => $label,
                'count' => (int) ($porMetodo[$code] ?? 0),
            ])->values()->all(),
            'sin_atribucion' => $sinAtribucion,
            'atribuidos' => $atribuidos,
            'opciones' => [
                'anuncios' => collect($anuncios)->map(fn ($a) => [
                    'value' => $a->id,
                    'label' => ($a->tracking_code ?: $a->code).' · '.$a->name.' · '.(self::PLATAFORMAS[$a->platform] ?? $a->platform),
                    'brand_id' => $a->brand_id,
                ])->values()->all(),
                'marcas' => DB::table('brands')->where('status', 'ACTIVE')->when($alcance, fn ($w) => $w->whereIn('id', $alcance))->orderBy('name')->get(['id', 'name'])->map(fn ($b) => ['value' => $b->id, 'label' => $b->name])->all(),
            ],
            'puede_corregir' => Access::can($u, 'ads.attribution.correct'),
        ];
    }

    /* ------------------------------------------------------------------ ADS-07 Facturas de plataformas (RN-ADS-08, CA-ADS-03) */

    public static function gastoImportadoCuenta(string $accountId, string $desde, string $hasta): float
    {
        $total = DB::table('ad_spend_daily as d')
            ->join('ad_campaigns as c', 'c.id', '=', 'd.campaign_id')
            ->where('c.account_id', $accountId)
            ->whereBetween('d.spend_date', [$desde, $hasta])
            ->sum('d.spend_pen');

        return round((float) ($total ?? 0), 2);
    }

    public static function toleranciaConciliacion(float $gastoImportadoPen): float
    {
        $fijo = (float) (Params::get('ads_reconcile_tolerance_pen') ?? 5);
        $pct = (float) (Params::get('ads_reconcile_tolerance_pct') ?? 2);

        return round(max($fijo, $gastoImportadoPen * $pct / 100), 2);
    }

    public static function listaFacturas(array $f, User $u): array
    {
        $alcance = self::marcasAlcance($u);
        $q = DB::table('ad_platform_invoices as i')
            ->join('ad_accounts as a', 'a.id', '=', 'i.account_id')
            ->join('brands as b', 'b.id', '=', 'i.brand_id')
            ->leftJoin('suppliers as s', 's.id', '=', 'i.supplier_id')
            ->leftJoin('expenses as e', 'e.id', '=', 'i.expense_id')
            ->leftJoin('users as ur', 'ur.id', '=', 'i.reconciled_by');
        if ($alcance) {
            $q->whereIn('i.brand_id', $alcance);
        }
        if (! empty($f['estado'])) {
            $q->where('i.status', $f['estado']);
        }
        if (! empty($f['cuenta'])) {
            $q->where('i.account_id', $f['cuenta']);
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('i.invoice_number', 'ilike', $p)->orWhere('a.name', 'ilike', $p));
        }

        $filas = $q->orderByDesc('i.issue_date')->orderByDesc('i.created_at')->get([
            'i.*', 'a.name as account_name', 'a.platform', 'b.name as brand_name',
            's.trade_name as supplier_trade', 's.legal_name as supplier_legal',
            'e.number as expense_number', 'ur.name as reconciled_by_name',
        ])->map(fn ($i) => [
            'id' => $i->id,
            'account_id' => $i->account_id,
            'account_name' => $i->account_name,
            'platform' => $i->platform,
            'plataforma' => self::PLATAFORMAS[$i->platform] ?? $i->platform,
            'brand_id' => $i->brand_id,
            'brand_name' => $i->brand_name,
            'supplier_id' => $i->supplier_id,
            'proveedor' => $i->supplier_trade ?: $i->supplier_legal ?: '—',
            'invoice_number' => $i->invoice_number,
            'doc_type' => $i->doc_type,
            'issue_date' => $i->issue_date,
            'period_from' => $i->period_from,
            'period_to' => $i->period_to,
            'currency' => $i->currency,
            'amount' => (float) $i->amount,
            'exchange_rate' => (float) $i->exchange_rate,
            'amount_pen' => (float) $i->amount_pen,
            'imported_spend_pen' => $i->imported_spend_pen !== null ? (float) $i->imported_spend_pen : null,
            'difference_pen' => $i->difference_pen !== null ? (float) $i->difference_pen : null,
            'tolerance_pen' => $i->tolerance_pen !== null ? (float) $i->tolerance_pen : null,
            'status' => $i->status,
            'estado' => self::ESTADOS_FACTURA[$i->status] ?? $i->status,
            'expense_id' => $i->expense_id,
            'expense_number' => $i->expense_number,
            'reconciled_by_name' => $i->reconciled_by_name,
            'reconciled_at' => $i->reconciled_at,
            'note' => $i->note,
        ])->all();

        return [
            'data' => $filas,
            'cifras' => [
                'total' => count($filas),
                'conciliadas' => count(array_filter($filas, fn ($x) => $x['status'] === 'RECONCILED')),
                'observadas' => count(array_filter($filas, fn ($x) => $x['status'] === 'OBSERVED')),
                'pendientes' => count(array_filter($filas, fn ($x) => $x['status'] === 'PENDING')),
                'por_enviar_gas' => count(array_filter($filas, fn ($x) => $x['status'] === 'RECONCILED' && ! $x['expense_id'])),
            ],
            'tolerancia_fija_pen' => (float) (Params::get('ads_reconcile_tolerance_pen') ?? 5),
            'tolerancia_pct' => (float) (Params::get('ads_reconcile_tolerance_pct') ?? 2),
            'opciones' => [
                'cuentas' => DB::table('ad_accounts')->when($alcance, fn ($w) => $w->whereIn('brand_id', $alcance))->orderBy('name')->get(['id', 'name', 'currency'])->map(fn ($a) => ['value' => $a->id, 'label' => "{$a->name} ({$a->currency})", 'currency' => $a->currency])->all(),
            ],
            'puede' => Access::can($u, 'ads.invoice.reconcile'),
        ];
    }

    /** Registra y concilia una factura de plataforma (RN-ADS-08, CA-ADS-03). */
    public static function registrarFactura(array $d, User $u): array
    {
        if (! Access::can($u, 'ads.invoice.reconcile')) {
            RuleError::fail('RN-ADS-08', 'Conciliar facturas de plataformas exige el permiso ads.invoice.reconcile.');
        }
        $acc = DB::table('ad_accounts')->where('id', $d['account_id'])->first() ?? RuleError::fail('RN-ADS-08', 'Elige una cuenta publicitaria válida.');
        $numero = trim((string) $d['invoice_number']);
        if ($numero === '') {
            RuleError::fail('RN-ADS-08', 'Indica el número de la factura o recibo.');
        }
        if (DB::table('ad_platform_invoices')->where('account_id', $acc->id)->whereRaw('upper(btrim(invoice_number)) = ?', [strtoupper($numero)])->exists()) {
            RuleError::fail('RN-ADS-08', "La factura {$numero} ya está registrada para {$acc->name}.");
        }
        $desde = $d['period_from'];
        $hasta = $d['period_to'];
        if ($hasta < $desde) {
            RuleError::fail('RN-ADS-08', 'La fecha final del período no puede ser anterior a la inicial.');
        }
        $monto = round((float) $d['amount'], 2);
        if ($monto < 0) {
            RuleError::fail('RN-ADS-08', 'El monto de la factura debe ser mayor o igual a cero.');
        }
        $fechaEmision = $d['issue_date'] ?? self::hoy();
        $moneda = $d['currency'] ?? $acc->currency;
        $tc = $moneda === 'PEN' ? 1.0 : (! empty($d['exchange_rate']) ? (float) $d['exchange_rate'] : self::tcVenta($fechaEmision, $moneda));
        $montoPen = round($monto * $tc, 2);

        $id = DB::table('ad_platform_invoices')->insertGetId([
            'account_id' => $acc->id,
            'supplier_id' => $acc->supplier_id,
            'brand_id' => $acc->brand_id,
            'invoice_number' => mb_substr($numero, 0, 60),
            'doc_type' => 'FOREIGN_INVOICE',
            'issue_date' => $fechaEmision,
            'period_from' => $desde,
            'period_to' => $hasta,
            'currency' => $moneda,
            'amount' => $monto,
            'exchange_rate' => $tc,
            'amount_pen' => $montoPen,
            'status' => 'PENDING',
            'note' => isset($d['note']) && trim((string) $d['note']) !== '' ? mb_substr(trim((string) $d['note']), 0, 500) : null,
            'created_at' => now(),
            'updated_at' => now(),
        ], 'id');

        $conciliada = self::conciliarFactura($id, $u, $d['note'] ?? null);
        if (($conciliada['status'] ?? '') === 'RECONCILED' && ! empty($d['send_to_gas'])) {
            return self::enviarFacturaAGas($id, $u);
        }

        return $conciliada;
    }

    /** Concilia una factura frente al gasto importado de su cuenta en el período (RN-ADS-08, CA-ADS-03). */
    public static function conciliarFactura(string $id, User $u, ?string $nota = null): array
    {
        if (! Access::can($u, 'ads.invoice.reconcile')) {
            RuleError::fail('RN-ADS-08', 'Conciliar facturas de plataformas exige el permiso ads.invoice.reconcile.');
        }
        $inv = DB::table('ad_platform_invoices')->where('id', $id)->first() ?? abort(404);
        $importado = self::gastoImportadoCuenta($inv->account_id, $inv->period_from, $inv->period_to);
        $tolerancia = self::toleranciaConciliacion($importado);
        $diferencia = round((float) $inv->amount_pen - $importado, 2);
        $estado = abs($diferencia) <= $tolerancia + 0.0001 ? 'RECONCILED' : 'OBSERVED';
        $notaFinal = $nota !== null && trim($nota) !== ''
            ? mb_substr(trim($nota), 0, 500)
            : ($inv->note ?: ($estado === 'OBSERVED' ? 'Diferencia mayor a la tolerancia: revisar ajustes y créditos de la plataforma.' : null));

        DB::table('ad_platform_invoices')->where('id', $id)->update([
            'imported_spend_pen' => $importado,
            'difference_pen' => $diferencia,
            'tolerance_pen' => $tolerancia,
            'status' => $estado,
            'reconciled_by' => $u->id,
            'reconciled_at' => now(),
            'note' => $notaFinal,
            'updated_at' => now(),
        ]);
        Events::emit('ads.invoice_reconciled', 'ad_platform_invoices', $id, ['status' => $estado, 'difference_pen' => $diferencia, 'tolerance_pen' => $tolerancia]);

        $actualizada = DB::table('ad_platform_invoices')->where('id', $id)->first();

        return (array) $actualizada;
    }

    /** Envía una factura conciliada a GAS como gasto aprobado de publicidad con documento FOREIGN_INVOICE (RN-ADS-08, D-ADS-04). */
    public static function enviarFacturaAGas(string $id, User $u): array
    {
        if (! Access::can($u, 'ads.invoice.reconcile')) {
            RuleError::fail('RN-ADS-08', 'Enviar facturas conciliadas a Gastos exige el permiso ads.invoice.reconcile.');
        }
        $inv = DB::table('ad_platform_invoices')->where('id', $id)->first() ?? abort(404);
        if ($inv->status !== 'RECONCILED') {
            RuleError::fail('RN-ADS-08', 'Solo una factura conciliada puede enviarse a Gastos.');
        }
        if ($inv->expense_id) {
            return (array) $inv;
        }
        $acc = DB::table('ad_accounts')->where('id', $inv->account_id)->first();
        $local = DB::table('establishments')->where('status', 'ACTIVE')->orderBy('code')->first();
        Periodos::abierto($inv->issue_date, $local->company_id);

        $cc = DB::table('cost_centers')->where('brand_id', $inv->brand_id)->where('status', 'ACTIVE')->orderBy('code')->first()
            ?? DB::table('cost_centers')->where('status', 'ACTIVE')->orderBy('code')->first();
        $cat = DB::table('expense_categories')->where('category_group', 'ADVERTISING')->where('status', 'ACTIVE')->first();
        $prov = $inv->supplier_id ? DB::table('suppliers')->where('id', $inv->supplier_id)->first() : null;
        $platNombre = self::PLATAFORMAS[$acc->platform ?? ''] ?? ($acc->platform ?? 'Plataforma');

        $expenseId = DB::transaction(function () use ($inv, $acc, $local, $cc, $cat, $prov, $platNombre, $u) {
            $num = GasBase::numero('expenses', 'GS-');
            $eid = DB::table('expenses')->insertGetId([
                'number' => $num,
                'company_id' => $local->company_id,
                'establishment_id' => $local->id,
                'cost_center_id' => $cc->id,
                'brand_id' => $inv->brand_id,
                'category_id' => $cat?->id,
                'category_code' => $cat?->code ?? 'ADVERTISING',
                'supplier_id' => $prov?->id,
                'supplier_doc' => $prov?->doc_number,
                'supplier_name' => $prov ? ($prov->trade_name ?: $prov->legal_name) : $platNombre,
                'doc_type' => 'FOREIGN_INVOICE',
                'doc_series' => null,
                'doc_number' => $inv->invoice_number,
                'issue_date' => $inv->issue_date,
                'currency' => $inv->currency,
                'exchange_rate' => $inv->exchange_rate,
                'subtotal' => $inv->amount,
                'igv' => 0,
                'other_taxes' => 0,
                'total' => $inv->amount,
                'withholding_amount' => 0,
                'amount_pen' => $inv->amount_pen,
                'net_pen' => $inv->amount_pen,
                'description' => "Publicidad {$platNombre} {$inv->period_from} al {$inv->period_to} ({$acc->name})",
                'status' => 'APPROVED',
                'source_module' => 'ADS',
                'pay_source' => 'PAYABLE',
                'accounting_flag' => 'OK',
                'created_by' => $u->id,
                'approved_by' => $u->id,
                'approved_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ], 'id');
            DB::table('ad_platform_invoices')->where('id', $inv->id)->update([
                'expense_id' => $eid,
                'sent_to_gas_at' => now(),
                'updated_at' => now(),
            ]);

            return $eid;
        });

        $gasto = DB::table('expenses')->where('id', $expenseId)->first();
        Events::emit('ad_invoice.reconciled', 'ad_platform_invoices', $inv->id, ['expense_id' => $expenseId, 'number' => $gasto->number]);

        return (array) DB::table('ad_platform_invoices')->where('id', $inv->id)->first() + ['expense_number' => $gasto->number];
    }

    /* ------------------------------------------------------------------ ADS-08 Creadores de contenido (RN-ADS-10) */

    public static function creadores(array $f, User $u): array
    {
        [$desde, $hasta] = self::rangoPorDefecto($f);
        $alcance = self::marcasAlcance($u);

        $q = DB::table('expenses as e')
            ->join('ad_campaigns as c', 'c.id', '=', 'e.ad_campaign_id')
            ->join('brands as b', 'b.id', '=', 'e.brand_id')
            ->leftJoin('suppliers as s', 's.id', '=', 'e.supplier_id')
            ->whereNotNull('e.ad_campaign_id')
            ->whereBetween('e.issue_date', [$desde, $hasta]);
        if ($alcance) {
            $q->whereIn('e.brand_id', $alcance);
        }
        if (! empty($f['marca'])) {
            $q->where('e.brand_id', $f['marca']);
        }
        if (! empty($f['estado'])) {
            $q->where('e.status', $f['estado']);
        }

        $gastos = $q->orderByDesc('e.issue_date')->orderByDesc('e.number')->get([
            'e.*', 'c.name as campaign_name', 'c.platform', 'b.name as brand_name',
            's.trade_name as supplier_trade', 's.legal_name as supplier_legal',
        ]);

        // Si GAS tiene gastos propios (sin demo_fallback), ignorar los demo_fallback
        $propios = $gastos->filter(fn ($e) => empty($e->demo_fallback));
        $base = $propios->isNotEmpty() ? $propios : $gastos;

        $aprobados = $base->filter(fn ($e) => in_array($e->status, ['APPROVED', 'PAID'], true));
        $porCampana = $aprobados->groupBy('ad_campaign_id');

        $gastoAdsPorCampana = DB::table('ad_spend_daily')
            ->whereBetween('spend_date', [$desde, $hasta])
            ->groupBy('campaign_id')
            ->selectRaw('campaign_id, coalesce(sum(spend_pen), 0) as pen')
            ->pluck('pen', 'campaign_id')
            ->all();

        $resumenCampanas = [];
        foreach ($porCampana as $cid => $items) {
            $primero = $items->first();
            $crPen = round((float) $items->sum('amount_pen'), 2);
            $adsPen = round((float) ($gastoAdsPorCampana[$cid] ?? 0), 2);
            $total = round($crPen + $adsPen, 2);
            $resumenCampanas[] = [
                'campaign_id' => $cid,
                'campaign_name' => $primero->campaign_name,
                'platform' => $primero->platform,
                'plataforma' => self::PLATAFORMAS[$primero->platform] ?? $primero->platform,
                'brand_name' => $primero->brand_name,
                'creators_pen' => $crPen,
                'ads_spend_pen' => $adsPen,
                'total_cost_pen' => $total,
                'weight_pct' => $total > 0 ? round($crPen / $total * 100, 1) : null,
                'count' => $items->count(),
            ];
        }

        $filas = $base->values()->map(fn ($e) => [
            'id' => $e->id,
            'number' => $e->number,
            'issue_date' => $e->issue_date,
            'creador' => $e->supplier_trade ?: $e->supplier_legal ?: $e->supplier_name ?: '—',
            'doc' => trim(($e->doc_series ? "{$e->doc_series}-" : '').($e->doc_number ?? '')),
            'campaign_id' => $e->ad_campaign_id,
            'campaign_name' => $e->campaign_name,
            'platform' => $e->platform,
            'plataforma' => self::PLATAFORMAS[$e->platform] ?? $e->platform,
            'brand_name' => $e->brand_name,
            'description' => $e->description,
            'amount_pen' => (float) $e->amount_pen,
            'withholding_amount' => (float) ($e->withholding_amount ?? 0),
            'status' => $e->status,
            'estado' => GasBase::ESTADOS[$e->status] ?? $e->status,
        ])->all();

        return [
            'desde' => $desde,
            'hasta' => $hasta,
            'data' => $filas,
            'por_campana' => $resumenCampanas,
            'cifras' => [
                'costo_aprobado_pen' => round((float) $aprobados->sum('amount_pen'), 2),
                'campanas_con_creadores' => count($resumenCampanas),
                'pendientes_aprobar' => $base->filter(fn ($e) => ! in_array($e->status, ['APPROVED', 'PAID', 'REJECTED', 'VOIDED'], true))->count(),
            ],
            'opciones' => [
                'creadores' => DB::table('suppliers')->where('supplier_type', 'CONTENT_CREATOR')->where('status', 'ACTIVE')->orderBy('legal_name')->get(['id', 'trade_name', 'legal_name', 'doc_number'])->map(fn ($s) => ['value' => $s->id, 'label' => ($s->trade_name ?: $s->legal_name)." · RUC {$s->doc_number}"])->all(),
                'campanas' => DB::table('ad_campaigns')->when($alcance, fn ($w) => $w->whereIn('brand_id', $alcance))->orderBy('name')->get(['id', 'name', 'platform'])->map(fn ($c) => ['value' => $c->id, 'label' => "{$c->name} · ".(self::PLATAFORMAS[$c->platform] ?? $c->platform)])->all(),
                'marcas' => DB::table('brands')->where('status', 'ACTIVE')->when($alcance, fn ($w) => $w->whereIn('id', $alcance))->orderBy('name')->get(['id', 'name'])->map(fn ($b) => ['value' => $b->id, 'label' => $b->name])->all(),
            ],
            'puede_registrar' => Access::can($u, 'ads.account.manage') || Access::module($u, 'GAS', 'C'),
        ];
    }

    /** Registra un gasto de creador de contenido en GAS con recibo por honorarios y campaña obligatoria (RN-ADS-10, RN-GAS-03). */
    public static function registrarGastoCreador(array $d, User $u): array
    {
        if (empty($d['ad_campaign_id'])) {
            RuleError::fail('RN-ADS-10', 'El gasto de un creador de contenido exige la campaña publicitaria.');
        }
        $camp = DB::table('ad_campaigns')->where('id', $d['ad_campaign_id'])->first() ?? RuleError::fail('RN-ADS-10', 'La campaña seleccionada no existe.');
        $sup = DB::table('suppliers')->where('id', $d['supplier_id'] ?? '')->first();
        if (! $sup || $sup->supplier_type !== 'CONTENT_CREATOR') {
            RuleError::fail('RN-ADS-10', 'El proveedor debe ser un creador de contenido activo.');
        }
        $numero = trim((string) ($d['doc_number'] ?? ''));
        if ($numero === '') {
            RuleError::fail('RN-ADS-10', 'Falta el número del recibo por honorarios.');
        }
        $monto = round((float) ($d['amount'] ?? 0), 2);
        if ($monto <= 0) {
            RuleError::fail('RN-ADS-10', 'El monto debe ser mayor que cero.');
        }
        $fecha = $d['issue_date'] ?? self::hoy();
        $local = DB::table('establishments')->where('status', 'ACTIVE')->orderBy('code')->first();
        Periodos::abierto($fecha, $local->company_id);

        $cc = DB::table('cost_centers')->where('brand_id', $camp->brand_id)->where('status', 'ACTIVE')->orderBy('code')->first()
            ?? DB::table('cost_centers')->where('status', 'ACTIVE')->orderBy('code')->first();
        $cat = DB::table('expense_categories')->where('category_group', 'CONTENT_CREATORS')->where('status', 'ACTIVE')->first();
        $retencion = $monto > 1500 ? round($monto * 0.08, 2) : 0.0;

        $id = DB::transaction(function () use ($camp, $sup, $numero, $monto, $retencion, $fecha, $local, $cc, $cat, $d, $u) {
            $numGasto = GasBase::numero('expenses', 'GS-');

            return DB::table('expenses')->insertGetId([
                'number' => $numGasto,
                'company_id' => $local->company_id,
                'establishment_id' => $local->id,
                'cost_center_id' => $cc->id,
                'brand_id' => $camp->brand_id,
                'category_id' => $cat?->id,
                'category_code' => $cat?->code ?? 'CONTENT_CREATORS',
                'supplier_id' => $sup->id,
                'supplier_doc' => $sup->doc_number,
                'supplier_name' => $sup->trade_name ?: $sup->legal_name,
                'doc_type' => 'FEES_RECEIPT',
                'doc_series' => 'E001',
                'doc_number' => mb_substr($numero, 0, 20),
                'issue_date' => $fecha,
                'currency' => 'PEN',
                'exchange_rate' => 1,
                'subtotal' => $monto,
                'igv' => 0,
                'other_taxes' => 0,
                'total' => $monto,
                'withholding_amount' => $retencion,
                'amount_pen' => $monto,
                'net_pen' => $monto,
                'ad_campaign_id' => $camp->id,
                'description' => isset($d['description']) && trim((string) $d['description']) !== '' ? mb_substr(trim((string) $d['description']), 0, 500) : "Contenido para {$camp->name}",
                'status' => 'SUBMITTED',
                'submitted_at' => now(),
                'source_module' => 'ADS',
                'pay_source' => 'PAYABLE',
                'accounting_flag' => 'OK',
                'created_by' => $u->id,
                'created_at' => now(),
                'updated_at' => now(),
            ], 'id');
        });

        $gasto = DB::table('expenses')->where('id', $id)->first();
        Events::emit('ads.creator_expense_created', 'expenses', $id, ['number' => $gasto->number, 'campaign_id' => $camp->id, 'amount_pen' => $monto]);

        return ['id' => $id, 'number' => $gasto->number];
    }

    /* ------------------------------------------------------------------ ADS-09 Comparativo de plataformas (RN-ADS-11, KPI-ADS-06 y 09) */

    public static function comparativo(array $f, User $u): array
    {
        if (! Access::can($u, 'ads.result.view') && ! Access::can($u, 'ads.account.manage')) {
            abort(403, 'Ver el comparativo de plataformas exige el permiso ads.result.view.');
        }
        [$desde, $hasta] = self::rangoPorDefecto($f);
        $alcance = self::marcasAlcance($u);
        $marca = $f['marca'] ?? null;

        $resPlat = self::resultados(['desde' => $desde, 'hasta' => $hasta, 'marca' => $marca, 'por' => 'platform'], $u);
        $porPlat = collect($resPlat['data'])->keyBy('platform')->all();
        $tot = $resPlat['totales'];
        $ventasCobradasTotales = self::totalCobradoPeriodo($desde, $hasta, $marca, $alcance);

        $leadsQ = DB::table('ad_attributions')
            ->where('lead_origin', true)
            ->whereRaw("(coalesce(lead_at, attributed_at) AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$desde, $hasta]);
        if ($marca) {
            $leadsQ->where('brand_id', $marca);
        } elseif ($alcance) {
            $leadsQ->whereIn('brand_id', $alcance);
        }
        $leads = $leadsQ->get(['platform', 'method']);
        $totalLeads = $leads->count();
        $leadsCtwaTotal = $leads->where('method', 'CTWA_REFERRAL')->count();

        $plataformas = [];
        foreach (self::PLATAFORMAS as $code => $nombre) {
            $r = $porPlat[$code] ?? ['spend' => 0.0, 'leads' => 0, 'orders' => 0, 'new_customers' => 0, 'collected' => 0.0, 'cpo' => null, 'cpn' => null, 'roas' => null];
            $leadsPlat = $leads->where('platform', $code);
            $ctwaPlat = $leadsPlat->where('method', 'CTWA_REFERRAL')->count();

            $plataformas[] = [
                'platform' => $code,
                'name' => $nombre,
                'spend' => (float) $r['spend'],
                'leads' => (int) $r['leads'],
                'orders' => (int) $r['orders'],
                'new_customers' => (int) $r['new_customers'],
                'collected' => (float) $r['collected'],
                'roas' => $r['roas'],
                'cpo' => $r['cpo'],
                'cpn' => $r['cpn'],
                'share_of_sales_pct' => $ventasCobradasTotales > 0 ? round((float) $r['spend'] / $ventasCobradasTotales * 100, 2) : null,
                'ctwa_leads_pct' => $leadsPlat->count() > 0 ? round($ctwaPlat / $leadsPlat->count() * 100, 1) : null,
            ];
        }

        // Retorno por marca y plataforma
        $resAnuncios = self::resultados(['desde' => $desde, 'hasta' => $hasta, 'marca' => $marca, 'por' => 'ad'], $u)['data'];
        $matriz = [];
        foreach ($resAnuncios as $ra) {
            $k = $ra['brand_id'].'|'.$ra['platform'];
            $matriz[$k] ??= ['spend' => 0.0, 'collected' => 0.0];
            $matriz[$k]['spend'] += $ra['spend'];
            $matriz[$k]['collected'] += $ra['collected'];
        }
        $marcasLista = DB::table('brands')->where('status', 'ACTIVE')
            ->when($marca, fn ($w) => $w->where('id', $marca))
            ->when($alcance, fn ($w) => $w->whereIn('id', $alcance))
            ->orderBy('name')->get(['id', 'name']);

        $porMarca = $marcasLista->map(function ($b) use ($matriz) {
            $fila = ['brand_id' => $b->id, 'brand_name' => $b->name];
            foreach (array_keys(self::PLATAFORMAS) as $p) {
                $m = $matriz[$b->id.'|'.$p] ?? null;
                $fila[$p] = $m && $m['spend'] > 0 ? round($m['collected'] / $m['spend'], 2) : null;
            }

            return $fila;
        })->all();

        return [
            'desde' => $desde,
            'hasta' => $hasta,
            'cifras' => [
                'inversion_total' => $tot['spend'],
                'ventas_cobradas_totales' => $ventasCobradasTotales,
                'inversion_sobre_ventas_pct' => $ventasCobradasTotales > 0 ? round($tot['spend'] / $ventasCobradasTotales * 100, 2) : null,
                'leads_ctwa_pct' => $totalLeads > 0 ? round($leadsCtwaTotal / $totalLeads * 100, 1) : null,
            ],
            'plataformas' => $plataformas,
            'por_marca' => $porMarca,
            'opciones' => [
                'marcas' => DB::table('brands')->where('status', 'ACTIVE')->when($alcance, fn ($w) => $w->whereIn('id', $alcance))->orderBy('name')->get(['id', 'name'])->map(fn ($b) => ['value' => $b->id, 'label' => $b->name])->all(),
            ],
        ];
    }
}
