"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Users } from "lucide-react";
import { Badge, Button, DataTable, PageHeader, StatusBadge, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero, porcentaje } from "@/lib/formato";
import { Cifras, CifraLink, FiltroSelect, Sub, qs, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { ESTADO_SEGMENTO, type Opciones, type Segmento } from "@/modulos/cmp/tipos";

/** CMP-01 Segmentos: audiencias por marca con su regla, tamaño, cuántos aceptan promociones y última actualización. */
export default function Segmentos() {
  const router = useRouter();
  const op = useOpcionesDe<Opciones>("/v1/cmp/opciones");
  const [marca, setMarca] = useState("");
  const [tipo, setTipo] = useState("");
  const r = useDatos<{ data: Segmento[] }>(`/v1/cmp/segmentos${qs({ brand_id: marca, segment_type: tipo })}`);
  const [refrescando, setRefrescando] = useState<string | null>(null);
  const gestiona = Boolean(op?.can["cmp.segment.manage"]);
  const filas = r.datos?.data ?? [];

  async function refrescar(s: Segmento) {
    setRefrescando(s.id);
    try { const x = await api<{ size: number }>(`/v1/cmp/segmentos/${s.id}/actualizar`, { method: "POST" }); toast.ok(`${s.code}: ${numero(x.size)} clientes`); r.recargar(); }
    catch (e) { toast.error(mensajeDe(e)); } finally { setRefrescando(null); }
  }

  const columnas: Column<Segmento>[] = [
    { key: "code", header: "Segmento", cardTitle: true, render: (s) => <div className="min-w-[200px]"><p className="font-semibold">{s.name}</p><Sub>{s.code} · {s.brand_name ?? "Todas las marcas"}</Sub></div> },
    { key: "description", header: "Regla", render: (s) => <span className="line-clamp-2 max-w-[320px] text-[12.5px]">{s.description}</span> },
    { key: "segment_type", header: "Tipo", hideOnMobile: true, render: (s) => <Badge tone={s.segment_type === "DYNAMIC" ? "info" : "neutral"}>{s.segment_type === "DYNAMIC" ? "Dinámico" : "Lista fija"}</Badge> },
    { key: "member_count", header: "Clientes", align: "right", render: (s) => numero(s.member_count) },
    { key: "consent_count", header: "Aceptan promociones", align: "right", render: (s) => <div>{numero(s.consent_count)}<Sub>{s.member_count ? porcentaje((s.consent_count / s.member_count) * 100, 0) : "—"}</Sub></div> },
    { key: "campaigns", header: "Campañas", align: "right", hideOnMobile: true, render: (s) => numero(s.campaigns ?? 0) },
    { key: "last_refreshed_at", header: "Actualizado", hideOnMobile: true, render: (s) => <div>{fechaHora(s.last_refreshed_at)}<Sub>{s.segment_type === "DYNAMIC" ? `cada ${s.refresh_hours} h` : ""}</Sub></div> },
    { key: "status", header: "Estado", render: (s) => <StatusBadge status={s.status} labels={ESTADO_SEGMENTO} /> },
    { key: "acc", header: "", render: (s) => gestiona && s.segment_type === "DYNAMIC" ? <Button size="sm" variant="ghost" icon={RefreshCw} loading={refrescando === s.id} onClick={(e) => { e.stopPropagation(); refrescar(s); }}>Actualizar</Button> : null },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Un segmento es una regla sobre el historial de compras. Solo reciben campañas quienes aceptaron promociones de esa marca."
        actions={gestiona && <Button variant="primary" icon={Plus} onClick={() => router.push("/m/cmp/cmp-02")}>Nuevo segmento</Button>} />
      <Cifras cols={3}>
        <CifraLink destacada titulo="Segmentos activos" valor={r.datos ? numero(filas.filter((s) => s.status === "ACTIVE").length) : undefined} icono={Users} />
        <CifraLink titulo="Clientes alcanzables" valor={r.datos ? numero(Math.max(0, ...filas.map((s) => s.consent_count))) : undefined} detalle="En el segmento más grande, con consentimiento" />
        <CifraLink titulo="Usados en campañas" valor={r.datos ? numero(filas.filter((s) => (s.campaigns ?? 0) > 0).length) : undefined} href="/m/cmp/cmp-03" />
      </Cifras>
      <DataTable columns={columnas} rows={filas} loading={r.cargando} error={r.error} onRetry={r.recargar} empty="No hay segmentos." onRowClick={(s) => router.push(`/m/cmp/cmp-02?id=${s.id}`)}
        toolbar={<>
          <FiltroSelect label="Marca" value={marca} onChange={setMarca} options={(op?.brands ?? []).map((b) => ({ value: b.id, label: b.name }))} />
          <FiltroSelect label="Tipo" value={tipo} onChange={setTipo} options={[{ value: "DYNAMIC", label: "Dinámico" }, { value: "STATIC", label: "Lista fija" }]} />
        </>} />
    </div>
  );
}
