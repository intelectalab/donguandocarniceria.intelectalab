<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// CON · Consignación: puntos (cliente + almacén CONSIGNMENT propio), contratos, entregas con GRE,
// visitas con conteo, Registro de consignaciones y liquidaciones. Decisiones:
// docs/cambios/2026-11-24_canales-con-b2b-cmp.md.
//
//  - RN-CON-02: un almacén por punto (UNIQUE warehouse_id) y un punto por cliente.
//  - RN-CON-03: un contrato ACTIVE por fecha (EXCLUDE con gist sobre la vigencia).
//  - RN-CON-07: una entrega despachada tiene serie y número de GRE (CHECK).
//  - RN-CON-09: el Registro de consignaciones es de solo inserción (REVOKE); un reverso por asiento.
//  - RN-CON-12: vendido − sobrante = teórico − contado − devuelto − vencido, ambos ≥ 0 (CHECK).
//  - RN-CON-16: add_business_days() salta sábados, domingos y feriados de calendar_holidays.
//  - RN-CON-18: neto = importe − comisión (CHECK).
//  - RN-CON-21: los tramos de un contrato no repiten su monto inicial (UNIQUE).
//  - RN-CON-23: todo equipo prestado tiene acta; la baja exige motivo (CHECK).
return new class extends Migration
{
    private const ESTADOS = [
        ['calendar_holidays', 'scope', ['NATIONAL', 'REGIONAL', 'LOCAL']],
        ['consignment_points', 'status', ['PROSPECT', 'ACTIVE', 'SUSPENDED', 'CLOSED']],
        ['consignment_contracts', 'compensation_type', ['COMMISSION', 'MARGIN']],
        ['consignment_contracts', 'status', ['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED']],
        ['consignment_equipment_loans', 'equipment_type', ['FREEZER', 'COOLER', 'DISPLAY', 'SHELF', 'OTHER']],
        ['consignment_equipment_loans', 'status', ['LOANED', 'RETURNED', 'WRITTEN_OFF']],
        ['consignment_visits', 'status', ['PLANNED', 'IN_PROGRESS', 'DONE', 'MISSED', 'CANCELLED']],
        ['consignment_deliveries', 'status', ['DRAFT', 'DISPATCHED', 'VOIDED']],
        ['consignment_register', 'entry_type', ['DELIVERY', 'SALE', 'RETURN', 'WITHDRAWAL', 'SURPLUS', 'REVERSAL']],
        ['consignment_visit_photos', 'kind', ['EXHIBITION', 'EQUIPMENT', 'RETURN']],
        ['consignment_settlements', 'status', ['DRAFT', 'APPROVED', 'INVOICED', 'VOIDED']],
    ];

    private const TABLAS = [
        'calendar_holidays', 'consignment_points', 'consignment_contracts', 'consignment_contract_products',
        'consignment_margin_tiers', 'consignment_targets', 'consignment_equipment_loans', 'consignment_visits',
        'consignment_deliveries', 'consignment_delivery_lines', 'consignment_register', 'consignment_visit_counts',
        'consignment_visit_photos', 'consignment_settlements', 'consignment_settlement_lines',
    ];

    public function up(): void
    {
        Schema::create('calendar_holidays', function (Blueprint $t) {
            $this->base($t);
            $t->date('holiday_date');
            $t->string('name', 255);
            $t->string('scope', 20)->default('NATIONAL');
            $t->uuid('establishment_id')->nullable();
            $this->fechas($t);
            $t->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete();
        });
        DB::statement("CREATE UNIQUE INDEX calendar_holidays_unico ON calendar_holidays (tenant_id, holiday_date, COALESCE(establishment_id, '00000000-0000-0000-0000-000000000000'::uuid))");

        Schema::create('consignment_points', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('customer_id')->unique();
            $t->uuid('warehouse_id')->unique();
            $t->uuid('supply_establishment_id');
            $t->uuid('zone_id')->nullable();
            $t->uuid('address_id')->nullable();
            $t->uuid('visitor_user_id')->nullable();
            $t->integer('visit_frequency_days')->default(7);
            $t->jsonb('visit_weekdays')->default(DB::raw("'[]'::jsonb"));   // 1 = lunes … 7 = domingo
            $t->decimal('visit_cost', 14, 2)->nullable();
            $t->decimal('lat', 10, 7)->nullable();
            $t->decimal('lng', 10, 7)->nullable();
            $t->string('status', 20)->default('ACTIVE');
            $t->date('opened_on')->nullable();
            $t->date('closed_on')->nullable();
            $t->string('close_reason', 255)->nullable();
            $this->fechas($t);
            $t->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete();
            $t->foreign('warehouse_id')->references('id')->on('warehouses')->restrictOnDelete();
            $t->foreign('supply_establishment_id')->references('id')->on('establishments')->restrictOnDelete();
            $t->foreign('zone_id')->references('id')->on('delivery_zones')->restrictOnDelete();
            $t->foreign('address_id')->references('id')->on('customer_addresses')->restrictOnDelete();
            $t->foreign('visitor_user_id')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('consignment_contracts', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('point_id');
            $t->string('number', 30);
            $t->integer('version')->default(1);
            $t->uuid('previous_id')->nullable();
            $t->date('valid_from');
            $t->date('valid_to')->nullable();
            $t->string('compensation_type', 20);
            $t->decimal('commission_pct', 5, 2)->nullable();
            $t->integer('settlement_frequency_days')->default(7);
            $t->integer('withdraw_days_before_expiry')->default(3);
            $t->string('signed_file_url', 500)->nullable();
            $t->string('status', 20)->default('DRAFT');
            $t->uuid('approved_by')->nullable();
            $t->timestampTz('approved_at')->nullable();
            $t->string('terminated_reason', 255)->nullable();
            $this->fechas($t);
            $t->unique(['tenant_id', 'number']);
            $t->foreign('point_id')->references('id')->on('consignment_points')->restrictOnDelete();
            $t->foreign('approved_by')->references('id')->on('users')->restrictOnDelete();
        });
        Schema::table('consignment_contracts', function (Blueprint $t) {   // referencia a la misma tabla, después de su clave
                $t->foreign('previous_id')->references('id')->on('consignment_contracts')->restrictOnDelete();
        });

        Schema::create('consignment_contract_products', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('contract_id');
            $t->uuid('variant_id');
            $t->decimal('consignor_price', 14, 4);
            $t->decimal('suggested_retail_price', 14, 4)->nullable();
            $t->decimal('min_qty', 14, 3)->default(0);
            $t->decimal('max_qty', 14, 3);
            $t->boolean('active')->default(true);
            $this->fechas($t);
            $t->unique(['contract_id', 'variant_id']);
            $t->foreign('contract_id')->references('id')->on('consignment_contracts')->cascadeOnDelete();
            $t->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete();
        });

        Schema::create('consignment_margin_tiers', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('contract_id');
            $t->decimal('from_amount', 14, 2);
            $t->decimal('pct', 5, 2);
            $this->fechas($t);
            $t->unique(['contract_id', 'from_amount']);
            $t->foreign('contract_id')->references('id')->on('consignment_contracts')->cascadeOnDelete();
        });

        Schema::create('consignment_targets', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('point_id');
            $t->date('period');   // primer día del mes
            $t->decimal('target_amount', 14, 2);
            $this->fechas($t);
            $t->unique(['point_id', 'period']);
            $t->foreign('point_id')->references('id')->on('consignment_points')->restrictOnDelete();
        });

        Schema::create('consignment_equipment_loans', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('point_id');
            $t->string('equipment_type', 20);
            $t->string('asset_code', 40);
            $t->string('serial_number', 100)->nullable();
            $t->string('description', 255);
            $t->decimal('asset_value', 14, 2)->default(0);
            $t->string('loan_agreement_url', 500);
            $t->date('delivered_on');
            $t->date('returned_on')->nullable();
            $t->date('last_check_on')->nullable();
            $t->decimal('last_temp_c', 6, 2)->nullable();
            $t->string('status', 20)->default('LOANED');
            $t->string('status_reason', 255)->nullable();
            $this->fechas($t);
            $t->unique(['tenant_id', 'asset_code']);
            $t->foreign('point_id')->references('id')->on('consignment_points')->restrictOnDelete();
        });

        Schema::create('consignment_visits', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('point_id');
            $t->uuid('visitor_user_id')->nullable();
            $t->date('planned_date');
            $t->string('status', 20)->default('PLANNED');
            $t->timestampTz('started_at')->nullable();
            $t->timestampTz('finished_at')->nullable();
            $t->decimal('checkin_lat', 10, 7)->nullable();
            $t->decimal('checkin_lng', 10, 7)->nullable();
            $t->decimal('checkin_distance_m', 10, 1)->nullable();
            $t->string('checkin_reason', 255)->nullable();
            $t->string('offline_uuid', 100)->nullable()->unique();   // la app sin conexión no duplica la visita
            $t->jsonb('draft')->nullable();   // conteo en curso desde la app
            $t->date('sale_date')->nullable();
            $t->decimal('visit_cost', 14, 2)->nullable();
            $t->string('miss_reason', 255)->nullable();
            $t->date('rescheduled_from')->nullable();
            $t->string('reschedule_reason', 255)->nullable();
            $t->boolean('urgent')->default(false);   // retiro de un lote del mercado (lot.recalled)
            $t->text('notes')->nullable();
            $this->fechas($t);
            $t->index(['visitor_user_id', 'planned_date']);
            $t->foreign('point_id')->references('id')->on('consignment_points')->restrictOnDelete();
            $t->foreign('visitor_user_id')->references('id')->on('users')->restrictOnDelete();
        });
        DB::statement("CREATE UNIQUE INDEX consignment_visits_una_por_dia ON consignment_visits (point_id, planned_date) WHERE status IN ('PLANNED', 'IN_PROGRESS', 'DONE')");

        Schema::create('consignment_deliveries', function (Blueprint $t) {
            $this->base($t);
            $t->string('number', 20);
            $t->uuid('point_id');
            $t->uuid('contract_id');
            $t->date('delivery_date');
            $t->uuid('from_warehouse_id');
            $t->uuid('visit_id')->nullable();
            $t->string('status', 20)->default('DRAFT');
            $t->string('override_max_reason', 255)->nullable();
            $t->string('void_reason', 255)->nullable();
            $t->uuid('dispatch_guide_id')->nullable();
            $t->string('gre_series', 10)->nullable();
            $t->integer('gre_number')->nullable();
            $t->string('gre_transfer_reason', 4)->nullable();
            $t->timestampTz('dispatched_at')->nullable();
            $t->uuid('dispatched_by')->nullable();
            $t->string('received_by_name', 255)->nullable();
            $t->uuid('created_by')->nullable();
            $this->fechas($t);
            $t->unique(['tenant_id', 'number']);
            $t->index(['point_id', 'status']);
            $t->foreign('point_id')->references('id')->on('consignment_points')->restrictOnDelete();
            $t->foreign('contract_id')->references('id')->on('consignment_contracts')->restrictOnDelete();
            $t->foreign('from_warehouse_id')->references('id')->on('warehouses')->restrictOnDelete();
            $t->foreign('visit_id')->references('id')->on('consignment_visits')->restrictOnDelete();
            $t->foreign('dispatch_guide_id')->references('id')->on('dispatch_guides')->restrictOnDelete();
            $t->foreign('dispatched_by')->references('id')->on('users')->restrictOnDelete();
            $t->foreign('created_by')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('consignment_delivery_lines', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('delivery_id');
            $t->uuid('variant_id');
            $t->uuid('lot_id');
            $t->uuid('warehouse_id');
            $t->decimal('qty', 14, 3);
            $t->decimal('weight_kg', 14, 3)->nullable();
            $t->decimal('unit_price', 14, 4);
            $t->date('expiry_date');
            $this->fechas($t);
            $t->index('delivery_id');
            $t->foreign('delivery_id')->references('id')->on('consignment_deliveries')->cascadeOnDelete();
            $t->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete();
            $t->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete();
            $t->foreign('warehouse_id')->references('id')->on('warehouses')->restrictOnDelete();
        });

        Schema::create('consignment_register', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('point_id');
            $t->string('entry_type', 20);
            $t->date('entry_date');
            $t->uuid('variant_id');
            $t->uuid('lot_id')->nullable();
            $t->decimal('qty', 14, 3);
            $t->decimal('unit_price', 14, 4)->default(0);
            $t->decimal('amount', 14, 2)->default(0);
            $t->string('gre_series', 10)->nullable();
            $t->integer('gre_number')->nullable();
            $t->uuid('sales_document_id')->nullable();
            $t->string('source_type', 40);
            $t->uuid('source_id')->nullable();   // entrega, línea de conteo o asiento reversado
            $t->uuid('reversal_of')->nullable()->unique();
            $t->string('reason', 255)->nullable();
            $t->uuid('created_by')->nullable();
            $t->timestampTz('created_at')->useCurrent();
            $t->index(['point_id', 'entry_date']);
            $t->foreign('point_id')->references('id')->on('consignment_points')->restrictOnDelete();
            $t->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete();
            $t->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete();
            $t->foreign('sales_document_id')->references('id')->on('sales_documents')->restrictOnDelete();
            $t->foreign('created_by')->references('id')->on('users')->restrictOnDelete();
        });
        Schema::table('consignment_register', function (Blueprint $t) {   // referencia a la misma tabla, después de su clave
                $t->foreign('reversal_of')->references('id')->on('consignment_register')->restrictOnDelete();
        });

        Schema::create('consignment_visit_counts', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('visit_id');
            $t->uuid('point_id');
            $t->uuid('variant_id');
            $t->uuid('lot_id')->nullable();
            foreach (['opening_qty', 'delivered_qty', 'counted_qty', 'returned_qty', 'expired_qty', 'surplus_qty', 'sold_qty'] as $c) {
                $t->decimal($c, 14, 3)->default(0);
            }
            $t->string('surplus_reason', 255)->nullable();
            $t->string('return_reason', 255)->nullable();
            $t->date('sale_date')->nullable();
            $t->decimal('unit_price', 14, 4)->default(0);
            $t->decimal('suggested_qty', 14, 3)->nullable();
            $t->decimal('restock_qty', 14, 3)->nullable();
            $t->string('suggested_override_reason', 255)->nullable();
            $t->boolean('settled')->default(false);
            $this->fechas($t);
            $t->index(['point_id', 'settled']);
            $t->foreign('visit_id')->references('id')->on('consignment_visits')->restrictOnDelete();
            $t->foreign('point_id')->references('id')->on('consignment_points')->restrictOnDelete();
            $t->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete();
            $t->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete();
        });
        DB::statement("CREATE UNIQUE INDEX consignment_visit_counts_unico ON consignment_visit_counts (visit_id, variant_id, COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid))");

        Schema::create('consignment_visit_photos', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('visit_id');
            $t->string('kind', 20);
            $t->string('photo_url', 500);
            $t->uuid('equipment_loan_id')->nullable();
            $t->decimal('temp_c', 6, 2)->nullable();
            $t->timestampTz('taken_at')->useCurrent();
            $t->decimal('lat', 10, 7)->nullable();
            $t->decimal('lng', 10, 7)->nullable();
            $this->fechas($t);
            $t->index('visit_id');
            $t->foreign('visit_id')->references('id')->on('consignment_visits')->cascadeOnDelete();
            $t->foreign('equipment_loan_id')->references('id')->on('consignment_equipment_loans')->restrictOnDelete();
        });

        Schema::create('consignment_settlements', function (Blueprint $t) {
            $this->base($t);
            $t->string('number', 20);
            $t->uuid('point_id');
            $t->uuid('contract_id');
            $t->date('period_from');
            $t->date('period_to');
            $t->date('first_sale_date');
            $t->date('due_date');
            $t->decimal('gross_amount', 14, 2);
            $t->decimal('commission_pct', 5, 2)->default(0);
            $t->decimal('commission_amount', 14, 2)->default(0);
            $t->decimal('net_amount', 14, 2);
            $t->string('status', 20)->default('DRAFT');
            $t->uuid('approved_by')->nullable();
            $t->timestampTz('approved_at')->nullable();
            $t->uuid('sales_document_id')->nullable();
            $t->string('invoice_number', 30)->nullable();      // serie-número mientras FAC no enlace el comprobante
            $t->date('invoiced_on')->nullable();
            $t->uuid('credit_note_id')->nullable();
            $t->string('credit_note_number', 30)->nullable();
            $t->string('void_reason', 255)->nullable();
            $t->timestampTz('voided_at')->nullable();
            $this->fechas($t);
            $t->unique(['tenant_id', 'number']);
            $t->index(['point_id', 'status']);
            $t->foreign('point_id')->references('id')->on('consignment_points')->restrictOnDelete();
            $t->foreign('contract_id')->references('id')->on('consignment_contracts')->restrictOnDelete();
            $t->foreign('approved_by')->references('id')->on('users')->restrictOnDelete();
            $t->foreign('sales_document_id')->references('id')->on('sales_documents')->restrictOnDelete();
            $t->foreign('credit_note_id')->references('id')->on('sales_documents')->restrictOnDelete();
        });

        Schema::create('consignment_settlement_lines', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('settlement_id');
            $t->uuid('visit_count_id');
            $t->uuid('variant_id');
            $t->uuid('lot_id')->nullable();
            $t->date('sale_date');
            $t->decimal('qty', 14, 3);
            $t->decimal('unit_price', 14, 4);
            $t->decimal('amount', 14, 2);
            $this->fechas($t);
            $t->index('settlement_id');
            $t->foreign('settlement_id')->references('id')->on('consignment_settlements')->cascadeOnDelete();
            $t->foreign('visit_count_id')->references('id')->on('consignment_visit_counts')->restrictOnDelete();
            $t->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete();
            $t->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete();
        });

        foreach (self::ESTADOS as [$tabla, $col, $valores]) {
            $lista = implode(',', array_map(fn ($v) => "'{$v}'", $valores));
            DB::statement("ALTER TABLE {$tabla} ADD CONSTRAINT {$tabla}_{$col}_valido CHECK ({$col} IN ({$lista}))");
        }
        DB::statement('ALTER TABLE consignment_points ADD CONSTRAINT consignment_points_frecuencia CHECK (visit_frequency_days >= 1 AND (closed_on IS NULL OR closed_on >= opened_on))');
        DB::statement(<<<'SQL'
            ALTER TABLE consignment_contracts ADD CONSTRAINT consignment_contracts_valores CHECK (
                (valid_to IS NULL OR valid_to >= valid_from)
                AND (compensation_type <> 'COMMISSION' OR commission_pct BETWEEN 0 AND 100)
            )
            SQL);
        DB::statement(<<<'SQL'
            ALTER TABLE consignment_contracts ADD CONSTRAINT consignment_contracts_sin_traslape EXCLUDE USING gist (
                tenant_id WITH =, point_id WITH =,
                daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[]') WITH &&
            ) WHERE (status = 'ACTIVE')
            SQL);
        DB::statement('ALTER TABLE consignment_contract_products ADD CONSTRAINT ccp_cantidades CHECK (consignor_price > 0 AND min_qty >= 0 AND max_qty >= min_qty)');
        DB::statement('ALTER TABLE consignment_margin_tiers ADD CONSTRAINT cmt_valores CHECK (from_amount >= 0 AND pct BETWEEN 0 AND 100)');
        DB::statement("ALTER TABLE consignment_equipment_loans ADD CONSTRAINT cel_baja_con_motivo CHECK (status <> 'WRITTEN_OFF' OR status_reason IS NOT NULL)");
        DB::statement("ALTER TABLE consignment_deliveries ADD CONSTRAINT consignment_deliveries_gre CHECK (status <> 'DISPATCHED' OR (gre_series IS NOT NULL AND gre_number IS NOT NULL))");
        DB::statement('ALTER TABLE consignment_delivery_lines ADD CONSTRAINT cdl_qty CHECK (qty > 0)');
        DB::statement(<<<'SQL'
            ALTER TABLE consignment_visit_counts ADD CONSTRAINT cvc_vendido CHECK (
                sold_qty >= 0 AND surplus_qty >= 0 AND counted_qty >= 0 AND returned_qty >= 0 AND expired_qty >= 0
                AND sold_qty - surplus_qty = opening_qty + delivered_qty - counted_qty - returned_qty - expired_qty
            )
            SQL);
        DB::statement("ALTER TABLE consignment_visit_photos ADD CONSTRAINT cvp_equipo_con_temperatura CHECK (kind <> 'EQUIPMENT' OR temp_c IS NOT NULL)");
        DB::statement(<<<'SQL'
            ALTER TABLE consignment_settlements ADD CONSTRAINT consignment_settlements_valores CHECK (
                net_amount = gross_amount - commission_amount
                AND (status <> 'INVOICED' OR (invoiced_on IS NOT NULL AND (sales_document_id IS NOT NULL OR invoice_number IS NOT NULL)))
                AND (status <> 'VOIDED' OR invoiced_on IS NULL OR credit_note_id IS NOT NULL OR credit_note_number IS NOT NULL)
            )
            SQL);

        // RN-CON-16: fecha + n días hábiles (sin sábados, domingos ni feriados de la empresa).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION add_business_days(p_from date, p_days int) RETURNS date
            LANGUAGE plpgsql STABLE AS $$
            DECLARE d date := p_from; n int := 0;
            BEGIN
                WHILE n < p_days LOOP
                    d := d + 1;
                    IF EXTRACT(ISODOW FROM d) < 6
                       AND NOT EXISTS (SELECT 1 FROM calendar_holidays h WHERE h.holiday_date = d AND h.establishment_id IS NULL) THEN
                        n := n + 1;
                    END IF;
                END LOOP;
                RETURN d;
            END $$;
            SQL);

        foreach (self::TABLAS as $tabla) {
            DB::statement("SELECT enable_tenant_rls('{$tabla}')");
            if ($tabla !== 'consignment_register') {
                DB::statement("SELECT audit.track('{$tabla}')");
            }
        }
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON consignment_register FROM aycha_app');   // RN-CON-09
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS add_business_days(date, int)');
        foreach (array_reverse(self::TABLAS) as $tabla) {
            DB::statement("DROP TABLE IF EXISTS {$tabla} CASCADE");
        }
    }

    private function base(Blueprint $t): void
    {
        $t->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
        $t->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
        $t->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
        $t->index('tenant_id');
    }

    private function fechas(Blueprint $t): void
    {
        $t->timestampTz('created_at')->useCurrent();
        $t->timestampTz('updated_at')->nullable();
    }
};
