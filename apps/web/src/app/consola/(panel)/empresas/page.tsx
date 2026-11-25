"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, FlaskConical, HeartPulse, Headset, KeyRound, Plus, RefreshCw, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react";
import { Button, buttonClass, Cifra, DataTable, FiltroSelect, PageHeader, StatusBadge, toast, type Column } from "@/components/ui";
import { BarraUso, ESTADOS_SUSCRIPCION, SaludBadge, type Empresa } from "@/components/consola/empresas";
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
  const [nivel, setNivel] = useState("");
  const [cortes, setCortes] = useState<[number, number]>([70, 40]);
  const [recalculando, setRecalculando] = useState(false);
  // Como el prototipo: ordenadas por riesgo (la salud más baja primero).
  const [orden, setOrden] = useState("salud_score");

  const cargar = () => apiConsola<{ data: Empresa[]; salud_cortes: [number, number] }>("/empresas").then((r) => { setFilas(r.data); setCortes(r.salud_cortes); setError(""); }).catch((e) => setError(mensajeDe(e)));

  async function recalcular() {
    setRecalculando(true);
    try {
      const r = await apiConsola<{ empresas: number }>("/empresas/salud", { method: "POST" });
      toast.ok(`Salud recalculada y guardada para ${r.empresas} ${r.empresas === 1 ? "empresa" : "empresas"}`);
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setRecalculando(false);
    }
  }
  useEffect(() => { cargar(); }, []);

  const visibles = useMemo(() => {
    const q = sinTildes(buscar.trim());
    let r = (filas ?? []).filter((f) => (!q || sinTildes(`${f.name} ${f.short} ${f.ruc ?? ""}`).includes(q))
      && (!estado || (estado === "NONE" ? !f.subscription_status : f.subscription_status === estado))
      && (!plan || f.plan_code === plan)
      && (!nivel || f.salud?.level === nivel));
    if (orden) {
      const campo = orden.replace(/^-/, "");
      const signo = orden.startsWith("-") ? -1 : 1;
      const valor = (e: Empresa) => (campo === "salud_score" ? e.salud?.score ?? 101 : (e[campo as keyof Empresa] ?? "")) as string | number;
      r = [...r].sort((a, b) => (valor(a) > valor(b) ? 1 : -1) * signo);
    }
    return r;
  }, [filas, buscar, estado, plan, nivel, orden]);
  const pagina = usePaginaLocal(visibles, `${buscar}|${estado}|${plan}|${nivel}|${orden}`);
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
      sanas: f.filter((x) => x.salud?.level === "HEALTHY").length,
      riesgo: f.filter((x) => x.salud?.level === "AT_RISK").length,
      criticas: f.filter((x) => x.salud?.level === "CRITICAL").length,
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
    { key: "uso", header: "Uso de límites", hideOnMobile: true, render: (e) => (
      <div className="grid min-w-[170px] gap-1.5">
        {e.uso.map((u) => <div key={u.clave} className="grid grid-cols-[56px_1fr] items-center gap-2 text-[12px]"><span className="text-muted">{u.nombre}</span><BarraUso uso={u} /></div>)}
      </div>
    ) },
    { key: "uso_max", header: "Uso máx.", align: "right", hideOnMobile: true, render: (e) => { const m = Math.max(...e.uso.map((u) => u.pct ?? 0));
      return e.uso.some((u) => u.pct !== null) ? <span className={m >= 90 ? "font-semibold text-bad" : m >= 75 ? "text-warn" : ""}>{Math.round(m)} %</span> : <span className="text-muted">—</span>; } },
    { key: "salud_score", header: "Salud", sortable: true, render: (e) => <SaludBadge s={e.salud} /> },
    { key: "tickets_abiertos", header: "Tickets", align: "right", sortable: true, hideOnMobile: true, render: (e) => e.tickets_abiertos || <span className="text-muted">0</span> },
    { key: "created_at", header: "Alta", sortable: true, hideOnMobile: true, render: (e) => fecha(e.created_at) },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader
        description="Los clientes de la plataforma con su plan, el estado de su suscripción, cuánto aportan al mes (MRR) y cuánto usan de sus límites. La consola ve solo estos totales, nunca sus pedidos ni sus clientes."
        actions={<div className="flex flex-wrap gap-2">
          {yo.puede["health.recompute"] && <Button icon={RefreshCw} loading={recalculando} onClick={recalcular}>Recalcular salud</Button>}
          {yo.puede["tenant.create"] && <Link href="/consola/empresas/nueva" className={buttonClass("primary", "md")}><Plus size={16} />Nueva empresa</Link>}
        </div>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Clientes activos" valor={filas ? String(cifras.activas) : undefined} detalle={`de ${cifras.total} en la plataforma`} icono={Building2} />
        <Link href="/consola/metricas" title="Ver métricas del negocio" className="rounded-xl">
          <Cifra titulo="MRR (sin IGV)" valor={filas ? soles(cifras.mrr) : undefined} detalle={`Promedio ${soles(cifras.activas ? cifras.mrr / cifras.activas : 0)}`} icono={TrendingUp} destacada />
        </Link>
        <Cifra titulo="En prueba" valor={filas ? String(cifras.prueba) : undefined} icono={FlaskConical} />
        <Link href="/consola/tickets" title="Ver la bandeja de tickets" className="rounded-xl">
          <Cifra titulo="Tickets abiertos" valor={filas ? String(cifras.tickets) : undefined} tono={cifras.tickets ? "warn" : undefined} icono={Headset} />
        </Link>
        <button type="button" onClick={() => setNivel(nivel === "HEALTHY" ? "" : "HEALTHY")} title="Ver solo las saludables" className={`grid cursor-pointer rounded-xl text-left [&>div]:h-full ${nivel === "HEALTHY" ? "ring-2 ring-primary" : ""}`}>
          <Cifra titulo="Saludables" valor={filas ? String(cifras.sanas) : undefined} tono="ok" icono={HeartPulse} detalle={`Salud desde ${cortes[0]}`} />
        </button>
        <button type="button" onClick={() => setNivel(nivel === "AT_RISK" ? "" : "AT_RISK")} title="Ver solo las que están en riesgo" className={`grid cursor-pointer rounded-xl text-left [&>div]:h-full ${nivel === "AT_RISK" ? "ring-2 ring-primary" : ""}`}>
          <Cifra titulo="En riesgo" valor={filas ? String(cifras.riesgo) : undefined} tono={cifras.riesgo ? "warn" : undefined} icono={TrendingDown} detalle={`Salud bajo ${cortes[0]}`} />
        </button>
        <button type="button" onClick={() => setNivel(nivel === "CRITICAL" ? "" : "CRITICAL")} title="Ver solo las críticas" className={`grid cursor-pointer rounded-xl text-left [&>div]:h-full ${nivel === "CRITICAL" ? "ring-2 ring-primary" : ""}`}>
          <Cifra titulo="Críticas" valor={filas ? String(cifras.criticas) : undefined} tono={cifras.criticas ? "bad" : undefined} icono={ShieldAlert} detalle={`Salud bajo ${cortes[1]}`} />
        </button>
        <Link href="/consola/accesos" title="Ver accesos de soporte" className="grid rounded-xl [&>div]:h-full">
          <Cifra titulo="Accesos de soporte vigentes" valor={filas ? String(cifras.accesos) : undefined} icono={KeyRound} />
        </Link>
      </div>

      <DataTable columns={columnas} rows={pagina.filas} pagination={pagina.props} loading={!filas && !error} error={error} onRetry={cargar}
        empty={buscar || estado ? "Ninguna empresa coincide con la búsqueda." : "Aún no hay empresas."}
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar por nombre o RUC" }}
        sort={orden} onSortChange={setOrden}
        onRowClick={(e) => router.push(`/consola/empresas/ficha?id=${e.id}`)}
        toolbar={<>
          <FiltroSelect etiqueta="Salud" todos="toda" ancho={150} value={nivel} onChange={setNivel}
            options={[{ value: "HEALTHY", label: "Saludables" }, { value: "AT_RISK", label: "En riesgo" }, { value: "CRITICAL", label: "Críticas" }]} />
          <FiltroSelect etiqueta="Plan" ancho={160} value={plan} onChange={setPlan} options={planes.map(([v, l]) => ({ value: v, label: l }))} />
          <FiltroSelect etiqueta="Estado" ancho={170} value={estado} onChange={setEstado}
            options={[...Object.entries(ESTADOS_SUSCRIPCION).map(([v, [l]]) => ({ value: v, label: l })), { value: "NONE", label: "Sin suscripción" }]} />
        </>} />
      <p className="text-[12.5px] text-muted">Salud de 0 a 100 = actividad (último ingreso de sus usuarios) + cobro (estado y días de mora) + soporte (tickets abiertos y urgentes), con los pesos de Parámetros de plataforma. El OSE y WhatsApp se sumarán cuando existan esas integraciones.</p>
    </div>
  );
}
