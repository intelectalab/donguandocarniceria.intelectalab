<?php

namespace App\Modulos\Alm\Services;

use App\Models\User;
use App\Modulos\Alm\Services\Guias\EmisorGuiaRemision;
use App\Modulos\Alm\Services\Guias\GuiaRemisionManual;
use App\Modulos\Alm\Services\Soporte as S;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Transferencias entre almacenes y locales (ALM-07, ALM-12).
 *  RN-ALM-10  entre locales distintos sale solo con guía de remisión; en el mismo local no la necesita.
 *  RN-ALM-11  la recepción registra lo recibido por línea; la diferencia exige motivo y queda como merma.
 */
final class TransferenciasService
{
    public static function crear(array $t, User $quien): object
    {
        self::permiso($quien, 'alm.transfer.create');

        return DB::transaction(function () use ($t, $quien) {
            $de = InventarioService::almacen($t['from_warehouse_id'] ?? null);
            $a = InventarioService::almacen($t['to_warehouse_id'] ?? null);
            if ($de->id === $a->id) {
                RuleError::fail('RN-ALM-10', 'Elige un almacén de origen y otro de destino.');
            }
            if (in_array('TRANSIT', [$de->wh_type, $a->wh_type], true)) {
                RuleError::fail('RN-ALM-10', 'El almacén de tránsito lo maneja el sistema: elige el origen y el destino reales.');
            }
            if (empty($t['lines'])) {
                RuleError::fail('RN-ALM-10', 'Agrega al menos una línea.');
            }
            $guia = $de->establishment_id !== $a->establishment_id;
            $id = DB::table('stock_transfers')->insertGetId([
                'number' => S::numero('stock_transfers', 'TR-'), 'from_warehouse_id' => $de->id, 'to_warehouse_id' => $a->id,
                'from_site' => $de->establishment_id, 'to_site' => $a->establishment_id, 'establishment_id' => $de->establishment_id,
                'status' => 'DRAFT', 'requires_guide' => $guia, 'notes' => $t['notes'] ?? null, 'requested_by' => $quien->id, 'requested_at' => now(),
            ], 'id');
            foreach (array_values($t['lines']) as $i => $l) {
                $v = InventarioService::variante($l['variant_id'] ?? null);
                if (! empty($l['lot_id']) && DB::table('lots')->where('id', $l['lot_id'])->value('variant_id') !== $v->id) {
                    RuleError::fail('RN-ALM-08', "El lote indicado no es de {$v->name}.");
                }
                $q = S::q($l['qty'] ?? 0);
                if ($q < S::EPS) {
                    RuleError::fail('RN-ALM-10', "La cantidad de {$v->name} debe ser mayor que cero.");
                }
                DB::table('stock_transfer_lines')->insert([
                    'transfer_id' => $id, 'variant_id' => $v->id, 'lot_id' => $l['lot_id'] ?? null, 'qty' => $q,
                    'weight_kg' => isset($l['weight_kg']) && $l['weight_kg'] !== '' ? S::q($l['weight_kg']) : ($v->sale_mode === 'KG' ? $q : ($v->nominal_weight_kg ? S::q($q * (float) $v->nominal_weight_kg) : null)),
                    'moved' => '[]', 'created_at' => now()->addMicroseconds($i),
                ]);
            }

            return self::ver($id);
        });
    }

    public static function emitirGuia(string $id, User $quien, array $datos = []): object
    {
        self::permiso($quien, 'alm.transfer.create');

        return DB::transaction(function () use ($id, $datos) {
            $tr = self::fila($id);
            if (! $tr->requires_guide) {
                RuleError::fail('RN-ALM-10', 'Entre ubicaciones del mismo local no se emite guía.');
            }
            if ($tr->guide_number) {
                return self::ver($id);
            }
            if ($tr->status !== 'DRAFT') {
                RuleError::fail('RN-ALM-10', 'La guía se emite antes del despacho.');
            }
            $emisor = app()->bound(EmisorGuiaRemision::class) ? app(EmisorGuiaRemision::class) : new GuiaRemisionManual;
            $g = $emisor->emitir($tr, DB::table('stock_transfer_lines')->where('transfer_id', $tr->id)->get()->all(), $datos);
            DB::table('stock_transfers')->where('id', $tr->id)->update([
                'guide_number' => $g['full_number'], 'guide_series' => $g['series'], 'guide_reason_code' => '04', 'guide_issued_at' => $g['issued_at'], 'updated_at' => now(),
            ]);
            if ($emisor instanceof GuiaRemisionManual) {
                Events::emit('guide.issued', 'stock_transfers', $tr->id, ['full_number' => $g['full_number'], 'reason_code' => '04', 'source' => 'ALM']);
            }

            return self::ver($id);
        });
    }

