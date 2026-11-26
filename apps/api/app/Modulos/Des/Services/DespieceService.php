<?php

namespace App\Modulos\Des\Services;

use App\Models\User;
use App\Modulos\Alm\Services\LotesService;
use App\Modulos\Cat\Services\Precios;
use App\Modulos\Pro\Services\Comun;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * DES · Despiece y costeo conjunto. Dueño de cutting_templates, cutting_template_lines y cut_reference_prices.
 * El despiece es una orden CUTTING de PRO: PRO registra la canal (consumo) y cada corte (producción);
 * DES pone la plantilla, los precios de referencia, el balance de masa y el costeo al cerrar.
 *
 *  RN-DES-01  se activa con la suma de rendimientos = 100 % ± des_template_sum_tolerance_pct y al menos un coproducto.
 *  RN-DES-02  costo conjunto = canal + mano de obra + equipos − VNR de subproductos; el resto por valor de mercado relativo. La merma sin costo.
 *  RN-DES-03  cada importe a 2 decimales; la diferencia va al coproducto de mayor valor de mercado.
 *  RN-DES-04  balance de masa: kg de entrada = cortes + subproductos + merma registrada, dentro de la tolerancia (o des.mass_balance.override).
 *  RN-DES-05  un corte que se aleja del estándar más de des_cut_yield_alert_pp avisa al jefe de producción.
 *  RN-DES-06  el VNR de los subproductos no puede igualar ni superar el costo conjunto.
 *  RN-DES-07  cada coproducto y subproducto necesita precio de referencia vigente a la fecha.
 *  RN-DES-08  una plantilla ACTIVE por producto de entrada (también en la base); activar retira la anterior.
 *  RN-DES-09  el lote de entrada es del producto de la plantilla y está liberado (lo valida PRO al consumir).
 *  RN-DES-10  el subproducto sale con su lote y su costo es su VNR.
 */
final class DespieceService
{
    public const ROLES = ['CO_PRODUCT', 'BY_PRODUCT', 'WASTE'];

    private const MAPA = [
        'cutting_templates_una_activa' => ['RN-DES-08', 'Ya hay una plantilla activa para ese producto de entrada.'],
        'cutting_templates_tenant_id_code_version_unique' => ['RN-DES-08', 'Ya existe esa versión de la plantilla.'],
        'cutting_template_lines_seq' => ['RN-DES-01', 'Dos cortes tienen el mismo orden.'],
        'cutting_template_lines_variante' => ['RN-DES-01', 'Un corte que no es merma necesita su variante.'],
        'cut_reference_prices_precio' => ['RN-DES-07', 'El precio debe ser mayor que cero.'],
    ];

    /* ================================================================ plantillas (DES-01, DES-02) */

