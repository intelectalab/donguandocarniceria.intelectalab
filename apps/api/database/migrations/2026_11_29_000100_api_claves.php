<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * API · claves y catálogo (API-01, 02, 03 y 11; RN-API-01 a 04, 10 y 17).
 *
 *  - api_scopes y api_event_types: catálogo de la plataforma (la app solo lee).
 *  - api_keys: por empresa (RLS). Se guarda el prefijo y la huella SHA-256 del secreto, nunca el secreto. El prefijo es
 *    único en toda la plataforma (identifica a la empresa). La clave siempre vence; una revocada no vuelve, con motivo.
 *    Prefijo, huella, entorno, alcances, marcas y cliente no cambian (para eso se crea otra clave); el vencimiento solo se
 *    acorta. Las claves no se borran.
 *  - Los parámetros api_key_default_days y api_key_max_days ya vienen en el catálogo de parámetros.
 */
return new class extends Migration
{
    private const ALCANCES = [
        ['orders:read', 'Leer pedidos', 'PED', 'Pedidos con estado, líneas, pesos y totales.'],
        ['orders:write', 'Crear pedidos', 'PED', 'Crear pedidos con Idempotency-Key y pedir su comprobante.'],
        ['customers:read', 'Leer clientes', 'CLI', 'Clientes con documento, contacto y direcciones.'],
        ['customers:write', 'Crear clientes', 'CLI', 'Registrar clientes nuevos (RUC o DNI válidos).'],
        ['products:read', 'Leer catálogo', 'CAT', 'Presentaciones vendibles: SKU, modo de venta y peso nominal.'],
        ['prices:read', 'Leer precios', 'CAT', 'Precio vigente con IGV de la lista del canal de la clave.'],
        ['stock:read', 'Leer stock', 'ALM', 'Disponible por SKU en almacenes de venta (sin reservas).'],
        ['documents:read', 'Leer comprobantes', 'FAC', 'Facturas, boletas y notas con su estado SUNAT.'],
        ['payments:read', 'Leer cobros', 'CAJ', 'Cobros confirmados y su aplicación a pedidos.'],
        ['deliveries:read', 'Leer entregas', 'DEL', 'Pedidos en ruta, entregados y no entregados.'],
        ['webhooks:write', 'Gestionar webhooks', 'API', 'Crear y listar destinos de webhooks desde la API.'],
    ];

    private const EVENTOS = [
        ['order.created', 'PED', 'orders:read', 'Pedido creado en cualquier canal', 'v1', 'ACTIVE'],
        ['order.confirmed', 'PED', 'orders:read', 'Pedido confirmado con datos completos', 'v1', 'ACTIVE'],
        ['order.dispatched', 'DEL', 'deliveries:read', 'Pedido salió a reparto', 'v1', 'ACTIVE'],
        ['order.delivered', 'DEL', 'orders:read', 'Pedido entregado al cliente', 'v1', 'ACTIVE'],
        ['order.not_delivered', 'DEL', 'deliveries:read', 'Entrega fallida con motivo', 'v1', 'ACTIVE'],
        ['order.cancelled', 'PED', 'orders:read', 'Pedido cancelado', 'v1', 'ACTIVE'],
        ['document.accepted', 'FAC', 'documents:read', 'Comprobante aceptado por SUNAT u OSE', 'v1', 'ACTIVE'],
        ['document.rejected', 'FAC', 'documents:read', 'Comprobante rechazado por SUNAT u OSE', 'v1', 'ACTIVE'],
        ['payment.confirmed', 'CAJ', 'payments:read', 'Cobro confirmado', 'v1', 'ACTIVE'],
        ['payment.reversed', 'CAJ', 'payments:read', 'Cobro revertido', 'v1', 'ACTIVE'],
        ['stock.low', 'ALM', 'stock:read', 'Disponible bajo el mínimo de la presentación', 'v1', 'ACTIVE'],
        ['order.updated', 'PED', 'orders:read', 'Retirado: se reemplazó por los eventos de cada estado', 'v0', 'RETIRED'],
    ];

    public function up(): void
    {
        Schema::create('api_scopes', function (Blueprint $table) {
            $table->string('code', 40)->primary();
            $table->string('name', 80);
            $table->string('module_code', 20);
            $table->string('description', 255);
            $table->boolean('is_write');
            $table->integer('sort_order');
            $table->timestampTz('created_at')->useCurrent();
        });
        Schema::create('api_event_types', function (Blueprint $table) {
            $table->string('code', 60)->primary();
            $table->string('module_code', 20);
            $table->string('scope_code', 40);
            $table->string('description', 255);
            $table->string('version', 10);
            $table->string('status', 20);
            $table->date('retired_at')->nullable();
            $table->integer('sort_order');
            $table->timestampTz('created_at')->useCurrent();
            $table->foreign('scope_code')->references('code')->on('api_scopes')->restrictOnDelete();
        });
        DB::statement("ALTER TABLE api_event_types ADD CONSTRAINT api_event_types_estado CHECK (status IN ('ACTIVE','RETIRED') AND ((status = 'RETIRED') = (retired_at IS NOT NULL)))");
        foreach (self::ALCANCES as $i => [$code, $name, $mod, $desc]) {
            DB::table('api_scopes')->insert(['code' => $code, 'name' => $name, 'module_code' => $mod, 'description' => $desc, 'is_write' => str_ends_with($code, ':write'), 'sort_order' => $i + 1]);
        }
        foreach (self::EVENTOS as $i => [$code, $mod, $scope, $desc, $ver, $st]) {
            DB::table('api_event_types')->insert(['code' => $code, 'module_code' => $mod, 'scope_code' => $scope, 'description' => $desc, 'version' => $ver, 'status' => $st,
                'retired_at' => $st === 'RETIRED' ? '2026-08-01' : null, 'sort_order' => $i + 1]);
        }
        foreach (['api_scopes', 'api_event_types'] as $t) {
            DB::statement("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON {$t} FROM aycha_app");   // catálogo de plataforma
        }

        Schema::create('api_keys', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('name', 120);
            $table->string('description', 500)->nullable();
            $table->string('environment', 10);
            $table->string('prefix', 20);
            $table->char('secret_hash', 64);
            $table->string('hash_algo', 20)->default('SHA-256');
            $table->jsonb('scopes');
            $table->jsonb('brand_ids')->default(DB::raw("'[]'::jsonb"));
            $table->jsonb('allowed_ips')->default(DB::raw("'[]'::jsonb"));
            $table->uuid('customer_id')->nullable();
            $table->string('channel', 20);
            $table->date('expires_at');
            $table->string('status', 20)->default('ACTIVE');
            $table->uuid('created_by');
            $table->timestampTz('revoked_at')->nullable();
            $table->uuid('revoked_by')->nullable();
            $table->string('revoke_reason', 500)->nullable();
            $table->timestampTz('last_used_at')->nullable();
            $table->string('last_ip', 45)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete();
            $table->foreign('created_by')->references('id')->on('users')->restrictOnDelete();
            $table->foreign('revoked_by')->references('id')->on('users')->restrictOnDelete();
        });
        DB::statement('CREATE UNIQUE INDEX api_keys_prefijo ON api_keys (prefix)');   // único en toda la plataforma (RN-API-04)
        DB::statement("ALTER TABLE api_keys ADD CONSTRAINT api_keys_entorno CHECK (environment IN ('LIVE','TEST'))");
        DB::statement("ALTER TABLE api_keys ADD CONSTRAINT api_keys_prefijo_formato CHECK (prefix ~ '^ak_(live|test)_[a-z0-9]{8}$' AND (environment = 'LIVE') = (prefix LIKE 'ak_live_%'))");
        DB::statement("ALTER TABLE api_keys ADD CONSTRAINT api_keys_huella CHECK (secret_hash ~ '^[0-9a-f]{64}$')");
        DB::statement("ALTER TABLE api_keys ADD CONSTRAINT api_keys_alcances CHECK (jsonb_typeof(scopes) = 'array' AND jsonb_array_length(scopes) > 0 AND jsonb_typeof(brand_ids) = 'array' AND jsonb_typeof(allowed_ips) = 'array')");
        DB::statement("ALTER TABLE api_keys ADD CONSTRAINT api_keys_canal CHECK (channel IN ('B2B','WEB','OTHER'))");
        DB::statement("ALTER TABLE api_keys ADD CONSTRAINT api_keys_estado CHECK (status IN ('ACTIVE','REVOKED'))");
        DB::statement("ALTER TABLE api_keys ADD CONSTRAINT api_keys_revocada CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL) AND (status <> 'REVOKED' OR (revoked_by IS NOT NULL AND length(btrim(coalesce(revoke_reason, ''))) >= 10)))");
        DB::statement('ALTER TABLE api_keys ADD CONSTRAINT api_keys_vence CHECK (expires_at > (created_at AT TIME ZONE \'America/Lima\')::date)');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION api_clave_no_cambia() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF NEW.prefix IS DISTINCT FROM OLD.prefix OR NEW.secret_hash IS DISTINCT FROM OLD.secret_hash OR NEW.environment IS DISTINCT FROM OLD.environment
                   OR NEW.scopes IS DISTINCT FROM OLD.scopes OR NEW.brand_ids IS DISTINCT FROM OLD.brand_ids OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
                   OR NEW.channel IS DISTINCT FROM OLD.channel OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
                   OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
                    RAISE EXCEPTION 'RN-API-10: el secreto, el prefijo, el entorno, los alcances, las marcas y el cliente de una clave no cambian: crea otra clave';
                END IF;
                IF NEW.expires_at > OLD.expires_at THEN
                    RAISE EXCEPTION 'RN-API-02: el vencimiento de una clave no se extiende: crea otra clave';
                END IF;
                IF OLD.status = 'REVOKED' AND (NEW.status <> 'REVOKED' OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoke_reason IS DISTINCT FROM OLD.revoke_reason
                   OR NEW.name IS DISTINCT FROM OLD.name OR NEW.allowed_ips IS DISTINCT FROM OLD.allowed_ips OR NEW.expires_at IS DISTINCT FROM OLD.expires_at) THEN
                    RAISE EXCEPTION 'RN-API-10: una clave revocada no se reactiva ni se edita';
                END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER api_clave_no_cambia BEFORE UPDATE ON api_keys FOR EACH ROW EXECUTE FUNCTION api_clave_no_cambia();
        SQL);
        DB::statement("SELECT enable_tenant_rls('api_keys')");
        DB::statement('REVOKE DELETE, TRUNCATE ON api_keys FROM aycha_app');   // las claves no se borran
        DB::statement("SELECT audit.track('api_keys')");                       // sus cambios se ven en AUD-01
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS api_keys CASCADE');
        DB::statement('DROP FUNCTION IF EXISTS api_clave_no_cambia()');
        DB::statement('DROP TABLE IF EXISTS api_event_types CASCADE');
        DB::statement('DROP TABLE IF EXISTS api_scopes CASCADE');
    }
};