    public static function despachar(string $id, User $quien): object
    {
        self::permiso($quien, 'alm.transfer.create');

        return DB::transaction(function () use ($id, $quien) {
            $tr = self::fila($id);
            if ($tr->status !== 'DRAFT') {
                RuleError::fail('RN-ALM-10', "La transferencia {$tr->number} ya fue despachada o cancelada.");
            }
            if ($tr->requires_guide && ! $tr->guide_number) {
                RuleError::fail('RN-ALM-10', "{$tr->number} va a otro local: registra la guía de remisión (motivo 04, traslado entre establecimientos) antes de despachar.");
            }
            $destino = $tr->requires_guide ? self::transito() : $tr->to_warehouse_id;
            $empresa = DB::table('establishments')->where('id', $tr->from_site)->value('company_id');
            $motivo = "Traslado {$tr->number}".($tr->guide_number ? " · GRE {$tr->guide_number}" : '');
            foreach (DB::table('stock_transfer_lines')->where('transfer_id', $tr->id)->orderBy('created_at')->orderBy('id')->get() as $l) {
                $out = InventarioService::mover([
                    'type' => 'TRANSFER_OUT', 'warehouse_id' => $tr->from_warehouse_id, 'variant_id' => $l->variant_id, 'lot_id' => $l->lot_id,
                    'qty' => $l->qty, 'weight_kg' => $l->weight_kg, 'source_type' => 'STOCK_TRANSFER', 'source_id' => $tr->id, 'reason' => $motivo,
                ], $quien);
                $movido = [];
                foreach ($out['moves'] as $mv) {
                    InventarioService::mover([
                        'type' => 'TRANSFER_IN', 'warehouse_id' => $destino, 'variant_id' => $l->variant_id, 'lot_id' => $mv['lot_id'],
                        'qty' => abs((float) $mv['qty']), 'weight_kg' => $mv['weight_kg'] !== null ? abs((float) $mv['weight_kg']) : null,
                        'unit_cost' => $mv['unit_cost'], 'source_type' => 'STOCK_TRANSFER', 'source_id' => $tr->id, 'reason' => $motivo, 'company_id' => $empresa,
                    ], $quien);
                    $movido[] = ['lot_id' => $mv['lot_id'], 'qty' => abs((float) $mv['qty']), 'weight_kg' => $mv['weight_kg'] !== null ? abs((float) $mv['weight_kg']) : null, 'unit_cost' => (float) $mv['unit_cost']];
                }
                $cambios = ['moved' => json_encode($movido), 'updated_at' => now()];
                if (! $tr->requires_guide) {
                    $cambios += ['received_qty' => $l->qty, 'received_weight_kg' => $l->weight_kg];
                }
                DB::table('stock_transfer_lines')->where('id', $l->id)->update($cambios);
            }
            DB::table('stock_transfers')->where('id', $tr->id)->update([
                'status' => $tr->requires_guide ? 'DISPATCHED' : 'RECEIVED', 'dispatched_at' => now(), 'dispatched_by' => $quien->id,
                'received_at' => $tr->requires_guide ? null : now(), 'received_by' => $tr->requires_guide ? null : $quien->id, 'updated_at' => now(),
            ]);

            return self::ver($tr->id);
        });
    }

