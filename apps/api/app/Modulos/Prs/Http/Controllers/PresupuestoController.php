<?php

namespace App\Modulos\Prs\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Prs\Services\Alertas;
use App\Modulos\Prs\Services\Base;
use App\Modulos\Prs\Services\Conceptos;
use App\Modulos\Prs\Services\Importacion;
use App\Modulos\Prs\Services\Pantallas;
use App\Modulos\Prs\Services\Real;
use App\Modulos\Prs\Services\Versiones;
use App\Support\Exportar;
use App\Support\Importar;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** PRS · Presupuesto (PRS-01 a PRS-10). Las reglas están en App\Modulos\Prs\Services. */
class PresupuestoController extends Controller
{
    private function filtros(Request $request): array
    {
        $f = $request->validate([
            'empresa' => ['nullable', 'uuid'], 'version' => ['nullable', 'uuid'], 'mes' => ['nullable', 'date_format:Y-m'], 'al' => ['nullable', 'date_format:Y-m-d'],
            'modo' => ['nullable', 'in:MES,ACUMULADO'], 'dim' => ['nullable', 'in:concepto,marca,local,centro'], 'concepto' => ['nullable', 'uuid'], 'valor' => ['nullable', 'uuid'],
            'estado' => ['nullable', 'in:OPEN,ACK,CLOSED,RESOLVED,ACTIVAS'],
        ]);
        if (! empty($f['mes'])) {
            $f['mes'] .= '-01';
        }
        if (! empty($f['empresa']) && ! DB::table('companies')->where('id', $f['empresa'])->exists()) {
            RuleError::fail('RN-PRS-01', 'La empresa no existe.');
        }

        return $f;
    }

    public function opciones(Request $request)
    {
        return response()->json(Pantallas::opciones($request->user()));
    }

    // PRS-01 Presupuestos
    public function presupuestos(Request $request)
    {
        $f = $request->validate(['empresa' => ['nullable', 'uuid']]);

        return response()->json(Pantallas::presupuestos($request->user(), $f['empresa'] ?? null));
    }

    public function crearPresupuesto(Request $request)
    {
        $d = $request->validate(['anio' => ['required', 'integer', 'between:2020,2100'], 'nombre' => ['nullable', 'string', 'max:120'], 'empresa' => ['nullable', 'uuid'],
            'inicio' => ['nullable', 'in:VACIO,REAL,VERSION'], 'pct' => ['nullable', 'numeric', 'between:-90,300']]);

        return response()->json(Versiones::crearPresupuesto((int) $d['anio'], $d['empresa'] ?? Base::empresaPorDefecto(), $request->user(), $d['nombre'] ?? null,
            $d['inicio'] ?? 'VACIO', (float) ($d['pct'] ?? 0)), 201);
    }

    public function nuevaVersion(Request $request, string $id)
    {
        $d = $request->validate(['desde' => ['nullable', 'uuid'], 'pct' => ['nullable', 'numeric', 'between:-90,300'], 'nombre' => ['nullable', 'string', 'max:160']]);
        $v = Versiones::nuevaVersion($id, $request->user(), $d['desde'] ?? null, (float) ($d['pct'] ?? 0), $d['nombre'] ?? null);

        return response()->json(Versiones::resumen($v), 201);
    }

    // PRS-02 Conceptos presupuestales
    public function conceptos()
    {
        return response()->json(['conceptos' => Conceptos::arbol()]);
    }

    public function guardarConcepto(Request $request, ?string $id = null)
    {
        $d = $request->validate(['code' => ['required', 'string', 'max:20'], 'name' => ['required', 'string', 'max:120'], 'parent_id' => ['nullable', 'uuid'],
            'is_group' => ['nullable', 'boolean'], 'concept_type' => ['nullable', 'in:INCOME,COST_OF_SALES,EXPENSE'], 'behavior' => ['nullable', 'in:VARIABLE,FIXED'],
            'default_cost_center_id' => ['nullable', 'uuid'], 'status' => ['nullable', 'in:ACTIVE,INACTIVE']]);

        return response()->json(Conceptos::guardar($d, $request->user(), $id), $id ? 200 : 201);
    }

