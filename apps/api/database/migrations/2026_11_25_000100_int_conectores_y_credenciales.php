<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// INT-01 a INT-03: conectores y credenciales (RN-INT-01, RN-INT-02, RN-INT-03, RN-INT-19).
//  - El secreto cifrado por la aplicación no entra en 255 caracteres: pasa a texto.
//  - El motivo de revocación (mínimo 10 caracteres) y quién la cargó necesitan más espacio; la rotación guarda de qué
//    versión viene.
//  - Un conector tiene una sola credencial vigente por nombre (índice único parcial) y el adaptador falso nunca queda
//    en producción (CHECK). Los datos de demostración ya los cumplen.
//  - El conector guarda el motivo de su último cambio de estado.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE integration_credentials ALTER COLUMN secret_enc TYPE text');
        DB::statement('ALTER TABLE integration_credentials ALTER COLUMN revoked_reason TYPE varchar(300)');
        DB::statement('ALTER TABLE integration_credentials ALTER COLUMN created_by TYPE varchar(120)');
        Schema::table('integration_credentials', function (Blueprint $table) {
            $table->uuid('rotated_from')->nullable();
            $table->foreign('rotated_from')->references('id')->on('integration_credentials')->nullOnDelete();
        });
        DB::statement("ALTER TABLE integration_credentials ADD CONSTRAINT integration_credentials_estado CHECK (status IN ('ACTIVE','REVOKED'))");
        DB::statement('ALTER TABLE integration_credentials ADD CONSTRAINT integration_credentials_version CHECK (version >= 1)');
        DB::statement("CREATE UNIQUE INDEX integration_credentials_una_vigente ON integration_credentials (connector_id, name) WHERE status = 'ACTIVE'");

        Schema::table('integration_connectors', function (Blueprint $table) {
            $table->string('status_reason', 300)->nullable();
        });
        DB::statement("ALTER TABLE integration_connectors ADD CONSTRAINT integration_connectors_estado CHECK (status IN ('ACTIVE','DISABLED','ERROR','PENDING'))");
        DB::statement("ALTER TABLE integration_connectors ADD CONSTRAINT integration_connectors_entorno CHECK (environment IN ('PRODUCTION','SANDBOX'))");
        DB::statement("ALTER TABLE integration_connectors ADD CONSTRAINT integration_connectors_falso_solo_en_prueba CHECK (NOT (environment = 'PRODUCTION' AND adapter = 'FAKE'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE integration_connectors DROP CONSTRAINT IF EXISTS integration_connectors_falso_solo_en_prueba, DROP CONSTRAINT IF EXISTS integration_connectors_entorno, DROP CONSTRAINT IF EXISTS integration_connectors_estado');
        Schema::table('integration_connectors', fn (Blueprint $table) => $table->dropColumn('status_reason'));
        DB::statement('DROP INDEX IF EXISTS integration_credentials_una_vigente');
        DB::statement('ALTER TABLE integration_credentials DROP CONSTRAINT IF EXISTS integration_credentials_version, DROP CONSTRAINT IF EXISTS integration_credentials_estado');
        Schema::table('integration_credentials', function (Blueprint $table) {
            $table->dropForeign(['rotated_from']);
            $table->dropColumn('rotated_from');
        });
    }
};