    /** @param  array<int, array{line_id: string, received_qty: mixed, received_weight_kg?: mixed, difference_reason?: ?string}>  $recibido */
    public static function recibir(string $id, array $recibido, User $quien): object
    {
        self::permiso($quien, 'alm.transfer.receive');

        return DB::transaction(function () use ($id, $recibido, $quien) {
            $tr = self::fila($id);
            if ($tr->status !== 'DISPATCHED') {
                RuleError::fail('RN-ALM-11', "La transferencia {$tr->number} no está en tránsito.");
            }
            $porLinea = collect($recibido)->keyBy('line_id');
            $transito = self::transito();
            $empresa = DB::table('establishments')->where('id', $tr->to_site)->value('company_id');
            $motivoMerma = DB::table('waste_reasons')->where('code', 'TRAN')->value('id');
            $hayDiferencia = false;
            $lineas = DB::table('stock_transfer_lines')->where('transfer_id', $tr->id)->orderBy('created_at')->orderBy('id')->get();
            foreach ($lineas as $l) {
                $v = InventarioService::variante($l->variant_id);
                $r = $porLinea[$l->id] ?? null;
                if (! $r || ! isset($r['received_qty']) || $r['received_qty'] === '' || (float) $r['received_qty'] < 0) {
                    RuleError::fail('RN-ALM-11', "Registra la cantidad recibida de {$v->name}.");
                }
                $llego = S::q($r['received_qty']);
                $razon = trim((string) ($r['difference_reason'] ?? ''));
                if ($llego > (float) $l->qty + S::EPS) {
                    RuleError::fail('RN-ALM-11', "{$v->name}: no se recibe más de lo enviado (".S::cant((float) $l->qty, $v->sale_mode).').');
                }
                if (abs($llego - (float) $l->qty) > S::EPS && mb_strlen($razon) < 5) {
                    RuleError::fail('RN-ALM-11', "{$v->name}: se enviaron ".S::cant((float) $l->qty, $v->sale_mode).' y llegaron '.S::cant($llego, $v->sale_mode).'. Registra el motivo de la diferencia.');
                }
                $queda = $llego;
                foreach (json_decode($l->moved ?: '[]', true) as $parte) {
                    $toma = S::q(min($queda, $parte['qty']));
                    $perdido = S::q($parte['qty'] - $toma);
                    $pesoToma = $parte['weight_kg'] !== null && $parte['qty'] > 0 ? S::q($parte['weight_kg'] * $toma / $parte['qty']) : null;
                    if ($toma > S::EPS) {
                        $out = InventarioService::mover(['type' => 'TRANSFER_OUT', 'warehouse_id' => $transito, 'variant_id' => $l->variant_id, 'lot_id' => $parte['lot_id'],
                            'qty' => $toma, 'weight_kg' => $pesoToma, 'source_type' => 'STOCK_TRANSFER', 'source_id' => $tr->id, 'reason' => "Recepción {$tr->number}",
                            'company_id' => $empresa, 'allow_unreleased' => true], $quien);
                        InventarioService::mover(['type' => 'TRANSFER_IN', 'warehouse_id' => $tr->to_warehouse_id, 'variant_id' => $l->variant_id, 'lot_id' => $parte['lot_id'],
                            'qty' => $toma, 'weight_kg' => $pesoToma, 'unit_cost' => $out['moves'][0]['unit_cost'], 'source_type' => 'STOCK_TRANSFER', 'source_id' => $tr->id,
                            'reason' => "Recepción {$tr->number}"], $quien);
                    }
                    if ($perdido > S::EPS) {
                        $pesoPerdido = $parte['weight_kg'] !== null ? S::q($parte['weight_kg'] - ($pesoToma ?? 0)) : null;
                        $mv = InventarioService::mover(['type' => 'WASTE', 'warehouse_id' => $transito, 'variant_id' => $l->variant_id, 'lot_id' => $parte['lot_id'],
                            'qty' => $perdido, 'weight_kg' => $pesoPerdido, 'source_type' => 'STOCK_TRANSFER', 'source_id' => $tr->id,
                            'reason' => "Diferencia en traslado {$tr->number}: {$razon}", 'company_id' => $empresa, 'allow_unreleased' => true], $quien);
                        DB::table('stock_waste_records')->insert([
                            'number' => S::numero('stock_waste_records', 'MER-'), 'warehouse_id' => $transito, 'establishment_id' => $tr->to_site,
                            'variant_id' => $l->variant_id, 'lot_id' => $parte['lot_id'], 'reason_id' => $motivoMerma ?? RuleError::fail('RN-ALM-11', 'Falta el motivo de merma TRAN (diferencia en traslado) en ALM-13.'),
                            'qty' => $perdido, 'weight_kg' => $pesoPerdido, 'estimated_cost' => abs((float) $mv['total_cost']), 'actual_cost' => abs((float) $mv['total_cost']),
                            'notes' => "Diferencia de la transferencia {$tr->number}: {$razon}", 'status' => 'APPROVED', 'approved_by' => $quien->id, 'approved_at' => now(),
                            'requested_by' => $quien->id, 'requested_at' => now(), 'move_id' => $mv['moves'][0]['movement_id'],
                        ]);
                        $hayDiferencia = true;
                    }
                    $queda = S::q($queda - $toma);
                }
                DB::table('stock_transfer_lines')->where('id', $l->id)->update([
                    'received_qty' => $llego,
                    'received_weight_kg' => isset($r['received_weight_kg']) && $r['received_weight_kg'] !== '' ? S::q($r['received_weight_kg'])
                        : ($l->weight_kg !== null && (float) $l->qty > 0 ? S::q((float) $l->weight_kg * $llego / (float) $l->qty) : null),
                    'difference_reason' => $razon !== '' ? mb_substr($razon, 0, 255) : null, 'updated_at' => now(),
                ]);
            }
            DB::table('stock_transfers')->where('id', $tr->id)->update([
                'status' => $hayDiferencia ? 'RECEIVED_WITH_DIFF' : 'RECEIVED', 'received_at' => now(), 'received_by' => $quien->id, 'updated_at' => now(),
            ]);

            return self::ver($tr->id);
        });
    }

