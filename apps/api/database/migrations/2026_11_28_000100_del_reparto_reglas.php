<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// DEL · Reparto: rutas, app del repartidor, terceros, provincia y costo por entrega. Ajustes del dueño
// del módulo sobre las tablas generadas (2026_11_03_001300_del_delivery.php), sin editar esa migración.
// Todo es compatible con los datos de demostración (migrate:fresh --seed siembra después de migrar).
//  - Rutas: una ruta planificada aún no tiene salida ni franja; estados, modalidad y código único por día.
//    RN-DEL-01 en la base: una ruta que salió tiene vehículo y repartidor, o empresa de delivery.
//  - Paradas: RN-DEL-02 (no se repite el número de parada en la ruta y un pedido tiene una sola parada
//    activa), estados y motivos de no entrega; el código de entrega se genera al salir.
//  - Eventos de la app: de solo inserción (ya lo eran), con un id del teléfono único por empresa para no
//    duplicarse al sincronizar (RN-DEL-06, CA-DEL-09), quién lo registró y el monto como número.
//  - Enlace de seguimiento: token único; del_tracking_tenant() devuelve solo la empresa del enlace (RN-DEL-08).
//  - Tarifas, facturas de terceros, envíos a provincia y costos: estados, bases y montos como número.
//    RN-DEL-13: todo costo tiene al menos un destino; el combustible, vehículo, galones y vale.
//  - Vehículos: SOAT y revisión técnica pueden faltar (RN-DEL-03 avisa «sin registrar»); placa única.
//  - driver_settlements (CAJ aún no existe): la diferencia y lo digital esperado eran enteros; pasan a montos.
//  - Ampliación DEL-17 a DEL-22: gastos del repartidor, mensajes a control, pedidos de apoyo y derivaciones
//    a motorizado externo (tablas nuevas), y en customer_addresses cuándo se pidió la ubicación y la nota
//    de la confirmación (RN-DEL-14).
return new class extends Migration
{
    public function up(): void
    {
        // Rutas
        DB::statement(<<<'SQL'
            ALTER TABLE delivery_routes
              ALTER COLUMN slot_from DROP NOT NULL,
              ALTER COLUMN slot_to DROP NOT NULL,
              ALTER COLUMN departed_at DROP NOT NULL,
              ALTER COLUMN status SET DEFAULT 'PLANNED',
              ALTER COLUMN mode SET DEFAULT 'OWN',
              ALTER COLUMN sequence_method SET DEFAULT 'NEAREST_NEIGHBOR',
              ALTER COLUMN planned_km SET DEFAULT 0,
              ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
              ADD COLUMN IF NOT EXISTS cancel_reason varchar(255)
        SQL);
        DB::statement("ALTER TABLE delivery_routes ADD CONSTRAINT delivery_routes_status_check CHECK (status IN ('PLANNED','LOADING','IN_ROUTE','RETURNED','SETTLED','CANCELLED'))");
        DB::statement("ALTER TABLE delivery_routes ADD CONSTRAINT delivery_routes_mode_check CHECK (mode IN ('OWN','RENTED','THIRD_PARTY'))");
        DB::statement("ALTER TABLE delivery_routes ADD CONSTRAINT delivery_routes_sequence_check CHECK (sequence_method IN ('NEAREST_NEIGHBOR','MANUAL'))");
        DB::statement("ALTER TABLE delivery_routes ADD CONSTRAINT delivery_routes_pay_mode_check CHECK (driver_pay_mode IS NULL OR driver_pay_mode IN ('DAILY','PER_DELIVERY'))");
        DB::statement('ALTER TABLE delivery_routes ADD CONSTRAINT delivery_routes_odometro_check CHECK (odometer_end IS NULL OR odometer_start IS NULL OR odometer_end >= odometer_start)');
        // RN-DEL-01: la ruta que salió lleva vehículo y repartidor (propia o alquilada) o la empresa de delivery (tercero).
        DB::statement(<<<'SQL'
            ALTER TABLE delivery_routes ADD CONSTRAINT delivery_routes_asignada_check CHECK (
              status NOT IN ('IN_ROUTE','RETURNED','SETTLED')
              OR (mode = 'THIRD_PARTY' AND carrier_supplier_id IS NOT NULL)
              OR (mode <> 'THIRD_PARTY' AND vehicle_id IS NOT NULL AND driver_user_id IS NOT NULL))
        SQL);
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS delivery_routes_codigo_unico ON delivery_routes (tenant_id, route_date, code)');
        DB::statement('CREATE INDEX IF NOT EXISTS delivery_routes_fecha_idx ON delivery_routes (tenant_id, route_date, status)');

        // Paradas
        DB::statement(<<<'SQL'
            ALTER TABLE delivery_stops
              ALTER COLUMN eta DROP NOT NULL,
              ALTER COLUMN delivery_code DROP NOT NULL,
              ALTER COLUMN distance_km DROP NOT NULL,
              ALTER COLUMN status SET DEFAULT 'PENDING',
              ALTER COLUMN cod_amount SET DEFAULT 0,
              ALTER COLUMN collected_amount SET DEFAULT 0,
              ALTER COLUMN bags SET DEFAULT '[]'::jsonb,
              ALTER COLUMN kg SET DEFAULT 0,
              ADD COLUMN IF NOT EXISTS notes varchar(255),
              ADD COLUMN IF NOT EXISTS support_from varchar(40),
              ADD COLUMN IF NOT EXISTS handoff_id uuid,
              ADD COLUMN IF NOT EXISTS bags_returned_at timestamptz,
              ADD COLUMN IF NOT EXISTS bags_returned_by uuid REFERENCES users(id) ON DELETE RESTRICT
        SQL);
        DB::statement("ALTER TABLE delivery_stops ADD CONSTRAINT delivery_stops_status_check CHECK (status IN ('PENDING','ARRIVED','DELIVERED','FAILED','RESCHEDULED','CANCELLED','HANDED_OFF'))");
        DB::statement("ALTER TABLE delivery_stops ADD CONSTRAINT delivery_stops_fail_reason_check CHECK (fail_reason IS NULL OR fail_reason IN ('CUSTOMER_ABSENT','WRONG_ADDRESS','REFUSED','DAMAGED','NO_PAYMENT','OUT_OF_SLOT','VEHICLE','COLD_CHAIN','OTHER'))");
        DB::statement("ALTER TABLE delivery_stops ADD CONSTRAINT delivery_stops_falla_check CHECK (status <> 'FAILED' OR fail_reason IS NOT NULL)");
        DB::statement('ALTER TABLE delivery_stops ADD CONSTRAINT delivery_stops_montos_check CHECK (cod_amount >= 0 AND collected_amount >= 0 AND kg >= 0)');
        DB::statement("ALTER TABLE delivery_stops ADD CONSTRAINT delivery_stops_codigo_check CHECK (delivery_code IS NULL OR delivery_code ~ '^[0-9]{4}$')");
        // RN-DEL-02: en una ruta no se repite el número de parada y un pedido tiene una sola parada activa.
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS delivery_stops_numero_unico ON delivery_stops (route_id, seq) WHERE status NOT IN ('CANCELLED','RESCHEDULED')");
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS delivery_stops_una_activa ON delivery_stops (order_id) WHERE status NOT IN ('FAILED','RESCHEDULED','CANCELLED')");

        // Eventos de la app (solo inserción: la restricción REVOKE UPDATE/DELETE sigue)
        DB::statement(<<<'SQL'
            ALTER TABLE delivery_events
              ALTER COLUMN amount TYPE numeric(14,2) USING nullif(trim(amount), '')::numeric,
              ALTER COLUMN occurred_at SET DEFAULT now(),
              ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
              ADD COLUMN IF NOT EXISTS device_id varchar(80)
        SQL);
        DB::statement(<<<'SQL'
            ALTER TABLE delivery_events ADD CONSTRAINT delivery_events_type_check CHECK (event_type IN (
              'DEPARTED','ARRIVED','COD_COLLECTED','DELIVERED','FAILED','INCIDENT','POSITION','RETURNED','CALL','WHATSAPP','TICKET',
              'EXPENSE','MESSAGE','SUPPORT_REQUEST','SUPPORT_ASSIGNED','HANDOFF','HANDOFF_CLOSED','BAGS_RETURNED'))
        SQL);
        DB::statement("ALTER TABLE delivery_events ADD CONSTRAINT delivery_events_incident_check CHECK (incident_type IS NULL OR incident_type IN ('CROSSED_ORDER','DAMAGED_PRODUCT','MISSING_ITEM','CUSTOMER_COMPLAINT','VEHICLE','OTHER'))");
        // RN-DEL-06: un mismo evento del teléfono se registra una sola vez.
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS delivery_events_evento_unico ON delivery_events (tenant_id, client_event_id)');
        DB::statement('CREATE INDEX IF NOT EXISTS delivery_events_ruta_idx ON delivery_events (route_id, occurred_at)');

        // Enlace de seguimiento (RN-DEL-08)
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS tracking_links_token_unico ON tracking_links (token)');
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION del_tracking_tenant(p_token text) RETURNS uuid
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
                AS $$ SELECT l.tenant_id FROM tracking_links l JOIN tenants t ON t.id = l.tenant_id
                       WHERE l.token = p_token AND t.status = 'ACTIVE' $$
        SQL);
        DB::statement('REVOKE ALL ON FUNCTION del_tracking_tenant(text) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION del_tracking_tenant(text) TO aycha_app');

        // Tarifas y facturas de empresas de delivery (RN-DEL-11)
        DB::statement("ALTER TABLE carrier_rates ALTER COLUMN status SET DEFAULT 'ACTIVE', ADD COLUMN IF NOT EXISTS void_reason varchar(255)");
        DB::statement("ALTER TABLE carrier_rates ADD CONSTRAINT carrier_rates_basis_check CHECK (rate_basis IN ('PER_DELIVERY','PER_KG','PER_DAY'))");
        DB::statement("ALTER TABLE carrier_rates ADD CONSTRAINT carrier_rates_status_check CHECK (status IN ('ACTIVE','VOIDED'))");
        DB::statement('ALTER TABLE carrier_rates ADD CONSTRAINT carrier_rates_vigencia_check CHECK (amount >= 0 AND (valid_to IS NULL OR valid_to >= valid_from))');
        DB::statement('ALTER TABLE carrier_invoices ALTER COLUMN difference TYPE numeric(14,2)');
        DB::statement("ALTER TABLE carrier_invoices ADD CONSTRAINT carrier_invoices_status_check CHECK (status IS NULL OR status IN ('PENDING','RECONCILED','OBSERVED'))");
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS carrier_invoices_numero_unico ON carrier_invoices (tenant_id, supplier_id, invoice_number)');
        DB::statement("ALTER TABLE carrier_invoice_lines ADD CONSTRAINT carrier_invoice_lines_match_check CHECK (match_status IN ('MATCHED','AMOUNT_DIFF','NOT_REGISTERED','NOT_BILLED'))");

        // Envíos a provincia (RN-DEL-12)
        DB::statement(<<<'SQL'
            ALTER TABLE province_shipments
              ALTER COLUMN charged_to_customer TYPE numeric(14,2),
              ALTER COLUMN destination_ubigeo DROP NOT NULL,
              ALTER COLUMN status SET DEFAULT 'PREPARED',
              ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              ADD COLUMN IF NOT EXISTS notes varchar(255)
        SQL);
        DB::statement("ALTER TABLE province_shipments ADD CONSTRAINT province_shipments_status_check CHECK (status IN ('PREPARED','HANDED_TO_AGENCY','IN_TRANSIT','DELIVERED','RETURNED','LOST'))");
        DB::statement("ALTER TABLE province_shipments ADD CONSTRAINT province_shipments_packaging_check CHECK (packaging IN ('THERMAL_BOX','BOX','BAG','COOLER'))");
        DB::statement('ALTER TABLE province_shipments ADD CONSTRAINT province_shipments_montos_check CHECK (packages >= 1 AND weight_kg >= 0 AND freight_cost >= 0 AND packaging_cost >= 0 AND charged_to_customer >= 0)');
        // RN-DEL-12 en la base: entregado a la agencia solo con la guía y el número de seguimiento.
        DB::statement("ALTER TABLE province_shipments ADD CONSTRAINT province_shipments_guia_check CHECK (status = 'PREPARED' OR (dispatch_guide_id IS NOT NULL AND nullif(trim(tracking_number), '') IS NOT NULL))");
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS province_shipments_un_envio ON province_shipments (order_id)');

        // Costos de reparto (RN-DEL-13)
        DB::statement("UPDATE delivery_costs SET status = 'ACTIVE' WHERE status IS NULL");
        DB::statement(<<<'SQL'
            ALTER TABLE delivery_costs
              ALTER COLUMN notes DROP NOT NULL,
              ALTER COLUMN status SET DEFAULT 'ACTIVE',
              ALTER COLUMN status SET NOT NULL,
              ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              ADD COLUMN IF NOT EXISTS void_reason varchar(255),
              ADD COLUMN IF NOT EXISTS voided_at timestamptz,
              ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES users(id) ON DELETE RESTRICT
        SQL);
        DB::statement("ALTER TABLE delivery_costs ADD CONSTRAINT delivery_costs_status_check CHECK (status IN ('ACTIVE','VOIDED'))");
        DB::statement(<<<'SQL'
            ALTER TABLE delivery_costs ADD CONSTRAINT delivery_costs_type_check CHECK (cost_type IN (
              'FUEL','MAINTENANCE_PREVENTIVE','MAINTENANCE_CORRECTIVE','SOAT','TECH_INSPECTION','RENT','TOLL','PARKING','FINE',
              'DRIVER_WAGE','DRIVER_MEAL','DRIVER_TRANSPORT','DELIVERY_BONUS','CARRIER_FEE','PROVINCE_FREIGHT','PACKAGING','OTHER'))
        SQL);
        DB::statement('ALTER TABLE delivery_costs ADD CONSTRAINT delivery_costs_monto_check CHECK (amount >= 0)');
        DB::statement('ALTER TABLE delivery_costs ADD CONSTRAINT delivery_costs_destino_check CHECK (coalesce(route_id, vehicle_id, employee_id, employee_ref, supplier_id, zone_id, order_id) IS NOT NULL)');
        DB::statement("ALTER TABLE delivery_costs ADD CONSTRAINT delivery_costs_combustible_check CHECK (cost_type <> 'FUEL' OR (vehicle_id IS NOT NULL AND fuel_gallons > 0 AND nullif(trim(fuel_voucher_no), '') IS NOT NULL))");
        DB::statement("ALTER TABLE delivery_costs ADD CONSTRAINT delivery_costs_anulado_check CHECK (status <> 'VOIDED' OR nullif(trim(void_reason), '') IS NOT NULL OR voided_at IS NULL)");
        DB::statement('CREATE INDEX IF NOT EXISTS delivery_costs_fecha_idx ON delivery_costs (tenant_id, cost_date)');
        DB::statement('CREATE INDEX IF NOT EXISTS delivery_cost_allocations_corrida_idx ON delivery_cost_allocations (tenant_id, period, run_no)');

        // Vehículos (RN-DEL-03)
        DB::statement(<<<'SQL'
            ALTER TABLE vehicles
              ALTER COLUMN soat_policy_no DROP NOT NULL,
              ALTER COLUMN soat_expires_on DROP NOT NULL,
              ALTER COLUMN tech_inspection_expires_on DROP NOT NULL,
              ALTER COLUMN odometer_km SET DEFAULT 0,
              ALTER COLUMN status SET DEFAULT 'ACTIVE',
              ADD COLUMN IF NOT EXISTS notes varchar(255)
        SQL);
        DB::statement("ALTER TABLE vehicles ADD CONSTRAINT vehicles_type_check CHECK (vehicle_type IN ('MOTO','CAR','VAN','TRUCK','BICYCLE'))");
        DB::statement("ALTER TABLE vehicles ADD CONSTRAINT vehicles_ownership_check CHECK (ownership IN ('OWN','RENTED'))");
        DB::statement("ALTER TABLE vehicles ADD CONSTRAINT vehicles_status_check CHECK (status IN ('ACTIVE','INACTIVE','MAINTENANCE'))");
        DB::statement('ALTER TABLE vehicles ADD CONSTRAINT vehicles_montos_check CHECK (capacity_kg > 0 AND odometer_km >= 0 AND (rental_daily_rate IS NULL OR rental_daily_rate >= 0))');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS vehicles_placa_unica ON vehicles (tenant_id, upper(plate))');

        // Liquidación del repartidor (tabla de CAJ): montos con decimales.
        DB::statement('ALTER TABLE driver_settlements ALTER COLUMN expected_digital TYPE numeric(14,2), ALTER COLUMN difference TYPE numeric(14,2)');

        // Dirección confirmada y ubicación pedida (RN-DEL-14)
        DB::statement('ALTER TABLE customer_addresses ADD COLUMN IF NOT EXISTS location_requested_at timestamptz, ADD COLUMN IF NOT EXISTS verify_note varchar(255)');

        // Ampliación DEL-17 a DEL-22
        DB::statement(<<<'SQL'
            CREATE TABLE IF NOT EXISTS driver_expenses (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL DEFAULT app_tenant_id() REFERENCES tenants(id) ON DELETE RESTRICT,
              number varchar(20) NOT NULL,
              route_id uuid NOT NULL REFERENCES delivery_routes(id) ON DELETE RESTRICT,
              driver_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
              expense_date date NOT NULL,
              category varchar(20) NOT NULL CHECK (category IN ('FUEL','MEAL','TOLL','EXT_COURIER','OTHER')),
              amount numeric(14,2) NOT NULL CHECK (amount > 0),
              paid_with varchar(20) NOT NULL CHECK (paid_with IN ('ROUTE_CASH','OWN')),
              note varchar(255),
              photo_file_id uuid,
              fuel_gallons numeric(14,3),
              voucher_no varchar(40),
              cost_id uuid REFERENCES delivery_costs(id) ON DELETE RESTRICT,
              settlement_id uuid,
              status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','VOIDED')),
              client_event_id varchar(80),
              created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz,
              CONSTRAINT driver_expenses_combustible_check CHECK (category <> 'FUEL' OR (fuel_gallons > 0 AND nullif(trim(voucher_no), '') IS NOT NULL)),
              CONSTRAINT driver_expenses_otros_check CHECK (category <> 'OTHER' OR nullif(trim(note), '') IS NOT NULL)
            )
        SQL);
        DB::statement(<<<'SQL'
            CREATE TABLE IF NOT EXISTS driver_messages (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL DEFAULT app_tenant_id() REFERENCES tenants(id) ON DELETE RESTRICT,
              route_id uuid NOT NULL REFERENCES delivery_routes(id) ON DELETE RESTRICT,
              stop_id uuid REFERENCES delivery_stops(id) ON DELETE RESTRICT,
              from_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
              kind varchar(20) NOT NULL CHECK (kind IN ('TEXT','AUDIO','CAPTURE')),
              text text,
              audio_file_id uuid,
              audio_sec integer,
              photo_file_id uuid,
              amount numeric(14,2),
              to_role varchar(40) NOT NULL CHECK (to_role IN ('COORDINADOR_DELIVERY','CAJERO','SUPERVISORA_VENTAS')),
              status varchar(20) NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT','READ','CONFIRMED','REJECTED')),
              reply varchar(255),
              confirmed_amount numeric(14,2),
              ack_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              ack_at timestamptz,
              client_event_id varchar(80),
              sent_at timestamptz NOT NULL DEFAULT now(),
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz,
              CONSTRAINT driver_messages_contenido_check CHECK (
                (kind = 'TEXT' AND nullif(trim(text), '') IS NOT NULL)
                OR (kind = 'AUDIO' AND audio_file_id IS NOT NULL)
                OR (kind = 'CAPTURE' AND photo_file_id IS NOT NULL AND amount > 0))
            )
        SQL);
        DB::statement(<<<'SQL'
            CREATE TABLE IF NOT EXISTS support_requests (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL DEFAULT app_tenant_id() REFERENCES tenants(id) ON DELETE RESTRICT,
              number varchar(20) NOT NULL,
              route_id uuid NOT NULL REFERENCES delivery_routes(id) ON DELETE RESTRICT,
              stop_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
              reason varchar(255) NOT NULL,
              late_min integer,
              status varchar(20) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','ASSIGNED','EXTERNAL_OK','REJECTED')),
              requested_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              requested_at timestamptz NOT NULL DEFAULT now(),
              target_route_id uuid REFERENCES delivery_routes(id) ON DELETE RESTRICT,
              resolved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              resolved_at timestamptz,
              note varchar(255),
              client_event_id varchar(80),
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz
            )
        SQL);
        DB::statement(<<<'SQL'
            CREATE TABLE IF NOT EXISTS external_handoffs (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL DEFAULT app_tenant_id() REFERENCES tenants(id) ON DELETE RESTRICT,
              number varchar(20) NOT NULL,
              stop_id uuid NOT NULL REFERENCES delivery_stops(id) ON DELETE RESTRICT,
              route_id uuid NOT NULL REFERENCES delivery_routes(id) ON DELETE RESTRICT,
              order_id uuid NOT NULL REFERENCES sales_orders(id) ON DELETE RESTRICT,
              courier_name varchar(120) NOT NULL,
              courier_phone varchar(20),
              plate varchar(12) NOT NULL,
              photo_courier uuid NOT NULL,
              photo_plate uuid NOT NULL,
              photo_product uuid NOT NULL,
              shipping_cost numeric(14,2) NOT NULL CHECK (shipping_cost >= 0),
              paid_with varchar(20) NOT NULL DEFAULT 'ROUTE_CASH' CHECK (paid_with IN ('ROUTE_CASH','OWN')),
              cod_pending numeric(14,2) NOT NULL DEFAULT 0,
              status varchar(20) NOT NULL DEFAULT 'HANDED' CHECK (status IN ('HANDED','DELIVERED','FAILED')),
              expense_id uuid REFERENCES driver_expenses(id) ON DELETE RESTRICT,
              payment_id uuid REFERENCES payments(id) ON DELETE RESTRICT,
              note varchar(255),
              handed_at timestamptz NOT NULL DEFAULT now(),
              closed_at timestamptz,
              closed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              client_event_id varchar(80),
              created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz
            )
        SQL);
        foreach (['driver_expenses', 'driver_messages', 'support_requests', 'external_handoffs'] as $t) {
            DB::statement("CREATE INDEX IF NOT EXISTS {$t}_tenant_id_index ON {$t} (tenant_id)");
            DB::statement("CREATE INDEX IF NOT EXISTS {$t}_route_idx ON {$t} (route_id)");
            DB::statement("SELECT enable_tenant_rls('{$t}')");
            DB::statement("SELECT audit.track('{$t}')");
        }
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS driver_expenses_numero_unico ON driver_expenses (tenant_id, number)');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS support_requests_numero_unico ON support_requests (tenant_id, number)');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS external_handoffs_numero_unico ON external_handoffs (tenant_id, number)');
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS external_handoffs_una_abierta ON external_handoffs (stop_id) WHERE status = 'HANDED'");
    }

    public function down(): void
    {
        foreach (['external_handoffs', 'support_requests', 'driver_messages', 'driver_expenses'] as $t) {
            DB::statement("DROP TABLE IF EXISTS {$t} CASCADE");
        }
        DB::statement('ALTER TABLE customer_addresses DROP COLUMN IF EXISTS verify_note, DROP COLUMN IF EXISTS location_requested_at');
        DB::statement('ALTER TABLE driver_settlements ALTER COLUMN expected_digital TYPE integer USING round(expected_digital)::int, ALTER COLUMN difference TYPE integer USING round(difference)::int');
        DB::statement('DROP INDEX IF EXISTS vehicles_placa_unica');
        DB::statement('ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_montos_check, DROP CONSTRAINT IF EXISTS vehicles_status_check, DROP CONSTRAINT IF EXISTS vehicles_ownership_check, DROP CONSTRAINT IF EXISTS vehicles_type_check, DROP COLUMN IF EXISTS notes');
        DB::statement('DROP INDEX IF EXISTS delivery_cost_allocations_corrida_idx');
        DB::statement('DROP INDEX IF EXISTS delivery_costs_fecha_idx');
        DB::statement('ALTER TABLE delivery_costs DROP CONSTRAINT IF EXISTS delivery_costs_anulado_check, DROP CONSTRAINT IF EXISTS delivery_costs_combustible_check, DROP CONSTRAINT IF EXISTS delivery_costs_destino_check, DROP CONSTRAINT IF EXISTS delivery_costs_monto_check, DROP CONSTRAINT IF EXISTS delivery_costs_type_check, DROP CONSTRAINT IF EXISTS delivery_costs_status_check, DROP COLUMN IF EXISTS voided_by, DROP COLUMN IF EXISTS voided_at, DROP COLUMN IF EXISTS void_reason, DROP COLUMN IF EXISTS created_by');
        DB::statement('ALTER TABLE delivery_costs ALTER COLUMN status DROP NOT NULL');
        DB::statement('DROP INDEX IF EXISTS province_shipments_un_envio');
        DB::statement('ALTER TABLE province_shipments DROP CONSTRAINT IF EXISTS province_shipments_guia_check, DROP CONSTRAINT IF EXISTS province_shipments_montos_check, DROP CONSTRAINT IF EXISTS province_shipments_packaging_check, DROP CONSTRAINT IF EXISTS province_shipments_status_check, DROP COLUMN IF EXISTS notes, DROP COLUMN IF EXISTS created_by');
        DB::statement('ALTER TABLE province_shipments ALTER COLUMN charged_to_customer TYPE integer USING round(charged_to_customer)::int');
        DB::statement('ALTER TABLE carrier_invoice_lines DROP CONSTRAINT IF EXISTS carrier_invoice_lines_match_check');
        DB::statement('DROP INDEX IF EXISTS carrier_invoices_numero_unico');
        DB::statement('ALTER TABLE carrier_invoices DROP CONSTRAINT IF EXISTS carrier_invoices_status_check');
        DB::statement('ALTER TABLE carrier_invoices ALTER COLUMN difference TYPE integer USING round(difference)::int');
        DB::statement('ALTER TABLE carrier_rates DROP CONSTRAINT IF EXISTS carrier_rates_vigencia_check, DROP CONSTRAINT IF EXISTS carrier_rates_status_check, DROP CONSTRAINT IF EXISTS carrier_rates_basis_check, DROP COLUMN IF EXISTS void_reason');
        DB::statement('DROP FUNCTION IF EXISTS del_tracking_tenant(text)');
        DB::statement('DROP INDEX IF EXISTS tracking_links_token_unico');
        DB::statement('DROP INDEX IF EXISTS delivery_events_ruta_idx');
        DB::statement('DROP INDEX IF EXISTS delivery_events_evento_unico');
        DB::statement('ALTER TABLE delivery_events DROP CONSTRAINT IF EXISTS delivery_events_incident_check, DROP CONSTRAINT IF EXISTS delivery_events_type_check, DROP COLUMN IF EXISTS device_id, DROP COLUMN IF EXISTS user_id');
        DB::statement('ALTER TABLE delivery_events ALTER COLUMN amount TYPE varchar(255)');
        DB::statement('DROP INDEX IF EXISTS delivery_stops_una_activa');
        DB::statement('DROP INDEX IF EXISTS delivery_stops_numero_unico');
        DB::statement('ALTER TABLE delivery_stops DROP CONSTRAINT IF EXISTS delivery_stops_codigo_check, DROP CONSTRAINT IF EXISTS delivery_stops_montos_check, DROP CONSTRAINT IF EXISTS delivery_stops_falla_check, DROP CONSTRAINT IF EXISTS delivery_stops_fail_reason_check, DROP CONSTRAINT IF EXISTS delivery_stops_status_check, DROP COLUMN IF EXISTS bags_returned_by, DROP COLUMN IF EXISTS bags_returned_at, DROP COLUMN IF EXISTS handoff_id, DROP COLUMN IF EXISTS support_from, DROP COLUMN IF EXISTS notes');
        DB::statement('DROP INDEX IF EXISTS delivery_routes_fecha_idx');
        DB::statement('DROP INDEX IF EXISTS delivery_routes_codigo_unico');
        DB::statement('ALTER TABLE delivery_routes DROP CONSTRAINT IF EXISTS delivery_routes_asignada_check, DROP CONSTRAINT IF EXISTS delivery_routes_odometro_check, DROP CONSTRAINT IF EXISTS delivery_routes_pay_mode_check, DROP CONSTRAINT IF EXISTS delivery_routes_sequence_check, DROP CONSTRAINT IF EXISTS delivery_routes_mode_check, DROP CONSTRAINT IF EXISTS delivery_routes_status_check, DROP COLUMN IF EXISTS cancel_reason, DROP COLUMN IF EXISTS cancelled_at, DROP COLUMN IF EXISTS created_by');
    }
};
