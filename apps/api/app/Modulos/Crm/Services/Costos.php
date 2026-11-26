<?php

namespace App\Modulos\Crm\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Params;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * CRM-11 Costo de WhatsApp (RN-CRM-13, KPI-CRM-08). Cada mensaje entregado guardó su costo con la tarifa usada; aquí se
 * suma por número, marca, vendedora y pedido, con la cuota de 1000 respuestas gratis por número, lo ahorrado por las
 * ventanas de anuncio y la proyección del mes. El simulador calcula un mes con las mismas tarifas, mensaje a mensaje.
 */
class Costos
{
    /** @return array{marketing: float, utilidad: float, servicio: float, autenticacion: float, cuota: int, desde: string} */
    public static function tarifas(): array
    {
        $n = fn (string $k, float $d) => (float) str_replace(',', '.', (string) (Params::get($k) ?? $d));

        return ['marketing' => $n('crm_wa_rate_marketing', 0.2339), 'utilidad' => $n('crm_wa_rate_utility', 0.0998), 'servicio' => $n('crm_wa_rate_service', 0.0998),
            'autenticacion' => $n('crm_wa_rate_authentication', 0.0998), 'cuota' => (int) (Params::get('crm_wa_service_free_per_number') ?? 1000),
            'desde' => (string) (Params::get('crm_wa_rates_valid_from') ?? '2026-10-01')];
    }

