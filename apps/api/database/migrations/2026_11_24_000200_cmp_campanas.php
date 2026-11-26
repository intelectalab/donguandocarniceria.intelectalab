<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// CMP · Campañas y fidelización: segmentos, campañas de WhatsApp con grupo de control, cupones,
// programa de puntos y referidos. Decisiones: docs/cambios/2026-11-24_canales-con-b2b-cmp.md.
//
//  - RN-CMP-02: quien aprueba la campaña no es quien la creó (CHECK).
//  - RN-CMP-07: código de cupón único en la empresa (sin distinguir mayúsculas) e inicio menor que fin.
//  - RN-CMP-10: un pedido acepta un solo cupón (índice único parcial).
//  - RN-CMP-13: el libro de puntos es de solo inserción (REVOKE) y un cobro gana puntos una sola vez.
//  - RN-CMP-14: el referido es otro cliente y solo se refiere una vez (CHECK y UNIQUE).
//  - RN-CMP-15: un pedido se atribuye a una sola campaña (UNIQUE).
return new class extends Migration
{
    private const ESTADOS = [
        ['customer_segments', 'segment_type', ['DYNAMIC', 'STATIC']],
        ['customer_segments', 'status', ['ACTIVE', 'ARCHIVED']],
        ['campaigns', 'channel', ['WHATSAPP']],
        ['campaigns', 'objective', ['REACTIVATION', 'REPURCHASE', 'PROMOTION', 'LAUNCH', 'LOYALTY']],
        ['campaigns', 'status', ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'CANCELLED']],
        ['campaign_recipients', 'status', ['QUEUED', 'CONTROL', 'SKIPPED_CONSENT', 'SKIPPED_FREQUENCY', 'SENT', 'DELIVERED', 'READ', 'REPLIED', 'FAILED']],
        ['campaign_attributions', 'rule', ['COUPON', 'WINDOW']],
        ['coupons', 'discount_type', ['PCT', 'AMOUNT', 'FREE_DELIVERY']],
        ['coupons', 'status', ['ACTIVE', 'PAUSED', 'EXPIRED']],
        ['coupon_redemptions', 'status', ['APPLIED', 'REVERSED']],
        ['loyalty_programs', 'status', ['ACTIVE', 'INACTIVE']],
        ['loyalty_ledger', 'movement', ['EARN', 'REDEEM', 'EXPIRE', 'REVERSAL', 'ADJUST', 'REFERRAL_BONUS']],
        ['referrals', 'status', ['PENDING', 'QUALIFIED', 'REWARDED', 'REJECTED']],
    ];

    private const TABLAS = [
        'customer_segments', 'customer_segment_members', 'campaigns', 'campaign_recipients',
        'campaign_attributions', 'coupons', 'coupon_redemptions', 'loyalty_programs', 'loyalty_ledger', 'referrals',
    ];

    public function up(): void
    {
        Schema::create('customer_segments', function (Blueprint $t) {
            $this->base($t);
            $t->string('code', 30);
            $t->string('name', 255);
            $t->uuid('brand_id')->nullable();
            $t->string('segment_type', 20)->default('DYNAMIC');
            $t->jsonb('rules')->default(DB::raw("'{}'::jsonb"));
            $t->integer('refresh_hours')->default(24);
            $t->integer('member_count')->default(0);
            $t->integer('consent_count')->default(0);
            $t->string('status', 20)->default('ACTIVE');
            $t->uuid('created_by_user')->nullable();
            $t->timestampTz('last_refreshed_at')->nullable();
            $this->fechas($t);
            $t->unique(['tenant_id', 'code']);
            $t->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete();
            $t->foreign('created_by_user')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('customer_segment_members', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('segment_id');
            $t->uuid('customer_id');
            $t->timestampTz('added_at')->useCurrent();
            $this->fechas($t);
            $t->unique(['segment_id', 'customer_id']);
            $t->foreign('segment_id')->references('id')->on('customer_segments')->cascadeOnDelete();
            $t->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete();
        });

        Schema::create('campaigns', function (Blueprint $t) {
            $this->base($t);
            $t->string('code', 30);
            $t->string('name', 255);
            $t->uuid('brand_id');
            $t->uuid('segment_id');
            $t->string('channel', 20)->default('WHATSAPP');
            $t->uuid('channel_id');
            $t->uuid('template_id');
            $t->string('objective', 20);
            $t->uuid('coupon_id')->nullable();
            $t->timestampTz('scheduled_at')->nullable();
            $t->integer('attribution_window_days')->default(7);
            $t->decimal('control_group_pct', 5, 2)->default(10);
            $t->string('status', 20)->default('DRAFT');
            $t->uuid('created_by_user');
            $t->uuid('approved_by')->nullable();
            $t->timestampTz('approved_at')->nullable();
            $t->timestampTz('sent_at')->nullable();
            $t->string('cancel_reason', 255)->nullable();
            // Estimación (CMP-05), congelada al pedir la aprobación y recalculada justo antes de enviar.
            $t->integer('target_count')->default(0);
            $t->integer('control_count')->default(0);
            $t->integer('excluded_consent_count')->default(0);
            $t->integer('excluded_frequency_count')->default(0);
            $t->integer('effective_count')->default(0);
            $t->decimal('unit_cost', 10, 4)->nullable();
            $t->decimal('estimated_cost', 14, 2)->nullable();
            $t->decimal('estimated_discount', 14, 2)->nullable();
            $t->timestampTz('estimated_at')->nullable();
            $t->decimal('actual_cost', 14, 2)->nullable();
            $t->jsonb('history')->default(DB::raw("'[]'::jsonb"));
            $this->fechas($t);
            $t->unique(['tenant_id', 'code']);
            $t->index(['brand_id', 'status']);
            $t->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete();
            $t->foreign('segment_id')->references('id')->on('customer_segments')->restrictOnDelete();
            $t->foreign('channel_id')->references('id')->on('messaging_channels')->restrictOnDelete();
            $t->foreign('template_id')->references('id')->on('message_templates')->restrictOnDelete();
            $t->foreign('created_by_user')->references('id')->on('users')->restrictOnDelete();
            $t->foreign('approved_by')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('campaign_recipients', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('campaign_id');
            $t->uuid('customer_id');
            $t->string('phone', 30)->nullable();
            $t->boolean('is_control')->default(false);
            $t->string('status', 20)->default('QUEUED');
            $t->decimal('message_cost', 10, 4)->default(0);
            $t->boolean('opted_out')->default(false);
            $t->string('provider_message_id', 255)->nullable();   // id externo del proveedor de WhatsApp
            $t->timestampTz('sent_at')->nullable();
            $t->timestampTz('delivered_at')->nullable();
            $t->timestampTz('read_at')->nullable();
            $this->fechas($t);
            $t->unique(['campaign_id', 'customer_id']);
            $t->index(['customer_id', 'sent_at']);
            $t->foreign('campaign_id')->references('id')->on('campaigns')->restrictOnDelete();
            $t->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete();
        });

        Schema::create('coupons', function (Blueprint $t) {
            $this->base($t);
            $t->string('code', 40);
            $t->uuid('brand_id')->nullable();
            $t->uuid('campaign_id')->nullable();
            $t->string('discount_type', 20);
            $t->decimal('value', 14, 2)->default(0);
            $t->decimal('max_discount', 14, 2)->nullable();
            $t->decimal('min_order_amount', 14, 2)->default(0);
            $t->date('valid_from');
            $t->date('valid_to');
            $t->integer('max_uses_total')->nullable();
            $t->integer('max_uses_per_customer')->default(1);
            $t->uuid('customer_id')->nullable();   // cupón personal (RN-CMP-09)
            $t->jsonb('channels')->default(DB::raw("'[]'::jsonb"));
            $t->string('status', 20)->default('ACTIVE');
            $t->string('description', 255)->nullable();
            $t->uuid('created_by')->nullable();
            $this->fechas($t);
            $t->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete();
            $t->foreign('campaign_id')->references('id')->on('campaigns')->restrictOnDelete();
            $t->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete();
            $t->foreign('created_by')->references('id')->on('users')->restrictOnDelete();
        });
        Schema::table('campaigns', function (Blueprint $t) {
            $t->foreign('coupon_id')->references('id')->on('coupons')->restrictOnDelete();
        });

        Schema::create('coupon_redemptions', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('coupon_id');
            $t->uuid('customer_id');
            $t->uuid('order_id');
            $t->decimal('discount_amount', 14, 2);
            $t->decimal('order_amount', 14, 2);
            $t->timestampTz('redeemed_at')->useCurrent();
            $t->string('status', 20)->default('APPLIED');
            $this->fechas($t);
            $t->index(['coupon_id', 'customer_id']);
            $t->foreign('coupon_id')->references('id')->on('coupons')->restrictOnDelete();
            $t->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete();
            $t->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete();
        });

        Schema::create('campaign_attributions', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('campaign_id');
            $t->uuid('recipient_id')->nullable();
            $t->uuid('order_id')->unique();
            $t->uuid('customer_id');
            $t->string('rule', 20);
            $t->decimal('collected_amount', 14, 2)->default(0);
            $t->decimal('discount_amount', 14, 2)->default(0);
            $t->timestampTz('attributed_at')->useCurrent();
            $this->fechas($t);
            $t->index('campaign_id');
            $t->foreign('campaign_id')->references('id')->on('campaigns')->restrictOnDelete();
            $t->foreign('recipient_id')->references('id')->on('campaign_recipients')->restrictOnDelete();
            $t->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete();
            $t->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete();
        });

        Schema::create('loyalty_programs', function (Blueprint $t) {
            $this->base($t);
            $t->string('code', 30);
            $t->string('name', 255);
            $t->uuid('brand_id')->nullable();   // null = común a todas las marcas (D-CMP-01)
            $t->decimal('points_per_pen', 10, 4)->default(1);
            $t->decimal('pen_per_point', 10, 4)->default(0.05);
            $t->integer('min_redeem_points')->default(100);
            $t->integer('expiry_months')->default(12);
            $t->integer('referral_bonus_points')->default(200);
            $t->string('status', 20)->default('ACTIVE');
            $this->fechas($t);
            $t->unique(['tenant_id', 'code']);
            $t->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete();
        });

        Schema::create('loyalty_ledger', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('program_id');
            $t->uuid('customer_id');
            $t->string('movement', 20);
            $t->integer('points');
            $t->decimal('value_pen', 14, 2)->nullable();
            $t->uuid('payment_id')->nullable();
            $t->uuid('order_id')->nullable();
            $t->uuid('reversal_of')->nullable();
            $t->date('expires_on')->nullable();
            $t->string('reason', 255);
            $t->uuid('user_id')->nullable();
            $t->timestampTz('created_at')->useCurrent();
            $t->index(['customer_id', 'created_at']);
            $t->foreign('program_id')->references('id')->on('loyalty_programs')->restrictOnDelete();
            $t->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete();
            $t->foreign('payment_id')->references('id')->on('payments')->restrictOnDelete();
            $t->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete();
            $t->foreign('user_id')->references('id')->on('users')->restrictOnDelete();
        });
        Schema::table('loyalty_ledger', function (Blueprint $t) {   // referencia a la misma tabla, después de su clave
                $t->foreign('reversal_of')->references('id')->on('loyalty_ledger')->restrictOnDelete();
        });

        Schema::create('referrals', function (Blueprint $t) {
            $this->base($t);
            $t->uuid('referrer_customer_id');
            $t->uuid('referred_customer_id')->unique();
            $t->string('referral_code', 40);
            $t->string('status', 20)->default('PENDING');
            $t->uuid('welcome_coupon_id')->nullable();
            $t->uuid('first_order_id')->nullable();
            $t->timestampTz('qualified_at')->nullable();
            $t->timestampTz('rewarded_at')->nullable();
            $t->uuid('reward_ledger_id')->nullable();
            $t->string('reject_reason', 255)->nullable();
            $this->fechas($t);
            $t->index('referrer_customer_id');
            $t->foreign('referrer_customer_id')->references('id')->on('customers')->restrictOnDelete();
            $t->foreign('referred_customer_id')->references('id')->on('customers')->restrictOnDelete();
            $t->foreign('welcome_coupon_id')->references('id')->on('coupons')->restrictOnDelete();
            $t->foreign('first_order_id')->references('id')->on('sales_orders')->restrictOnDelete();
            $t->foreign('reward_ledger_id')->references('id')->on('loyalty_ledger')->restrictOnDelete();
        });

        foreach (self::ESTADOS as [$tabla, $col, $valores]) {
            $lista = implode(',', array_map(fn ($v) => "'{$v}'", $valores));
            DB::statement("ALTER TABLE {$tabla} ADD CONSTRAINT {$tabla}_{$col}_valido CHECK ({$col} IN ({$lista}))");
        }
        DB::statement('ALTER TABLE campaigns ADD CONSTRAINT campaigns_aprueba_otra_persona CHECK (approved_by IS NULL OR approved_by <> created_by_user)');
        DB::statement('ALTER TABLE campaigns ADD CONSTRAINT campaigns_valores CHECK (control_group_pct BETWEEN 0 AND 50 AND attribution_window_days BETWEEN 1 AND 60)');
        DB::statement('CREATE UNIQUE INDEX coupons_codigo_unico ON coupons (tenant_id, upper(code))');
        DB::statement(<<<'SQL'
            ALTER TABLE coupons ADD CONSTRAINT coupons_valores CHECK (
                valid_from < valid_to AND value >= 0 AND min_order_amount >= 0
                AND (discount_type <> 'PCT' OR value BETWEEN 0 AND 100)
                AND max_uses_per_customer >= 1 AND (max_uses_total IS NULL OR max_uses_total >= 1)
            )
            SQL);
        DB::statement("CREATE UNIQUE INDEX coupon_redemptions_un_cupon_por_pedido ON coupon_redemptions (order_id) WHERE status = 'APPLIED'");
        DB::statement(<<<'SQL'
            ALTER TABLE loyalty_ledger ADD CONSTRAINT loyalty_ledger_signo CHECK (
                points <> 0
                AND (movement NOT IN ('EARN', 'REFERRAL_BONUS') OR points > 0)
                AND (movement NOT IN ('REDEEM', 'EXPIRE') OR points < 0)
            )
            SQL);
        DB::statement("CREATE UNIQUE INDEX loyalty_ledger_un_abono_por_cobro ON loyalty_ledger (payment_id) WHERE movement = 'EARN'");
        DB::statement('CREATE UNIQUE INDEX loyalty_ledger_un_reverso ON loyalty_ledger (reversal_of) WHERE reversal_of IS NOT NULL');
        DB::statement('ALTER TABLE referrals ADD CONSTRAINT referrals_otro_cliente CHECK (referrer_customer_id <> referred_customer_id)');

        foreach (self::TABLAS as $tabla) {
            DB::statement("SELECT enable_tenant_rls('{$tabla}')");
            if ($tabla !== 'loyalty_ledger' && $tabla !== 'customer_segment_members') {
                DB::statement("SELECT audit.track('{$tabla}')");
            }
        }
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON loyalty_ledger FROM aycha_app');   // RN-CMP-13
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE IF EXISTS campaigns DROP CONSTRAINT IF EXISTS campaigns_coupon_id_foreign');
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
