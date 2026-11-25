"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Headphones, Mic, ShieldCheck, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, FiltroFecha, FiltroSelect, PageHeader, Tabs, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { DetalleGrabacion, type FilaGrabacion } from "@/modulos/tel/Grabacion";
import { TelefoniaApagada, useTelefonia } from "@/modulos/tel/comun";

type Vista = "bitacora" | "por_vencer" | "retenidas" | "corridas" | "purgadas";
type Acceso = { id: string; recording_id: string; accessed_at: string; persona: string | null; action: string; accion: string; motivo: string | null; numero: string; cliente: string | null; vendedora: string | null; llamada_at: string; preview: boolean };
type Corrida = { id: string; number: string; started_at: string; cutoff_date: string; purgadas: number; status: string; estado: string; run_by: string; error: string | null };
type Fila = Acceso | Corrida | FilaGrabacion;
type Panel = Pagina<Fila> & {
  vista: Vista; cifras: { disponibles: number; por_vencer: number; retenidas: number; purgadas: number; accesos: number }; dias: number;
  ultima: { started_at: string; purgadas: number } | null; puede_purgar: boolean; opciones: { personas: { value: string; label: string }[] };
};

/**
 * TEL-12 Escuchas y retención: la bitácora de escuchas y descargas, las grabaciones por vencer, las retenidas por un caso
 * legal, las corridas de purga y las purgadas (RN-TEL-10 y 11, Ley 29733).
 */
