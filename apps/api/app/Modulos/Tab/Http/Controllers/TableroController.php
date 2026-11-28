<?php

namespace App\Modulos\Tab\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Tab\Services\Base;
use App\Modulos\Tab\Services\Catalogo;
use App\Modulos\Tab\Services\Cierre;
use App\Modulos\Tab\Services\Detalle;
use App\Modulos\Tab\Services\Metas;
use App\Modulos\Tab\Services\Motor;
use App\Modulos\Tab\Services\Tableros;
use App\Support\Exportar;
use App\Support\RuleError;
use Illuminate\Http\Request;

/** TAB · Tablero e indicadores (TAB-01 a TAB-10). Las reglas RN-TAB-01 a 10 están en App\Modulos\Tab\Services. */
class TableroController extends Controller
{
    private const SEMAFORO = ['GREEN' => 'Verde', 'AMBER' => 'Ámbar', 'RED' => 'Rojo'];

    private const ORIGEN = ['SNAPSHOT' => 'Congelado', 'LIVE' => 'En vivo', 'CACHE' => 'En vivo', 'NONE' => 'Sin cálculo', 'HIDDEN' => 'Módulo apagado'];

    private function filtros(Request $request): array
    {
        return $request->validate([
            'mes' => ['nullable', 'date_format:Y-m'], 'marca' => ['nullable', 'uuid'], 'local' => ['nullable', 'uuid'],
        ]) + ['mes' => null, 'marca' => null, 'local' => null];
    }

    /** Los tableros que el usuario puede abrir. */
    public function tableros(Request $request)
    {
        return response()->json(['tableros' => Tableros::delUsuario($request->user()), 'meses' => Tableros::meses(),
            'puede' => ['congelar' => \App\Support\Access::can($request->user(), 'tab.snapshot.run')]]);
    }

    // TAB-01 a TAB-06
    public function tablero(Request $request, string $codigo)
    {
        $f = $this->filtros($request);

        return response()->json(Tableros::datos(strtoupper($codigo), $f['mes'], $request->user(), $f['marca'], $f['local']));
    }

    /** «Actualizar»: borra la caché de los valores en vivo (tab_cache_minutes). Los meses congelados no cambian. */
    public function actualizar()
    {
        Motor::refrescar();

        return response()->json(['ok' => true]);
    }

    public function exportarTablero(Request $request, string $codigo)
    {
        $f = $this->filtros($request);
        $t = Tableros::datos(strtoupper($codigo), $f['mes'], $request->user(), $f['marca'], $f['local']);
        $filas = array_map(fn ($x) => [$x['code'], $x['name'], $x['value'], $x['unidad'], $x['meta'], self::SEMAFORO[$x['semaforo'] ?? ''] ?? '—',
            $x['anterior'], self::ORIGEN[$x['source']] ?? $x['source'], $x['formula']], $t['tabla']);
        $verde = count(array_filter($t['tabla'], fn ($x) => ($x['semaforo'] ?? null) === 'GREEN'));
        $rojo = count(array_filter($t['tabla'], fn ($x) => ($x['semaforo'] ?? null) === 'RED'));

        return Exportar::libro($t['tablero']['name'], $request->user())
            ->hoja('Indicadores', columnas: [['titulo' => 'Código', 'ancho' => 10], ['titulo' => 'Indicador', 'ancho' => 36], ['titulo' => 'Valor', 'ancho' => 13, 'tipo' => 'numero'],
                ['titulo' => 'Unidad', 'ancho' => 12], ['titulo' => 'Meta', 'ancho' => 11, 'tipo' => 'numero'], ['titulo' => 'Semáforo', 'ancho' => 10, 'tipo' => 'centro'],
                ['titulo' => 'Mes anterior', 'ancho' => 13, 'tipo' => 'numero'], ['titulo' => 'Origen', 'ancho' => 13], ['titulo' => 'Cómo se calcula', 'ancho' => 60]],
                filas: $filas, descripcion: ucfirst($t['nombre_mes']).' · '.$t['nombre_marca'].' · '.$t['nombre_local']
                    .($t['corrida'] ? ' · congelado (corrida '.$t['corrida']['run_no'].')' : ' · valores en vivo'),
                resumen: ['Indicadores' => count($filas), 'En verde' => $verde, 'En rojo' => $rojo], fijas: 2)
            ->descargar('tablero-'.strtolower($t['tablero']['code']).'-'.substr($t['mes'], 0, 7));
    }

