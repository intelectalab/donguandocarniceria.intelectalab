"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, DataTable, DetailList, Field, FiltroFecha, FiltroSelect, Input, Modal, PageHeader, Select, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { BotonLlamar, ResultadoDePrueba, segundos, type Llamada } from "@/modulos/tel/BotonLlamar";
import { TelefoniaApagada, useTelefonia } from "@/modulos/tel/comun";

type Opcion = { value: string; label: string };
type Destino = {
  pedido: { id: string; number: string; status: string } | null; cliente: { id: string; nombre: string } | null; lead: { id: string; nombre: string } | null;
  celular: string | null; marca: string | null; sale_con: { id: string; e164: string; de: string } | null; registrado: boolean; puede: boolean;
};
type Lista = Pagina<Llamada> & { opciones: { estados: Opcion[]; vendedoras: Opcion[] }; simulador: boolean };

const TONO: Record<string, Tone> = { COMPLETED: "ok", MISSED: "bad", NO_ANSWER: "bad", VOICEMAIL: "warn", BUSY: "warn", FAILED: "bad", RINGING: "info", IN_PROGRESS: "info" };

/**
 * TEL-07 Llamar desde la ficha o el pedido: el «Llamar» sale con el número de la marca del cliente o del pedido; el
 * cliente nunca ve el celular de la vendedora. Debajo, las llamadas salientes.
 */
