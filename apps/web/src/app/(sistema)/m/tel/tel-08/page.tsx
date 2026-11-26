"use client";

import { useCallback, useEffect, useState } from "react";
import { Phone, PhoneMissed, PhoneIncoming, ShoppingBag } from "lucide-react";
import { Alert, Badge, Cifra, DataTable, FiltroFecha, FiltroSelect, PageHeader, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero, porcentaje } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { segundos } from "@/modulos/tel/BotonLlamar";
import { DetalleLlamada, TONO_LLAMADA } from "@/modulos/tel/DetalleLlamada";
import { TelefoniaApagada, useTelefonia } from "@/modulos/tel/comun";

type Opcion = { value: string; label: string };
type Fila = {
  id: string; started_at: string; direction: string; direccion: string; numero: string; cliente: string | null; lead: string | null; marca: string | null; vendedora: string | null;
  status: string; estado: string; wait_seconds: number; duration_seconds: number; grabacion: string | null; pedido: string | null; preview: boolean;
};
type Lista = Pagina<Fila> & { cifras: { total: number; atendidas: number; perdidas: number; con_pedido_pct: number | null }; opciones: { estados: Opcion[]; marcas: Opcion[]; vendedoras: Opcion[] }; todas: boolean };

/** TEL-08 Historial de llamadas: por cliente, pedido y vendedora, con dirección, estado, espera, duración, grabación y pedido. */
export default function Historial() {
  const encendida = useTelefonia();
  const [f, setF] = useState({ direccion: "", estado: "", vendedora: "", marca: "", grabacion: "", pedido: "", desde: "", hasta: "", buscar: "" });
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
    api<Lista>(`/v1/tel/historial?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs, encendida]);
  useEffect(() => cargar(), [cargar]);

  if (!encendida) return <div className="grid gap-5"><PageHeader description="Todas las llamadas de la central." /><TelefoniaApagada /></div>;
  const c = lista?.cifras;
  const o = lista?.opciones;
  const columnas: Column<Fila>[] = [
    { key: "inicio", sortable: true, header: "Inicio", render: (x) => <span className="whitespace-nowrap">{fechaHora(x.started_at)}</span> },
    { key: "direccion", header: "Dirección", render: (x) => <span className="text-[12.5px]">{x.direccion}</span> },
    { key: "cliente", sortable: true, header: "Cliente o lead", cardTitle: true, render: (x) => <div><p className="font-semibold text-ink">{x.cliente ?? x.lead ?? "—"}</p><p className="font-mono text-[12px] text-muted">{x.numero}</p></div> },
    { key: "marca", sortable: true, header: "Marca", hideOnMobile: true, render: (x) => <span className="text-[12.5px]">{x.marca ?? "—"}</span> },
    { key: "vendedora", sortable: true, header: "Vendedora", hideOnMobile: true, render: (x) => <span className="text-[12.5px]">{x.vendedora ?? "—"}</span> },
    { key: "status", sortable: true, sortKey: "estado", header: "Estado", render: (x) => <Badge tone={TONO_LLAMADA[x.status] ?? "neutral"}>{x.estado}</Badge> },
    { key: "espera", sortable: true, header: "Espera", align: "right", hideOnMobile: true, render: (x) => segundos(x.wait_seconds) },
    { key: "duracion", sortable: true, header: "Duración", align: "right", render: (x) => segundos(x.duration_seconds) },
    { key: "grabacion", header: "Grabación", hideOnMobile: true, render: (x) => x.grabacion === "AVAILABLE" ? <Badge tone="ok">Sí</Badge> : x.grabacion === "PURGED" ? <Badge tone="neutral">Purgada</Badge> : <span className="text-muted">No</span> },
    { key: "pedido", header: "Pedido", hideOnMobile: true, render: (x) => <span className="font-mono text-[12.5px]">{x.pedido ?? "—"}</span> },
  ];
  return (
    <div className="grid gap-5">
      <PageHeader description="Cada llamada de la central, entrante o saliente: con quién, qué vendedora, cuánto esperó, cuánto duró, si se grabó y si terminó en pedido." />
      {lista && !lista.todas && <Alert tone="info">Ves solo tus llamadas.</Alert>}
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Llamadas" valor={numero(c.total)} icono={Phone} destacada />
          <Cifra titulo="Atendidas" valor={numero(c.atendidas)} icono={PhoneIncoming} tono="ok" />
          <Cifra titulo="Perdidas" valor={numero(c.perdidas)} icono={PhoneMissed} tono={c.perdidas ? "warn" : undefined} detalle="Entrantes perdidas, sin respuesta o al buzón" />
          <Cifra titulo="Terminan en pedido" valor={c.con_pedido_pct === null ? "—" : porcentaje(c.con_pedido_pct, 1)} icono={ShoppingBag} detalle="De las atendidas" />
        </div>
      )}
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={(x) => setVer(x.id)} empty="Ninguna llamada con estos filtros." search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar número, cliente, lead o pedido…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Dirección" todos="todas" ancho={160} value={f.direccion} onChange={(v) => setF({ ...f, direccion: v })} options={[{ value: "INBOUND", label: "Entrantes" }, { value: "OUTBOUND", label: "Salientes" }]} />
          <FiltroSelect etiqueta="Estado" ancho={160} value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={o?.estados ?? []} />
          {(o?.vendedoras.length ?? 0) > 0 && <FiltroSelect etiqueta="Vendedora" todos="todas" ancho={190} value={f.vendedora} onChange={(v) => setF({ ...f, vendedora: v })} options={o?.vendedoras ?? []} />}
          <FiltroSelect etiqueta="Marca" todos="todas" ancho={170} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={o?.marcas ?? []} />
          <FiltroSelect etiqueta="Grabación" todos="todas" ancho={160} value={f.grabacion} onChange={(v) => setF({ ...f, grabacion: v })} options={[{ value: "1", label: "Con grabación" }, { value: "0", label: "Sin grabación" }]} />
          <FiltroSelect etiqueta="Pedido" ancho={160} value={f.pedido} onChange={(v) => setF({ ...f, pedido: v })} options={[{ value: "1", label: "Con pedido" }, { value: "0", label: "Sin pedido" }]} />
          <FiltroFecha etiqueta="Desde" visible value={f.desde} max={f.hasta || undefined} onChange={(v) => setF({ ...f, desde: v })} />
          <FiltroFecha etiqueta="Hasta" visible value={f.hasta} min={f.desde || undefined} onChange={(v) => setF({ ...f, hasta: v })} />
        </>} />
      {ver && <DetalleLlamada id={ver} onClose={() => setVer(null)} />}
    </div>
  );
}
