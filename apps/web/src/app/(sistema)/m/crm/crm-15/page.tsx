"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, CalendarClock, HeartCrack, RefreshCw, Repeat, TriangleAlert } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, FiltroSelect, PageHeader, Tabs, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";

type Opcion = { value: string; label: string };
type Perfil = {
  id: string; customer_id: string; brand_id: string; cliente: string; celular: string | null; marca: string | null; pedidos: number; frecuencia: number | null;
  ultimo: string | null; esperado: string | null; status: string; estado: string; tarea: { id: string; vence: string; quien: string | null } | null; marketing: boolean | null;
};
type Lista = Pagina<Perfil> & {
  cifras: Record<"DUE" | "AT_RISK" | "LOST" | "ACTIVE" | "NEW", number> & { frecuencia_mediana: number | null };
  calculado: string | null; reglas: { min: number; aviso: number; riesgo: number; perdido: number };
  opciones: { estados: Opcion[]; marcas: Opcion[]; vendedoras: Opcion[] }; puede: { recalcular: boolean; plantilla: boolean; ficha: boolean };
};
type Estado = "DUE" | "AT_RISK" | "LOST" | "ACTIVE" | "NEW";

const TONO: Record<string, Tone> = { DUE: "info", AT_RISK: "warn", LOST: "bad", ACTIVE: "ok", NEW: "neutral" };
const dias = (x: number) => x.toLocaleString("es-PE", { maximumFractionDigits: 1 });

/**
 * CRM-15 Recompra: los clientes por avisar, en riesgo y perdidos de cada marca según su frecuencia (la mediana de días
 * entre pedidos entregados). La tarea de recompra se crea unos días antes de la fecha esperada; la plantilla de
 * recompra sale solo con el consentimiento de marketing vigente.
 */
