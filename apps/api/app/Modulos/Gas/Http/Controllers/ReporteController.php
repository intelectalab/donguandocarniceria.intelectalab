<?php

namespace App\Modulos\Gas\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Gas\Services\Base;
use App\Modulos\Gas\Services\Reporte;
use App\Support\Exportar;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** GAS-11 Reporte de gastos con exportación a Excel. */
class ReporteController extends Controller
{
    private function filtros(Request $request): array
    {
        $f = $request->validate(['desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d'], 'por' => ['nullable', Rule::in(array_keys(Reporte::POR))],
            'local' => ['nullable', 'uuid'], 'categoria' => ['nullable', 'uuid'], 'centro' => ['nullable', 'uuid'], 'marca' => ['nullable', 'uuid']]);
        $f['desde'] ??= substr(Base::hoy(), 0, 8).'01';
        $f['hasta'] ??= Base::hoy();
        if ($f['hasta'] < $f['desde']) {
            [$f['desde'], $f['hasta']] = [$f['hasta'], $f['desde']];
        }

        return $f;
    }

    public function index(Request $request)
    {
        return response()->json(Reporte::datos($this->filtros($request), $request->user()));
    }

    public function exportar(Request $request)
    {
        $f = $this->filtros($request);
        $u = $request->user();
        $d = Reporte::datos($f, $u);
        $nombre = Reporte::POR[$d['por']];
        $periodo = date('d/m/Y', strtotime($f['desde'])).' al '.date('d/m/Y', strtotime($f['hasta']));
        $detalle = Reporte::detalle($f, $u)->map(fn ($l) => [
            $l->issue_date, $l->number, Base::DOCUMENTOS[$l->doc_type] ?? $l->doc_type, trim(($l->doc_series ? $l->doc_series.'-' : '').($l->doc_number ?? '')),
            $l->proveedor, $l->categoria, $l->centro, $l->local, $l->marca, $l->canal ? (Base::CANALES[$l->canal] ?? $l->canal) : '', $l->description,
            Base::ESTADOS[$l->status] ?? $l->status, $l->repartido ? 'Sí' : '', $l->accounting_flag === 'NO_VALID_RECEIPT' ? 'Sí' : '', (float) $l->monto,
        ]);

        return Exportar::libro('Reporte de gastos', $u)
            ->hoja("Por {$nombre}", columnas: [['titulo' => $nombre, 'ancho' => 34], ['titulo' => 'Gastos', 'ancho' => 10, 'tipo' => 'numero'],
                ['titulo' => 'Total (S/)', 'ancho' => 16, 'tipo' => 'soles'], ['titulo' => '% del total', 'ancho' => 12, 'tipo' => 'porcentaje'],
                ['titulo' => 'Sin comprobante válido (S/)', 'ancho' => 18, 'tipo' => 'soles']],
                filas: collect($d['filas'])->map(fn ($r) => [$r['clave'], $r['gastos'], $r['total'], $r['pct'] / 100, $r['sin_valido']]),
                descripcion: "Gastos aprobados y pagados del {$periodo}, en soles. Los gastos repartidos entre centros de costo cuentan cada parte en su centro, marca y canal.",
                resumen: ['Total' => Base::soles($d['kpi']['total']), 'Gastos' => $d['kpi']['gastos'], 'Sin comprobante válido' => $d['kpi']['sin_valido_pct'].' %',
                    'Pendientes de aprobar' => $d['kpi']['pendientes']])
            ->hoja('Detalle', columnas: [['titulo' => 'Fecha', 'ancho' => 12, 'tipo' => 'fecha'], ['titulo' => 'Gasto', 'ancho' => 13], ['titulo' => 'Comprobante', 'ancho' => 18],
                ['titulo' => 'Número', 'ancho' => 16], ['titulo' => 'Proveedor', 'ancho' => 30], ['titulo' => 'Categoría', 'ancho' => 24], ['titulo' => 'Centro de costo', 'ancho' => 24],
                ['titulo' => 'Local', 'ancho' => 22], ['titulo' => 'Marca', 'ancho' => 16], ['titulo' => 'Canal', 'ancho' => 12], ['titulo' => 'Descripción', 'ancho' => 40],
                ['titulo' => 'Estado', 'ancho' => 11], ['titulo' => 'Repartido', 'ancho' => 10, 'tipo' => 'centro'], ['titulo' => 'Sin comp. válido', 'ancho' => 10, 'tipo' => 'centro'],
                ['titulo' => 'Monto (S/)', 'ancho' => 14, 'tipo' => 'soles']],
                filas: $detalle, descripcion: "Un renglón por gasto, o por parte del reparto. Del {$periodo}.", fijas: 2)
            ->descargar('reporte-gastos-'.$f['desde'].'-a-'.$f['hasta']);
    }
}
