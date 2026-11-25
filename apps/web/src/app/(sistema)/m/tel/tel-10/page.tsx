"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, FileText, Mic, ShieldCheck } from "lucide-react";
import { Alert, Badge, Cifra, DataTable, FiltroFecha, FiltroSelect, PageHeader, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { segundos } from "@/modulos/tel/BotonLlamar";
import { DetalleGrabacion, type FilaGrabacion } from "@/modulos/tel/Grabacion";
import { TelefoniaApagada, useTelefonia } from "@/modulos/tel/comun";

type Opcion = { value: string; label: string };
type Lista = Pagina<FilaGrabacion> & {
  cifras: { disponibles: number; transcritas: number; con_alertas: number; retenidas: number }; transcripcion: boolean;
  opciones: { marcas: Opcion[]; vendedoras: Opcion[] };
};

/**
 * TEL-10 Grabación y transcripción: las grabaciones con su reproductor (cada escucha queda en la bitácora, Ley 29733),
 * su transcripción y las alertas que encontraron las reglas de control.
 */
function Grabaciones() {
  const params = useSearchParams();
  const encendida = useTelefonia();
  const [f, setF] = useState({ estado: "", marca: "", vendedora: "", texto: "", alertas: "", desde: "", hasta: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [ver, setVer] = useState<string | null>(params.get("id"));
  const pag = usePagina(JSON.stringify(f));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    if (!encendida) return;
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/tel/grabaciones?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs, encendida]);
  useEffect(() => cargar(), [cargar]);

  if (!encendida) return <div className="grid gap-5"><PageHeader description="Las grabaciones de las llamadas." /><TelefoniaApagada /></div>;
  const c = lista?.cifras;
  const columnas: Column<FilaGrabacion>[] = [
    { key: "inicio", sortable: true, header: "Llamada", render: (g) => <div className="whitespace-nowrap"><p>{fechaHora(g.started_at)}</p><p className="text-[11.5px] text-muted">{g.direccion}</p></div> },
    { key: "cliente", sortable: true, header: "Cliente o lead", cardTitle: true, render: (g) => <div><p className="font-semibold text-ink">{g.cliente ?? "—"}</p><p className="font-mono text-[12px] text-muted">{g.numero}</p></div> },
    { key: "vendedora", sortable: true, header: "Vendedora", hideOnMobile: true, render: (g) => <span className="text-[12.5px]">{g.vendedora ?? "—"}</span> },
    { key: "marca", sortable: true, header: "Marca", hideOnMobile: true, render: (g) => <span className="text-[12.5px]">{g.marca ?? "—"}</span> },
    { key: "duracion", sortable: true, header: "Duración", align: "right", render: (g) => segundos(g.duration_seconds) },
    { key: "texto", header: "Transcripción", hideOnMobile: true, render: (g) => g.transcrita ? <Badge tone="info">Con texto</Badge> : <span className="text-muted">—</span> },
    { key: "alertas", header: "Alertas", render: (g) => g.alertas ? <Badge tone="bad">{numero(g.alertas)}</Badge> : <span className="text-muted">0</span> },
    { key: "retencion", sortable: true, header: "Se conserva hasta", hideOnMobile: true, render: (g) => g.status === "PURGED"
      ? <Badge tone="neutral">Purgada</Badge>
      : <div className="whitespace-nowrap text-[12.5px]">{fecha(g.retention_until)}{g.legal_hold ? <span className="ml-1.5"><Badge tone="info">Retención legal</Badge></span> : g.dias !== null && g.dias <= 30 ? <span className="ml-1.5"><Badge tone="warn">{g.dias} días</Badge></span> : null}</div> },
  ];
  const o = lista?.opciones;
  return (
    <div className="grid gap-5">
      <PageHeader description="Cada llamada atendida con aviso queda grabada. Al escucharla o descargarla queda en la bitácora con tu nombre (Ley 29733). La transcripción pasa por las reglas de control y cada coincidencia es una alerta para revisar." />
      {lista && !lista.transcripcion && <Alert tone="info">La transcripción está apagada. Se enciende en Ajustes de Telefonía.</Alert>}
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Grabaciones disponibles" valor={numero(c.disponibles)} icono={Mic} destacada />
          <button type="button" className="text-left" onClick={() => setF({ ...f, texto: f.texto === "1" ? "" : "1" })}><Cifra titulo="Con transcripción" valor={numero(c.transcritas)} icono={FileText} detalle="Clic para verlas" /></button>
          <button type="button" className="text-left" onClick={() => setF({ ...f, alertas: f.alertas === "1" ? "" : "1" })}><Cifra titulo="Con alertas" valor={numero(c.con_alertas)} icono={AlertTriangle} tono={c.con_alertas ? "bad" : "ok"} detalle="Clic para verlas" /></button>
          <Cifra titulo="En retención legal" valor={numero(c.retenidas)} icono={ShieldCheck} detalle="No se purgan mientras sigan" />
        </div>
      )}
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={(g) => setVer(g.id)} empty="Ninguna grabación con estos filtros." search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar número, cliente, vendedora o pedido…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Estado" ancho={160} value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={[{ value: "AVAILABLE", label: "Disponibles" }, { value: "PURGED", label: "Purgadas" }]} />
          <FiltroSelect etiqueta="Transcripción" todos="todas" ancho={170} value={f.texto} onChange={(v) => setF({ ...f, texto: v })} options={[{ value: "1", label: "Con texto" }, { value: "0", label: "Sin texto" }]} />
          <FiltroSelect etiqueta="Alertas" todos="todas" ancho={160} value={f.alertas} onChange={(v) => setF({ ...f, alertas: v })} options={[{ value: "1", label: "Con alertas" }]} />
          {(o?.vendedoras.length ?? 0) > 0 && <FiltroSelect etiqueta="Vendedora" todos="todas" ancho={190} value={f.vendedora} onChange={(v) => setF({ ...f, vendedora: v })} options={o?.vendedoras ?? []} />}
          <FiltroSelect etiqueta="Marca" todos="todas" ancho={170} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={o?.marcas ?? []} />
          <FiltroFecha etiqueta="Desde" visible value={f.desde} max={f.hasta || undefined} onChange={(v) => setF({ ...f, desde: v })} />
          <FiltroFecha etiqueta="Hasta" visible value={f.hasta} min={f.desde || undefined} onChange={(v) => setF({ ...f, hasta: v })} />
        </>} />
      {ver && <DetalleGrabacion id={ver} onClose={() => setVer(null)} onCambio={cargar} />}
    </div>
  );
}

export default function Page() {
  return <Suspense><Grabaciones /></Suspense>;
}