export default function RecompraPagina() {
  const { can, marca } = useSesion();
  const permitido = Boolean(can("crm.conversation.view_own") || can("crm.conversation.view_all"));
  const [f, setF] = useState<{ estado: Estado; marca: string; vendedora: string; tarea: string; buscar: string }>({ estado: "DUE", marca: "", vendedora: "", tarea: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const filtroMarca = f.marca || (marca !== "ALL" ? marca : "");
  const pag = usePagina(JSON.stringify({ ...f, filtroMarca }));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    if (!permitido) return;
    const q = new URLSearchParams(Object.entries({ ...f, marca: filtroMarca }).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/crm/recompra?${q}&${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, filtroMarca, pag.qs, permitido]);
  useEffect(() => cargar(), [cargar]);

  async function recalcular() {
    setOcupado("recalcular");
    try {
      const r = await api<{ perfiles: number; tareas: number }>("/v1/crm/recompra/recalcular", { method: "POST" });
      toast.ok(`${numero(r.perfiles)} clientes recalculados · ${numero(r.tareas)} tareas nuevas`);
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado(null);
    }
  }
  async function plantilla(p: Perfil) {
    setOcupado(p.id);
    try {
      await api(`/v1/crm/recompra/${p.id}/plantilla`, { method: "POST" });
      toast.ok(`Plantilla de recompra enviada a ${p.cliente}`);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado(null);
    }
  }

  if (!permitido) return <Alert tone="warn">Tu rol no consulta la recompra.</Alert>;
  const c = lista?.cifras;
  const r = lista?.reglas;
  const columnas: Column<Perfil>[] = [
    { key: "cliente", sortable: true, header: "Cliente", cardTitle: true, render: (p) => <div><p className="font-semibold text-ink">{p.cliente}</p>{p.celular && <p className="font-mono text-[12px] text-muted">{p.celular}</p>}</div> },
    { key: "marca", sortable: true, header: "Marca", render: (p) => <span className="text-[12.5px]">{p.marca}</span> },
    { key: "pedidos", sortable: true, header: "Pedidos", align: "right", render: (p) => <span className="tabular-nums">{p.pedidos}</span> },
    { key: "frecuencia", sortable: true, header: "Frecuencia", align: "right", render: (p) => <span className="whitespace-nowrap tabular-nums">{p.frecuencia === null ? "—" : `${dias(p.frecuencia)} días`}</span> },
    { key: "ultimo", sortable: true, header: "Último pedido", render: (p) => <span className="whitespace-nowrap">{fecha(p.ultimo)}</span> },
    { key: "esperado", sortable: true, header: "Esperado", render: (p) => <span className="whitespace-nowrap font-semibold">{fecha(p.esperado)}</span> },
    { key: "status", header: "Estado", render: (p) => <Badge tone={TONO[p.status] ?? "neutral"}>{p.estado}</Badge> },
    { key: "tarea", sortable: true, header: "Tarea", hideOnMobile: true, render: (p) => p.tarea ? <div className="text-[12.5px]">{p.tarea.quien ?? "Sin responsable"}<p className="text-[11.5px] text-muted">vence {fechaHora(p.tarea.vence)}</p></div> : <span className="text-muted">—</span> },
    { key: "marketing", header: "Promociones", hideOnMobile: true, render: (p) => p.marketing === true ? <Badge tone="ok">Acepta</Badge> : p.marketing === false ? <Badge tone="bad">Dio de baja</Badge> : <Badge tone="neutral">Sin registro</Badge> },
    { key: "acciones", header: "", align: "right", render: (p) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {lista?.puede.plantilla && (p.marketing === true
          ? <Button size="sm" loading={ocupado === p.id} onClick={() => plantilla(p)}>Plantilla de recompra</Button>
          : <span title="Sin consentimiento de marketing vigente: regístralo con evidencia en Consentimientos."><Button size="sm" disabled>Plantilla de recompra</Button></span>)}
        {lista?.puede.ficha && <Link href={`/m/crm/crm-04?id=${p.customer_id}`} className="inline-flex h-8 items-center whitespace-nowrap rounded-lg px-2.5 text-[12.5px] font-semibold text-primary hover:bg-surface-2">Ficha</Link>}
      </div>) },
  ];
  const o = lista?.opciones;
  const cifra = (k: Estado) => () => setF({ ...f, estado: k });
  return (
    <div className="grid gap-5">
      <PageHeader description={r ? `Cada cliente con al menos ${r.min} pedidos entregados de una marca tiene su frecuencia: la mediana de días entre sus pedidos. La tarea de recompra se crea ${r.aviso} días antes de la fecha esperada; pasa a «en riesgo» al superar ${dias(r.riesgo)} veces su frecuencia sin comprar y a «perdido» al superar ${dias(r.perdido)} veces.` : "Clientes por avisar, en riesgo y perdidos según su frecuencia de compra."}
        actions={lista?.puede.recalcular ? <Button icon={RefreshCw} loading={ocupado === "recalcular"} onClick={recalcular}>Recalcular</Button> : undefined} />
      {lista?.calculado && <p className="-mt-2 text-[12px] text-muted">Calculado el {fechaHora(lista.calculado)}. Se recalcula solo cada mañana.</p>}
      {error && <Alert tone="bad">{error}</Alert>}
      {c && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <button type="button" className="text-left" onClick={cifra("DUE")}><Cifra titulo="Por avisar" valor={numero(c.DUE)} icono={BellRing} destacada /></button>
          <button type="button" className="text-left" onClick={cifra("AT_RISK")}><Cifra titulo="En riesgo" valor={numero(c.AT_RISK)} icono={TriangleAlert} tono={c.AT_RISK ? "warn" : undefined} detalle="Clic para verlos" /></button>
          <button type="button" className="text-left" onClick={cifra("LOST")}><Cifra titulo="Perdidos" valor={numero(c.LOST)} icono={HeartCrack} tono={c.LOST ? "bad" : undefined} detalle="Clic para verlos" /></button>
          <button type="button" className="text-left" onClick={cifra("ACTIVE")}><Cifra titulo="Al día" valor={numero(c.ACTIVE)} icono={Repeat} tono="ok" detalle="Clic para verlos" /></button>
          <Cifra titulo="Frecuencia mediana" valor={c.frecuencia_mediana === null ? "—" : `${dias(c.frecuencia_mediana)} días`} icono={CalendarClock} detalle={`${numero(c.NEW)} sin frecuencia aún`} />
        </div>
      )}
      <Tabs tabs={(o?.estados ?? []).map((e) => ({ key: e.value as Estado, label: e.label, count: c?.[e.value as Estado] }))} value={f.estado} onChange={(k) => setF({ ...f, estado: k })} />
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        empty="Ningún cliente en este estado con estos filtros." search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar cliente o celular…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Marca" todos="todas" ancho={180} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={o?.marcas ?? []} />
          <FiltroSelect etiqueta="Responsable" ancho={200} value={f.vendedora} onChange={(v) => setF({ ...f, vendedora: v })} options={o?.vendedoras ?? []} />
          <FiltroSelect etiqueta="Tarea" todos="todas" ancho={170} value={f.tarea} onChange={(v) => setF({ ...f, tarea: v })} options={[{ value: "1", label: "Con tarea abierta" }, { value: "0", label: "Sin tarea" }]} />
        </>} />
    </div>
  );
}
