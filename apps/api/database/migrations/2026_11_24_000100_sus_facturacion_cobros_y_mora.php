<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// SUS · cobro del SaaS: SUS-12 Facturación, SUS-13 Cobros y conciliación y SUS-14 Mora (consola).
//  - Series de Intelectalab (RN-SUS-12): la empresa no las ve; el correlativo se asigna al emitir, sin saltos.
//  - Comprobantes del SaaS (RN-SUS-11): total = subtotal + IGV; al emitir, las líneas cuadran con la cabecera; emitido
//    no cambia importes, cliente, período ni número y no admite líneas nuevas (lo impide la base): se corrige con nota
//    de crédito. La empresa verá los suyos (SUS-05, tanda 9b).
//  - Medio de pago (RN-SUS-20): solo el token y el cliente de la pasarela, nunca la tarjeta.
//  - Cobros (RN-SUS-13): uno solo por referencia de la pasarela. Eventos crudos de la pasarela, una vez por id.
//  - Mora: prórrogas y recordatorios; subscriptions.grace_until pospone el paso a solo lectura o suspensión.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('platform_document_series', function (Blueprint $table) {
            $table->string('code', 4)->primary();
            $table->string('doc_type', 12);
            $table->string('applies_to', 8)->nullable();
            $table->unsignedInteger('next_number')->default(1);
            $table->boolean('active')->default(true);
            $table->timestampTz('updated_at')->nullable();
        });
        DB::statement("ALTER TABLE platform_document_series ADD CONSTRAINT platform_document_series_tipo CHECK (doc_type IN ('INVOICE','RECEIPT','CREDIT_NOTE'))");
        DB::table('platform_document_series')->insert([
            ['code' => 'F001', 'doc_type' => 'INVOICE', 'applies_to' => null], ['code' => 'B001', 'doc_type' => 'RECEIPT', 'applies_to' => null],
            ['code' => 'FC01', 'doc_type' => 'CREDIT_NOTE', 'applies_to' => 'INVOICE'], ['code' => 'BC01', 'doc_type' => 'CREDIT_NOTE', 'applies_to' => 'RECEIPT'],
        ]);

        Schema::create('saas_billing_runs', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->string('period', 7);
            $table->unsignedSmallInteger('run_no');
            $table->unsignedInteger('drafts')->default(0);
            $table->unsignedInteger('issued')->default(0);
            $table->unsignedInteger('charged')->default(0);
            $table->decimal('total', 12, 2)->default(0);
            $table->jsonb('notes')->default('[]');
            $table->uuid('created_by')->nullable();
            $table->string('created_by_name', 120);
            $table->timestampTz('created_at')->useCurrent();
            $table->unique(['period', 'run_no']);
        });

        Schema::create('saas_invoices', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('tenant_id');
            $table->uuid('subscription_id')->nullable();
            $table->uuid('run_id')->nullable();
            $table->string('doc_type', 12);
            $table->string('series_code', 4)->nullable();
            $table->string('number', 16)->nullable();
            $table->string('status', 10)->default('DRAFT');
            $table->string('payment_status', 10)->default('UNPAID');
            $table->string('sunat_status', 12)->default('NOT_SENT');
            $table->string('period', 7)->nullable();
            $table->date('period_start')->nullable();
            $table->date('period_end')->nullable();
            $table->date('issue_date')->nullable();
            $table->date('due_date')->nullable();
            $table->string('customer_doc_type', 3);
            $table->string('customer_doc_number', 11);
            $table->string('customer_name', 200);
            $table->string('customer_address', 300)->nullable();
            $table->string('issuer_ruc', 11)->nullable();
            $table->string('currency', 3)->default('PEN');
            $table->decimal('subtotal', 12, 2);
            $table->decimal('igv', 12, 2);
            $table->decimal('total', 12, 2);
            $table->decimal('igv_rate', 5, 4);
            $table->uuid('credit_note_for')->nullable();
            $table->string('reason', 300)->nullable();
            $table->string('kind', 12)->default('PERIOD');
            $table->timestampTz('paid_at')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('subscription_id')->references('id')->on('subscriptions')->nullOnDelete();
            $table->foreign('run_id')->references('id')->on('saas_billing_runs')->nullOnDelete();
            $table->foreign('series_code')->references('code')->on('platform_document_series');
            $table->unique('number');
            $table->index(['tenant_id', 'status']);
            $table->index(['payment_status', 'due_date']);
        });
        Schema::table('saas_invoices', function (Blueprint $table) {
            $table->foreign('credit_note_for')->references('id')->on('saas_invoices')->restrictOnDelete();
        });
        foreach ([
            "doc_type IN ('INVOICE','RECEIPT','CREDIT_NOTE')", "status IN ('DRAFT','ISSUED')", "payment_status IN ('UNPAID','PAID','CREDITED','NA')",
            "sunat_status IN ('NOT_SENT','PENDING','ACCEPTED','REJECTED')", "customer_doc_type IN ('RUC','DNI')", 'total = subtotal + igv',
            'subtotal >= 0 AND igv >= 0', "status <> 'ISSUED' OR (number IS NOT NULL AND issue_date IS NOT NULL)",
            "(doc_type = 'CREDIT_NOTE') = (credit_note_for IS NOT NULL)", "kind IN ('PERIOD','PRORATION','OTHER')",
        ] as $i => $check) {
            DB::statement("ALTER TABLE saas_invoices ADD CONSTRAINT saas_invoices_regla_{$i} CHECK ({$check})");
        }
        // Una sola factura del período por suscripción (la corrida no duplica).
        DB::statement("CREATE UNIQUE INDEX saas_invoices_un_periodo ON saas_invoices (subscription_id, period) WHERE kind = 'PERIOD' AND doc_type <> 'CREDIT_NOTE'");

        Schema::create('saas_invoice_lines', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('invoice_id');
            $table->uuid('tenant_id');
            $table->unsignedSmallInteger('sort')->default(1);
            $table->string('description', 200);
            $table->decimal('quantity', 10, 2)->default(1);
            $table->decimal('unit_price', 12, 2);
            $table->decimal('subtotal', 12, 2);
            $table->decimal('igv', 12, 2);
            $table->decimal('total', 12, 2);
            $table->foreign('invoice_id')->references('id')->on('saas_invoices')->cascadeOnDelete();
            $table->index('invoice_id');
        });
        DB::statement('ALTER TABLE saas_invoice_lines ADD CONSTRAINT saas_invoice_lines_total CHECK (total = subtotal + igv)');

        // RN-SUS-11: emitido no cambia; al emitir las líneas cuadran; solo un borrador se borra o recibe líneas.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION saas_invoice_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE s numeric; i numeric; t numeric;
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Un comprobante emitido no se borra' USING ERRCODE = '23514'; END IF;
                    RETURN OLD;
                END IF;
                IF OLD.status <> 'DRAFT' THEN
                    IF NEW.status = 'DRAFT' OR NEW.subtotal IS DISTINCT FROM OLD.subtotal OR NEW.igv IS DISTINCT FROM OLD.igv OR NEW.total IS DISTINCT FROM OLD.total
                       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.customer_doc_type IS DISTINCT FROM OLD.customer_doc_type
                       OR NEW.customer_doc_number IS DISTINCT FROM OLD.customer_doc_number OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
                       OR NEW.period_start IS DISTINCT FROM OLD.period_start OR NEW.period_end IS DISTINCT FROM OLD.period_end
                       OR NEW.number IS DISTINCT FROM OLD.number OR NEW.series_code IS DISTINCT FROM OLD.series_code OR NEW.doc_type IS DISTINCT FROM OLD.doc_type
                       OR NEW.issue_date IS DISTINCT FROM OLD.issue_date OR NEW.credit_note_for IS DISTINCT FROM OLD.credit_note_for THEN
                        RAISE EXCEPTION 'Un comprobante emitido no cambia: se corrige con nota de crédito' USING ERRCODE = '23514';
                    END IF;
                ELSIF NEW.status = 'ISSUED' THEN
                    SELECT coalesce(sum(subtotal), 0), coalesce(sum(igv), 0), coalesce(sum(total), 0) INTO s, i, t FROM saas_invoice_lines WHERE invoice_id = NEW.id;
                    IF s <> NEW.subtotal OR i <> NEW.igv OR t <> NEW.total THEN
                        RAISE EXCEPTION 'Las líneas no cuadran con la cabecera del comprobante' USING ERRCODE = '23514';
                    END IF;
                END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER saas_invoice_inmutable BEFORE UPDATE OR DELETE ON saas_invoices FOR EACH ROW EXECUTE FUNCTION saas_invoice_inmutable();

            CREATE OR REPLACE FUNCTION saas_invoice_line_borrador() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF (SELECT status FROM saas_invoices WHERE id = coalesce(NEW.invoice_id, OLD.invoice_id)) <> 'DRAFT' THEN
                    RAISE EXCEPTION 'Un comprobante emitido no admite cambios en sus líneas' USING ERRCODE = '23514';
                END IF;
                RETURN coalesce(NEW, OLD);
            END $$;
            CREATE TRIGGER saas_invoice_line_borrador BEFORE INSERT OR UPDATE OR DELETE ON saas_invoice_lines FOR EACH ROW EXECUTE FUNCTION saas_invoice_line_borrador();
            SQL);

        Schema::create('saas_payment_methods', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('tenant_id');
            $table->string('gateway', 12);
            $table->string('token', 120);
            $table->string('gateway_customer', 120)->nullable();
            $table->string('brand', 20);
            $table->string('last4', 4);
            $table->unsignedSmallInteger('exp_month');
            $table->unsignedSmallInteger('exp_year');
            $table->boolean('auto_pay')->default(true);
            $table->string('billing_email', 160)->nullable();
            $table->boolean('active')->default(true);
            $table->timestampsTz();
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
        });
        DB::statement("ALTER TABLE saas_payment_methods ADD CONSTRAINT saas_payment_methods_ultimos CHECK (last4 ~ '^[0-9]{4}$')");
        DB::statement('CREATE UNIQUE INDEX saas_payment_methods_un_activo ON saas_payment_methods (tenant_id) WHERE active');

        Schema::create('saas_settlements', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->string('gateway', 12);
            $table->string('reference', 80);
            $table->date('settled_on');
            $table->decimal('gross', 12, 2);
            $table->decimal('amount', 12, 2);
            $table->decimal('fee', 12, 2);
            $table->string('created_by_name', 120);
            $table->timestampTz('created_at')->useCurrent();
            $table->unique(['gateway', 'reference']);
        });
        DB::statement('ALTER TABLE saas_settlements ADD CONSTRAINT saas_settlements_montos CHECK (amount > 0 AND fee >= 0 AND gross = amount + fee)');

        Schema::create('saas_payments', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('tenant_id');
            $table->uuid('invoice_id');
            $table->uuid('payment_method_id')->nullable();
            $table->string('gateway', 12);
            $table->string('gateway_ref', 80);
            $table->decimal('amount', 12, 2);
            $table->string('status', 10)->default('PENDING');
            $table->string('origin', 10);
            $table->string('error', 200)->nullable();
            $table->jsonb('raw_event')->nullable();
            $table->timestampTz('confirmed_at')->nullable();
            $table->uuid('settlement_id')->nullable();
            $table->timestampsTz();
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('invoice_id')->references('id')->on('saas_invoices')->restrictOnDelete();
            $table->foreign('payment_method_id')->references('id')->on('saas_payment_methods')->nullOnDelete();
            $table->foreign('settlement_id')->references('id')->on('saas_settlements')->nullOnDelete();
            $table->unique(['gateway', 'gateway_ref']);   // RN-SUS-13
            $table->index(['invoice_id', 'status']);
        });
        DB::statement("ALTER TABLE saas_payments ADD CONSTRAINT saas_payments_estado CHECK (status IN ('PENDING','APPROVED','DECLINED'))");
        DB::statement("ALTER TABLE saas_payments ADD CONSTRAINT saas_payments_origen CHECK (origin IN ('AUTO','RETRY','CONSOLE','CUSTOMER'))");
        DB::statement('ALTER TABLE saas_payments ADD CONSTRAINT saas_payments_monto CHECK (amount > 0)');

        Schema::create('saas_gateway_events', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('gateway', 12);
            $table->string('event_id', 80);
            $table->string('type', 40);
            $table->boolean('signature_ok');
            $table->jsonb('payload');
            $table->string('result', 120)->nullable();
            $table->timestampTz('received_at')->useCurrent();
            $table->index(['gateway', 'event_id']);
        });

        Schema::create('saas_dunning_actions', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('subscription_id');
            $table->uuid('tenant_id');
            $table->string('kind', 12);
            $table->date('until')->nullable();
            $table->string('reason', 300)->nullable();
            $table->string('actor_name', 120);
            $table->timestampTz('at')->useCurrent();
            $table->foreign('subscription_id')->references('id')->on('subscriptions')->cascadeOnDelete();
            $table->index(['subscription_id', 'at']);
        });
        DB::statement("ALTER TABLE saas_dunning_actions ADD CONSTRAINT saas_dunning_actions_tipo CHECK (kind IN ('REMINDER','EXTENSION','RETRY'))");

        Schema::table('subscriptions', function (Blueprint $table) {
            $table->date('grace_until')->nullable();
        });

        // La empresa ve sus comprobantes, líneas, cobros y medio de pago; lo demás, solo la consola.
        foreach (['saas_invoices', 'saas_invoice_lines', 'saas_payments', 'saas_payment_methods'] as $t) {
            DB::statement("ALTER TABLE {$t} ENABLE ROW LEVEL SECURITY");
            DB::statement("CREATE POLICY tenant_isolation ON {$t} USING (tenant_id = app_tenant_id() OR app_is_platform()) WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform())");
        }
        foreach (['platform_document_series', 'saas_billing_runs', 'saas_settlements', 'saas_gateway_events', 'saas_dunning_actions'] as $t) {
            DB::statement("ALTER TABLE {$t} ENABLE ROW LEVEL SECURITY");
            DB::statement("CREATE POLICY solo_consola ON {$t} USING (app_is_platform()) WITH CHECK (app_is_platform())");
        }
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON saas_gateway_events, saas_dunning_actions FROM aycha_app');

        // La mora suspende o reactiva sola: la base solo lo permite si coincide con el estado de la suscripción.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION platform_dunning_tenant_status(p_tenant uuid) RETURNS text
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
            DECLARE e text;
            BEGIN
                SELECT status INTO e FROM subscriptions WHERE tenant_id = p_tenant AND status <> 'CANCELLED' ORDER BY started_at DESC LIMIT 1;
                IF e IS NULL THEN RETURN NULL; END IF;
                UPDATE tenants SET status = CASE WHEN e = 'SUSPENDED' THEN 'SUSPENDED' ELSE 'ACTIVE' END, updated_at = now()
                 WHERE id = p_tenant AND status IN ('ACTIVE','SUSPENDED');
                RETURN e;
            END $$;
            REVOKE ALL ON FUNCTION platform_dunning_tenant_status(uuid) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform_dunning_tenant_status(uuid) TO aycha_app;
            SQL);

        foreach ([
            'sus_invoice_due_days' => [5, 'Días para pagar un comprobante del SaaS'],
            'sus_payment_retry_days' => [[1, 3, 5], 'Días de mora en que se reintenta el cobro'],
            'sus_grace_days' => [7, 'Días de mora antes de pasar a solo lectura'],
            'sus_read_only_days' => [15, 'Días en solo lectura antes de suspender'],
            'sus_igv_rate' => [0.18, 'IGV del comprobante del SaaS'],
            'sus_issuer_ruc' => ['', 'RUC con el que factura Intelectalab (vacío: la corrida de cobro no emite)'],
            'sus_issuer_name' => ['', 'Razón social con la que factura Intelectalab'],
            'sus_gateway' => ['FAKE', 'Pasarela de cobro (FAKE mientras no se elija una real)'],
            'sus_max_extension_days' => [15, 'Días máximos de una prórroga de mora'],
        ] as $key => [$valor, $descripcion]) {
            DB::table('platform_parameters')->insertOrIgnore(['key' => $key, 'value' => json_encode($valor), 'description' => $descripcion, 'updated_at' => now()]);
        }
    }

    public function down(): void
    {
        DB::table('platform_parameters')->whereIn('key', ['sus_invoice_due_days', 'sus_payment_retry_days', 'sus_grace_days', 'sus_read_only_days', 'sus_igv_rate',
            'sus_issuer_ruc', 'sus_issuer_name', 'sus_gateway', 'sus_max_extension_days'])->delete();
        DB::unprepared('DROP FUNCTION IF EXISTS platform_dunning_tenant_status(uuid)');
        Schema::table('subscriptions', fn (Blueprint $t) => $t->dropColumn('grace_until'));
        foreach (['saas_dunning_actions', 'saas_gateway_events', 'saas_payments', 'saas_settlements', 'saas_payment_methods', 'saas_invoice_lines', 'saas_invoices', 'saas_billing_runs', 'platform_document_series'] as $t) {
            Schema::dropIfExists($t);
        }
        DB::unprepared('DROP FUNCTION IF EXISTS saas_invoice_inmutable() CASCADE; DROP FUNCTION IF EXISTS saas_invoice_line_borrador() CASCADE;');
    }
};
