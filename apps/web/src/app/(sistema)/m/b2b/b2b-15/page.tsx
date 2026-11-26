"use client";

import { Alert, Badge, DataTable, PageHeader, type Column } from "@/components/ui";
import { fecha, soles } from "@/lib/formato";
import { DiasMora, Panel, Sub, useDatos } from "@/modulos/canales/comunes";
import { Descargas } from "@/modulos/b2b/Comprobante";
import { CifrasCredito, Movimientos } from "@/modulos/b2b/EstadoCuenta";
import type { Movimiento, Resumen } from "@/modulos/b2b/tipos";

type Doc = { id: string; doc_type: string; full_number: string; issue_date: string; due_date: string | null; total: string; balance: string | null; sunat_status: string; order_number: string | null };
const TIPO_DOC: Record<string, string> = { INVOICE: "Factura", RECEIPT: "Boleta", CREDIT_NOTE: "Nota de crédito", DEBIT_NOTE: "Nota de débito" };

/** B2B-15 Portal · Estado de cuenta y comprobantes: saldo, vencidos, movimientos y descarga de PDF, XML y constancia. */
export default function MiCuenta() {
  const r = useDatos<{ movements: Movimiento[]; summary: Resumen; documents: Doc[] }>("/v1/b2b/portal/cuenta");
  const d = r.datos;
  const columnas: Column<Doc>[] = [
    { key: "full_number", header: "Comprobante", cardTitle: true, render: (x) => <div><p className="font-mono font-semibold">{x.full_number}</p><Sub>{TIPO_DOC[x.doc_type] ?? x.doc_type}{x.order_number ? ` · pedido ${x.order_number}` : ""}</Sub></div> },
    { key: "issue_date", header: "Emitido", render: (x) => fecha(x.issue_date) },
    { key: "due_date", header: "Vence", render: (x) => fecha(x.due_date) },
    { key: "total", header: "Total", align: "right", render: (x) => soles(x.total) },
    { key: "balance", header: "Por pagar", align: "right", render: (x) => Number(x.balance ?? 0) > 0 ? soles(x.balance) : <Badge tone="ok">Pagado</Badge> },
    { key: "mora", header: "Atraso", render: (x) => Number(x.balance ?? 0) > 0 && x.due_date ? <DiasMora d={d?.movements.find((m) => m.kind === "DOC" && m.ref === x.full_number)?.days_overdue} /> : null },
    { key: "desc", header: "Descargar", render: (x) => <Descargas id={x.id} numero={x.full_number} aceptado={x.sunat_status === "ACCEPTED"} /> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Tu saldo con nosotros, lo que vence y cada comprobante con su PDF, XML y la constancia de SUNAT." />
      {r.error && <Alert tone="bad">{r.error}</Alert>}
      <CifrasCredito s={d?.summary} />
      <Panel titulo="Comprobantes"><DataTable columns={columnas} rows={d?.documents ?? []} loading={r.cargando} empty="Sin comprobantes." /></Panel>
      <Panel titulo="Movimientos"><Movimientos filas={d?.movements ?? []} cargando={r.cargando} /></Panel>
    </div>
  );
}
