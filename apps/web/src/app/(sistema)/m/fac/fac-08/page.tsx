"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, FilePlus2, Search, Send } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, FiltroSelect, PageHeader, StatusBadge, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { AlComprobante, Seccion, Vacio, useDatos } from "@/modulos/fac/comunes";
import { SUNAT, TIPOS_CORTO, type Num } from "@/modulos/fac/tipos";

type Resumen = {
  id: string; summary_type: "RC" | "RA"; reference_date: string; identifier: string; ticket: string | null; status: string; sent_at: string | null; accepted_at: string | null;
  created_at: string; last_error: string | null; created_by_name: string | null; documentos: number; total: Num;
};
type Lista = { resumenes: Resumen[]; por_informar: { issue_date: string; boletas: number; total: Num }[]; modo_boletas: string };
type Detalle = {
  resumen: Resumen;
  documentos: { id: string; doc_type: string; full_number: string; issue_date: string; customer_name: string; total: Num; sunat_status: string; status: string; action: string; reason: string | null }[];
  envios: { attempt_no: number; requested_at: string; result: string; response_code: string | null; message: string | null; requested_by_name: string | null }[];
};

const ESTADO: Record<string, [string, "warn" | "info" | "ok" | "bad"]> = { PENDING: ["Por enviar", "warn"], SENT: ["Enviado, con ticket", "info"], ACCEPTED: ["Aceptado", "ok"], REJECTED: ["Rechazado", "bad"] };
const TIPO: Record<string, string> = { RC: "Resumen de boletas (RC)", RA: "Comunicación de baja (RA)" };

/** FAC-08 Resumen diario y bajas: resúmenes de boletas y comunicaciones de baja con su ticket y estado. */
export default function Resumenes() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id") ?? "";
  return (
    <div className="space-y-4">
      <PageHeader description="Las boletas que van por resumen y las bajas de comprobantes ya informados se mandan a SUNAT en un lote del día. SUNAT responde con un ticket que se consulta después." />
      {id ? <VerResumen key={id} id={id} /> : <ListaResumenes />}
    </div>
  );
}

function useAcciones(recargar: () => void) {
  const [ocupado, setOcupado] = useState("");
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
  const enviar = (r: Resumen) => correr(r.id + "e", async () => {
    const x = await api<Resumen>(`/v1/fac/resumenes/${r.id}/enviar`, { method: "POST" });
    return x.status === "SENT" ? `${r.identifier} enviado: ticket ${x.ticket}.` : `${r.identifier}: el proveedor no respondió, inténtalo de nuevo.`;
  });
  const consultar = (r: Resumen) => correr(r.id + "c", async () => {
    const x = await api<Resumen>(`/v1/fac/resumenes/${r.id}/consultar`, { method: "POST" });
    return x.status === "ACCEPTED" ? `${r.identifier} aceptado por SUNAT.` : `${r.identifier}: ${ESTADO[x.status]?.[0] ?? x.status}.`;
  });
  return { ocupado, correr, enviar, consultar };
}

function ListaResumenes() {
  const router = useRouter();
  const { can } = useSesion();
  const [tipo, setTipo] = useState("");
  const { datos: d, error, cargando, recargar } = useDatos<Lista>(`/v1/fac/resumenes${tipo ? `?type=${tipo}` : ""}`);
  const { ocupado, correr, enviar, consultar } = useAcciones(recargar);
  const gestiona = can("fac.document.resend");

  const crear = (fechaRef: string) => correr("crear" + fechaRef, async () => {
    const r = await api<Resumen>("/v1/fac/resumenes", { method: "POST", body: { date: fechaRef } });
    return `Se armó ${r.identifier}. Envíalo a SUNAT.`;
  });

  const columnas: Column<Resumen>[] = [
    { key: "identifier", header: "Lote", cardTitle: true, render: (r) => <div><div className="font-medium">{r.identifier}</div><div className="text-[12px] text-muted">{TIPO[r.summary_type]}</div></div> },
    { key: "reference_date", header: "Del día", render: (r) => fecha(r.reference_date) },
    { key: "documentos", header: "Documentos", align: "right", render: (r) => <div>{numero(r.documentos)}<div className="text-[12px] text-muted">{soles(r.total)}</div></div> },
    { key: "status", header: "Estado", render: (r) => <div><StatusBadge status={r.status} labels={ESTADO} />{r.ticket && <div className="text-[11.5px] text-muted">Ticket {r.ticket}</div>}</div> },
    { key: "acc", header: "", align: "right", render: (r) => !gestiona ? null : r.status === "PENDING"
      ? <Button size="sm" icon={Send} loading={ocupado === r.id + "e"} disabled={!r.documentos} onClick={(e) => { e.stopPropagation(); enviar(r); }}>Enviar</Button>
      : r.status === "SENT" ? <Button size="sm" icon={Search} loading={ocupado === r.id + "c"} onClick={(e) => { e.stopPropagation(); consultar(r); }}>Consultar ticket</Button> : null },
  ];

  return (
    <div className="space-y-4">
      {error && <Alert tone="bad">{error}</Alert>}
      <Seccion titulo="Boletas por informar en resumen">
        {d?.modo_boletas !== "SUMMARY" && <p className="mb-2 text-[12.5px] text-muted">Las boletas se envían una por una (parámetro fac_receipt_summary_mode). Aquí aparecen solo si se cambia a resumen diario.</p>}
        {cargando && !d ? <Vacio>Cargando…</Vacio> : !d?.por_informar.length ? <Vacio>No hay boletas esperando resumen.</Vacio> : (
          <ul className="divide-y divide-line">
            {d.por_informar.map((p) => (
              <li key={p.issue_date} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13.5px]">
                <span><span className="font-medium">{fecha(p.issue_date)}</span> · {numero(p.boletas)} boleta(s) · {soles(p.total)}</span>
                {gestiona && <Button size="sm" variant="primary" icon={FilePlus2} loading={ocupado === "crear" + p.issue_date} onClick={() => crear(p.issue_date)}>Armar resumen</Button>}
              </li>
            ))}
          </ul>
        )}
      </Seccion>
      <DataTable rows={d?.resumenes ?? []} columns={columnas} loading={cargando && !d} onRowClick={(r) => router.push(`/m/fac/fac-08?id=${r.id}`)}
        empty="Aún no hay resúmenes ni bajas."
        toolbar={<FiltroSelect etiqueta="Tipo" value={tipo} onChange={setTipo} options={[{ value: "RC", label: "Resúmenes (RC)" }, { value: "RA", label: "Bajas (RA)" }]} ancho={170} />} />
    </div>
  );
}

