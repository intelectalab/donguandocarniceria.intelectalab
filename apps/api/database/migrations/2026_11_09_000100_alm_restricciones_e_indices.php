<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// ALM · restricciones, índices y correcciones del esquema generado (Fase 1 del módulo).
// Lee el esquema FINAL: 001100 creó las tablas, 002650 pasó los ids a uuid y 003100 los textos a 255.
// Decisiones y motivos: docs/contratos.md (sección ALM) y docs/cambios/2026-11-09_alm-contrato-y-base.md.
//
// No se agrega CHECK (reserved_qty <= qty): una fila sembrada (cámara de frío Local 1, cuy entero,
// lote L261008-001: saldo 6, reservado 8) lo viola y rompería migrate:fresh --seed. Esa regla
// (RN-ALM-03) la valida InventarioService con bloqueo de fila.
return new class extends Migration
{
    /** Uuid cero: un saldo sin lote cuenta como «un lote más» en el índice único. */
    private const SIN_LOTE = "'00000000-0000-0000-0000-000000000000'::uuid";

    private const ESTADOS = [
        ['lots', 'qc_status', ['QUARANTINE', 'RELEASED', 'BLOCKED', 'REJECTED', 'RECALLED']],
        ['stock_movements', 'movement_type', ['RECEIPT', 'SALE', 'RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'PRODUCTION_IN', 'PRODUCTION_OUT', 'ADJUSTMENT', 'WASTE', 'CONSIGNMENT_OUT', 'CONSIGNMENT_RETURN', 'REVERSAL']],
        ['stock_receipts', 'status', ['DRAFT', 'CONFIRMED', 'VOIDED']],
        ['stock_receipts', 'source_type', ['PURCHASE', 'FARM', 'PRODUCTION', 'CUSTOMER_RETURN', 'OTHER']],
        ['stock_receipt_lines', 'qc_result', ['PENDING', 'PASS', 'FAIL']],
        ['stock_receipt_lines', 'appearance', ['OK', 'OBSERVED', 'REJECTED']],
        ['stock_transfers', 'status', ['DRAFT', 'DISPATCHED', 'RECEIVED', 'RECEIVED_WITH_DIFF', 'CANCELLED']],
        ['stock_counts', 'status', ['OPEN', 'COUNTED', 'APPROVED', 'CANCELLED']],
        ['stock_waste_records', 'status', ['PENDING', 'APPROVED', 'REJECTED']],
        ['stock_reservations', 'status', ['ACTIVE', 'RELEASED', 'CONSUMED']],
        ['warehouses', 'wh_type', ['MAIN', 'COLD_ROOM', 'FREEZER', 'STORE', 'PRODUCTION', 'QUARANTINE', 'TRANSIT', 'VEHICLE', 'RETURNS', 'CONSIGNMENT']],
        ['warehouses', 'status', ['ACTIVE', 'INACTIVE']],
        ['waste_reasons', 'status', ['ACTIVE', 'INACTIVE']],
    ];

    /** Columnas que el generador dejó obligatorias solo porque la demo siempre las traía. */
    private const OPCIONALES = [
        ['stock_reservations', 'lot_id'],      // hay saldos sin lote (productos sin requires_lot) que también se reservan
        ['stock_waste_records', 'lot_id'],     // merma de un producto sin lote
        ['stock_count_lines', 'lot_id'],       // conteo de un saldo sin lote
        ['stock_count_lines', 'counted_by'],   // la línea nace sin contar (conteo ciego)
        ['stock_waste_records', 'notes'],
        ['stock_transfers', 'notes'],
        ['stock_receipts', 'supplier_id'],     // devolución de cliente o ingreso de producción: sin proveedor
    ];

    public function up(): void
    {
        // RN-ALM-03: saldo y reservado nunca negativos (hoy 0 filas los violan).
        DB::statement('ALTER TABLE stock_balances ADD CONSTRAINT stock_balances_qty_no_negativo CHECK (qty >= 0)');
        DB::statement('ALTER TABLE stock_balances ADD CONSTRAINT stock_balances_reservado_no_negativo CHECK (reserved_qty >= 0)');
        DB::statement('ALTER TABLE stock_reservations ADD CONSTRAINT stock_reservations_qty_positivo CHECK (qty > 0)');

        // Un solo saldo por almacén, variante y lote (el lote vacío cuenta como uno).
        DB::statement('CREATE UNIQUE INDEX stock_balances_unico ON stock_balances (tenant_id, warehouse_id, variant_id, COALESCE(lot_id, '.self::SIN_LOTE.'))');

        // Kardex: el signo de la cantidad lo da el tipo (las entradas suman, las salidas restan; ajuste y reverso, ±).
        DB::statement("ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_signo CHECK (
            qty <> 0
            AND (movement_type NOT IN ('RECEIPT','RETURN','TRANSFER_IN','PRODUCTION_IN','CONSIGNMENT_RETURN') OR qty > 0)
            AND (movement_type NOT IN ('SALE','TRANSFER_OUT','PRODUCTION_OUT','WASTE','CONSIGNMENT_OUT') OR qty < 0))");

        // Estados con los valores de la spec y del prototipo.
        foreach (self::ESTADOS as [$tabla, $col, $valores]) {
            $lista = implode(',', array_map(fn ($v) => "'{$v}'", $valores));
            DB::statement("ALTER TABLE {$tabla} ADD CONSTRAINT {$tabla}_{$col}_valido CHECK ({$col} IN ({$lista}))");
        }

        foreach (self::OPCIONALES as [$tabla, $col]) {
            DB::statement("ALTER TABLE {$tabla} ALTER COLUMN {$col} DROP NOT NULL");
        }

        // Columnas que el generador dejó como texto (hoy vacías en los datos de demo).
        DB::statement('ALTER TABLE stock_movements ALTER COLUMN reversal_of TYPE uuid USING reversal_of::uuid');
        DB::statement('ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reversal_of_foreign FOREIGN KEY (reversal_of) REFERENCES stock_movements(id) ON DELETE RESTRICT');
        DB::statement('ALTER TABLE stock_count_lines ALTER COLUMN counted_weight_kg TYPE numeric(14,3) USING counted_weight_kg::numeric');

        // stock_movements."user" es el nombre de quien movió (foto del momento). Se agrega el id;
        // el nombre se mantiene para el historial sembrado, que no trae id.
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->uuid('user_id')->nullable();
            $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete();
        });
        DB::statement('UPDATE stock_movements m SET user_id = u.id FROM users u WHERE u.tenant_id = m.tenant_id AND u.name = m."user" AND m.user_id IS NULL');

        // Datos que las pantallas y reglas de la spec necesitan y la tabla generada no tenía.
        Schema::table('stock_receipts', function (Blueprint $table) {
            $table->string('void_reason', 255)->nullable();          // ALM-04: anular un borrador exige motivo
        });
        Schema::table('stock_receipt_lines', function (Blueprint $table) {
            $table->date('production_date')->nullable();             // fecha de producción o beneficio del lote recibido
        });
        Schema::table('stock_reservations', function (Blueprint $table) {
            $table->uuid('released_by')->nullable();                 // ALM-10: liberación manual con permiso
            $table->foreign('released_by')->references('id')->on('users')->restrictOnDelete();
        });
        Schema::table('stock_transfers', function (Blueprint $table) {
            $table->string('cancel_reason', 255)->nullable();
        });
        Schema::table('stock_counts', function (Blueprint $table) {
            $table->text('notes')->nullable();
        });

        // RN-ALM-15: alerta diaria de vencimiento, una por lote, día y tramo (3 o 7 días, o vencido).
        Schema::create('stock_expiry_alerts', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->date('alert_date');
            $table->uuid('lot_id');
            $table->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete();
            $table->uuid('variant_id');
            $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete();
            $table->string('bucket', 20)->comment('EXPIRED, D3, D7');
            $table->integer('days_left');
            $table->decimal('qty', 14, 3);
            $table->decimal('reserved_qty', 14, 3)->default(0);
            $table->decimal('value_pen', 14, 2);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->unique(['tenant_id', 'alert_date', 'lot_id']);
        });
        DB::statement("ALTER TABLE stock_expiry_alerts ADD CONSTRAINT stock_expiry_alerts_bucket_valido CHECK (bucket IN ('EXPIRED','D3','D7'))");
        DB::statement("SELECT enable_tenant_rls('stock_expiry_alerts')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON stock_expiry_alerts FROM aycha_app');  // solo inserción

        // RN-ALM-01: el kardex es de solo inserción (se corrige con reversos), como lot_status_changes.
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON stock_movements FROM aycha_app');

        // Números de documento únicos por empresa. Los códigos de lote NO: la demo repite algunos (L260825-C02).
        foreach (['stock_receipts', 'stock_transfers', 'stock_counts', 'stock_waste_records'] as $tabla) {
            Schema::table($tabla, fn (Blueprint $table) => $table->unique(['tenant_id', 'number']));
        }
        Schema::table('waste_reasons', fn (Blueprint $table) => $table->unique(['tenant_id', 'code']));

        // Índices para FEFO, kardex, reservas y pantallas.
        DB::statement('CREATE INDEX lots_fefo_index ON lots (variant_id, qc_status, expiry_date)');
        DB::statement('CREATE INDEX lots_code_index ON lots (tenant_id, code)');
        DB::statement('CREATE INDEX stock_balances_con_saldo_index ON stock_balances (variant_id, warehouse_id) WHERE qty > 0');
        DB::statement('CREATE INDEX stock_movements_variante_fecha_index ON stock_movements (tenant_id, variant_id, moved_at DESC)');
        DB::statement('CREATE INDEX stock_movements_almacen_fecha_index ON stock_movements (warehouse_id, moved_at DESC)');
        DB::statement('CREATE INDEX stock_movements_lote_fecha_index ON stock_movements (lot_id, moved_at DESC) WHERE lot_id IS NOT NULL');
        DB::statement('CREATE INDEX stock_movements_origen_index ON stock_movements (source_type, source_id)');
        DB::statement('CREATE INDEX stock_movements_tipo_fecha_index ON stock_movements (tenant_id, movement_type, moved_at)');
        DB::statement("CREATE INDEX stock_reservations_activas_index ON stock_reservations (order_id, order_line_id) WHERE status = 'ACTIVE'");
        DB::statement("CREATE UNIQUE INDEX stock_reservations_una_activa ON stock_reservations (order_line_id, balance_id) WHERE status = 'ACTIVE'");
        DB::statement('CREATE INDEX stock_transfers_estado_index ON stock_transfers (tenant_id, status)');
        DB::statement('CREATE INDEX stock_waste_records_estado_index ON stock_waste_records (tenant_id, status)');
        DB::statement('CREATE INDEX stock_receipts_estado_index ON stock_receipts (tenant_id, status)');
        DB::statement('CREATE INDEX lot_status_changes_lote_fecha_index ON lot_status_changes (lot_id, changed_at)');
        DB::statement('CREATE INDEX stock_movements_user_id_index ON stock_movements (user_id)');
        DB::statement('CREATE INDEX stock_movements_reversal_of_index ON stock_movements (reversal_of)');
        DB::statement('CREATE INDEX stock_reservations_released_by_index ON stock_reservations (released_by)');
    }

    public function down(): void
    {
        foreach (['stock_movements_reversal_of_index', 'stock_reservations_released_by_index', 'stock_movements_user_id_index',
            'lot_status_changes_lote_fecha_index', 'stock_receipts_estado_index', 'stock_waste_records_estado_index', 'stock_transfers_estado_index',
            'stock_reservations_una_activa', 'stock_reservations_activas_index', 'stock_movements_tipo_fecha_index', 'stock_movements_origen_index',
            'stock_movements_lote_fecha_index', 'stock_movements_almacen_fecha_index', 'stock_movements_variante_fecha_index',
            'stock_balances_con_saldo_index', 'lots_code_index', 'lots_fefo_index', 'stock_balances_unico'] as $indice) {
            DB::statement("DROP INDEX IF EXISTS {$indice}");
        }
        Schema::table('waste_reasons', fn (Blueprint $table) => $table->dropUnique(['tenant_id', 'code']));
        foreach (['stock_receipts', 'stock_transfers', 'stock_counts', 'stock_waste_records'] as $tabla) {
            Schema::table($tabla, fn (Blueprint $table) => $table->dropUnique(['tenant_id', 'number']));
        }

        DB::statement('GRANT UPDATE, DELETE, TRUNCATE ON stock_movements TO aycha_app');
        Schema::dropIfExists('stock_expiry_alerts');

        Schema::table('stock_counts', fn (Blueprint $table) => $table->dropColumn('notes'));
        Schema::table('stock_transfers', fn (Blueprint $table) => $table->dropColumn('cancel_reason'));
        Schema::table('stock_reservations', function (Blueprint $table) {
            $table->dropForeign(['released_by']);
            $table->dropColumn('released_by');
        });
        Schema::table('stock_receipt_lines', fn (Blueprint $table) => $table->dropColumn('production_date'));
        Schema::table('stock_receipts', fn (Blueprint $table) => $table->dropColumn('void_reason'));
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->dropForeign(['user_id']);
            $table->dropColumn('user_id');
        });

        DB::statement('ALTER TABLE stock_count_lines ALTER COLUMN counted_weight_kg TYPE varchar(255) USING counted_weight_kg::text');
        DB::statement('ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_reversal_of_foreign');
        DB::statement('ALTER TABLE stock_movements ALTER COLUMN reversal_of TYPE varchar(255) USING reversal_of::text');

        // Las columnas vuelven a ser obligatorias solo si ninguna fila quedó vacía.
        foreach (self::OPCIONALES as [$tabla, $col]) {
            if (! DB::table($tabla)->whereNull($col)->exists()) {
                DB::statement("ALTER TABLE {$tabla} ALTER COLUMN {$col} SET NOT NULL");
            }
        }

        foreach (self::ESTADOS as [$tabla, $col]) {
            DB::statement("ALTER TABLE {$tabla} DROP CONSTRAINT IF EXISTS {$tabla}_{$col}_valido");
        }
        DB::statement('ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_signo');
        DB::statement('ALTER TABLE stock_reservations DROP CONSTRAINT IF EXISTS stock_reservations_qty_positivo');
        DB::statement('ALTER TABLE stock_balances DROP CONSTRAINT IF EXISTS stock_balances_reservado_no_negativo');
        DB::statement('ALTER TABLE stock_balances DROP CONSTRAINT IF EXISTS stock_balances_qty_no_negativo');
    }
};
