<?php

namespace App\Modulos\Pro\Services;

use App\Models\User;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Alm\Services\LotesService;
use App\Modulos\Des\Services\DespieceService;
use App\Modulos\Equ\Services\EquiposService;
use App\Modulos\Plt\Services\Correlativo;
use App\Modulos\Plt\Services\Periodos;
use App\Modulos\Rec\Services\RecetasService;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * PRO · Órdenes de producción. Dueño de production_lines, production_orders, production_order_consumptions,
 * production_order_outputs, production_order_labor, production_order_equipment y production_ccp_readings.
 * Mueve stock solo con la acción única de ALM (RN-PRO-13), registra horas de equipo con EQU y toma la receta
 * vigente de REC. El despiece (orden CUTTING) se costea con DespieceService (RN-DES-02).
 *
 *  RN-PRO-01  RECIPE con versión APPROVED fijada; CUTTING con plantilla ACTIVE (también en la base).
 *  RN-PRO-02  solo se consume un lote liberado y no vencido.
 *  RN-PRO-03  FEFO: si otro lote liberado del mismo almacén y variante vence antes, el consumo exige motivo (pro.fefo.override).
 *  RN-PRO-04  solo se registra con la orden RELEASED o IN_PROGRESS.
 *  RN-PRO-05  con CAL activo, el lote producido queda en QUARANTINE (también en la base).
 *  RN-PRO-06  rendimiento real = kg de producto / kg consumidos × 100; desviación mayor que pro_yield_tolerance_pp exige motivo.
 *  RN-PRO-07  costo = materiales + mano de obra + equipos; costo por kg = total / kg MAIN y CO_PRODUCT.
 *  RN-PRO-08  merma sin costo; sobre la merma máxima de la línea exige motivo.
 *  RN-PRO-09  alcance por local; el operario no cierra ni cambia tarifas.
 *  RN-PRO-10  no se cierra en un período cerrado.
 *  RN-PRO-11  lectura fuera de rango con acción correctiva (también en la base); punto crítico fuera de rango marca la orden.
 *  RN-PRO-12  teóricos = receta × factor; factor = kg planificados / kg base.
 *  RN-PRO-13  consumos PRODUCTION_OUT y producción PRODUCTION_IN, con el movimiento guardado.
 *  RN-PRO-14  se anula solo sin consumos ni producción, con motivo.
 *  RN-PRO-15  equipo apto y balanza apta (EquiposService).
 *  RN-PRO-16  horas > 0 y hasta pro_max_hours_per_record por registro.
 *  RN-PRO-17  al cerrar: production_order.closed y costo final de cada lote (LotesService::fijarCosto).
 *  RN-PRO-18  tarifa del trabajador (PER) o pro_default_labor_rate_pen.
 */
final class ProduccionService
{
    public const TIPOS_LINEA = ['CUTTING', 'VACUUM_PACK', 'LARD', 'BROTH', 'SAUSAGE', 'JAM', 'OTHER'];

    public const TIPOS = ['RECIPE', 'CUTTING', 'PACKING'];

    public const ABIERTAS = ['RELEASED', 'IN_PROGRESS'];

    public const ROLES_SALIDA = ['MAIN', 'CO_PRODUCT', 'BY_PRODUCT', 'WASTE'];

    public const ROLES_CONSUMO = ['RAW_MATERIAL', 'INPUT', 'PACKAGING'];

    public const FUNCIONES = ['CUTTER', 'SAUSAGE_MAKER', 'COOK', 'PACKER', 'HELPER', 'SUPERVISOR'];

    private const MAPA = [
        'production_lines_tenant_id_code_unique' => ['RN-PRO-01', 'Ya existe una línea con ese código.'],
        'production_orders_receta' => ['RN-PRO-01', 'Una orden de receta necesita su versión aprobada.'],
        'production_orders_plantilla' => ['RN-PRO-01', 'Un despiece necesita su plantilla activa.'],
        'production_orders_anulada' => ['RN-PRO-14', 'Anular una orden exige motivo.'],
        'production_ccp_readings_accion' => ['RN-PRO-11', 'Una lectura fuera de rango exige la acción correctiva.'],
        'production_order_labor_horas' => ['RN-PRO-16', 'Las horas deben ser mayores que cero.'],
        'production_order_equipment_horas' => ['RN-PRO-16', 'Las horas deben ser mayores que cero.'],
    ];

    /* ================================================================ líneas (PRO-01) */