    /** CRM-11: el mes elegido (por defecto, el último con cobros). */
    public static function resumen(array $f, User $u): array
    {
        $a = Access::for($u);
        $meses = DB::table('message_charges')->selectRaw("to_char(period, 'YYYY-MM') AS m")->distinct()->orderByDesc('m')->pluck('m')->all();
        $actual = now('America/Lima')->format('Y-m');
        $todos = array_values(array_unique(array_merge($meses ? [$meses[0]] : [], [$actual], $meses)));
        $mes = in_array($f['mes'] ?? '', $todos, true) ? $f['mes'] : ($meses[0] ?? $actual);
        $inicio = Carbon::createFromFormat('Y-m-d', "{$mes}-01", 'America/Lima')->startOfDay();
        $fin = $inicio->copy()->endOfMonth();

        $q = DB::table('message_charges as g')->where('g.period', $inicio->toDateString())->when($a['brands'], fn ($w) => $w->whereIn('g.brand_id', $a['brands']))
            ->when(! empty($f['marca']), fn ($w) => $w->where('g.brand_id', $f['marca']));
        $t = self::tarifas();
        $tot = (clone $q)->selectRaw("count(*) AS n, count(*) FILTER (WHERE billable) AS cobrados, coalesce(sum(amount), 0) AS total,
            count(*) FILTER (WHERE reason = 'FREE_CTWA_WINDOW') AS gratis_anuncio, count(*) FILTER (WHERE reason = 'FREE_SERVICE_QUOTA') AS gratis_cuota,
            count(*) FILTER (WHERE reason = 'FREE_UTILITY_IN_WINDOW') AS gratis_utilidad,
            coalesce(sum(CASE WHEN reason = 'FREE_CTWA_WINDOW' THEN CASE category WHEN 'MARKETING' THEN ?::numeric WHEN 'AUTHENTICATION' THEN ?::numeric WHEN 'UTILITY' THEN ?::numeric ELSE ?::numeric END ELSE 0 END), 0) AS ahorro",
            [$t['marketing'], $t['autenticacion'], $t['utilidad'], $t['servicio']])->first();
        $hoy = now('America/Lima');
        $dias = $inicio->daysInMonth;
        $transcurridos = $mes === $hoy->format('Y-m') ? $hoy->day : $dias;
        $pedidos = DB::table('sales_orders')->where('channel', 'WHATSAPP')->whereIn('status', ['DELIVERED', 'CLOSED'])
            ->whereBetween(DB::raw("coalesce(delivered_at, delivery_date::timestamptz)"), [$inicio, $fin])->when($a['brands'], fn ($w) => $w->whereIn('brand_id', $a['brands']))
            ->when(! empty($f['marca']), fn ($w) => $w->where('brand_id', $f['marca']))->count();

        $agrupar = fn (string $col) => (clone $q)->selectRaw("g.{$col} AS clave, count(*) AS n, count(*) FILTER (WHERE category = 'SERVICE') AS servicio,
            count(*) FILTER (WHERE category = 'UTILITY') AS utilidad, count(*) FILTER (WHERE category = 'MARKETING') AS marketing,
            count(*) FILTER (WHERE reason = 'FREE_CTWA_WINDOW') AS gratis_anuncio, count(*) FILTER (WHERE billable) AS cobrados, coalesce(sum(amount), 0) AS costo")
            ->groupBy("g.{$col}")->orderByDesc('costo')->get();
        $fila = fn ($r, string $nombre, array $mas = []) => ['id' => $r->clave ?? 'ninguno', 'nombre' => $nombre, 'mensajes' => (int) $r->n, 'servicio' => (int) $r->servicio,
            'utilidad' => (int) $r->utilidad, 'marketing' => (int) $r->marketing, 'gratis_anuncio' => (int) $r->gratis_anuncio, 'cobrados' => (int) $r->cobrados, 'costo' => round((float) $r->costo, 4)] + $mas;

        $canales = DB::table('messaging_channels')->get(['id', 'display_name', 'number', 'free_service_quota'])->keyBy('id');
        $usadas = (clone $q)->where('category', 'SERVICE')->whereIn('reason', ['FREE_SERVICE_QUOTA', 'CHARGED'])->selectRaw('channel_id, count(*) AS n')->groupBy('channel_id')->pluck('n', 'channel_id');
        $marcas = DB::table('brands')->pluck('name', 'id');
        $personas = DB::table('users')->pluck('name', 'id');
        $ped = DB::table('sales_orders as o')->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')->get(['o.id', 'o.number', 'c.full_name'])->keyBy('id');

        return [
            'mes' => $mes, 'meses' => array_map(fn ($m) => ['value' => $m, 'label' => ucfirst(Carbon::createFromFormat('Y-m-d', "{$m}-01")->locale('es')->translatedFormat('F Y'))], $todos),
            'cifras' => [
                'total' => round((float) $tot->total, 4), 'mensajes' => (int) $tot->n, 'cobrados' => (int) $tot->cobrados,
                'proyeccion' => $transcurridos ? round((float) $tot->total / $transcurridos * $dias, 2) : 0.0, 'dias' => $dias, 'transcurridos' => $transcurridos,
                'gratis_anuncio' => (int) $tot->gratis_anuncio, 'ahorro_anuncio' => round((float) $tot->ahorro, 4), 'gratis_cuota' => (int) $tot->gratis_cuota,
                'gratis_utilidad' => (int) $tot->gratis_utilidad, 'pedidos' => $pedidos, 'por_pedido' => $pedidos ? round((float) $tot->total / $pedidos, 4) : null,
            ],
            'por_numero' => $agrupar('channel_id')->map(fn ($r) => $fila($r, ($canales[$r->clave]->display_name ?? '—').' · '.($canales[$r->clave]->number ?? ''),
                ['usadas' => (int) ($usadas[$r->clave] ?? 0), 'cuota' => (int) ($canales[$r->clave]->free_service_quota ?? $t['cuota'])]))->values()->all(),
            'por_marca' => $agrupar('brand_id')->map(fn ($r) => $fila($r, $marcas[$r->clave] ?? '—'))->values()->all(),
            'por_vendedora' => $agrupar('user_id')->map(fn ($r) => $fila($r, $r->clave ? ($personas[$r->clave] ?? '—') : 'Automáticos (sistema)'))->values()->all(),
            'por_pedido' => $agrupar('order_id')->map(fn ($r) => $fila($r, $r->clave ? ($ped[$r->clave]->number ?? '—') : 'Sin pedido', ['cliente' => $r->clave ? ($ped[$r->clave]->full_name ?? null) : null]))->values()->all(),
            'tarifas' => $t,
            'marcas' => DB::table('brands')->when($a['brands'], fn ($w) => $w->whereIn('id', $a['brands']))->orderBy('name')->get(['id as value', 'name as label'])->all(),
        ];
    }

    /**
     * CA-CRM-05: el mes calculado mensaje a mensaje con las mismas reglas (cuota de respuestas gratis por número,
     * utilidad fuera de ventana, ventana gratuita de 72 h por anuncio de clic a WhatsApp).
     *
     * @return array{servicio: float, utilidad: float, total: float}
     */
    public static function simular(int $pedidos, int $numeros, int $respuestas, int $utilidades, float $porAnuncio): array
    {
        $t = self::tarifas();
        $numeros = max(1, $numeros);
        $conAnuncio = (int) round($pedidos * max(0.0, min(1.0, $porAnuncio)));
        $servidas = array_fill(0, $numeros, 0);
        $servicio = 0.0;
        $utilidad = 0.0;
        for ($i = 0; $i < $pedidos; $i++) {
            $n = $i % $numeros;
            $anuncio = $i < $conAnuncio;
            for ($k = 0; $k < $respuestas; $k++) {
                if ($anuncio) {
                    continue;   // gratis y no cuenta para la cuota
                }
                if ($servidas[$n] >= $t['cuota']) {
                    $servicio += $t['servicio'];
                }
                $servidas[$n]++;
            }
            if (! $anuncio) {
                $utilidad += $utilidades * $t['utilidad'];
            }
        }

        return ['servicio' => round($servicio, 2), 'utilidad' => round($utilidad, 2), 'total' => round($servicio + $utilidad, 2)];
    }
}