    public function mapear(Request $request, string $id)
    {
        $d = $request->validate(['source' => ['required', 'in:SALES,COST_OF_SALES,EXPENSE_CATEGORY,PAYROLL,ACCOUNT'], 'ref' => ['nullable', 'string', 'max:60'], 'note' => ['nullable', 'string', 'max:500']]);

        return response()->json(Conceptos::mapear($id, $d, $request->user()), 201);
    }

    public function quitarMapeo(Request $request, string $id)
    {
        Conceptos::quitarMapeo($id, $request->user());

        return response()->json(['ok' => true]);
    }

    // PRS-03 Edición de versión
    public function matriz(Request $request, string $id)
    {
        $f = $request->validate(['marca' => ['nullable', 'uuid'], 'local' => ['nullable', 'uuid'], 'centro' => ['nullable', 'uuid']]);

        return response()->json(Pantallas::matriz($id, $f, $request->user()));
    }

    public function guardarLinea(Request $request, string $id)
    {
        $d = $request->validate(['concept_id' => ['required', 'uuid'], 'month' => ['required', 'date_format:Y-m-d'], 'amount' => ['present'],
            'brand_id' => ['nullable', 'uuid'], 'establishment_id' => ['nullable', 'uuid'], 'cost_center_id' => ['nullable', 'uuid'], 'note' => ['nullable', 'string', 'max:500']]);

        return response()->json(Versiones::guardarLinea($id, $d, $request->user()), 201);
    }

    public function cambiarImporte(Request $request, string $id)
    {
        $d = $request->validate(['amount' => ['present'], 'note' => ['nullable', 'string', 'max:500']]);
        $l = DB::table('budget_lines')->where('id', $id)->first();
        if (! $l) {
            RuleError::fail('RN-PRS-01', 'La línea no existe.');
        }
        $datos = ['amount' => $d['amount']] + (array) $l;
        if ($request->has('note')) {
            $datos['note'] = $d['note'];
        }

        return response()->json(Versiones::guardarLinea($l->version_id, $datos, $request->user(), false, $l->id));
    }

    public function quitarLinea(Request $request, string $id)
    {
        $l = DB::table('budget_lines')->where('id', $id)->first();
        if (! $l) {
            RuleError::fail('RN-PRS-01', 'La línea no existe.');
        }
        $v = Versiones::version($l->version_id);
        if (! Versiones::editable($v)) {
            RuleError::fail('RN-PRS-04', Versiones::etiqueta($v).' no está en borrador: sus líneas no se modifican.');
        }
        if (! \App\Support\Access::can($request->user(), 'prs.budget.edit')) {
            RuleError::fail('RN-PRS-04', 'Editar versiones en borrador es de Administración (prs.budget.edit).');
        }
        DB::table('budget_lines')->where('id', $id)->delete();

        return response()->json(['ok' => true]);
    }

    public function guardarFila(Request $request, string $id)
    {
        $d = $request->validate(['concept_id' => ['required', 'uuid'], 'brand_id' => ['nullable', 'uuid'], 'establishment_id' => ['nullable', 'uuid'], 'cost_center_id' => ['nullable', 'uuid'],
            'importes' => ['required', 'array', 'size:12'], 'importes.*' => ['nullable'], 'clave_anterior' => ['nullable', 'string', 'max:200'], 'note' => ['nullable', 'string', 'max:500']]);
        $n = Versiones::guardarFila($id, ['concept_id' => $d['concept_id'], 'brand_id' => $d['brand_id'] ?? null, 'establishment_id' => $d['establishment_id'] ?? null,
            'cost_center_id' => $d['cost_center_id'] ?? null, 'note' => $d['note'] ?? null], $d['importes'], $request->user(), $d['clave_anterior'] ?? null);

        return response()->json(['lineas' => $n], 201);
    }

    public function quitarFila(Request $request, string $id)
    {
        $d = $request->validate(['clave' => ['required', 'string', 'max:200']]);

        return response()->json(['lineas' => Versiones::quitarFila($id, $d['clave'], $request->user())]);
    }

