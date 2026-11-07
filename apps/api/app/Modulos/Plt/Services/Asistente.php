<?php

namespace App\Modulos\Plt\Services;

use App\Http\Controllers\TenantController;
use App\Support\Params;
use Illuminate\Support\Facades\DB;

/**
 * Asistente de configuración inicial (PLT-14). No guarda nada: revisa los datos reales del
 * cliente y marca cada comprobación como lista o pendiente, con el detalle y la pantalla donde se
 * completa. Todo pasa por RLS: solo los datos del cliente de la sesión.
 */
final class Asistente
{
    private const AREAS = [
        'PRODUCTION' => 'Producción', 'QUALITY' => 'Calidad', 'WAREHOUSE' => 'Almacén', 'DELIVERY' => 'Delivery', 'SALES' => 'Ventas',
        'MARKETING' => 'Marketing', 'ADMIN' => 'Administración', 'FINANCE' => 'Finanzas', 'HR' => 'RR. HH.',
    ];

    public static function pasos(): array
    {
        $empresas = DB::table('companies')->where('status', '!=', 'INACTIVE')->orderBy('created_at')->get();
        $marcas = DB::table('brands')->where('status', 'ACTIVE')->orderBy('sort_order')->get();
        $locales = DB::table('establishments')->where('status', '!=', 'INACTIVE')->get();
        $centros = DB::table('cost_centers')->where('status', 'ACTIVE')->get();
        $series = DB::table('document_series')->where('status', 'ACTIVE')->get();
        $usuarios = DB::table('users')->where('status', 'ACTIVE')->get(['id', 'role']);
        $medios = DB::table('payment_methods')->where('status', 'ACTIVE')->pluck('code')->all();
        $modulos = Modulos::catalogo();
        $on = Modulos::encendidos();
        $tel = DB::table('tenant_modules')->where('module_code', 'TEL')->first();
        $c = fn (string $label, bool $ok, ?string $detalle = null) => ['label' => $label, 'ok' => $ok, 'detalle' => $detalle];
        $de = fn (int $n, int $total) => "{$n} de {$total}";

        // Colores generales y marca principal (PLT-06).
        $general = Temas::propio(null);
        $generalOk = $general && ! array_filter(Temas::revisar($general->light, $general->dark), fn ($r) => ! $r['ok']);
        $principal = $marcas->first();

        $vendedoras = $usuarios->where('role', 'VENDEDORA');
        $conMarca = DB::table('user_scopes')->whereIn('user_id', $vendedoras->pluck('id'))->whereNotNull('brand_id')->distinct()->pluck('user_id');
        $plantas = $locales->whereIn('est_type', ['PLANT', 'MIXED']);
        $aviso = (float) (Params::get('plt_series_alert_pct') ?? 95);

        $pasos = [
            ['key' => 'empresa', 'titulo' => 'Datos de la empresa', 'url' => '/m/plt/plt-03', 'checks' => [
                $c('Razón social y RUC válido en cada empresa', $empresas->isNotEmpty() && $empresas->every(fn ($e) => $e->legal_name && ! Ruc::problema($e->ruc)),
                    $empresas->pluck('ruc')->join(', ') ?: 'Sin empresas'),
                $c('Régimen tributario', $empresas->isNotEmpty() && $empresas->every(fn ($e) => (bool) $e->tax_regime), $empresas->pluck('tax_regime')->filter()->unique()->join(', ')),
                $c('Domicilio fiscal con ubigeo', $empresas->isNotEmpty() && $empresas->every(fn ($e) => $e->fiscal_address && preg_match('/^\d{6}$/', (string) $e->fiscal_ubigeo)),
                    $de($empresas->filter(fn ($e) => preg_match('/^\d{6}$/', (string) $e->fiscal_ubigeo))->count(), $empresas->count())),
                $c('Moneda y zona horaria', $empresas->isNotEmpty() && $empresas->every(fn ($e) => $e->default_currency && $e->timezone),
                    $empresas->map(fn ($e) => "{$e->default_currency} · {$e->timezone}")->unique()->join(', ')),
            ]],
            ['key' => 'marcas', 'titulo' => 'Marcas, colores y logo', 'url' => '/m/plt/plt-05', 'checks' => [
                $c('Al menos una marca activa', $marcas->isNotEmpty(), "{$marcas->count()} activas"),
                $c('Pie legal del comprobante en todas', $marcas->isNotEmpty() && $marcas->every(fn ($m) => (bool) $m->legal_footer), $de($marcas->filter(fn ($m) => $m->legal_footer)->count(), $marcas->count())),
                $c('Nombre en WhatsApp en todas', $marcas->isNotEmpty() && $marcas->every(fn ($m) => (bool) $m->whatsapp_display_name), $de($marcas->filter(fn ($m) => $m->whatsapp_display_name)->count(), $marcas->count())),
                $c('Colores generales que se leen bien', (bool) $generalOk, $general ? null : 'Sin colores generales'),
                $c('Marca principal con colores propios', $principal && Temas::propio($principal->id), $principal?->name),
                $c('Logo general del cliente', TenantController::urlLogo() !== null, 'En Colores, pestaña General'),
            ]],
            ['key' => 'locales', 'titulo' => 'Locales', 'url' => '/m/plt/plt-04', 'checks' => [
                $c('Al menos un local', $locales->isNotEmpty(), "{$locales->count()} locales"),
                $c('Todos con su ubicación en el mapa', $locales->isNotEmpty() && $locales->every(fn ($l) => $l->lat !== null && $l->lng !== null),
                    $de($locales->filter(fn ($l) => $l->lat !== null)->count(), $locales->count())),
                $c('Código de establecimiento anexo SUNAT', $locales->isNotEmpty() && $locales->every(fn ($l) => preg_match('/^\d{4}$/', (string) $l->sunat_code)),
                    $locales->pluck('sunat_code')->filter()->join(', ')),
            ]],
            ['key' => 'centros', 'titulo' => 'Centros de costo', 'url' => '/m/plt/plt-07', 'checks' => array_map(
                fn ($area, $nombre) => $c($nombre, $centros->contains('area', $area), $centros->where('area', $area)->count().' centros'),
                array_keys(self::AREAS), self::AREAS,
            )],
            ['key' => 'series', 'titulo' => 'Series', 'url' => '/m/plt/plt-08', 'checks' => [
                $c('Factura y boleta para cada marca', $marcas->isNotEmpty() && $marcas->every(fn ($m) => $series->contains(fn ($s) => $s->doc_type === 'INVOICE' && $s->brand_id === $m->id)
                    && $series->contains(fn ($s) => $s->doc_type === 'RECEIPT' && $s->brand_id === $m->id)),
                    $de($marcas->filter(fn ($m) => $series->contains(fn ($s) => $s->doc_type === 'INVOICE' && $s->brand_id === $m->id))->count(), $marcas->count()).' marcas'),
                $c('Notas de crédito', $series->contains('doc_type', 'CREDIT_NOTE'), null),
                $c('Guía de remisión en cada local con producción', $plantas->every(fn ($l) => $series->contains(fn ($s) => $s->doc_type === 'DISPATCH_GUIDE' && $s->establishment_id === $l->id)),
                    $plantas->pluck('code')->join(', ') ?: 'Sin locales de producción'),
                $c("Ninguna serie sobre el {$aviso} % del rango", ! $series->contains(fn ($s) => Correlativo::uso((int) $s->next_number) >= $aviso),
                    $series->filter(fn ($s) => Correlativo::uso((int) $s->next_number) >= $aviso)->pluck('series')->join(', ') ?: null),
            ]],
            ['key' => 'usuarios', 'titulo' => 'Usuarios iniciales', 'url' => '/m/seg/seg-08', 'checks' => [
                $c('Administrador del sistema', $usuarios->contains('role', 'ADMIN_SISTEMA'), null),
                $c('Gerencia', $usuarios->contains('role', 'GERENTE'), null),
                $c('Contadora', $usuarios->contains('role', 'CONTADORA'), null),
                $c('Vendedoras con sus marcas asignadas', $vendedoras->isNotEmpty() && $conMarca->count() === $vendedoras->count(),
                    $de($conMarca->count(), $vendedoras->count()).' vendedoras'),
            ]],
            ['key' => 'pagos', 'titulo' => 'Medios de pago', 'url' => '/m/mae/mae-04', 'checks' => [
                $c('Efectivo, Yape, Plin, tarjeta y transferencia', ! array_diff(['CASH', 'YAPE', 'PLIN', 'CARD', 'TRANSFER'], $medios), count($medios).' activos'),
                $c('Mercado Pago para la tienda web', in_array('MP', $medios, true), null),
            ]],
            ['key' => 'modulos', 'titulo' => 'Módulos', 'url' => '/m/plt/plt-12', 'checks' => [
                $c('Módulos núcleo encendidos', collect($modulos)->where('is_core', true)->every(fn ($m) => ! empty($on[$m->code])), null),
                $c('Decisión registrada sobre Telefonía', (bool) $tel?->reason, $tel?->reason),
                $c('Ningún módulo encendido sin lo que necesita', collect($modulos)->every(fn ($m) => empty($on[$m->code]) || ! array_filter($m->depends_on, fn ($d) => empty($on[$d]))), null),
            ]],
        ];

        foreach ($pasos as &$p) {
            $p['listos'] = count(array_filter($p['checks'], fn ($x) => $x['ok']));
            $p['total'] = count($p['checks']);
            $p['ok'] = $p['listos'] === $p['total'];
        }
        $listos = array_sum(array_column($pasos, 'listos'));
        $total = array_sum(array_column($pasos, 'total'));

        return ['pasos' => $pasos, 'listos' => $listos, 'total' => $total, 'pct' => $total ? round($listos / $total * 100) : 0];
    }
}