function VerResumen({ id }: { id: string }) {
  const router = useRouter();
  const { can } = useSesion();
  const { datos: d, error, cargando, recargar } = useDatos<Detalle>(`/v1/fac/resumenes/${id}`);
  const { ocupado, enviar, consultar } = useAcciones(recargar);
  if (cargando) return <Vacio>Cargando…</Vacio>;
  if (error || !d) return <Alert tone="bad">{error || "No se encontró el resumen."}</Alert>;
  const r = d.resumen;
  const columnas: Column<Detalle["documentos"][number]>[] = [
    { key: "full_number", header: "Comprobante", cardTitle: true, render: (x) => <div><AlComprobante id={x.id}>{x.full_number}</AlComprobante> <Badge>{TIPOS_CORTO[x.doc_type]}</Badge></div> },
    { key: "action", header: "Acción", render: (x) => (x.action === "VOID" ? <Badge tone="bad">Baja</Badge> : <Badge tone="info">Alta</Badge>) },
    { key: "customer_name", header: "Cliente" },
    { key: "reason", header: "Motivo", hideOnMobile: true, render: (x) => x.reason ?? "—" },
    { key: "total", header: "Total", align: "right", render: (x) => soles(x.total) },
    { key: "sunat_status", header: "SUNAT", render: (x) => <StatusBadge status={x.sunat_status} labels={SUNAT} /> },
  ];
  return (
    <div className="space-y-4">
      <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push("/m/fac/fac-08")}>Resúmenes</Button>
      <Seccion titulo={r.identifier} acciones={can("fac.document.resend") && (r.status === "PENDING"
        ? <Button size="sm" variant="primary" icon={Send} loading={ocupado === r.id + "e"} disabled={!d.documentos.length} onClick={() => enviar(r)}>Enviar a SUNAT</Button>
        : r.status === "SENT" ? <Button size="sm" variant="primary" icon={Search} loading={ocupado === r.id + "c"} onClick={() => consultar(r)}>Consultar ticket</Button> : null)}>
        <DetailList items={[
          { label: "Tipo", value: TIPO[r.summary_type] },
          { label: "Del día", value: fecha(r.reference_date) },
          { label: "Estado", value: <StatusBadge status={r.status} labels={ESTADO} /> },
          { label: "Ticket", value: r.ticket ?? "—" },
          { label: "Enviado", value: fechaHora(r.sent_at) },
          { label: "Aceptado", value: fechaHora(r.accepted_at) },
          { label: "Armó", value: r.created_by_name ?? "Sistema" },
        ]} />
        {r.last_error && <div className="mt-3"><Alert tone="bad">{r.last_error}</Alert></div>}
      </Seccion>
      <Seccion titulo={`Documentos (${d.documentos.length})`}>
        <DataTable rows={d.documentos} columns={columnas} rowKey={(x) => x.id + x.action} empty="Sin documentos." />
      </Seccion>
      <Seccion titulo="Envíos">
        {d.envios.length ? (
          <ul className="divide-y divide-line text-[13.5px]">
            {d.envios.map((e) => (
              <li key={e.attempt_no} className="py-2"><span className="font-medium">#{Number(e.attempt_no)}</span> · {fechaHora(e.requested_at)} · {e.result} · {e.message}{e.requested_by_name ? ` · ${e.requested_by_name}` : ""}</li>
            ))}
          </ul>
        ) : <Vacio>Aún no se envió.</Vacio>}
      </Seccion>
    </div>
  );
}
