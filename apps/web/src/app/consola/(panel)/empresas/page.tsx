"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { DataTable, PageHeader, Select, StatusBadge, buttonClass, type Column } from "@/components/ui";
import { BarraUso, ESTADOS_SUSCRIPCION, type Empresa } from "@/components/consola/empresas";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { mensajeDe } from "@/lib/api";
import { apiConsola } from "@/lib/consola";
import { fecha, soles } from "@/lib/formato";

const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** OPS-02 Empresas: cada cliente con su plan, estado de la suscripción, días en el estado, MRR y uso de los límites. */
export default function Empresas() {
  const router = useRouter();
  const yo = useUsuarioConsola();
  const [filas, setFilas] = useState<Empresa[] | null>(null);
  const [error, setError] = useState("");
  const [buscar, setBuscar] = useState("");
  const [estado, setEstado] = useState("");
  const [orden, setOrden] = useState("");

  const cargar = () => apiConsola<{ data: Empresa[] }>("/empresas").then((r) => { setFilas(r.data); setError(""); }).catch((e) => setError(mensajeDe(e)));
  useEffect(() => { cargar(); }, []);

  const visibles = useMemo(() => {
    const q = sinTildes(buscar.trim());
    let r = (filas ?? []).filter((f) => (!q || sinTildes(`${f.name} ${f.short} ${f.ruc ?? ""}`).includes(q))
      && (!estado || (estado === "NONE" ? !f.subscription_status : f.subscription_status === estado)));
    if (orden) {
      const campo = orden.replace(/^-/, "") as keyof Empresa;
      const signo = orden.startsWith("-") ? -1 : 1;
      r = [...r].sort((a, b) => (((a[campo] ?? "") as string | number) > ((b[campo] ?? "") as string | number) ? 1 : -1) * signo);
    }
    return r;
  }, [filas, buscar, estado, orden]);

  const cifras = useMemo(() => {
    const f = filas ?? [];
    return {
      total: f.length,
      prueba: f.filter((x) => x.subscription_status === "TRIAL").length,
      activas: f.filter((x) => x.subscription_status === "ACTIVE" || x.subscription_status === "PAST_DUE").length,
      mrr: f.reduce((s, x) => s + x.mrr, 0),
    };
  }, [filas]);

  const columnas: Column<Empresa>[] = [
    { key: "name", header: "Empresa", sortable: true, cardTitle: true, render: (e) => (
      <div className="min-w-0">
        <p className="font-semibold text-ink">{e.short}</p>
        <p className="text-[12.5px] text-muted">{e.name}{e.ruc ? ` · RUC ${e.ruc}` : ""}</p>
      </div>
    ) },
    { key: "plan_name", header: "Plan", sortable: true, render: (e) => e.plan_name ?? <span className="text-muted">Piloto</span> },
    { key: "status", header: "Estado", render: (e) => (
      <div className="grid gap-0.5">
        {e.subscription_status ? <StatusBadge status={e.subscription_status} labels={ESTADOS_SUSCRIPCION} /> : <StatusBadge status="NONE" labels={{ NONE: ["Sin suscripción", "neutral"] }} />}
        {e.days_in_status !== null && <span className="text-[12px] text-muted">{e.days_in_status === 0 ? "desde hoy" : `hace ${e.days_in_status} días`}</span>}
      </div>
    ) },
    { key: "mrr", header: "MRR", align: "right", sortable: true, render: (e) => e.mrr ? soles(e.mrr) : <span className="text-muted">—</span> },
    { key: "users", header: "Usuarios", hideOnMobile: true, render: (e) => <BarraUso uso={e.uso[0]} /> },
    { key: "brands", header: "Marcas", hideOnMobile: true, render: (e) => <BarraUso uso={e.uso[1]} /> },
    { key: "sites", header: "Locales", hideOnMobile: true, render: (e) => <BarraUso uso={e.uso[2]} /> },
    { key: "created_at", header: "Alta", sortable: true, hideOnMobile: true, render: (e) => fecha(e.created_at) },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader
        description="Los clientes de la plataforma con su plan, el estado de su suscripción, cuánto aportan al mes (MRR) y cuánto usan de sus límites. La consola ve solo estos totales, nunca sus pedidos ni sus clientes."
        actions={yo.puede["tenant.create"] ? <Link href="/consola/empresas/nueva" className={buttonClass("primary", "md")}><Plus size={16} />Nueva empresa</Link> : undefined} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Empresas", cifras.total], ["En prueba", cifras.prueba], ["Activas o con deuda", cifras.activas], ["MRR (sin IGV)", soles(cifras.mrr)]].map(([t, v]) => (
          <div key={t} className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <p className="text-[12.5px] text-muted">{t}</p>
            <p className="mt-1 font-display text-[22px] font-bold text-ink tabular-nums">{filas ? v : "…"}</p>
          </div>
        ))}
      </div>

      <DataTable columns={columnas} rows={visibles} loading={!filas && !error} error={error} onRetry={cargar}
        empty={buscar || estado ? "Ninguna empresa coincide con la búsqueda." : "Aún no hay empresas."}
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar por nombre o RUC" }}
        sort={orden} onSortChange={setOrden}
        onRowClick={(e) => router.push(`/consola/empresas/ficha?id=${e.id}`)}
        toolbar={
          <Select value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado de la suscripción"
            options={[{ value: "", label: "Todos los estados" }, ...Object.entries(ESTADOS_SUSCRIPCION).map(([v, [l]]) => ({ value: v, label: l })), { value: "NONE", label: "Sin suscripción" }]} />
        } />
    </div>
  );
}
