<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * API · la API pública en /api/publica/v1 y su uso (API-10; RN-API-04, 09, 11, 13 y 18).
 *
 *  - api_tenant_for_key(prefijo): la empresa de una clave, sin sesión (como auth_tenant_for_token). Solo devuelve la
 *    empresa; la huella del secreto se compara después, ya dentro de la empresa (RLS).
 *  - api_usage_daily: llamadas por clave y día (correctas, 4xx, 5xx, rechazadas por límite y por ruta).
 *  - api_requests: cada llamada (solo inserción): ruta, estado HTTP, tiempo, IP y código de error.
 *  - api_idempotency: la respuesta de cada escritura por su Idempotency-Key, para devolver la misma si se repite.
 *  - api_key_orders: qué clave creó cada pedido (solo inserción).
 *  - Parámetro api_calls_per_day: el límite de llamadas por día de la empresa (decisión del 25/11/2026).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION api_tenant_for_key(p_prefix text) RETURNS uuid
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
                AS $$ SELECT k.tenant_id FROM api_keys k JOIN tenants t ON t.id = k.tenant_id WHERE k.prefix = p_prefix AND t.status = 'ACTIVE' $$
        SQL);
        DB::statement('REVOKE ALL ON FUNCTION api_tenant_for_key(text) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION api_tenant_for_key(text) TO aycha_app');

        Schema::create('api_usage_daily', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('key_id');
            $table->string('environment', 10);
            $table->date('day');
            $table->integer('calls')->default(0);
            $table->integer('ok_2xx')->default(0);
            $table->integer('err_4xx')->default(0);
            $table->integer('err_5xx')->default(0);
            $table->integer('rejected_limit')->default(0);
            $table->jsonb('by_route')->default(DB::raw("'{}'::jsonb"));
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('key_id')->references('id')->on('api_keys')->restrictOnDelete();
        });
        DB::statement('CREATE UNIQUE INDEX api_usage_daily_dia ON api_usage_daily (key_id, day)');
        DB::statement('CREATE INDEX api_usage_daily_empresa_dia ON api_usage_daily (tenant_id, environment, day)');
        DB::statement('ALTER TABLE api_usage_daily ADD CONSTRAINT api_usage_daily_cuentas CHECK (calls >= 0 AND ok_2xx >= 0 AND err_4xx >= 0 AND err_5xx >= 0 AND rejected_limit >= 0 AND ok_2xx + err_4xx + err_5xx <= calls AND rejected_limit <= err_4xx)');
        DB::statement("SELECT enable_tenant_rls('api_usage_daily')");
        DB::statement('REVOKE DELETE, TRUNCATE ON api_usage_daily FROM aycha_app');

        Schema::create('api_requests', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('key_id');
            $table->string('request_id', 40);
            $table->string('method', 10);
            $table->string('path', 255);
            $table->string('route', 80)->nullable();
            $table->smallInteger('status');
            $table->integer('ms');
            $table->string('ip', 45);
            $table->string('code', 20)->nullable();
            $table->boolean('replayed')->default(false);
            $table->timestampTz('at')->default(DB::raw('clock_timestamp()'));
            $table->index('tenant_id');
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('key_id')->references('id')->on('api_keys')->restrictOnDelete();
        });
        DB::statement('CREATE INDEX api_requests_clave ON api_requests (key_id, at DESC)');
        DB::statement("SELECT enable_tenant_rls('api_requests')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON api_requests FROM aycha_app');   // solo inserción

        Schema::create('api_idempotency', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('key_id');
            $table->string('idem_key', 80);
            $table->char('request_hash', 64);
            $table->smallInteger('response_code');
            $table->jsonb('response_body');
            $table->integer('replays')->default(0);
            $table->timestampTz('expires_at');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('key_id')->references('id')->on('api_keys')->restrictOnDelete();
        });
        DB::statement('CREATE UNIQUE INDEX api_idempotency_clave ON api_idempotency (key_id, idem_key)');
        DB::statement("SELECT enable_tenant_rls('api_idempotency')");
        DB::statement('REVOKE DELETE, TRUNCATE ON api_idempotency FROM aycha_app');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION api_idempotencia_no_cambia() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF NEW.key_id IS DISTINCT FROM OLD.key_id OR NEW.idem_key IS DISTINCT FROM OLD.idem_key OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
                   OR NEW.response_code IS DISTINCT FROM OLD.response_code OR NEW.response_body IS DISTINCT FROM OLD.response_body THEN
                    RAISE EXCEPTION 'RN-API-13: la respuesta guardada de una escritura no cambia';
                END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER api_idempotencia_no_cambia BEFORE UPDATE ON api_idempotency FOR EACH ROW EXECUTE FUNCTION api_idempotencia_no_cambia();
        SQL);

        Schema::create('api_key_orders', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('key_id');
            $table->uuid('order_id');
            $table->timestampTz('created_at')->useCurrent();
            $table->index('tenant_id');
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('key_id')->references('id')->on('api_keys')->restrictOnDelete();
            $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete();
        });
        DB::statement('CREATE UNIQUE INDEX api_key_orders_pedido ON api_key_orders (order_id)');
        DB::statement('CREATE INDEX api_key_orders_clave ON api_key_orders (key_id)');
        DB::statement("SELECT enable_tenant_rls('api_key_orders')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON api_key_orders FROM aycha_app');   // solo inserción

        DB::statement(<<<'SQL'
            INSERT INTO parameter_definitions (key, module_code, value_type, default_value, min_value, max_value, allowed_scopes, unit, description)
            VALUES ('api_calls_per_day', 'API', 'INT', 10000, 0, 1000000, '["TENANT"]'::jsonb, 'llamadas', 'Llamadas por día de la API (producción); las rechazadas por límite no cuentan')
            ON CONFLICT (key) DO NOTHING
            SQL);
    }

    public function down(): void
    {
        DB::statement("DELETE FROM parameter_definitions WHERE key = 'api_calls_per_day'");
        foreach (['api_key_orders', 'api_idempotency', 'api_requests', 'api_usage_daily'] as $t) {
            DB::statement("DROP TABLE IF EXISTS {$t} CASCADE");
        }
        DB::statement('DROP FUNCTION IF EXISTS api_idempotencia_no_cambia()');
        DB::statement('DROP FUNCTION IF EXISTS api_tenant_for_key(text)');
    }
};
