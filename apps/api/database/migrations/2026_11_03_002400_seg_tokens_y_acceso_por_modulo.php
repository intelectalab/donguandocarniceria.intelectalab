<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// SEG · dos piezas del núcleo que el prototipo no guarda como tabla:
//  - personal_access_tokens (Sanctum) con tenant_id y RLS: un token solo se encuentra
//    desde el dominio de su empresa, aunque alguien lo copie a otro.
//  - role_module_access: la matriz de acceso de cada rol por módulo (G.ACCESS del prototipo):
//    C crear · L leer · E editar · A aprobar/anular. module_code '*' es el valor por defecto
//    del rol para los módulos que no nombra.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('personal_access_tokens', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuidMorphs('tokenable');
            $table->text('name');
            $table->string('token', 64)->unique();
            $table->text('abilities')->nullable();
            $table->timestampTz('last_used_at')->nullable();
            $table->timestampTz('expires_at')->nullable()->index();
            $table->timestampsTz();
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->index('tenant_id');
        });
        DB::statement("SELECT enable_tenant_rls('personal_access_tokens')");

        Schema::create('role_module_access', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('role_id');
            $table->string('module_code', 10)->comment("código del módulo o '*' para el resto");
            $table->string('actions', 4)->default('')->comment('subconjunto de CLEA');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('role_id')->references('id')->on('roles')->cascadeOnDelete();
            $table->unique(['tenant_id', 'role_id', 'module_code']);
        });
        DB::statement("ALTER TABLE role_module_access ADD CONSTRAINT role_module_access_actions_check CHECK (actions ~ '^C?L?E?A?$')");
        DB::statement("SELECT enable_tenant_rls('role_module_access')");
        DB::statement("SELECT audit.track('role_module_access')");
    }

    public function down(): void
    {
        Schema::dropIfExists('role_module_access');
        Schema::dropIfExists('personal_access_tokens');
    }
};
