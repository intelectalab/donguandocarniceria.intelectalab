<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// CAJ · Cajas, cobros y conciliación: ajusta las tablas generadas desde el prototipo a las reglas del módulo.
//  - payment_allocations: una aplicación va a un pedido, a un comprobante o a los dos (el cobro contra entrega
//    se aplica al pedido antes de emitir la boleta; FAC la enlaza al emitir). Monto mayor que cero.
//  - payments: estados y conciliación válidos, monto positivo, 4 dígitos de tarjeta, motivo del reverso
//    (RN-CAJ-06), foto del voucher, nota y origen del cobro, y RN-CAJ-04 en la base: la misma operación no
//    se registra dos veces para el mismo medio mientras el cobro esté vigente.
//  - cash_accounts: código único, tipos y estados válidos y comisión entre 0 y 100.
//  - settlement_batch_items: cada cobro entra a un solo abono (RN-CAJ-13).
//  - customer_balance_movements: tipos válidos y RN-CAJ-08 en la base (el saldo a favor nunca queda negativo).
//  - cash_transfers y driver_settlements: montos y estados válidos.
// Compatible con los datos de prueba. Correr con: php artisan migrate --database=pgsql_owner
return new class extends Migration
{
    public function up(): void
    {
        // payment_allocations
        DB::statement('ALTER TABLE payment_allocations ALTER COLUMN order_id DROP NOT NULL, ALTER COLUMN document_id DROP NOT NULL');
        DB::statement('ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_destino_check CHECK (order_id IS NOT NULL OR document_id IS NOT NULL)');
        DB::statement('ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_amount_check CHECK (amount > 0)');
        DB::statement('ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_order_fk FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE RESTRICT');
        DB::statement('ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_document_fk FOREIGN KEY (document_id) REFERENCES sales_documents(id) ON DELETE RESTRICT');
        DB::statement('CREATE INDEX IF NOT EXISTS payment_allocations_order_idx ON payment_allocations (order_id)');
        DB::statement('CREATE INDEX IF NOT EXISTS payment_allocations_document_idx ON payment_allocations (document_id)');

        // payments
        DB::statement('ALTER TABLE payments ADD COLUMN IF NOT EXISTS voucher_file_id uuid NULL');
        DB::statement('ALTER TABLE payments ADD COLUMN IF NOT EXISTS notes varchar(255) NULL');
        DB::statement('ALTER TABLE payments ADD COLUMN IF NOT EXISTS source varchar(20) NULL');
        DB::statement("ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('CONFIRMED','REVERSED'))");
        DB::statement("ALTER TABLE payments ADD CONSTRAINT payments_reconciliation_check CHECK (reconciliation_status IN ('PENDING','MATCHED','DIFFERENCE','NOT_APPLICABLE'))");
        DB::statement('ALTER TABLE payments ADD CONSTRAINT payments_amount_check CHECK (amount > 0 AND fee_amount >= 0 AND coalesce(fee_igv, 0) >= 0)');
        DB::statement("ALTER TABLE payments ADD CONSTRAINT payments_card_last4_check CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$')");
        DB::statement("ALTER TABLE payments ADD CONSTRAINT payments_reverso_check CHECK (status <> 'REVERSED' OR reversal_reason IS NOT NULL)");
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS payments_operacion_vigente ON payments (tenant_id, payment_method_id, upper(reference)) WHERE status = 'CONFIRMED' AND reference IS NOT NULL");
        DB::statement('CREATE INDEX IF NOT EXISTS payments_paid_at_idx ON payments (paid_at)');

        // cash_accounts
        DB::statement('ALTER TABLE cash_accounts ADD CONSTRAINT cash_accounts_code_unique UNIQUE (tenant_id, code)');
        DB::statement("ALTER TABLE cash_accounts ADD CONSTRAINT cash_accounts_type_check CHECK (account_type IN ('BANK','CARD_ACQUIRER','CASH_REGISTER','DRIVER_CASH','GATEWAY','PETTY_CASH','WALLET'))");
        DB::statement("ALTER TABLE cash_accounts ADD CONSTRAINT cash_accounts_status_check CHECK (status IN ('ACTIVE','INACTIVE'))");
        DB::statement('ALTER TABLE cash_accounts ADD CONSTRAINT cash_accounts_fee_check CHECK (coalesce(fee_pct, 0) BETWEEN 0 AND 100 AND coalesce(fee_fixed, 0) >= 0 AND coalesce(settlement_days, 0) >= 0)');

        // settlement_batches y sus cobros
        DB::statement("ALTER TABLE settlement_batches ADD CONSTRAINT settlement_batches_status_check CHECK (status IN ('OPEN','MATCHED','WITH_DIFFERENCE'))");
        DB::statement('ALTER TABLE settlement_batches ADD CONSTRAINT settlement_batches_montos_check CHECK (gross_amount >= 0 AND fee_amount >= 0 AND fee_igv >= 0)');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS settlement_batch_items_un_cobro ON settlement_batch_items (payment_id)');

        // cash_transfers
        DB::statement('ALTER TABLE cash_transfers ADD COLUMN IF NOT EXISTS created_by uuid NULL REFERENCES users(id) ON DELETE RESTRICT');
        DB::statement('ALTER TABLE cash_transfers ADD CONSTRAINT cash_transfers_montos_check CHECK (amount > 0 AND from_account_id <> to_account_id)');
        DB::statement("ALTER TABLE cash_transfers ADD CONSTRAINT cash_transfers_status_check CHECK (status IN ('CONFIRMED'))");

        // driver_settlements
        DB::statement("ALTER TABLE driver_settlements ADD CONSTRAINT driver_settlements_status_check CHECK (status IN ('SETTLED','WITH_DIFFERENCE','APPROVED'))");
        DB::statement('ALTER TABLE driver_settlements ADD CONSTRAINT driver_settlements_number_unique UNIQUE (tenant_id, number)');

        // customer_balance_movements: tipos y RN-CAJ-08
        DB::statement("ALTER TABLE customer_balance_movements ADD CONSTRAINT customer_balance_movements_type_check CHECK (movement_type IN ('OVERPAYMENT','CREDIT_NOTE','MERGE_IN','REVERSAL','APPLIED','REFUND','MERGE_OUT'))");
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION caj_saldo_a_favor_no_negativo() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF (SELECT coalesce(sum(amount), 0) FROM customer_balance_movements WHERE customer_id = NEW.customer_id) < -0.005 THEN
                RAISE EXCEPTION 'RN-CAJ-08: el saldo a favor del cliente no puede quedar negativo' USING ERRCODE = 'check_violation';
              END IF;
              RETURN NEW;
            END $$
        SQL);
        DB::statement('CREATE TRIGGER caj_saldo_a_favor AFTER INSERT ON customer_balance_movements FOR EACH ROW EXECUTE FUNCTION caj_saldo_a_favor_no_negativo()');
    }

    public function down(): void
    {
        DB::statement('DROP TRIGGER IF EXISTS caj_saldo_a_favor ON customer_balance_movements');
        DB::statement('DROP FUNCTION IF EXISTS caj_saldo_a_favor_no_negativo()');
        DB::statement('ALTER TABLE customer_balance_movements DROP CONSTRAINT IF EXISTS customer_balance_movements_type_check');
        foreach (['status_check', 'number_unique'] as $c) {
            DB::statement("ALTER TABLE driver_settlements DROP CONSTRAINT IF EXISTS driver_settlements_{$c}");
        }
        DB::statement('ALTER TABLE cash_transfers DROP CONSTRAINT IF EXISTS cash_transfers_montos_check');
        DB::statement('ALTER TABLE cash_transfers DROP CONSTRAINT IF EXISTS cash_transfers_status_check');
        DB::statement('ALTER TABLE cash_transfers DROP COLUMN IF EXISTS created_by');
        DB::statement('DROP INDEX IF EXISTS settlement_batch_items_un_cobro');
        DB::statement('ALTER TABLE settlement_batches DROP CONSTRAINT IF EXISTS settlement_batches_status_check');
        DB::statement('ALTER TABLE settlement_batches DROP CONSTRAINT IF EXISTS settlement_batches_montos_check');
        foreach (['code_unique', 'type_check', 'status_check', 'fee_check'] as $c) {
            DB::statement("ALTER TABLE cash_accounts DROP CONSTRAINT IF EXISTS cash_accounts_{$c}");
        }
        DB::statement('DROP INDEX IF EXISTS payments_operacion_vigente');
        DB::statement('DROP INDEX IF EXISTS payments_paid_at_idx');
        foreach (['status_check', 'reconciliation_check', 'amount_check', 'card_last4_check', 'reverso_check'] as $c) {
            DB::statement("ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_{$c}");
        }
        DB::statement('ALTER TABLE payments DROP COLUMN IF EXISTS voucher_file_id, DROP COLUMN IF EXISTS notes, DROP COLUMN IF EXISTS source');
        DB::statement('DROP INDEX IF EXISTS payment_allocations_order_idx');
        DB::statement('DROP INDEX IF EXISTS payment_allocations_document_idx');
        foreach (['destino_check', 'amount_check', 'order_fk', 'document_fk'] as $c) {
            DB::statement("ALTER TABLE payment_allocations DROP CONSTRAINT IF EXISTS payment_allocations_{$c}");
        }
        // Las aplicaciones sin pedido o sin comprobante no caben en las columnas obligatorias de antes.
        DB::statement('DELETE FROM payment_allocations WHERE order_id IS NULL OR document_id IS NULL');
        DB::statement('ALTER TABLE payment_allocations ALTER COLUMN order_id SET NOT NULL, ALTER COLUMN document_id SET NOT NULL');
    }
};
