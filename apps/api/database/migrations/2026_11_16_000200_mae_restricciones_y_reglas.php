<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// MAE · reglas de la spec en la base (000300 creó las tablas). Detalle: docs/cambios/2026-11-16_mae-maestros.md.
//
//  - RN-MAE-01: trabajador único por tipo y número de documento, con el formato de cada tipo.
//  - RN-MAE-02: activo ⇔ sin fecha de cese. El estado TERMINATED de la demo pasa a INACTIVE (la spec usa dos).
//    El sueldo no es de MAE (va con PER, fase 3): deja de ser obligatorio y la API no lo muestra.
//  - RN-MAE-03: código de medio de pago único por empresa.
//  - RN-MAE-05: las vigencias de comisión de un medio no se cruzan (EXCLUDE con btree_gist).
//  - RN-MAE-06: tipo de cambio único por fecha y moneda; compra y venta > 0 y compra ≤ venta.
//  - RN-MAE-09: factor > 0 con decimales (era entero) y una sola conversión por par, en cualquier sentido.
//  - RN-MAE-10: decimales de la unidad entre 0 y 6.
//  - RN-MAE-11: catálogos SUNAT, ubigeo y entidades con código único. La app ya solo tiene SELECT.
//  - RN-MAE-13: un trabajador tiene a lo más un usuario vigente (activo, bloqueado o invitado).
return new class extends Migration
{
    public function up(): void
    {
        // Trabajadores
        DB::statement("UPDATE employees SET status = 'INACTIVE', terminated_on = COALESCE(terminated_on,
            (SELECT max(u.deactivated_at)::date FROM users u WHERE u.employee_id = employees.id AND u.deactivated_at::date >= employees.hire_date), hire_date),
            termination_reason = COALESCE(termination_reason, 'Cese registrado antes del módulo MAE') WHERE status = 'TERMINATED'");
        DB::statement("UPDATE employees SET terminated_on = NULL, termination_reason = NULL WHERE status = 'ACTIVE'");
        DB::statement('ALTER TABLE employees ALTER COLUMN monthly_salary DROP NOT NULL');
        DB::statement('ALTER TABLE employees ALTER COLUMN phone DROP NOT NULL');
        DB::statement('ALTER TABLE employees ALTER COLUMN termination_reason TYPE varchar(255)');
        DB::statement('ALTER TABLE employees ALTER COLUMN full_name TYPE varchar(120)');
        DB::statement("ALTER TABLE employees ADD CONSTRAINT employees_status_valido CHECK (status IN ('ACTIVE','INACTIVE'))");
        DB::statement("ALTER TABLE employees ADD CONSTRAINT employees_cese CHECK ((status = 'ACTIVE') = (terminated_on IS NULL))");
        DB::statement("ALTER TABLE employees ADD CONSTRAINT employees_doc_type_valido CHECK (doc_type IN ('DNI','CE','PASSPORT'))");
        DB::statement("ALTER TABLE employees ADD CONSTRAINT employees_doc_formato CHECK (
            (doc_type = 'DNI' AND doc_number ~ '^[0-9]{8}$') OR (doc_type <> 'DNI' AND doc_number ~ '^[A-Z0-9]{6,15}$'))");
        DB::statement('CREATE UNIQUE INDEX employees_documento_unico ON employees (tenant_id, doc_type, doc_number)');
        DB::statement("CREATE UNIQUE INDEX users_un_usuario_vigente_por_trabajador ON users (employee_id)
            WHERE employee_id IS NOT NULL AND status IN ('ACTIVE','LOCKED','INVITED')");

        // Medios de pago y comisiones
        DB::statement('ALTER TABLE payment_methods ADD COLUMN change_reason varchar(255)');
        DB::statement("ALTER TABLE payment_methods ADD CONSTRAINT payment_methods_status_valido CHECK (status IN ('ACTIVE','INACTIVE','INTERNAL'))");
        DB::statement('ALTER TABLE payment_methods ADD CONSTRAINT payment_methods_abono CHECK (settlement_days IS NULL OR settlement_days BETWEEN 0 AND 60)');
        DB::statement('CREATE UNIQUE INDEX payment_methods_codigo_unico ON payment_methods (tenant_id, code)');
        DB::statement('ALTER TABLE payment_method_fees ALTER COLUMN note DROP NOT NULL');
        DB::statement('ALTER TABLE payment_method_fees ALTER COLUMN created_by TYPE varchar(80)');
        DB::statement('ALTER TABLE payment_method_fees ADD CONSTRAINT payment_method_fees_pct CHECK (fee_pct BETWEEN 0 AND 100)');
        DB::statement('ALTER TABLE payment_method_fees ADD CONSTRAINT payment_method_fees_fijo CHECK (fee_fixed >= 0)');
        DB::statement('ALTER TABLE payment_method_fees ADD CONSTRAINT payment_method_fees_fechas CHECK (valid_to IS NULL OR valid_to >= valid_from)');
        DB::statement("ALTER TABLE payment_method_fees ADD CONSTRAINT payment_method_fees_sin_cruce EXCLUDE USING gist
            (tenant_id WITH =, payment_method_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&)");

        // Tipo de cambio
        DB::statement('ALTER TABLE exchange_rates ALTER COLUMN edited_by TYPE varchar(80)');
        DB::statement('ALTER TABLE exchange_rates ADD CONSTRAINT exchange_rates_valores CHECK (buy > 0 AND sell > 0 AND buy <= sell)');
        DB::statement("ALTER TABLE exchange_rates ADD CONSTRAINT exchange_rates_moneda CHECK (currency ~ '^[A-Z]{3}$')");
        DB::statement("ALTER TABLE exchange_rates ADD CONSTRAINT exchange_rates_origen CHECK (source IN ('SUNAT','MANUAL','IMPORT') AND (loaded_via IS NULL OR loaded_via IN ('SUNAT','MANUAL','IMPORT')))");
        DB::statement('CREATE UNIQUE INDEX exchange_rates_fecha_moneda ON exchange_rates (tenant_id, date, currency)');

        // Unidades y conversiones
        DB::statement('ALTER TABLE units_of_measure ADD CONSTRAINT units_of_measure_decimales CHECK (decimals IS NULL OR decimals BETWEEN 0 AND 6)');
        DB::statement("ALTER TABLE units_of_measure ADD CONSTRAINT units_of_measure_tipo CHECK (uom_type IS NULL OR uom_type IN ('UNIT','WEIGHT','VOLUME','SERVICE','PACKAGE'))");
        DB::statement('CREATE UNIQUE INDEX units_of_measure_codigo_unico ON units_of_measure (tenant_id, code)');
        DB::statement('ALTER TABLE unit_conversions ALTER COLUMN factor TYPE numeric(18,6)');
        DB::statement('ALTER TABLE unit_conversions ALTER COLUMN note DROP NOT NULL');
        DB::statement('ALTER TABLE unit_conversions ADD CONSTRAINT unit_conversions_factor CHECK (factor > 0)');
        DB::statement('ALTER TABLE unit_conversions ADD CONSTRAINT unit_conversions_distintas CHECK (from_uom <> to_uom)');
        DB::statement('CREATE UNIQUE INDEX unit_conversions_par_unico ON unit_conversions (tenant_id, LEAST(from_uom, to_uom), GREATEST(from_uom, to_uom))');

        // Tablas globales (RN-MAE-11)
        DB::statement('CREATE UNIQUE INDEX sunat_catalog_items_codigo_unico ON sunat_catalog_items (catalog, code)');
        DB::statement('ALTER TABLE sunat_catalog_items ADD CONSTRAINT sunat_catalog_items_fechas CHECK (valid_to IS NULL OR valid_to >= valid_from)');
        DB::statement('CREATE UNIQUE INDEX ubigeo_codigo_unico ON ubigeo (code)');
        DB::statement('CREATE UNIQUE INDEX financial_institutions_codigo_unico ON financial_institutions (code)');
    }

    public function down(): void
    {
        foreach (['financial_institutions_codigo_unico', 'ubigeo_codigo_unico', 'sunat_catalog_items_codigo_unico', 'unit_conversions_par_unico',
            'units_of_measure_codigo_unico', 'exchange_rates_fecha_moneda', 'payment_methods_codigo_unico', 'users_un_usuario_vigente_por_trabajador',
            'employees_documento_unico'] as $i) {
            DB::statement("DROP INDEX IF EXISTS {$i}");
        }
        foreach ([
            'sunat_catalog_items' => ['sunat_catalog_items_fechas'],
            'unit_conversions' => ['unit_conversions_factor', 'unit_conversions_distintas'],
            'units_of_measure' => ['units_of_measure_decimales', 'units_of_measure_tipo'],
            'exchange_rates' => ['exchange_rates_valores', 'exchange_rates_moneda', 'exchange_rates_origen'],
            'payment_method_fees' => ['payment_method_fees_pct', 'payment_method_fees_fijo', 'payment_method_fees_fechas', 'payment_method_fees_sin_cruce'],
            'payment_methods' => ['payment_methods_status_valido', 'payment_methods_abono'],
            'employees' => ['employees_status_valido', 'employees_cese', 'employees_doc_type_valido', 'employees_doc_formato'],
        ] as $tabla => $restricciones) {
            foreach ($restricciones as $r) {
                DB::statement("ALTER TABLE {$tabla} DROP CONSTRAINT IF EXISTS {$r}");
            }
        }
        DB::statement('ALTER TABLE payment_methods DROP COLUMN IF EXISTS change_reason');
        DB::statement('ALTER TABLE unit_conversions ALTER COLUMN factor TYPE integer USING round(factor)::integer');
    }
};
