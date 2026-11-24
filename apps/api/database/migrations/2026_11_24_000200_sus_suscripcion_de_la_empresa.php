<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// SUS · la suscripción vista por la empresa: SUS-01, SUS-04 a SUS-08.
//  - RN-SUS-17: cancelar es al fin del período pagado (el primer día del siguiente se aplica sola). Se guarda el motivo
//    y la respuesta de la encuesta; mientras no llegue la fecha, la empresa puede deshacerlo.
//  - Datos de facturación del medio de pago (correo) junto al token, que ya existía.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('subscriptions', function (Blueprint $table) {
            $table->boolean('cancel_at_period_end')->default(false);
            $table->date('cancel_effective_on')->nullable();
            $table->string('cancel_reason', 300)->nullable();
            $table->string('cancel_survey', 30)->nullable();
            $table->uuid('cancel_requested_by')->nullable();
        });
        DB::statement('ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_cancelacion CHECK (NOT cancel_at_period_end OR cancel_effective_on IS NOT NULL)');

        DB::table('platform_parameters')->insertOrIgnore(['key' => 'sus_data_retention_days', 'value' => json_encode(90),
            'description' => 'Días que se conservan los datos de una empresa cancelada, en solo lectura y con exportación', 'updated_at' => now()]);
    }

    public function down(): void
    {
        DB::table('platform_parameters')->where('key', 'sus_data_retention_days')->delete();
        DB::statement('ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_cancelacion');
        Schema::table('subscriptions', fn (Blueprint $t) => $t->dropColumn(['cancel_at_period_end', 'cancel_effective_on', 'cancel_reason', 'cancel_survey', 'cancel_requested_by']));
    }
};
