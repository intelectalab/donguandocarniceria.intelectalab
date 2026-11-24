<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// OPS y SUS · consola, tanda 2: empresas, su suscripción y el alta desde la consola.
//  - tenants: RUC (una empresa por RUC en toda la plataforma, RN-ONB-02), rubro y contacto del alta.
//  - subscriptions y subscription_events (nombres de la spec): una suscripción viva por empresa (RN-SUS-03) y su
//    historial de solo inserción (RN-SUS-10). Son tablas de la plataforma (sin RLS): la consola las lee de todas
//    las empresas; la pantalla de la empresa (SUS-01, más adelante) filtrará la suya.
//  - platform_tenant_usage(): la consola ve solo totales de uso por empresa (usuarios, marcas, locales), nunca
//    filas de negocio (RN-OPS-06). Corre como dueño de las tablas (SECURITY DEFINER) y no recibe parámetros.
//  - platform_tenant_modules(): qué módulos tiene encendidos cada empresa (tenant_modules tiene RLS).
//  - platform_ruc_in_use(ruc): solo dice si el RUC ya es de alguna empresa (RN-ONB-02).
//  Las empresas sin suscripción (Don Guando como piloto) no tienen límites ni bloqueos (RN-SUS-21).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenants', function (Blueprint $table) {
            $table->string('ruc', 11)->nullable();
            $table->string('business_type', 20)->nullable();
            $table->string('contact_name', 120)->nullable();
            $table->string('contact_email', 120)->nullable();
            $table->string('contact_phone', 20)->nullable();
            $table->uuid('created_by_platform_user')->nullable();
            $table->foreign('created_by_platform_user')->references('id')->on('platform_users')->nullOnDelete();
        });
        // Las empresas que ya existen toman el RUC de su primera empresa (la de demo).
        DB::statement('UPDATE tenants t SET ruc = (SELECT c.ruc FROM companies c WHERE c.tenant_id = t.id ORDER BY c.created_at, c.id LIMIT 1)');
        DB::statement('CREATE UNIQUE INDEX tenants_ruc ON tenants (ruc) WHERE ruc IS NOT NULL');
        DB::statement("ALTER TABLE tenants ADD CONSTRAINT tenants_ruc_formato CHECK (ruc IS NULL OR ruc ~ '^(10|15|16|17|20)[0-9]{9}$')");
        DB::statement("ALTER TABLE tenants ADD CONSTRAINT tenants_rubro CHECK (business_type IS NULL OR business_type IN ('CARNICERIA','DISTRIBUIDORA','AVICOLA','CHARCUTERIA','GOURMET','PLANTA','OTRO'))");

        Schema::create('subscriptions', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('tenant_id');
            $table->string('plan_code', 20);
            $table->string('status', 12);
            $table->timestampTz('trial_ends_at')->nullable();
            $table->unsignedSmallInteger('trial_days_granted')->default(0);   // con extensiones (RN-SUS-15)
            $table->timestampTz('started_at')->useCurrent();
            $table->timestampTz('status_changed_at')->useCurrent();
            $table->timestampTz('cancelled_at')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('plan_code')->references('code')->on('saas_plans')->restrictOnUpdate();
            $table->foreign('created_by')->references('id')->on('platform_users')->nullOnDelete();
        });
        DB::statement("ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_estado CHECK (status IN ('TRIAL','ACTIVE','PAST_DUE','READ_ONLY','SUSPENDED','CANCELLED'))");
        DB::statement("ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_prueba CHECK (status <> 'TRIAL' OR trial_ends_at IS NOT NULL)");
        // RN-SUS-03: una sola suscripción viva por empresa (hoy hay un solo producto, Comercial).
        DB::statement("CREATE UNIQUE INDEX subscriptions_una_viva ON subscriptions (tenant_id) WHERE status <> 'CANCELLED'");

        Schema::create('subscription_events', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('subscription_id');
            $table->uuid('tenant_id');
            $table->string('event', 20);
            $table->string('from_status', 12)->nullable();
            $table->string('to_status', 12)->nullable();
            $table->string('reason', 300);
            $table->string('actor_type', 15);
            $table->uuid('actor_id')->nullable();
            $table->string('actor_name', 120);
            $table->jsonb('detail')->default(DB::raw("'{}'::jsonb"));
            $table->timestampTz('occurred_at')->useCurrent();
            $table->foreign('subscription_id')->references('id')->on('subscriptions')->restrictOnDelete();
            $table->index(['tenant_id', 'occurred_at']);
        });
        DB::statement("ALTER TABLE subscription_events ADD CONSTRAINT subscription_events_actor CHECK (actor_type IN ('PLATFORM_USER','TENANT_USER','SYSTEM'))");

        foreach (['subscriptions', 'subscription_events'] as $t) {
            DB::statement("COMMENT ON TABLE {$t} IS 'global: de la plataforma (SUS), una fila por empresa; la consola las ve todas'");
        }
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON subscription_events FROM aycha_app');   // historial de solo inserción

        // Totales de uso por empresa para la consola: sin filas de negocio, sin parámetros.
        // No cuentan los usuarios de soporte de Intelectalab ni los de clientes B2B (RN-SUS-06).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION platform_tenant_usage()
            RETURNS TABLE (tenant_id uuid, users_active bigint, brands_active bigint, sites_active bigint, last_login timestamptz)
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
                SELECT t.id,
                       (SELECT count(*) FROM users u WHERE u.tenant_id = t.id AND u.status = 'ACTIVE'
                          AND u.role NOT IN ('SOPORTE_PLATAFORMA','CLIENTE_B2B') AND COALESCE(u.user_type, '') <> 'B2B_CUSTOMER'),
                       (SELECT count(*) FROM brands b WHERE b.tenant_id = t.id AND b.status = 'ACTIVE'),
                       (SELECT count(*) FROM establishments e WHERE e.tenant_id = t.id AND e.status = 'ACTIVE'),
                       (SELECT max(u.last_login) FROM users u WHERE u.tenant_id = t.id AND u.role NOT IN ('SOPORTE_PLATAFORMA'))
                  FROM tenants t
            $$;
            REVOKE ALL ON FUNCTION platform_tenant_usage() FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform_tenant_usage() TO aycha_app;

            -- Módulos de cada empresa (tenant_modules tiene RLS): código, fase, si está encendido y por qué.
            CREATE OR REPLACE FUNCTION platform_tenant_modules()
            RETURNS TABLE (tenant_id uuid, module_code varchar, phase int, enabled boolean, sus_source varchar)
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
                SELECT m.tenant_id, m.module_code, m.phase, m.enabled, m.sus_source FROM tenant_modules m
            $$;
            REVOKE ALL ON FUNCTION platform_tenant_modules() FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform_tenant_modules() TO aycha_app;

            -- Alta de la fila de la empresa: tenants sigue siendo de solo lectura para la aplicación; solo esta función
            -- la crea, y solo a nombre de un administrador de plataforma activo.
            CREATE OR REPLACE FUNCTION platform_create_tenant(p_id uuid, p_name text, p_short text, p_plan text, p_hostname text, p_ruc text,
                p_business_type text, p_contact_name text, p_contact_email text, p_contact_phone text, p_created_by uuid) RETURNS void
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM platform_users WHERE id = p_created_by AND role = 'PLATFORM_ADMIN' AND status = 'ACTIVE') THEN
                    RAISE EXCEPTION 'Solo un administrador de plataforma activo da de alta empresas' USING ERRCODE = '42501';
                END IF;
                INSERT INTO tenants (id, name, short, plan, status, hostname, product, ruc, business_type, contact_name, contact_email,
                                     contact_phone, created_by_platform_user, created_at, updated_at)
                VALUES (p_id, p_name, p_short, p_plan, 'ACTIVE', p_hostname, 'COMERCIAL', p_ruc, p_business_type, p_contact_name, p_contact_email,
                        p_contact_phone, p_created_by, now(), now());
            END
            $$;
            REVOKE ALL ON FUNCTION platform_create_tenant(uuid, text, text, text, text, text, text, text, text, text, uuid) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform_create_tenant(uuid, text, text, text, text, text, text, text, text, text, uuid) TO aycha_app;

            -- RN-ONB-02: ¿el RUC ya es de alguna empresa? Solo responde sí o no.
            CREATE OR REPLACE FUNCTION platform_ruc_in_use(p_ruc text) RETURNS boolean
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
                SELECT EXISTS (SELECT 1 FROM tenants WHERE ruc = p_ruc) OR EXISTS (SELECT 1 FROM companies WHERE ruc = p_ruc)
            $$;
            REVOKE ALL ON FUNCTION platform_ruc_in_use(text) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform_ruc_in_use(text) TO aycha_app;
            SQL);

        foreach ([
            'sus_trial_days_default' => [14, 'Días de prueba gratuita de una empresa nueva'],
            'sus_trial_max_days' => [30, 'Tope de días de prueba contando extensiones'],
        ] as $key => [$valor, $descripcion]) {
            DB::table('platform_parameters')->insert(['key' => $key, 'value' => json_encode($valor), 'description' => $descripcion, 'updated_at' => now()]);
        }
    }

    public function down(): void
    {
        DB::table('platform_parameters')->whereIn('key', ['sus_trial_days_default', 'sus_trial_max_days'])->delete();
        DB::unprepared('DROP FUNCTION IF EXISTS platform_tenant_usage(); DROP FUNCTION IF EXISTS platform_ruc_in_use(text); DROP FUNCTION IF EXISTS platform_tenant_modules(); DROP FUNCTION IF EXISTS platform_create_tenant(uuid, text, text, text, text, text, text, text, text, text, uuid);');
        Schema::dropIfExists('subscription_events');
        Schema::dropIfExists('subscriptions');
        DB::statement('DROP INDEX IF EXISTS tenants_ruc');
        DB::statement('ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_ruc_formato, DROP CONSTRAINT IF EXISTS tenants_rubro');
        Schema::table('tenants', function (Blueprint $table) {
            $table->dropForeign(['created_by_platform_user']);
            $table->dropColumn(['ruc', 'business_type', 'contact_name', 'contact_email', 'contact_phone', 'created_by_platform_user']);
        });
    }
};
