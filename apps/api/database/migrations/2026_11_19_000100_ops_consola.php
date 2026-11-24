<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// OPS · consola de Intelectalab (tanda 1): usuarios de plataforma, sus sesiones, la bitácora de la consola y los
// parámetros de toda la plataforma. Son tablas globales (sin empresa ni RLS): el personal de Intelectalab no es
// usuario de ninguna empresa. Nombres de la spec: platform_users, platform_audit_log, platform_parameters y
// platform_parameter_history; platform_sessions y platform_user_tokens son propias (sesión y activación).
//  - RN-OPS-01: un usuario de plataforma activo tiene segundo factor (lo asegura la base).
//  - RN-OPS-05: la bitácora de la consola y el historial de parámetros son de solo inserción.
return new class extends Migration
{
    /** Parámetros de plataforma de OPS que usa la consola desde la tanda 1 (la pantalla OPS-16 va en la tanda 4). */
    private const PARAMETROS = [
        'ops_console_session_minutes' => [30, 'Minutos de inactividad antes de cerrar la sesión de la consola'],
        'ops_console_ip_allowlist' => [[], 'Redes desde las que se acepta la consola; vacía acepta todas'],
        'ops_console_session_max_hours' => [12, 'Horas máximas de una sesión de la consola aunque se use'],
        'ops_platform_user_invite_hours' => [48, 'Horas que dura el código para activar una cuenta de la consola'],
    ];

    public function up(): void
    {
        Schema::create('platform_users', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->string('email', 120);
            $table->string('full_name', 120);
            $table->string('role', 20);
            $table->string('status', 10)->default('INVITED');
            $table->string('password', 255)->nullable();          // sin contraseña hasta activar la cuenta
            $table->text('totp_secret')->nullable();              // cifrado con la clave de la aplicación
            $table->timestampTz('twofa_enabled_at')->nullable();
            $table->bigInteger('totp_last_step')->nullable();     // el mismo código no sirve dos veces
            $table->unsignedSmallInteger('failed_logins')->default(0);
            $table->timestampTz('locked_until')->nullable();
            $table->timestampTz('last_login_at')->nullable();
            $table->string('disabled_reason', 200)->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();
        });
        Schema::table('platform_users', fn (Blueprint $table) => $table->foreign('created_by')->references('id')->on('platform_users')->nullOnDelete());
        DB::statement('CREATE UNIQUE INDEX platform_users_correo ON platform_users (lower(email))');
        DB::statement("ALTER TABLE platform_users ADD CONSTRAINT platform_users_rol CHECK (role IN ('PLATFORM_ADMIN','BILLING','SUPPORT_L1','SUPPORT_L2','ENGINEER','READ_ONLY'))");
        DB::statement("ALTER TABLE platform_users ADD CONSTRAINT platform_users_estado CHECK (status IN ('INVITED','ACTIVE','LOCKED','DISABLED'))");
        // RN-OPS-01: sin segundo factor la cuenta no se activa.
        DB::statement("ALTER TABLE platform_users ADD CONSTRAINT platform_users_activo_con_2fa CHECK (status <> 'ACTIVE' OR (twofa_enabled_at IS NOT NULL AND totp_secret IS NOT NULL AND password IS NOT NULL))");

        // Código de un solo uso para activar la cuenta (crear la contraseña y el segundo factor).
        Schema::create('platform_user_tokens', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('platform_user_id');
            $table->string('token_hash', 255);
            $table->timestampTz('expires_at');
            $table->timestampTz('used_at')->nullable();
            $table->timestampTz('voided_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->foreign('platform_user_id')->references('id')->on('platform_users')->cascadeOnDelete();
            $table->index('platform_user_id');
        });

        // Sesión de la consola: solo se guarda la huella del token.
        Schema::create('platform_sessions', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('platform_user_id');
            $table->char('token_hash', 64)->unique();
            $table->string('ip', 45)->nullable();
            $table->string('device', 120)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('last_used_at')->useCurrent();
            $table->timestampTz('expires_at');
            $table->timestampTz('ended_at')->nullable();
            $table->string('end_reason', 120)->nullable();
            $table->foreign('platform_user_id')->references('id')->on('platform_users')->cascadeOnDelete();
            $table->index(['platform_user_id', 'ended_at']);
        });

        Schema::create('platform_audit_log', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('platform_user_id')->nullable();
            $table->string('actor_name', 120);
            $table->string('action', 40);
            $table->uuid('target_tenant_id')->nullable();
            $table->string('entity', 60)->nullable();
            $table->string('entity_id', 60)->nullable();
            $table->string('reason', 300)->nullable();
            $table->string('ip', 45)->nullable();
            $table->jsonb('detail')->default(DB::raw("'{}'::jsonb"));
            $table->timestampTz('occurred_at')->useCurrent();
            $table->foreign('platform_user_id')->references('id')->on('platform_users')->nullOnDelete();
            $table->index('occurred_at');
            $table->index(['target_tenant_id', 'occurred_at']);
        });

        Schema::create('platform_parameters', function (Blueprint $table) {
            $table->string('key', 60)->primary();
            $table->jsonb('value');
            $table->string('description', 200);
            $table->uuid('updated_by')->nullable();
            $table->timestampTz('updated_at')->useCurrent();
            $table->foreign('updated_by')->references('id')->on('platform_users')->nullOnDelete();
        });
        Schema::create('platform_parameter_history', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->string('key', 60);
            $table->jsonb('old_value')->nullable();
            $table->jsonb('new_value');
            $table->string('reason', 300);
            $table->uuid('changed_by')->nullable();
            $table->string('changed_by_name', 120);
            $table->timestampTz('changed_at')->useCurrent();
            $table->foreign('key')->references('key')->on('platform_parameters')->cascadeOnDelete();
            $table->index(['key', 'changed_at']);
        });

        foreach (['platform_users', 'platform_user_tokens', 'platform_sessions', 'platform_audit_log', 'platform_parameters', 'platform_parameter_history'] as $t) {
            DB::statement("COMMENT ON TABLE {$t} IS 'global: de la plataforma (consola de Intelectalab), sin empresa'");
        }
        // RN-OPS-05: solo inserción para la aplicación.
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON platform_audit_log, platform_parameter_history FROM aycha_app');

        foreach (self::PARAMETROS as $key => [$valor, $descripcion]) {
            DB::table('platform_parameters')->insert(['key' => $key, 'value' => json_encode($valor), 'description' => $descripcion, 'updated_at' => now()]);
        }
    }

    public function down(): void
    {
        foreach (['platform_parameter_history', 'platform_parameters', 'platform_audit_log', 'platform_sessions', 'platform_user_tokens', 'platform_users'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
