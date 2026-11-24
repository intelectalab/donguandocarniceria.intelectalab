<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// OPS · accesos de soporte: OPS-05 Solicitar acceso, OPS-06 Sesión de soporte y OPS-14 Accesos de soporte (cliente).
//  - support_accesses: lo pide la consola y lo aprueba la empresa (RN-OPS-03). Es personal: entra solo el usuario de
//    plataforma al que se otorgó, con un usuario técnico de la empresa (users.user_type = PLATFORM_SUPPORT) que está
//    activo solo mientras el acceso esté vigente (RN-OPS-09).
//  - support_access_events: todo lo que pasa con el acceso y cada consulta, cambio o exportación del soporte
//    (RN-OPS-04). Solo inserción: ni la aplicación la cambia.
//  - Ambas son de la empresa (RLS) y la consola las ve con su sesión de plataforma (RN-OPS-06, CA-OPS-03).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('support_accesses', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('ticket_id')->nullable();
            $table->uuid('platform_user_id');
            $table->string('platform_user_name', 120);
            $table->text('reason');
            $table->string('level', 2);
            $table->jsonb('modules')->default('[]');
            $table->boolean('can_export')->default(false);
            $table->unsignedSmallInteger('suggested_hours');
            $table->unsignedSmallInteger('hours')->nullable();
            $table->string('status', 12)->default('PENDING');
            $table->uuid('decided_by')->nullable();
            $table->string('decided_by_name', 120)->nullable();
            $table->timestampTz('decided_at')->nullable();
            $table->string('decision_reason', 300)->nullable();
            $table->timestampTz('expires_at')->nullable();
            $table->timestampTz('first_used_at')->nullable();
            $table->timestampTz('ended_at')->nullable();
            $table->string('ended_by_name', 120)->nullable();
            $table->string('end_reason', 300)->nullable();
            $table->uuid('tech_user_id')->nullable();
            $table->timestampsTz();
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('ticket_id')->references('id')->on('support_tickets')->nullOnDelete();
            $table->foreign('platform_user_id')->references('id')->on('platform_users')->restrictOnDelete();
            $table->foreign('decided_by')->references('id')->on('users')->nullOnDelete();
            $table->foreign('tech_user_id')->references('id')->on('users')->nullOnDelete();
            $table->index(['tenant_id', 'status']);
            $table->index(['status', 'expires_at']);
        });
        DB::statement("ALTER TABLE support_accesses ADD CONSTRAINT support_accesses_estado CHECK (status IN ('PENDING','ACTIVE','REJECTED','REVOKED','EXPIRED','FINISHED','CANCELLED'))");
        DB::statement("ALTER TABLE support_accesses ADD CONSTRAINT support_accesses_nivel CHECK (level IN ('RO','RW'))");
        DB::statement("ALTER TABLE support_accesses ADD CONSTRAINT support_accesses_modulos CHECK (jsonb_typeof(modules) = 'array')");
        DB::statement("ALTER TABLE support_accesses ADD CONSTRAINT support_accesses_vigencia CHECK (status <> 'ACTIVE' OR expires_at IS NOT NULL)");

        Schema::create('support_access_events', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('access_id');
            $table->string('kind', 20);
            $table->string('actor_name', 120);
            $table->string('method', 8)->nullable();
            $table->string('path', 300)->nullable();
            $table->unsignedSmallInteger('status_code')->nullable();
            $table->string('detail', 300)->nullable();
            $table->string('ip', 45)->nullable();
            $table->timestampTz('at')->useCurrent();
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('access_id')->references('id')->on('support_accesses')->cascadeOnDelete();
            $table->index(['access_id', 'at']);
        });
        DB::statement("ALTER TABLE support_access_events ADD CONSTRAINT support_access_events_tipo CHECK (kind IN ('REQUESTED','CANCELLED','APPROVED','REJECTED','REVOKED','EXPIRED','FINISHED','SESSION_STARTED','SESSION_ENDED','READ','WRITE','EXPORT','DENIED'))");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON support_access_events FROM aycha_app');   // RN-OPS-04: solo inserción

        foreach (['support_accesses', 'support_access_events'] as $t) {
            DB::statement("ALTER TABLE {$t} ENABLE ROW LEVEL SECURITY");
            DB::statement("CREATE POLICY tenant_isolation ON {$t} USING (tenant_id = app_tenant_id() OR app_is_platform()) WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform())");
        }

        // Tope de un acceso para toda la plataforma (la duración por defecto es parámetro de cada empresa).
        DB::table('platform_parameters')->insertOrIgnore(['key' => 'ops_support_max_hours', 'value' => json_encode(72),
            'description' => 'Horas máximas de un acceso de soporte (un acceso aprobado no se amplía: se pide otro)', 'updated_at' => now()]);
    }

    public function down(): void
    {
        DB::table('platform_parameters')->where('key', 'ops_support_max_hours')->delete();
        Schema::dropIfExists('support_access_events');
        Schema::dropIfExists('support_accesses');
    }
};
