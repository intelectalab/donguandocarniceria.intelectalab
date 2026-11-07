<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// PLT-09: la fecha límite de cierre (día plt_period_close_day del mes siguiente) se guarda al
// cerrar el mes. Así, si después cambia ese día en PLT-10, los meses ya cerrados conservan su
// «a tiempo» o «fuera de plazo». Los meses ya cerrados se completan con el día vigente hoy.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE accounting_periods ADD COLUMN IF NOT EXISTS close_due_date date');
        DB::statement(<<<'SQL'
            UPDATE accounting_periods ap
               SET close_due_date = (ap.period + interval '1 month')::date + (dia.valor - 1)
              FROM (
                SELECT t.id AS tenant_id,
                       COALESCE(
                         (SELECT p.value::numeric::int FROM parameters p
                           WHERE p.tenant_id = t.id AND p.key = 'plt_period_close_day' AND p.scope = 'TENANT' LIMIT 1),
                         (SELECT d.default_value::numeric::int FROM parameter_definitions d WHERE d.key = 'plt_period_close_day'),
                         5) AS valor
                  FROM tenants t
              ) dia
             WHERE dia.tenant_id = ap.tenant_id AND ap.status = 'CLOSED' AND ap.close_due_date IS NULL
            SQL);
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE accounting_periods DROP COLUMN IF EXISTS close_due_date');
    }
};
