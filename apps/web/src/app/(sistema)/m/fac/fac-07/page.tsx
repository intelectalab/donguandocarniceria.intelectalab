"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Clock, FileStack, Play, RefreshCw, XCircle } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, PageHeader, StatusBadge, Tabs, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { EstadoSunat, Seccion, Vacio, useDatos } from "@/modulos/fac/comunes";
import { MOTIVOS_GUIA, TIPOS_CORTO, n, type Num } from "@/modulos/fac/tipos";

type DocCola = {
  id: string; doc_type: string; full_number: string; issue_date: string; issued_at: string | null; customer_name: string; total: Num; brand_name: string; sunat_status: string; status: string;
  send_attempts: Num; last_attempt_at: string | null; next_retry_at: string | null; needs_review: boolean | null; sunat_code: string | null; sunat_message: string | null; summary_pending: boolean; source: string | null;
};
type GuiaCola = {
  id: string; full_number: string; issue_date: string; issued_at: string | null; transfer_reason_code: string; sunat_status: string; send_attempts: Num; last_attempt_at: string | null;
  next_retry_at: string | null; needs_review: boolean | null; sunat_code: string | null; sunat_message: string | null;
};
type Ultimo = { requested_at: string; attempt_no: Num; result: string; response_code: string | null; message: string | null; duration_ms: number | null; manual: boolean | null; requested_by_name: string | null; numero: string | null };
type Cola = {
  comprobantes: DocCola[]; guias: GuiaCola[]; ultimos: Ultimo[]; proveedor: string; esperas: number[]; max_intentos: number; modo_boletas: string;
  cifras: { pendientes: number; revision: number; rechazados: number; resumen: number; mas_24h: number };
};

const RESULTADO: Record<string, [string, "ok" | "bad" | "warn" | "info"]> = {
  ACCEPTED: ["Aceptado", "ok"], OBSERVED: ["Observado", "info"], REJECTED: ["Rechazado", "bad"], ERROR: ["Error", "warn"], TIMEOUT: ["Sin respuesta", "warn"],
};

function proximo(x: { sunat_status: string; needs_review: boolean | null; next_retry_at: string | null; send_attempts: Num; summary_pending?: boolean }) {
  if (x.sunat_status === "REJECTED") return "Rechazado: corregir y reemitir";
  if (x.summary_pending) return "Va en el resumen diario";
  if (x.needs_review) return "Máximo de intentos: reenviar a mano";
  if (!n(x.send_attempts)) return "En el próximo minuto";
  return x.next_retry_at ? fechaHora(x.next_retry_at) : "—";
}

