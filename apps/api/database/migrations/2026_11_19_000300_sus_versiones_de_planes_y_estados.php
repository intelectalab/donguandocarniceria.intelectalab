<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// SUS y OPS · consola, tanda 3: versiones de planes (SUS-09), suscripciones (SUS-11) y suspender o reactivar (OPS-04).
//  - saas_plan_versions: cada plan nace en borrador y se publica; publicado no cambia (RN-SUS-02), el cambio es una
//    versión nueva; retirado no vuelve. Lo asegura un trigger. saas_plans sigue siendo lo que lee la página pública y
//    el alta: refleja la versión publicada de cada plan.
//  - subscriptions: la versión del plan que contrató (la conserva hasta cambiar de plan) y el descuento pactado.
//  - Funciones guardadas: saas_plans, saas_plan_modules y tenants siguen siendo de solo lectura para la aplicación;
//    solo estas funciones los cambian, y solo a nombre de un usuario de plataforma activo con el rol que corresponde.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('saas_plan_versions', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->string('plan_code', 20);
            $table->unsignedSmallInteger('version');
            $table->string('status', 10)->default('DRAFT');
            $table->string('name', 40);
            $table->string('description', 300);
            $table->decimal('price_pen', 10, 2)->default(0);
            $table->unsignedSmallInteger('users_max');
            $table->unsignedSmallInteger('brands_max');
            $table->unsignedSmallInteger('sites_max');
            $table->boolean('all_modules')->default(false);
            $table->jsonb('modules')->default(DB::raw("'[]'::jsonb"));
            $table->jsonb('highlights')->default(DB::raw("'[]'::jsonb"));
            $table->string('includes_previous', 80)->nullable();
            $table->boolean('is_featured')->default(false);
            $table->unsignedSmallInteger('sort_order')->default(9);
            $table->uuid('created_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->timestampTz('published_at')->nullable();
            $table->uuid('published_by')->nullable();
            $table->timestampTz('retired_at')->nullable();
            $table->uuid('retired_by')->nullable();
            $table->unique(['plan_code', 'version']);
            $table->foreign('created_by')->references('id')->on('platform_users')->nullOnDelete();
        });
        DB::statement("ALTER TABLE saas_plan_versions ADD CONSTRAINT saas_plan_versions_estado CHECK (status IN ('DRAFT','PUBLISHED','RETIRED'))");
        DB::statement("ALTER TABLE saas_plan_versions ADD CONSTRAINT saas_plan_versions_codigo CHECK (plan_code ~ '^[A-Z][A-Z0-9_]{1,19}$')");
        DB::statement("ALTER TABLE saas_plan_versions ADD CONSTRAINT saas_plan_versions_listas CHECK (jsonb_typeof(modules) = 'array' AND jsonb_typeof(highlights) = 'array')");
        DB::statement("ALTER TABLE saas_plan_versions ADD CONSTRAINT saas_plan_versions_precio CHECK (price_pen >= 0 AND (status = 'DRAFT' OR price_pen > 0))");
        DB::statement('ALTER TABLE saas_plan_versions ADD CONSTRAINT saas_plan_versions_limites CHECK (users_max >= 1 AND brands_max >= 1 AND sites_max >= 1)');
        DB::statement("CREATE UNIQUE INDEX saas_plan_versions_una_publicada ON saas_plan_versions (plan_code) WHERE status = 'PUBLISHED'");
        DB::statement("CREATE UNIQUE INDEX saas_plan_versions_un_borrador ON saas_plan_versions (plan_code) WHERE status = 'DRAFT'");
        // RN-SUS-02: publicado no cambia (solo pasa a retirado) y retirado no cambia ni se borra.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION saas_plan_versions_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'RN-SUS-02: solo se borra un borrador' USING ERRCODE = '23514'; END IF;
                    RETURN OLD;
                END IF;
                IF OLD.status = 'RETIRED' THEN RAISE EXCEPTION 'RN-SUS-02: un plan retirado no cambia' USING ERRCODE = '23514'; END IF;
                IF OLD.status = 'PUBLISHED' AND (NEW.status <> 'RETIRED' OR NEW.price_pen <> OLD.price_pen OR NEW.modules <> OLD.modules
                    OR NEW.all_modules <> OLD.all_modules OR NEW.users_max <> OLD.users_max OR NEW.brands_max <> OLD.brands_max
                    OR NEW.sites_max <> OLD.sites_max OR NEW.plan_code <> OLD.plan_code OR NEW.version <> OLD.version) THEN
                    RAISE EXCEPTION 'RN-SUS-02: un plan publicado no cambia; crea una versión nueva' USING ERRCODE = '23514';
                END IF;
                IF OLD.status = 'DRAFT' AND NEW.status = 'RETIRED' THEN RAISE EXCEPTION 'RN-SUS-02: un borrador no se retira, se borra' USING ERRCODE = '23514'; END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER saas_plan_versions_inmutable BEFORE UPDATE OR DELETE ON saas_plan_versions
                FOR EACH ROW EXECUTE FUNCTION saas_plan_versions_inmutable();
            SQL);

        // Versión 1 publicada de cada plan que ya existe (los de la página pública).
        DB::statement(<<<'SQL'
            INSERT INTO saas_plan_versions (plan_code, version, status, name, description, price_pen, users_max, brands_max, sites_max,
                all_modules, modules, highlights, includes_previous, is_featured, sort_order, published_at)
            SELECT p.code, 1, CASE WHEN p.status = 'ACTIVE' THEN 'PUBLISHED' ELSE 'RETIRED' END, p.name, p.description, p.price_pen, p.users_max,
                   p.brands_max, p.sites_max, p.all_modules,
                   COALESCE((SELECT jsonb_agg(m.module_code ORDER BY m.module_code) FROM saas_plan_modules m WHERE m.plan_code = p.code), '[]'::jsonb),
                   p.highlights, p.includes_previous, p.is_featured, p.sort_order, COALESCE(p.created_at, now())
              FROM saas_plans p
            SQL);

        Schema::table('subscriptions', function (Blueprint $table) {
            $table->uuid('plan_version_id')->nullable();
            $table->decimal('discount_pct', 5, 2)->default(0);
            $table->string('discount_reason', 200)->nullable();
            $table->foreign('plan_version_id')->references('id')->on('saas_plan_versions')->restrictOnDelete();
        });
        DB::statement('ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_descuento CHECK (discount_pct >= 0 AND discount_pct <= 100)');
        DB::statement("UPDATE subscriptions s SET plan_version_id = v.id FROM saas_plan_versions v WHERE v.plan_code = s.plan_code AND v.status = 'PUBLISHED'");

        DB::unprepared(<<<'SQL'
            -- ¿El usuario de plataforma está activo y tiene uno de esos roles?
            CREATE OR REPLACE FUNCTION platform_actor_ok(p_actor uuid, p_roles text[]) RETURNS boolean
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
                SELECT EXISTS (SELECT 1 FROM platform_users WHERE id = p_actor AND status = 'ACTIVE' AND role = ANY (p_roles))
            $$;
            REVOKE ALL ON FUNCTION platform_actor_ok(uuid, text[]) FROM PUBLIC;

            -- SUS-09 · publicar un borrador: retira la versión publicada del mismo plan y deja saas_plans (lo que leen la
            -- página y el alta) con los datos de la versión nueva.
            CREATE OR REPLACE FUNCTION platform_publish_plan_version(p_version uuid, p_actor uuid) RETURNS void
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
            DECLARE v saas_plan_versions%ROWTYPE;
            BEGIN
                IF NOT platform_actor_ok(p_actor, ARRAY['PLATFORM_ADMIN','BILLING']) THEN
                    RAISE EXCEPTION 'Solo administración o cobranza de la plataforma publica planes' USING ERRCODE = '42501';
                END IF;
                SELECT * INTO v FROM saas_plan_versions WHERE id = p_version FOR UPDATE;
                IF NOT FOUND OR v.status <> 'DRAFT' THEN RAISE EXCEPTION 'RN-SUS-01: solo se publica un borrador' USING ERRCODE = '23514'; END IF;
                IF v.price_pen <= 0 OR (NOT v.all_modules AND jsonb_array_length(v.modules) = 0) THEN
                    RAISE EXCEPTION 'RN-SUS-01: el plan necesita precio y al menos un módulo' USING ERRCODE = '23514';
                END IF;
                UPDATE saas_plan_versions SET status = 'RETIRED', retired_at = now(), retired_by = p_actor WHERE plan_code = v.plan_code AND status = 'PUBLISHED';
                UPDATE saas_plan_versions SET status = 'PUBLISHED', published_at = now(), published_by = p_actor, updated_at = now() WHERE id = v.id;
                INSERT INTO saas_plans (code, name, description, price_pen, users_max, brands_max, sites_max, sort_order, is_featured, all_modules,
                                        includes_previous, highlights, status, created_at, updated_at)
                VALUES (v.plan_code, v.name, v.description, v.price_pen, v.users_max, v.brands_max, v.sites_max, v.sort_order, v.is_featured, v.all_modules,
                        v.includes_previous, v.highlights, 'ACTIVE', now(), now())
                ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, price_pen = EXCLUDED.price_pen,
                    users_max = EXCLUDED.users_max, brands_max = EXCLUDED.brands_max, sites_max = EXCLUDED.sites_max, sort_order = EXCLUDED.sort_order,
                    is_featured = EXCLUDED.is_featured, all_modules = EXCLUDED.all_modules, includes_previous = EXCLUDED.includes_previous,
                    highlights = EXCLUDED.highlights, status = 'ACTIVE', updated_at = now();
                DELETE FROM saas_plan_modules WHERE plan_code = v.plan_code;
                IF NOT v.all_modules THEN
                    INSERT INTO saas_plan_modules (plan_code, module_code) SELECT v.plan_code, jsonb_array_elements_text(v.modules);
                END IF;
            END $$;
            REVOKE ALL ON FUNCTION platform_publish_plan_version(uuid, uuid) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform_publish_plan_version(uuid, uuid) TO aycha_app;

            -- SUS-09 · retirar un plan: deja de venderse (página y alta); las suscripciones conservan su versión.
            CREATE OR REPLACE FUNCTION platform_retire_plan(p_plan text, p_actor uuid) RETURNS void
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
            BEGIN
                IF NOT platform_actor_ok(p_actor, ARRAY['PLATFORM_ADMIN','BILLING']) THEN
                    RAISE EXCEPTION 'Solo administración o cobranza de la plataforma retira planes' USING ERRCODE = '42501';
                END IF;
                UPDATE saas_plan_versions SET status = 'RETIRED', retired_at = now(), retired_by = p_actor WHERE plan_code = p_plan AND status = 'PUBLISHED';
                UPDATE saas_plans SET status = 'INACTIVE', updated_at = now() WHERE code = p_plan;
            END $$;
            REVOKE ALL ON FUNCTION platform_retire_plan(text, uuid) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform_retire_plan(text, uuid) TO aycha_app;

            -- OPS-04 · suspender o reactivar el acceso de una empresa (tenants.status: lo revisa cada petición).
            CREATE OR REPLACE FUNCTION platform_set_tenant_status(p_tenant uuid, p_status text, p_actor uuid) RETURNS void
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
            BEGIN
                IF NOT platform_actor_ok(p_actor, ARRAY['PLATFORM_ADMIN','BILLING']) THEN
                    RAISE EXCEPTION 'Solo administración o cobranza de la plataforma suspende o reactiva empresas' USING ERRCODE = '42501';
                END IF;
                IF p_status NOT IN ('ACTIVE','SUSPENDED') THEN RAISE EXCEPTION 'Estado de empresa no válido' USING ERRCODE = '23514'; END IF;
                UPDATE tenants SET status = p_status, updated_at = now() WHERE id = p_tenant;
            END $$;
            REVOKE ALL ON FUNCTION platform_set_tenant_status(uuid, text, uuid) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform_set_tenant_status(uuid, text, uuid) TO aycha_app;
            SQL);
        DB::statement("COMMENT ON TABLE saas_plan_versions IS 'global: versiones de los planes del SaaS (SUS-09)'");
    }

    public function down(): void
    {
        DB::unprepared('DROP FUNCTION IF EXISTS platform_set_tenant_status(uuid, text, uuid); DROP FUNCTION IF EXISTS platform_retire_plan(text, uuid);
            DROP FUNCTION IF EXISTS platform_publish_plan_version(uuid, uuid); DROP FUNCTION IF EXISTS platform_actor_ok(uuid, text[]);');
        DB::statement('ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_descuento');
        Schema::table('subscriptions', function (Blueprint $table) {
            $table->dropForeign(['plan_version_id']);
            $table->dropColumn(['plan_version_id', 'discount_pct', 'discount_reason']);
        });
        Schema::dropIfExists('saas_plan_versions');
        DB::unprepared('DROP FUNCTION IF EXISTS saas_plan_versions_inmutable()');
    }
};