export default function LlamarDesdeElPedido() {
  const encendida = useTelefonia();
  const [buscarPedido, setBuscarPedido] = useState("");
  const [pedidos, setPedidos] = useState<Opcion[]>([]);
  const [pedido, setPedido] = useState("");
  const [destino, setDestino] = useState<Destino | null>(null);
  const [f, setF] = useState({ estado: "", vendedora: "", desde: "", hasta: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [ver, setVer] = useState<Llamada | null>(null);
  const pag = usePagina(JSON.stringify(f));

  useEffect(() => {
    if (!encendida) return;
    const t = setTimeout(() => {
      api<{ data: Opcion[] }>(`/v1/tel/pedidos?buscar=${encodeURIComponent(buscarPedido.trim())}`).then((r) => setPedidos(r.data)).catch(() => setPedidos([]));
    }, 300);
    return () => clearTimeout(t);
  }, [buscarPedido, encendida]);
  useEffect(() => {
    if (!pedido) return;
    api<Destino>(`/v1/tel/llamar/destino?order_id=${pedido}`).then(setDestino).catch((e) => setError(mensajeDe(e)));
  }, [pedido]);
  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    if (!encendida) return;
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/tel/salientes?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs, encendida]);
  useEffect(() => cargar(), [cargar]);

  if (!encendida) return <div className="grid gap-5"><PageHeader description="Llamar al cliente con el número de la marca." /><TelefoniaApagada /></div>;
  const columnas: Column<Llamada>[] = [
    { key: "inicio", sortable: true, header: "Inicio", render: (c) => <span className="whitespace-nowrap">{fechaHora(c.started_at)}</span> },
    { key: "cliente", sortable: true, header: "Cliente", cardTitle: true, render: (c) => <div><p className="font-semibold text-ink">{c.cliente ?? c.lead ?? "—"}</p><p className="font-mono text-[12px] text-muted">{c.to_e164}</p></div> },
    { key: "from", header: "Sale con", hideOnMobile: true, render: (c) => <span className="font-mono text-[12.5px]">{c.from_e164}</span> },
    { key: "vendedora", sortable: true, header: "Vendedora", hideOnMobile: true, render: (c) => <span className="text-[12.5px]">{c.vendedora ?? "—"}</span> },
    { key: "pedido", header: "Pedido", hideOnMobile: true, render: (c) => <span className="font-mono text-[12.5px]">{c.pedido ?? "—"}</span> },
    { key: "status", sortable: true, sortKey: "estado", header: "Estado", render: (c) => <Badge tone={TONO[c.status] ?? "neutral"}>{c.estado}</Badge> },
    { key: "duracion", sortable: true, header: "Duración", align: "right", render: (c) => segundos(c.duration_seconds) },
  ];
  return (
    <div className="grid gap-5">
      <PageHeader description="«Llamar» sale siempre con el número de la marca del cliente o del pedido (o el general): el cliente nunca ve el celular de la vendedora. El botón también está en la ficha 360 y en las tareas de devolver llamadas." />
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="text-[14px] font-semibold text-ink">Llamar por un pedido</h2>
          <Field label="Buscar pedido" hint="Vacío: los que se entregan hoy. Por número, cliente o celular."><Input value={buscarPedido} onChange={(e) => setBuscarPedido(e.target.value)} placeholder="P-001234 o nombre del cliente" /></Field>
          <Field label="Pedido"><Select value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder={pedidos.length ? "Elige el pedido" : "Ningún pedido"} options={pedidos} /></Field>
          {destino && (
            <>
              <DetailList items={[
                { label: "Cliente", value: destino.cliente?.nombre ?? destino.lead?.nombre ?? "—" }, { label: "Celular", value: destino.celular ?? "Sin celular" },
                { label: "Marca", value: destino.marca ?? "—" }, { label: "Sale con", value: destino.sale_con ? `${destino.sale_con.e164} (${destino.sale_con.de})` : "Sin número de la central" },
              ]} />
              {destino.puede ? <BotonLlamar ref_={{ order_id: destino.pedido?.id }} size="md" onListo={() => cargar()} /> : <Alert tone="warn">Para llamar, Telefonía tiene que estar en vivo y tu rol debe poder llamar.</Alert>}
            </>
          )}
        </section>
        <section className="grid content-start gap-2 rounded-xl border border-line bg-surface p-4 text-[12.5px] shadow-card">
          <h2 className="text-[14px] font-semibold text-ink">Cómo funciona</h2>
          <p>1. Eliges al cliente (aquí por su pedido, o desde su ficha 360 o una tarea).</p>
          <p>2. El sistema llama primero a tu teléfono de la app y luego al cliente, con el número de la marca.</p>
          <p>3. Si la llamada se graba, el cliente escucha el aviso antes de hablar.</p>
          <p className="text-muted">Con «solo llamar a registrados» (Ajustes), no se llama a números que no son clientes ni leads.</p>
        </section>
      </div>
      <h2 className="text-[14px] font-semibold text-ink">Llamadas salientes</h2>
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={setVer} empty="Ninguna llamada saliente con estos filtros." search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar cliente, celular o pedido…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Estado" ancho={160} value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={lista?.opciones.estados ?? []} />
          {(lista?.opciones.vendedoras.length ?? 0) > 0 && <FiltroSelect etiqueta="Vendedora" todos="todas" ancho={190} value={f.vendedora} onChange={(v) => setF({ ...f, vendedora: v })} options={lista?.opciones.vendedoras ?? []} />}
          <FiltroFecha etiqueta="Desde" visible value={f.desde} max={f.hasta || undefined} onChange={(v) => setF({ ...f, desde: v })} />
          <FiltroFecha etiqueta="Hasta" visible value={f.hasta} min={f.desde || undefined} onChange={(v) => setF({ ...f, hasta: v })} />
        </>} />
      {ver && (ver.status === "RINGING" && lista?.simulador
        ? <ResultadoDePrueba llamada={ver} onClose={() => setVer(null)} onListo={() => { setVer(null); cargar(); }} />
        : <Modal open onClose={() => setVer(null)} title={`Llamada a ${ver.cliente ?? ver.lead ?? ver.to_e164}`} description={fechaHora(ver.started_at)}>
          <DetailList items={[
            { label: "Estado", value: <Badge tone={TONO[ver.status] ?? "neutral"}>{ver.estado}</Badge> }, { label: "Sale con", value: ver.from_e164 }, { label: "Al celular", value: ver.to_e164 },
            { label: "Vendedora", value: ver.vendedora ?? "—" }, { label: "Pedido", value: ver.pedido ?? "—" }, { label: "Marca", value: ver.marca ?? "—" },
            { label: "Duración", value: segundos(ver.duration_seconds) }, { label: "Aviso de grabación", value: ver.notice_played ? "Reproducido" : "No" },
            { label: "Costo", value: ver.cost_usd !== null ? `USD ${ver.cost_usd.toFixed(4)}` : "—" },
          ]} />
        </Modal>)}
    </div>
  );
}