export default function EscuchasYRetencion() {
  const encendida = useTelefonia();
  const [vista, setVista] = useState<Vista>("bitacora");
  const [f, setF] = useState({ accion: "", persona: "", desde: "", hasta: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [p, setP] = useState<Panel | null>(null);
  const [error, setError] = useState("");
  const [ver, setVer] = useState<string | null>(null);
  const [purgando, setPurgando] = useState(false);
  const pag = usePagina(JSON.stringify({ ...f, vista }));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    if (!encendida) return;
    const usa = vista === "bitacora" ? ["accion", "persona", "desde", "hasta", "buscar"] : vista === "corridas" ? ["desde", "hasta", "buscar"] : ["persona", "buscar"];
    const q = new URLSearchParams([["vista", vista], ...Object.entries(f).filter(([k, v]) => v && usa.includes(k))]).toString();
    api<Panel>(`/v1/tel/grabaciones/retencion?${q}&${pag.qs}`).then((r) => { setP(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, vista, pag.qs, encendida]);
  useEffect(() => cargar(), [cargar]);

  async function purgar() {
    if (!(await confirmAction({ title: "Correr la purga de hoy", message: `Se elimina el audio de las grabaciones vencidas (${p?.dias ?? 180} días desde la llamada) que no estén en retención legal. Los datos de la llamada se conservan y no se puede deshacer.`, confirmLabel: "Purgar", danger: true }))) return;
    setPurgando(true);
    try {
      const r = await api<{ mensaje: string }>("/v1/tel/grabaciones/purga", { method: "POST" });
      toast.ok(r.mensaje);
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setPurgando(false);
    }
  }
  async function retencion(g: FilaGrabacion) {
    const r = await confirmAction(g.legal_hold
      ? { title: "Quitar la retención legal", message: "La grabación volverá a purgarse al vencer su plazo.", confirmLabel: "Quitar retención", danger: true, reason: { label: "Motivo", min: 5 } }
      : { title: "Retención legal", message: "Mientras siga, la grabación no se purga aunque venza su plazo.", confirmLabel: "Retener", reason: { label: "Motivo (reclamo, proceso o pedido de autoridad)", min: 5 } });
    if (!r) return;
    try {
      await api(`/v1/tel/grabaciones/${g.id}/retencion`, { method: "POST", body: { activa: !g.legal_hold, motivo: r.reason } });
      toast.ok(g.legal_hold ? "Retención legal quitada" : "Grabación en retención legal");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  if (!encendida) return <div className="grid gap-5"><PageHeader description="Escuchas y retención de las grabaciones." /><TelefoniaApagada /></div>;
  const c = p?.cifras;
  const colAccesos: Column<Acceso>[] = [
    { key: "fecha", sortable: true, header: "Fecha", render: (a) => <span className="whitespace-nowrap">{fechaHora(a.accessed_at)}</span> },
    { key: "persona", sortable: true, header: "Quién", cardTitle: true, render: (a) => <span className="font-semibold text-ink">{a.persona ?? "—"}</span> },
    { key: "accion", sortable: true, header: "Acción", render: (a) => <Badge tone={a.action === "DOWNLOAD" ? "warn" : "neutral"}>{a.accion}</Badge> },
    { key: "llamada", header: "Llamada", render: (a) => <div><p className="text-[12.5px] text-ink">{a.cliente ?? a.numero}</p><p className="text-[11.5px] text-muted">{fechaHora(a.llamada_at)} · {a.vendedora ?? "—"}</p></div> },
    { key: "motivo", header: "Motivo", hideOnMobile: true, render: (a) => <span className="text-[12.5px] text-muted">{a.motivo ?? "—"}{a.preview ? " · demostración" : ""}</span> },
  ];
  const colGrab: Column<FilaGrabacion>[] = [
    { key: "inicio", sortable: true, header: "Llamada", render: (g) => <div className="whitespace-nowrap"><p>{fechaHora(g.started_at)}</p><p className="text-[11.5px] text-muted">{g.direccion}</p></div> },
    { key: "cliente", header: "Cliente o lead", cardTitle: true, render: (g) => <div><p className="font-semibold text-ink">{g.cliente ?? "—"}</p><p className="font-mono text-[12px] text-muted">{g.numero}</p></div> },
    { key: "vendedora", sortable: true, header: "Vendedora", hideOnMobile: true, render: (g) => <span className="text-[12.5px]">{g.vendedora ?? "—"}</span> },
    vista === "purgadas"
      ? { key: "purgada", sortable: true, header: "Purgada", render: (g) => <span className="whitespace-nowrap">{fechaHora(g.purged_at)}</span> }
      : { key: "retencion", sortable: true, header: "Se conserva hasta", render: (g) => <div className="whitespace-nowrap">{fecha(g.retention_until)}{!g.legal_hold && g.dias !== null && <span className="ml-1.5"><Badge tone={g.dias <= 7 ? "bad" : "warn"}>{g.dias} días</Badge></span>}</div> },
    { key: "motivo", header: "Retención legal", hideOnMobile: true, render: (g) => g.legal_hold ? <div className="max-w-[280px] text-[12.5px]"><Badge tone="info">Sí</Badge><p className="line-clamp-2 text-muted">{g.legal_hold_reason}</p></div> : <span className="text-muted">No</span> },
    ...(vista !== "purgadas" ? [{ key: "acciones", header: "", align: "right" as const, render: (g: FilaGrabacion) => (
      <div onClick={(e) => e.stopPropagation()}><Button size="sm" variant="ghost" icon={ShieldCheck} onClick={() => retencion(g)}>{g.legal_hold ? "Quitar retención" : "Retención legal"}</Button></div>) }] : []),
  ];
  const colCorridas: Column<Corrida>[] = [
    { key: "numero", sortable: true, header: "Corrida", cardTitle: true, render: (r) => <span className="font-mono font-semibold text-ink">{r.number}</span> },
    { key: "fecha", sortable: true, header: "Fecha", render: (r) => <span className="whitespace-nowrap">{fechaHora(r.started_at)}</span> },
    { key: "corte", header: "Vencidas antes del", render: (r) => fecha(r.cutoff_date) },
    { key: "purgadas", sortable: true, header: "Purgadas", align: "right", render: (r) => numero(r.purgadas) },
    { key: "estado", header: "Resultado", render: (r) => <div><Badge tone={r.status === "COMPLETED" ? "ok" : "bad"}>{r.estado}</Badge>{r.error && <p className="text-[11.5px] text-bad">{r.error}</p>}</div> },
    { key: "run_by", header: "Ejecutó", hideOnMobile: true, render: (r) => <span className="text-[12.5px]">{r.run_by}</span> },
  ];
  const personas = p?.opciones.personas ?? [];
  const tabla = {
    ...pag.orden, pagination: pag.props(p), loading: !p && !error, error, onRetry: cargar,
    search: { value: buscar, onChange: setBuscar, placeholder: vista === "bitacora" ? "Buscar persona, motivo, número o cliente…" : vista === "corridas" ? "Buscar número de corrida o quién la ejecutó…" : "Buscar número, cliente o vendedora…" },
  };
  return (
    <div className="grid gap-5">
      <PageHeader description={`Las grabaciones se conservan ${p?.dias ?? 180} días desde la llamada y cada noche se purga el audio de las vencidas, salvo las que están en retención legal; los datos de la llamada se conservan. Cada escucha y descarga queda registrada.`}
        actions={p?.puede_purgar ? <Button variant="primary" icon={Trash2} loading={purgando} onClick={purgar}>Correr purga de hoy</Button> : undefined} />
      <Alert tone="info">Ley 29733 de Protección de Datos Personales: las grabaciones son datos personales. Se avisa al inicio de la llamada, se conservan solo el plazo definido, cada escucha y descarga queda registrada y al vencer se elimina el audio.</Alert>
      {c && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Cifra titulo="Grabaciones disponibles" valor={numero(c.disponibles)} icono={Mic} destacada />
          <button type="button" className="text-left" onClick={() => setVista("por_vencer")}><Cifra titulo="Vencen en 30 días" valor={numero(c.por_vencer)} icono={CalendarClock} tono={c.por_vencer ? "warn" : "ok"} detalle="Clic para verlas" /></button>
          <button type="button" className="text-left" onClick={() => setVista("retenidas")}><Cifra titulo="En retención legal" valor={numero(c.retenidas)} icono={ShieldCheck} detalle="Clic para verlas" /></button>
          <button type="button" className="text-left" onClick={() => setVista("purgadas")}><Cifra titulo="Purgadas" valor={numero(c.purgadas)} icono={Trash2} detalle={p?.ultima ? `Última corrida ${fecha(p.ultima.started_at)}` : "Sin corridas registradas"} /></button>
          <button type="button" className="text-left" onClick={() => setVista("bitacora")}><Cifra titulo="Escuchas y descargas" valor={numero(c.accesos)} icono={Headphones} detalle="Clic para ver la bitácora" /></button>
        </div>
      )}
      <Tabs<Vista> value={vista} onChange={(v) => { setVista(v); setP(null); }} tabs={[
        { key: "bitacora", label: "Bitácora", count: c?.accesos }, { key: "por_vencer", label: "Por vencer", count: c?.por_vencer },
        { key: "retenidas", label: "Retención legal", count: c?.retenidas }, { key: "corridas", label: "Corridas de purga" }, { key: "purgadas", label: "Purgadas", count: c?.purgadas },
      ]} />
      {vista === "bitacora" && (
        <DataTable<Acceso> {...tabla} columns={colAccesos} rows={(p?.vista === "bitacora" ? p.data : []) as Acceso[]} onRowClick={(a) => setVer(a.recording_id)} empty="Nadie escuchó ni descargó grabaciones con estos filtros."
          toolbar={<>
            <FiltroSelect etiqueta="Acción" todos="todas" ancho={160} value={f.accion} onChange={(v) => setF({ ...f, accion: v })} options={[{ value: "PLAY", label: "Escucha" }, { value: "DOWNLOAD", label: "Descarga" }]} />
            <FiltroSelect etiqueta="Quién" todos="todas" ancho={190} value={f.persona} onChange={(v) => setF({ ...f, persona: v })} options={personas} />
            <FiltroFecha etiqueta="Desde" visible value={f.desde} max={f.hasta || undefined} onChange={(v) => setF({ ...f, desde: v })} />
            <FiltroFecha etiqueta="Hasta" visible value={f.hasta} min={f.desde || undefined} onChange={(v) => setF({ ...f, hasta: v })} />
          </>} />
      )}
      {vista === "corridas" && (
        <DataTable<Corrida> {...tabla} columns={colCorridas} rows={(p?.vista === "corridas" ? p.data : []) as Corrida[]} empty="Sin corridas: la purga corre cada noche con Telefonía encendida."
          toolbar={<>
            <FiltroFecha etiqueta="Desde" visible value={f.desde} max={f.hasta || undefined} onChange={(v) => setF({ ...f, desde: v })} />
            <FiltroFecha etiqueta="Hasta" visible value={f.hasta} min={f.desde || undefined} onChange={(v) => setF({ ...f, hasta: v })} />
          </>} />
      )}
      {["por_vencer", "retenidas", "purgadas"].includes(vista) && (
        <DataTable<FilaGrabacion> {...tabla} columns={colGrab} rows={(p?.vista === vista ? p.data : []) as FilaGrabacion[]} onRowClick={(g) => setVer(g.id)}
          empty={vista === "por_vencer" ? "Ninguna grabación vence en los próximos 30 días." : vista === "retenidas" ? "Ninguna grabación en retención legal." : "Todavía no se purgó ninguna grabación."}
          toolbar={<FiltroSelect etiqueta="Vendedora" todos="todas" ancho={190} value={f.persona} onChange={(v) => setF({ ...f, persona: v })} options={personas} />} />
      )}
      {ver && <DetalleGrabacion id={ver} onClose={() => setVer(null)} onCambio={cargar} />}
    </div>
  );
}
