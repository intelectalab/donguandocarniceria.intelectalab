<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// INT · notificaciones dirigidas a un rol: cada persona del rol las marca como leídas por su cuenta.
// Antes la marca estaba en la notificación misma (notifications.read_at), así que la primera persona
// que la leía la dejaba leída para todo el rol. Las personales (user_id) siguen usando read_at.
// La app solo inserta aquí (una vez por persona y notificación); RLS por empresa.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notification_reads', function (Blueprint $table) {
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('notification_id');
            $table->uuid('user_id');
            $table->timestampTz('read_at')->useCurrent();
            $table->primary(['notification_id', 'user_id']);
            $table->index(['user_id', 'notification_id']);
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('notification_id')->references('id')->on('notifications')->cascadeOnDelete();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
        });
        DB::statement("SELECT enable_tenant_rls('notification_reads')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON notification_reads FROM aycha_app');  // solo inserción

        // Las notificaciones de rol ya leídas por alguien vuelven a quedar sin leer para cada persona:
        // no se sabe quién de verdad las leyó.
        DB::statement('UPDATE notifications SET read_at = NULL WHERE user_id IS NULL AND read_at IS NOT NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('notification_reads');
    }
};
