"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MessageSquareHeart, PackageX, Send, ShoppingBag, Star, ThumbsUp } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, DataTable, DetailList, Field, FiltroFecha, FiltroSelect, Modal, PageHeader, Select, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero, porcentaje } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";

type Opcion = { value: string; label: string };
type Encuesta = {
  id: string; order_id: string; pedido: string; customer_id: string; cliente: string; celular: string | null; marca: string | null; vendedora: string | null; sent_at: string;
  send_mode: string; envio: string; answered_at: string | null; rating_service: number | null; rating_product: number | null; received_as_ordered: boolean | null;
  bought_outside_catalog: boolean | null; comments: string | null; conversation_id: string | null;
};
type Barra = { nombre: string; valor: number; n: number };
type Lista = Pagina<Encuesta> & {
  cifras: { enviadas: number; salieron: number; respondidas: number; no_enviadas: number; atencion: number | null; producto: number | null; no_recibio: number; fuera_web: number };
  por_vendedora: Barra[]; por_marca: Barra[]; reglas: { horas: number; tope: number };
  opciones: { senales: Opcion[]; envios: Opcion[]; marcas: Opcion[]; vendedoras: Opcion[] }; puede: { responder: boolean };
};

const nota = (x: number | null) => (x === null ? "—" : x.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function Senal({ e }: { e: Encuesta }) {
  if (e.bought_outside_catalog) return <Badge tone="bad">Compró algo que no está en la web</Badge>;
  if (e.received_as_ordered === false) return <Badge tone="warn">No recibió lo que pidió</Badge>;
  if (e.send_mode === "NOT_SENT") return <Badge tone="neutral">No enviada</Badge>;
  if (!e.answered_at) return <Badge tone="neutral">Sin respuesta</Badge>;
  return <Badge tone="ok">Sin observaciones</Badge>;
}

function Barras({ titulo, filas }: { titulo: string; filas: Barra[] }) {
  return (
    <section className="grid content-start gap-2 rounded-xl border border-line bg-surface p-4 shadow-card">
      <h2 className="text-[14px] font-semibold text-ink">{titulo}</h2>
      {filas.length === 0 && <p className="text-[12.5px] text-muted">Sin respuestas con estos filtros.</p>}
      {filas.map((b) => (
        <div key={b.nombre} className="grid grid-cols-[minmax(100px,170px)_1fr_64px] items-center gap-3 text-[12.5px]">
          <span className="truncate" title={b.nombre}>{b.nombre}</span>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-2"><div className={`h-full rounded-full ${b.valor < 4 ? "bg-warn" : "bg-ok"}`} style={{ width: `${(b.valor / 5) * 100}%` }} /></div>
          <span className="text-right tabular-nums">{nota(b.valor)} <span className="text-[11px] text-muted">({b.n})</span></span>
        </div>
      ))}
    </section>
  );
}

/**
 * CRM-16 Encuesta posentrega: a las horas de la entrega se envía una encuesta por el chat del pedido (en la ventana o
 * como plantilla de utilidad si el pedido no agotó su cupo). Se resaltan «no recibí lo que pedí» y «compré algo que no
 * está en la web», que crean su tarea y su alerta.
 */
export default function EncuestaPosentrega() {
  const { can, marca } = useSesion();
  const permitido = Boolean(can("crm.survey.view"));
  const [f, setF] = useState({ senal: "", envio: "", marca: "", vendedora: "", desde: "", hasta: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [abierta, setAbierta] = useState<Encuesta | null>(null);
  const filtroMarca = f.marca || (marca !== "ALL" ? marca : "");
  const pag = usePagina(JSON.stringify({ ...f, filtroMarca }));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    if (!permitido) return;
    const q = new URLSearchParams(Object.entries({ ...f, marca: filtroMarca }).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/crm/encuestas?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, filtroMarca, pag.qs, permitido]);
  useEffect(() => cargar(), [cargar]);

  if (!permitido) return <Alert tone="warn">Las encuestas las ven la supervisión, marketing y la gerencia.</Alert>;
  const c = lista?.cifras;
  const columnas: Column<Encuesta>[] = [
    { key: "pedido", sortable: true, header: "Pedido", render: (e) => <span className="whitespace-nowrap font-mono text-[12.5px] font-semibold text-ink">{e.pedido}</span> },
    { key: "cliente", sortable: true, header: "Cliente", cardTitle: true, render: (e) => <div><p className="font-semibold text-ink">{e.cliente}</p>{e.celular && <p className="font-mono text-[12px] text-muted">{e.celular}</p>}</div> },
    { key: "marca", sortable: true, header: "Marca", hideOnMobile: true, render: (e) => <span className="text-[12.5px]">{e.marca}</span> },
    { key: "vendedora", sortable: true, header: "Vendedora", hideOnMobile: true, render: (e) => <span className="text-[12.5px]">{e.vendedora ?? "—"}</span> },
    { key: "enviada", sortable: true, header: "Envío", render: (e) => <div className="whitespace-nowrap text-[12.5px]">{fechaHora(e.sent_at)}<p className="text-[11.5px] text-muted">{e.envio}</p></div> },
    { key: "atencion", sortable: true, header: "Atención", align: "right", render: (e) => <span className="tabular-nums">{e.rating_service ?? "—"}</span> },
    { key: "producto", sortable: true, header: "Producto", align: "right", render: (e) => <span className="tabular-nums">{e.rating_product ?? "—"}</span> },
    { key: "status", header: "Señal", render: (e) => <Senal e={e} /> },
    { key: "comments", header: "Comentario", hideOnMobile: true, render: (e) => <span className="line-clamp-2 max-w-[260px] text-[12.5px] text-muted">{e.comments ?? "—"}</span> },
  ];
  const o = lista?.opciones;
  return (
    <div className="grid gap-5">
      <PageHeader description={`A las ${lista?.reglas.horas ?? 2} h de entregado cada pedido se le envía una encuesta por su chat: dentro de la ventana como mensaje, y fuera de ella como plantilla de utilidad si el pedido no usó sus ${lista?.reglas.tope ?? 2} plantillas. Si el cliente no recibió lo que pidió queda una tarea; si compró algo que no está en la web, además una alerta de control.`} />
      {error && <Alert tone="bad">{error}</Alert>}
      {c && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Cifra titulo="Enviadas" valor={numero(c.salieron)} icono={Send} destacada detalle={`${numero(c.no_enviadas)} no salieron`} />
          <Cifra titulo="Respondidas" valor={numero(c.respondidas)} icono={MessageSquareHeart} detalle={c.salieron ? porcentaje((c.respondidas / c.salieron) * 100) : "—"} />
          <Cifra titulo="Atención" valor={`${nota(c.atencion)} / 5`} icono={ThumbsUp} tono={c.atencion === null ? undefined : c.atencion < 4 ? "warn" : "ok"} />
          <Cifra titulo="Producto" valor={`${nota(c.producto)} / 5`} icono={Star} tono={c.producto === null ? undefined : c.producto < 4 ? "warn" : "ok"} />
          <button type="button" className="text-left" onClick={() => setF({ ...f, senal: "NO_RECIBIO" })}><Cifra titulo="No recibió lo pedido" valor={numero(c.no_recibio)} icono={PackageX} tono={c.no_recibio ? "warn" : undefined} detalle="Clic para verlas" /></button>
          <button type="button" className="text-left" onClick={() => setF({ ...f, senal: "FUERA_WEB" })}><Cifra titulo="Compró fuera de la web" valor={numero(c.fuera_web)} icono={ShoppingBag} tono={c.fuera_web ? "bad" : undefined} detalle="Clic para verlas" /></button>
        </div>
      )}
      {lista && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Barras titulo="Atención por vendedora" filas={lista.por_vendedora} />
          <Barras titulo="Atención por marca" filas={lista.por_marca} />
        </div>
      )}
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={setAbierta} empty="Ninguna encuesta con estos filtros." search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar pedido, cliente, celular o comentario…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Señal" todos="todas" ancho={220} value={f.senal} onChange={(v) => setF({ ...f, senal: v })} options={o?.senales ?? []} />
          <FiltroSelect etiqueta="Envío" ancho={190} value={f.envio} onChange={(v) => setF({ ...f, envio: v })} options={o?.envios ?? []} />
          <FiltroSelect etiqueta="Marca" todos="todas" ancho={170} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={o?.marcas ?? []} />
          <FiltroSelect etiqueta="Vendedora" todos="todas" ancho={190} value={f.vendedora} onChange={(v) => setF({ ...f, vendedora: v })} options={o?.vendedoras ?? []} />
          <FiltroFecha etiqueta="Desde" visible value={f.desde} max={f.hasta || undefined} onChange={(v) => setF({ ...f, desde: v })} />
          <FiltroFecha etiqueta="Hasta" visible value={f.hasta} min={f.desde || undefined} onChange={(v) => setF({ ...f, hasta: v })} />
        </>} />
      {abierta && lista && <FichaEncuesta e={abierta} puede={lista.puede.responder} onClose={() => setAbierta(null)} onListo={() => { setAbierta(null); cargar(); }} />}
    </div>
  );
}

