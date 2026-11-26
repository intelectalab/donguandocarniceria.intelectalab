<?php

namespace App\Modulos\Etq\Services;

use App\Models\User;
use App\Modulos\Alm\Services\LotesService;
use App\Modulos\Cat\Services\Balanza;
use App\Modulos\Cat\Services\Precios;
use App\Modulos\Cat\Services\RegistroSanitario;
use App\Modulos\Equ\Services\EquiposService;
use App\Modulos\Pro\Services\Comun;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * ETQ · Etiquetado, trazabilidad y retiros. Dueño de label_templates, label_prints, lot_qr_tokens, lot_recalls,
 * lot_recall_lots y lot_recall_contacts. Lee la genealogía de los lotes (lots.parent_lots y las órdenes de PRO) y
 * sus ventas (líneas de pedido y de comprobante con lote). Pasa lotes a RECALLED con LotesService (retiro).
 *
 *  RN-ETQ-01  no se etiqueta un lote REJECTED, BLOCKED o RECALLED (la cuarentena sí se etiqueta).
 *  RN-ETQ-02  no se etiqueta un producto DIGESA sin registro sanitario vigente.
 *  RN-ETQ-03  una plantilla activa lleva los campos obligatorios y {{qr}} si tiene QR (también en la base).
 *  RN-ETQ-04  una reimpresión exige motivo y queda enlazada a la original (también en la base).
 *  RN-ETQ-05  trazabilidad hacia atrás hasta compra o granja y hacia adelante hasta pedidos y comprobantes, todos los niveles.
 *  RN-ETQ-06  al iniciar un retiro, los lotes y sus derivados pasan a RECALLED.
 *  RN-ETQ-07  al iniciar un retiro se crea la lista de contacto por cliente con sus kg.
 *  RN-ETQ-08  un retiro se cierra con todos los contactos en estado final y un resumen (también en la base).
 *  RN-ETQ-09  la página pública muestra solo producto y lote; un lote retirado muestra el aviso; uno no liberado no se muestra.
 *  RN-ETQ-10  si el lote o su historia vino de la granja, la página muestra el origen.
 *  RN-ETQ-11  peso real y precio = precio por kg del canal × peso, redondeado a etq_price_rounding.
 *  RN-ETQ-12  impresiones solo de inserción (en la base).
 *  RN-ETQ-13  iniciar un retiro exige etq.recall.start y queda en la auditoría.
 */
final class EtiquetasService
{
    public const OBLIGATORIOS = ['product', 'brand', 'net_weight', 'lot', 'production_date', 'expiry_date', 'sanitary_registry'];

    public const CAMPOS = ['product', 'brand', 'net_weight', 'lot', 'production_date', 'expiry_date', 'sanitary_registry', 'qr', 'price', 'price_per_kg',
        'storage', 'allergens', 'barcode', 'sku', 'origin', 'establishment'];

    public const BLOQUEAN = ['REJECTED', 'BLOCKED', 'RECALLED'];

    public const FINALES = ['CONTACTED', 'RECOVERED', 'NOT_REACHABLE'];

    private const MAPA = [
        'label_templates_campos' => ['RN-ETQ-03', 'La plantilla no tiene todos los campos obligatorios.'],
        'label_templates_tenant_id_code_unique' => ['RN-ETQ-03', 'Ya existe una plantilla con ese código.'],
        'label_templates_tamano' => ['RN-ETQ-03', 'El tamaño de la etiqueta no es válido (de 20 a 300 mm de ancho y de 10 a 300 mm de alto).'],
        'label_prints_reimpresion' => ['RN-ETQ-04', 'Una reimpresión exige motivo.'],
        'lot_recalls_cierre' => ['RN-ETQ-08', 'Un retiro se cierra con un resumen escrito.'],
    ];

    /* ================================================================ ETQ-01 plantillas */

    /** Campos obligatorios que le faltan a un cuerpo (RN-ETQ-03). */
    public static function faltantes(string $cuerpo, bool $qr): array
    {
        $req = $qr ? [...self::OBLIGATORIOS, 'qr'] : self::OBLIGATORIOS;

        return array_values(array_filter($req, fn ($c) => ! str_contains($cuerpo, '{{'.$c.'}}')));
    }