    public static function cancelar(string $id, string $motivo, User $quien): object
    {
        self::permiso($quien, 'alm.transfer.create');
        if (mb_strlen(trim($motivo)) < 5) {
            RuleError::fail('RN-ALM-10', 'Cancelar exige motivo.');
        }

        return DB::transaction(function () use ($id, $motivo) {
            $tr = self::fila($id);
            if ($tr->status !== 'DRAFT') {
                RuleError::fail('RN-ALM-10', 'Solo se cancela una transferencia sin despachar.');
            }
            DB::table('stock_transfers')->where('id', $tr->id)->update(['status' => 'CANCELLED', 'cancel_reason' => mb_substr(trim($motivo), 0, 255), 'updated_at' => now()]);

            return self::ver($tr->id);
        });
    }

    public static function ver(string $id): object
    {
        $tr = DB::table('stock_transfers as t')->join('warehouses as a', 'a.id', '=', 't.from_warehouse_id')->join('warehouses as b', 'b.id', '=', 't.to_warehouse_id')
            ->where('t.id', $id)->first(['t.*', 'a.code as from_code', 'a.name as from_name', 'b.code as to_code', 'b.name as to_name'])
            ?? RuleError::fail('RN-ALM-10', 'Transferencia no encontrada.');
        $tr->lines = DB::table('stock_transfer_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->leftJoin('lots as lo', 'lo.id', '=', 'l.lot_id')
            ->where('l.transfer_id', $id)->orderBy('l.created_at')->orderBy('l.id')
            ->get(['l.id', 'l.variant_id', 'l.lot_id', 'l.qty', 'l.weight_kg', 'l.received_qty', 'l.received_weight_kg', 'l.difference_reason', 'l.moved', 'v.sku', 'v.name as variant_name', 'v.sale_mode', 'lo.code as lot_code'])
            ->map(function ($l) {
                $l->moved = json_decode($l->moved ?: '[]', true);

                return $l;
            });

        return $tr;
    }

    private static function fila(string $id): object
    {
        return DB::table('stock_transfers')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-ALM-10', 'Transferencia no encontrada.');
    }

    private static function transito(): string
    {
        return DB::table('warehouses')->where('wh_type', 'TRANSIT')->where('status', 'ACTIVE')->orderBy('code')->value('id')
            ?? RuleError::fail('RN-ALM-10', 'Falta el almacén de tránsito (tipo TRANSIT): créalo en ALM-01.');
    }

    private static function permiso(User $quien, string $p): void
    {
        if (! Access::can($quien, $p)) {
            RuleError::fail($p === 'alm.transfer.receive' ? 'RN-ALM-11' : 'RN-ALM-10', "No tienes el permiso {$p}.");
        }
    }
}
