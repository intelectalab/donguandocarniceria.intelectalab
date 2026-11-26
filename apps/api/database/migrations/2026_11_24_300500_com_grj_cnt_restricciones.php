<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// COM, GRJ y CNT · restricciones, índices y reglas en la base (300100 a 300400 crearon las tablas).
// Decisiones y motivos: docs/contratos.md (secciones COM, GRJ y CNT) y docs/cambios/2026-11-24_com-grj-cnt.md.
//
//  COM
//  - RN-COM-03: una línea aceptada que se compra por kg lleva peso mayor que 0.
//  - RN-COM-05: un comprobante es único por empresa, proveedor, tipo, serie y número (los anulados no cuentan).
//  - RN-COM-06: total = base gravada + IGV + no gravado + otros cargos.
//  - RN-COM-08: lo pagado no supera el total del comprobante.
//  - RN-COM-12: una NTI de la granja no lleva IGV.
//  - Números únicos por empresa: OC, recepción, requerimiento y pago. Un proveedor por documento de identidad.
//  GRJ
//  - RN-GRJ-01: los vínculos de un mismo proveedor no se superponen (restricción de exclusión).
//  - RN-GRJ-04: un envío es único por su clave de idempotencia.
//  CNT
//  - RN-CNT-01: un asiento solo pasa a aprobado si cuadra (Σ debe = Σ haber > 0), en un disparador.
//  - RN-CNT-03: un asiento aprobado no se modifica ni se borra, ni sus líneas (disparadores).
//  - RN-CNT-04: cada línea tiene importe al debe o al haber, no ambos, y no negativo.
//  - RN-CNT-06: no se crea ni se aprueba un asiento con fecha en un período cerrado (disparador).
//  - RN-CNT-14: el número es correlativo por empresa y período (único).
return new class extends Migration
{
    private const ESTADOS = [
        ['suppliers', 'supplier_type', ['PRODUCER', 'SLAUGHTERHOUSE', 'RELATED_FARM', 'PACKAGING', 'INPUTS', 'SERVICES', 'ADVERTISING', 'CONTENT_CREATOR', 'DELIVERY_COMPANY', 'VEHICLE_RENTAL', 'OTHER']],
        ['suppliers', 'sunat_status', ['ACTIVE', 'SUSPENDED', 'LOW', 'NOT_LOCATED', 'UNKNOWN']],
        ['suppliers', 'status', ['ACTIVE', 'INACTIVE']],
        ['supplier_catalog', 'price_basis', ['KG', 'UNIT']],
        ['supplier_catalog', 'status', ['ACTIVE', 'INACTIVE']],
        ['purchase_requisitions', 'status', ['PENDING', 'ORDERED', 'CANCELLED']],
        ['purchase_orders', 'status', ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'VOIDED']],
        ['purchase_order_lines', 'price_basis', ['KG', 'UNIT']],
        ['purchase_receipts', 'status', ['POSTED', 'VOIDED']],
        ['purchase_receipts', 'receipt_type', ['PURCHASE', 'FARM_NTI', 'FARM_INVOICE']],
        ['purchase_receipts', 'inspection_result', ['OK', 'PENDING', 'OBSERVED']],
        ['purchase_receipt_lines', 'price_basis', ['KG', 'UNIT']],
        ['purchase_documents', 'doc_type', ['INVOICE', 'RECEIPT', 'FEE_RECEIPT', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PURCHASE_SETTLEMENT', 'INTERNAL_TRANSFER', 'OTHER']],
        ['purchase_documents', 'status', ['REGISTERED', 'OBSERVED', 'APPROVED', 'VOIDED']],
        ['purchase_documents', 'match_status', ['NOT_CHECKED', 'MATCHED', 'OBSERVED', 'APPROVED_DIFF']],
        ['purchase_documents', 'currency', ['PEN', 'USD']],
        ['supplier_payments', 'method', ['TRANSFER', 'CASH', 'CHECK', 'YAPE', 'PLIN', 'INTERNAL_SETTLEMENT', 'OTHER']],
        ['supplier_payments', 'status', ['CONFIRMED', 'REVERSED']],
        ['farm_links', 'mode', ['NTI', 'INVOICE']],
        ['farm_links', 'status', ['ACTIVE', 'CLOSED']],
        ['farm_product_mappings', 'status', ['ACTIVE', 'INACTIVE']],
        ['farm_dispatches', 'status', ['RECEIVED_PENDING', 'RECEIVED', 'DISPUTED', 'RECONCILED', 'ERROR']],
        ['farm_dispatches', 'source', ['WEBHOOK', 'MANUAL']],
        ['farm_dispatches', 'expected_doc_type', ['NTI', 'INVOICE']],
        ['farm_reconciliations', 'status', ['OPEN', 'AGREED', 'CLOSED']],
        ['gl_accounts', 'acc_type', ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE', 'COST', 'ANALYTIC', 'CONTROL']],
        ['gl_accounts', 'nature', ['DEBIT', 'CREDIT']],
        ['gl_accounts', 'status', ['ACTIVE', 'INACTIVE']],
        ['journal_rules', 'source', ['SALE', 'PURCHASE', 'NTI', 'EXPENSE', 'COLLECTION', 'PAYMENT', 'PAYROLL', 'CONSUMPTION', 'PRODUCTION', 'COGS', 'INV_ADJUSTMENT']],
        ['journal_rules', 'status', ['ACTIVE', 'INACTIVE']],
        ['journal_rule_lines', 'side', ['D', 'C']],
        ['journal_rule_lines', 'account_from', ['FIXED', 'DETAIL', 'CASH', 'CASH_TO', 'PAYABLE', 'PARAM']],
        ['journal_entries', 'status', ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'VOIDED']],
        ['accountant_inbox_items', 'status', ['PENDING', 'CLASSIFIED', 'RETURNED', 'APPROVED']],
        ['accountant_inbox_items', 'reason', ['NO_RULE', 'MISSING_ACCOUNT', 'MISSING_COST_CENTER', 'MISSING_BRAND', 'PO_MISMATCH', 'SIRE_DIFF', 'NO_VALID_RECEIPT']],
        ['sire_proposals', 'register', ['PURCHASES', 'SALES']],
        ['sire_proposals', 'status', ['IMPORTED', 'WITH_DIFFS', 'RECONCILED', 'SUBMITTED']],
        ['sire_proposal_lines', 'origin', ['PROPOSAL', 'SYSTEM']],
        ['sire_proposal_lines', 'match_status', ['MATCHED', 'AMOUNT_DIFF', 'MISSING_IN_SYSTEM', 'MISSING_IN_PROPOSAL']],
        ['sire_submissions', 'register', ['PURCHASES', 'SALES']],
        ['sire_submissions', 'action', ['ACCEPT', 'REPLACE', 'ADJUST']],
        ['sire_submissions', 'status', ['PREPARED', 'SENT', 'ACCEPTED', 'REJECTED']],
        ['ledger_exports', 'format', ['PDF', 'XLSX', 'TXT']],
        ['bank_reconciliations', 'status', ['OPEN', 'CLOSED']],
        ['bank_statement_lines', 'match_status', ['MATCHED', 'UNMATCHED', 'BOOKED']],
        ['period_close_tasks', 'status', ['PENDING', 'DONE', 'WAIVED']],
        ['payroll_journal_imports', 'status', ['POSTED', 'VOIDED']],
        ['fs_templates', 'kind', ['BALANCE', 'INCOME']],
        ['fs_template_lines', 'kind', ['HEADER', 'ACC', 'SUM', 'RESULT']],
    ];

    /** Únicos por empresa: [tabla, columnas, condición]. */
    private const UNICOS = [
        ['suppliers', ['doc_type', 'doc_number'], null],
        ['supplier_catalog', ['supplier_id', 'variant_id'], null],
        ['purchase_requisitions', ['number'], null],
        ['purchase_orders', ['number'], null],
        ['purchase_receipts', ['number'], null],
        ['purchase_documents', ['company_id', 'supplier_id', 'doc_type', 'series', 'number'], "status <> 'VOIDED'"],
        ['supplier_payments', ['number'], null],
        ['farm_product_mappings', ['supplier_id', 'farm_item_code'], "status = 'ACTIVE'"],
        ['farm_dispatches', ['idempotency_key'], null],
        ['farm_reconciliations', ['farm_link_id', 'period'], null],
        ['gl_accounts', ['company_id', 'code'], null],
        ['journal_rules', ['company_id', 'code', 'version'], null],
        ['journal_entries', ['company_id', 'period', 'seq'], 'seq IS NOT NULL'],
        ['cnt_fiscal_years', ['company_id', 'year'], null],
        ['bank_reconciliations', ['cash_account_id', 'period'], null],
        ['period_close_tasks', ['company_id', 'period', 'code'], null],
    ];

    public function up(): void
    {
        DB::statement('ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_changed_at timestamptz');
        DB::statement('ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_changed_by uuid REFERENCES users(id) ON DELETE RESTRICT');
        DB::statement("ALTER TABLE suppliers ALTER COLUMN sunat_status SET DEFAULT 'UNKNOWN'");
        DB::statement('ALTER TABLE suppliers ALTER COLUMN rating SET DEFAULT 3');
        DB::statement('ALTER TABLE suppliers ALTER COLUMN payment_terms_days SET DEFAULT 0');
        DB::statement('ALTER TABLE suppliers ALTER COLUMN default_cost_center_id DROP NOT NULL');
        DB::statement('ALTER TABLE suppliers ALTER COLUMN trade_name DROP NOT NULL');
        DB::statement('ALTER TABLE purchase_receipts ALTER COLUMN received_by DROP NOT NULL');
        DB::statement('ALTER TABLE purchase_receipts ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES users(id) ON DELETE RESTRICT');
        DB::statement('ALTER TABLE purchase_documents ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES users(id) ON DELETE RESTRICT');
        DB::statement('ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES users(id) ON DELETE RESTRICT');
        DB::statement('ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS reverse_reason text');
        DB::statement('ALTER TABLE farm_reconciliations ADD CONSTRAINT farm_reconciliations_closed_by_foreign FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE RESTRICT');
        DB::statement('ALTER TABLE bank_reconciliations ADD CONSTRAINT bank_reconciliations_closed_by_foreign FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE RESTRICT');
        DB::statement('ALTER TABLE accountant_inbox_items ADD CONSTRAINT accountant_inbox_items_assigned_to_foreign FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE RESTRICT');
        DB::statement('ALTER TABLE journal_entries ALTER COLUMN description DROP NOT NULL');
        DB::statement('ALTER TABLE journal_lines ALTER COLUMN description DROP NOT NULL');
        DB::statement('ALTER TABLE journal_lines ALTER COLUMN debit SET DEFAULT 0');
        DB::statement('ALTER TABLE journal_lines ALTER COLUMN credit SET DEFAULT 0');

        foreach (self::ESTADOS as [$t, $c, $vals]) {
            $lista = implode(', ', array_map(fn ($v) => "'{$v}'", $vals));
            DB::statement("ALTER TABLE {$t} ADD CONSTRAINT {$t}_{$c}_valido CHECK ({$c} IS NULL OR {$c} IN ({$lista}))");
        }
        foreach (self::UNICOS as [$t, $cols, $donde]) {
            $nombre = $t.'_'.implode('_', $cols).'_unico';
            $nombre = strlen($nombre) > 60 ? substr($nombre, 0, 54).'_unico' : $nombre;
            DB::statement("CREATE UNIQUE INDEX {$nombre} ON {$t} (tenant_id, ".implode(', ', $cols).')'.($donde ? " WHERE {$donde}" : ''));
        }

        // COM
        DB::statement('ALTER TABLE purchase_requisitions ADD CONSTRAINT purchase_requisitions_qty_positiva CHECK (qty > 0)');
        DB::statement('ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_order_lines_valores CHECK (qty > 0 AND unit_price >= 0)');
        DB::statement('ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_totales CHECK (subtotal >= 0 AND igv >= 0 AND abs(total - subtotal - igv) <= 0.01)');
        DB::statement("ALTER TABLE purchase_receipt_lines ADD CONSTRAINT purchase_receipt_lines_peso_por_kg CHECK (NOT accepted OR price_basis <> 'KG' OR weight_kg > 0)");  // RN-COM-03
        DB::statement('ALTER TABLE purchase_receipt_lines ADD CONSTRAINT purchase_receipt_lines_costo CHECK (unit_cost >= 0 AND total_cost >= 0 AND qty >= 0)');
        DB::statement('ALTER TABLE purchase_documents ADD CONSTRAINT purchase_documents_total_cuadra CHECK (abs(total - (base_taxed + igv + non_taxed + other_charges)) <= 0.011)');  // RN-COM-06
        DB::statement("ALTER TABLE purchase_documents ADD CONSTRAINT purchase_documents_nti_sin_igv CHECK (doc_type <> 'INTERNAL_TRANSFER' OR igv = 0)");  // RN-COM-12
        DB::statement('ALTER TABLE purchase_documents ADD CONSTRAINT purchase_documents_pagado CHECK (paid_amount >= 0 AND paid_amount <= total + 0.004)');  // RN-COM-08
        DB::statement('ALTER TABLE purchase_documents ADD CONSTRAINT purchase_documents_tipo_cambio CHECK (exchange_rate > 0)');
        DB::statement('ALTER TABLE supplier_payments ADD CONSTRAINT supplier_payments_importe CHECK (amount > 0)');
        DB::statement('ALTER TABLE supplier_payment_allocations ADD CONSTRAINT supplier_payment_allocations_importe CHECK (amount > 0)');

        // GRJ · RN-GRJ-01: vigencias sin superponerse para un mismo proveedor (el vínculo cerrado no cuenta).
        DB::statement("ALTER TABLE farm_links ADD CONSTRAINT farm_links_sin_superponer EXCLUDE USING gist
            (tenant_id WITH =, supplier_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&) WHERE (status <> 'CLOSED')");
        DB::statement('ALTER TABLE farm_links ADD CONSTRAINT farm_links_vigencia CHECK (valid_to IS NULL OR valid_to >= valid_from)');
        DB::statement('ALTER TABLE farm_product_mappings ADD CONSTRAINT farm_product_mappings_factor CHECK (conversion_factor > 0 AND transfer_price >= 0)');

        // CNT · RN-CNT-04
        DB::statement('ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_debe_o_haber CHECK (debit >= 0 AND credit >= 0 AND ((debit > 0) <> (credit > 0)))');
        DB::statement("ALTER TABLE period_close_tasks ADD CONSTRAINT period_close_tasks_dispensa_con_motivo CHECK (status <> 'WAIVED' OR length(trim(coalesce(waive_reason, ''))) >= 10)");
        DB::statement('CREATE INDEX journal_entries_origen_index ON journal_entries (source_kind, source_id)');
        DB::statement('CREATE INDEX journal_entries_periodo_index ON journal_entries (tenant_id, period, status)');
        DB::statement('CREATE INDEX journal_lines_cuenta_index ON journal_lines (tenant_id, account_code)');
        DB::statement('CREATE INDEX accountant_inbox_items_origen_index ON accountant_inbox_items (source_type, source_id)');
        DB::statement('CREATE INDEX purchase_documents_saldo_index ON purchase_documents (tenant_id, supplier_id) WHERE balance > 0');

        // RN-CNT-06: período cerrado (la misma consulta que Periodos::abierto()).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION cnt_periodo_cerrado(p_company uuid, p_fecha date) RETURNS boolean
            LANGUAGE sql STABLE AS $$
              SELECT EXISTS (SELECT 1 FROM accounting_periods ap WHERE ap.company_id = p_company
                              AND ap.period = date_trunc('month', p_fecha)::date AND ap.status = 'CLOSED')
            $$;

            -- RN-CNT-01, RN-CNT-03 y RN-CNT-06 en la cabecera del asiento.
            CREATE OR REPLACE FUNCTION cnt_entries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE d numeric; c numeric;
            BEGIN
              IF TG_OP = 'DELETE' THEN
                IF OLD.status = 'APPROVED' THEN
                  RAISE EXCEPTION 'RN-CNT-03: un asiento aprobado no se borra: se corrige con un asiento de reverso.';
                END IF;
                RETURN OLD;
              END IF;
              IF TG_OP = 'UPDATE' AND OLD.status = 'APPROVED' THEN
                -- Solo puede cambiar el enlace a su reverso y a la línea del extracto que lo concilia.
                IF (to_jsonb(NEW) - ARRAY['reversed_by_id', 'bank_line_id', 'history', 'updated_at'])
                   IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['reversed_by_id', 'bank_line_id', 'history', 'updated_at']) THEN
                  RAISE EXCEPTION 'RN-CNT-03: un asiento aprobado no se modifica: se corrige con un asiento de reverso.';
                END IF;
                RETURN NEW;
              END IF;
              IF NEW.status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED') AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.entry_date IS DISTINCT FROM OLD.entry_date)
                 AND cnt_periodo_cerrado(NEW.company_id, NEW.entry_date) THEN
                RAISE EXCEPTION 'RN-CNT-06: el período de % está cerrado: no se registran ni aprueban asientos con esa fecha.', to_char(NEW.entry_date, 'DD/MM/YYYY');
              END IF;
              IF NEW.status = 'APPROVED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'APPROVED') THEN
                SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0) INTO d, c FROM journal_lines WHERE entry_id = NEW.id;
                IF TG_OP = 'UPDATE' AND (d <= 0 OR abs(d - c) > 0.004) THEN
                  RAISE EXCEPTION 'RN-CNT-01: el asiento no cuadra: debe % y haber %.', d, c;
                END IF;
              END IF;
              RETURN NEW;
            END $$;
            CREATE TRIGGER cnt_entries_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_entries
              FOR EACH ROW EXECUTE FUNCTION cnt_entries_guard();

            -- RN-CNT-03 en las líneas: las de un asiento aprobado no se agregan, cambian ni borran.
            CREATE OR REPLACE FUNCTION cnt_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE st text;
            BEGIN
              SELECT status INTO st FROM journal_entries WHERE id = coalesce(NEW.entry_id, OLD.entry_id);
              IF st = 'APPROVED' THEN
                RAISE EXCEPTION 'RN-CNT-03: las líneas de un asiento aprobado no se modifican: se corrige con un asiento de reverso.';
              END IF;
              RETURN coalesce(NEW, OLD);
            END $$;
            CREATE TRIGGER cnt_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
              FOR EACH ROW EXECUTE FUNCTION cnt_lines_guard();
            SQL);
    }

    public function down(): void
    {
        DB::unprepared('DROP TRIGGER IF EXISTS cnt_lines_guard ON journal_lines; DROP TRIGGER IF EXISTS cnt_entries_guard ON journal_entries;
            DROP FUNCTION IF EXISTS cnt_lines_guard(); DROP FUNCTION IF EXISTS cnt_entries_guard(); DROP FUNCTION IF EXISTS cnt_periodo_cerrado(uuid, date);');
        foreach (self::UNICOS as [$t, $cols]) {
            $nombre = $t.'_'.implode('_', $cols).'_unico';
            $nombre = strlen($nombre) > 60 ? substr($nombre, 0, 54).'_unico' : $nombre;
            DB::statement("DROP INDEX IF EXISTS {$nombre}");
        }
        foreach (self::ESTADOS as [$t, $c]) {
            DB::statement("ALTER TABLE {$t} DROP CONSTRAINT IF EXISTS {$t}_{$c}_valido");
        }
        foreach (['bank_changed_at', 'bank_changed_by'] as $c) {
            DB::statement("ALTER TABLE suppliers DROP COLUMN IF EXISTS {$c}");
        }
    }
};
