<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// ALM · RN-ALM-01 en la base: stock_balances y stock_movements solo se escriben con la acción única
// de inventario. InventarioService valida las reglas y llama a alm_inventory_move(); ReservasService
// llama a alm_reserve_adjust(). aycha_app ya no puede escribir esas tablas directamente (CA-ALM-08).
//
// Las funciones son SECURITY DEFINER de un rol propio (aycha_alm_inventario), sin login y SIN
// BYPASSRLS, que no es dueño de las tablas: así RLS sigue filtrando por app_tenant_id() dentro de
// ellas. Si fueran del dueño de las tablas (o de un superusuario), RLS no se aplicaría.
// El rol es del servidor, no de la base: migrate:fresh y down() no lo borran.
return new class extends Migration
{
    private const ROL = 'aycha_alm_inventario';

    private const SIN_LOTE = "'00000000-0000-0000-0000-000000000000'::uuid";

    public function up(): void
    {
        $rol = self::ROL;
        DB::statement(<<<SQL
            DO \$\$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{$rol}') THEN
                    CREATE ROLE {$rol} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
                END IF;
                -- Para poder darle la función, quien migra debe poder actuar como el rol.
                IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
                    EXECUTE format('GRANT {$rol} TO %I', current_user);
                END IF;
            END
            \$\$
        SQL);

        DB::statement("GRANT USAGE ON SCHEMA public TO {$rol}");
        DB::statement("GRANT SELECT, INSERT, UPDATE ON stock_balances TO {$rol}");
        DB::statement("GRANT SELECT, INSERT ON stock_movements TO {$rol}");
        DB::statement("GRANT SELECT ON warehouses, product_variants, lots TO {$rol}");

        $sinLote = self::SIN_LOTE;
        DB::statement(<<<SQL
            CREATE OR REPLACE FUNCTION alm_inventory_move(
                p_type text, p_warehouse uuid, p_variant uuid, p_lot uuid, p_qty numeric, p_weight numeric,
                p_unit_cost numeric, p_reserved_delta numeric, p_source_type text, p_source_id uuid,
                p_moved_at timestamptz, p_reason text, p_user_id uuid, p_user_name text, p_reversal_of uuid,
                p_check_available boolean DEFAULT false
            ) RETURNS uuid
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
            AS \$\$
            DECLARE
                b stock_balances%ROWTYPE;
                v_unit numeric;
                v_qty numeric;
                v_avg numeric;
                v_res numeric;
                v_id uuid;
            BEGIN
                IF app_tenant_id() IS NULL THEN
                    RAISE EXCEPTION 'RN-ALM-01: no hay empresa en el contexto.';
                END IF;
                IF p_qty IS NULL OR p_qty = 0 THEN
                    RAISE EXCEPTION 'RN-ALM-01: la cantidad debe ser distinta de cero.';
                END IF;
                -- RLS filtra estas lecturas: un id de otra empresa no se encuentra.
                PERFORM 1 FROM warehouses WHERE id = p_warehouse;
                IF NOT FOUND THEN RAISE EXCEPTION 'RN-ALM-01: almacén no encontrado.'; END IF;
                PERFORM 1 FROM product_variants WHERE id = p_variant;
                IF NOT FOUND THEN RAISE EXCEPTION 'RN-ALM-01: producto no encontrado.'; END IF;
                IF p_lot IS NOT NULL THEN
                    PERFORM 1 FROM lots WHERE id = p_lot AND variant_id = p_variant;
                    IF NOT FOUND THEN RAISE EXCEPTION 'RN-ALM-08: el lote no es de ese producto.'; END IF;
                END IF;

                INSERT INTO stock_balances (warehouse_id, variant_id, lot_id, qty, weight_kg, reserved_qty, avg_cost)
                VALUES (p_warehouse, p_variant, p_lot, 0, 0, 0, 0)
                ON CONFLICT (tenant_id, warehouse_id, variant_id, (COALESCE(lot_id, {$sinLote}))) DO NOTHING;

                SELECT * INTO b FROM stock_balances
                 WHERE warehouse_id = p_warehouse AND variant_id = p_variant AND lot_id IS NOT DISTINCT FROM p_lot
                 FOR UPDATE;

                v_qty := b.qty + p_qty;
                IF v_qty < 0 THEN
                    RAISE EXCEPTION 'RN-ALM-03: stock insuficiente: hay % y se piden %.', b.qty, -p_qty;
                END IF;
                IF p_qty > 0 AND p_type <> 'REVERSAL' THEN
                    v_unit := COALESCE(p_unit_cost, NULLIF(b.avg_cost, 0), (SELECT std_cost FROM product_variants WHERE id = p_variant), 0);
                    v_avg := CASE WHEN v_qty > 0 THEN round((b.qty * b.avg_cost + p_qty * v_unit) / v_qty, 4) ELSE v_unit END;
                ELSE
                    v_unit := COALESCE(p_unit_cost, NULLIF(b.avg_cost, 0), (SELECT std_cost FROM product_variants WHERE id = p_variant), 0);
                    v_avg := CASE WHEN b.avg_cost = 0 THEN v_unit ELSE b.avg_cost END;
                END IF;

                -- RN-ALM-09: una salida que no consume reservas solo usa el disponible (saldo − reservado).
                IF p_check_available AND p_qty < 0 AND b.qty - b.reserved_qty + p_qty < 0 THEN
                    RAISE EXCEPTION 'RN-ALM-09: solo hay % disponibles: de % en saldo, % están reservados para pedidos confirmados.',
                        GREATEST(0, b.qty - b.reserved_qty), b.qty, b.reserved_qty;
                END IF;
                v_res := b.reserved_qty + COALESCE(p_reserved_delta, 0);
                IF v_res < 0 THEN v_res := 0; END IF;
                IF COALESCE(p_reserved_delta, 0) > 0 AND v_res > v_qty THEN
                    RAISE EXCEPTION 'RN-ALM-03: la reserva (%) superaría el saldo (%).', v_res, v_qty;
                END IF;

                UPDATE stock_balances
                   SET qty = v_qty,
                       weight_kg = GREATEST(0, weight_kg + COALESCE(p_weight, 0)),
                       reserved_qty = v_res,
                       avg_cost = v_avg,
                       updated_at = now()
                 WHERE id = b.id;

                INSERT INTO stock_movements (warehouse_id, variant_id, lot_id, movement_type, qty, weight_kg, unit_cost, total_cost,
                                             source_type, source_id, moved_at, reason, "user", user_id, bal_qty, reversal_of)
                VALUES (p_warehouse, p_variant, p_lot, p_type, p_qty, p_weight, round(v_unit, 4), round(p_qty * v_unit, 2),
                        p_source_type, p_source_id, COALESCE(p_moved_at, now()), p_reason, COALESCE(p_user_name, 'Sistema'), p_user_id, v_qty, p_reversal_of)
                RETURNING id INTO v_id;

                RETURN v_id;
            END
            \$\$
        SQL);

        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION alm_reserve_adjust(p_balance uuid, p_delta numeric) RETURNS numeric
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
            AS $$
            DECLARE
                b stock_balances%ROWTYPE;
                v_res numeric;
            BEGIN
                SELECT * INTO b FROM stock_balances WHERE id = p_balance FOR UPDATE;
                IF NOT FOUND THEN RAISE EXCEPTION 'RN-ALM-09: saldo no encontrado.'; END IF;
                v_res := b.reserved_qty + p_delta;
                IF v_res < 0 THEN v_res := 0; END IF;
                IF p_delta > 0 AND v_res > b.qty THEN
                    RAISE EXCEPTION 'RN-ALM-03: la reserva (%) superaría el saldo (%).', v_res, b.qty;
                END IF;
                UPDATE stock_balances SET reserved_qty = v_res, updated_at = now() WHERE id = b.id;
                RETURN v_res;
            END
            $$
        SQL);

        $firmaMove = 'alm_inventory_move(text, uuid, uuid, uuid, numeric, numeric, numeric, numeric, text, uuid, timestamptz, text, uuid, text, uuid, boolean)';
        $firmaRes = 'alm_reserve_adjust(uuid, numeric)';
        foreach ([$firmaMove, $firmaRes] as $f) {
            // Para ser dueño de una función, el rol necesita CREATE en el esquema solo en este momento.
            DB::statement("GRANT CREATE ON SCHEMA public TO {$rol}");
            DB::statement("ALTER FUNCTION {$f} OWNER TO {$rol}");
            DB::statement("REVOKE CREATE ON SCHEMA public FROM {$rol}");
            DB::statement("REVOKE ALL ON FUNCTION {$f} FROM PUBLIC");
            DB::statement("GRANT EXECUTE ON FUNCTION {$f} TO aycha_app");
        }

        // RN-ALM-01: la app ya no escribe directo. La lectura sigue igual.
        DB::statement('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON stock_balances FROM aycha_app');
        DB::statement('REVOKE INSERT ON stock_movements FROM aycha_app');
    }

    public function down(): void
    {
        DB::statement('GRANT INSERT, UPDATE, DELETE ON stock_balances TO aycha_app');
        DB::statement('GRANT INSERT ON stock_movements TO aycha_app');
        DB::statement('DROP FUNCTION IF EXISTS alm_inventory_move(text, uuid, uuid, uuid, numeric, numeric, numeric, numeric, text, uuid, timestamptz, text, uuid, text, uuid, boolean)');
        DB::statement('DROP FUNCTION IF EXISTS alm_reserve_adjust(uuid, numeric)');
        $rol = self::ROL;
        DB::statement("REVOKE ALL ON stock_balances, stock_movements, warehouses, product_variants, lots FROM {$rol}");
        DB::statement("REVOKE USAGE ON SCHEMA public FROM {$rol}");
    }
};
