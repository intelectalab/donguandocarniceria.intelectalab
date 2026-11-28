<?php

use Database\Seeders\FloDemoSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// FLO · Flota avanzada (fase 3). Las 12 tablas del módulo, a partir del modelo del prototipo
// (tools/prototipo/generar_migraciones.py --modulos FLO) con los tipos, únicos y estados revisados:
//  - vehicle_profiles: ficha técnica del vehículo de DEL (uno por vehículo): tanque, rendimiento esperado, rango de
//    temperatura, GPS o sensor, compra y depreciación, y su estado operativo (activo, en mantenimiento, inactivo).
//  - vehicle_trips: jornadas (RN-FLO-02: una sola abierta por vehículo y por conductor), con odómetro inicial y final,
//    km por odómetro y por GPS (RN-FLO-05), fotos del tablero y checklist.
//  - vehicle_positions y vehicle_temperature_readings: de solo inserción (RN-FLO-03); la posición es única por
//    vehículo y hora, así un reenvío desde la app no duplica (RN-FLO-01).
//  - vehicle_odometer_readings: de solo inserción; cada lectura (jornada, carga, mantenimiento o cambio de tablero).
//  - fuel_loads, vehicle_maintenance_plans, vehicle_maintenances, vehicle_documents, traffic_fines y vehicle_costs:
//    estados, montos no negativos, un gasto de GAS enlazado una sola vez por tabla (RN-FLO-17; entre tablas lo
//    revisa el servicio), papeleta y vale sin repetir, un documento vigente por tipo y dueño (RN-FLO-13).
//  - fleet_alerts: una sola alerta abierta por vehículo, tipo y origen (RN-FLO-20).
// Al final siembra la demo (FloDemoSeeder) si la base ya tiene datos; en una base nueva la siembra el DatabaseSeeder.
return new class extends Migration
{
    public function up(): void
    {
        $base = "id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL DEFAULT app_tenant_id() REFERENCES tenants(id) ON DELETE RESTRICT";
        $fechas = 'created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz';

        DB::statement(<<<SQL
            CREATE TABLE vehicle_profiles (
              {$base},
              vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
              internal_code varchar(20) NOT NULL,
              make varchar(60), model varchar(80), year smallint, color varchar(30),
              tank_capacity_gal numeric(8,3) NOT NULL CHECK (tank_capacity_gal > 0),
              expected_km_per_gal numeric(8,2) NOT NULL CHECK (expected_km_per_gal > 0),
              temp_mode varchar(10) CHECK (temp_mode IN ('CHILLED','FROZEN')),
              temp_min_c numeric(5,1), temp_max_c numeric(5,1),
              gps_source varchar(20) NOT NULL DEFAULT 'APP_ANDROID' CHECK (gps_source IN ('APP_ANDROID','DEVICE')),
              gps_device_id varchar(120), temp_sensor_id varchar(120),
              purchase_date date, purchase_cost numeric(14,2) CHECK (purchase_cost IS NULL OR purchase_cost >= 0),
              residual_value numeric(14,2) CHECK (residual_value IS NULL OR residual_value >= 0),
              useful_life_months integer CHECK (useful_life_months IS NULL OR useful_life_months > 0),
              op_status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (op_status IN ('ACTIVE','IN_MAINTENANCE','INACTIVE')),
              notes text,
              {$fechas},
              CHECK (year IS NULL OR year BETWEEN 1980 AND 2100),
              CHECK (temp_min_c IS NULL OR temp_max_c IS NULL OR temp_min_c < temp_max_c)
            )
        SQL);
        DB::statement('CREATE UNIQUE INDEX vehicle_profiles_vehiculo ON vehicle_profiles (tenant_id, vehicle_id)');
        DB::statement('CREATE UNIQUE INDEX vehicle_profiles_codigo ON vehicle_profiles (tenant_id, upper(internal_code))');

        DB::statement(<<<SQL
            CREATE TABLE vehicle_trips (
              {$base},
              number varchar(20) NOT NULL,
              vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
              driver_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
              driver_employee_id uuid REFERENCES employees(id) ON DELETE RESTRICT,
              establishment_id uuid NOT NULL REFERENCES establishments(id) ON DELETE RESTRICT,
              route_id uuid REFERENCES delivery_routes(id) ON DELETE SET NULL,
              trip_date date NOT NULL,
              status varchar(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('PLANNED','OPEN','CLOSED','CANCELLED')),
              source varchar(10) NOT NULL DEFAULT 'APP' CHECK (source IN ('APP','WEB','PLAN')),
              started_at timestamptz, ended_at timestamptz,
              odometer_start numeric(12,1), odometer_end numeric(12,1),
              km_odometer numeric(10,1), km_gps numeric(10,1), km_diff_pct numeric(8,1),
              deliveries integer CHECK (deliveries IS NULL OR deliveries >= 0),
              start_photo_file_id uuid REFERENCES file_attachments(id) ON DELETE RESTRICT,
              end_photo_file_id uuid REFERENCES file_attachments(id) ON DELETE RESTRICT,
              checklist_start jsonb, checklist_end jsonb,
              notes text, end_notes text,
              created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              {$fechas},
              CHECK (status = 'PLANNED' OR status = 'CANCELLED' OR (started_at IS NOT NULL AND odometer_start IS NOT NULL AND driver_user_id IS NOT NULL)),
              CHECK (status <> 'CLOSED' OR (ended_at IS NOT NULL AND odometer_end IS NOT NULL AND odometer_end >= odometer_start)),
              CHECK (ended_at IS NULL OR ended_at >= started_at)
            )
        SQL);
        DB::statement('CREATE UNIQUE INDEX vehicle_trips_numero ON vehicle_trips (tenant_id, number)');
        DB::statement("CREATE UNIQUE INDEX vehicle_trips_una_abierta ON vehicle_trips (tenant_id, vehicle_id) WHERE status = 'OPEN'");          // RN-FLO-02
        DB::statement("CREATE UNIQUE INDEX vehicle_trips_conductor_abierta ON vehicle_trips (tenant_id, driver_user_id) WHERE status = 'OPEN'");
        DB::statement('CREATE INDEX vehicle_trips_vehiculo_fecha ON vehicle_trips (vehicle_id, trip_date)');
        DB::statement('CREATE INDEX vehicle_trips_fecha ON vehicle_trips (tenant_id, trip_date)');

        DB::statement(<<<SQL
            CREATE TABLE vehicle_positions (
              {$base},
              vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
              trip_id uuid NOT NULL REFERENCES vehicle_trips(id) ON DELETE RESTRICT,
              recorded_at timestamptz NOT NULL,
              lat numeric(10,7) NOT NULL CHECK (lat BETWEEN -90 AND 90),
              lng numeric(10,7) NOT NULL CHECK (lng BETWEEN -180 AND 180),
              speed_kmh numeric(6,1) NOT NULL DEFAULT 0 CHECK (speed_kmh >= 0),
              heading smallint, accuracy_m integer,
              source varchar(10) NOT NULL DEFAULT 'APP' CHECK (source IN ('APP','BATCH','DEVICE')),
              received_at timestamptz NOT NULL DEFAULT now(),
              {$fechas}
            )
        SQL);
        DB::statement('CREATE UNIQUE INDEX vehicle_positions_hora ON vehicle_positions (tenant_id, vehicle_id, recorded_at)');   // RN-FLO-01
        DB::statement('CREATE INDEX vehicle_positions_jornada ON vehicle_positions (trip_id, recorded_at)');

        DB::statement(<<<SQL
            CREATE TABLE vehicle_odometer_readings (
              {$base},
              vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
              read_at timestamptz NOT NULL,
              km numeric(12,1) NOT NULL CHECK (km >= 0),
              source varchar(12) NOT NULL CHECK (source IN ('INITIAL','TRIP_START','TRIP_END','FUEL','MAINTENANCE','RESET','MANUAL')),
              source_id uuid,
              previous_km numeric(12,1),
              reason text,
              recorded_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              {$fechas},
              CHECK (source <> 'RESET' OR (reason IS NOT NULL AND length(trim(reason)) >= 10))
            )
        SQL);
        DB::statement('CREATE INDEX vehicle_odometer_readings_vehiculo ON vehicle_odometer_readings (vehicle_id, read_at)');

        DB::statement(<<<SQL
            CREATE TABLE fuel_loads (
              {$base},
              number varchar(20) NOT NULL,
              vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
              trip_id uuid REFERENCES vehicle_trips(id) ON DELETE RESTRICT,
              driver_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
              employee_id uuid REFERENCES employees(id) ON DELETE RESTRICT,
              loaded_at timestamptz NOT NULL,
              odometer_km numeric(12,1) NOT NULL CHECK (odometer_km >= 0),
              gallons numeric(10,3) NOT NULL CHECK (gallons > 0),
              price_per_gal numeric(10,3) NOT NULL CHECK (price_per_gal > 0),
              amount numeric(14,2) NOT NULL CHECK (amount > 0),
              full_tank boolean NOT NULL DEFAULT true,
              fuel_type varchar(12),
              station_supplier_id uuid REFERENCES suppliers(id) ON DELETE RESTRICT,
              station_name varchar(120),
              voucher_no varchar(30),
              doc_type varchar(20), doc_number varchar(30),
              photo_file_id uuid REFERENCES file_attachments(id) ON DELETE RESTRICT,
              expense_id uuid REFERENCES expenses(id) ON DELETE RESTRICT,
              km_since_full numeric(10,1), gallons_since_full numeric(10,3), km_per_gal numeric(8,1),
              base_load_id uuid REFERENCES fuel_loads(id) ON DELETE RESTRICT,
              expected_km_per_gal numeric(8,2),
              efficiency_status varchar(4) NOT NULL DEFAULT 'NA' CHECK (efficiency_status IN ('OK','LOW','NA')),
              source varchar(10) NOT NULL DEFAULT 'WEB' CHECK (source IN ('APP','WEB','BASELINE')),
              status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','VOIDED')),
              void_reason text, voided_at timestamptz, voided_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              recorded_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              {$fechas},
              CHECK (status <> 'VOIDED' OR void_reason IS NOT NULL)
            )
        SQL);
        DB::statement('CREATE UNIQUE INDEX fuel_loads_numero ON fuel_loads (tenant_id, number)');
        DB::statement("CREATE UNIQUE INDEX fuel_loads_vale ON fuel_loads (tenant_id, vehicle_id, upper(voucher_no)) WHERE voucher_no IS NOT NULL AND status = 'ACTIVE'");
        DB::statement("CREATE UNIQUE INDEX fuel_loads_gasto ON fuel_loads (tenant_id, expense_id) WHERE expense_id IS NOT NULL AND status = 'ACTIVE'");   // RN-FLO-17
        DB::statement('CREATE INDEX fuel_loads_vehiculo ON fuel_loads (vehicle_id, loaded_at)');

        DB::statement(<<<SQL
            CREATE TABLE vehicle_maintenance_plans (
              {$base},
              code varchar(20) NOT NULL,
              vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
              task varchar(120) NOT NULL,
              interval_km numeric(10,1) CHECK (interval_km IS NULL OR interval_km > 0),
              interval_days integer CHECK (interval_days IS NULL OR interval_days > 0),
              last_done_km numeric(12,1), last_done_on date,
              next_due_km numeric(12,1), next_due_on date,
              status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
              notes text,
              {$fechas},
              CHECK (interval_km IS NOT NULL OR interval_days IS NOT NULL)
            )
        SQL);
        DB::statement('CREATE UNIQUE INDEX vehicle_maintenance_plans_codigo ON vehicle_maintenance_plans (tenant_id, code)');
        DB::statement('CREATE INDEX vehicle_maintenance_plans_vehiculo ON vehicle_maintenance_plans (vehicle_id)');

        DB::statement(<<<SQL
            CREATE TABLE vehicle_maintenances (
              {$base},
              number varchar(20) NOT NULL,
              vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
              plan_id uuid REFERENCES vehicle_maintenance_plans(id) ON DELETE RESTRICT,
              kind varchar(12) NOT NULL CHECK (kind IN ('PREVENTIVE','CORRECTIVE')),
              description text NOT NULL,
              workshop_supplier_id uuid REFERENCES suppliers(id) ON DELETE RESTRICT,
              workshop_name varchar(120),
              opened_on date NOT NULL,
              in_workshop boolean NOT NULL DEFAULT true,
              due_km numeric(12,1), due_on date,
              odometer_km numeric(12,1), done_on date,
              days_out_of_service integer CHECK (days_out_of_service IS NULL OR days_out_of_service >= 0),
              parts jsonb NOT NULL DEFAULT '[]'::jsonb,
              parts_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (parts_amount >= 0),
              labor_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (labor_amount >= 0),
              total_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
              doc_type varchar(20), doc_number varchar(30),
              receipt_file_id uuid REFERENCES file_attachments(id) ON DELETE RESTRICT,
              expense_id uuid REFERENCES expenses(id) ON DELETE RESTRICT,
              on_time boolean,
              status varchar(12) NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','DONE','VOIDED')),
              void_reason text,
              opened_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              closed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              {$fechas},
              CHECK (kind <> 'PREVENTIVE' OR plan_id IS NOT NULL),
              CHECK (status <> 'DONE' OR (done_on IS NOT NULL AND odometer_km IS NOT NULL)),
              CHECK (total_amount = parts_amount + labor_amount)
            )
        SQL);
        DB::statement('CREATE UNIQUE INDEX vehicle_maintenances_numero ON vehicle_maintenances (tenant_id, number)');
        DB::statement("CREATE UNIQUE INDEX vehicle_maintenances_gasto ON vehicle_maintenances (tenant_id, expense_id) WHERE expense_id IS NOT NULL AND status <> 'VOIDED'");
        DB::statement('CREATE INDEX vehicle_maintenances_vehiculo ON vehicle_maintenances (vehicle_id, opened_on)');

        DB::statement(<<<SQL
            CREATE TABLE vehicle_documents (
              {$base},
              vehicle_id uuid REFERENCES vehicles(id) ON DELETE RESTRICT,
              employee_id uuid REFERENCES employees(id) ON DELETE RESTRICT,
              doc_type varchar(20) NOT NULL CHECK (doc_type IN ('SOAT','TECH_INSPECTION','PROPERTY_CARD','RENTAL_CONTRACT','INSURANCE_POLICY','DRIVER_LICENSE')),
              number varchar(40) NOT NULL,
              issuer varchar(120), license_class varchar(20),
              issued_on date, expires_on date,
              file_id uuid REFERENCES file_attachments(id) ON DELETE RESTRICT,
              status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REPLACED','VOIDED')),
              replaces_id uuid REFERENCES vehicle_documents(id) ON DELETE RESTRICT,
              notes text,
              created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              {$fechas},
              CHECK ((doc_type = 'DRIVER_LICENSE') = (employee_id IS NOT NULL AND vehicle_id IS NULL)),
              CHECK (doc_type = 'DRIVER_LICENSE' OR vehicle_id IS NOT NULL),
              CHECK (doc_type NOT IN ('SOAT','TECH_INSPECTION','DRIVER_LICENSE','RENTAL_CONTRACT') OR expires_on IS NOT NULL),
              CHECK (issued_on IS NULL OR expires_on IS NULL OR expires_on > issued_on)
            )
        SQL);
        DB::statement("CREATE UNIQUE INDEX vehicle_documents_vigente_vehiculo ON vehicle_documents (tenant_id, vehicle_id, doc_type) WHERE status = 'ACTIVE' AND vehicle_id IS NOT NULL");
        DB::statement("CREATE UNIQUE INDEX vehicle_documents_vigente_conductor ON vehicle_documents (tenant_id, employee_id, doc_type) WHERE status = 'ACTIVE' AND employee_id IS NOT NULL");

        DB::statement(<<<SQL
            CREATE TABLE traffic_fines (
              {$base},
              ballot_number varchar(30) NOT NULL,
              fine_date date NOT NULL,
              entity varchar(10) NOT NULL CHECK (entity IN ('SAT','PNP','ATU','MUNI','SUTRAN')),
              infraction_code varchar(20), infraction varchar(255) NOT NULL,
              vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
              driver_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
              employee_id uuid REFERENCES employees(id) ON DELETE RESTRICT,
              amount numeric(14,2) NOT NULL CHECK (amount > 0),
              early_discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (early_discount_pct BETWEEN 0 AND 100),
              early_discount_until date,
              discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
              paid_amount numeric(14,2) CHECK (paid_amount IS NULL OR paid_amount >= 0), paid_on date,
              status varchar(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','APPEALED','VOIDED')),
              charged_to_driver boolean NOT NULL DEFAULT false,
              deduct_from_payout boolean NOT NULL DEFAULT false,
              acknowledgment_signed boolean NOT NULL DEFAULT false,
              acknowledgment_file_id uuid REFERENCES file_attachments(id) ON DELETE RESTRICT,
              hr_approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              hr_approved_at timestamptz,
              deducted_payout_id uuid,
              expense_id uuid REFERENCES expenses(id) ON DELETE RESTRICT,
              notes text, appeal_note text, void_reason text,
              created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              {$fechas},
              CHECK (status <> 'PAID' OR (paid_on IS NOT NULL AND paid_amount IS NOT NULL)),
              CHECK (NOT charged_to_driver OR (acknowledgment_signed AND acknowledgment_file_id IS NOT NULL AND employee_id IS NOT NULL AND hr_approved_by IS NOT NULL))
            )
        SQL);
        DB::statement("CREATE UNIQUE INDEX traffic_fines_papeleta ON traffic_fines (tenant_id, upper(ballot_number)) WHERE status <> 'VOIDED'");
        DB::statement("CREATE UNIQUE INDEX traffic_fines_gasto ON traffic_fines (tenant_id, expense_id) WHERE expense_id IS NOT NULL AND status <> 'VOIDED'");
        DB::statement('CREATE INDEX traffic_fines_vehiculo ON traffic_fines (vehicle_id, fine_date)');

        DB::statement(<<<SQL
            CREATE TABLE vehicle_costs (
              {$base},
              vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
              cost_type varchar(12) NOT NULL CHECK (cost_type IN ('RENT','TOLL','PARKING','INSURANCE','TAX','WASH','TIRES','OTHER')),
              cost_date date NOT NULL,
              period date NOT NULL CHECK (extract(day FROM period) = 1),
              amount numeric(14,2) NOT NULL CHECK (amount > 0),
              supplier_id uuid REFERENCES suppliers(id) ON DELETE RESTRICT,
              doc_type varchar(20), doc_number varchar(30),
              receipt_file_id uuid REFERENCES file_attachments(id) ON DELETE RESTRICT,
              notes text,
              expense_id uuid REFERENCES expenses(id) ON DELETE RESTRICT,
              status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','VOIDED')),
              void_reason text,
              created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              {$fechas}
            )
        SQL);
        DB::statement("CREATE UNIQUE INDEX vehicle_costs_gasto ON vehicle_costs (tenant_id, expense_id) WHERE expense_id IS NOT NULL AND status = 'ACTIVE'");
        DB::statement('CREATE INDEX vehicle_costs_vehiculo ON vehicle_costs (vehicle_id, period)');

        DB::statement(<<<SQL
            CREATE TABLE vehicle_temperature_readings (
              {$base},
              vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
              trip_id uuid REFERENCES vehicle_trips(id) ON DELETE RESTRICT,
              read_at timestamptz NOT NULL,
              temp_c numeric(5,1) NOT NULL CHECK (temp_c BETWEEN -50 AND 60),
              in_range boolean NOT NULL,
              range_min numeric(5,1), range_max numeric(5,1),
              sensor_id varchar(120),
              source varchar(10) NOT NULL DEFAULT 'SENSOR' CHECK (source IN ('SENSOR','MANUAL')),
              recorded_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              {$fechas}
            )
        SQL);
        DB::statement('CREATE UNIQUE INDEX vehicle_temperature_readings_hora ON vehicle_temperature_readings (tenant_id, vehicle_id, read_at)');
        DB::statement('CREATE INDEX vehicle_temperature_readings_jornada ON vehicle_temperature_readings (trip_id, read_at)');

        DB::statement(<<<SQL
            CREATE TABLE fleet_alerts (
              {$base},
              number varchar(20) NOT NULL,
              alert_type varchar(20) NOT NULL CHECK (alert_type IN ('FUEL_EFFICIENCY','MAINTENANCE','DOCUMENT','TEMPERATURE','GPS_SILENT','ODOMETER','SPEED')),
              vehicle_id uuid REFERENCES vehicles(id) ON DELETE RESTRICT,
              employee_id uuid REFERENCES employees(id) ON DELETE RESTRICT,
              origin varchar(80) NOT NULL,
              title varchar(255) NOT NULL,
              detail text,
              severity varchar(6) NOT NULL DEFAULT 'warn' CHECK (severity IN ('info','warn','bad')),
              first_at timestamptz NOT NULL, last_at timestamptz NOT NULL,
              occurrences integer NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
              status varchar(8) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACK','CLOSED')),
              ack_by uuid REFERENCES users(id) ON DELETE RESTRICT, ack_at timestamptz, ack_note text,
              closed_by uuid REFERENCES users(id) ON DELETE RESTRICT, closed_at timestamptz, resolution text,
              order_reviews jsonb NOT NULL DEFAULT '[]'::jsonb,
              excursion_start timestamptz, excursion_minutes numeric(8,1), episode_start timestamptz, max_value numeric(10,2),
              {$fechas},
              CHECK (vehicle_id IS NOT NULL OR employee_id IS NOT NULL),
              CHECK (status <> 'CLOSED' OR (closed_at IS NOT NULL AND resolution IS NOT NULL))
            )
        SQL);
        DB::statement('CREATE UNIQUE INDEX fleet_alerts_numero ON fleet_alerts (tenant_id, number)');
        DB::statement("CREATE UNIQUE INDEX fleet_alerts_una_abierta ON fleet_alerts (tenant_id, coalesce(vehicle_id, employee_id), alert_type, origin) WHERE status <> 'CLOSED'");  // RN-FLO-20
        DB::statement('CREATE INDEX fleet_alerts_estado ON fleet_alerts (tenant_id, status, last_at)');

        foreach (['vehicle_profiles', 'vehicle_trips', 'vehicle_positions', 'vehicle_odometer_readings', 'fuel_loads', 'vehicle_maintenance_plans',
            'vehicle_maintenances', 'vehicle_documents', 'traffic_fines', 'vehicle_costs', 'vehicle_temperature_readings', 'fleet_alerts'] as $t) {
            DB::statement("CREATE INDEX {$t}_tenant ON {$t} (tenant_id)");
            DB::statement("SELECT enable_tenant_rls('{$t}')");
            if (! in_array($t, ['vehicle_positions', 'vehicle_temperature_readings'], true)) {   // las de alto volumen no van a la bitácora
                DB::statement("SELECT audit.track('{$t}')");
            }
        }
        // RN-FLO-03: posiciones y temperaturas de solo inserción; las lecturas del odómetro tampoco se cambian (RN-FLO-04).
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON vehicle_positions, vehicle_temperature_readings, vehicle_odometer_readings FROM aycha_app');

        // Demo: en una base ya sembrada (la del equipo) se siembra aquí; en una nueva, después, desde el DatabaseSeeder.
        if (DB::table('vehicles')->exists()) {
            (new FloDemoSeeder)->run();
        }
    }

    public function down(): void
    {
        foreach (['fleet_alerts', 'vehicle_temperature_readings', 'vehicle_costs', 'traffic_fines', 'vehicle_documents', 'vehicle_maintenances',
            'vehicle_maintenance_plans', 'fuel_loads', 'vehicle_odometer_readings', 'vehicle_positions', 'vehicle_trips', 'vehicle_profiles'] as $t) {
            DB::statement("DROP TABLE IF EXISTS {$t} CASCADE");
        }
    }
};