    // PRS-04 Carga y copia
    public function plantilla()
    {
        return Importar::plantilla('plantilla-presupuesto', 'Cargar líneas del presupuesto', Importacion::columnasConListas(), [
            ['PUB-PLA', '1', 'DG', '', 'MKT-DG', '6000', 'Meta y Google'],
            ['OCU-ALQ', '2027-01', '', 'L1', 'ADM', '4500', ''],
        ], [
            'Una fila por línea: concepto, mes, al menos una dimensión (marca, local o centro de costo) e importe en soles sin IGV.',
            'Mes: 1 a 12 del año presupuestal, o AAAA-MM. El importe no puede ser negativo. Puedes borrar los dos ejemplos.',
            'Si una fila repite el concepto, el mes y las dimensiones de una línea que ya está en la versión, reemplaza su importe. Hasta '.Importacion::MAX_FILAS.' filas.',
        ]);
    }

    public function leerArchivo(Request $request)
    {
        $request->validate(['archivo' => Importar::REGLAS_ARCHIVO]);

        return response()->json(['texto' => Importar::aTexto($request->file('archivo'), Importacion::COLUMNAS, Importacion::MAX_FILAS)]);
    }

    public function revisarImportacion(Request $request, string $id)
    {
        $d = $request->validate(['texto' => ['required', 'string', 'max:400000']]);

        return response()->json(Importacion::revisar($id, $d['texto']));
    }

    public function importar(Request $request, string $id)
    {
        $d = $request->validate(['texto' => ['required', 'string', 'max:400000']]);

        return response()->json(Importacion::importar($id, $d['texto'], $request->user()), 201);
    }

    public function copiarVersion(Request $request, string $id)
    {
        $d = $request->validate(['desde' => ['required', 'uuid'], 'pct' => ['nullable', 'numeric', 'between:-90,300']]);

        return response()->json(Versiones::copiarVersion($d['desde'], $id, (float) ($d['pct'] ?? 0), $request->user()));
    }

    public function copiarReal(Request $request, string $id)
    {
        $d = $request->validate(['pct' => ['nullable', 'numeric', 'between:-90,300'], 'al' => ['nullable', 'date_format:Y-m-d']]);

        return response()->json(Versiones::copiarReal($id, (float) ($d['pct'] ?? 0), $request->user(), $d['al'] ?? null));
    }

    // PRS-05 Envío y aprobación
    public function diferencias(Request $request, string $id)
    {
        return response()->json(Pantallas::diferencias($id, $request->user()));
    }

    public function enviar(Request $request, string $id)
    {
        $d = $request->validate(['comentario' => ['nullable', 'string', 'max:1000']]);

        return response()->json(Versiones::resumen(Versiones::enviar($id, $request->user(), $d['comentario'] ?? null)));
    }

    public function aprobar(Request $request, string $id)
    {
        $d = $request->validate(['comentario' => ['nullable', 'string', 'max:1000']]);

        return response()->json(Versiones::resumen(Versiones::aprobar($id, $request->user(), $d['comentario'] ?? null)));
    }

    public function rechazar(Request $request, string $id)
    {
        $d = $request->validate(['comentario' => ['nullable', 'string', 'max:1000']]);

        return response()->json(Versiones::resumen(Versiones::rechazar($id, $request->user(), $d['comentario'] ?? null)));
    }

    // PRS-06 Real frente a presupuesto y PRS-07 Detalle del real
    public function ejecucion(Request $request)
    {
        return response()->json(Pantallas::ejecucion($this->filtros($request), $request->user()));
    }