    // TAB-07 Catálogo de indicadores
    public function catalogo()
    {
        return response()->json(Catalogo::lista());
    }

    public function editarIndicador(Request $request, string $codigo)
    {
        $d = $request->validate([
            'status' => ['nullable', 'in:ACTIVE,INACTIVE'], 'visible_roles' => ['nullable', 'array'], 'visible_roles.*' => ['string', 'max:40'],
            'drilldown' => ['nullable', 'string', 'max:40'], 'decimals' => ['nullable', 'integer', 'between:0,6'], 'frequency' => ['nullable', 'string', 'max:20'],
        ]);
        $cambios = array_filter($d, fn ($v) => $v !== null);
        if ($request->exists('visible_roles')) {
            $cambios['visible_roles'] = $d['visible_roles'] ?? [];
        }

        return response()->json(Catalogo::editar(strtoupper($codigo), $cambios));
    }

    public function exportarCatalogo(Request $request)
    {
        $c = Catalogo::lista();
        $filas = array_map(fn ($x) => [$x['code'], $x['module_code'], $x['name'], $x['unidad'], $x['sentido'],
            $x['frecuencia'], $x['status'] === 'ACTIVE' ? 'Activo' : 'Inactivo', $x['con_calculo'] ? 'Sí' : 'No', $x['formula']], $c['filas']);

        return Exportar::libro('Catálogo de indicadores', $request->user())
            ->hoja('Indicadores', columnas: [['titulo' => 'Código', 'ancho' => 10], ['titulo' => 'Módulo', 'ancho' => 8], ['titulo' => 'Indicador', 'ancho' => 36],
                ['titulo' => 'Unidad', 'ancho' => 12], ['titulo' => 'Mejor si', 'ancho' => 12], ['titulo' => 'Frecuencia', 'ancho' => 12], ['titulo' => 'Estado', 'ancho' => 10],
                ['titulo' => 'Se calcula', 'ancho' => 10, 'tipo' => 'centro'], ['titulo' => 'Cómo se calcula', 'ancho' => 60]],
                filas: $filas, resumen: ['Indicadores' => count($filas)], fijas: 1)
            ->descargar('catalogo-indicadores');
    }

    // TAB-08 Metas
    public function metas(Request $request)
    {
        $f = $request->validate(['marca' => ['nullable', 'uuid']]);

        return response()->json(Metas::lista($request->user(), $f['marca'] ?? null));
    }

    public function guardarMeta(Request $request)
    {
        $d = $request->validate([
            'code' => ['required', 'string', 'max:20'], 'target' => ['required', 'numeric'], 'tolerance_pct' => ['nullable', 'numeric', 'between:0,100'],
            'valid_from' => ['required', 'date_format:Y-m-d'], 'valid_to' => ['nullable', 'date_format:Y-m-d'],
            'brand_id' => ['nullable', 'uuid'], 'establishment_id' => ['nullable', 'uuid'], 'note' => ['nullable', 'string', 'max:80'],
        ]);

        return response()->json(Metas::guardar($d, $request->user()), 201);
    }

    public function cerrarMeta(Request $request, string $id)
    {
        $d = $request->validate(['fecha' => ['nullable', 'date_format:Y-m-d']]);

        return response()->json(Metas::cerrar($id, $d['fecha'] ?? null));
    }

    public function propuestas(Request $request)
    {
        return response()->json(Metas::propuestas($request->user()));
    }

    /** Vista previa del semáforo con una meta y tolerancia (RN-TAB-04), sin guardar nada. */
    public function simular(Request $request)
    {
        $d = $request->validate(['valor' => ['required', 'numeric'], 'meta' => ['required', 'numeric'], 'sentido' => ['required', 'in:HIGHER_BETTER,LOWER_BETTER,TARGET'],
            'tolerancia' => ['nullable', 'numeric', 'between:0,100']]);

        return response()->json(['semaforo' => Metas::semaforo((float) $d['valor'], (float) $d['meta'], $d['sentido'], isset($d['tolerancia']) ? (float) $d['tolerancia'] : null)]);
    }

