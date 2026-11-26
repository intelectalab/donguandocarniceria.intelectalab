<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// B2B · Clientes empresariales: crédito, precios por cliente, pedidos recurrentes, portal, reclamos y
// cobranza. Tablas escritas a mano (el generador no reconoce los nombres con dígitos y dejaba tipos
// de texto en fechas y cantidades). Decisiones: docs/cambios/2026-11-24_canales-con-b2b-cmp.md.
//
//  - RN-B2B-06: los precios de un cliente para una presentación no se traslapan (EXCLUDE con gist);
//    un precio por aprobar ya ocupa la vigencia que pidió.
//  - RN-B2B-05: quien aprueba una excepción es otra persona (CHECK).
//  - RN-B2B-08: trigger en sales_documents que completa el vencimiento de un comprobante a crédito
//    con el plazo de la ficha y rechaza un vencimiento anterior a la emisión.
//  - RN-B2B-09: una sola corrida por programación y fecha de entrega (UNIQUE).
//  - RN-B2B-16: un recordatorio por comprobante y tipo (UNIQUE).
//  - RN-B2B-17: un reclamo de calidad o de peso trae foto; resuelto con abono, trae la nota (CHECK).
return new class extends Migration
{
    private const ESTADOS = [
        ['customer_credit_profiles', 'status', ['ACTIVE', 'BLOCKED', 'SUSPENDED']],
        ['credit_exceptions', 'kind', ['OVER_LIMIT', 'OVERDUE']],
        ['credit_exceptions', 'status', ['PENDING', 'APPROVED', 'REJECTED', 'USED', 'EXPIRED']],
        ['customer_prices', 'price_basis', ['UNIT', 'KG']],
        ['customer_prices', 'status', ['PENDING_APPROVAL', 'ACTIVE', 'REJECTED']],
        ['recurring_orders', 'frequency', ['WEEKLY', 'EVERY_N_DAYS']],
        ['recurring_orders', 'requested_doc_type', ['INVOICE', 'RECEIPT']],
        ['recurring_orders', 'status', ['ACTIVE', 'PAUSED', 'ENDED']],
        ['recurring_order_runs', 'status', ['CREATED', 'CONFIRMED', 'SKIPPED', 'BLOCKED_CREDIT', 'FAILED']],
        ['b2b_portal_accounts', 'portal_role', ['OWNER', 'BUYER', 'ACCOUNTING']],
        ['b2b_portal_accounts', 'status', ['INVITED', 'ACTIVE', 'DISABLED']],
        ['b2b_claims', 'claim_type', ['QUALITY', 'WEIGHT', 'LATE', 'BILLING', 'OTHER']],
        ['b2b_claims', 'status', ['OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED']],
        ['collection_reminders', 'reminder_type', ['BEFORE_DUE', 'DUE_DAY', 'OVERDUE_3', 'OVERDUE_7']],
        ['collection_reminders', 'channel', ['WHATSAPP', 'EMAIL']],
        ['collection_reminders', 'status', ['SCHEDULED', 'SENT', 'CANCELLED', 'FAILED']],
        ['payment_promises', 'status', ['OPEN', 'KEPT', 'BROKEN', 'CANCELLED']],
    ];

    private const TABLAS = [
        'customer_credit_profiles', 'credit_exceptions', 'customer_prices', 'recurring_orders',
        'recurring_order_lines', 'recurring_order_runs', 'b2b_portal_accounts', 'b2b_claims',
        'collection_reminders', 'payment_promises',
    ];

    public function up(): void
    {
        Schema::create('customer_credit_profiles', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('customer_id')->unique();
            $t->decimal('credit_limit', 14, 2);
            $t->integer('term_days');
            $t->integer('grace_days')->default(5);
            $t->boolean('block_on_overdue')->default(true);
            $t->date('review_on')->nullable();
            $t->uuid('seller_user_id')->nullable();
            $t->string('status', 20)->default('ACTIVE');
            $t->boolean('auto_blocked')->default(false);   // bloqueo puesto por la revisión diaria (RN-B2B-03)
            $t->string('blocked_reason', 255)->nullable();
            $t->timestampTz('blocked_at')->nullable();
            $t->string('change_reason', 255)->nullable();
            $t->jsonb('history')->default(DB::raw("'[]'::jsonb"));  // cambios de límite, plazo y estado con motivo
            $this->fechas($t);
            $t->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete();
            $t->foreign('seller_user_id')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('credit_exceptions', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('customer_id');
            $t->uuid('order_id');
            $t->string('kind', 20);
            $t->decimal('order_amount', 14, 2);
            $t->decimal('exceeded_amount', 14, 2)->default(0);
            $t->string('reason', 500);
            $t->uuid('requested_by');
            $t->timestampTz('requested_at')->useCurrent();
            $t->string('status', 20)->default('PENDING');
            $t->uuid('decided_by')->nullable();
            $t->timestampTz('decided_at')->nullable();
            $t->string('decision_note', 500)->nullable();
            $t->timestampTz('valid_until')->nullable();
            $t->timestampTz('used_at')->nullable();
            $this->fechas($t);
            $t->index(['customer_id', 'status']);
            $t->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete();
            $t->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete();
            $t->foreign('requested_by')->references('id')->on('users')->restrictOnDelete();
            $t->foreign('decided_by')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('customer_prices', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('customer_id');
            $t->uuid('variant_id');
            $t->decimal('unit_price', 14, 4);
            $t->string('price_basis', 10);
            $t->date('valid_from');
            $t->date('valid_to')->nullable();
            $t->string('status', 20)->default('ACTIVE');
            $t->decimal('cost_at_request', 14, 4)->nullable();
            $t->decimal('min_price', 14, 4)->nullable();
            $t->string('notes', 500)->nullable();
            $t->uuid('requested_by');
            $t->uuid('below_margin_approved_by')->nullable();
            $t->timestampTz('decided_at')->nullable();
            $t->string('reject_reason', 255)->nullable();
            $this->fechas($t);
            $t->index(['customer_id', 'variant_id']);
            $t->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete();
            $t->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete();
            $t->foreign('requested_by')->references('id')->on('users')->restrictOnDelete();
            $t->foreign('below_margin_approved_by')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('recurring_orders', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('customer_id');
            $t->uuid('brand_id');
            $t->uuid('establishment_id');
            $t->uuid('address_id')->nullable();
            $t->string('name', 255);
            $t->string('frequency', 20);
            $t->jsonb('weekdays')->default(DB::raw("'[]'::jsonb"));  // 1 = lunes … 7 = domingo
            $t->integer('interval_days')->nullable();
            $t->time('slot_from')->nullable();
            $t->time('slot_to')->nullable();
            $t->integer('lead_days')->default(1);
            $t->date('starts_on');
            $t->date('ends_on')->nullable();
            $t->boolean('auto_confirm')->default(false);
            $t->string('requested_doc_type', 20)->default('INVOICE');
            $t->string('status', 20)->default('ACTIVE');
            $t->date('next_delivery_date')->nullable();
            $t->text('notes')->nullable();
            $t->uuid('created_by')->nullable();
            $this->fechas($t);
            $t->index('customer_id');
            $t->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete();
            $t->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete();
            $t->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete();
            $t->foreign('address_id')->references('id')->on('customer_addresses')->restrictOnDelete();
            $t->foreign('created_by')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('recurring_order_lines', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('recurring_order_id');
            $t->uuid('variant_id');
            $t->decimal('qty', 14, 3);
            $t->decimal('est_weight_kg', 14, 3)->nullable();
            $t->string('cut_notes', 255)->nullable();
            $this->fechas($t);
            $t->foreign('recurring_order_id')->references('id')->on('recurring_orders')->cascadeOnDelete();
            $t->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete();
        });

        Schema::create('recurring_order_runs', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('recurring_order_id');
            $t->date('delivery_date');
            $t->timestampTz('run_at');
            $t->uuid('order_id')->nullable();
            $t->string('status', 20);
            $t->text('message')->nullable();
            $this->fechas($t);
            $t->unique(['recurring_order_id', 'delivery_date']);
            $t->foreign('recurring_order_id')->references('id')->on('recurring_orders')->restrictOnDelete();
            $t->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete();
        });

        Schema::create('b2b_portal_accounts', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('customer_id');
            $t->uuid('user_id')->unique();   // un usuario del portal pertenece a un solo cliente (RN-B2B-12)
            $t->string('portal_role', 20);
            $t->boolean('can_order')->default(true);
            $t->boolean('can_view_statement')->default(true);
            $t->uuid('invited_by')->nullable();
            $t->timestampTz('invited_at')->nullable();
            $t->string('status', 20)->default('INVITED');
            $t->timestampTz('disabled_at')->nullable();
            $this->fechas($t);
            $t->index('customer_id');
            $t->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete();
            $t->foreign('user_id')->references('id')->on('users')->restrictOnDelete();
            $t->foreign('invited_by')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('b2b_claims', function (Blueprint $t) {
            $this->base($t);
            $t->string('number', 20);
            $t->uuid('customer_id');
            $t->uuid('order_id')->nullable();
            $t->uuid('document_id')->nullable();
            $t->uuid('portal_account_id')->nullable();
            $t->string('claim_type', 20);
            $t->text('description');
            $t->jsonb('photo_urls')->default(DB::raw("'[]'::jsonb"));
            $t->string('status', 20)->default('OPEN');
            $t->timestampTz('opened_at')->useCurrent();
            $t->uuid('assigned_user_id')->nullable();
            $t->timestampTz('first_response_at')->nullable();
            $t->text('response')->nullable();
            $t->string('resolution', 20)->nullable();
            $t->string('resolution_note', 500)->nullable();
            $t->uuid('credit_note_id')->nullable();
            $t->string('credit_note_number', 30)->nullable();   // serie-número mientras FAC no enlace la nota
            $t->decimal('credit_amount', 14, 2)->nullable();
            $t->uuid('resolved_by')->nullable();
            $t->timestampTz('resolved_at')->nullable();
            $this->fechas($t);
            $t->unique(['tenant_id', 'number']);
            $t->index(['customer_id', 'status']);
            $t->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete();
            $t->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete();
            $t->foreign('document_id')->references('id')->on('sales_documents')->restrictOnDelete();
            $t->foreign('credit_note_id')->references('id')->on('sales_documents')->restrictOnDelete();
            $t->foreign('portal_account_id')->references('id')->on('b2b_portal_accounts')->restrictOnDelete();
            $t->foreign('assigned_user_id')->references('id')->on('users')->restrictOnDelete();
            $t->foreign('resolved_by')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('collection_reminders', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('customer_id');
            $t->uuid('document_id');
            $t->string('reminder_type', 20);
            $t->string('channel', 20)->default('WHATSAPP');
            $t->date('scheduled_for');
            $t->timestampTz('sent_at')->nullable();
            $t->string('template_code', 100);
            $t->string('status', 20)->default('SCHEDULED');
            $this->fechas($t);
            $t->unique(['document_id', 'reminder_type']);
            $t->index(['status', 'scheduled_for']);
            $t->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete();
            $t->foreign('document_id')->references('id')->on('sales_documents')->restrictOnDelete();
        });

        Schema::create('payment_promises', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('customer_id');
            $t->uuid('document_id')->nullable();
            $t->date('promised_date');
            $t->decimal('amount', 14, 2);
            $t->uuid('recorded_by');
            $t->string('status', 20)->default('OPEN');
            $t->string('notes', 500)->nullable();
            $this->fechas($t);
            $t->index(['customer_id', 'status']);
            $t->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete();
            $t->foreign('document_id')->references('id')->on('sales_documents')->restrictOnDelete();
            $t->foreign('recorded_by')->references('id')->on('users')->restrictOnDelete();
        });

        // Pedido creado desde el portal: quién lo hizo (KPI-B2B-04).
        Schema::table('sales_orders', function (Blueprint $t) {
            $t->uuid('portal_account_id')->nullable();
            $t->foreign('portal_account_id')->references('id')->on('b2b_portal_accounts')->restrictOnDelete();
        });

        foreach (self::ESTADOS as [$tabla, $col, $valores]) {
            $lista = implode(',', array_map(fn ($v) => "'{$v}'", $valores));
            DB::statement("ALTER TABLE {$tabla} ADD CONSTRAINT {$tabla}_{$col}_valido CHECK ({$col} IN ({$lista}))");
        }
        DB::statement('ALTER TABLE customer_credit_profiles ADD CONSTRAINT ccp_valores CHECK (credit_limit >= 0 AND term_days BETWEEN 0 AND 180 AND grace_days >= 0)');
        DB::statement('ALTER TABLE credit_exceptions ADD CONSTRAINT credit_exceptions_otra_persona CHECK (decided_by IS NULL OR decided_by <> requested_by)');
        DB::statement('ALTER TABLE customer_prices ADD CONSTRAINT customer_prices_valores CHECK (unit_price > 0 AND (valid_to IS NULL OR valid_to >= valid_from))');
        DB::statement(<<<'SQL'
            ALTER TABLE customer_prices ADD CONSTRAINT customer_prices_sin_traslape EXCLUDE USING gist (
                tenant_id WITH =, customer_id WITH =, variant_id WITH =,
                daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[]') WITH &&
            ) WHERE (status <> 'REJECTED')
            SQL);
        DB::statement(<<<'SQL'
            ALTER TABLE recurring_orders ADD CONSTRAINT recurring_orders_frecuencia CHECK (
                (frequency = 'WEEKLY' AND jsonb_array_length(weekdays) > 0)
                OR (frequency = 'EVERY_N_DAYS' AND interval_days >= 1)
            )
            SQL);
        DB::statement('ALTER TABLE recurring_orders ADD CONSTRAINT recurring_orders_fechas CHECK ((ends_on IS NULL OR ends_on >= starts_on) AND lead_days BETWEEN 0 AND 7)');
        DB::statement('ALTER TABLE recurring_order_lines ADD CONSTRAINT recurring_order_lines_qty CHECK (qty > 0)');
        DB::statement(<<<'SQL'
            ALTER TABLE b2b_claims ADD CONSTRAINT b2b_claims_evidencia CHECK (
                (claim_type NOT IN ('QUALITY', 'WEIGHT') OR jsonb_array_length(photo_urls) >= 1)
                AND (resolution IS NULL OR resolution IN ('CREDIT_NOTE', 'REPLACEMENT', 'NO_ACTION'))
                AND (status <> 'RESOLVED' OR resolution <> 'CREDIT_NOTE' OR credit_note_id IS NOT NULL OR credit_note_number IS NOT NULL)
            )
            SQL);
        DB::statement('ALTER TABLE payment_promises ADD CONSTRAINT payment_promises_monto CHECK (amount > 0)');

        // RN-B2B-08: vencimiento de los comprobantes a crédito de un cliente con ficha.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION b2b_completar_vencimiento() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE plazo int;
            BEGIN
                IF NEW.payment_terms = 'CREDIT' AND NEW.doc_type IN ('INVOICE', 'RECEIPT') THEN
                    IF NEW.due_date IS NULL THEN
                        SELECT term_days INTO plazo FROM customer_credit_profiles
                         WHERE customer_id = NEW.customer_id AND tenant_id = NEW.tenant_id;
                        IF plazo IS NOT NULL THEN
                            NEW.due_date := NEW.issue_date + plazo;
                        END IF;
                    END IF;
                    IF NEW.due_date IS NOT NULL AND NEW.due_date < NEW.issue_date THEN
                        RAISE EXCEPTION 'El vencimiento no puede ser anterior a la emisión' USING ERRCODE = '23514';
                    END IF;
                END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER b2b_vencimiento BEFORE INSERT OR UPDATE OF due_date, payment_terms ON sales_documents
                FOR EACH ROW EXECUTE FUNCTION b2b_completar_vencimiento();
            SQL);

        // Días de mora del comprobante a crédito más antiguo con saldo (RN-B2B-03, RN-CON-22).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION customer_overdue_days(p_customer uuid, p_today date DEFAULT CURRENT_DATE)
            RETURNS int LANGUAGE sql STABLE AS $$
                SELECT COALESCE(MAX(p_today - d.due_date), 0)::int
                  FROM sales_documents d
                 WHERE d.customer_id = p_customer AND d.payment_terms = 'CREDIT' AND d.status = 'ISSUED'
                   AND d.balance > 0 AND d.due_date IS NOT NULL AND d.due_date < p_today
            $$;
            CREATE OR REPLACE VIEW b2b_receivables_v WITH (security_invoker = true) AS
                SELECT d.tenant_id, d.id AS document_id, d.customer_id, d.brand_id, d.seller_id, d.doc_type,
                       d.full_number, d.issue_date, d.due_date, d.total, d.balance,
                       (CURRENT_DATE - d.due_date) AS days_overdue
                  FROM sales_documents d
                 WHERE d.payment_terms = 'CREDIT' AND d.status = 'ISSUED' AND d.balance > 0;
            SQL);

        foreach (self::TABLAS as $tabla) {
            DB::statement("SELECT enable_tenant_rls('{$tabla}')");
            DB::statement("SELECT audit.track('{$tabla}')");
        }
    }

    public function down(): void
    {
        DB::unprepared('DROP VIEW IF EXISTS b2b_receivables_v; DROP FUNCTION IF EXISTS customer_overdue_days(uuid, date);');
        DB::unprepared('DROP TRIGGER IF EXISTS b2b_vencimiento ON sales_documents; DROP FUNCTION IF EXISTS b2b_completar_vencimiento();');
        Schema::table('sales_orders', fn (Blueprint $t) => $t->dropConstrainedForeignId('portal_account_id'));
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
