<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// OPS · operación de la plataforma: OPS-07 Salud de componentes, OPS-08 Incidentes y OPS-11 Anuncios.
//  - Salud: componentes y sus lecturas (solo inserción, RN-OPS-05). Tablas de la plataforma: las empresas no las ven.
//  - Incidentes: con empresas afectadas, línea de tiempo (solo inserción) y tickets vinculados (RN-OPS-08, RN-OPS-14).
//  - Anuncios: la empresa ve solo los dirigidos a ella y publicados en su ventana (RN-OPS-06), por RLS: una política
//    deja ver todo a la consola y, a una empresa, solo los suyos (a todas, a su plan o a ella por nombre).
return new class extends Migration
{
    private const COMPONENTES = [
        ['APP', 'Aplicación', 1], ['DB', 'Base de datos', 2], ['QUEUE', 'Colas de trabajo', 3], ['OSE', 'OSE (comprobantes electrónicos)', 4],
        ['WHATSAPP', 'WhatsApp', 5], ['PAYMENTS', 'Pasarelas de pago', 6], ['MAPS', 'Mapas', 7], ['MAIL', 'Correo', 8], ['STORAGE', 'Almacenamiento', 9],
        ['TELEPHONY', 'Telefonía', 10], ['ADS', 'Anuncios pagados', 11], ['WOOCOMMERCE', 'WooCommerce', 12], ['API', 'API pública', 13],
    ];

    public function up(): void
    {
        Schema::create('platform_components', function (Blueprint $table) {
            $table->string('code', 20)->primary();
            $table->string('name', 80);
            $table->unsignedSmallInteger('sort');
            $table->string('status', 10)->default('UNKNOWN');
            $table->unsignedInteger('latency_ms')->nullable();
            $table->decimal('error_rate', 5, 2)->nullable();
            $table->unsignedInteger('queue_depth')->nullable();
            $table->string('detail', 300)->nullable();
            $table->timestampTz('last_read_at')->nullable();
            $table->timestampTz('status_since')->nullable();
        });
        DB::statement("ALTER TABLE platform_components ADD CONSTRAINT platform_components_estado CHECK (status IN ('UP','DEGRADED','DOWN','UNKNOWN'))");
        foreach (self::COMPONENTES as [$code, $name, $sort]) {
            DB::table('platform_components')->insert(['code' => $code, 'name' => $name, 'sort' => $sort]);
        }

        Schema::create('platform_health_readings', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('component_code', 20);
            $table->string('status', 10);
            $table->unsignedInteger('latency_ms')->nullable();
            $table->decimal('error_rate', 5, 2)->nullable();
            $table->unsignedInteger('queue_depth')->nullable();
            $table->string('detail', 300)->nullable();
            $table->string('source', 10);
            $table->uuid('platform_user_id')->nullable();
            $table->timestampTz('read_at')->useCurrent();
            $table->foreign('component_code')->references('code')->on('platform_components');
            $table->index(['component_code', 'read_at']);
        });
        DB::statement("ALTER TABLE platform_health_readings ADD CONSTRAINT platform_health_readings_estado CHECK (status IN ('UP','DEGRADED','DOWN','UNKNOWN'))");
        DB::statement("ALTER TABLE platform_health_readings ADD CONSTRAINT platform_health_readings_origen CHECK (source IN ('AUTO','MANUAL'))");

        DB::statement('CREATE SEQUENCE IF NOT EXISTS platform_incident_number_seq START 1');
        Schema::create('platform_incidents', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->string('number', 12)->default(DB::raw("'INC-' || lpad(nextval('platform_incident_number_seq')::text, 4, '0')"));
            $table->string('title', 150);
            $table->string('severity', 4);
            $table->string('component_code', 20)->nullable();
            $table->string('status', 15)->default('INVESTIGATING');
            $table->boolean('affects_all')->default(false);
            $table->timestampTz('started_at');
            $table->timestampTz('resolved_at')->nullable();
            $table->text('public_message')->nullable();
            $table->timestampTz('customers_notified_at')->nullable();
            $table->text('root_cause')->nullable();
            $table->text('postmortem')->nullable();
            $table->string('source', 10)->default('MANUAL');
            $table->uuid('created_by')->nullable();
            $table->string('created_by_name', 120);
            $table->timestampsTz();
            $table->unique('number');
            $table->foreign('component_code')->references('code')->on('platform_components');
            $table->foreign('created_by')->references('id')->on('platform_users')->nullOnDelete();
            $table->index(['status', 'started_at']);
        });
        DB::statement("ALTER TABLE platform_incidents ADD CONSTRAINT platform_incidents_severidad CHECK (severity IN ('SEV1','SEV2','SEV3','SEV4'))");
        DB::statement("ALTER TABLE platform_incidents ADD CONSTRAINT platform_incidents_estado CHECK (status IN ('INVESTIGATING','IDENTIFIED','MONITORING','RESOLVED'))");
        // RN-OPS-08: resuelto con hora de cierre posterior al inicio y causa raíz.
        DB::statement("ALTER TABLE platform_incidents ADD CONSTRAINT platform_incidents_cierre CHECK (status <> 'RESOLVED' OR (resolved_at > started_at AND coalesce(btrim(root_cause), '') <> ''))");

        Schema::create('platform_incident_tenants', function (Blueprint $table) {
            $table->uuid('incident_id');
            $table->uuid('tenant_id');
            $table->primary(['incident_id', 'tenant_id']);
            $table->foreign('incident_id')->references('id')->on('platform_incidents')->cascadeOnDelete();
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
        });

        Schema::create('platform_incident_updates', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->uuid('incident_id');
            $table->string('status', 15);
            $table->text('message');
            $table->boolean('public')->default(false);
            $table->string('author_name', 120);
            $table->timestampTz('at')->useCurrent();
            $table->foreign('incident_id')->references('id')->on('platform_incidents')->cascadeOnDelete();
            $table->index(['incident_id', 'at']);
        });

        Schema::table('support_tickets', function (Blueprint $table) {
            $table->uuid('incident_id')->nullable();
            $table->foreign('incident_id')->references('id')->on('platform_incidents')->nullOnDelete();
        });

        Schema::create('platform_announcements', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->string('title', 120);
            $table->text('body');
            $table->string('kind', 12);
            $table->string('audience', 10);
            $table->jsonb('audience_plans')->default('[]');
            $table->jsonb('audience_tenants')->default('[]');
            $table->timestampTz('starts_at');
            $table->timestampTz('ends_at')->nullable();
            $table->timestampTz('maintenance_starts_at')->nullable();
            $table->timestampTz('maintenance_ends_at')->nullable();
            $table->boolean('published')->default(false);
            $table->timestampTz('published_at')->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->uuid('incident_id')->nullable();
            $table->uuid('created_by')->nullable();
            $table->string('created_by_name', 120);
            $table->timestampsTz();
            $table->foreign('incident_id')->references('id')->on('platform_incidents')->nullOnDelete();
            $table->foreign('created_by')->references('id')->on('platform_users')->nullOnDelete();
            $table->index(['published', 'starts_at']);
        });
        DB::statement("ALTER TABLE platform_announcements ADD CONSTRAINT platform_announcements_tipo CHECK (kind IN ('INFO','MAINTENANCE','INCIDENT','FEATURE'))");
        DB::statement("ALTER TABLE platform_announcements ADD CONSTRAINT platform_announcements_publico CHECK (audience IN ('ALL','PLANS','TENANTS'))");
        DB::statement('ALTER TABLE platform_announcements ADD CONSTRAINT platform_announcements_ventana CHECK (ends_at IS NULL OR ends_at > starts_at)');
        DB::statement("ALTER TABLE platform_announcements ADD CONSTRAINT platform_announcements_mantenimiento CHECK (kind <> 'MAINTENANCE' OR (maintenance_starts_at IS NOT NULL AND maintenance_ends_at > maintenance_starts_at))");
        // RN-OPS-06: la consola ve todo; una empresa, solo lo publicado y dirigido a ella (la ventana la filtra la aplicación).
        DB::statement('ALTER TABLE platform_announcements ENABLE ROW LEVEL SECURITY');
        DB::statement(<<<'SQL'
            CREATE POLICY anuncios_visibles ON platform_announcements USING (
                app_is_platform() OR (
                    app_tenant_id() IS NOT NULL AND published AND cancelled_at IS NULL
                    AND (audience = 'ALL'
                        OR (audience = 'TENANTS' AND audience_tenants @> jsonb_build_array(app_tenant_id()::text))
                        OR (audience = 'PLANS' AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = app_tenant_id()
                            AND s.status <> 'CANCELLED' AND audience_plans @> jsonb_build_array(s.plan_code))))
                )
            ) WITH CHECK (app_is_platform())
            SQL);

        // Lo demás de la plataforma: solo la consola (la empresa no tiene contexto de plataforma).
        foreach (['platform_components', 'platform_health_readings', 'platform_incidents', 'platform_incident_tenants', 'platform_incident_updates'] as $t) {
            DB::statement("ALTER TABLE {$t} ENABLE ROW LEVEL SECURITY");
            DB::statement("CREATE POLICY solo_consola ON {$t} USING (app_is_platform()) WITH CHECK (app_is_platform())");
        }
        // RN-OPS-05: lecturas de salud y línea de tiempo, solo inserción.
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON platform_health_readings, platform_incident_updates FROM aycha_app');
        DB::statement('GRANT USAGE, SELECT ON SEQUENCE platform_incident_number_seq TO aycha_app');

        foreach ([
            'ops_component_check_seconds' => [60, 'Cada cuántos segundos se leen los componentes (la tarea corre cada minuto)'],
            'ops_incident_notify_minutes' => [30, 'Minutos para avisar a los clientes afectados por un incidente SEV1 o SEV2'],
            'ops_maintenance_notice_hours' => [48, 'Horas de anticipación mínima para anunciar un mantenimiento'],
        ] as $key => [$valor, $descripcion]) {
            DB::table('platform_parameters')->insertOrIgnore(['key' => $key, 'value' => json_encode($valor), 'description' => $descripcion, 'updated_at' => now()]);
        }
    }

    public function down(): void
    {
        DB::table('platform_parameters')->whereIn('key', ['ops_component_check_seconds', 'ops_incident_notify_minutes', 'ops_maintenance_notice_hours'])->delete();
        Schema::dropIfExists('platform_announcements');
        Schema::table('support_tickets', fn (Blueprint $t) => $t->dropConstrainedForeignId('incident_id'));
        Schema::dropIfExists('platform_incident_updates');
        Schema::dropIfExists('platform_incident_tenants');
        Schema::dropIfExists('platform_incidents');
        Schema::dropIfExists('platform_health_readings');
        Schema::dropIfExists('platform_components');
        DB::statement('DROP SEQUENCE IF EXISTS platform_incident_number_seq');
    }
};
