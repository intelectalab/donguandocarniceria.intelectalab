<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Corrección del generador: estas columnas guardan ids de otras tablas del sistema, pero en el
// prototipo casi siempre estaban vacías o con un valor que no coincidía con ningún id, así que
// salieron como texto. Pasan a uuid con su FK (las tablas aún no tienen datos de operación).
// Las que guardan ids de sistemas externos (external_id, waba_id, provider_*, woo_*, device_id,
// session_id, client_event_id) siguen siendo texto: no son ids de este sistema.
return new class extends Migration
{
    private array $fk = [
        'cash_accounts.brand_id' => 'brands',
        'customers.price_list_id' => 'price_lists',
        'expense_categories.parent_id' => 'expense_categories',
        'expense_approval_rules.establishment_id' => 'establishments',
        'expenses.payment_method_id' => 'payment_methods',
        'expenses.route_id' => 'delivery_routes',
        'expenses.receipt_file_id' => 'file_attachments',
        'picking_tasks.route_id' => 'delivery_routes',
        'picking_tasks.photo_file_id' => 'file_attachments',
        'picking_waves.route_id' => 'delivery_routes',
        'shipment_parcels.route_id' => 'delivery_routes',
        'picking_task_lines.order_line_id' => 'sales_order_lines',
        'stock_reservations.order_line_id' => 'sales_order_lines',
        'stock_transfer_lines.lot_id' => 'lots',
        'vehicles.driver_user_id' => 'users',
        'discount_limits.role_id' => 'roles',
        'dispatch_guides.sales_document_id' => 'sales_documents',
        'dispatch_guides.transfer_id' => 'stock_transfers',
        'customer_balance_movements.document_id' => 'sales_documents',
        'delivery_events.payment_id' => 'payments',
        'delivery_events.photo_file_id' => 'file_attachments',
        'delivery_events.signature_file_id' => 'file_attachments',
        'payments.gateway_transaction_id' => 'gateway_transactions',
        'ad_platform_invoices.expense_id' => 'expenses',
        'ad_platform_invoices.file_id' => 'file_attachments',
        'ad_attributions.lead_id' => 'leads',
        'ad_accounts.connector_id' => 'integration_connectors',
        'conversation_assignments.from_user_id' => 'users',
        'control_alerts.call_id' => 'tel_calls',
        'tel_calls.lead_id' => 'leads',
        'tel_settings.connector_id' => 'integration_connectors',
        'tel_settings.notice_audio_file_id' => 'file_attachments',
        'tel_recordings.file_id' => 'file_attachments',
        'tel_activation_steps.evidence_file_id' => 'file_attachments',
        'pos_terminals.invoice_series_id' => 'document_series',
    ];

    // uuid sin FK: puede apuntar a filas de varias tablas.
    private array $polimorficas = ['search_entries.entity_id'];

    public function up(): void
    {
        foreach ([...array_keys($this->fk), ...$this->polimorficas] as $col) {
            [$tabla, $columna] = explode('.', $col);
            // Un valor que no tiene forma de uuid no puede ser un id de este sistema: queda vacío.
            DB::statement("ALTER TABLE {$tabla} ALTER COLUMN {$columna} TYPE uuid USING (CASE WHEN {$columna} ~* '^[0-9a-f-]{36}$' THEN {$columna}::uuid END)");
        }
        foreach ($this->fk as $col => $destino) {
            [$tabla, $columna] = explode('.', $col);
            DB::statement("ALTER TABLE {$tabla} ADD CONSTRAINT {$tabla}_{$columna}_foreign FOREIGN KEY ({$columna}) REFERENCES {$destino}(id) ON DELETE RESTRICT");
            DB::statement("CREATE INDEX IF NOT EXISTS {$tabla}_{$columna}_index ON {$tabla} ({$columna})");
        }
    }

    public function down(): void
    {
        foreach ($this->fk as $col => $destino) {
            [$tabla, $columna] = explode('.', $col);
            DB::statement("ALTER TABLE {$tabla} DROP CONSTRAINT IF EXISTS {$tabla}_{$columna}_foreign");
            DB::statement("DROP INDEX IF EXISTS {$tabla}_{$columna}_index");
        }
        foreach ([...array_keys($this->fk), ...$this->polimorficas] as $col) {
            [$tabla, $columna] = explode('.', $col);
            DB::statement("ALTER TABLE {$tabla} ALTER COLUMN {$columna} TYPE varchar(40) USING {$columna}::text");
        }
    }
};