    public static function guardarLinea(array $d, ?string $id, User $quien): object
    {
        Access::can($quien, 'pro.order.create') || RuleError::fail('RN-PRO-09', 'No tienes permiso para gestionar las líneas de producción. Lo hace el jefe de producción.');

        return Comun::base(fn () => DB::transaction(function () use ($d, $id, $quien) {
            $antes = $id ? (DB::table('production_lines')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-PRO-01', 'Línea no encontrada.')) : null;
            $local = $d['establishment_id'] ?? $antes?->establishment_id;
            DB::table('establishments')->where('id', $local)->exists() || RuleError::fail('RN-PRO-01', 'Elige el local de la línea.');
            Comun::exigirLocal($quien, $local, 'RN-PRO-09', 'La línea');
            $codigo = strtoupper((string) Comun::texto($d['code'] ?? $antes?->code, 40));
            $nombre = Comun::texto($d['name'] ?? $antes?->name, 80);
            ($codigo !== '' && $nombre) || RuleError::fail('RN-PRO-01', 'La línea necesita código y nombre.');
            $tipo = $d['line_type'] ?? $antes?->line_type;
            in_array($tipo, self::TIPOS_LINEA, true) || RuleError::fail('RN-PRO-01', 'Elige el tipo de línea.');
            foreach (['input_warehouse_id' => 'almacén de insumos', 'output_warehouse_id' => 'almacén de producto terminado'] as $c => $que) {
                $w = $d[$c] ?? $antes?->{$c};
                DB::table('warehouses')->where('id', $w)->where('establishment_id', $local)->exists()
                    || RuleError::fail('RN-PRO-01', "Elige el {$que}: debe ser del mismo local.");
            }
            $cc = $d['cost_center_id'] ?? $antes?->cost_center_id;
            DB::table('cost_centers')->where('id', $cc)->where('status', 'ACTIVE')->exists() || RuleError::fail('RN-PLT-21', 'Elige un centro de costo activo.');
            $merma = array_key_exists('max_waste_pct', $d) ? Comun::num($d['max_waste_pct'], 2) : $antes?->max_waste_pct;
            $fila = [
                'establishment_id' => $local, 'code' => $codigo, 'name' => $nombre, 'line_type' => $tipo,
                'input_warehouse_id' => $d['input_warehouse_id'] ?? $antes->input_warehouse_id, 'output_warehouse_id' => $d['output_warehouse_id'] ?? $antes->output_warehouse_id,
                'cost_center_id' => $cc, 'max_waste_pct' => $merma, 'status' => in_array($d['status'] ?? null, ['ACTIVE', 'INACTIVE'], true) ? $d['status'] : ($antes?->status ?? 'ACTIVE'),
                'notes' => array_key_exists('notes', $d) ? Comun::texto($d['notes'], 1000) : $antes?->notes, 'updated_at' => now(),
            ];
            if ($antes) {
                DB::table('production_lines')->where('id', $id)->update($fila);
            } else {
                $id = DB::table('production_lines')->insertGetId($fila, 'id');
            }

            return DB::table('production_lines')->where('id', $id)->first();
        }), self::MAPA);
    }

    /* ================================================================ órdenes (PRO-05, PRO-13) */

    /**
     * PRO-05. $d: order_type, line_id, product_id o recipe_id / cutting_template_id, planned_output_kg, planned_date,
     * supervisor_user_id, brand_id (opcional: sale de la receta o la plantilla), source_variant_id y output_variant_id (PACKING), notes.
     */
    public static function crearOrden(array $d, User $quien): object
    {
        Access::can($quien, 'pro.order.create') || RuleError::fail('RN-PRO-09', 'No tienes permiso para crear órdenes. Lo hace el jefe de producción.');

        return Comun::base(fn () => DB::transaction(function () use ($d, $quien) {
            $tipo = $d['order_type'] ?? 'RECIPE';
            in_array($tipo, self::TIPOS, true) || RuleError::fail('RN-PRO-01', 'Elige el tipo de orden.');
            $linea = DB::table('production_lines')->where('id', $d['line_id'] ?? null)->first() ?? RuleError::fail('RN-PRO-01', 'Elige la línea de producción.');
            $linea->status === 'ACTIVE' || RuleError::fail('RN-PRO-01', "La línea {$linea->code} está inactiva.");
            Comun::exigirLocal($quien, $linea->establishment_id, 'RN-PRO-09', 'La línea');
            $kg = Comun::num($d['planned_output_kg'] ?? null, 3);
            ($kg !== null && $kg > 0) || RuleError::fail('RN-PRO-12', 'Indica los kg planificados (mayor que cero).');
            $fecha = Comun::fecha($d['planned_date'] ?? null);
            $sup = $d['supervisor_user_id'] ?? $quien->id;
            DB::table('users')->where('id', $sup)->where('status', 'ACTIVE')->exists() || RuleError::fail('RN-PRO-09', 'Elige el supervisor.');

            $fila = ['order_type' => $tipo, 'line_id' => $linea->id, 'establishment_id' => $linea->establishment_id, 'planned_date' => $fecha,
                'planned_output_kg' => $kg, 'supervisor_user_id' => $sup, 'notes' => Comun::texto($d['notes'] ?? null, 2000), 'created_by' => $quien->id];
            $detalle = '';
            if ($tipo === 'RECIPE') {
                $receta = DB::table('recipes')->where('id', $d['recipe_id'] ?? null)->first()
                    ?? DB::table('recipes')->where('product_id', $d['product_id'] ?? null)->where('status', 'ACTIVE')->first()
                    ?? RuleError::fail('RN-PRO-01', 'Elige la receta del producto.');
                // RN-PRO-01: la versión aprobada queda fija en la orden.
                $v = RecetasService::vigente($receta->id) ?? RuleError::fail('RN-PRO-01', "La receta {$receta->code} no tiene una versión aprobada: no se puede producir con ella.");
                $factor = $kg / (float) $v->base_output_kg;
                $fila += ['product_id' => $receta->product_id, 'brand_id' => $receta->brand_id, 'recipe_version_id' => $v->id, 'output_variant_id' => $receta->output_variant_id,
                    'scale_factor' => round($factor, 6), 'expected_yield_pct' => $v->expected_yield_pct, 'standard_cost_per_kg' => $v->standard_cost_per_kg];
                $detalle = "Receta {$receta->code} v{$v->version} · factor ".Comun::n($factor, 4);
            } elseif ($tipo === 'CUTTING') {
                $pl = DB::table('cutting_templates')->where('id', $d['cutting_template_id'] ?? null)->first()
                    ?? DB::table('cutting_templates')->where('input_variant_id', $d['source_variant_id'] ?? null)->where('status', 'ACTIVE')->first()
                    ?? RuleError::fail('RN-PRO-01', 'Elige la plantilla de despiece.');
                $pl->status === 'ACTIVE' || RuleError::fail('RN-PRO-01', "La plantilla {$pl->code} v{$pl->version} no está activa: el despiece usa la plantilla activa.");
                $esperado = DB::table('cutting_template_lines')->where('template_id', $pl->id)->whereIn('role', ['CO_PRODUCT', 'BY_PRODUCT'])->sum('standard_yield_pct');
                $fila += ['product_id' => $pl->input_product_id, 'brand_id' => $pl->brand_id, 'cutting_template_id' => $pl->id, 'source_variant_id' => $pl->input_variant_id,
                    'expected_yield_pct' => round((float) $esperado, 2)];
                $detalle = "Plantilla {$pl->code} v{$pl->version}";
            } else {
                $origen = DB::table('product_variants')->where('id', $d['source_variant_id'] ?? null)->first() ?? RuleError::fail('RN-PRO-01', 'Elige la variante que se empaca.');
                $destino = DB::table('product_variants')->where('id', $d['output_variant_id'] ?? null)->first() ?? RuleError::fail('RN-PRO-01', 'Elige la variante que sale empacada.');
                $max = (float) ($linea->max_waste_pct ?? Params::get('pro_max_waste_pct') ?? 8);
                $fila += ['product_id' => $destino->product_id, 'brand_id' => $destino->brand_id, 'source_variant_id' => $origen->id, 'output_variant_id' => $destino->id,
                    'expected_yield_pct' => Comun::num($d['expected_yield_pct'] ?? null, 2) ?? round(100 - $max / 2, 2),
                    'standard_cost_per_kg' => $destino->std_cost];
                $detalle = "Empaque de {$origen->sku} a {$destino->sku}";
            }
            if (! empty($d['brand_id'])) {
                $fila['brand_id'] = $d['brand_id'];
            }
            $marcas = Access::for($quien)['brands'];
            ($marcas && ! in_array($fila['brand_id'], $marcas, true)) && RuleError::fail('RN-PRO-09', 'La marca está fuera de tu alcance.');
            $fila['company_id'] = DB::table('establishments')->where('id', $linea->establishment_id)->value('company_id');
            $fila['history'] = Comun::historial(null, 'Creación', $detalle.' · '.Comun::n($kg, 3).' kg planificados', $quien);

            $serie = DB::table('document_series')->where('doc_type', 'PRODUCTION_ORDER')->where('status', 'ACTIVE')->orderBy('series')->value('id');
            $orden = $serie
                ? Correlativo::emitir($serie, function ($s, int $n) use ($fila) {
                    return DB::table('production_orders')->insertGetId($fila + ['series' => $s->series, 'number' => $s->series.'-'.str_pad((string) $n, 4, '0', STR_PAD_LEFT)], 'id');
                })
                : DB::table('production_orders')->insertGetId($fila + ['series' => 'OP01', 'number' => Comun::numero('production_orders', 'OP01-')], 'id');
            Events::emit('production_order.created', 'production_orders', $orden, ['order_type' => $tipo, 'planned_output_kg' => $kg]);

            return self::orden($orden);
        }), self::MAPA);
    }

    /** PLANNED → RELEASED: lista para registrar en planta. */
    public static function liberar(string $id, User $quien): object
    {
        Access::can($quien, 'pro.order.create') || RuleError::fail('RN-PRO-09', 'No tienes permiso para liberar órdenes.');

        return DB::transaction(function () use ($id, $quien) {
            $o = self::bloquear($id, $quien);
            $o->status === 'PLANNED' || RuleError::fail('RN-PRO-04', "La orden {$o->number} ya no está planificada.");
            DB::table('production_orders')->where('id', $id)->update(['status' => 'RELEASED', 'released_at' => now(), 'updated_at' => now(),
                'history' => Comun::historial($o->history, 'Liberación', 'Lista para registrar en planta', $quien)]);

            return self::orden($id);
        });
    }

    /** PRO-13 · RN-PRO-14: sin consumos ni producción, con motivo. */
    public static function anular(string $id, string $motivo, User $quien): object
    {
        Access::can($quien, 'pro.order.void') || RuleError::fail('RN-PRO-14', 'No tienes permiso para anular órdenes.');

        return Comun::base(fn () => DB::transaction(function () use ($id, $motivo, $quien) {
            $o = self::bloquear($id, $quien);
            in_array($o->status, ['CLOSED', 'VOIDED'], true) && RuleError::fail('RN-PRO-04', "La orden {$o->number} está ".($o->status === 'CLOSED' ? 'cerrada' : 'anulada').' y no se modifica.');
            $mov = DB::table('production_order_consumptions')->where('order_id', $id)->count() + DB::table('production_order_outputs')->where('order_id', $id)->count();
            $mov && RuleError::fail('RN-PRO-14', "La orden {$o->number} ya tiene consumos o producción registrados: no se anula. Ciérrala con su merma.");
            $motivo = trim($motivo);
            mb_strlen($motivo) >= 5 || RuleError::fail('RN-PRO-14', 'Anular una orden exige motivo.');
            DB::table('production_orders')->where('id', $id)->update(['status' => 'VOIDED', 'void_reason' => mb_substr($motivo, 0, 500), 'voided_at' => now(),
                'voided_by' => $quien->id, 'updated_at' => now(), 'history' => Comun::historial($o->history, 'Anulación', $motivo, $quien)]);
            Events::emit('production_order.voided', 'production_orders', $id, ['number' => $o->number, 'reason' => $motivo]);

            return self::orden($id);
        }), self::MAPA);
    }

    /* ================================================================ registro en planta (PRO-06 a PRO-09) */

    /**
     * PRO-06 Consumo de un insumo. $d: lot_id o lot_code, variant_id (si no hay lote), qty, weight_kg, warehouse_id (por defecto el de insumos
     * de la línea), role, fefo_override_reason, consumed_at.
     */
    public static function consumir(string $id, array $d, User $quien): object
    {
        self::registrador($quien);

        return Comun::base(fn () => DB::transaction(function () use ($id, $d, $quien) {
            $o = self::abierta($id, $quien);
            $linea = DB::table('production_lines')->where('id', $o->line_id)->first();
            $lote = null;
            if (! empty($d['lot_id']) || ! empty($d['lot_code'])) {
                $lote = DB::table('lots')->when(! empty($d['lot_id']), fn ($q) => $q->where('id', $d['lot_id']), fn ($q) => $q->where('code', strtoupper(trim($d['lot_code']))))
                    ->orderByDesc('created_at')->first() ?? RuleError::fail('RN-PRO-02', 'No hay un lote con ese código.');
            }
            $variante = $lote?->variant_id ?? ($d['variant_id'] ?? null);
            $v = DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')->where('v.id', $variante)
                ->first(['v.*', 'p.requires_lot', 'p.product_type', 'p.name as product_name']) ?? RuleError::fail('RN-PRO-02', 'Elige el insumo o escanea su lote.');
            ($v->requires_lot && ! $lote) && RuleError::fail('RN-PRO-02', "{$v->name} se controla por lote: escanea o elige el lote.");
            $almacen = $d['warehouse_id'] ?? $linea->input_warehouse_id;
            $cuando = isset($d['consumed_at']) ? CarbonImmutable::parse($d['consumed_at'])->setTimezone('America/Lima') : Comun::ahora();
            $fechaConsumo = $cuando->toDateString();
            if ($lote) {
                // RN-PRO-02
                $lote->qc_status === 'RELEASED' || RuleError::fail('RN-PRO-02', "El lote {$lote->code} está ".InventarioService::estado($lote->qc_status).': solo se consume un lote liberado por Calidad.');
                $lote->expiry_date >= $fechaConsumo || RuleError::fail('RN-PRO-02', "El lote {$lote->code} venció el ".Comun::dmy($lote->expiry_date).': no se consume.');
                // RN-PRO-03
                $antes = DB::table('stock_balances as b')->join('lots as l', 'l.id', '=', 'b.lot_id')
                    ->where('b.warehouse_id', $almacen)->where('b.variant_id', $v->id)->where('b.qty', '>', 0.0005)->where('l.id', '<>', $lote->id)
                    ->where('l.qc_status', 'RELEASED')->where('l.expiry_date', '>=', $fechaConsumo)->where('l.expiry_date', '<', $lote->expiry_date)
                    ->orderBy('l.expiry_date')->first(['l.code', 'l.expiry_date']);
                $motivo = Comun::texto($d['fefo_override_reason'] ?? null, 500);
                if ($antes) {
                    $motivo || RuleError::fail('RN-PRO-03', "Por FEFO va primero el lote {$antes->code}, que vence el ".Comun::dmy($antes->expiry_date).". Para usar {$lote->code} escribe el motivo.");
                    Access::can($quien, 'pro.fefo.override') || RuleError::fail('RN-PRO-03', "Por FEFO va primero el lote {$antes->code}. Tomar otro lote lo autoriza el jefe de producción.");
                }
            }
            $qty = Comun::num($d['qty'] ?? $d['weight_kg'] ?? null, 3);
            ($qty !== null && $qty > 0) || RuleError::fail('RN-PRO-04', 'Indica la cantidad consumida.');
            $peso = Comun::num($d['weight_kg'] ?? null, 3) ?? ($v->sale_mode === 'KG' ? $qty : null);
            $teoricos = self::teoricos($o);
            $rol = in_array($d['role'] ?? null, self::ROLES_CONSUMO, true) ? $d['role'] : self::rolDe($v, $teoricos);

            $mov = InventarioService::mover([
                'type' => 'PRODUCTION_OUT', 'warehouse_id' => $almacen, 'variant_id' => $v->id, 'lot_id' => $lote?->id, 'qty' => $qty, 'weight_kg' => $peso,
                'source_type' => 'PRODUCTION_ORDER', 'source_id' => $o->id, 'reason' => "Consumo de la orden {$o->number}", 'moved_at' => $cuando->toDateTimeString(),
            ], $quien);
            $ultimo = null;
            foreach ($mov['moves'] as $m) {
                $q = abs((float) $m['qty']);
                $ultimo = DB::table('production_order_consumptions')->insertGetId([
                    'order_id' => $o->id, 'warehouse_id' => $almacen, 'variant_id' => $v->id, 'lot_id' => $m['lot_id'], 'role' => $rol,
                    'theoretical_kg' => isset($teoricos[$v->id]) ? $teoricos[$v->id]['kg'] : null, 'qty' => $q,
                    'weight_kg' => $m['weight_kg'] !== null ? abs((float) $m['weight_kg']) : $peso, 'unit_cost' => $m['unit_cost'], 'total_cost' => abs((float) $m['total_cost']),
                    'consumed_at' => $cuando, 'fefo_override_reason' => $motivo ?? null, 'stock_movement_id' => $m['movement_id'],
                    'recorded_by' => $quien->id, 'recorded_by_name' => mb_substr((string) $quien->name, 0, 120),
                ], 'id');
            }
            self::iniciar($o, $quien, 'Primer consumo');

            return DB::table('production_order_consumptions')->where('id', $ultimo)->first();
        }), self::MAPA);
    }

    /** PRO-07 Lectura de un punto de control de la receta. RN-PRO-11. */
    public static function lectura(string $id, array $d, User $quien): object
    {
        self::registrador($quien);

        return Comun::base(fn () => DB::transaction(function () use ($id, $d, $quien) {
            $o = self::abierta($id, $quien);
            $o->recipe_version_id || RuleError::fail('RN-PRO-11', 'Esta orden no tiene receta: no tiene puntos de control.');
            $p = DB::table('recipe_control_points')->where('id', $d['control_point_id'] ?? null)->where('version_id', $o->recipe_version_id)->first()
                ?? RuleError::fail('RN-PRO-11', 'Elige un punto de control de la receta de la orden.');
            $valor = Comun::num($d['value'] ?? null, 3);
            $valor !== null || RuleError::fail('RN-PRO-11', 'Indica el valor leído.');
            $enRango = ($p->min_value === null || $valor >= (float) $p->min_value) && ($p->max_value === null || $valor <= (float) $p->max_value);
            $accion = Comun::texto($d['corrective_action'] ?? null, 1000);
            if (! $enRango && ! $accion) {
                RuleError::fail('RN-PRO-11', "{$p->variable} ".Comun::n($valor, 1)." {$p->unit} está fuera del rango ".Comun::n($p->min_value, 1).'–'.Comun::n($p->max_value, 1)
                    ." {$p->unit}: escribe la acción correctiva".($p->corrective_action ? " (la receta indica: {$p->corrective_action})" : '').'.');
            }
            $lid = DB::table('production_ccp_readings')->insertGetId([
                'order_id' => $o->id, 'control_point_id' => $p->id, 'value' => $valor, 'read_at' => isset($d['read_at']) ? CarbonImmutable::parse($d['read_at']) : now(),
                'read_by' => $quien->id, 'reader_name' => mb_substr((string) $quien->name, 0, 120), 'in_range' => $enRango, 'corrective_action' => $accion,
            ], 'id');
            if (! $enRango && $p->is_critical) {
                DB::table('production_orders')->where('id', $o->id)->update(['critical_deviation' => true, 'updated_at' => now()]);
                Comun::avisar('PRO', ['CALIDAD', 'JEFE_PRODUCCION'], "Punto crítico fuera de rango en {$o->number}",
                    "{$p->code} {$p->variable}: ".Comun::n($valor, 1)." {$p->unit} (rango ".Comun::n($p->min_value, 1).'–'.Comun::n($p->max_value, 1)."). Acción: {$accion}. El lote no se libera sin una no conformidad cerrada.",
                    'PRO-07', $o->id, 'bad', null, $o->establishment_id);
            }
            self::iniciar($o, $quien, 'Primera lectura');

            return DB::table('production_ccp_readings')->where('id', $lid)->first();
        }), self::MAPA);
    }

    /**
     * PRO-08 Producción: kg por variante con su lote nuevo (en cuarentena), balanza, subproductos y merma con motivo.
     * $d: output_role, variant_id, qty, weight_kg, lot_code (opcional), expiry_date (opcional), scale_equipment_id, qc_status (lo pedido),
     * template_line_id (despiece), waste_reason (merma).
     */
    public static function producir(string $id, array $d, User $quien): object
    {
        self::registrador($quien);

        return Comun::base(fn () => DB::transaction(function () use ($id, $d, $quien) {
            $o = self::abierta($id, $quien);
            $linea = DB::table('production_lines')->where('id', $o->line_id)->first();
            $rol = $d['output_role'] ?? 'MAIN';
            in_array($rol, self::ROLES_SALIDA, true) || RuleError::fail('RN-PRO-06', 'Elige qué es: producto, coproducto, subproducto o merma.');
            $peso = Comun::num($d['weight_kg'] ?? $d['qty'] ?? null, 3);
            ($peso !== null && $peso > 0) || RuleError::fail('RN-PRO-06', 'Indica los kg pesados.');
            $tplLinea = ! empty($d['template_line_id']) ? DB::table('cutting_template_lines')->where('id', $d['template_line_id'])->where('template_id', $o->cutting_template_id)->first() : null;
            (! empty($d['template_line_id']) && ! $tplLinea) && RuleError::fail('RN-DES-02', 'Ese corte no es de la plantilla del despiece.');
            if ($tplLinea) {
                $rol = $tplLinea->role;
            }
            $ahora = Comun::ahora();
            $balanza = $d['scale_equipment_id'] ?? null;
            if ($balanza) {
                EquiposService::exigirBalanza($balanza, $ahora->toDateString());   // RN-PRO-15
            }

            if ($rol === 'WASTE') {
                $motivo = Comun::texto($d['waste_reason'] ?? null, 500) ?? ($tplLinea ? "Merma del corte {$tplLinea->name}" : null);
                $motivo || RuleError::fail('RN-PRO-08', 'Registrar merma exige el motivo.');
                $sid = DB::table('production_order_outputs')->insertGetId([
                    'order_id' => $o->id, 'output_role' => 'WASTE', 'qty' => $peso, 'weight_kg' => $peso, 'scale_equipment_id' => $balanza,
                    'template_line_id' => $tplLinea?->id, 'waste_reason' => $motivo, 'at' => $ahora, 'recorded_by' => $quien->id, 'recorded_by_name' => mb_substr((string) $quien->name, 0, 120),
                ], 'id');
                self::iniciar($o, $quien, 'Primer registro');

                return self::salida($sid);
            }

            $variante = $tplLinea?->output_variant_id ?? ($d['variant_id'] ?? null) ?? ($rol === 'MAIN' ? $o->output_variant_id : null);
            $v = DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')->where('v.id', $variante)
                ->first(['v.*', 'p.shelf_life_days', 'p.name as product_name', 'p.code as product_code']) ?? RuleError::fail('RN-PRO-06', 'Elige la variante producida.');
            $qty = $v->sale_mode === 'KG' ? $peso : (Comun::num($d['qty'] ?? null, 3) ?? $peso);
            $vida = $o->recipe_version_id ? (int) DB::table('recipe_versions')->where('id', $o->recipe_version_id)->value('shelf_life_days') : 0;
            $vida = $vida ?: (int) ($v->shelf_life_days ?: 7);
            $vence = ! empty($d['expiry_date']) ? Comun::fecha($d['expiry_date']) : $ahora->addDays($vida)->toDateString();
            $vence > $ahora->toDateString() || RuleError::fail('RN-PRO-06', 'El vencimiento debe ser posterior a hoy.');
            $codigo = strtoupper((string) (Comun::texto($d['lot_code'] ?? null, 40) ?? self::codigoLote($ahora)));
            DB::table('lots')->where('code', $codigo)->where('variant_id', $v->id)->exists() && RuleError::fail('RN-PRO-06', "Ya existe el lote {$codigo} de esa variante.");
            $padres = DB::table('production_order_consumptions as c')->join('lots as l', 'l.id', '=', 'c.lot_id')->where('c.order_id', $o->id)->whereIn('c.role', ['RAW_MATERIAL', 'INPUT'])
                ->groupBy('c.lot_id')->selectRaw('c.lot_id, round(sum(coalesce(c.weight_kg, c.qty)), 3) as kg')->get()
                ->map(fn ($p) => ['lot_id' => $p->lot_id, 'kg' => (float) $p->kg, 'order_ref' => $o->number])->all();
            $pedido = in_array($d['qc_status'] ?? null, ['RELEASED', 'QUARANTINE'], true) ? $d['qc_status'] : null;
            $lote = LotesService::crear([
                'product_id' => $v->product_id, 'variant_id' => $v->id, 'code' => $codigo, 'origin' => $o->order_type === 'CUTTING' ? 'CUTTING' : 'PRODUCTION',
                'production_date' => $ahora->toDateString(), 'expiry_date' => $vence, 'unit_cost' => 0, 'cost_basis' => $v->sale_mode === 'KG' ? 'KG' : 'UNIT',
                'production_order_ref' => $o->number, 'supervisor_user_id' => $o->supervisor_user_id, 'parent_lots' => $padres,
                'requested_qc_status' => $pedido, 'ccp_deviation' => (bool) $o->critical_deviation,
            ], $quien, "Producción de la orden {$o->number}");
            if ($pedido === 'RELEASED' && ! DB::table('tenant_modules')->where('module_code', 'CAL')->where('enabled', true)->exists()) {
                // Sin CAL, el jefe puede registrar el lote ya liberado (fase 1: libera ALM).
                LotesService::cambiarEstado($lote->id, 'RELEASED', null, $quien);
            }
            // Costo provisional del ingreso: el estándar por kg (el final se fija al cerrar, RN-PRO-17).
            $estandar = (float) ($o->standard_cost_per_kg ?: ($v->std_cost ?: 0));
            $porUnidad = $qty > 0 ? $estandar * $peso / $qty : 0;
            $mov = InventarioService::mover([
                'type' => 'PRODUCTION_IN', 'warehouse_id' => $d['warehouse_id'] ?? $linea->output_warehouse_id, 'variant_id' => $v->id, 'lot_id' => $lote->id,
                'qty' => $qty, 'weight_kg' => $peso, 'unit_cost' => round($porUnidad, 4), 'source_type' => 'PRODUCTION_ORDER', 'source_id' => $o->id,
                'reason' => "Producción de la orden {$o->number}",
            ], $quien);
            $sid = DB::table('production_order_outputs')->insertGetId([
                'order_id' => $o->id, 'output_role' => $rol, 'variant_id' => $v->id, 'lot_id' => $lote->id, 'warehouse_id' => $mov['moves'][0]['warehouse_id'],
                'qty' => $qty, 'weight_kg' => $peso, 'scale_equipment_id' => $balanza, 'template_line_id' => $tplLinea?->id,
                'stock_movement_id' => $mov['moves'][0]['movement_id'], 'at' => $ahora, 'recorded_by' => $quien->id, 'recorded_by_name' => mb_substr((string) $quien->name, 0, 120),
            ], 'id');
            self::iniciar($o, $quien, 'Primer registro');
            Events::emit('lot.produced', 'lots', $lote->id, ['code' => $codigo, 'order' => $o->number, 'weight_kg' => $peso, 'qc_status' => DB::table('lots')->where('id', $lote->id)->value('qc_status')]);

            return self::salida($sid);
        }), self::MAPA);
    }

    /** PRO-09 Personal: operario, función, horas y tarifa (RN-PRO-16, RN-PRO-18). */
    public static function personal(string $id, array $d, User $quien): object
    {
        self::registrador($quien);

        return Comun::base(fn () => DB::transaction(function () use ($id, $d, $quien) {
            $o = self::abierta($id, $quien);
            $e = DB::table('employees')->where('id', $d['employee_id'] ?? null)->first() ?? RuleError::fail('RN-PRO-16', 'Elige al trabajador.');
            $e->status === 'ACTIVE' || RuleError::fail('RN-PRO-16', "{$e->full_name} no está activo.");
            $funcion = in_array($d['task_role'] ?? null, self::FUNCIONES, true) ? $d['task_role'] : 'HELPER';
            $horas = self::horas($d['hours'] ?? null);
            [$tarifa, $origen] = self::tarifa($d, $quien);
            $lid = DB::table('production_order_labor')->insertGetId([
                'order_id' => $o->id, 'employee_id' => $e->id, 'task_role' => $funcion, 'work_date' => Comun::fecha($d['work_date'] ?? null), 'hours' => $horas,
                'hourly_rate' => $tarifa, 'cost' => round($horas * $tarifa, 2), 'rate_source' => $origen, 'recorded_by' => $quien->id,
            ], 'id');
            self::iniciar($o, $quien, 'Primer registro');

            return DB::table('production_order_labor')->where('id', $lid)->first();
        }), self::MAPA);
    }

    /** PRO-09 Equipos: horas con la carga por hora del equipo; EQU registra el uso (RN-PRO-15, RN-PRO-16). */
    public static function equipo(string $id, array $d, User $quien): object
    {
        self::registrador($quien);

        return Comun::base(fn () => DB::transaction(function () use ($id, $d, $quien) {
            $o = self::abierta($id, $quien);
            $horas = self::horas($d['hours'] ?? null);
            $fecha = Comun::fecha($d['used_on'] ?? null);
            $e = EquiposService::exigirApto((string) ($d['equipment_id'] ?? ''), $fecha);
            $uso = EquiposService::registrarUso(['equipment_id' => $e->id, 'hours' => $horas, 'used_on' => $fecha, 'production_order_id' => $o->id,
                'order_ref' => $o->number, 'source' => 'PRO'], $quien);
            $lid = DB::table('production_order_equipment')->insertGetId([
                'order_id' => $o->id, 'equipment_id' => $e->id, 'equipment_name' => mb_substr($e->name, 0, 80), 'used_on' => $fecha, 'hours' => $horas,
                'hourly_rate' => $uso->hourly_rate, 'cost' => $uso->cost, 'equipment_usage_id' => $uso->id, 'recorded_by' => $quien->id,
            ], 'id');
            self::iniciar($o, $quien, 'Primer registro');

            return DB::table('production_order_equipment')->where('id', $lid)->first();
        }), self::MAPA);
    }

    /* ================================================================ cifras y cierre (PRO-10) */

    /**
     * Rendimiento, merma y costo de la orden con lo registrado hasta ahora (RN-PRO-06, 07 y 08).
     * En un despiece, el costo por corte sale de DespieceService::costeo().
     */
    public static function resumen(string $id): array
    {
        $o = DB::table('production_orders')->where('id', $id)->first() ?? RuleError::fail('RN-PRO-04', 'Orden no encontrada.');
        $c = DB::table('production_order_consumptions')->where('order_id', $id)
            ->selectRaw('role, sum(coalesce(weight_kg, qty)) as kg, sum(total_cost) as costo')->groupBy('role')->get()->keyBy('role');
        $s = DB::table('production_order_outputs')->where('order_id', $id)->selectRaw('output_role, sum(weight_kg) as kg')->groupBy('output_role')->get()->keyBy('output_role');
        $kg = fn ($r) => (float) ($s[$r]->kg ?? 0);
        $entrada = (float) ($c['RAW_MATERIAL']->kg ?? 0) + (float) ($c['INPUT']->kg ?? 0);
        $producto = $kg('MAIN') + $kg('CO_PRODUCT') + $kg('BY_PRODUCT');
        $principal = $kg('MAIN') + $kg('CO_PRODUCT');
        $merma = max(0, $entrada - $producto);
        $mp = (float) ($c['RAW_MATERIAL']->costo ?? 0);
        $ins = (float) ($c['INPUT']->costo ?? 0);
        $emp = (float) ($c['PACKAGING']->costo ?? 0);
        $mo = (float) DB::table('production_order_labor')->where('order_id', $id)->sum('cost');
        $eq = (float) DB::table('production_order_equipment')->where('order_id', $id)->sum('cost');
        $total = round($mp + $ins + $emp + $mo + $eq, 2);
        $rend = $entrada > 0 ? round($producto / $entrada * 100, 2) : null;
        $esperado = $o->expected_yield_pct !== null ? (float) $o->expected_yield_pct : null;
        $desv = $rend !== null && $esperado !== null ? round($rend - $esperado, 2) : null;
        $linea = DB::table('production_lines')->where('id', $o->line_id)->first();
        $maxMerma = (float) ($linea->max_waste_pct ?? Params::get('pro_max_waste_pct', ['site' => $o->establishment_id]) ?? 8);
        $tol = (float) (Params::get('pro_yield_tolerance_pp', ['site' => $o->establishment_id]) ?? 3);
        $mermaPct = $entrada > 0 ? round($merma / $entrada * 100, 2) : null;
        $porKg = $principal > 0 ? round($total / $principal, 4) : null;
        $estandar = $o->standard_cost_per_kg !== null ? (float) $o->standard_cost_per_kg : null;

        return [
            'input_kg' => Comun::t($entrada), 'output_kg' => Comun::t($producto), 'main_kg' => Comun::t($principal), 'by_product_kg' => Comun::t($kg('BY_PRODUCT')),
            'waste_kg' => Comun::t($merma), 'waste_recorded_kg' => Comun::t($kg('WASTE')), 'waste_pct' => Comun::t($mermaPct, 2), 'max_waste_pct' => Comun::t($maxMerma, 2),
            'actual_yield_pct' => Comun::t($rend, 2), 'expected_yield_pct' => Comun::t($esperado, 2), 'yield_deviation_pp' => Comun::t($desv, 2), 'yield_tolerance_pp' => Comun::t($tol, 2),
            'needs_yield_reason' => $desv !== null && abs($desv) > $tol + 0.00001, 'needs_waste_reason' => $mermaPct !== null && $mermaPct > $maxMerma + 0.00001,
            'raw_material_cost' => Comun::t($mp, 2), 'input_cost' => Comun::t($ins, 2), 'packaging_cost' => Comun::t($emp, 2), 'material_cost' => Comun::t($mp + $ins + $emp, 2),
            'labor_cost' => Comun::t($mo, 2), 'equipment_cost' => Comun::t($eq, 2), 'total_cost' => Comun::t($total, 2),
            'cost_per_kg' => $o->order_type === 'CUTTING' ? null : Comun::t($porKg, 4), 'standard_cost_per_kg' => Comun::t($estandar, 4),
            'cost_deviation_pct' => $porKg !== null && $estandar ? Comun::t(($porKg - $estandar) / $estandar * 100, 2) : null,
            'ingredient_cost_per_kg' => $entrada > 0 ? Comun::t(($mp + $ins) / $entrada, 4) : null,
            'critical_deviation' => (bool) $o->critical_deviation,
        ];
    }

    /**
     * PRO-10 Cierre. $d: close_date, yield_deviation_reason, waste_reason, mass_balance_override (despiece).
     * Fija las cifras, el costo de cada lote producido y emite production_order.closed (RN-PRO-17).
     */
    public static function cerrar(string $id, array $d, User $quien): object
    {
        Access::can($quien, 'pro.order.close') || RuleError::fail('RN-PRO-09', 'Cerrar una orden lo hace el jefe de producción.');

        return Comun::base(fn () => DB::transaction(function () use ($id, $d, $quien) {
            $o = self::abierta($id, $quien);
            $fecha = Comun::fecha($d['close_date'] ?? null);
            // RN-PRO-10
            Periodos::cerrado($fecha, $o->company_id) && RuleError::fail('RN-PRO-10', 'El período de '.Periodos::nombre($fecha).' está cerrado: la orden no se cierra con fecha '.Comun::dmy($fecha).'.');
            DB::table('production_order_outputs')->where('order_id', $id)->where('output_role', '<>', 'WASTE')->exists()
                || RuleError::fail('RN-PRO-06', 'Registra al menos un producto antes de cerrar.');
            $r = self::resumen($id);
            $motivo = Comun::texto($d['yield_deviation_reason'] ?? null, 500);
            if ($r['needs_yield_reason'] && ! $motivo) {
                RuleError::fail('RN-PRO-06', 'El rendimiento real es '.Comun::n($r['actual_yield_pct']).' % frente a '.Comun::n($r['expected_yield_pct']).' % esperado ('
                    .($r['yield_deviation_pp'] > 0 ? '+' : '').Comun::n($r['yield_deviation_pp']).' puntos): escribe el motivo de la desviación.');
            }
            $mermaMotivo = Comun::texto($d['waste_reason'] ?? null, 500);
            if ($r['needs_waste_reason'] && ! $mermaMotivo) {
                RuleError::fail('RN-PRO-08', 'La merma es '.Comun::n($r['waste_pct']).' % y supera el '.Comun::n($r['max_waste_pct']).' % de la línea: escribe el motivo.');
            }
            $cambios = [
                'status' => 'CLOSED', 'closed_at' => now(), 'close_date' => $fecha, 'closed_by' => $quien->id, 'updated_at' => now(),
                'yield_deviation_reason' => $motivo, 'waste_reason' => $mermaMotivo,
            ];
            foreach (['input_kg', 'output_kg', 'main_kg', 'waste_kg', 'waste_pct', 'actual_yield_pct', 'yield_deviation_pp', 'raw_material_cost', 'input_cost',
                'packaging_cost', 'material_cost', 'labor_cost', 'equipment_cost', 'total_cost', 'cost_per_kg', 'ingredient_cost_per_kg'] as $k) {
                $cambios[$k] = $r[$k];
            }
            $lotes = [];
            if ($o->order_type === 'CUTTING') {
                $costeo = DespieceService::cerrar($o, $r, (bool) ($d['mass_balance_override'] ?? false), $quien);
                $cambios += ['mass_balance_pct' => $costeo['mass_balance']['difference_pct'], 'joint_cost' => $costeo['joint_cost'], 'nrv_total' => $costeo['nrv_total'],
                    'cut_alerts' => json_encode($costeo['alerts'], JSON_UNESCAPED_UNICODE), 'mass_balance_override_by' => $costeo['mass_balance']['override'] ? $quien->id : null];
                foreach ($costeo['rows'] as $f) {
                    if ($f['lot_id']) {
                        $lotes[] = ['lot_id' => $f['lot_id'], 'kg' => $f['weight_kg'], 'cost' => $f['allocated_cost'], 'unit_cost' => $f['unit_cost']];
                    }
                }
            } else {
                $porKg = (float) $r['cost_per_kg'];
                foreach (DB::table('production_order_outputs')->where('order_id', $id)->where('output_role', '<>', 'WASTE')->get() as $s) {
                    // Los subproductos de una receta no llevan costo: lo absorbe el producto (RN-PRO-07, RN-PRO-08).
                    $costo = in_array($s->output_role, ['MAIN', 'CO_PRODUCT'], true) ? round($porKg * (float) $s->weight_kg, 2) : 0.0;
                    $unit = (float) $s->qty > 0 ? $costo / (float) $s->qty : 0;
                    DB::table('production_order_outputs')->where('id', $s->id)->update(['allocated_cost' => $costo, 'unit_cost' => round($unit, 6), 'updated_at' => now()]);
                    LotesService::fijarCosto($s->lot_id, $unit);
                    $lotes[] = ['lot_id' => $s->lot_id, 'kg' => Comun::t($s->weight_kg), 'cost' => Comun::t($costo, 2), 'unit_cost' => Comun::t($unit, 4)];
                }
            }
            $cambios['history'] = Comun::historial($o->history, 'Cierre', 'Costo S/ '.Comun::n($r['total_cost']).($r['cost_per_kg'] ? ' · S/ '.Comun::n($r['cost_per_kg'], 4).' por kg' : '')
                .' · rendimiento '.Comun::n($r['actual_yield_pct']).' %', $quien);
            DB::table('production_orders')->where('id', $id)->update($cambios);
            // RN-PRO-17: CNT arma el asiento con esto; ALM ya recibió los lotes al registrarlos.
            Events::emit('production_order.closed', 'production_orders', $id, ['number' => $o->number, 'order_type' => $o->order_type, 'close_date' => $fecha,
                'total_cost' => $r['total_cost'], 'cost_per_kg' => $r['cost_per_kg'], 'lots' => $lotes, 'cost_center_id' => DB::table('production_lines')->where('id', $o->line_id)->value('cost_center_id')]);

            return self::orden($id);
        }), self::MAPA);
    }

    /* ================================================================ lecturas */

    public static function orden(string $id): object
    {
        $o = DB::table('production_orders as o')->join('production_lines as l', 'l.id', '=', 'o.line_id')->join('establishments as s', 's.id', '=', 'o.establishment_id')
            ->leftJoin('products as p', 'p.id', '=', 'o.product_id')->leftJoin('brands as b', 'b.id', '=', 'o.brand_id')
            ->leftJoin('users as u', 'u.id', '=', 'o.supervisor_user_id')->leftJoin('product_variants as ov', 'ov.id', '=', 'o.output_variant_id')
            ->leftJoin('product_variants as sv', 'sv.id', '=', 'o.source_variant_id')
            ->leftJoin('recipe_versions as rv', 'rv.id', '=', 'o.recipe_version_id')->leftJoin('recipes as r', 'r.id', '=', 'rv.recipe_id')
            ->leftJoin('cutting_templates as ct', 'ct.id', '=', 'o.cutting_template_id')
            ->leftJoin('users as cu', 'cu.id', '=', 'o.closed_by')
            ->where('o.id', $id)
            ->first(['o.*', 'l.code as line_code', 'l.name as line_name', 'l.line_type', 'l.input_warehouse_id', 'l.output_warehouse_id', DB::raw('coalesce(s.short, s.name) as establishment_name'),
                'p.name as product_name', 'p.code as product_code', 'b.name as brand_name', 'u.name as supervisor_name', 'ov.sku as output_sku', 'ov.name as output_variant_name',
                'sv.sku as source_sku', 'sv.name as source_variant_name', 'r.code as recipe_code', 'r.name as recipe_name', 'rv.version as recipe_version', 'rv.base_output_kg',
                'ct.code as template_code', 'ct.name as template_name', 'ct.version as template_version', 'ct.species', 'cu.name as closed_by_name'])
            ?? RuleError::fail('RN-PRO-04', 'Orden no encontrada.');
        $o->history = json_decode($o->history ?? '[]', true) ?: [];
        $o->cut_alerts = json_decode($o->cut_alerts ?? '[]', true) ?: [];

        return $o;
    }

    /** RN-PRO-12: kg teóricos por variante (receta escalada) y empaques; en un despiece, kg de la canal por plantilla. */
    public static function teoricos(object $o): array
    {
        $out = [];
        if ($o->recipe_version_id) {
            $e = RecetasService::escalar($o->recipe_version_id, $o->planned_output_kg);
            foreach ($e['lines'] as $l) {
                $out[$l['variant_id']] = ['kg' => $l['kg'], 'tolerance_kg' => $l['tolerance_kg'], 'is_additive' => $l['is_additive'], 'packaging' => false, 'sku' => $l['sku'], 'name' => $l['name']];
            }
            foreach (Comun::empaques($e['packaging']) as $p) {
                $out[$p['variant_id']] ??= ['kg' => $p['qty'], 'tolerance_kg' => null, 'is_additive' => false, 'packaging' => true, 'sku' => null, 'name' => null];
            }
        } elseif ($o->source_variant_id) {
            $out[$o->source_variant_id] = ['kg' => Comun::t($o->planned_output_kg), 'tolerance_kg' => null, 'is_additive' => false, 'packaging' => false, 'sku' => null, 'name' => null];
        }

        return $out;
    }

    /**
     * PRO-06: lo teórico frente a lo consumido por variante, con la sugerencia FEFO del almacén de insumos.
     *
     * @return list<array>
     */
    public static function consumoTeorico(string $id): array
    {
        $o = self::orden($id);
        $teo = self::teoricos($o);
        $real = DB::table('production_order_consumptions')->where('order_id', $id)->selectRaw('variant_id, sum(coalesce(weight_kg, qty)) as kg, sum(qty) as qty, sum(total_cost) as cost')
            ->groupBy('variant_id')->get()->keyBy('variant_id');
        $ids = array_values(array_unique(array_merge(array_keys($teo), $real->keys()->all())));
        $var = DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')->whereIn('v.id', $ids)->get(['v.id', 'v.sku', 'v.name', 'v.sale_mode', 'p.product_type'])->keyBy('id');
        $filas = [];
        foreach ($ids as $vid) {
            $t = $teo[$vid] ?? null;
            $k = (float) ($real[$vid]->kg ?? 0);
            $fefo = InventarioService::lotesDisponibles($vid, ['warehouse_id' => $o->input_warehouse_id])->first();
            $filas[] = [
                'variant_id' => $vid, 'sku' => $var[$vid]->sku ?? null, 'name' => $var[$vid]->name ?? null, 'sale_mode' => $var[$vid]->sale_mode ?? 'KG',
                'role' => self::rolDe($var[$vid] ?? (object) ['sku' => '', 'product_type' => null], $teo),
                'theoretical_kg' => $t['kg'] ?? null, 'tolerance_kg' => $t['tolerance_kg'] ?? null, 'is_additive' => $t['is_additive'] ?? false,
                'consumed_kg' => Comun::t($k), 'difference_kg' => $t ? Comun::t($k - (float) $t['kg']) : null,
                'fefo' => $fefo ? ['lot_id' => $fefo->lot_id, 'lot_code' => $fefo->lot_code, 'expiry_date' => $fefo->expiry_date, 'available_qty' => $fefo->available_qty] : null,
            ];
        }

        return $filas;
    }

    /* ================================================================ apoyo */

    private static function registrador(User $quien): void
    {
        Access::can($quien, 'pro.order.record') || RuleError::fail('RN-PRO-09', 'No tienes permiso para registrar en órdenes de producción.');
    }

    private static function bloquear(string $id, User $quien): object
    {
        $o = DB::table('production_orders')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-PRO-04', 'Orden no encontrada.');
        Comun::exigirLocal($quien, $o->establishment_id, 'RN-PRO-09', 'La orden');

        return $o;
    }

    /** RN-PRO-04: solo RELEASED o IN_PROGRESS. */
    private static function abierta(string $id, User $quien): object
    {
        $o = self::bloquear($id, $quien);
        if (! in_array($o->status, self::ABIERTAS, true)) {
            RuleError::fail('RN-PRO-04', match ($o->status) {
                'PLANNED' => "La orden {$o->number} está planificada: el jefe de producción la libera antes de registrar.",
                'CLOSED' => "La orden {$o->number} está cerrada y no se modifica.",
                default => "La orden {$o->number} está anulada y no se modifica.",
            });
        }

        return $o;
    }

    private static function iniciar(object $o, User $quien, string $que): void
    {
        if ($o->status === 'RELEASED') {
            DB::table('production_orders')->where('id', $o->id)->update(['status' => 'IN_PROGRESS', 'started_at' => now(), 'updated_at' => now(),
                'history' => Comun::historial($o->history, 'Inicio', $que, $quien)]);
            $o->status = 'IN_PROGRESS';
        }
    }

    /** RN-PRO-16 */
    private static function horas(mixed $v): float
    {
        $h = Comun::num($v, 2);
        ($h !== null && $h > 0) || RuleError::fail('RN-PRO-16', 'Las horas deben ser mayores que cero.');
        $max = (float) (Params::get('pro_max_hours_per_record') ?? 12);
        $h <= $max || RuleError::fail('RN-PRO-16', 'Un registro no pasa de '.Comun::n($max, 0).' horas. Registra el resto aparte.');

        return $h;
    }

    /** RN-PRO-18: tarifa de PER (fase 3) o del parámetro. Una tarifa distinta la fija solo el jefe (RN-PRO-09). */
    private static function tarifa(array $d, User $quien): array
    {
        $param = (float) (Params::get('pro_default_labor_rate_pen') ?? 9.5);
        $dada = Comun::num($d['hourly_rate'] ?? null, 4);
        if ($dada !== null && abs($dada - $param) > 0.00001) {
            Access::can($quien, 'pro.order.close') || RuleError::fail('RN-PRO-09', 'El operario no cambia tarifas: se usa S/ '.Comun::n($param).' por hora.');

            return [$dada, 'MANUAL'];
        }

        return [$param, 'PARAM'];
    }

    /** Materia prima, insumo o empaque (para el desglose de RN-PRO-07). */
    private static function rolDe(object $v, array $teoricos): string
    {
        if (($v->product_type ?? null) === 'PACKAGING' || ($teoricos[$v->id ?? '']['packaging'] ?? false)) {
            return 'PACKAGING';
        }
        if (($teoricos[$v->id ?? '']['is_additive'] ?? false)) {
            return 'INPUT';
        }

        return str_starts_with((string) $v->sku, 'MP-') || in_array($v->product_type ?? null, ['GOODS'], true) ? 'RAW_MATERIAL' : 'INPUT';
    }

    /** L261124-001: lote del día, correlativo por empresa. */
    private static function codigoLote(CarbonImmutable $hoy): string
    {
        $pref = 'L'.$hoy->format('ymd').'-';
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['pro:lote:'.$pref.DB::selectOne('SELECT app_tenant_id() AS t')->t]);
        $max = DB::table('lots')->where('code', 'like', $pref.'%')->selectRaw("max(nullif(regexp_replace(substr(code, ?), '\\D', '', 'g'), '')::int) AS n", [strlen($pref) + 1])->value('n');

        return $pref.str_pad((string) (((int) $max) + 1), 3, '0', STR_PAD_LEFT);
    }