    public function exportarEjecucion(Request $request)
    {
        $t = Pantallas::ejecucion($this->filtros($request), $request->user());
        $luz = ['GREEN' => 'Verde', 'AMBER' => 'Ámbar', 'RED' => 'Rojo'];
        $conDim = $t['dim'] !== 'concepto';
        $filas = array_map(fn ($x) => array_merge([$x['code'], $x['name'], Base::TIPOS[$x['type']] ?? $x['type']], $conDim ? [$x['dimension']] : [],
            [$x['budget'], $x['actual'], $x['diff'], $x['pct'] !== null ? $x['pct'] / 100 : null, $x['forecast'], $luz[$x['light']] ?? '—']), $t['filas']);
        $cols = [['titulo' => 'Código', 'ancho' => 10], ['titulo' => 'Concepto', 'ancho' => 34], ['titulo' => 'Tipo', 'ancho' => 15]];
        if ($conDim) {
            $cols[] = ['titulo' => ['marca' => 'Marca', 'local' => 'Local', 'centro' => 'Centro de costo'][$t['dim']], 'ancho' => 24];
        }
        array_push($cols, ['titulo' => 'Presupuesto', 'ancho' => 14, 'tipo' => 'soles'], ['titulo' => 'Real', 'ancho' => 14, 'tipo' => 'soles'],
            ['titulo' => 'Diferencia', 'ancho' => 14, 'tipo' => 'soles'], ['titulo' => '% de ejecución', 'ancho' => 13, 'tipo' => 'porcentaje'],
            ['titulo' => 'Proyección', 'ancho' => 14, 'tipo' => 'soles'], ['titulo' => 'Semáforo', 'ancho' => 11, 'tipo' => 'centro']);
        $k = $t['kpi'];
        $periodo = ($t['modo'] === 'ACUMULADO' ? 'Acumulado a ' : '').Base::nombreMes($t['mes']);

        return Exportar::libro('Real frente a presupuesto', $request->user())
            ->hoja('Ejecución', columnas: $cols, filas: $filas, descripcion: $periodo.' · '.($t['version']['etiqueta'] ?? 'sin versión vigente').' · soles sin IGV (RN-PRS-06)',
                resumen: ['Gasto real' => Base::soles($k['gasto']['actual']), 'Gasto presupuestado' => Base::soles($k['gasto']['budget']),
                    'Ingreso real' => Base::soles($k['ingreso']['actual']), 'Conceptos en rojo' => (string) $k['rojos']])
            ->descargar('presupuesto-ejecucion-'.substr($t['mes'], 0, 7));
    }

    public function detalle(Request $request)
    {
        return response()->json(Pantallas::detalle($this->filtros($request), $request->user()));
    }

    public function recalcular(Request $request)
    {
        $d = $request->validate(['mes' => ['required', 'date_format:Y-m'], 'motivo' => ['nullable', 'string', 'max:500'], 'empresa' => ['nullable', 'uuid']]);

        return response()->json(Real::recalcular($d['mes'].'-01', $d['empresa'] ?? Base::empresaPorDefecto(), $request->user(), $d['motivo'] ?? null), 201);
    }

    // PRS-08 Proyección de cierre
    public function proyeccion(Request $request)
    {
        return response()->json(Pantallas::proyeccion($this->filtros($request), $request->user()));
    }

    public function guardarProyeccion(Request $request)
    {
        $d = $request->validate(['version' => ['required', 'uuid'], 'mes' => ['required', 'date_format:Y-m'], 'al' => ['nullable', 'date_format:Y-m-d']]);

        return response()->json(Alertas::guardarProyeccion($d['version'], $d['mes'].'-01', $d['al'] ?? Base::hoy(), $request->user()), 201);
    }

    public function generarAlertas(Request $request)
    {
        $d = $request->validate(['version' => ['required', 'uuid'], 'mes' => ['required', 'date_format:Y-m'], 'al' => ['nullable', 'date_format:Y-m-d']]);

        return response()->json(Alertas::generar($d['version'], $d['mes'].'-01', $d['al'] ?? Base::hoy(), $request->user()));
    }

    // PRS-09 Comparativo de versiones
    public function comparativo(Request $request)
    {
        $d = $request->validate(['a' => ['required', 'uuid'], 'b' => ['required', 'uuid']]);

        return response()->json(Versiones::comparar($d['a'], $d['b'], Base::alcance($request->user())) + ['meses_a' => Base::meses((int) Versiones::version($d['a'])->year),
            'meses_b' => Base::meses((int) Versiones::version($d['b'])->year)]);
    }

    // PRS-10 Alertas de desviación
    public function alertas(Request $request)
    {
        return response()->json(Pantallas::alertas($this->filtros($request), $request->user()));
    }

    public function semaforoPorCentro(Request $request)
    {
        return response()->json(Pantallas::semaforoPorCentro($this->filtros($request), $request->user()));
    }

    public function comentarAlerta(Request $request, string $id)
    {
        $d = $request->validate(['texto' => ['required', 'string', 'max:1000'], 'estado' => ['nullable', 'in:OPEN,ACK,CLOSED']]);
        Alertas::comentar($id, $d['texto'], $d['estado'] ?? null, $request->user());

        return response()->json(['ok' => true]);
    }
}
