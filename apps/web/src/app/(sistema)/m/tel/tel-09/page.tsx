"use client";

import { useCallback, useEffect, useState } from "react";
import { AlarmClock, CheckCircle2, PhoneMissed, Timer } from "lucide-react";
import { Badge, Cifra, DataTable, FiltroSelect, PageHeader, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero, porcentaje } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { BotonLlamar } from "@/modulos/tel/BotonLlamar";
import { DetalleLlamada } from "@/modulos/tel/DetalleLlamada";
import { TelefoniaApagada, useTelefonia } from "@/modulos/tel/comun";

type Opcion = { value: string; label: string };
type Tarea = {
  id: string; call_id: string | null; due_at: string; vencida: boolean; numero: string | null; cliente: string | null; customer_id: string | null; lead_id: string | null;
  marca: string | null; responsable: string | null; status: string; done_at: string | null; result: string | null; note: string | null; llamada_at: string | null;
  a_tiempo: boolean | null; puede: boolean;
};
type Lista = Pagina<Tarea> & { cifras: { abiertas: number; vencidas: number; hechas: number; a_tiempo_pct: number | null }; minutos: number; opciones: { marcas: Opcion[]; responsables: Opcion[] } };

/**
 * TEL-09 Llamadas perdidas: las tareas de devolver la llamada con su vencimiento y responsable. Se cierran solas si el
 * cliente vuelve a llamar y lo atienden, o cuando se le devuelve la llamada y contesta.
 */
export default function Perdidas() {
  const encendida = useTelefonia();
  const [f, setF] = useState({ estado: "OPEN", marca: "", responsable: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [ver, setVer] = useState<string | null>(null);
  const pag = usePagina(JSON.stringify(f));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    if (!encendida) return;
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/tel/perdidas?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs, encendida]);
  useEffect(() => cargar(), [cargar]);

  if (!encendida) return <div className="grid gap-5"><PageHeader description="Las llamadas perdidas por devolver." /><TelefoniaApagada /></div>;
  const c = lista?.cifras;
  const columnas: Column<Tarea>[] = [
    { key: "vence", sortable: true, header: "Vence", render: (t) => <div className="whitespace-nowrap"><span className={t.vencida ? "font-semibold text-bad" : ""}>{fechaHora(t.due_at)}</span>{t.vencida && <span className="ml-1.5"><Badge tone="bad">Vencida</Badge></span>}</div> },
    { key: "cliente", sortable: true, header: "Cliente o lead", cardTitle: true, render: (t) => <div><p className="font-semibold text-ink">{t.cliente ?? "—"}</p><p className="font-mono text-[12px] text-muted">{t.numero ?? "—"}</p></div> },
    { key: "marca", sortable: true, header: "Marca", hideOnMobile: true, render: (t) => <span className="text-[12.5px]">{t.marca ?? "—"}</span> },
    { key: "responsable", sortable: true, header: "Responsable", render: (t) => <span className="text-[12.5px]">{t.responsable ?? "Sin responsable"}</span> },
    { key: "status", sortable: true, sortKey: "estado", header: "Estado", render: (t) => t.status === "OPEN" ? <Badge tone="warn">Abierta</Badge> : <Badge tone={t.a_tiempo ? "ok" : "neutral"}>{t.a_tiempo ? "Hecha a tiempo" : "Hecha tarde"}</Badge> },
    { key: "hecha", header: "Hecha", hideOnMobile: true, render: (t) => t.done_at ? <div className="text-[12.5px]">{fechaHora(t.done_at)}{t.result && <p className="line-clamp-1 max-w-[260px] text-[11.5px] text-muted">{t.result}</p>}</div> : <span className="text-muted">—</span> },
    { key: "acciones", header: "", align: "right", render: (t) => t.puede && (t.customer_id || t.lead_id) ? (
      <div onClick={(e) => e.stopPropagation()}><BotonLlamar etiqueta="Devolver" ref_={{ customer_id: t.customer_id, lead_id: t.customer_id ? null : t.lead_id }} onListo={() => cargar()} /></div>) : null },
  ];
  return (
    <div className="grid gap-5">
      <PageHeader description={`Cada llamada perdida, sin respuesta o al buzón deja una tarea de devolverla en ${lista?.minutos ?? 30} minutos. Se cierra sola si el cliente vuelve a llamar y lo atienden, o si le devuelves la llamada y contesta; también se cierra con su resultado en Mis tareas.`} />
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <button type="button" className="text-left" onClick={() => setF({ ...f, estado: "OPEN" })}><Cifra titulo="Abiertas" valor={numero(c.abiertas)} icono={PhoneMissed} destacada /></button>
          <button type="button" className="text-left" onClick={() => setF({ ...f, estado: "VENCIDA" })}><Cifra titulo="Vencidas" valor={numero(c.vencidas)} icono={AlarmClock} tono={c.vencidas ? "bad" : "ok"} detalle="Clic para verlas" /></button>
          <button type="button" className="text-left" onClick={() => setF({ ...f, estado: "DONE" })}><Cifra titulo="Hechas" valor={numero(c.hechas)} icono={CheckCircle2} detalle="Clic para verlas" /></button>
          <Cifra titulo="Devueltas a tiempo" valor={c.a_tiempo_pct === null ? "—" : porcentaje(c.a_tiempo_pct, 1)} icono={Timer} tono={c.a_tiempo_pct !== null && c.a_tiempo_pct < 80 ? "warn" : "ok"} detalle="Antes de su vencimiento" />
        </div>
      )}
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={(t) => t.call_id && setVer(t.call_id)} empty={f.estado === "OPEN" ? "No hay llamadas por devolver." : "Ninguna con estos filtros."}
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar número, cliente o detalle…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Estado" todos="todas" ancho={160} value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={[{ value: "OPEN", label: "Abiertas" }, { value: "VENCIDA", label: "Vencidas" }, { value: "DONE", label: "Hechas" }]} />
          <FiltroSelect etiqueta="Marca" todos="todas" ancho={170} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={lista?.opciones.marcas ?? []} />
          {(lista?.opciones.responsables.length ?? 0) > 0 && <FiltroSelect etiqueta="Responsable" ancho={190} value={f.responsable} onChange={(v) => setF({ ...f, responsable: v })} options={lista?.opciones.responsables ?? []} />}
        </>} />
      {ver && <DetalleLlamada id={ver} onClose={() => setVer(null)} />}
    </div>
  );
}
