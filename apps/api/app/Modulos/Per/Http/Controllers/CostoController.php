<?php

namespace App\Modulos\Per\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Per\Services\Base;
use App\Modulos\Per\Services\CostoPersonal;
use App\Modulos\Per\Services\Intercambio;
use App\Support\Access;
use App\Support\Exportar;
use App\Support\Importar;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** PER-14 Costo de personal y PER-15 Intercambio con Ayni HR. */
class CostoController extends Controller
{
    public function costo(Request $request)
    {
        $f = $request->validate(['mes' => ['nullable', 'date_format:Y-m-d'], 'local' => ['nullable', 'uuid'], 'marca' => ['nullable', 'uuid']]);

        return response()->json(CostoPersonal::resumen(Base::mesValido($f['mes'] ?? null), $f['local'] ?? null, $f['marca'] ?? null));
    }

    public function exportarCosto(Request $request)
    {
        $f = $request->validate(['mes' => ['nullable', 'date_format:Y-m-d'], 'local' => ['nullable', 'uuid'], 'marca' => ['nullable', 'uuid']]);
        $r = CostoPersonal::resumen(Base::mesValido($f['mes'] ?? null), $f['local'] ?? null, $f['marca'] ?? null);
        $cols = [['titulo' => 'Grupo', 'ancho' => 38], ['titulo' => 'Planilla', 'ancho' => 14, 'tipo' => 'soles'], ['titulo' => 'Comisiones', 'ancho' => 14, 'tipo' => 'soles'],
            ['titulo' => 'Bonos', 'ancho' => 14, 'tipo' => 'soles'], ['titulo' => 'Total', 'ancho' => 14, 'tipo' => 'soles']];
        $filas = fn ($g) => array_map(fn ($x) => [$x['nombre'], $x['planilla'], $x['comisiones'], $x['bonos'], $x['total']], $g);
        $t = $r['totales'];
        $resumen = ['Costo total' => Base::soles($t['total']), 'Por pedido entregado' => $t['por_pedido'] !== null ? Base::soles($t['por_pedido']) : '—', 'Pedidos entregados' => $t['pedidos']];
        $desc = 'RN-PER-17 · '.$r['nombre'].' hasta el '.Base::fecha($r['hasta']).($r['planilla_importada'] ? ' · planilla importada de '.$r['planilla_importada']['proveedor'] : ' · planilla estimada (aún no importada)');

        return Exportar::libro('Costo de personal', $request->user())
            ->hoja('Por área', columnas: $cols, filas: $filas($r['por_area']), descripcion: $desc, resumen: $resumen)
            ->hoja('Por local', columnas: $cols, filas: $filas($r['por_local']), descripcion: $desc)
            ->hoja('Por marca', columnas: $cols, filas: $filas($r['por_marca']), descripcion: $desc)
            ->hoja('Por centro de costo', columnas: $cols, filas: $filas($r['por_centro']), descripcion: $desc)
            ->descargar('costo-personal-'.substr($r['mes'], 0, 7));
    }

    public function intercambios(Request $request)
    {
        $f = $request->validate(['mes' => ['nullable', 'date_format:Y-m-d']]);
        $mes = Base::mesValido($f['mes'] ?? Base::sumarMeses(Base::mes(), -1));
        $ve = Base::veSueldos($request->user()) || Access::can($request->user(), 'aud.export.personal_data');

        return response()->json(['data' => Intercambio::lista(), 'mes' => $mes, 'nombre' => Base::nombreMes($mes), 'fuente' => Base::texto('per_payroll_source', 'AYNI_HR'),
            'conector_ayni' => Intercambio::conectorAyni(),
            'variables' => array_map(fn ($v) => $ve ? $v : ['dni' => '••••'.substr((string) $v['dni'], -2)] + $v, Intercambio::variables($mes))]);
    }

    public function importar(Request $request)
    {
        $f = $request->validate(['mes' => ['required', 'date_format:Y-m-d'], 'provider' => ['required', Rule::in(['AYNI_HR', 'ACCOUNTANT_FILE'])],
            'archivo' => ['nullable', 'file', 'max:2048', 'mimes:xlsx,xls,csv,txt']]);

        return response()->json(Intercambio::importar(Base::mesValido($f['mes']), $f['provider'], $request->file('archivo'), $request->user()), 201);
    }

    public function plantilla()
    {
        return Importar::plantilla('plantilla-planilla-contador', 'Costo de planilla del mes', Intercambio::COLUMNAS,
            ejemplos: [['40123000', '6500.00', '585.00', '812.50']],
            notas: ['Una fila por trabajador con su DNI.', 'Los montos son del mes, en soles, sin el signo S/.', 'El costo se reparte según los centros de costo de cada trabajador (PER-02).']);
    }

    public function exportarVariables(Request $request)
    {
        $f = $request->validate(['mes' => ['required', 'date_format:Y-m-d'], 'provider' => ['nullable', Rule::in(['AYNI_HR', 'ACCOUNTANT_FILE'])]]);
        $mes = Base::mesValido($f['mes']);
        $u = $request->user();
        $filas = Intercambio::variables($mes);
        Intercambio::registrarExportacion($mes, $f['provider'] ?? Base::texto('per_payroll_source', 'AYNI_HR'), $filas, $u);
        $ve = Base::veSueldos($u) || Access::can($u, 'aud.export.personal_data');
        $cols = [['titulo' => 'DNI', 'ancho' => 12], ['titulo' => 'Código Ayni HR', 'ancho' => 16], ['titulo' => 'Trabajador', 'ancho' => 30],
            ['titulo' => 'Días trabajados', 'ancho' => 10, 'tipo' => 'numero'], ['titulo' => 'Faltas', 'ancho' => 8, 'tipo' => 'numero'], ['titulo' => 'Permisos', 'ancho' => 9, 'tipo' => 'numero'],
            ['titulo' => 'Tardanzas', 'ancho' => 9, 'tipo' => 'numero'], ['titulo' => 'Min. tardanza', 'ancho' => 10, 'tipo' => 'numero'], ['titulo' => 'Horas extra autorizadas', 'ancho' => 12, 'tipo' => 'numero'],
            ['titulo' => 'Comisiones', 'ancho' => 12, 'tipo' => 'soles'], ['titulo' => 'Bonos', 'ancho' => 12, 'tipo' => 'soles'], ['titulo' => 'Descuentos', 'ancho' => 12, 'tipo' => 'soles']];
        $datos = array_map(fn ($v) => [$ve ? $v['dni'] : '••••'.substr((string) $v['dni'], -2), $v['codigo'], $v['nombre'], $v['trabajados'], $v['faltas'], $v['permisos'],
            $v['tardanzas'], $v['min_tardanza'], $v['horas_extra'], $v['comisiones'], $v['bonos'], $v['descuentos']], $filas);

        return Exportar::libro('Variables de planilla', $u)
            ->hoja('Variables', columnas: $cols, filas: $datos, descripcion: 'RN-PER-18 · '.Base::nombreMes($mes).': asistencia y conceptos variables para Ayni HR o el contador',
                resumen: ['Trabajadores' => count($filas), 'Comisiones' => Base::soles(array_sum(array_column($filas, 'comisiones'))), 'Bonos' => Base::soles(array_sum(array_column($filas, 'bonos')))])
            ->descargar('variables-planilla-'.substr($mes, 0, 7));
    }
}
