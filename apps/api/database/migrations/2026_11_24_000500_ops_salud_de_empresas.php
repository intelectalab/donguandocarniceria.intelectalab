<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// OPS-02 y OPS-03: salud ponderada de cada empresa (RN-OPS-13), de 0 a 100.
//  - tenant_health_snapshots: una foto por empresa y día (la tarea diaria y «Recalcular salud» la reemplazan en el
//    mismo día), para la evolución en la ficha. Solo la consola la ve y la escribe: la empresa no ve su puntaje.
//  - Parámetros: peso de cada parte (actividad, cobro y soporte; OSE y WhatsApp se suman cuando existan esas
//    integraciones) y los cortes de «en riesgo» y «crítica».
return new class extends Migration
{
    private const PARAMETROS = [
        'ops_health_weight_activity' => [40, 'Peso de la actividad (último ingreso de sus usuarios) en la salud de cada empresa'],
        'ops_health_weight_billing' => [35, 'Peso del cobro (estado de la suscripción y días de mora) en la salud de cada empresa'],
        'ops_health_weight_support' => [25, 'Peso del soporte (tickets abiertos y urgentes) en la salud de cada empresa'],
        'ops_health_risk_below' => [70, 'Salud debajo de la cual una empresa queda «en riesgo»'],
        'ops_health_critical_below' => [40, 'Salud debajo de la cual una empresa queda «crítica»'],
    ];

    public function up(): void
    {
        Schema::create('tenant_health_snapshots', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('tenant_id');
            $table->date('day');
            $table->unsignedSmallInteger('score');
            $table->string('level', 10);
            $table->jsonb('parts');
            $table->timestampTz('taken_at');
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->unique(['tenant_id', 'day']);
        });
        DB::statement('ALTER TABLE tenant_health_snapshots ADD CONSTRAINT tenant_health_snapshots_puntaje CHECK (score BETWEEN 0 AND 100)');
        DB::statement("ALTER TABLE tenant_health_snapshots ADD CONSTRAINT tenant_health_snapshots_nivel CHECK (level IN ('HEALTHY','AT_RISK','CRITICAL'))");
        DB::statement('ALTER TABLE tenant_health_snapshots ENABLE ROW LEVEL SECURITY');
        DB::statement('CREATE POLICY solo_consola ON tenant_health_snapshots USING (app_is_platform()) WITH CHECK (app_is_platform())');
        DB::statement('REVOKE DELETE, TRUNCATE ON tenant_health_snapshots FROM aycha_app');

        foreach (self::PARAMETROS as $key => [$valor, $descripcion]) {
            DB::table('platform_parameters')->insertOrIgnore(['key' => $key, 'value' => json_encode($valor), 'description' => $descripcion, 'updated_at' => now()]);
        }
    }

    public function down(): void
    {
        DB::table('platform_parameters')->whereIn('key', array_keys(self::PARAMETROS))->delete();
        Schema::dropIfExists('tenant_health_snapshots');
    }
};
