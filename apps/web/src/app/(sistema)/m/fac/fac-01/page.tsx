"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, FileText, Plus, Receipt, Send } from "lucide-react";
import { Badge, Button, Cifra, DataTable, FiltroFecha, FiltroSelect, PageHeader, buttonClass, toast, type Column } from "@/components/ui";
import { apiDescargar, mensajeDe } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { EstadoSunat, useDatos } from "@/modulos/fac/comunes";
import { ORIGEN, SUNAT, TIPOS, TIPOS_CORTO, TONO_TIPO, type FilaComprobante } from "@/modulos/fac/tipos";

type Totales = { comprobantes: number; ventas: number; notas: number; neto: number; igv: number; pendientes: number; revision: number; rechazados: number; aceptados: number };

/** FAC-01 Comprobantes: lista por tipo, serie, marca, local, cliente, fecha y estado SUNAT; totales; exportación. */
export default function Comprobantes() {
  const router = useRouter();
  const { marca, local, puede } = useSesion();
  const [f, setF] = useState({ doc_type: "", sunat_status: "", status: "", source: "", from: "", to: "" });
  const filtros = { ...f, brand: marca !== "ALL" ? marca : "", site: local !== "ALL" ? local : "" };
  const lista = useListado<FilaComprobante>("/v1/fac/comprobantes", { orden: "-issue_date", filtros });
  const p = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v));
  const { datos: t } = useDatos<Totales>(`/v1/fac/comprobantes/resumen?${p}`);
  const [bajando, setBajando] = useState(false);

  async function exportar() {
    setBajando(true);
    try {
      await apiDescargar(`/v1/fac/comprobantes/exportar?${p}`, "comprobantes.xlsx");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setBajando(false);
    }
  }

  const columnas: Column<FilaComprobante>[] = [
    { key: "full_number", header: "Comprobante", sortable: true, cardTitle: true, render: (d) => (
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5"><span className="font-medium">{d.full_number}</span><Badge tone={TONO_TIPO[d.doc_type]}>{TIPOS_CORTO[d.doc_type]}</Badge></div>
        <div className="text-[12px] text-muted">{d.brand_name}{d.site ? ` · ${d.site}` : ""} · {ORIGEN[d.source ?? ""] ?? "—"}{d.pos_ticket ? ` · ${d.pos_ticket}` : ""}</div>
      </div>
    ) },
    { key: "issue_date", header: "Fecha", sortable: true, render: (d) => fecha(d.issue_date) },
    { key: "customer_name", header: "Cliente", sortable: true, render: (d) => (
      <div className="min-w-0"><div className="truncate">{d.customer_name}</div><div className="text-[12px] text-muted">{d.customer_doc_type === "NONE" ? "Sin documento" : `${d.customer_doc_type} ${d.customer_doc_number ?? ""}`}</div></div>
    ) },
    { key: "payment_terms", header: "Pago", hideOnMobile: true, render: (d) => (d.payment_terms === "CREDIT" ? `Crédito · vence ${fecha(d.due_date)}` : "Contado") },
    { key: "total", header: "Total", sortable: true, align: "right", render: (d) => <span className={`tabular-nums ${d.doc_type === "CREDIT_NOTE" ? "text-bad" : ""}`}>{d.doc_type === "CREDIT_NOTE" ? "−" : ""}{soles(d.total)}</span> },
    { key: "sunat_status", header: "SUNAT", sortable: true, render: (d) => (
      <div><EstadoSunat sunat={d.sunat_status} status={d.status} revision={d.needs_review} />
        {d.sunat_status === "REJECTED" && d.reissued_by && <div className="text-[11.5px] text-muted">Reemitido</div>}
        {d.summary_pending && d.sunat_status === "PENDING" && <div className="text-[11.5px] text-muted">Va en el resumen diario</div>}</div>
    ) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Facturas, boletas y notas emitidas con el RUC de la empresa, de todas las marcas y canales. El detalle muestra el XML, la constancia de SUNAT y los envíos."
        actions={<>
          <Button icon={Download} loading={bajando} onClick={exportar}>Excel</Button>
          {puede("FAC", "C") && <Link href="/m/fac/fac-03" className={buttonClass("primary")}><Plus size={16} aria-hidden="true" />Emisión directa</Link>}
        </>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Ventas" icono={Receipt} destacada valor={t ? soles(t.ventas) : undefined} detalle={t ? `Neto ${soles(t.neto)} · IGV ${soles(t.igv)}` : ""} />
        <Cifra titulo="Notas de crédito" icono={FileText} valor={t ? soles(t.notas) : undefined} detalle={t ? `${numero(t.comprobantes)} comprobantes en la lista` : ""} />
        <Cifra titulo="Por enviar" icono={Send} valor={t ? numero(t.pendientes) : undefined} tono={t && t.revision ? "bad" : t && t.pendientes ? "warn" : undefined}
          detalle={t ? (t.revision ? `${t.revision} por revisar` : "En la cola de envío") : ""} />
        <Cifra titulo="Rechazados" icono={t && t.rechazados ? AlertTriangle : CheckCircle2} valor={t ? numero(t.rechazados) : undefined} tono={t && t.rechazados ? "bad" : "ok"}
          detalle={t ? `${numero(t.aceptados)} aceptados` : ""} />
      </div>

      <DataTable {...lista.tabla} columns={columnas} onRowClick={(d) => router.push(`/m/fac/fac-04?id=${d.id}`)}
        search={{ ...lista.tabla.search, placeholder: "Número, cliente, documento o ticket…" }}
        empty="No hay comprobantes con estos filtros."
        toolbar={<>
          <FiltroSelect etiqueta="Tipo" value={f.doc_type} onChange={(v) => setF({ ...f, doc_type: v })} options={Object.entries(TIPOS).map(([value, label]) => ({ value, label }))} ancho={150} />
          <FiltroSelect etiqueta="SUNAT" value={f.sunat_status} onChange={(v) => setF({ ...f, sunat_status: v })}
            options={["PENDING", "ACCEPTED", "OBSERVED", "REJECTED", "VOIDED"].map((k) => ({ value: k, label: SUNAT[k][0] }))} ancho={150} />
          <FiltroSelect etiqueta="Estado" value={f.status} onChange={(v) => setF({ ...f, status: v })} options={[{ value: "ISSUED", label: "Emitidos" }, { value: "VOIDED", label: "Anulados" }]} ancho={140} />
          <FiltroSelect etiqueta="Origen" value={f.source} onChange={(v) => setF({ ...f, source: v })} options={Object.entries(ORIGEN).map(([value, label]) => ({ value, label }))} ancho={140} />
          <FiltroFecha etiqueta="Desde" value={f.from} onChange={(v) => setF({ ...f, from: v })} ancho={150} />
          <FiltroFecha etiqueta="Hasta" value={f.to} onChange={(v) => setF({ ...f, to: v })} ancho={150} />
        </>} />
    </div>
  );
}
