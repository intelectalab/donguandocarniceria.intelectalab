"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, FlaskConical, Headset, KeyRound, Plus, TrendingUp } from "lucide-react";
import { Cifra, DataTable, PageHeader, Select, StatusBadge, buttonClass, type Column } from "@/components/ui";
import { BarraUso, ESTADOS_SUSCRIPCION, type Empresa } from "@/components/consola/empresas";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { mensajeDe } from "@/lib/api";
import { usePaginaLocal } from "@/lib/paginas";
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
  const [plan, setPlan] = useState("");
  const [orden, setOrden] = useState("");

  const cargar = () => apiConsola<{ data: Empresa[] }>("/empresas").then((r) => { setFilas(r.data); setError(""); }).catch((e) => setError(mensajeDe(e)));
  useEffect(() => { cargar(); }, []);

  const visibles = useMemo(() => {
    const q = sinTildes(buscar.trim());
    let r = (filas ?? []).filter((f) => (!q || sinTildes(`${f.name} ${f.short} ${f.ruc ?? ""}`).includes(q))
      && (!estado || (estado === "NONE" ? !f.subscription_status : f.subscription_status === estado))
      && (!plan || f.plan_code === plan));
    if (orden) {
      const campo = orden.replace(/^-/, "") as keyof Empresa;
      const signo = orden.startsWith("-") ? -1 : 1;
      r = [...r].sort((a, b) => (((a[campo] ?? "") as string | number) > ((b[campo] ?? "") as string | number) ? 1 : -1) * signo);
    }
    return r;
  }, [filas, buscar, estado, plan, orden]);
  const pagina = usePaginaLocal(visibles, `${buscar}|${estado}|${plan}|${orden}`);
  const planes = useMemo(() => [...new Map((filas ?? []).filter((f) => f.plan_code).map((f) => [f.plan_code as string, f.plan_name ?? (f.plan_code as string)])).entries()], [filas]);

  const cifras = useMemo(() => {
    const f = filas ?? [];
    return {
      total: f.length,
      prueba: f.filter((x) => x.subscription_status === "TRIAL").length,
      activas: f.filter((x) => x.subscription_status === "ACTIVE" || x.subscription_status === "PAST_DUE").length,
      mrr: f.reduce((s, x) => s + x.mrr, 0),
      tickets: f.reduce((s, x) => s + x.tickets_abiertos, 0),
      accesos: f.reduce((s, x) => s + x.accesos_vigentes, 0),
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
    { key: "uso_max", header: "Uso máx.", align: "right", hideOnMobile: true, render: (e) => { const m = Math.max(...e.uso.map((u) => u.pct ?? 0));
      return e.uso.some((u) => u.pct !== null) ? <span className={m >= 90 ? "font-semibold text-bad" : m >= 75 ? "text-warn" : ""}>{Math.round(m)} %</span> : <span className="text-muted">—</span>; } },
    { key: "tickets_abiertos", header: "Tickets", align: "right", sortable: true, hideOnMobile: true, render: (e) => e.tickets_abiertos || <span className="text-muted">0</span> },
    { key: "created_at", header: "Alta", sortable: true, hideOnMobile: true, render: (e) => fecha(e.created_at) },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader
        description="Los clientes de la plataforma con su plan, el estado de su suscripción, cuánto aportan al mes (MRR) y cuánto usan de sus límites. La consola ve solo estos totales, nunca sus pedidos ni sus clientes."
        actions={yo.puede["tenant.create"] ? <Link href="/consola/empresas/nueva" className={buttonClass("primary", "md")}><Plus size={16} />Nueva empresa</Link> : undefined} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Cifra titulo="Clientes activos" valor={filas ? String(cifras.activas) : undefined} detalle={`de ${cifras.total} en la plataforma`} icono={Building2} />
        <Link href="/consola/metricas" title="Ver métricas del negocio" className="rounded-xl">
          <Cifra titulo="MRR (sin IGV)" valor={filas ? soles(cifras.mrr) : undefined} detalle={`Promedio ${soles(cifras.activas ? cifras.mrr / cifras.activas : 0)}`} icono={TrendingUp} destacada />
        </Link>
        <Cifra titulo="En prueba" valor={filas ? String(cifras.prueba) : undefined} icono={FlaskConical} />
        <Link href="/consola/tickets" title="Ver la bandeja de tickets" className="rounded-xl">
          <Cifra titulo="Tickets abiertos" valor={filas ? String(cifras.tickets) : undefined} tono={cifras.tickets ? "warn" : undefined} icono={Headset} />
        </Link>
        <Link href="/consola/accesos" title="Ver accesos de soporte" className="col-span-2 rounded-xl lg:col-span-1">
          <Cifra titulo="Accesos de soporte vigentes" valor={filas ? String(cifras.accesos) : undefined} icono={KeyRound} />
        </Link>
      </div>

      <DataTable columns={columnas} rows={pagina.filas} pagination={pagina.props} loading={!filas && !error} error={error} onRetry={cargar}
        empty={buscar || estado ? "Ninguna empresa coincide con la búsqueda." : "Aún no hay empresas."}
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar por nombre o RUC" }}
        sort={orden} onSortChange={setOrden}
        onRowClick={(e) => router.push(`/consola/empresas/ficha?id=${e.id}`)}
        toolbar={<>
          <Select value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Plan"
            options={[{ value: "", label: "Todos los planes" }, ...planes.map(([v, l]) => ({ value: v, label: l }))]} />
          <Select value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado de la suscripción"
            options={[{ value: "", label: "Todos los estados" }, ...Object.entries(ESTADOS_SUSCRIPCION).map(([v, [l]]) => ({ value: v, label: l })), { value: "NONE", label: "Sin suscripción" }]} />
        </>} />
    </div>
  );
}
