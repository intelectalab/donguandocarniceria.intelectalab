<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// OPS · tickets de soporte: OPS-15 Mis tickets (la empresa) y OPS-09 Bandeja de tickets (la consola).
//  - support_tickets y support_ticket_messages son de cada empresa (RLS). La consola los ve de todas porque la
//    política acepta también una sesión de plataforma (app.platform = on), que solo fija el middleware de la consola
//    después de validar a su usuario (RN-OPS-06: la consola ve tickets y accesos, no datos de negocio).
//  - Número correlativo único en toda la plataforma (TK-0101…).
//  - Plazo de primera respuesta por prioridad (RN-OPS-15) y cierre automático de los resueltos: parámetros de plataforma.
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION app_is_platform() RETURNS boolean LANGUAGE sql STABLE
                AS $$ SELECT current_setting('app.platform', true) = 'on' $$;
            CREATE SEQUENCE IF NOT EXISTS support_ticket_number_seq START 101;
            SQL);

        Schema::create('support_tickets', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 12)->default(DB::raw("'TK-' || lpad(nextval('support_ticket_number_seq')::text, 4, '0')"));
            $table->string('subject', 150);
            $table->text('description');
            $table->string('category', 20);
            $table->string('priority', 10);
            $table->string('status', 20)->default('OPEN');
            $table->uuid('opened_by')->nullable();
            $table->string('opened_by_name', 120);
            $table->uuid('assigned_platform_user')->nullable();
            $table->timestampTz('opened_at')->useCurrent();
            $table->timestampTz('first_response_due_at');
            $table->timestampTz('first_response_at')->nullable();
            $table->timestampTz('resolved_at')->nullable();
            $table->timestampTz('closed_at')->nullable();
            $table->unsignedSmallInteger('satisfaction')->nullable();
            $table->timestampsTz();
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('opened_by')->references('id')->on('users')->nullOnDelete();
            $table->foreign('assigned_platform_user')->references('id')->on('platform_users')->nullOnDelete();
            $table->unique('number');
            $table->index(['tenant_id', 'status']);
            $table->index(['status', 'first_response_due_at']);
        });
        DB::statement("ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_estado CHECK (status IN ('OPEN','IN_PROGRESS','WAITING_CUSTOMER','RESOLVED','CLOSED'))");
        DB::statement("ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_prioridad CHECK (priority IN ('URGENT','HIGH','NORMAL','LOW'))");
        DB::statement("ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_categoria CHECK (category IN ('BILLING','ONBOARDING','EINVOICE','WHATSAPP','ORDERS','INVENTORY','ACCOUNTING','API','BUG','FEATURE_REQUEST','OTHER'))");
        DB::statement('ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_calificacion CHECK (satisfaction IS NULL OR satisfaction BETWEEN 1 AND 5)');

        Schema::create('support_ticket_messages', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('ticket_id');
            $table->string('author_type', 10);
            $table->string('author_name', 120);
            $table->uuid('author_user_id')->nullable();
            $table->uuid('author_platform_user_id')->nullable();
            $table->text('body');
            $table->string('status_from', 20)->nullable();
            $table->string('status_to', 20)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('ticket_id')->references('id')->on('support_tickets')->cascadeOnDelete();
            $table->foreign('author_platform_user_id')->references('id')->on('platform_users')->nullOnDelete();
            $table->index(['ticket_id', 'created_at']);
        });
        DB::statement("ALTER TABLE support_ticket_messages ADD CONSTRAINT support_ticket_messages_autor CHECK (author_type IN ('CUSTOMER','PLATFORM','SYSTEM'))");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON support_ticket_messages FROM aycha_app');   // la conversación no se cambia

        foreach (['support_tickets', 'support_ticket_messages'] as $t) {
            DB::statement("ALTER TABLE {$t} ENABLE ROW LEVEL SECURITY");
            DB::statement("CREATE POLICY tenant_isolation ON {$t} USING (tenant_id = app_tenant_id() OR app_is_platform()) WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform())");
        }
        DB::statement('GRANT USAGE, SELECT ON SEQUENCE support_ticket_number_seq TO aycha_app');

        foreach ([
            'ops_ticket_first_response_hours' => [['URGENT' => 1, 'HIGH' => 4, 'NORMAL' => 8, 'LOW' => 24], 'Horas para la primera respuesta de soporte según la prioridad (urgente cuenta las 24 horas; las demás, horario hábil de lunes a sábado de 9 a 18)'],
            'ops_ticket_auto_close_days' => [7, 'Días tras los que se cierra un ticket resuelto si el cliente no responde'],
        ] as $key => [$valor, $descripcion]) {
            DB::table('platform_parameters')->insertOrIgnore(['key' => $key, 'value' => json_encode($valor), 'description' => $descripcion, 'updated_at' => now()]);
        }
    }

    public function down(): void
    {
        DB::table('platform_parameters')->whereIn('key', ['ops_ticket_first_response_hours', 'ops_ticket_auto_close_days'])->delete();
        Schema::dropIfExists('support_ticket_messages');
        Schema::dropIfExists('support_tickets');
        DB::unprepared('DROP SEQUENCE IF EXISTS support_ticket_number_seq; DROP FUNCTION IF EXISTS app_is_platform();');
    }
};