    /**
     * Crea o edita una plantilla en borrador con sus cortes. $d: code, name, species, input_variant_id, mass_balance_tolerance_pct,
     * notes, lines: [{seq, name, role, output_variant_id, standard_yield_pct, nrv_cost_per_kg, notes}].
     */
    public static function guardarPlantilla(array $d, ?string $id, User $quien): object
    {
        self::gestor($quien);

        return Comun::base(fn () => DB::transaction(function () use ($d, $id, $quien) {
            $antes = $id ? (DB::table('cutting_templates')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-DES-01', 'Plantilla no encontrada.')) : null;
            ($antes && $antes->status !== 'DRAFT') && RuleError::fail('RN-DES-08', "La plantilla {$antes->code} v{$antes->version} no está en borrador: crea una versión nueva para cambiarla.");
            $variante = DB::table('product_variants')->where('id', $d['input_variant_id'] ?? $antes?->input_variant_id)->first() ?? RuleError::fail('RN-DES-09', 'Elige el producto de entrada (canal, pieza o entero).');
            $codigo = strtoupper((string) Comun::texto($d['code'] ?? $antes?->code, 40));
            $nombre = Comun::texto($d['name'] ?? $antes?->name, 80);
            ($codigo !== '' && $nombre) || RuleError::fail('RN-DES-01', 'La plantilla necesita código y nombre.');
            $especie = strtoupper((string) Comun::texto($d['species'] ?? $antes?->species, 40));
            $especie !== '' || RuleError::fail('RN-DES-01', 'Indica la especie.');
            $fila = [
                'code' => $codigo, 'name' => $nombre, 'species' => $especie, 'input_variant_id' => $variante->id, 'input_product_id' => $variante->product_id,
                'brand_id' => $d['brand_id'] ?? $antes?->brand_id ?? $variante->brand_id,
                'mass_balance_tolerance_pct' => array_key_exists('mass_balance_tolerance_pct', $d) ? Comun::num($d['mass_balance_tolerance_pct'], 2) : $antes?->mass_balance_tolerance_pct,
                'notes' => array_key_exists('notes', $d) ? Comun::texto($d['notes'], 2000) : $antes?->notes, 'updated_at' => now(),
            ];
            if ($antes) {
                DB::table('cutting_templates')->where('id', $id)->update($fila + ['history' => Comun::historial($antes->history, 'Edición', 'Borrador actualizado', $quien)]);
            } else {
                DB::table('cutting_templates')->where('code', $codigo)->exists() && RuleError::fail('RN-DES-08', "Ya existe la plantilla {$codigo}: crea una versión nueva desde ella.");
                $id = DB::table('cutting_templates')->insertGetId($fila + ['version' => 1, 'status' => 'DRAFT', 'created_by' => $quien->id,
                    'history' => Comun::historial(null, 'Creación', 'Borrador', $quien)], 'id');
            }
            if (array_key_exists('lines', $d)) {
                DB::table('cutting_template_lines')->where('template_id', $id)->delete();
                foreach (array_values($d['lines'] ?? []) as $i => $l) {
                    $rol = in_array($l['role'] ?? null, self::ROLES, true) ? $l['role'] : RuleError::fail('RN-DES-01', 'Cada corte necesita su rol: coproducto, subproducto o merma.');
                    $pct = Comun::num($l['standard_yield_pct'] ?? null, 3);
                    ($pct !== null && $pct >= 0 && $pct <= 100) || RuleError::fail('RN-DES-01', 'El rendimiento estándar de cada corte va de 0 a 100 %.');
                    ($rol !== 'WASTE' && empty($l['output_variant_id'])) && RuleError::fail('RN-DES-01', 'El corte «'.($l['name'] ?? '').'» necesita su variante de salida.');
                    DB::table('cutting_template_lines')->insert([
                        'template_id' => $id, 'seq' => (int) ($l['seq'] ?? (($i + 1) * 10)), 'name' => Comun::texto($l['name'] ?? null, 80) ?? RuleError::fail('RN-DES-01', 'Cada corte necesita su nombre.'),
                        'role' => $rol, 'output_variant_id' => $rol === 'WASTE' ? null : $l['output_variant_id'], 'standard_yield_pct' => $pct,
                        'nrv_cost_per_kg' => $rol === 'BY_PRODUCT' ? (Comun::num($l['nrv_cost_per_kg'] ?? 0, 4) ?? 0) : 0, 'notes' => Comun::texto($l['notes'] ?? null, 500),
                    ]);
                }
            }

            return self::plantilla($id);
        }), self::MAPA);
    }

    /** RN-DES-01 y RN-DES-08. */
    public static function activar(string $id, User $quien): object
    {
        self::gestor($quien);

        return Comun::base(fn () => DB::transaction(function () use ($id, $quien) {
            $p = DB::table('cutting_templates')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-DES-01', 'Plantilla no encontrada.');
            $p->status === 'DRAFT' || RuleError::fail('RN-DES-08', "La plantilla {$p->code} v{$p->version} no está en borrador.");
            $s = self::suma($id);
            $s['co_products'] >= 1 || RuleError::fail('RN-DES-01', 'La plantilla necesita al menos un coproducto.');
            $s['ok'] || RuleError::fail('RN-DES-01', 'Los rendimientos suman '.Comun::n($s['total'], 2).' %: deben sumar 100 % ± '.Comun::n($s['tolerance'], 1).' %.');
            $anterior = DB::table('cutting_templates')->where('input_variant_id', $p->input_variant_id)->where('status', 'ACTIVE')->lockForUpdate()->first();
            if ($anterior) {
                DB::table('cutting_templates')->where('id', $anterior->id)->update(['status' => 'RETIRED', 'retired_at' => now(), 'retired_by' => $quien->id, 'replaced_by' => $p->id,
                    'updated_at' => now(), 'history' => Comun::historial($anterior->history, 'Retiro', "Reemplazada por {$p->code} v{$p->version}", $quien)]);
            }
            DB::table('cutting_templates')->where('id', $id)->update(['status' => 'ACTIVE', 'activated_at' => now(), 'activated_by' => $quien->id, 'updated_at' => now(),
                'history' => Comun::historial($p->history, 'Activación', 'Suma '.Comun::n($s['total'], 2).' %', $quien)]);
            Events::emit('cutting_template.activated', 'cutting_templates', $id, ['code' => $p->code, 'version' => (int) $p->version, 'replaces' => $anterior?->id]);

            return self::plantilla($id);
        }), self::MAPA);
    }

    /** Copia una plantilla activa o retirada en un borrador nuevo (versión + 1). */
    public static function nuevaVersion(string $id, User $quien): object
    {
        self::gestor($quien);

        return Comun::base(fn () => DB::transaction(function () use ($id, $quien) {
            $p = DB::table('cutting_templates')->where('id', $id)->first() ?? RuleError::fail('RN-DES-01', 'Plantilla no encontrada.');
            DB::table('cutting_templates')->where('code', $p->code)->where('status', 'DRAFT')->exists()
                && RuleError::fail('RN-DES-08', "La plantilla {$p->code} ya tiene un borrador en curso.");
            $version = (int) DB::table('cutting_templates')->where('code', $p->code)->max('version') + 1;
            $nuevo = DB::table('cutting_templates')->insertGetId([
                'code' => $p->code, 'name' => $p->name, 'species' => $p->species, 'brand_id' => $p->brand_id, 'input_product_id' => $p->input_product_id,
                'input_variant_id' => $p->input_variant_id, 'version' => $version, 'status' => 'DRAFT', 'mass_balance_tolerance_pct' => $p->mass_balance_tolerance_pct,
                'notes' => $p->notes, 'created_by' => $quien->id, 'parent_id' => $p->id, 'history' => Comun::historial(null, 'Creación', "Desde la versión {$p->version}", $quien),
            ], 'id');
            foreach (DB::table('cutting_template_lines')->where('template_id', $id)->orderBy('seq')->get() as $l) {
                DB::table('cutting_template_lines')->insert(['template_id' => $nuevo, 'seq' => $l->seq, 'name' => $l->name, 'role' => $l->role, 'output_variant_id' => $l->output_variant_id,
                    'standard_yield_pct' => $l->standard_yield_pct, 'nrv_cost_per_kg' => $l->nrv_cost_per_kg, 'notes' => $l->notes]);
            }

            return self::plantilla($nuevo);
        }), self::MAPA);
    }

    public static function retirar(string $id, User $quien): object
    {
        self::gestor($quien);

        return DB::transaction(function () use ($id, $quien) {
            $p = DB::table('cutting_templates')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-DES-01', 'Plantilla no encontrada.');
            $p->status === 'RETIRED' && RuleError::fail('RN-DES-08', 'La plantilla ya está retirada.');
            DB::table('production_orders')->where('cutting_template_id', $id)->whereIn('status', ['PLANNED', 'RELEASED', 'IN_PROGRESS'])->exists()
                && RuleError::fail('RN-DES-08', 'Hay despieces abiertos con esta plantilla: ciérralos o anúlalos antes de retirarla.');
            DB::table('cutting_templates')->where('id', $id)->update(['status' => 'RETIRED', 'retired_at' => now(), 'retired_by' => $quien->id, 'updated_at' => now(),
                'history' => Comun::historial($p->history, 'Retiro', 'Retirada a mano', $quien)]);

            return self::plantilla($id);
        });
    }

    /** Suma de rendimientos de la plantilla frente a la tolerancia (RN-DES-01). */
    public static function suma(string $id): array
    {
        $l = DB::table('cutting_template_lines')->where('template_id', $id)->get();
        $total = round((float) $l->sum('standard_yield_pct'), 3);
        $tol = (float) (Params::get('des_template_sum_tolerance_pct') ?? 0.5);

        return ['total' => Comun::t($total, 3), 'tolerance' => Comun::t($tol, 2), 'ok' => abs($total - 100) <= $tol + 0.000001,
            'co_products' => $l->where('role', 'CO_PRODUCT')->count(), 'by_products' => $l->where('role', 'BY_PRODUCT')->count(),
            'co_product_pct' => Comun::t($l->where('role', 'CO_PRODUCT')->sum('standard_yield_pct'), 3), 'waste_pct' => Comun::t($l->where('role', 'WASTE')->sum('standard_yield_pct'), 3)];
    }

    public static function plantilla(string $id): object
    {
        $p = DB::table('cutting_templates as t')->join('product_variants as v', 'v.id', '=', 't.input_variant_id')->leftJoin('brands as b', 'b.id', '=', 't.brand_id')
            ->leftJoin('users as u', 'u.id', '=', 't.activated_by')->where('t.id', $id)
            ->first(['t.*', 'v.sku as input_sku', 'v.name as input_variant_name', 'b.name as brand_name', 'u.name as activated_by_name']) ?? RuleError::fail('RN-DES-01', 'Plantilla no encontrada.');
        $p->history = json_decode($p->history ?? '[]', true) ?: [];
        $hoy = Comun::hoy();
        $p->lines = DB::table('cutting_template_lines as l')->leftJoin('product_variants as v', 'v.id', '=', 'l.output_variant_id')->where('l.template_id', $id)->orderBy('l.seq')
            ->get(['l.*', 'v.sku', 'v.name as variant_name'])->map(function ($l) use ($hoy) {
                $precio = $l->output_variant_id ? self::precioVigente($l->output_variant_id, $hoy) : null;
                $l->reference_price = $precio ? Comun::t($precio->price_per_kg, 4) : null;

                return $l;
            });
        $p->sum = self::suma($id);
        $p->tolerance_default = Comun::t(Params::get('des_mass_balance_tolerance_pct') ?? 2, 2);
        $p->versions = DB::table('cutting_templates')->where('code', $p->code)->orderByDesc('version')->get(['id', 'version', 'status', 'activated_at', 'retired_at']);
        $p->orders = DB::table('production_orders')->where('cutting_template_id', $id)->count();

        return $p;
    }

    /* ================================================================ precios de referencia (DES-03) */

    /** $d: variant_id, price_per_kg (o source = WEB_LIST para tomar la lista web sin IGV), valid_from, note. */
    public static function guardarPrecio(array $d, User $quien): object
    {
        Access::can($quien, 'des.reference_price.manage') || RuleError::fail('RN-DES-07', 'No tienes permiso para cargar precios de referencia.');

        return Comun::base(fn () => DB::transaction(function () use ($d, $quien) {
            $v = DB::table('product_variants')->where('id', $d['variant_id'] ?? null)->first() ?? RuleError::fail('RN-DES-07', 'Elige el corte.');
            $desde = Comun::fecha($d['valid_from'] ?? null);
            $origen = ($d['source'] ?? 'MANUAL') === 'WEB_LIST' ? 'WEB_LIST' : 'MANUAL';
            $web = null;
            if ($origen === 'WEB_LIST') {
                $w = Precios::vigente($v->id, ['canal' => 'WEB', 'fecha' => $desde]) ?? RuleError::fail('RN-DES-07', "{$v->sku} no tiene precio en la lista web a esa fecha: escríbelo a mano.");
                $web = (float) $w['price'];
                $precio = round($web / 1.18, 4);   // D-DES-02: lista web sin IGV
            } else {
                $precio = Comun::num($d['price_per_kg'] ?? null, 4);
            }
            ($precio !== null && $precio > 0) || RuleError::fail('RN-DES-07', 'El precio por kg debe ser mayor que cero.');
            $previo = DB::table('cut_reference_prices')->where('variant_id', $v->id)->where('status', 'ACTIVE')->lockForUpdate()->get();
            foreach ($previo as $p) {
                $p->valid_from >= $desde && RuleError::fail('RN-DES-07', 'Ya hay un precio desde el '.Comun::dmy($p->valid_from).': la nueva vigencia debe empezar después.');
                DB::table('cut_reference_prices')->where('id', $p->id)->update(['status' => 'REPLACED', 'valid_to' => CarbonImmutable::parse($desde)->subDay()->toDateString(), 'updated_at' => now()]);
            }
            $id = DB::table('cut_reference_prices')->insertGetId([
                'variant_id' => $v->id, 'price_per_kg' => $precio, 'valid_from' => $desde, 'source' => $origen, 'web_price_per_kg' => $web,
                'note' => Comun::texto($d['note'] ?? null, 255) ?? ($origen === 'WEB_LIST' ? 'Lista web sin IGV (D-DES-02)' : null), 'status' => 'ACTIVE', 'created_by' => $quien->id,
            ], 'id');

            return DB::table('cut_reference_prices')->where('id', $id)->first();
        }), self::MAPA);
    }

    /** RN-DES-07: precio de referencia vigente a la fecha, o null. */
    public static function precioVigente(string $variantId, string $fecha): ?object
    {
        return DB::table('cut_reference_prices')->where('variant_id', $variantId)->where('valid_from', '<=', $fecha)
            ->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $fecha))->orderByDesc('valid_from')->first();
    }

    /* ================================================================ balance y costeo (DES-05, DES-06) */

    /** RN-DES-04: kg de la canal frente a lo registrado (cortes, subproductos y merma). */
    public static function balance(object $o): array
    {
        $entrada = (float) DB::table('production_order_consumptions')->where('order_id', $o->id)->whereIn('role', ['RAW_MATERIAL', 'INPUT'])->sum(DB::raw('coalesce(weight_kg, qty)'));
        $s = DB::table('production_order_outputs')->where('order_id', $o->id)->selectRaw('output_role, sum(weight_kg) as kg')->groupBy('output_role')->pluck('kg', 'output_role');
        $registrado = (float) $s->sum();
        $tol = $o->cutting_template_id ? DB::table('cutting_templates')->where('id', $o->cutting_template_id)->value('mass_balance_tolerance_pct') : null;
        $tol = (float) ($tol ?? Params::get('des_mass_balance_tolerance_pct') ?? 2);
        $dif = $entrada - $registrado;
        $pct = $entrada > 0 ? round($dif / $entrada * 100, 2) : null;

        return ['input_kg' => Comun::t($entrada), 'registered_kg' => Comun::t($registrado), 'co_product_kg' => Comun::t($s['CO_PRODUCT'] ?? 0),
            'by_product_kg' => Comun::t($s['BY_PRODUCT'] ?? 0), 'waste_kg' => Comun::t($s['WASTE'] ?? 0), 'difference_kg' => Comun::t($dif),
            'difference_pct' => Comun::t($pct, 2), 'tolerance_pct' => Comun::t($tol, 2), 'ok' => $pct !== null && abs($pct) <= $tol + 0.000001, 'override' => false];
    }

    /**
     * RN-DES-02 y RN-DES-03: el reparto del costo conjunto con lo registrado, a la fecha. No guarda nada (DES-06);
     * $errores trae RN-DES-06 y RN-DES-07 si los hay.
     *
     * @param  array|null  $resumen  ProduccionService::resumen() de la orden
     */
    public static function costeo(object $o, ?array $resumen = null, ?string $fecha = null): array
    {
        $fecha ??= Comun::hoy();
        $resumen ??= \App\Modulos\Pro\Services\ProduccionService::resumen($o->id);
        $canal = (float) $resumen['material_cost'];
        $mo = (float) $resumen['labor_cost'];
        $eq = (float) $resumen['equipment_cost'];
        $conjunto = round($canal + $mo + $eq, 2);
        $entrada = (float) $resumen['input_kg'];
        $salidas = DB::table('production_order_outputs as s')->leftJoin('cutting_template_lines as tl', 'tl.id', '=', 's.template_line_id')
            ->leftJoin('product_variants as v', 'v.id', '=', 's.variant_id')->leftJoin('lots as l', 'l.id', '=', 's.lot_id')
            ->where('s.order_id', $o->id)->orderBy('tl.seq')->orderBy('s.at')
            ->get(['s.*', 'tl.name as cut_name', 'tl.standard_yield_pct', 'tl.nrv_cost_per_kg as tpl_nrv', 'v.sku', 'v.name as variant_name', 'l.code as lot_code']);
        $errores = [];
        $filas = [];
        $vnr = 0.0;
        $mercado = 0.0;
        foreach ($salidas as $s) {
            $kg = (float) $s->weight_kg;
            $f = ['output_id' => $s->id, 'role' => $s->output_role, 'cut' => $s->cut_name ?? $s->variant_name ?? 'Merma', 'sku' => $s->sku, 'lot_id' => $s->lot_id, 'lot_code' => $s->lot_code,
                'weight_kg' => Comun::t($kg), 'qty' => (float) $s->qty, 'standard_yield_pct' => Comun::t($s->standard_yield_pct, 3),
                'actual_yield_pct' => $entrada > 0 ? Comun::t($kg / $entrada * 100, 2) : null, 'price_per_kg' => null, 'market_value' => null, 'nrv_cost_per_kg' => null,
                'nrv' => null, 'allocated_cost' => '0.00', 'unit_cost' => null, 'cost_per_kg' => null, 'rounding' => '0.00'];
            if ($s->output_role !== 'WASTE') {
                $p = self::precioVigente($s->variant_id, $fecha);
                if (! $p) {
                    $errores[] = ['code' => 'RN-DES-07', 'msg' => "{$f['cut']} ({$s->sku}) no tiene precio de referencia vigente al ".Comun::dmy($fecha).'. Cárgalo en Precios de referencia.'];
                } else {
                    $f['price_per_kg'] = Comun::t($p->price_per_kg, 4);
                    if ($s->output_role === 'BY_PRODUCT') {
                        $adic = (float) ($s->tpl_nrv ?? 0);
                        $porKg = max(0, (float) $p->price_per_kg - $adic);
                        $valor = round($kg * $porKg, 2);
                        $vnr += $valor;
                        $f['nrv_cost_per_kg'] = Comun::t($adic, 4);
                        $f['nrv'] = Comun::t($valor, 2);
                        $f['allocated_cost'] = Comun::t($valor, 2);
                    } else {
                        $valor = $kg * (float) $p->price_per_kg;
                        $mercado += $valor;
                        $f['market_value'] = Comun::t($valor, 2);
                    }
                }
            }
            $filas[] = $f;
        }
        $vnr = round($vnr, 2);
        if ($vnr >= $conjunto && $conjunto > 0) {
            $errores[] = ['code' => 'RN-DES-06', 'msg' => 'El valor neto de realización de los subproductos (S/ '.Comun::n($vnr).') iguala o supera el costo conjunto (S/ '.Comun::n($conjunto)
                .'): revisa los precios de referencia.'];
        }
        $repartir = round($conjunto - $vnr, 2);
        // Reparto por valor de mercado relativo (RN-DES-02) con el redondeo al de mayor valor (RN-DES-03).
        $mayor = null;
        $suma = 0.0;
        foreach ($filas as $i => $f) {
            if ($f['role'] === 'CO_PRODUCT' && $f['market_value'] !== null && $mercado > 0) {
                $a = round($repartir * (float) $f['market_value'] / $mercado, 2);
                $filas[$i]['allocated_cost'] = Comun::t($a, 2);
                $suma += $a;
                if ($mayor === null || (float) $f['market_value'] > (float) $filas[$mayor]['market_value']) {
                    $mayor = $i;
                }
            }
        }
        $diferencia = round($repartir - $suma, 2);
        if ($mayor !== null && abs($diferencia) >= 0.005) {
            $filas[$mayor]['allocated_cost'] = Comun::t((float) $filas[$mayor]['allocated_cost'] + $diferencia, 2);
            $filas[$mayor]['rounding'] = Comun::t($diferencia, 2);
        }
        foreach ($filas as $i => $f) {
            if ($f['role'] !== 'WASTE' && (float) $f['weight_kg'] > 0) {
                $filas[$i]['cost_per_kg'] = Comun::t((float) $f['allocated_cost'] / (float) $f['weight_kg'], 4);
                $filas[$i]['unit_cost'] = Comun::t($f['qty'] > 0 ? (float) $f['allocated_cost'] / $f['qty'] : 0, 6);
            }
        }
        $asignado = array_sum(array_map(fn ($f) => (float) $f['allocated_cost'], $filas));

        return ['date' => $fecha, 'input_cost' => Comun::t($canal, 2), 'labor_cost' => Comun::t($mo, 2), 'equipment_cost' => Comun::t($eq, 2), 'joint_cost' => Comun::t($conjunto, 2),
            'nrv_total' => Comun::t($vnr, 2), 'to_allocate' => Comun::t($repartir, 2), 'market_value_total' => Comun::t($mercado, 2), 'rounding' => Comun::t($diferencia, 2),
            'allocated_total' => Comun::t($asignado, 2), 'rows' => $filas, 'errors' => $errores, 'alerts' => self::alertas($o, $filas)];
    }

    /**
     * Al cerrar el despiece (lo llama ProduccionService::cerrar dentro de su transacción): balance de masa, precios y reparto;
     * fija el costo de cada corte y de su lote, y avisa los cortes fuera de estándar (RN-DES-05).
     */
    public static function cerrar(object $o, array $resumen, bool $forzar, User $quien): array
    {
        $b = self::balance($o);
        if (! $b['ok']) {
            $texto = 'El balance de masa no cuadra: entraron '.Comun::n($b['input_kg'], 3).' kg y se registraron '.Comun::n($b['registered_kg'], 3).' kg (diferencia '
                .Comun::n(abs((float) $b['difference_pct'])).' %, tolerancia '.Comun::n($b['tolerance_pct']).' %).';
            $forzar || RuleError::fail('RN-DES-04', $texto.' Registra la merma que falta o pide al jefe de producción que lo cierre igual.');
            Access::can($quien, 'des.mass_balance.override') || RuleError::fail('RN-DES-04', $texto.' Cerrarlo fuera de tolerancia lo autoriza el jefe de producción.');
            $b['override'] = true;
        }
        $c = self::costeo($o, $resumen, Comun::fecha(null));
        if ($c['errors']) {
            RuleError::fail($c['errors'][0]['code'], $c['errors'][0]['msg']);
        }
        foreach ($c['rows'] as $f) {
            if ($f['role'] === 'WASTE') {
                continue;
            }
            DB::table('production_order_outputs')->where('id', $f['output_id'])->update([
                'reference_price_per_kg' => $f['price_per_kg'], 'nrv_cost_per_kg' => $f['nrv_cost_per_kg'], 'allocated_cost' => $f['allocated_cost'],
                'unit_cost' => $f['unit_cost'], 'updated_at' => now(),
            ]);
            if ($f['lot_id']) {
                LotesService::fijarCosto($f['lot_id'], (float) $f['unit_cost']);
            }
        }
        foreach ($c['alerts'] as $a) {
            Comun::avisar('DES', ['JEFE_PRODUCCION'], "Corte fuera de estándar en {$o->number}",
                "{$a['cut']}: rindió ".Comun::n($a['actual_pct']).' % frente a '.Comun::n($a['standard_pct']).' % ('.($a['deviation_pp'] > 0 ? '+' : '').Comun::n($a['deviation_pp'])
                .' puntos). Operario: '.($a['operator'] ?? '—').' · proveedor de la canal: '.($a['supplier'] ?? '—').'.', 'DES-07', $o->id, 'warn', null, $o->establishment_id);
        }
        Events::emit('cutting.costed', 'production_orders', $o->id, ['number' => $o->number, 'joint_cost' => $c['joint_cost'], 'nrv_total' => $c['nrv_total'], 'alerts' => count($c['alerts'])]);

        return $c + ['mass_balance' => $b];
    }

    /**
     * DES-04: al pesar un corte, cómo va frente al estándar con la canal consumida hasta ahora (RN-DES-05, aviso al instante).
     * Devuelve null si no hay canal registrada.
     */
    public static function alertaCorte(string $orderId, string $lineId): ?array
    {
        $tl = DB::table('cutting_template_lines')->where('id', $lineId)->first();
        $entrada = (float) DB::table('production_order_consumptions')->where('order_id', $orderId)->whereIn('role', ['RAW_MATERIAL', 'INPUT'])->sum(DB::raw('coalesce(weight_kg, qty)'));
        if (! $tl || $entrada <= 0) {
            return null;
        }
        $kg = (float) DB::table('production_order_outputs')->where('order_id', $orderId)->where('template_line_id', $lineId)->sum('weight_kg');
        $real = round($kg / $entrada * 100, 2);
        $dev = round($real - (float) $tl->standard_yield_pct, 2);
        $tol = (float) (Params::get('des_cut_yield_alert_pp') ?? 3);

        return ['cut' => $tl->name, 'weight_kg' => Comun::t($kg), 'actual_pct' => Comun::t($real, 2), 'standard_pct' => Comun::t($tl->standard_yield_pct, 3),
            'deviation_pp' => Comun::t($dev, 2), 'alert_pp' => Comun::t($tol, 2), 'out_of_standard' => abs($dev) > $tol + 0.000001];
    }

    /** RN-DES-05: cortes con desviación mayor que des_cut_yield_alert_pp, con el operario y el proveedor de la canal. */
    private static function alertas(object $o, array $filas): array
    {
        $tol = (float) (Params::get('des_cut_yield_alert_pp') ?? 3);
        $canal = DB::table('production_order_consumptions as c')->leftJoin('lots as l', 'l.id', '=', 'c.lot_id')->leftJoin('suppliers as s', 's.id', '=', 'l.supplier_id')
            ->where('c.order_id', $o->id)->where('c.role', 'RAW_MATERIAL')->first([DB::raw('coalesce(s.trade_name, s.legal_name) as supplier'), 'l.origin', 'c.recorded_by_name']);
        $operario = DB::table('production_order_outputs')->where('order_id', $o->id)->whereNotNull('recorded_by_name')->value('recorded_by_name');
        $out = [];
        foreach ($filas as $f) {
            if ($f['standard_yield_pct'] === null || $f['actual_yield_pct'] === null) {
                continue;
            }
            $dev = round((float) $f['actual_yield_pct'] - (float) $f['standard_yield_pct'], 2);
            if (abs($dev) > $tol + 0.000001) {
                $out[] = ['cut' => $f['cut'], 'standard_pct' => (float) $f['standard_yield_pct'], 'actual_pct' => (float) $f['actual_yield_pct'], 'deviation_pp' => $dev,
                    'operator' => $operario ?? $canal?->recorded_by_name, 'supplier' => $canal?->supplier ?? ($canal?->origin === 'FARM' ? 'Granja Don Guando' : null)];
            }
        }

        return $out;
    }

    /* ================================================================ indicadores (DES-07, DES-08, DES-09) */

    /**
     * Cortes de despieces cerrados en el período, con su real frente al estándar, operario, especie y proveedor de la canal.
     *
     * @param  array<int, string>  $locales
     */
    public static function cortes(string $desde, string $hasta, array $locales = [], array $f = []): array
    {
        $canal = DB::table('production_order_consumptions as c')->join('lots as l', 'l.id', '=', 'c.lot_id')->leftJoin('suppliers as s', 's.id', '=', 'l.supplier_id')
            ->where('c.role', 'RAW_MATERIAL')
            ->selectRaw("c.order_id, sum(coalesce(c.weight_kg, c.qty)) as input_kg, max(coalesce(s.trade_name, s.legal_name, CASE WHEN l.origin = 'FARM' THEN 'Granja Don Guando' END, 'Sin proveedor')) as supplier")
            ->groupBy('c.order_id');
        $q = DB::table('production_orders as o')->join('cutting_templates as t', 't.id', '=', 'o.cutting_template_id')
            ->join('production_order_outputs as s', 's.order_id', '=', 'o.id')->leftJoin('cutting_template_lines as tl', 'tl.id', '=', 's.template_line_id')
            ->joinSub($canal, 'k', 'k.order_id', '=', 'o.id')
            ->where('o.order_type', 'CUTTING')->where('o.status', 'CLOSED')->whereBetween('o.close_date', [$desde, $hasta])
            ->when($locales, fn ($x) => $x->whereIn('o.establishment_id', $locales))
            ->when($f['species'] ?? null, fn ($x, $v) => $x->where('t.species', $v))
            ->when($f['supplier'] ?? null, fn ($x, $v) => $x->where('k.supplier', $v))
            ->when($f['operator'] ?? null, fn ($x, $v) => $x->where('s.recorded_by_name', $v))
            ->selectRaw("o.id as order_id, o.number, o.close_date, t.species, t.name as template_name, coalesce(tl.name, 'Sin corte') as cut, s.output_role as role,
                coalesce(s.recorded_by_name, '—') as operator, k.supplier, k.input_kg, s.weight_kg, tl.standard_yield_pct, s.allocated_cost");

        return $q->get()->map(function ($r) {
            $r->actual_yield_pct = (float) $r->input_kg > 0 ? round((float) $r->weight_kg / (float) $r->input_kg * 100, 2) : null;
            $r->deviation_pp = $r->standard_yield_pct !== null && $r->actual_yield_pct !== null ? round($r->actual_yield_pct - (float) $r->standard_yield_pct, 2) : null;

            return $r;
        })->all();
    }

    /** KPI-DES-01 a KPI-DES-04 del período. */
    public static function kpis(string $desde, string $hasta, array $locales = []): array
    {
        $tol = (float) (Params::get('des_cut_yield_alert_pp') ?? 3);
        $filas = collect(self::cortes($desde, $hasta, $locales));
        $porOrden = $filas->groupBy('order_id');
        $entrada = $porOrden->sum(fn ($g) => (float) $g->first()->input_kg);
        $co = $filas->where('role', 'CO_PRODUCT');
        $coKg = $co->sum(fn ($r) => (float) $r->weight_kg);
        $estandarCo = $porOrden->sum(fn ($g) => (float) $g->first()->input_kg * $g->where('role', 'CO_PRODUCT')->sum(fn ($r) => (float) $r->standard_yield_pct) / 100);
        $merma = $filas->where('role', 'WASTE')->sum(fn ($r) => (float) $r->weight_kg);
        $conEstandar = $filas->whereNotNull('deviation_pp');
        $fuera = $conEstandar->filter(fn ($r) => abs($r->deviation_pp) > $tol + 0.000001)->count();
        $porEspecie = $filas->groupBy('species')->map(function ($g, $esp) {
            $ent = $g->groupBy('order_id')->sum(fn ($x) => (float) $x->first()->input_kg);
            $co = $g->where('role', 'CO_PRODUCT');

            return ['species' => $esp, 'orders' => $g->groupBy('order_id')->count(), 'input_kg' => Comun::t($ent),
                'waste_pct' => $ent > 0 ? Comun::t($g->where('role', 'WASTE')->sum(fn ($r) => (float) $r->weight_kg) / $ent * 100, 2) : null,
                'co_product_pct' => $ent > 0 ? Comun::t($co->sum(fn ($r) => (float) $r->weight_kg) / $ent * 100, 2) : null,
                'cost_per_useful_kg' => $co->sum(fn ($r) => (float) $r->weight_kg) > 0 ? Comun::t($co->sum(fn ($r) => (float) $r->allocated_cost) / $co->sum(fn ($r) => (float) $r->weight_kg), 4) : null];
        })->values()->all();

        return [
            'period' => ['from' => $desde, 'to' => $hasta], 'orders' => $porOrden->count(), 'input_kg' => Comun::t($entrada),
            'yield_vs_standard_pp' => $entrada > 0 ? Comun::t(($coKg - $estandarCo) / $entrada * 100, 2) : null,
            'waste_pct' => $entrada > 0 ? Comun::t($merma / $entrada * 100, 2) : null,
            'cost_per_useful_kg' => $coKg > 0 ? Comun::t($co->sum(fn ($r) => (float) $r->allocated_cost) / $coKg, 4) : null,
            'cuts_out_of_standard_pct' => $conEstandar->count() ? Comun::t($fuera / $conEstandar->count() * 100, 2) : null,
            'cuts_out_of_standard' => $fuera, 'cuts' => $conEstandar->count(), 'alert_pp' => Comun::t($tol, 2), 'by_species' => $porEspecie,
        ];
    }

    /** DES-08: rendimiento y costo por kg de corte útil por proveedor de la canal (y especie). */
    public static function proveedores(string $desde, string $hasta, array $locales = []): array
    {
        return collect(self::cortes($desde, $hasta, $locales))->groupBy(fn ($r) => $r->supplier.'|'.$r->species)->map(function ($g) {
            $ent = $g->groupBy('order_id')->sum(fn ($x) => (float) $x->first()->input_kg);
            $co = $g->where('role', 'CO_PRODUCT');
            $coKg = $co->sum(fn ($r) => (float) $r->weight_kg);
            $std = $g->groupBy('order_id')->sum(fn ($x) => (float) $x->first()->input_kg * $x->where('role', 'CO_PRODUCT')->sum(fn ($r) => (float) $r->standard_yield_pct) / 100);

            return ['supplier' => $g->first()->supplier, 'species' => $g->first()->species, 'orders' => $g->groupBy('order_id')->count(), 'input_kg' => Comun::t($ent),
                'useful_kg' => Comun::t($coKg), 'yield_pct' => $ent > 0 ? Comun::t($coKg / $ent * 100, 2) : null,
                'yield_vs_standard_pp' => $ent > 0 ? Comun::t(($coKg - $std) / $ent * 100, 2) : null,
                'waste_pct' => $ent > 0 ? Comun::t($g->where('role', 'WASTE')->sum(fn ($r) => (float) $r->weight_kg) / $ent * 100, 2) : null,
                'cost_per_useful_kg' => $coKg > 0 ? Comun::t($co->sum(fn ($r) => (float) $r->allocated_cost) / $coKg, 4) : null];
        })->sortBy([['species', 'asc'], ['cost_per_useful_kg', 'asc']])->values()->all();
    }

    private static function gestor(User $quien): void
    {
        Access::can($quien, 'des.template.manage') || RuleError::fail('RN-DES-01', 'No tienes permiso para editar plantillas de despiece. Lo hace el jefe de producción.');
    }
}
