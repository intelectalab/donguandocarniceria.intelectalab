<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// ONB · registro público (ONB-01) y registros y altas en la consola (ONB-16).
//  - tenant_signups: quien se registra desde la página con su RUC; verifica su correo con un código y recién entonces
//    se crea su empresa en prueba (RN-ONB-17). Un RUC tiene un solo registro vivo (RN-ONB-02). Es global (sin empresa).
//  - demo_requests: la consola los atiende (quién y cuándo, con nota). La aplicación sigue sin poder leerlos ni
//    cambiarlos: lo hace la consola por funciones guardadas que piden un usuario de plataforma activo.
//  - platform_create_tenant_from_signup(): crea la fila de la empresa de un registro verificado (tenants sigue de
//    solo lectura para la aplicación).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tenant_signups', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->string('ruc', 11);
            $table->string('legal_name', 200);
            $table->string('trade_name', 80);
            $table->string('business_type', 20);
            $table->string('tax_regime', 10);
            $table->string('fiscal_address', 250);
            $table->string('plan_code', 20);
            $table->string('contact_name', 120);
            $table->string('email', 120);
            $table->string('phone', 20)->nullable();
            $table->string('password_hash', 255)->nullable();   // se borra al crear la empresa
            $table->string('code_hash', 255)->nullable();
            $table->timestampTz('code_expires_at')->nullable();
            $table->unsignedSmallInteger('code_attempts')->default(0);
            $table->string('status', 12)->default('PENDING');
            $table->timestampTz('verified_at')->nullable();
            $table->uuid('tenant_id')->nullable();
            $table->string('rejected_reason', 300)->nullable();
            $table->uuid('rejected_by')->nullable();
            $table->string('source', 200)->nullable();
            $table->string('ip', 45)->nullable();
            $table->string('user_agent', 200)->nullable();
            $table->timestampsTz();
            $table->foreign('plan_code')->references('code')->on('saas_plans')->restrictOnUpdate();
            $table->foreign('tenant_id')->references('id')->on('tenants')->nullOnDelete();
            $table->foreign('rejected_by')->references('id')->on('platform_users')->nullOnDelete();
            $table->index('created_at');
        });
        DB::statement("ALTER TABLE tenant_signups ADD CONSTRAINT tenant_signups_estado CHECK (status IN ('PENDING','PROVISIONED','EXPIRED','REJECTED'))");
        DB::statement("ALTER TABLE tenant_signups ADD CONSTRAINT tenant_signups_ruc CHECK (ruc ~ '^(10|15|16|17|20)[0-9]{9}$')");
        DB::statement('ALTER TABLE tenant_signups ADD CONSTRAINT tenant_signups_correo CHECK (email = lower(btrim(email)))');
        // RN-ONB-02: un solo registro vivo por RUC (pendiente o ya convertido en empresa).
        DB::statement("CREATE UNIQUE INDEX tenant_signups_uno_vivo ON tenant_signups (ruc) WHERE status IN ('PENDING','PROVISIONED')");
        DB::statement("COMMENT ON TABLE tenant_signups IS 'global: registros desde la página pública (ONB-01); la consola los ve todos'");

        Schema::table('demo_requests', function (Blueprint $table) {
            $table->timestampTz('attended_at')->nullable();
            $table->uuid('attended_by')->nullable();
            $table->string('attended_note', 300)->nullable();
            $table->foreign('attended_by')->references('id')->on('platform_users')->nullOnDelete();
        });

        DB::unprepared(<<<'SQL'
            -- Pedidos de demo para la consola (la aplicación no puede leer la tabla).
            CREATE OR REPLACE FUNCTION platform_demo_requests()
            RETURNS TABLE (id uuid, name varchar, phone varchar, email varchar, business_type varchar, interests jsonb, plan_code varchar,
                           source varchar, created_at timestamptz, attended_at timestamptz, attended_by_name varchar, attended_note varchar)
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
                SELECT d.id, d.name, d.phone, d.email, d.business_type, d.interests, d.plan_code, d.source, d.created_at,
                       d.attended_at, u.full_name, d.attended_note
                  FROM demo_requests d LEFT JOIN platform_users u ON u.id = d.attended_by
                 ORDER BY d.attended_at IS NOT NULL, d.created_at DESC
            $$;
            REVOKE ALL ON FUNCTION platform_demo_requests() FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform_demo_requests() TO aycha_app;

            -- Marcar un pedido de demo como atendido (o volver a pendiente con p_note NULL y p_attended false).
            CREATE OR REPLACE FUNCTION platform_attend_demo_request(p_id uuid, p_actor uuid, p_attended boolean, p_note text) RETURNS void
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
            BEGIN
                IF NOT platform_actor_ok(p_actor, ARRAY['PLATFORM_ADMIN','BILLING','SUPPORT_L1','SUPPORT_L2','ENGINEER']) THEN
                    RAISE EXCEPTION 'Tu rol no atiende pedidos de demo' USING ERRCODE = '42501';
                END IF;
                UPDATE demo_requests SET attended_at = CASE WHEN p_attended THEN now() END, attended_by = CASE WHEN p_attended THEN p_actor END,
                       attended_note = CASE WHEN p_attended THEN left(p_note, 300) END
                 WHERE id = p_id;
            END $$;
            REVOKE ALL ON FUNCTION platform_attend_demo_request(uuid, uuid, boolean, text) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform_attend_demo_request(uuid, uuid, boolean, text) TO aycha_app;

            -- Crea la fila de la empresa de un registro con el correo verificado (y sin empresa todavía).
            CREATE OR REPLACE FUNCTION platform_create_tenant_from_signup(p_signup uuid, p_id uuid, p_hostname text) RETURNS void
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
            DECLARE s tenant_signups%ROWTYPE;
            BEGIN
                SELECT * INTO s FROM tenant_signups WHERE id = p_signup FOR UPDATE;
                IF NOT FOUND OR s.status <> 'PENDING' OR s.verified_at IS NULL OR s.tenant_id IS NOT NULL THEN
                    RAISE EXCEPTION 'El registro no está verificado o ya tiene empresa' USING ERRCODE = '42501';
                END IF;
                INSERT INTO tenants (id, name, short, plan, status, hostname, product, ruc, business_type, contact_name, contact_email,
                                     contact_phone, created_at, updated_at)
                VALUES (p_id, upper(s.legal_name), s.trade_name, s.plan_code, 'ACTIVE', p_hostname, 'COMERCIAL', s.ruc, s.business_type,
                        s.contact_name, s.email, s.phone, now(), now());
            END $$;
            REVOKE ALL ON FUNCTION platform_create_tenant_from_signup(uuid, uuid, text) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform_create_tenant_from_signup(uuid, uuid, text) TO aycha_app;
            SQL);

        foreach ([
            'onb_signup_code_hours' => [48, 'Horas que dura el código para verificar el correo del registro'],
            'onb_signup_expire_days' => [7, 'Días tras los que vence un registro sin verificar'],
        ] as $key => [$valor, $descripcion]) {
            DB::table('platform_parameters')->insertOrIgnore(['key' => $key, 'value' => json_encode($valor), 'description' => $descripcion, 'updated_at' => now()]);
        }
    }

    public function down(): void
    {
        DB::table('platform_parameters')->whereIn('key', ['onb_signup_code_hours', 'onb_signup_expire_days'])->delete();
        DB::unprepared('DROP FUNCTION IF EXISTS platform_create_tenant_from_signup(uuid, uuid, text); DROP FUNCTION IF EXISTS platform_attend_demo_request(uuid, uuid, boolean, text); DROP FUNCTION IF EXISTS platform_demo_requests();');
        Schema::table('demo_requests', function (Blueprint $table) {
            $table->dropForeign(['attended_by']);
            $table->dropColumn(['attended_at', 'attended_by', 'attended_note']);
        });
        Schema::dropIfExists('tenant_signups');
    }
};