    // TAB-09 Cierre mensual
    public function cierre()
    {
        return response()->json(Cierre::meses(12));
    }

    public function congelar(Request $request)
    {
        $d = $request->validate(['mes' => ['required', 'date_format:Y-m'], 'motivo' => ['nullable', 'string', 'max:500']]);
        $run = Cierre::congelar($d['mes'].'-01', $d['motivo'] ?? null, $request->user());

        return response()->json(['corrida' => $run, 'mensaje' => 'Se congelaron '.$run->kpis_count.' valores de '.Base::nombreMes($run->period).' (corrida '.$run->run_no.').'], 201);
    }

    // TAB-10 Detalle de un indicador
    public function detalle(Request $request, string $codigo)
    {
        $f = $this->filtros($request);

        return response()->json(Detalle::datos(strtoupper($codigo), $f['mes'], $request->user(), $f['marca'], $f['local']));
    }

    public function exportarDetalle(Request $request, string $codigo)
    {
        $f = $this->filtros($request);
        $codigo = strtoupper($codigo);
        $x = Detalle::datos($codigo, $f['mes'], $request->user(), $f['marca'], $f['local']);
        $sc = ['marca' => $x['marca'], 'local' => $x['local']];
        $i = $x['indicador'];
        $libro = Exportar::libro("{$codigo} · {$i['name']}", $request->user());
        $desc = ucfirst($x['nombre_mes']).' · '.$x['nombre_marca'].' · '.$x['nombre_local'].' · '.$i['formula'];
        $libro->hoja('Tendencia', columnas: [['titulo' => 'Mes', 'ancho' => 18], ['titulo' => 'Valor', 'ancho' => 13, 'tipo' => 'numero'], ['titulo' => 'Meta', 'ancho' => 12, 'tipo' => 'numero'],
            ['titulo' => 'Semáforo', 'ancho' => 10, 'tipo' => 'centro'], ['titulo' => 'Origen', 'ancho' => 18]],
            filas: array_map(fn ($t) => [ucfirst($t['nombre']), $t['value'], $t['meta'], self::SEMAFORO[$t['semaforo'] ?? ''] ?? '—',
                (self::ORIGEN[$t['source']] ?? $t['source']).($t['run_no'] ? ' (corrida '.$t['run_no'].')' : '')], $x['tendencia']),
            descripcion: $desc, resumen: ['Valor' => $i['value'] ?? '—', 'Meta' => $i['meta'] ?? '—', 'Semáforo' => self::SEMAFORO[$i['semaforo'] ?? ''] ?? '—']);
        $det = Detalle::filas($codigo, $x['mes'], $sc['marca'], $sc['local']);
        if ($det) {
            $tipos = ['texto' => null, 'fecha' => 'fecha', 'soles' => 'soles', 'numero' => 'numero', 'porcentaje' => 'porcentaje'];
            $cols = array_map(fn ($c) => array_filter(['titulo' => $c[1], 'ancho' => $c[2] === 'texto' ? 26 : 14, 'tipo' => $tipos[$c[2]] ?? null]), $det['columnas']);
            $filas = array_map(fn ($r) => array_map(fn ($c) => $c[2] === 'porcentaje' && isset($r[$c[0]]) ? $r[$c[0]] / 100 : ($r[$c[0]] ?? null), $det['columnas']),
                array_slice($det['filas'], 0, Detalle::LIMITE));
            $tot = Detalle::totales($det);
            $resumen = ['Filas' => count($det['filas'])];
            foreach ($det['columnas'] as $c) {
                if (isset($tot[$c[0]])) {
                    $resumen[$c[1]] = $c[2] === 'soles' ? 'S/ '.number_format($tot[$c[0]], 2) : $tot[$c[0]];
                }
            }
            $libro->hoja('Detalle', columnas: $cols, filas: $filas, descripcion: $det['nota'] ?? 'Las filas que forman el valor del indicador.', resumen: array_slice($resumen, 0, 4, true));
        }

        return $libro->descargar('indicador-'.strtolower($codigo).'-'.substr($x['mes'], 0, 7));
    }
}