function FichaEncuesta({ e, puede, onClose, onListo }: { e: Encuesta; puede: boolean; onClose: () => void; onListo: () => void }) {
  const [d, setD] = useState({ rating_service: "5", rating_product: "5", received_as_ordered: true, bought_outside_catalog: false, comments: "" });
  const [enviando, setEnviando] = useState(false);
  const notas = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }));
  const responde = puede && !e.answered_at && e.send_mode !== "NOT_SENT";
  async function guardar() {
    setEnviando(true);
    try {
      await api(`/v1/crm/encuestas/${e.id}/respuesta`, { method: "POST", body: { ...d, rating_service: Number(d.rating_service), rating_product: Number(d.rating_product), comments: d.comments || null } });
      toast.ok(d.received_as_ordered && !d.bought_outside_catalog ? "Respuesta registrada" : "Respuesta registrada: quedó la tarea de seguimiento");
      onListo();
    } catch (x) {
      toast.error(mensajeDe(x));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Modal open onClose={onClose} size="lg" title={`Encuesta del pedido ${e.pedido}`} description={`${e.cliente} · ${e.marca ?? ""}`}
      footer={responde ? <><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={enviando} onClick={guardar}>Registrar respuesta</Button></> : undefined}>
      <div className="grid gap-4">
        <DetailList items={[
          { label: "Señal", value: <Senal e={e} /> }, { label: "Envío", value: `${e.envio} · ${fechaHora(e.sent_at)}` },
          { label: "Respondida", value: e.answered_at ? fechaHora(e.answered_at) : "—" }, { label: "Vendedora", value: e.vendedora ?? "—" },
          { label: "Atención", value: e.rating_service ?? "—" }, { label: "Producto", value: e.rating_product ?? "—" },
          { label: "¿Recibió lo que pidió?", value: e.received_as_ordered === null ? "—" : e.received_as_ordered ? "Sí" : "No" },
          { label: "¿Compró algo fuera de la web?", value: e.bought_outside_catalog === null ? "—" : e.bought_outside_catalog ? "Sí" : "No" },
          { label: "Comentario", value: e.comments ?? "—" },
        ]} />
        {e.conversation_id && <Link href={`/m/crm/crm-02?id=${e.conversation_id}`} className="inline-flex w-fit items-center rounded-lg border border-line px-3 py-2 text-[13px] font-semibold text-primary hover:bg-surface-2">Abrir el chat</Link>}
        {e.send_mode === "NOT_SENT" && <Alert tone="info">No se envió: el pedido no tenía chat, o estaba fuera de la ventana y ya había usado sus plantillas de utilidad.</Alert>}
        {responde && (
          <div className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
            <p className="text-[13px] font-semibold text-ink sm:col-span-2">Lo que respondió el cliente en el chat</p>
            <Field label="Atención (1 a 5)" required><Select value={d.rating_service} onChange={(x) => setD({ ...d, rating_service: x.target.value })} options={notas} /></Field>
            <Field label="Producto (1 a 5)" required><Select value={d.rating_product} onChange={(x) => setD({ ...d, rating_product: x.target.value })} options={notas} /></Field>
            <Checkbox label="Recibió lo que pidió" checked={d.received_as_ordered} onChange={(v) => setD({ ...d, received_as_ordered: v })} />
            <Checkbox label="Compró algo que no está en la web" checked={d.bought_outside_catalog} onChange={(v) => setD({ ...d, bought_outside_catalog: v })} />
            <Field label="Comentario" className="sm:col-span-2"><Textarea rows={3} maxLength={1000} value={d.comments} onChange={(x) => setD({ ...d, comments: x.target.value })} /></Field>
            <p className="text-[11.5px] text-muted sm:col-span-2">La respuesta queda guardada y no se cambia.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
