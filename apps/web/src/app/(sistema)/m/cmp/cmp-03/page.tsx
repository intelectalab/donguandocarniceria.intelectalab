"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Megaphone, Plus, TrendingUp } from "lucide-react";
import { Button, DataTable, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { fecha, fechaHora, numero, soles } from "@/lib/formato";
import { Cifras, CifraLink, FiltroSelect, Sub, opcionesDe, qs, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { ESTADO_CAMPANA, roiTexto, type Campana, type Opciones } from "@/modulos/cmp/tipos";

/** CMP-03 Campañas: estado, audiencia efectiva, costo estimado o real y retorno de las enviadas. */
export default function Campanas() {
  const router = useRouter();
  const op = useOpcionesDe<Opciones>("/v1/cmp/opciones");
  const [marca, setMarca] = useState("");
  const [estado, setEstado] = useState("");
  const r = useDatos<{ data: Campana[] }>(`/v1/cmp/campanas${qs({ brand_id: marca, status: estado })}`);
  const filas = r.datos?.data ?? [];
  const enviadas = filas.filter((c) => c.status === "SENT");
  const cobrado = enviadas.reduce((a, c) => a + (c.collected ?? 0), 0);
  const costo = enviadas.reduce((a, c) => a + (c.total_cost ?? 0), 0);
  const ir = (c: Campana) => router.push(c.status === "SENT" ? `/m/cmp/cmp-06?id=${c.id}` : ["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(c.status) ? `/m/cmp/cmp-05?id=${c.id}` : `/m/cmp/cmp-04?id=${c.id}`);

  const columnas: Column<Campana>[] = [
    { key: "code", header: "Campaña", cardTitle: true, render: (c) => <div className="min-w-[200px]"><p className="font-semibold">{c.name}</p><Sub>{c.code} · {c.brand_name} · {op?.objectives[c.objective] ?? c.objective}</Sub></div> },
    { key: "segment_code", header: "Segmento", hideOnMobile: true, render: (c) => <div>{c.segment_name}<Sub>{c.segment_code}{c.coupon_code ? ` · cupón ${c.coupon_code}` : ""}</Sub></div> },
    { key: "scheduled_at", header: "Envío", render: (c) => c.sent_at ? <div>{fechaHora(c.sent_at)}<Sub>enviada</Sub></div> : c.scheduled_at ? <div>{fechaHora(c.scheduled_at)}<Sub>programada</Sub></div> : "—" },
    { key: "effective_count", header: "Destinatarios", align: "right", render: (c) => c.effective_count != null ? <div>{numero(c.effective_count)}<Sub>de {numero(c.target_count)} · control {numero(c.control_count)}</Sub></div> : "Sin estimar" },
    { key: "estimated_cost", header: "Costo", align: "right", render: (c) => <div>{soles(c.actual_cost ?? c.estimated_cost)}<Sub>{c.actual_cost != null ? "real" : "estimado"}</Sub></div> },
    { key: "roi", header: "Retorno", align: "right", render: (c) => c.status === "SENT" ? <div className={(c.roi ?? 0) >= 0 ? "text-ok" : "text-bad"}>{roiTexto(c.roi)}<Sub>{numero(c.orders)} pedidos · {soles(c.collected)}</Sub></div> : "—" },
    { key: "status", header: "Estado", render: (c) => <StatusBadge status={c.status} labels={ESTADO_CAMPANA} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description={`Campañas de WhatsApp a un segmento. Cada envío respeta el consentimiento y el tope de ${op?.params.max_per_week ?? 2} mensajes de marketing por cliente a la semana.`}
        actions={<>
          <Button icon={CalendarDays} onClick={() => router.push("/m/cmp/cmp-13")}>Calendario</Button>
          {op?.can["cmp.campaign.manage"] && <Button variant="primary" icon={Plus} onClick={() => router.push("/m/cmp/cmp-04")}>Nueva campaña</Button>}
        </>} />
      <Cifras>
        <CifraLink destacada titulo="Cobrado por campañas" valor={r.datos ? soles(cobrado) : undefined} detalle={`${enviadas.length} enviadas`} icono={TrendingUp} />
        <CifraLink titulo="Costo de mensajes" valor={r.datos ? soles(costo) : undefined} detalle={costo ? `Retorno ${roiTexto((cobrado - costo) / costo)}` : undefined} />
        <CifraLink titulo="Por aprobar" valor={r.datos ? numero(filas.filter((c) => c.status === "PENDING_APPROVAL").length) : undefined} tono={filas.some((c) => c.status === "PENDING_APPROVAL") ? "warn" : undefined} onClick={() => setEstado("PENDING_APPROVAL")} />
        <CifraLink titulo="Próximas" valor={r.datos ? numero(filas.filter((c) => c.status === "APPROVED").length) : undefined} detalle={filas.find((c) => c.status === "APPROVED")?.scheduled_at ? `La siguiente ${fecha(filas.find((c) => c.status === "APPROVED")!.scheduled_at)}` : undefined} icono={Megaphone} />
      </Cifras>
      <DataTable columns={columnas} rows={filas} loading={r.cargando} error={r.error} onRetry={r.recargar} empty="No hay campañas." onRowClick={ir}
        toolbar={<>
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opcionesDe(ESTADO_CAMPANA)} />
          <FiltroSelect label="Marca" value={marca} onChange={setMarca} options={(op?.brands ?? []).map((b) => ({ value: b.id, label: b.name }))} />
        </>} />
    </div>
  );
}
