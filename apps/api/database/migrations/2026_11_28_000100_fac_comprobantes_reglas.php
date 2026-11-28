<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// FAC · Comprobantes electrónicos y guía de remisión. Ajustes del dueño del módulo sobre las tablas
// generadas (2026_11_03_001400_fac_comprobantes.php), sin editar esa migración y solo en tablas de FAC:
//  - sales_documents: tipos, estados y condiciones permitidos; valor de venta + IGV = total (RN-FAC-01);
//    al crédito con vencimiento (RN-FAC-13); boleta por resumen diario, reemisión y reingreso de stock.
//  - En la base, aunque falle la API: un comprobante enviado no cambia tipo, serie, número, fecha,
//    cliente, montos ni líneas (RN-FAC-03); un anulado no se reactiva (RN-FAC-10); no se borran.
//  - einvoice_submissions: reenvío manual y quién lo pidió (sigue siendo solo inserción).
//  - sunat_daily_summaries y sus líneas: tipos RC y RA, estados y último error.
//  - dispatch_guides: próximo reintento como fecha, revisión, anulación y la regla
//    de transporte (RN-FAC-11): público con transportista, privado con vehículo y conductor.
return new class extends Migration
{
    public function up(): void
    {
        // ---------------------------------------------------------------- sales_documents
        DB::statement(<<<'SQL'
            ALTER TABLE sales_documents
              ALTER COLUMN customer_name TYPE varchar(200),
              ALTER COLUMN brand_logo TYPE varchar(40),
              ALTER COLUMN voided_by TYPE varchar(120),
              ALTER COLUMN send_attempts SET DEFAULT 0,
              ALTER COLUMN cost SET DEFAULT 0,
              ALTER COLUMN currency SET DEFAULT 'PEN',
              ALTER COLUMN payment_terms SET DEFAULT 'CASH',
              ALTER COLUMN sunat_status SET DEFAULT 'PENDING',
              ALTER COLUMN status SET DEFAULT 'ISSUED',
              ADD COLUMN IF NOT EXISTS summary_pending boolean NOT NULL DEFAULT false,
              ADD COLUMN IF NOT EXISTS reissue_of uuid REFERENCES sales_documents(id),
              ADD COLUMN IF NOT EXISTS reissued_by uuid REFERENCES sales_documents(id),
              ADD COLUMN IF NOT EXISTS restocked_warehouse_id uuid REFERENCES warehouses(id),
              ADD COLUMN IF NOT EXISTS credit_days integer,
              ADD COLUMN IF NOT EXISTS issued_by_name varchar(120),
              ADD COLUMN IF NOT EXISTS source varchar(20)
        SQL);
        DB::statement("UPDATE sales_documents SET source = CASE WHEN pos_terminal_id IS NOT NULL THEN 'POS' WHEN order_id IS NOT NULL THEN 'ORDER' ELSE 'DIRECT' END WHERE source IS NULL");
        DB::statement("ALTER TABLE sales_documents ALTER COLUMN source SET DEFAULT 'DIRECT'");
        DB::statement("ALTER TABLE sales_documents ADD CONSTRAINT sales_documents_doc_type_check CHECK (doc_type IN ('INVOICE','RECEIPT','CREDIT_NOTE','DEBIT_NOTE'))");
        DB::statement("ALTER TABLE sales_documents ADD CONSTRAINT sales_documents_status_check CHECK (status IN ('ISSUED','VOIDED'))");
        DB::statement("ALTER TABLE sales_documents ADD CONSTRAINT sales_documents_sunat_status_check CHECK (sunat_status IN ('PENDING','ACCEPTED','OBSERVED','REJECTED','VOIDED'))");
        DB::statement("ALTER TABLE sales_documents ADD CONSTRAINT sales_documents_payment_terms_check CHECK (payment_terms IN ('CASH','CREDIT'))");
        DB::statement("ALTER TABLE sales_documents ADD CONSTRAINT sales_documents_customer_doc_check CHECK (customer_doc_type IN ('RUC','DNI','CE','PAS','NONE'))");
        // RN-FAC-01: la cabecera cuadra consigo misma (valor de venta + IGV = total) y no es negativa.
        DB::statement('ALTER TABLE sales_documents ADD CONSTRAINT sales_documents_montos_check CHECK (abs(subtotal + igv - total) <= 0.01 AND total >= 0 AND subtotal >= 0 AND igv >= 0)');
        // RN-FAC-13: al crédito, con vencimiento.
        DB::statement("ALTER TABLE sales_documents ADD CONSTRAINT sales_documents_credito_check CHECK (payment_terms <> 'CREDIT' OR due_date IS NOT NULL)");
        // RN-FAC-07: una nota refiere a otro comprobante y lleva el motivo SUNAT.
        DB::statement("ALTER TABLE sales_documents ADD CONSTRAINT sales_documents_nota_check CHECK (doc_type NOT IN ('CREDIT_NOTE','DEBIT_NOTE') OR (related_document_id IS NOT NULL AND note_reason_code IS NOT NULL))");
        // RN-FAC-10: anular exige motivo.
        DB::statement("ALTER TABLE sales_documents ADD CONSTRAINT sales_documents_anulado_check CHECK (status <> 'VOIDED' OR (void_reason IS NOT NULL AND length(trim(void_reason)) > 0))");
        DB::statement('CREATE INDEX IF NOT EXISTS sales_documents_cola ON sales_documents (sunat_status, next_retry_at) WHERE sunat_status = \'PENDING\'');
        DB::statement('CREATE INDEX IF NOT EXISTS sales_documents_fecha ON sales_documents (issue_date)');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fac_comprobante_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'RN-FAC-03: un comprobante no se borra; se anula o se corrige con una nota';
              END IF;
              IF OLD.status = 'VOIDED' AND NEW.status <> 'VOIDED' THEN
                RAISE EXCEPTION 'RN-FAC-10: un comprobante anulado no se reactiva';
              END IF;
              IF (OLD.send_attempts > 0 OR OLD.sunat_status <> 'PENDING') AND (
                   NEW.doc_type IS DISTINCT FROM OLD.doc_type OR NEW.series IS DISTINCT FROM OLD.series
                OR NEW.number IS DISTINCT FROM OLD.number OR NEW.full_number IS DISTINCT FROM OLD.full_number
                OR NEW.series_id IS DISTINCT FROM OLD.series_id OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
                OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.customer_doc_type IS DISTINCT FROM OLD.customer_doc_type
                OR NEW.customer_doc_number IS DISTINCT FROM OLD.customer_doc_number OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
                OR NEW.subtotal IS DISTINCT FROM OLD.subtotal OR NEW.igv IS DISTINCT FROM OLD.igv OR NEW.total IS DISTINCT FROM OLD.total
                OR NEW.brand_id IS DISTINCT FROM OLD.brand_id OR NEW.related_document_id IS DISTINCT FROM OLD.related_document_id) THEN
                RAISE EXCEPTION 'RN-FAC-03: el comprobante % ya se envió a SUNAT: no cambia; corrígelo con una nota de crédito o débito', OLD.full_number;
              END IF;
              RETURN NEW;
            END $$;
            DROP TRIGGER IF EXISTS fac_comprobante_inmutable ON sales_documents;
            CREATE TRIGGER fac_comprobante_inmutable BEFORE UPDATE OR DELETE ON sales_documents FOR EACH ROW EXECUTE FUNCTION fac_comprobante_inmutable();

            CREATE OR REPLACE FUNCTION fac_lineas_inmutables() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE d record;
            BEGIN
              SELECT send_attempts, sunat_status, full_number INTO d FROM sales_documents
               WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.sales_document_id ELSE NEW.sales_document_id END;
              IF FOUND AND (d.send_attempts > 0 OR d.sunat_status <> 'PENDING') THEN
                IF TG_OP = 'UPDATE' AND NEW.qty IS NOT DISTINCT FROM OLD.qty AND NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price
                   AND NEW.total IS NOT DISTINCT FROM OLD.total AND NEW.subtotal IS NOT DISTINCT FROM OLD.subtotal
                   AND NEW.igv IS NOT DISTINCT FROM OLD.igv AND NEW.description IS NOT DISTINCT FROM OLD.description
                   AND NEW.variant_id IS NOT DISTINCT FROM OLD.variant_id AND NEW.sales_document_id IS NOT DISTINCT FROM OLD.sales_document_id THEN
                  RETURN NEW;
                END IF;
                RAISE EXCEPTION 'RN-FAC-03: las líneas del comprobante % ya enviado no cambian', d.full_number;
              END IF;
              RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
            END $$;
            DROP TRIGGER IF EXISTS fac_lineas_inmutables ON sales_document_lines;
            CREATE TRIGGER fac_lineas_inmutables BEFORE INSERT OR UPDATE OR DELETE ON sales_document_lines FOR EACH ROW EXECUTE FUNCTION fac_lineas_inmutables();
        SQL);

        // ---------------------------------------------------------------- sales_document_lines
        DB::statement("ALTER TABLE sales_document_lines ALTER COLUMN igv_affectation SET DEFAULT '10', ALTER COLUMN cost SET DEFAULT 0");
        DB::statement("ALTER TABLE sales_document_lines ADD CONSTRAINT sales_document_lines_afectacion_check CHECK (igv_affectation IN ('10','20','30'))");
        DB::statement('ALTER TABLE sales_document_lines ADD CONSTRAINT sales_document_lines_montos_check CHECK (qty > 0 AND total >= 0 AND abs(subtotal + igv - total) <= 0.01)');

        // ---------------------------------------------------------------- einvoice_submissions (solo inserción)
        DB::statement(<<<'SQL'
            ALTER TABLE einvoice_submissions
              ALTER COLUMN message TYPE text,
              ADD COLUMN IF NOT EXISTS manual boolean NOT NULL DEFAULT false,
              ADD COLUMN IF NOT EXISTS requested_by_name varchar(120)
        SQL);
        DB::statement("ALTER TABLE einvoice_submissions ADD CONSTRAINT einvoice_submissions_result_check CHECK (result IN ('ACCEPTED','OBSERVED','REJECTED','TIMEOUT','ERROR'))");
        DB::statement('ALTER TABLE einvoice_submissions ADD CONSTRAINT einvoice_submissions_objeto_check CHECK (num_nonnulls(document_id, guide_id, summary_id) = 1)');

        // ---------------------------------------------------------------- resúmenes diarios y bajas
        DB::statement(<<<'SQL'
            ALTER TABLE sunat_daily_summaries
              ALTER COLUMN ticket TYPE varchar(40),
              ADD COLUMN IF NOT EXISTS last_error text,
              ADD COLUMN IF NOT EXISTS created_by_name varchar(120)
        SQL);
        DB::statement("UPDATE sunat_daily_summaries SET status = coalesce(status, 'PENDING')");
        DB::statement("ALTER TABLE sunat_daily_summaries ALTER COLUMN status SET DEFAULT 'PENDING', ALTER COLUMN status SET NOT NULL, ALTER COLUMN summary_type SET NOT NULL, ALTER COLUMN reference_date SET NOT NULL, ALTER COLUMN identifier SET NOT NULL");
        DB::statement("ALTER TABLE sunat_daily_summaries ADD CONSTRAINT sunat_daily_summaries_tipo_check CHECK (summary_type IN ('RC','RA'))");
        DB::statement("ALTER TABLE sunat_daily_summaries ADD CONSTRAINT sunat_daily_summaries_estado_check CHECK (status IN ('PENDING','SENT','ACCEPTED','REJECTED'))");
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS sunat_daily_summaries_identificador ON sunat_daily_summaries (tenant_id, identifier)');
        DB::statement("ALTER TABLE sunat_daily_summary_lines ADD CONSTRAINT sunat_daily_summary_lines_accion_check CHECK (action IN ('ADD','VOID'))");
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS sunat_daily_summary_lines_unica ON sunat_daily_summary_lines (summary_id, document_id)');

        // ---------------------------------------------------------------- dispatch_guides
        DB::statement(<<<'SQL'
            ALTER TABLE dispatch_guides
              ALTER COLUMN next_retry_at TYPE timestamptz USING nullif(next_retry_at::text, '')::timestamptz,
              ALTER COLUMN origin_address TYPE varchar(255),
              ALTER COLUMN issued_by TYPE varchar(120),
              ALTER COLUMN send_attempts SET DEFAULT 0,
              ALTER COLUMN status SET DEFAULT 'ISSUED',
              ALTER COLUMN sunat_status SET DEFAULT 'PENDING',
              ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false,
              ADD COLUMN IF NOT EXISTS void_reason varchar(255),
              ADD COLUMN IF NOT EXISTS voided_at timestamptz,
              ADD COLUMN IF NOT EXISTS voided_by varchar(120)
        SQL);
        DB::statement('UPDATE dispatch_guides SET send_attempts = coalesce(send_attempts, 0)');
        DB::statement('ALTER TABLE dispatch_guides ALTER COLUMN send_attempts SET NOT NULL');
        DB::statement("ALTER TABLE dispatch_guides ADD CONSTRAINT dispatch_guides_status_check CHECK (status IN ('ISSUED','VOIDED'))");
        DB::statement("ALTER TABLE dispatch_guides ADD CONSTRAINT dispatch_guides_sunat_check CHECK (sunat_status IN ('PENDING','ACCEPTED','OBSERVED','REJECTED','VOIDED'))");
        DB::statement("ALTER TABLE dispatch_guides ADD CONSTRAINT dispatch_guides_modalidad_check CHECK (transport_mode IN ('01','02'))");
        // RN-FAC-11: transporte público con transportista; privado con vehículo y conductor.
        DB::statement("ALTER TABLE dispatch_guides ADD CONSTRAINT dispatch_guides_transporte_check CHECK ((transport_mode = '01' AND carrier_supplier_id IS NOT NULL) OR (transport_mode = '02' AND vehicle_id IS NOT NULL AND driver_employee_id IS NOT NULL))");
        // RN-FAC-11: el traslado no empieza antes de la emisión.
        DB::statement('ALTER TABLE dispatch_guides ADD CONSTRAINT dispatch_guides_inicio_check CHECK (start_date >= issue_date)');
        DB::statement('ALTER TABLE dispatch_guides ADD CONSTRAINT dispatch_guides_peso_check CHECK (gross_weight_kg > 0 AND packages > 0)');
        DB::statement("ALTER TABLE dispatch_guides ADD CONSTRAINT dispatch_guides_anulada_check CHECK (status <> 'VOIDED' OR (void_reason IS NOT NULL AND length(trim(void_reason)) > 0))");
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS dispatch_guides_numero ON dispatch_guides (tenant_id, series, number)');
        DB::statement('ALTER TABLE dispatch_guide_lines ADD CONSTRAINT dispatch_guide_lines_qty_check CHECK (qty > 0)');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fac_guia_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'RN-FAC-03: una guía no se borra; se anula';
              END IF;
              IF OLD.status = 'VOIDED' AND NEW.status <> 'VOIDED' THEN
                RAISE EXCEPTION 'RN-FAC-10: una guía anulada no se reactiva';
              END IF;
              IF (OLD.send_attempts > 0 OR OLD.sunat_status <> 'PENDING') AND (
                   NEW.series IS DISTINCT FROM OLD.series OR NEW.number IS DISTINCT FROM OLD.number
                OR NEW.issue_date IS DISTINCT FROM OLD.issue_date OR NEW.transfer_reason_code IS DISTINCT FROM OLD.transfer_reason_code
                OR NEW.gross_weight_kg IS DISTINCT FROM OLD.gross_weight_kg OR NEW.packages IS DISTINCT FROM OLD.packages
                OR NEW.dest_address IS DISTINCT FROM OLD.dest_address OR NEW.origin_address IS DISTINCT FROM OLD.origin_address) THEN
                RAISE EXCEPTION 'RN-FAC-03: la guía % ya se envió a SUNAT: no cambia', OLD.full_number;
              END IF;
              RETURN NEW;
            END $$;
            DROP TRIGGER IF EXISTS fac_guia_inmutable ON dispatch_guides;
            CREATE TRIGGER fac_guia_inmutable BEFORE UPDATE OR DELETE ON dispatch_guides FOR EACH ROW EXECUTE FUNCTION fac_guia_inmutable();
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP TRIGGER IF EXISTS fac_guia_inmutable ON dispatch_guides;
            DROP FUNCTION IF EXISTS fac_guia_inmutable();
            DROP TRIGGER IF EXISTS fac_lineas_inmutables ON sales_document_lines;
            DROP FUNCTION IF EXISTS fac_lineas_inmutables();
            DROP TRIGGER IF EXISTS fac_comprobante_inmutable ON sales_documents;
            DROP FUNCTION IF EXISTS fac_comprobante_inmutable();
        SQL);
        DB::statement('DROP INDEX IF EXISTS dispatch_guides_numero');
        DB::statement('ALTER TABLE dispatch_guide_lines DROP CONSTRAINT IF EXISTS dispatch_guide_lines_qty_check');
        foreach (['status_check', 'sunat_check', 'modalidad_check', 'transporte_check', 'inicio_check', 'peso_check', 'anulada_check'] as $c) {
            DB::statement("ALTER TABLE dispatch_guides DROP CONSTRAINT IF EXISTS dispatch_guides_{$c}");
        }
        DB::statement(<<<'SQL'
            ALTER TABLE dispatch_guides
              DROP COLUMN IF EXISTS needs_review, DROP COLUMN IF EXISTS void_reason, DROP COLUMN IF EXISTS voided_at, DROP COLUMN IF EXISTS voided_by,
              ALTER COLUMN next_retry_at TYPE varchar(20) USING to_char(next_retry_at, 'YYYY-MM-DD"T"HH24:MI'),
              ALTER COLUMN send_attempts DROP NOT NULL
        SQL);

        DB::statement('DROP INDEX IF EXISTS sunat_daily_summary_lines_unica');
        DB::statement('ALTER TABLE sunat_daily_summary_lines DROP CONSTRAINT IF EXISTS sunat_daily_summary_lines_accion_check');
        DB::statement('DROP INDEX IF EXISTS sunat_daily_summaries_identificador');
        DB::statement('ALTER TABLE sunat_daily_summaries DROP CONSTRAINT IF EXISTS sunat_daily_summaries_tipo_check, DROP CONSTRAINT IF EXISTS sunat_daily_summaries_estado_check');
        DB::statement('ALTER TABLE sunat_daily_summaries ALTER COLUMN status DROP NOT NULL, ALTER COLUMN summary_type DROP NOT NULL, ALTER COLUMN reference_date DROP NOT NULL, ALTER COLUMN identifier DROP NOT NULL, DROP COLUMN IF EXISTS last_error, DROP COLUMN IF EXISTS created_by_name');

        DB::statement('ALTER TABLE einvoice_submissions DROP CONSTRAINT IF EXISTS einvoice_submissions_result_check, DROP CONSTRAINT IF EXISTS einvoice_submissions_objeto_check');
        DB::statement('ALTER TABLE einvoice_submissions DROP COLUMN IF EXISTS manual, DROP COLUMN IF EXISTS requested_by_name');

        DB::statement('ALTER TABLE sales_document_lines DROP CONSTRAINT IF EXISTS sales_document_lines_afectacion_check, DROP CONSTRAINT IF EXISTS sales_document_lines_montos_check');

        DB::statement('DROP INDEX IF EXISTS sales_documents_cola');
        DB::statement('DROP INDEX IF EXISTS sales_documents_fecha');
        foreach (['doc_type_check', 'status_check', 'sunat_status_check', 'payment_terms_check', 'customer_doc_check', 'montos_check', 'credito_check', 'nota_check', 'anulado_check'] as $c) {
            DB::statement("ALTER TABLE sales_documents DROP CONSTRAINT IF EXISTS sales_documents_{$c}");
        }
        DB::statement(<<<'SQL'
            ALTER TABLE sales_documents
              DROP COLUMN IF EXISTS summary_pending, DROP COLUMN IF EXISTS reissue_of, DROP COLUMN IF EXISTS reissued_by,
              DROP COLUMN IF EXISTS restocked_warehouse_id, DROP COLUMN IF EXISTS credit_days, DROP COLUMN IF EXISTS issued_by_name,
              DROP COLUMN IF EXISTS source
        SQL);
    }
};