    private static function salida(string $id): object
    {
        return DB::table('production_order_outputs as s')->leftJoin('lots as l', 'l.id', '=', 's.lot_id')->leftJoin('product_variants as v', 'v.id', '=', 's.variant_id')
            ->where('s.id', $id)->first(['s.*', 'l.code as lot_code', 'l.qc_status', 'l.requested_qc_status', 'l.expiry_date', 'v.sku', 'v.name as variant_name']);
    }

    /** Consumos de la orden, para la ficha y para la trazabilidad. */
    public static function consumos(string $id): Collection
    {
        return DB::table('production_order_consumptions as c')->join('product_variants as v', 'v.id', '=', 'c.variant_id')->leftJoin('lots as l', 'l.id', '=', 'c.lot_id')
            ->leftJoin('suppliers as su', 'su.id', '=', 'l.supplier_id')->join('warehouses as w', 'w.id', '=', 'c.warehouse_id')
            ->where('c.order_id', $id)->orderBy('c.consumed_at')
            ->get(['c.*', 'v.sku', 'v.name as variant_name', 'l.code as lot_code', 'l.expiry_date', 'l.origin as lot_origin', DB::raw('coalesce(su.trade_name, su.legal_name) as supplier_name'), 'w.code as warehouse_code']);
    }

    public static function salidas(string $id): Collection
    {
        return DB::table('production_order_outputs as s')->leftJoin('product_variants as v', 'v.id', '=', 's.variant_id')->leftJoin('lots as l', 'l.id', '=', 's.lot_id')
            ->leftJoin('equipment as e', 'e.id', '=', 's.scale_equipment_id')->leftJoin('cutting_template_lines as tl', 'tl.id', '=', 's.template_line_id')
            ->where('s.order_id', $id)->orderBy('s.at')
            ->get(['s.*', 'v.sku', 'v.name as variant_name', 'l.code as lot_code', 'l.qc_status', 'l.expiry_date', 'l.requested_qc_status', 'e.code as scale_code', 'tl.name as cut_name', 'tl.standard_yield_pct']);
    }
}