    /** $d: code, brand_id, name, format, width_mm, height_mm, body, includes_qr, status (DRAFT|ACTIVE|RETIRED). */
    public static function guardarPlantilla(array $d, ?string $id, User $quien): object
    {
        Access::can($quien, 'etq.template.manage') || RuleError::fail('RN-ETQ-03', 'Editar plantillas de etiqueta lo hace Calidad o Marketing.');

        return Comun::base(fn () => DB::transaction(function () use ($d, $id) {
            $antes = $id ? (DB::table('label_templates')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-ETQ-03', 'Plantilla no encontrada.')) : null;
            $fila = [
                'code' => strtoupper((string) Comun::texto($d['code'] ?? $antes?->code, 40)), 'brand_id' => $d['brand_id'] ?? $antes?->brand_id,
                'name' => Comun::texto($d['name'] ?? $antes?->name, 120), 'format' => $d['format'] ?? $antes?->format ?? 'ZPL',
                'width_mm' => (int) ($d['width_mm'] ?? $antes?->width_mm ?? 100), 'height_mm' => (int) ($d['height_mm'] ?? $antes?->height_mm ?? 50),
                'body' => (string) ($d['body'] ?? $antes?->body ?? ''), 'includes_qr' => (bool) ($d['includes_qr'] ?? $antes?->includes_qr ?? true),
                'status' => in_array($d['status'] ?? null, ['DRAFT', 'ACTIVE', 'RETIRED'], true) ? $d['status'] : ($antes?->status ?? 'DRAFT'), 'updated_at' => now(),
            ];
            ($fila['code'] !== '' && $fila['name']) || RuleError::fail('RN-ETQ-03', 'La plantilla necesita código y nombre.');
            DB::table('brands')->where('id', $fila['brand_id'])->exists() || RuleError::fail('RN-ETQ-03', 'Elige la marca.');
            in_array($fila['format'], ['ZPL', 'ESCPOS', 'PDF'], true) || RuleError::fail('RN-ETQ-03', 'Elige el formato: ZPL, ESC/POS o PDF.');
            if ($fila['status'] === 'ACTIVE' && ($f = self::faltantes($fila['body'], $fila['includes_qr']))) {
                RuleError::fail('RN-ETQ-03', 'Para activarla, la plantilla debe incluir '.implode(', ', array_map(fn ($c) => '{{'.$c.'}}', $f)).'.');
            }
            if ($antes) {
                DB::table('label_templates')->where('id', $id)->update($fila);
            } else {
                $id = DB::table('label_templates')->insertGetId($fila, 'id');
            }

            return DB::table('label_templates')->where('id', $id)->first();
        }), self::MAPA);
    }

    /* ================================================================ ETQ-02 impresión */

    /** Lo que impide etiquetar el lote (RN-ETQ-01 y RN-ETQ-02). */
    public static function bloqueo(object $lot): ?array
    {
        if (in_array($lot->qc_status, self::BLOQUEAN, true)) {
            $que = ['REJECTED' => 'rechazado', 'BLOCKED' => 'bloqueado', 'RECALLED' => 'retirado'][$lot->qc_status];

            return ['code' => 'RN-ETQ-01', 'msg' => "El lote {$lot->code} está {$que}: no se etiqueta."];
        }
        $p = DB::table('products')->where('id', $lot->product_id)->first();
        if ($p && $p->sanitary_authority === 'DIGESA' && in_array(RegistroSanitario::estado($p, Comun::hoy())['code'], ['EXPIRED', 'MISSING'], true)) {
            return ['code' => 'RN-ETQ-02', 'msg' => "{$p->name} no tiene registro sanitario DIGESA vigente: no se etiqueta hasta renovarlo."];
        }

        return null;
    }

    /** Token del QR público del lote (uno activo por lote). */
    public static function token(string $lotId): string
    {
        $t = DB::table('lot_qr_tokens')->where('lot_id', $lotId)->where('status', 'ACTIVE')->value('token');
        if ($t) {
            return $t;
        }
        $t = Str::random(22);
        DB::table('lot_qr_tokens')->insert(['lot_id' => $lotId, 'token' => $t, 'status' => 'ACTIVE']);

        return $t;
    }

    /**
     * Vista previa sin imprimir: los campos de la etiqueta con el precio del canal (RN-ETQ-11).
     * $d: template_id, lot_id o lot_code, variant_id, net_weight_kg, channel.
     */
    public static function armar(array $d): array
    {
        $tpl = DB::table('label_templates')->where('id', $d['template_id'] ?? null)->first() ?? RuleError::fail('RN-ETQ-03', 'Elige la plantilla.');
        $lot = ! empty($d['lot_id']) ? DB::table('lots')->where('id', $d['lot_id'])->first()
            : (! empty($d['lot_code']) ? DB::table('lots')->where('code', strtoupper(trim($d['lot_code'])))->orderByDesc('created_at')->first() : null);
        $lot || RuleError::fail('RN-ETQ-01', 'Elige o escanea el lote.');
        $v = DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')->leftJoin('brands as b', 'b.id', '=', 'v.brand_id')
            ->where('v.id', $d['variant_id'] ?? $lot->variant_id)
            ->first(['v.id', 'v.sku', 'v.name', 'v.sale_mode', 'v.scale_plu', 'v.nominal_weight_kg', 'p.name as product_name', 'p.sanitary_registry', 'p.storage', 'b.name as brand_name'])
            ?? RuleError::fail('RN-ETQ-01', 'Elige la variante.');
        // RN-ETQ-11: el peso real es obligatorio en lo que se vende por peso; un producto por unidad lleva su peso nominal.
        $variable = in_array($v->sale_mode, ['KG', 'UNIT_VARIABLE_WEIGHT'], true);
        $peso = Comun::num($d['net_weight_kg'] ?? null, 3) ?? (! $variable ? self::pesoNominal($v) : null);
        ($variable && ($peso === null || $peso <= 0)) && RuleError::fail('RN-ETQ-11', 'Indica el peso real pesado.');
        $canal = $d['channel'] ?? 'COUNTER';
        $precio = Precios::vigente($v->id, ['canal' => $canal, 'fecha' => Comun::hoy()]);
        $porKg = null;
        $total = null;
        if ($precio) {
            $paso = (float) (Params::get('etq_price_rounding') ?? 0.1) ?: 0.1;
            if ($precio['basis'] === 'KG' || $v->sale_mode === 'KG') {
                $porKg = (float) $precio['price'];
                $total = $peso ? round(round($porKg * $peso / $paso) * $paso, 2) : null;
            } else {
                $total = round((float) $precio['price'], 2);
                $porKg = $peso ? round($total / $peso, 2) : null;
            }
        }
        $token = self::token($lot->id);
        $url = rtrim((string) (Params::get('etq_public_base_url') ?? 'https://trazabilidad.aycha.pe/l/'), '/').'/'.$token;
        $codigo = $v->scale_plu && $peso ? Balanza::armar((string) $v->scale_plu, $peso) : ($v->sku ?? '');
        $campos = [
            'product' => $v->product_name.($v->name && $v->name !== $v->product_name ? ' · '.$v->name : ''), 'brand' => $v->brand_name ?? '',
            'net_weight' => $peso ? Comun::n($peso, 3).' kg' : '', 'lot' => $lot->code, 'production_date' => Comun::dmy($lot->production_date), 'expiry_date' => Comun::dmy($lot->expiry_date),
            'sanitary_registry' => $v->sanitary_registry ?? '—', 'qr' => $url, 'price' => $total !== null ? 'S/ '.Comun::n($total) : '—',
            'price_per_kg' => $porKg !== null ? 'S/ '.Comun::n($porKg).' / kg' : '—', 'storage' => self::conservacion($v->storage), 'allergens' => '',
            'barcode' => $codigo, 'sku' => $v->sku ?? '', 'origin' => self::origen($lot->id)['farm_name'] ?? '', 'establishment' => '',
        ];
        $texto = preg_replace_callback('/\{\{(\w+)\}\}/', fn ($m) => $campos[$m[1]] ?? '', $tpl->body);

        return ['template' => $tpl, 'lot' => $lot, 'variant' => $v, 'fields' => $campos, 'text' => $texto, 'payload' => self::payload($tpl, $texto, $codigo, $url),
            'net_weight_kg' => Comun::t($peso), 'price_per_kg' => Comun::t($porKg, 4), 'price' => Comun::t($total, 2), 'barcode' => $codigo, 'qr_url' => $url,
            'block' => self::bloqueo($lot)];
    }

    /** Peso nominal de un producto por unidad: el de la variante o el que dice su nombre («500 g», «1 kg»). */
    private static function pesoNominal(object $v): ?float
    {
        if ((float) $v->nominal_weight_kg > 0) {
            return (float) $v->nominal_weight_kg;
        }
        if (preg_match('/(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i', (string) $v->name, $m)) {
            $n = (float) str_replace(',', '.', $m[1]);

            return round(strtolower($m[2]) === 'kg' ? $n : $n / 1000, 3);
        }

        return null;
    }

    /** Texto de conservación según el tipo de almacenamiento del producto. */
    public static function conservacion(?string $s): string
    {
        return ['CHILLED' => 'Mantener refrigerado de 0 °C a 4 °C', 'FROZEN' => 'Mantener congelado a −18 °C o menos', 'AMBIENT' => 'Conservar en lugar fresco y seco'][$s] ?? '';
    }

    /** ZPL o ESC/POS tal cual se manda a la impresora (texto para PDF). */
    private static function payload(object $tpl, string $texto, string $codigo, string $url): string
    {
        $lineas = explode("\n", $texto);
        if ($tpl->format === 'ZPL') {
            $dots = 8;   // 203 dpi
            $out = '^XA^CI28^PW'.($tpl->width_mm * $dots).'^LL'.($tpl->height_mm * $dots);
            foreach ($lineas as $i => $l) {
                $out .= '^FO20,'.(20 + $i * 34).'^A0N,28,28^FD'.str_replace(['^', '~'], '', $l).'^FS';
            }
            $codigo !== '' && $out .= '^FO20,'.($tpl->height_mm * $dots - 110).'^BEN,70,Y,N^FD'.$codigo.'^FS';
            $tpl->includes_qr && $out .= '^FO'.($tpl->width_mm * $dots - 190).',20^BQN,2,4^FDLA,'.$url.'^FS';

            return $out.'^XZ';
        }
        if ($tpl->format === 'ESCPOS') {
            return "\x1b@".implode("\n", $lineas)."\n".($codigo !== '' ? "\x1dk\x02".$codigo."\x00" : '')."\n\x1dV\x41\x03";
        }

        return $texto;
    }

    /**
     * Imprime (o reimprime). $d: template_id, lot_id/lot_code, variant_id, net_weight_kg, copies, printer_code, channel, scale_equipment_id,
     * establishment_id, production_order_id, source, reprint_of, reprint_reason.
     */
    public static function imprimir(array $d, User $quien): object
    {
        $reimp = ! empty($d['reprint_of']);
        $reimp ? (Access::can($quien, 'etq.label.reprint') || RuleError::fail('RN-ETQ-04', 'Reimprimir lo autoriza el jefe de producción o Calidad.'))
            : (Access::can($quien, 'etq.label.print') || Access::can($quien, 'etq.label.reprint') || RuleError::fail('RN-ETQ-01', 'No tienes permiso para imprimir etiquetas.'));

        return Comun::base(fn () => DB::transaction(function () use ($d, $quien, $reimp) {
            $original = null;
            if ($reimp) {
                $original = DB::table('label_prints')->where('id', $d['reprint_of'])->first() ?? RuleError::fail('RN-ETQ-04', 'No se encontró la impresión original.');
                $motivo = Comun::texto($d['reprint_reason'] ?? null, 255);
                $motivo || RuleError::fail('RN-ETQ-04', 'Una reimpresión exige motivo.');
                $d += ['template_id' => $original->template_id, 'lot_id' => $original->lot_id, 'variant_id' => $original->variant_id, 'net_weight_kg' => $original->net_weight_kg,
                    'channel' => $original->channel, 'printer_code' => $original->printer_code, 'establishment_id' => $original->establishment_id];
            }
            $a = self::armar($d);
            $a['template']->status === 'ACTIVE' || RuleError::fail('RN-ETQ-03', 'La plantilla no está activa.');
            $a['block'] && RuleError::fail($a['block']['code'], $a['block']['msg']);
            $a['net_weight_kg'] === null && RuleError::fail('RN-ETQ-11', 'Indica el peso neto de la etiqueta.');
            $copias = (int) ($d['copies'] ?? 1);
            ($copias >= 1 && $copias <= 500) || RuleError::fail('RN-ETQ-01', 'Las copias van de 1 a 500.');
            $orden = ! empty($d['production_order_id']) ? DB::table('production_orders')->where('id', $d['production_order_id'])->first()
                : ($a['lot']->production_order_ref ? DB::table('production_orders')->where('number', $a['lot']->production_order_ref)->first() : null);
            $local = $d['establishment_id'] ?? $orden?->establishment_id ?? DB::table('user_scopes')->where('user_id', $quien->id)->whereNotNull('establishment_id')->value('establishment_id')
                ?? DB::table('establishments')->orderBy('name')->value('id');
            Comun::exigirLocal($quien, $local, 'RN-ETQ-01', 'La impresión');
            $balanza = $d['scale_equipment_id'] ?? null;
            $balanza && EquiposService::exigirBalanza($balanza, Comun::hoy());
            $id = DB::table('label_prints')->insertGetId([
                'template_id' => $a['template']->id, 'lot_id' => $a['lot']->id, 'variant_id' => $a['variant']->id, 'production_order_id' => $orden?->id,
                'production_order_ref' => $orden?->number ?? $a['lot']->production_order_ref, 'establishment_id' => $local, 'copies' => $copias,
                'net_weight_kg' => $a['net_weight_kg'], 'price' => $a['price'], 'price_per_kg' => $a['price_per_kg'], 'channel' => Comun::texto($d['channel'] ?? 'COUNTER', 20),
                'barcode' => mb_substr($a['barcode'] ?: ($a['variant']->sku ?? '—'), 0, 40), 'printer_code' => Comun::texto($d['printer_code'] ?? null, 40) ?? 'PDF',
                'scale_equipment_id' => $balanza, 'printed_by' => $quien->id, 'printed_at' => now(), 'reprint_of' => $original?->id,
                'reprint_reason' => $reimp ? Comun::texto($d['reprint_reason'], 255) : null, 'payload_hash' => hash('sha256', $a['payload']), 'payload' => $a['payload'],
                'source' => in_array($d['source'] ?? null, ['ETQ', 'PRO', 'ALM', 'POS', 'PRE'], true) ? $d['source'] : 'ETQ',
            ], 'id');
            Events::emit($reimp ? 'label.reprinted' : 'label.printed', 'label_prints', $id, ['lot' => $a['lot']->code, 'copies' => $copias]);

            return self::impresion($id);
        }), self::MAPA);
    }

    public static function impresion(string $id): object
    {
        return DB::table('label_prints as p')->join('label_templates as t', 't.id', '=', 'p.template_id')->join('lots as l', 'l.id', '=', 'p.lot_id')
            ->join('product_variants as v', 'v.id', '=', 'p.variant_id')->leftJoin('users as u', 'u.id', '=', 'p.printed_by')->where('p.id', $id)
            ->first(['p.*', 't.code as template_code', 't.name as template_name', 't.format', 'l.code as lot_code', 'v.sku', 'v.name as variant_name', 'u.name as printed_by_name']);
    }

    /* ================================================================ ETQ-04 trazabilidad */

    /** Lotes padre de un lote: su genealogía guardada y los consumos de la orden que lo produjo. */
    private static function padres(object $lot): array
    {
        $out = [];
        foreach (json_decode($lot->parent_lots ?? '[]', true) ?: [] as $p) {
            if (! empty($p['lot_id']) && Str::isUuid($p['lot_id'])) {
                $out[$p['lot_id']] = ['kg' => (float) ($p['kg'] ?? 0), 'order' => $p['order_ref'] ?? $lot->production_order_ref];
            }
        }
        $lot->parent_lot_id && ! isset($out[$lot->parent_lot_id]) && $out[$lot->parent_lot_id] = ['kg' => null, 'order' => null];
        $ordenes = DB::table('production_order_outputs as s')->join('production_orders as o', 'o.id', '=', 's.order_id')->where('s.lot_id', $lot->id)->pluck('o.number', 'o.id');
        foreach ($ordenes as $oid => $num) {
            foreach (DB::table('production_order_consumptions')->where('order_id', $oid)->whereNotNull('lot_id')->whereIn('role', ['RAW_MATERIAL', 'INPUT'])
                ->groupBy('lot_id')->selectRaw('lot_id, sum(coalesce(weight_kg, qty)) as kg')->get() as $c) {
                $out[$c->lot_id] ??= ['kg' => (float) $c->kg, 'order' => $num];
            }
        }

        return $out;
    }

    /** Lotes hijo: los que lo nombran en su genealogía y los producidos por las órdenes que lo consumieron. */
    private static function hijos(string $lotId): array
    {
        $out = [];
        foreach (DB::table('lots')->whereRaw('parent_lots @> ?::jsonb', [json_encode([['lot_id' => $lotId]])])->orWhere('parent_lot_id', $lotId)->get(['id', 'parent_lots', 'production_order_ref']) as $h) {
            $kg = collect(json_decode($h->parent_lots ?? '[]', true) ?: [])->firstWhere('lot_id', $lotId)['kg'] ?? null;
            $out[$h->id] = ['kg' => $kg !== null ? (float) $kg : null, 'order' => $h->production_order_ref];
        }
        foreach (DB::table('production_order_consumptions as c')->join('production_orders as o', 'o.id', '=', 'c.order_id')->where('c.lot_id', $lotId)
            ->groupBy('o.id', 'o.number')->selectRaw('o.id, o.number, sum(coalesce(c.weight_kg, c.qty)) as kg')->get() as $o) {
            foreach (DB::table('production_order_outputs')->where('order_id', $o->id)->whereNotNull('lot_id')->pluck('lot_id') as $h) {
                $out[$h] ??= ['kg' => (float) $o->kg, 'order' => $o->number];
            }
        }

        return $out;
    }

    private static function nodo(string $lotId): ?array
    {
        $l = DB::table('lots as l')->join('products as p', 'p.id', '=', 'l.product_id')->join('product_variants as v', 'v.id', '=', 'l.variant_id')
            ->leftJoin('suppliers as s', 's.id', '=', 'l.supplier_id')->where('l.id', $lotId)
            ->first(['l.*', 'p.name as product_name', 'v.sku', DB::raw('coalesce(s.trade_name, s.legal_name) as supplier_name')]);
        if (! $l) {
            return null;
        }

        return ['lot_id' => $l->id, 'code' => $l->code, 'origin' => $l->origin, 'qc_status' => $l->qc_status, 'product' => $l->product_name, 'sku' => $l->sku,
            'production_date' => $l->production_date, 'expiry_date' => $l->expiry_date, 'supplier' => $l->supplier_name ?? ($l->origin === 'FARM' ? 'Granja Don Guando' : null),
            'order' => $l->production_order_ref, 'farm_origin' => json_decode($l->farm_origin ?? 'null', true), 'row' => $l];
    }

    /**
     * RN-ETQ-05: árbol hacia atrás (hasta compra o granja) y hacia adelante (lotes derivados y ventas), todos los niveles.
     *
     * @return array{lot: array, backward: list<array>, forward: list<array>, sales: list<array>, descendants: list<string>}
     */
    public static function trazar(string $lotId): array
    {
        $raiz = self::nodo($lotId) ?? RuleError::fail('RN-ETQ-05', 'Lote no encontrado.');
        $atras = [];
        $visto = [$lotId => true];
        $cola = [[$raiz['row'], 1]];
        while ($cola) {
            [$l, $nivel] = array_shift($cola);
            foreach (self::padres($l) as $pid => $info) {
                if (isset($visto[$pid]) || $nivel > 20) {
                    continue;
                }
                $visto[$pid] = true;
                $n = self::nodo($pid);
                if ($n) {
                    $atras[] = array_diff_key($n, ['row' => 1]) + ['level' => $nivel, 'child_id' => $l->id, 'kg' => $info['kg'] !== null ? Comun::t($info['kg']) : null, 'via_order' => $info['order']];
                    $cola[] = [$n['row'], $nivel + 1];
                }
            }
        }
        $adelante = [];
        $visto = [$lotId => true];
        $cola = [[$lotId, 1]];
        while ($cola) {
            [$id, $nivel] = array_shift($cola);
            foreach (self::hijos($id) as $hid => $info) {
                if (isset($visto[$hid]) || $nivel > 20) {
                    continue;
                }
                $visto[$hid] = true;
                $n = self::nodo($hid);
                if ($n) {
                    $adelante[] = array_diff_key($n, ['row' => 1]) + ['level' => $nivel, 'parent_id' => $id, 'kg' => $info['kg'] !== null ? Comun::t($info['kg']) : null, 'via_order' => $info['order']];
                    $cola[] = [$hid, $nivel + 1];
                }
            }
        }
        $todos = array_merge([$lotId], array_column($adelante, 'lot_id'));

        return ['lot' => array_diff_key($raiz, ['row' => 1]), 'backward' => $atras, 'forward' => $adelante, 'sales' => self::ventas($todos), 'descendants' => array_column($adelante, 'lot_id')];
    }

    /** Ventas de los lotes: líneas de comprobante con lote y líneas de pedido con lote que no tienen comprobante con ese lote. */
    public static function ventas(array $lotes): array
    {
        if (! $lotes) {
            return [];
        }
        $docs = DB::table('sales_document_lines as dl')->join('sales_documents as d', 'd.id', '=', 'dl.sales_document_id')->leftJoin('customers as c', 'c.id', '=', 'd.customer_id')
            ->join('lots as l', 'l.id', '=', 'dl.lot_id')->whereIn('dl.lot_id', $lotes)->where('d.status', '<>', 'VOIDED')
            ->get(['dl.lot_id', 'l.code as lot_code', 'd.id as document_id', 'd.order_id as sales_order_id', DB::raw("d.series || '-' || d.number as document_number"), 'd.doc_type', 'd.issue_date as date',
                'd.customer_id', DB::raw('coalesce(c.trade_name, c.full_name, d.customer_name) as customer_name'), 'c.phone', 'dl.qty', 'dl.description']);
        $conDoc = $docs->map(fn ($x) => $x->sales_order_id.'|'.$x->lot_id)->filter()->flip();
        $peds = DB::table('sales_order_lines as ol')->join('sales_orders as o', 'o.id', '=', 'ol.sales_order_id')->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')
            ->join('lots as l', 'l.id', '=', 'ol.lot_id')->whereIn('ol.lot_id', $lotes)->whereNotIn('o.status', ['CANCELLED', 'DRAFT'])
            ->get(['ol.lot_id', 'l.code as lot_code', 'o.id as sales_order_id', 'o.number as order_number', 'o.delivery_date as date', 'o.customer_id',
                DB::raw('coalesce(c.trade_name, c.full_name) as customer_name'), 'c.phone', DB::raw('coalesce(ol.weighed_kg, ol.est_weight_kg, ol.qty) as qty')])
            ->reject(fn ($x) => isset($conDoc[$x->sales_order_id.'|'.$x->lot_id]));
        $out = [];
        foreach ($docs as $x) {
            $out[] = ['type' => 'DOCUMENT', 'lot_id' => $x->lot_id, 'lot_code' => $x->lot_code, 'sales_document_id' => $x->document_id, 'sales_order_id' => $x->sales_order_id,
                'reference' => $x->document_number, 'doc_type' => $x->doc_type, 'date' => $x->date, 'customer_id' => $x->customer_id, 'customer_name' => $x->customer_name,
                'phone' => $x->phone, 'kg' => Comun::t($x->qty)];
        }
        foreach ($peds as $x) {
            $out[] = ['type' => 'ORDER', 'lot_id' => $x->lot_id, 'lot_code' => $x->lot_code, 'sales_document_id' => null, 'sales_order_id' => $x->sales_order_id,
                'reference' => $x->order_number, 'doc_type' => null, 'date' => $x->date, 'customer_id' => $x->customer_id, 'customer_name' => $x->customer_name,
                'phone' => $x->phone, 'kg' => Comun::t($x->qty)];
        }

        return $out;
    }

    /* ================================================================ ETQ-05 a ETQ-07 retiros */

    /** ETQ-06 vista previa: lotes que se retiran, clientes y stock que se bloquea. $d: lot_ids, include_descendants. */
    public static function previa(array $d): array
    {
        $ids = array_values(array_unique(array_filter($d['lot_ids'] ?? [])));
        $ids || RuleError::fail('RN-ETQ-06', 'Elige al menos un lote.');
        $derivados = [];
        $lotes = [];
        foreach ($ids as $id) {
            $t = self::trazar($id);
            $lotes[$id] = ['lot_id' => $id, 'code' => $t['lot']['code'], 'product' => $t['lot']['product'], 'qc_status' => $t['lot']['qc_status'], 'is_descendant' => false];
            if (! empty($d['include_descendants'])) {
                foreach ($t['forward'] as $f) {
                    $derivados[$f['lot_id']] ??= ['lot_id' => $f['lot_id'], 'code' => $f['code'], 'product' => $f['product'], 'qc_status' => $f['qc_status'], 'is_descendant' => true];
                }
            }
        }
        $todos = $lotes + array_diff_key($derivados, $lotes);
        $stock = DB::table('stock_balances')->whereIn('lot_id', array_keys($todos))->groupBy('lot_id')->selectRaw('lot_id, sum(qty) as qty')->pluck('qty', 'lot_id');
        foreach ($todos as $k => $l) {
            $todos[$k]['stock_qty'] = Comun::t($stock[$k] ?? 0);
        }
        $ventas = self::ventas(array_keys($todos));
        $clientes = collect($ventas)->groupBy(fn ($v) => $v['customer_id'] ?? 'sin-cliente')->map(fn ($g) => ['customer_id' => $g->first()['customer_id'],
            'customer_name' => $g->first()['customer_name'] ?? 'Cliente sin identificar', 'phone' => $g->first()['phone'], 'kg' => Comun::t($g->sum(fn ($x) => (float) $x['kg'])),
            'references' => $g->pluck('reference')->unique()->values()])->values();
        $ordenes = DB::table('production_order_consumptions as c')->join('production_orders as o', 'o.id', '=', 'c.order_id')->whereIn('c.lot_id', array_keys($todos))
            ->whereIn('o.status', ['RELEASED', 'IN_PROGRESS'])->distinct()->pluck('o.number')->all();

        return ['lots' => array_values($todos), 'sales' => $ventas, 'customers' => $clientes, 'open_orders' => $ordenes,
            'stock_qty' => Comun::t(array_sum(array_map(fn ($l) => (float) $l['stock_qty'], $todos))), 'sold_kg' => Comun::t(array_sum(array_map(fn ($v) => (float) $v['kg'], $ventas)))];
    }

    /** ETQ-06 Iniciar (RN-ETQ-06, 07 y 13). $d: reason, risk_class, lot_ids, include_descendants. */
    public static function iniciarRetiro(array $d, User $quien): object
    {
        Access::can($quien, 'etq.recall.start') || RuleError::fail('RN-ETQ-13', 'Iniciar un retiro lo hace Calidad o Gerencia.');

        return Comun::base(fn () => DB::transaction(function () use ($d, $quien) {
            $motivo = Comun::texto($d['reason'] ?? null, 2000);
            ($motivo && mb_strlen($motivo) >= 5) || RuleError::fail('RN-ETQ-06', 'Escribe el motivo del retiro.');
            $clase = in_array($d['risk_class'] ?? null, ['CLASS_I', 'CLASS_II', 'CLASS_III'], true) ? $d['risk_class'] : RuleError::fail('RN-ETQ-06', 'Elige la clase de riesgo.');
            $p = self::previa($d);
            $anio = Comun::ahora()->format('Y');
            $rid = DB::table('lot_recalls')->insertGetId(['number' => Comun::numero('lot_recalls', "RC-{$anio}-", 3), 'reason' => $motivo, 'risk_class' => $clase,
                'include_descendants' => (bool) ($d['include_descendants'] ?? false), 'initiated_by' => $quien->id, 'initiated_at' => now(), 'status' => 'OPEN',
                'affected_orders' => json_encode($p['open_orders'], JSON_UNESCAPED_UNICODE)], 'id');
            $num = DB::table('lot_recalls')->where('id', $rid)->value('number');
            foreach ($p['lots'] as $l) {
                DB::table('lot_recall_lots')->insert(['recall_id' => $rid, 'lot_id' => $l['lot_id'], 'is_descendant' => $l['is_descendant'], 'previous_status' => $l['qc_status'],
                    'remaining_qty' => $l['stock_qty']]);
                if (! in_array($l['qc_status'], ['RECALLED', 'REJECTED'], true)) {
                    // RN-ETQ-06: con el retiro, también desde cuarentena y aun con CAL activo.
                    LotesService::cambiarEstado($l['lot_id'], 'RECALLED', "Retiro {$num}: ".mb_substr($motivo, 0, 200), $quien, ['decision_calidad' => true, 'retiro' => true]);
                }
            }
            // RN-ETQ-07: un contacto por cliente y comprobante (o pedido sin comprobante), con sus kg.
            foreach (collect($p['sales'])->groupBy(fn ($v) => ($v['customer_id'] ?? '').'|'.($v['sales_document_id'] ?? 'P'.$v['sales_order_id']).'|'.$v['lot_id']) as $g) {
                $v = $g->first();
                DB::table('lot_recall_contacts')->insert(['recall_id' => $rid, 'customer_id' => $v['customer_id'], 'lot_id' => $v['lot_id'], 'sales_document_id' => $v['sales_document_id'],
                    'sales_order_id' => $v['sales_order_id'], 'qty' => $g->sum(fn ($x) => (float) $x['kg']), 'weight_kg' => $g->sum(fn ($x) => (float) $x['kg']), 'status' => 'PENDING']);
            }
            DB::table('lot_recalls')->where('id', $rid)->update(['contacts_listed_at' => now(), 'updated_at' => now()]);
            Comun::avisar('ETQ', ['CALIDAD', 'GERENTE', 'JEFE_PRODUCCION', 'ALMACENERO', 'SUPERVISORA_VENTAS'], "Retiro de lote {$num}",
                count($p['lots']).' lote(s) retirado(s) ('.implode(', ', array_column($p['lots'], 'code')).'). '.count($p['customers']).' cliente(s) a contactar.'
                .($p['open_orders'] ? ' Órdenes abiertas que los usan: '.implode(', ', $p['open_orders']).'.' : ''), 'ETQ-07', $rid, 'bad');
            Events::emit('lot_recall.started', 'lot_recalls', $rid, ['number' => $num, 'risk_class' => $clase, 'lots' => array_column($p['lots'], 'code'), 'customers' => count($p['customers'])]);

            return self::retiro($rid);
        }), self::MAPA);
    }

    /** ETQ-07: resultado de un contacto. $d: status, contact_notes, recovered_kg. */
    public static function contacto(string $id, array $d, User $quien): object
    {
        (Access::can($quien, 'etq.recall.start') || Access::can($quien, 'etq.recall.close')) || RuleError::fail('RN-ETQ-08', 'No tienes permiso para registrar contactos del retiro.');
        $c = DB::table('lot_recall_contacts as c')->join('lot_recalls as r', 'r.id', '=', 'c.recall_id')->where('c.id', $id)->first(['c.*', 'r.status as recall_status'])
            ?? RuleError::fail('RN-ETQ-08', 'Contacto no encontrado.');
        $c->recall_status === 'OPEN' || RuleError::fail('RN-ETQ-08', 'El retiro está cerrado.');
        $estado = in_array($d['status'] ?? null, ['PENDING', ...self::FINALES], true) ? $d['status'] : RuleError::fail('RN-ETQ-08', 'Elige el resultado del contacto.');
        $kg = Comun::num($d['recovered_kg'] ?? null, 3);
        ($estado === 'RECOVERED' && ($kg === null || $kg <= 0)) && RuleError::fail('RN-ETQ-08', 'Indica los kg recuperados.');
        ($kg !== null && $kg > (float) $c->weight_kg + 0.0005) && RuleError::fail('RN-ETQ-08', 'Los kg recuperados no pueden pasar de lo vendido ('.Comun::n($c->weight_kg, 3).' kg).');
        DB::table('lot_recall_contacts')->where('id', $id)->update(['status' => $estado, 'contacted_at' => $estado === 'PENDING' ? null : now(),
            'contact_notes' => Comun::texto($d['contact_notes'] ?? null, 2000), 'recovered_kg' => $kg, 'updated_by' => $quien->id, 'updated_at' => now()]);

        return DB::table('lot_recall_contacts')->where('id', $id)->first();
    }

    /**
     * ETQ-07: el aviso de WhatsApp al cliente con la plantilla de utilidad del CRM (etq_recall_whatsapp_template).
     * No se envía desde aquí: la pantalla abre WhatsApp con el texto (el envío por la API de WhatsApp es de CRM).
     */
    public static function aviso(string $contactId): array
    {
        $c = DB::table('lot_recall_contacts as c')->join('lot_recalls as r', 'r.id', '=', 'c.recall_id')->join('lots as l', 'l.id', '=', 'c.lot_id')
            ->join('products as p', 'p.id', '=', 'l.product_id')->leftJoin('customers as k', 'k.id', '=', 'c.customer_id')->where('c.id', $contactId)
            ->first(['c.id', 'c.weight_kg', 'r.number', 'l.code as lot_code', 'p.name as product_name', 'k.full_name', 'k.trade_name', 'k.phone'])
            ?? RuleError::fail('RN-ETQ-08', 'Contacto no encontrado.');
        $nombre = $c->trade_name ?: ($c->full_name ? explode(' ', trim($c->full_name))[0] : 'cliente');
        $texto = "Hola {$nombre}, te escribimos de Don Guando. Por precaución estamos retirando el lote {$c->lot_code} de {$c->product_name}. "
            .'Si aún tienes este producto, no lo consumas: guárdalo y respóndenos para coordinar su cambio o devolución sin costo. Gracias.';
        $tel = preg_replace('/\D/', '', (string) $c->phone);
        $tel && strlen($tel) === 9 && $tel = '51'.$tel;

        return ['template' => Params::get('etq_recall_whatsapp_template') ?? 'recall_aviso_cliente', 'kind' => 'UTILITY', 'phone' => $c->phone,
            'variables' => ['nombre' => $nombre, 'lote' => $c->lot_code, 'producto' => $c->product_name, 'retiro' => $c->number], 'text' => $texto,
            'whatsapp_url' => $tel ? 'https://wa.me/'.$tel.'?text='.rawurlencode($texto) : null];
    }

    /** RN-ETQ-08. $d: closing_summary, authority_notified (bool). */
    public static function cerrarRetiro(string $id, array $d, User $quien): object
    {
        Access::can($quien, 'etq.recall.close') || RuleError::fail('RN-ETQ-08', 'Cerrar un retiro lo hace Calidad.');

        return Comun::base(fn () => DB::transaction(function () use ($id, $d, $quien) {
            $r = DB::table('lot_recalls')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-ETQ-08', 'Retiro no encontrado.');
            $r->status === 'OPEN' || RuleError::fail('RN-ETQ-08', 'El retiro ya está cerrado.');
            $pend = DB::table('lot_recall_contacts')->where('recall_id', $id)->whereNotIn('status', self::FINALES)->count();
            $pend && RuleError::fail('RN-ETQ-08', $pend === 1 ? 'Queda 1 cliente sin contactar: registra su resultado antes de cerrar.' : "Quedan {$pend} clientes sin contactar: registra su resultado antes de cerrar.");
            $resumen = Comun::texto($d['closing_summary'] ?? null, 4000);
            $resumen || RuleError::fail('RN-ETQ-08', 'Escribe el resumen del retiro para cerrarlo.');
            DB::table('lot_recalls')->where('id', $id)->update(['status' => 'CLOSED', 'closing_summary' => $resumen, 'closed_at' => now(), 'closed_by' => $quien->id,
                'authority_notified_at' => ! empty($d['authority_notified']) ? ($r->authority_notified_at ?? now()) : $r->authority_notified_at, 'updated_at' => now()]);
            Events::emit('lot_recall.closed', 'lot_recalls', $id, ['number' => $r->number]);

            return self::retiro($id);
        }), self::MAPA);
    }

    public static function retiro(string $id): object
    {
        $r = DB::table('lot_recalls as r')->leftJoin('users as u', 'u.id', '=', 'r.initiated_by')->leftJoin('users as c', 'c.id', '=', 'r.closed_by')->where('r.id', $id)
            ->first(['r.*', 'u.name as initiated_by_name', 'c.name as closed_by_name']) ?? RuleError::fail('RN-ETQ-08', 'Retiro no encontrado.');
        $r->affected_orders = json_decode($r->affected_orders ?? '[]', true) ?: [];
        $r->lots = DB::table('lot_recall_lots as rl')->join('lots as l', 'l.id', '=', 'rl.lot_id')->join('products as p', 'p.id', '=', 'l.product_id')->where('rl.recall_id', $id)
            ->orderBy('rl.is_descendant')->orderBy('l.code')->get(['rl.*', 'l.code', 'l.qc_status', 'p.name as product_name']);
        $r->contacts = DB::table('lot_recall_contacts as c')->leftJoin('customers as k', 'k.id', '=', 'c.customer_id')->join('lots as l', 'l.id', '=', 'c.lot_id')
            ->leftJoin('sales_documents as d', 'd.id', '=', 'c.sales_document_id')->leftJoin('sales_orders as o', 'o.id', '=', 'c.sales_order_id')->leftJoin('users as u', 'u.id', '=', 'c.updated_by')
            ->where('c.recall_id', $id)->orderBy('k.full_name')
            ->get(['c.*', DB::raw('coalesce(k.trade_name, k.full_name) as customer_name'), 'k.phone', 'l.code as lot_code', DB::raw("d.series || '-' || d.number as document_number"),
                'o.number as order_number', 'u.name as updated_by_name']);
        $vendido = (float) $r->contacts->sum('weight_kg');
        $r->progress = ['contacts' => $r->contacts->count(), 'done' => $r->contacts->whereIn('status', self::FINALES)->count(),
            'sold_kg' => Comun::t($vendido), 'recovered_kg' => Comun::t($r->contacts->sum('recovered_kg')),
            'recovery_pct' => $vendido > 0 ? Comun::t($r->contacts->sum('recovered_kg') / $vendido * 100, 1) : null,
            'listing_minutes' => $r->contacts_listed_at ? round((strtotime($r->contacts_listed_at) - strtotime($r->initiated_at)) / 60, 1) : null];
        $r->whatsapp_template = Params::get('etq_recall_whatsapp_template') ?? 'recall_aviso_cliente';

        return $r;
    }

    /* ================================================================ ETQ-08 página pública */

    /** RN-ETQ-10: el origen de la granja del lote o de algún lote de su historia hacia atrás. */
    public static function origen(string $lotId): ?array
    {
        $l = DB::table('lots')->where('id', $lotId)->first(['farm_origin', 'origin']);
        if ($l && $l->farm_origin) {
            return json_decode($l->farm_origin, true);
        }
        foreach (self::trazar($lotId)['backward'] as $b) {
            if ($b['farm_origin']) {
                return $b['farm_origin'];
            }
        }

        return null;
    }

    /** RN-ETQ-09: solo datos del producto y del lote. null = no se muestra. Debe correr con la empresa del token fijada. */
    public static function publico(string $token): ?array
    {
        $q = DB::table('lot_qr_tokens')->where('token', $token)->where('status', 'ACTIVE')->first();
        if (! $q) {
            return null;
        }
        $l = DB::table('lots as l')->join('products as p', 'p.id', '=', 'l.product_id')->join('product_variants as v', 'v.id', '=', 'l.variant_id')
            ->leftJoin('brands as b', 'b.id', '=', 'v.brand_id')->where('l.id', $q->lot_id)
            ->first(['l.id', 'l.code', 'l.qc_status', 'l.production_date', 'l.expiry_date', 'p.name as product_name', 'v.name as variant_name', 'p.sanitary_authority',
                'p.sanitary_registry', 'p.sanitary_registry_expires', 'p.storage', 'b.name as brand_name']);
        if (! $l || ! in_array($l->qc_status, ['RELEASED', 'RECALLED'], true)) {
            return null;
        }
        $o = self::origen($l->id);
        $retiro = $l->qc_status === 'RECALLED' ? DB::table('lot_recall_lots as rl')->join('lot_recalls as r', 'r.id', '=', 'rl.recall_id')->where('rl.lot_id', $l->id)
            ->orderByDesc('r.initiated_at')->first(['r.number', 'r.initiated_at']) : null;

        return [
            'product' => $l->product_name, 'variant' => $l->variant_name !== $l->product_name ? $l->variant_name : null, 'brand' => $l->brand_name, 'lot' => $l->code,
            'production_date' => $l->production_date, 'expiry_date' => $l->expiry_date, 'storage' => self::conservacion($l->storage),
            'sanitary' => $l->sanitary_authority && $l->sanitary_authority !== 'NONE' ? ['authority' => $l->sanitary_authority, 'number' => $l->sanitary_registry, 'expires' => $l->sanitary_registry_expires] : null,
            // D-ETQ-02: especie, fecha de beneficio y granja; nunca nombres de personas.
            'farm' => $o ? ['species' => $o['species'] ?? null, 'slaughter_date' => $o['slaughter_date'] ?? null, 'farm_name' => $o['farm_name'] ?? 'Granja Don Guando',
                'tagline' => 'De nuestra granja a tu mesa'] : null,
            'recalled' => $l->qc_status === 'RECALLED', 'recall' => $retiro ? ['number' => $retiro->number, 'date' => substr((string) $retiro->initiated_at, 0, 10),
                'message' => 'Este lote está en retiro. No lo consumas y comunícate con la tienda para su cambio o devolución.'] : null,
        ];
    }

    /* ================================================================ ETQ-09 tablero */

    public static function kpis(string $desde, string $hasta, array $locales = []): array
    {
        $fin = $hasta.' 23:59:59';
        $ret = DB::table('lot_recalls')->whereBetween('initiated_at', [$desde, $fin])->get();
        $minutos = $ret->filter(fn ($r) => $r->contacts_listed_at)->map(fn ($r) => (strtotime($r->contacts_listed_at) - strtotime($r->initiated_at)) / 60);
        $cont = DB::table('lot_recall_contacts')->whereIn('recall_id', $ret->pluck('id'))->selectRaw('sum(weight_kg) as vendido, sum(recovered_kg) as recuperado')->first();
        $imp = DB::table('label_prints as p')->join('establishments as e', 'e.id', '=', 'p.establishment_id')->whereBetween('p.printed_at', [$desde, $fin])
            ->when($locales, fn ($q) => $q->whereIn('p.establishment_id', $locales))
            ->groupBy('e.id', 'e.name', 'e.short')->selectRaw('e.id, coalesce(e.short, e.name) as establishment_name, count(*) as prints, sum(CASE WHEN p.reprint_of IS NOT NULL THEN 1 ELSE 0 END) as reprints, sum(p.copies) as labels')
            ->get()->map(fn ($x) => tap($x, fn () => $x->reprint_pct = $x->prints ? Comun::t($x->reprints / $x->prints * 100, 1) : null));
        $total = (int) $imp->sum('prints');

        return ['period' => ['from' => $desde, 'to' => $hasta], 'recalls' => $ret->count(), 'open_recalls' => DB::table('lot_recalls')->where('status', 'OPEN')->count(),
            'listing_minutes_avg' => $minutos->count() ? Comun::t($minutos->avg(), 1) : null,
            'recovery_pct' => (float) ($cont->vendido ?? 0) > 0 ? Comun::t((float) $cont->recuperado / (float) $cont->vendido * 100, 1) : null,
            'sold_kg' => Comun::t($cont->vendido ?? 0), 'recovered_kg' => Comun::t($cont->recuperado ?? 0),
            'prints' => $total, 'reprints' => (int) $imp->sum('reprints'), 'labels' => (int) $imp->sum('labels'),
            'reprint_pct' => $total ? Comun::t($imp->sum('reprints') / $total * 100, 1) : null, 'by_establishment' => $imp->values()];
    }
}
