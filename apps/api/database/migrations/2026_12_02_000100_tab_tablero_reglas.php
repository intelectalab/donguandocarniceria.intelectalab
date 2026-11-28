<?php

use App\Modulos\Tab\Services\Base;
use Database\Seeders\TabDemoSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// TAB · Tablero e indicadores (fase 1). Las seis tablas ya están en la base (2026_11_03_002100_tab_tablero). Aquí, las reglas:
//  - kpi_snapshot_runs: estado RUNNING mientras corre (la de un congelamiento que falla queda FAILED, RN-TAB-10), un número
//    de corrida por mes (RN-TAB-03) y quién la corrió.
//  - kpi_snapshots: la dimensión guarda marca o local (B:<id>, S:<id>), un valor por indicador, mes, dimensión y corrida, y
//    sigue siendo de solo inserción (RN-TAB-03).
//  - kpi_targets: una sola meta vigente por indicador, marca y local en cada fecha (RN-TAB-05: exclusión
//    kpi_targets_rn_tab_05_no_overlap), tolerancia de 0 a 100 y vigencia que no termina antes de empezar.
//  - kpi_definitions: estado ACTIVE o INACTIVE, código con el formato KPI-<MOD>-NN y la unidad y el sentido corregidos
//    en los indicadores en que el prototipo los traía cambiados (y las fórmulas que venían cortadas).
//  - Funciones de la spec: kpi_register (RN-TAB-08), kpi_semaphore (RN-TAB-04) y tab_seed_dashboards (los seis tableros
//    por rol); vista v_kpi_latest (el valor vigente de cada mes congelado, RN-TAB-01).
//  - Acceso de lectura a TAB para los roles que tienen tablero y aún no lo tenían (ADMINISTRACION, ALMACENERO, PREPARADOR)
//    y para sistemas (ADMIN_SISTEMA, que edita el catálogo).
// Al final, si la base ya tiene datos, TabDemoSeeder congela octubre de 2026 (lo que habría hecho la tarea del día 3).
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('CREATE EXTENSION IF NOT EXISTS btree_gist');

        // Corridas
        DB::statement('ALTER TABLE kpi_snapshot_runs ALTER COLUMN finished_at DROP NOT NULL');
        DB::statement('ALTER TABLE kpi_snapshot_runs ALTER COLUMN "user" TYPE varchar(120)');
        DB::statement("ALTER TABLE kpi_snapshot_runs ADD CONSTRAINT kpi_snapshot_runs_estado CHECK (status IN ('RUNNING','OK','FAILED'))");
        DB::statement('ALTER TABLE kpi_snapshot_runs ADD CONSTRAINT kpi_snapshot_runs_numero CHECK (run_no >= 1)');
        DB::statement('CREATE UNIQUE INDEX kpi_snapshot_runs_mes_corrida ON kpi_snapshot_runs (tenant_id, period, run_no)');
        DB::statement("ALTER TABLE kpi_snapshot_runs ADD CONSTRAINT kpi_snapshot_runs_primer_dia CHECK (period = date_trunc('month', period)::date)");

        // Valores congelados
        DB::statement('ALTER TABLE kpi_snapshots ALTER COLUMN dimension_key TYPE varchar(80)');
        DB::statement('CREATE UNIQUE INDEX kpi_snapshots_valor ON kpi_snapshots (tenant_id, kpi_code, period, dimension_key, run_no)');
        DB::statement('CREATE INDEX kpi_snapshots_mes ON kpi_snapshots (tenant_id, period, run_no)');

        // Catálogo
        DB::statement('ALTER TABLE kpi_definitions ALTER COLUMN drilldown TYPE varchar(40)');
        DB::statement('ALTER TABLE kpi_definitions ALTER COLUMN calculator TYPE varchar(60)');
        DB::statement('ALTER TABLE kpi_definitions ALTER COLUMN formula TYPE varchar(500)');
        DB::statement("ALTER TABLE kpi_definitions ADD CONSTRAINT kpi_definitions_estado CHECK (status IN ('ACTIVE','INACTIVE'))");
        DB::statement("ALTER TABLE kpi_definitions ADD CONSTRAINT kpi_definitions_codigo CHECK (code ~ '^KPI-[A-Z0-9]{2,4}-[0-9]{2,3}$')");
        DB::statement("ALTER TABLE kpi_definitions ADD CONSTRAINT kpi_definitions_sentido CHECK (direction IN ('HIGHER_BETTER','LOWER_BETTER','TARGET'))");
        foreach (self::CORRECCIONES as $code => [$unidad, $sentido, $formula]) {
            DB::update('UPDATE kpi_definitions SET unit = coalesce(?, unit), direction = coalesce(?, direction), formula = coalesce(?, formula),
                direction_text = CASE coalesce(?, direction) WHEN \'HIGHER_BETTER\' THEN \'Más alto es mejor\' WHEN \'LOWER_BETTER\' THEN \'Más bajo es mejor\' ELSE \'Objetivo\' END,
                updated_at = now() WHERE code = ?', [$unidad, $sentido, $formula, $sentido, $code]);
        }

        // Metas: RN-TAB-05, una vigente por indicador, marca y local en cada fecha.
        DB::statement('ALTER TABLE kpi_targets ADD CONSTRAINT kpi_targets_tolerancia CHECK (tolerance_pct BETWEEN 0 AND 100)');
        DB::statement('ALTER TABLE kpi_targets ADD CONSTRAINT kpi_targets_vigencia CHECK (valid_to IS NULL OR valid_to >= valid_from)');
        DB::statement(<<<'SQL'
            ALTER TABLE kpi_targets ADD CONSTRAINT kpi_targets_rn_tab_05_no_overlap EXCLUDE USING gist (
              tenant_id WITH =, kpi_id WITH =,
              (coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
              (coalesce(establishment_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
              daterange(valid_from, valid_to, '[]') WITH &&)
        SQL);

        // RN-TAB-04: semáforo.
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION kpi_semaphore(p_value numeric, p_target numeric, p_direction text, p_tolerance_pct numeric DEFAULT NULL)
            RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
            DECLARE t numeric := coalesce(p_tolerance_pct, 10) / 100; e numeric := 0.000000001;
            BEGIN
              IF p_value IS NULL OR p_target IS NULL THEN RETURN NULL; END IF;
              IF p_direction = 'LOWER_BETTER' THEN
                RETURN CASE WHEN p_value <= p_target + e THEN 'GREEN' WHEN p_value <= p_target * (1 + t) + e THEN 'AMBER' ELSE 'RED' END;
              ELSIF p_direction = 'TARGET' THEN
                RETURN CASE WHEN abs(p_value - p_target) <= abs(p_target) * t + e THEN 'GREEN'
                            WHEN abs(p_value - p_target) <= 2 * abs(p_target) * t + e THEN 'AMBER' ELSE 'RED' END;
              END IF;
              RETURN CASE WHEN p_value >= p_target - e THEN 'GREEN' WHEN p_value >= p_target * (1 - t) - e THEN 'AMBER' ELSE 'RED' END;
            END $$
        SQL);

        // RN-TAB-08: registro idempotente por código, en la empresa de la sesión.
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION kpi_register(p_code text, p_module text, p_name text, p_formula text, p_unit text, p_direction text,
              p_frequency text DEFAULT 'MONTHLY', p_dimensions jsonb DEFAULT '[]', p_source text DEFAULT NULL, p_phase integer DEFAULT 1,
              p_calculator text DEFAULT NULL, p_drilldown text DEFAULT NULL, p_roles jsonb DEFAULT '[]', p_requires_module text DEFAULT NULL)
            RETURNS uuid LANGUAGE plpgsql AS $$
            DECLARE v_id uuid;
            BEGIN
              IF p_code !~ '^KPI-[A-Z0-9]{2,4}-[0-9]{2,3}$' THEN
                RAISE EXCEPTION 'RN-TAB-08: el código % no sigue el formato KPI-<MOD>-NN', p_code;
              END IF;
              IF coalesce(trim(p_formula), '') = '' THEN RAISE EXCEPTION 'RN-TAB-08: la fórmula legible es obligatoria'; END IF;
              INSERT INTO kpi_definitions (code, module_code, name, formula, unit, direction, direction_text, phase, frequency, status, requires_module,
                calculator, drilldown, decimals, visible_roles, dimensions, source, created_at)
              VALUES (p_code, p_module, p_name, p_formula, p_unit, p_direction,
                CASE p_direction WHEN 'HIGHER_BETTER' THEN 'Más alto es mejor' WHEN 'LOWER_BETTER' THEN 'Más bajo es mejor' ELSE 'Objetivo' END,
                p_phase, p_frequency, 'ACTIVE', coalesce(p_requires_module, p_module),
                coalesce(p_calculator, 'kpi_' || lower(p_module) || '_' || split_part(p_code, '-', 3)), coalesce(p_drilldown, 'TAB-10'),
                CASE WHEN p_unit IN ('COUNT') THEN 0 ELSE 2 END, coalesce(p_roles, '[]'), coalesce(p_dimensions, '[]'), p_source, now())
              ON CONFLICT (tenant_id, code) DO UPDATE SET module_code = excluded.module_code, name = excluded.name, formula = excluded.formula,
                unit = excluded.unit, direction = excluded.direction, direction_text = excluded.direction_text, phase = excluded.phase,
                frequency = excluded.frequency, requires_module = excluded.requires_module, calculator = excluded.calculator,
                drilldown = excluded.drilldown, visible_roles = excluded.visible_roles, dimensions = excluded.dimensions, source = excluded.source, updated_at = now()
              RETURNING id INTO v_id;
              RETURN v_id;
            END $$
        SQL);

        // Los seis tableros por rol (D-TAB-02): tarjetas fijas y, en la tabla, el resto de indicadores de sus módulos.
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION tab_seed_dashboards() RETURNS integer LANGUAGE plpgsql AS $$
            DECLARE r record; d_id uuid; pos integer; c text; k record; n integer := 0;
            BEGIN
              FOR r IN SELECT * FROM (VALUES
                ('GERENCIA', 'TAB-01', 'Tablero de gerencia', '["GERENTE","ADMINISTRACION","CONTADORA","AUDITOR"]'::jsonb,
                  ARRAY['KPI-PED-01','KPI-PED-02','KPI-DEL-04','KPI-PRE-03','KPI-ADS-05','KPI-CRM-08','KPI-GAS-01','KPI-CRM-10','KPI-ADS-06','KPI-TAB-01'], ARRAY['GAS','TAB']),
                ('VENTAS', 'TAB-02', 'Tablero de ventas', '["SUPERVISORA_VENTAS","VENDEDORA","MARKETING","ADMINISTRACION","CAJERO"]'::jsonb,
                  ARRAY['KPI-PED-01','KPI-PED-08','KPI-PED-02','KPI-CRM-04','KPI-CRM-05','KPI-CRM-06','KPI-CRM-07','KPI-PED-05','KPI-CLI-01','KPI-PED-03'], ARRAY['PED','CLI','POS','WEB']),
                ('SUPERVISORA', 'TAB-03', 'Tablero de la supervisora', '["SUPERVISORA_VENTAS"]'::jsonb,
                  ARRAY['KPI-CRM-03','KPI-CRM-02','KPI-CRM-10','KPI-CRM-14','KPI-CRM-15','KPI-TEL-01','KPI-TEL-02','KPI-TEL-06','KPI-TEL-03','KPI-TEL-08'], ARRAY['CRM','TEL']),
                ('DELIVERY', 'TAB-04', 'Tablero de delivery', '["COORDINADOR_DELIVERY","ADMINISTRACION"]'::jsonb,
                  ARRAY['KPI-DEL-01','KPI-DEL-02','KPI-DEL-03','KPI-DEL-04','KPI-DEL-05','KPI-DEL-07','KPI-DEL-08','KPI-DEL-13','KPI-DEL-16','KPI-CAJ-01'], ARRAY['DEL','CAJ','FLO']),
                ('ALMACEN', 'TAB-05', 'Tablero de almacén y preparación', '["ALMACENERO","PREPARADOR","JEFE_PRODUCCION","CALIDAD"]'::jsonb,
                  ARRAY['KPI-PRE-01','KPI-PRE-02','KPI-PRE-05','KPI-PRE-03','KPI-PRE-07','KPI-PED-04','KPI-ALM-02','KPI-ALM-04','KPI-ALM-07','KPI-PRE-06'], ARRAY['PRE','ALM']),
                ('MARKETING', 'TAB-06', 'Tablero de marketing', '["MARKETING"]'::jsonb,
                  ARRAY['KPI-ADS-01','KPI-ADS-02','KPI-ADS-03','KPI-ADS-04','KPI-ADS-05','KPI-ADS-06','KPI-ADS-07','KPI-ADS-08','KPI-ADS-09','KPI-CRM-08'], ARRAY['ADS','CMP'])
              ) AS t(code, screen, name, roles, tiles, mods) LOOP
                SELECT id INTO d_id FROM dashboards WHERE code = r.code;
                IF d_id IS NULL THEN
                  INSERT INTO dashboards (code, name, role_codes, is_system, layout, created_at)
                  VALUES (r.code, r.name, r.roles, true, jsonb_build_object('screen', r.screen), now()) RETURNING id INTO d_id;
                END IF;
                SELECT coalesce(max(position), 0) INTO pos FROM dashboard_widgets WHERE dashboard_id = d_id;
                FOREACH c IN ARRAY r.tiles LOOP
                  IF EXISTS (SELECT 1 FROM kpi_definitions WHERE code = c) AND NOT EXISTS (SELECT 1 FROM dashboard_widgets WHERE dashboard_id = d_id AND kpi_code = c) THEN
                    pos := pos + 1; n := n + 1;
                    INSERT INTO dashboard_widgets (dashboard_id, kpi_id, kpi_code, position, viz, created_at)
                    SELECT d_id, id, code, pos, 'TILE', now() FROM kpi_definitions WHERE code = c;
                  END IF;
                END LOOP;
                FOR k IN SELECT id, code FROM kpi_definitions WHERE module_code = ANY (r.mods) AND code NOT IN (SELECT kpi_code FROM dashboard_widgets WHERE dashboard_id = d_id) ORDER BY code LOOP
                  pos := pos + 1; n := n + 1;
                  INSERT INTO dashboard_widgets (dashboard_id, kpi_id, kpi_code, position, viz, created_at) VALUES (d_id, k.id, k.code, pos, 'TABLE', now());
                END LOOP;
              END LOOP;
              RETURN n;
            END $$
        SQL);

        // RN-TAB-01: el valor vigente de un mes congelado (la última corrida OK).
        DB::statement(<<<'SQL'
            CREATE VIEW v_kpi_latest WITH (security_invoker = true) AS
            SELECT s.tenant_id, s.kpi_id, s.kpi_code, s.period, s.dimension_key, s.value, s.numerator, s.denominator, s.run_no, s.computed_at
              FROM kpi_snapshots s
              JOIN (SELECT tenant_id, period, max(run_no) AS run_no FROM kpi_snapshot_runs WHERE status = 'OK' GROUP BY tenant_id, period) r
                ON r.tenant_id = s.tenant_id AND r.period = s.period AND r.run_no = s.run_no
        SQL);
        DB::statement('GRANT SELECT ON v_kpi_latest TO aycha_app');

        // Los indicadores de FLO van a la tabla del tablero de delivery (la función solo agrega lo que falta).
        foreach (DB::table('tenants')->pluck('id') as $t) {
            Base::enEmpresa($t, fn () => DB::select('SELECT tab_seed_dashboards()'));
        }

        // Lectura de TAB para los roles con tablero que no la tenían, y para sistemas (catálogo).
        DB::statement(<<<'SQL'
            INSERT INTO role_module_access (tenant_id, role_id, module_code, actions, created_at)
            SELECT r.tenant_id, r.id, 'TAB', 'L', now() FROM roles r
            WHERE r.code IN ('ADMINISTRACION', 'ALMACENERO', 'PREPARADOR', 'ADMIN_SISTEMA')
            ON CONFLICT (tenant_id, role_id, module_code) DO NOTHING
        SQL);

        if (DB::table('kpi_definitions')->exists() && DB::table('sales_orders')->exists()) {
            (new TabDemoSeeder)->run();
        }
    }

    public function down(): void
    {
        DB::statement("DELETE FROM role_module_access WHERE module_code = 'TAB' AND actions = 'L' AND role_id IN (SELECT id FROM roles WHERE code IN ('ADMINISTRACION', 'ALMACENERO', 'PREPARADOR', 'ADMIN_SISTEMA'))");
        DB::statement('DROP VIEW IF EXISTS v_kpi_latest');
        DB::statement('DROP FUNCTION IF EXISTS tab_seed_dashboards()');
        DB::statement('DROP FUNCTION IF EXISTS kpi_register(text, text, text, text, text, text, text, jsonb, text, integer, text, text, jsonb, text)');
        DB::statement('DROP FUNCTION IF EXISTS kpi_semaphore(numeric, numeric, text, numeric)');
        DB::statement('ALTER TABLE kpi_targets DROP CONSTRAINT IF EXISTS kpi_targets_rn_tab_05_no_overlap');
        DB::statement('ALTER TABLE kpi_targets DROP CONSTRAINT IF EXISTS kpi_targets_vigencia');
        DB::statement('ALTER TABLE kpi_targets DROP CONSTRAINT IF EXISTS kpi_targets_tolerancia');
        foreach (['kpi_definitions_estado', 'kpi_definitions_codigo', 'kpi_definitions_sentido'] as $c) {
            DB::statement("ALTER TABLE kpi_definitions DROP CONSTRAINT IF EXISTS {$c}");
        }
        DB::statement('DROP INDEX IF EXISTS kpi_snapshots_valor');
        DB::statement('DROP INDEX IF EXISTS kpi_snapshots_mes');
        DB::statement('DROP INDEX IF EXISTS kpi_snapshot_runs_mes_corrida');
        foreach (['kpi_snapshot_runs_estado', 'kpi_snapshot_runs_numero', 'kpi_snapshot_runs_primer_dia'] as $c) {
            DB::statement("ALTER TABLE kpi_snapshot_runs DROP CONSTRAINT IF EXISTS {$c}");
        }
    }

    /** Unidad, sentido y fórmula corregidos (null = se deja como está). */
    private const CORRECCIONES = [
        'KPI-DEL-02' => ['PCT', null, null],
        'KPI-DEL-08' => ['PEN', null, 'sum(costo total − delivery cobrado) de las entregas del mes, de la última corrida del reparto'],
        'KPI-DEL-09' => ['RATIO', null, 'km recorridos / entregas de rutas propias y alquiladas'],
        'KPI-DEL-10' => ['RATIO', null, 'km recorridos por las rutas propias y alquiladas / galones cargados'],
        'KPI-DEL-12' => ['PEN', 'LOWER_BETTER', 'sum(|factura del tercero − monto esperado|) de las facturas de empresas de delivery del mes'],
        'KPI-DEL-13' => ['PEN', 'LOWER_BETTER', 'sum(|diferencia de liquidación|) de las liquidaciones de repartidores del mes'],
        'KPI-PRE-06' => ['PCT', 'LOWER_BETTER', 'sum(|kg real − kg estimado|) / sum(kg estimado) × 100, en líneas pesadas'],
        'KPI-PRE-07' => ['PCT', null, null],
        'KPI-FLO-01' => ['RATIO', null, null],
        'KPI-FLO-02' => ['RATIO', null, null],
        'KPI-FLO-05' => ['PCT', null, null],
        'KPI-FLO-09' => ['PEN', null, null],
        'KPI-PER-03' => ['PEN', null, null],
        'KPI-PER-04' => ['PEN', null, null],
        'KPI-PER-06' => ['MINUTES', null, null],
        'KPI-PER-09' => ['RATIO', null, null],
        'KPI-POS-03' => ['PEN', null, null],
        'KPI-POS-05' => ['RATIO', null, null],
        'KPI-CAJ-03' => ['PEN', null, null],
        'KPI-GAS-04' => ['HOURS', null, null],
        'KPI-GAS-05' => ['COUNT', null, null],
        'KPI-GAS-06' => ['DAYS', null, null],
        'KPI-CRM-07' => ['PCT', null, null],
        'KPI-ALM-03' => ['PEN', null, null],
        'KPI-ALM-04' => ['PEN', null, null],
        'KPI-CAT-04' => ['PEN_PER_KG', null, null],
        'KPI-AUD-02' => ['PCT', null, null],
    ];
};
