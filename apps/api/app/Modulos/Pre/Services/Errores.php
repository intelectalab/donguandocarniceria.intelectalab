<?php

namespace App\Modulos\Pre\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * PRE-10 Errores de armado (RN-PRE-11): tipo, etapa en que se detectó, quién lo detectó, responsable,
 * costo y acción correctiva. Los que llegaron al cliente (entrega o reclamo) exigen responsable y cerrar
 * cualquier error exige la acción correctiva (también en la base).
 */
final class Errores
{
    public const TIPOS = [
        'WRONG_PRODUCT' => 'Producto equivocado', 'WRONG_CUT' => 'Corte equivocado', 'MISSING_ITEM' => 'Faltante', 'EXTRA_ITEM' => 'Sobrante',
        'WRONG_QTY' => 'Cantidad', 'WRONG_WEIGHT' => 'Peso', 'CROSSED_CUSTOMER' => 'Pedido cruzado (cliente)', 'EXPIRED_LOT' => 'Lote vencido',
        'DAMAGED_PACKAGE' => 'Empaque', 'LABEL_ERROR' => 'Etiqueta', 'OTHER' => 'Otro',
    ];

    public const ETAPAS = [
        'PICKING_SCAN' => 'Armado (escaneo)', 'VERIFICATION' => 'Verificación', 'LOADING' => 'Carga', 'DELIVERY' => 'Entrega', 'CUSTOMER_CLAIM' => 'Reclamo del cliente',
    ];

    public const LLEGARON_AL_CLIENTE = ['DELIVERY', 'CUSTOMER_CLAIM'];

    /** @param  array{order_id: string, error_type: string, detected_at_stage: string, description: string, responsible_employee_id?: ?string, cost_amount?: mixed, corrective_action?: ?string}  $d */
    public static function registrar(array $d, User $u): object
    {
        return DB::transaction(function () use ($d, $u) {
            $o = DB::table('sales_orders')->where('id', $d['order_id'] ?? '')->first();
            if (! $o || ! Base::veTarea($o, $u)) {
                RuleError::fail('RN-PRE-11', 'Indica el pedido (de tus marcas y locales).');
            }
            if (! array_key_exists($d['error_type'] ?? '', self::TIPOS) || ! array_key_exists($d['detected_at_stage'] ?? '', self::ETAPAS)) {
                RuleError::fail('RN-PRE-11', 'Indica el tipo de error y la etapa en que se detectó.');
            }
            $desc = trim((string) ($d['description'] ?? ''));
            if ($desc === '') {
                RuleError::fail('RN-PRE-11', 'Describe el error.');
            }
            $resp = $d['responsible_employee_id'] ?? null;
            if (in_array($d['detected_at_stage'], self::LLEGARON_AL_CLIENTE, true) && ! $resp) {
                RuleError::fail('RN-PRE-11', 'El error llegó al cliente: indica el responsable.');
            }
            if ($resp && ! DB::table('employees')->where('id', $resp)->exists()) {
                RuleError::fail('RN-PRE-11', 'El responsable no es un trabajador registrado.');
            }
            $costo = round((float) ($d['cost_amount'] ?? 0), 2);
            if ($costo < 0) {
                RuleError::fail('RN-PRE-11', 'El costo no puede ser negativo.');
            }
            $t = Tareas::activaDe($o->id) ?? DB::table('picking_tasks')->where('order_id', $o->id)->orderByDesc('created_at')->first();
            $accion = trim((string) ($d['corrective_action'] ?? ''));
            $id = DB::table('packing_errors')->insertGetId([
                'order_id' => $o->id, 'task_id' => $t?->id, 'error_type' => $d['error_type'], 'detected_at_stage' => $d['detected_at_stage'],
                'responsible_employee_id' => $resp, 'detected_by' => $u->id, 'description' => $desc, 'cost_amount' => $costo,
                'corrective_action' => $accion !== '' ? mb_substr($accion, 0, 255) : null, 'status' => 'OPEN', 'detected_at' => now(),
                'establishment_id' => $o->establishment_id,
            ], 'id');
            Events::emit('packing_error.recorded', 'packing_errors', $id, ['order_id' => $o->id, 'type' => $d['error_type'], 'stage' => $d['detected_at_stage']]);

            return DB::table('packing_errors')->where('id', $id)->first();
        });
    }

    /** Cierra el error con su acción correctiva (y el responsable, si llegó al cliente y aún no lo tenía). */
    public static function cerrar(string $id, ?string $accion, ?string $responsable, User $u): object
    {
        return DB::transaction(function () use ($id, $accion, $responsable, $u) {
            $e = DB::table('packing_errors')->where('id', $id)->lockForUpdate()->first();
            if (! $e || ! Base::veLocal($u, $e->establishment_id)) {
                abort(404, 'Error de armado no encontrado.');
            }
            if ($e->status === 'CLOSED') {
                RuleError::fail('RN-PRE-11', 'El error ya está cerrado.');
            }
            $accion = trim((string) $accion) ?: (string) $e->corrective_action;
            if (trim($accion) === '') {
                RuleError::fail('RN-PRE-11', 'Cerrar un error exige la acción correctiva.');
            }
            $resp = $responsable ?: $e->responsible_employee_id;
            if (in_array($e->detected_at_stage, self::LLEGARON_AL_CLIENTE, true) && ! $resp) {
                RuleError::fail('RN-PRE-11', 'El error llegó al cliente: indica el responsable antes de cerrarlo.');
            }
            if ($resp && ! DB::table('employees')->where('id', $resp)->exists()) {
                RuleError::fail('RN-PRE-11', 'El responsable no es un trabajador registrado.');
            }
            DB::table('packing_errors')->where('id', $e->id)->update([
                'corrective_action' => mb_substr($accion, 0, 255), 'responsible_employee_id' => $resp, 'status' => 'CLOSED',
                'closed_at' => now(), 'closed_by' => $u->id, 'updated_at' => now(),
            ]);
            Events::emit('packing_error.closed', 'packing_errors', $e->id, ['order_id' => $e->order_id]);

            return DB::table('packing_errors')->where('id', $e->id)->first();
        });
    }
}