/** FAC-07 Cola de envío: comprobantes y guías pendientes, con error o en reintento; próximo intento; reenvío manual. */
export default function ColaEnvio() {
  const router = useRouter();
  const { can } = useSesion();
  const { datos: c, error, cargando, recargar } = useDatos<Cola>("/v1/fac/cola");
  const [tab, setTab] = useState<"docs" | "guias" | "log">("docs");
  const [ocupado, setOcupado] = useState("");
  const reenvia = can("fac.document.resend");

  async function correr(clave: string, fn: () => Promise<string>) {
    setOcupado(clave);
    try {
      toast.ok(await fn());
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }
  const procesar = () => correr("cola", async () => {
    const r = await api<{ procesados: number; aceptados: number; pendientes: number; rechazados: number }>("/v1/fac/cola/procesar", { method: "POST" });
    return r.procesados ? `Se procesaron ${r.procesados}: ${r.aceptados} aceptados, ${r.rechazados} rechazados, ${r.pendientes} siguen pendientes.` : "No había nada por enviar ahora.";
  });
  const reenviarDoc = (d: DocCola) => correr(d.id, async () => {
    const r = await api<{ documento: { sunat_status: string; sunat_message: string | null } }>(`/v1/fac/comprobantes/${d.id}/reenviar`, { method: "POST" });
    return r.documento.sunat_status === "PENDING" ? `${d.full_number}: sin respuesta, queda en la cola.` : `${d.full_number}: ${RESULTADO[r.documento.sunat_status]?.[0] ?? r.documento.sunat_status}.`;
  });
  const reenviarGuia = (g: GuiaCola) => correr(g.id, async () => {
    const r = await api<{ sunat_status: string }>(`/v1/fac/guias/${g.id}/reenviar`, { method: "POST" });
    return `${g.full_number}: ${r.sunat_status === "PENDING" ? "sin respuesta, queda en la cola" : RESULTADO[r.sunat_status]?.[0] ?? r.sunat_status}.`;
  });

  const colDocs: Column<DocCola>[] = [
    { key: "full_number", header: "Comprobante", cardTitle: true, render: (d) => (
      <div><div className="flex flex-wrap items-center gap-1.5"><span className="font-medium">{d.full_number}</span><Badge>{TIPOS_CORTO[d.doc_type]}</Badge></div>
        <div className="text-[12px] text-muted">{d.brand_name} · {d.customer_name}</div></div>
    ) },
    { key: "total", header: "Total", align: "right", render: (d) => soles(d.total) },
    { key: "sunat_status", header: "Estado", render: (d) => <EstadoSunat sunat={d.sunat_status} status={d.status} revision={d.needs_review} /> },
    { key: "send_attempts", header: "Intentos", align: "right", render: (d) => `${numero(d.send_attempts)} / ${c?.max_intentos ?? "—"}` },
    { key: "next_retry_at", header: "Próximo intento", render: (d) => proximo(d) },
    { key: "sunat_message", header: "Última respuesta", hideOnMobile: true, render: (d) => <span className="text-[12.5px]">{d.sunat_code ? `${d.sunat_code} · ` : ""}{d.sunat_message ?? "—"}</span> },
    { key: "acc", header: "", align: "right", hideInCard: false, render: (d) => (
      d.sunat_status === "PENDING" && !d.summary_pending && reenvia
        ? <Button size="sm" icon={RefreshCw} loading={ocupado === d.id} onClick={(e) => { e.stopPropagation(); reenviarDoc(d); }}>Reenviar</Button>
        : null
    ) },
  ];
  const colGuias: Column<GuiaCola>[] = [
    { key: "full_number", header: "Guía", cardTitle: true, render: (g) => <div><div className="font-medium">{g.full_number}</div><div className="text-[12px] text-muted">{MOTIVOS_GUIA[g.transfer_reason_code] ?? g.transfer_reason_code}</div></div> },
    { key: "sunat_status", header: "Estado", render: (g) => <EstadoSunat sunat={g.sunat_status} revision={g.needs_review} /> },
    { key: "send_attempts", header: "Intentos", align: "right", render: (g) => `${numero(g.send_attempts)} / ${c?.max_intentos ?? "—"}` },
    { key: "next_retry_at", header: "Próximo intento", render: (g) => proximo(g) },
    { key: "sunat_message", header: "Última respuesta", hideOnMobile: true, render: (g) => <span className="text-[12.5px]">{g.sunat_message ?? "—"}</span> },
    { key: "acc", header: "", align: "right", render: (g) => (
      g.sunat_status === "PENDING" && reenvia ? <Button size="sm" icon={RefreshCw} loading={ocupado === g.id} onClick={(e) => { e.stopPropagation(); reenviarGuia(g); }}>Reenviar</Button> : null
    ) },
  ];
  const colLog: Column<Ultimo>[] = [
    { key: "numero", header: "Documento", cardTitle: true, render: (u) => <span className="font-medium">{u.numero ?? "—"}</span> },
    { key: "requested_at", header: "Fecha", render: (u) => fechaHora(u.requested_at) },
    { key: "result", header: "Resultado", render: (u) => <StatusBadge status={u.result} labels={RESULTADO} /> },
    { key: "message", header: "Respuesta", render: (u) => <span className="text-[12.5px]">{u.response_code ? `${u.response_code} · ` : ""}{u.message ?? ""}</span> },
    { key: "requested_by_name", header: "Quién", hideOnMobile: true, render: (u) => (u.manual ? u.requested_by_name ?? "Manual" : "Automático") },
  ];

  const k = c?.cifras;
  return (
    <div className="space-y-5">
      <PageHeader description="Lo que falta informar a SUNAT. El sistema reintenta solo cada minuto con esperas crecientes; tras el máximo de intentos queda por revisar y se avisa a Administración."
        actions={reenvia && <Button variant="primary" icon={Play} loading={ocupado === "cola"} onClick={procesar}>Procesar la cola ahora</Button>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="En reintento" icono={Clock} destacada valor={k ? numero(k.pendientes) : undefined} detalle={c ? `Esperas: ${c.esperas.join(", ")} min` : ""} />
        <Cifra titulo="Por revisar" icono={AlertTriangle} valor={k ? numero(k.revision) : undefined} tono={k && k.revision ? "bad" : undefined} detalle={c ? `Tras ${c.max_intentos} intentos` : ""} />
        <Cifra titulo="Rechazados" icono={XCircle} valor={k ? numero(k.rechazados) : undefined} tono={k && k.rechazados ? "bad" : undefined} detalle="Sin reemitir" />
        <Cifra titulo="En resumen diario" icono={FileStack} valor={k ? numero(k.resumen) : undefined} detalle={c ? (c.modo_boletas === "SUMMARY" ? "Boletas por resumen" : "Boletas una por una") : ""} />
      </div>

      {error && <Alert tone="bad">{error}</Alert>}
      {k && k.mas_24h > 0 && <Alert tone="bad" title="Pendientes de más de 24 horas">{k.mas_24h} comprobante(s) llevan más de un día sin informarse. Revisa la conexión con el proveedor ({c?.proveedor}).</Alert>}
      {c && c.proveedor === "FAKE" && <Alert tone="info">Proveedor de prueba: las respuestas son simuladas y no llegan a SUNAT.</Alert>}

      <Tabs value={tab} onChange={setTab} tabs={[
        { key: "docs", label: "Comprobantes", count: c?.comprobantes.length }, { key: "guias", label: "Guías", count: c?.guias.length }, { key: "log", label: "Últimos envíos" },
      ]} />
      {cargando && !c ? <Vacio>Cargando la cola…</Vacio> : (
        <>
          {tab === "docs" && <DataTable rows={c?.comprobantes ?? []} columns={colDocs} onRowClick={(d) => router.push(`/m/fac/fac-04?id=${d.id}`)} empty="No hay comprobantes pendientes ni rechazados. Todo está informado." />}
          {tab === "guias" && <DataTable rows={c?.guias ?? []} columns={colGuias} onRowClick={(g) => router.push(`/m/fac/fac-09?id=${g.id}`)} empty="No hay guías pendientes." />}
          {tab === "log" && (
            <Seccion titulo="Últimos 20 envíos" acciones={<Link href="/m/fac/fac-08" className="text-[13px] font-medium text-primary hover:underline">Resúmenes y bajas</Link>}>
              <DataTable rows={c?.ultimos ?? []} columns={colLog} rowKey={(u) => u.requested_at + (u.numero ?? "") + u.attempt_no} empty="Aún no hay envíos." />
            </Seccion>
          )}
        </>
      )}
    </div>
  );
}
