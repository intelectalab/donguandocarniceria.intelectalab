"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, BadgeCheck, MessagesSquare, ReceiptText, ShoppingBag, Wallet } from "lucide-react";
import { Alert, Badge, Cifra, DataTable, DetailList, FiltroSelect, MapView, PageHeader, StatusBadge, Tabs, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, soles } from "@/lib/formato";
import { useOrdenLocal, usePagina, usePaginaLocal, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { sinTildes } from "@/modulos/mae/tipos";
import { BotonLlamar, segundos } from "@/modulos/tel/BotonLlamar";

type Fila = { id: string; nombre: string; full_name: string; phone: string | null; tipo: string; pedidos: number; ultimo: string | null; chats: number };
type Pedido = { id: string; number: string; status: string; canal: string; marca: string; at: string; total: number; pagado: number; vendedora: string | null };
type Chat = { id: string; status: string; status_name: string; opened_at: string; canal: string; entrada: string; atendio: string | null; visible: boolean };
type Ficha = {
  id: string; nombre: string; full_name: string; trade_name: string | null; phone: string | null; phone_alt: string | null; email: string | null; documento: string | null; tipo: string;
  canal_origen: string | null; creado: string; bloqueado: string | null;
  cifras: { pedidos: number; valor_vida: number; por_cobrar: number; saldo_favor: number; chats: number; marketing: boolean | null };
  direcciones: { id: string; label: string | null; address_line: string; district: string | null; reference: string | null; lat: number | null; lng: number | null; is_default: boolean }[];
  pedidos: Pedido[]; chats: Chat[];
  encuestas: { id: string; number: string | null; sent_at: string; answered_at: string | null; rating_service: number | null; rating_product: number | null; received_as_ordered: boolean | null; bought_outside_catalog: boolean | null; comments: string | null }[];
  consentimientos: { id: string; purpose_name: string; granted: boolean; channel: string; evidence_text: string; recorded_at: string; recorded_by: string | null }[];
  recompra: { id: string; marca: string; orders_count: number; median_interval_days: number | null; last_order_at: string | null; next_expected_at: string | null; status: string; status_name: string }[];
  llamadas: { id: string; direccion: string; status: string; estado: string; at: string; duracion: number; espera: number; vendedora: string | null; pedido: string | null }[] | null;
};

const PEDIDO: Record<string, [string, Tone]> = { DRAFT: ["Borrador", "neutral"], CONFIRMED: ["Confirmado", "info"], IN_PREPARATION: ["En preparación", "info"], WEIGHED: ["Pesado", "info"],
  READY: ["Listo", "info"], DISPATCHED: ["En camino", "info"], DELIVERED: ["Entregado", "ok"], CLOSED: ["Cerrado", "ok"], CANCELLED: ["Anulado", "bad"], NOT_DELIVERED: ["No entregado", "bad"] };
const RECOMPRA: Record<string, Tone> = { NEW: "neutral", ACTIVE: "ok", DUE: "info", AT_RISK: "warn", LOST: "bad" };

/** CRM-04 Ficha 360 del cliente: todo el cliente en un lugar. Sin ?id=, la lista para elegirlo. */
function Ficha360() {
  const id = useSearchParams().get("id");
  const { can } = useSesion();
  if (!can("crm.customer.view_full")) return <Alert tone="warn">Tu rol no ve la ficha 360 de los clientes.</Alert>;
  return id ? <Detalle id={id} /> : <Lista />;
}

function Lista() {
  const router = useRouter();
  const [f, setF] = useState({ buscar: "", tipo: "", con_chat: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<(Pagina<Fila> & { tipos: { value: string; label: string }[] }) | null>(null);
  const [error, setError] = useState("");
  const pag = usePagina(JSON.stringify(f));
  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Pagina<Fila> & { tipos: { value: string; label: string }[] }>(`/v1/crm/clientes?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs]);
  useEffect(() => cargar(), [cargar]);
  const columnas: Column<Fila>[] = [
    { key: "nombre", sortable: true, header: "Cliente", cardTitle: true, render: (c) => <div><p className="font-semibold text-ink">{c.nombre}</p>{c.nombre !== c.full_name && <p className="text-[12px] text-muted">{c.full_name}</p>}</div> },
    { key: "phone", header: "Celular", render: (c) => <span className="font-mono text-[12.5px]">{c.phone ?? "—"}</span> },
    { key: "tipo", header: "Tipo", hideOnMobile: true, render: (c) => c.tipo },
    { key: "pedidos", sortable: true, header: "Pedidos", align: "right", render: (c) => numero(c.pedidos) },
    { key: "ultimo", sortable: true, header: "Último pedido", render: (c) => fecha(c.ultimo) },
    { key: "chats", header: "Chats", align: "right", render: (c) => (c.chats ? numero(c.chats) : <span className="text-muted">—</span>) },
  ];
  return (
    <div className="grid gap-5">
      <PageHeader description="Todo el cliente en un lugar: datos, direcciones con pin, pedidos y saldos, chats de todas las redes, encuestas, consentimientos y recompra. La vendedora ve los clientes de los chats de sus números." />
      <DataTable {...pag.orden} rowKey={(c) => c.id} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={(c) => router.push(`/m/crm/crm-04?id=${c.id}`)} empty="Ningún cliente con estos filtros."
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar nombre, celular o documento…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Tipo" ancho={200} value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} options={lista?.tipos ?? []} />
          <FiltroSelect etiqueta="Chats" ancho={170} value={f.con_chat} onChange={(v) => setF({ ...f, con_chat: v })} options={[{ value: "1", label: "Con chats" }]} />
        </>} />
    </div>
  );
}

function Detalle({ id }: { id: string }) {
  const [c, setC] = useState<Ficha | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"datos" | "pedidos" | "chats" | "llamadas" | "encuestas" | "consentimientos" | "recompra">("datos");
  useEffect(() => {
    let vivo = true;
    api<Ficha>(`/v1/crm/clientes/${id}`).then((r) => vivo && setC(r)).catch((e) => vivo && setError(mensajeDe(e)));
    return () => { vivo = false; };
  }, [id]);
  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!c) return <p className="text-[13px] text-muted">Cargando…</p>;
  const k = c.cifras;
  return (
    <div className="grid gap-5">
      <PageHeader description={`${c.tipo}${c.documento ? ` · ${c.documento}` : ""}${c.phone ? ` · ${c.phone}` : ""}. Cliente desde el ${fecha(c.creado)}.`}
        actions={<div className="flex flex-wrap gap-2"><BotonLlamar ref_={{ customer_id: c.id }} size="md" /><Link href="/m/crm/crm-04" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] font-semibold text-ink hover:bg-surface-2"><ArrowLeft className="size-4" />Clientes</Link></div>} />
      <h2 className="-mt-2 text-[20px] font-semibold text-ink">{c.nombre}</h2>
      {c.bloqueado && <Alert tone="bad">Cliente bloqueado: {c.bloqueado}</Alert>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Cifra titulo="Pedidos" valor={numero(k.pedidos)} icono={ShoppingBag} destacada detalle="Sin borradores ni anulados" />
        <Cifra titulo="Valor de vida" valor={soles(k.valor_vida)} icono={ReceiptText} detalle="Lo cobrado al cliente" />
        <Cifra titulo={k.por_cobrar > 0 ? "Por cobrar" : "Saldo a favor"} valor={soles(k.por_cobrar > 0 ? k.por_cobrar : k.saldo_favor)} icono={Wallet} tono={k.por_cobrar > 0 ? "warn" : undefined} detalle={k.por_cobrar > 0 ? "Comprobantes y pedidos sin pagar" : "Para su próximo pedido"} />
        <Cifra titulo="Chats" valor={numero(k.chats)} icono={MessagesSquare} detalle="De todos los números y redes" />
        <Cifra titulo="Marketing" valor={k.marketing === true ? "Otorgado" : k.marketing === false ? "Dio de baja" : "Sin registro"} icono={BadgeCheck} tono={k.marketing === true ? "ok" : undefined} detalle="Último consentimiento" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: "datos" as const, label: "Datos y direcciones" }, { key: "pedidos" as const, label: "Pedidos", count: c.pedidos.length }, { key: "chats" as const, label: "Chats", count: c.chats.length },
        { key: "llamadas" as const, label: "Llamadas", count: c.llamadas?.length }, { key: "encuestas" as const, label: "Encuestas", count: c.encuestas.length },
        { key: "consentimientos" as const, label: "Consentimientos", count: c.consentimientos.length }, { key: "recompra" as const, label: "Recompra", count: c.recompra.length },
      ]} />
      {tab === "datos" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
            <DetailList items={[
              { label: "Nombre", value: c.full_name }, { label: "Nombre comercial", value: c.trade_name ?? "—" }, { label: "Documento", value: c.documento ?? "Sin documento" },
              { label: "Celular", value: c.phone ?? "—" }, { label: "Otro celular", value: c.phone_alt ?? "—" }, { label: "Correo", value: c.email ?? "—" },
              { label: "Canal de origen", value: c.canal_origen ?? "—" }, { label: "Tipo", value: c.tipo },
            ]} />
          </section>
          <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
            <h3 className="text-[14px] font-semibold text-ink">Direcciones</h3>
            {c.direcciones.length === 0 && <p className="text-[13px] text-muted">Sin direcciones guardadas.</p>}
            {c.direcciones.map((a) => (
              <p key={a.id} className="text-[12.5px]"><b>{a.label ?? "Dirección"}{a.is_default ? " (principal)" : ""}:</b> {a.address_line}{a.district ? `, ${a.district}` : ""} · {a.reference ?? "sin referencia"} {a.lat === null && <Badge tone="warn">Sin pin</Badge>}</p>
            ))}
            {c.direcciones.some((a) => a.lat !== null) && <MapView height={240} points={c.direcciones.filter((a) => a.lat !== null && a.lng !== null).map((a) => ({ id: a.id, lat: a.lat as number, lng: a.lng as number, label: a.label ?? "Dir.", title: a.address_line }))} />}
          </section>
        </div>
      )}
      {tab === "pedidos" && <TablaLocal filas={c.pedidos} texto={(o) => `${o.number} ${o.marca} ${o.vendedora ?? ""}`} placeholder="Buscar pedido, marca o vendedora…" vacio="Sin pedidos."
        columnas={[
          { key: "number", sortable: true, header: "Pedido", cardTitle: true, render: (o) => <Link href={`/m/ped/ped-02?id=${o.id}`} className="font-mono font-semibold text-primary hover:underline">{o.number}</Link> },
          { key: "marca", sortable: true, header: "Marca", render: (o) => <span className="text-[12.5px]">{o.marca}</span> },
          { key: "canal", header: "Canal", hideOnMobile: true, render: (o) => <span className="text-[12.5px]">{o.canal}</span> },
          { key: "at", sortable: true, header: "Fecha", render: (o) => fecha(o.at) },
          { key: "status", sortable: true, header: "Estado", render: (o) => <StatusBadge status={o.status} labels={PEDIDO} /> },
          { key: "total", sortable: true, header: "Total", align: "right", render: (o) => soles(o.total) },
          { key: "pagado", sortable: true, header: "Pagado", align: "right", hideOnMobile: true, render: (o) => soles(o.pagado) },
          { key: "vendedora", header: "Vendedora", hideOnMobile: true, render: (o) => <span className="text-[12.5px]">{o.vendedora ?? "—"}</span> },
        ]} orden={{ number: (o) => o.number, marca: (o) => o.marca, at: (o) => o.at, status: (o) => o.status, total: (o) => o.total, pagado: (o) => o.pagado }} />}
      {tab === "chats" && <TablaLocal filas={c.chats} texto={(x) => `${x.canal} ${x.entrada} ${x.atendio ?? ""}`} placeholder="Buscar número, entrada o vendedora…" vacio="Sin chats."
        columnas={[
          { key: "canal", header: "Número o cuenta", cardTitle: true, render: (x) => (x.visible ? <Link href={`/m/crm/crm-02?id=${x.id}`} className="font-semibold text-primary hover:underline">{x.canal}</Link> : <span>{x.canal}</span>) },
          { key: "opened_at", sortable: true, header: "Abierta", render: (x) => fechaHora(x.opened_at) },
          { key: "status", header: "Estado", render: (x) => <Badge tone={x.status === "CLOSED" ? "neutral" : "info"}>{x.status_name}</Badge> },
          { key: "atendio", header: "Atendió", render: (x) => <span className="text-[12.5px]">{x.atendio ?? "En cola"}</span> },
          { key: "entrada", header: "Entrada", hideOnMobile: true, render: (x) => <span className="text-[12.5px]">{x.entrada}</span> },
        ]} orden={{ opened_at: (x) => x.opened_at }} />}
      {tab === "llamadas" && (c.llamadas === null
        ? <Alert tone="info">La telefonía está apagada en esta empresa. Cuando se active, aquí aparecen las llamadas con su grabación y transcripción.</Alert>
        : <TablaLocal filas={c.llamadas} texto={(x) => `${x.direccion} ${x.estado} ${x.vendedora ?? ""} ${x.pedido ?? ""}`} placeholder="Buscar estado, vendedora o pedido…" vacio="Sin llamadas registradas."
          columnas={[
            { key: "at", sortable: true, header: "Fecha", cardTitle: true, render: (x) => <span className="whitespace-nowrap">{fechaHora(x.at)}</span> },
            { key: "direccion", header: "Dirección", render: (x) => <span className="text-[12.5px]">{x.direccion}</span> },
            { key: "status", header: "Estado", render: (x) => <Badge tone={x.status === "COMPLETED" ? "ok" : ["MISSED", "NO_ANSWER", "VOICEMAIL", "FAILED"].includes(x.status) ? "bad" : "info"}>{x.estado}</Badge> },
            { key: "vendedora", header: "Vendedora", render: (x) => <span className="text-[12.5px]">{x.vendedora ?? "—"}</span> },
            { key: "duracion", sortable: true, header: "Duración", align: "right", render: (x) => segundos(x.duracion) },
            { key: "pedido", header: "Pedido", hideOnMobile: true, render: (x) => <span className="font-mono text-[12.5px]">{x.pedido ?? "—"}</span> },
          ]} orden={{ at: (x) => x.at, duracion: (x) => x.duracion }} />)}
      {tab === "encuestas" && <TablaLocal filas={c.encuestas} texto={(s) => `${s.number ?? ""} ${s.comments ?? ""}`} placeholder="Buscar pedido o comentario…" vacio="Sin encuestas."
        columnas={[
          { key: "number", header: "Pedido", cardTitle: true, render: (s) => <span className="font-mono">{s.number ?? "—"}</span> },
          { key: "sent_at", sortable: true, header: "Enviada", render: (s) => fechaHora(s.sent_at) },
          { key: "rating_service", header: "Atención", align: "right", render: (s) => s.rating_service ?? "—" },
          { key: "rating_product", header: "Producto", align: "right", render: (s) => s.rating_product ?? "—" },
          { key: "senal", header: "Señal", render: (s) => (s.bought_outside_catalog ? <Badge tone="bad">Compra fuera de la web</Badge> : s.received_as_ordered === false ? <Badge tone="warn">No recibió lo pedido</Badge> : <span className="text-muted">—</span>) },
          { key: "comments", header: "Comentario", hideOnMobile: true, render: (s) => <span className="text-[12.5px]">{s.comments ?? "—"}</span> },
        ]} orden={{ sent_at: (s) => s.sent_at }} />}
      {tab === "consentimientos" && <TablaLocal filas={c.consentimientos} texto={(k2) => `${k2.purpose_name} ${k2.evidence_text}`} placeholder="Buscar propósito o evidencia…" vacio="Sin registros."
        columnas={[
          { key: "recorded_at", sortable: true, header: "Fecha", render: (k2) => fechaHora(k2.recorded_at) },
          { key: "purpose_name", header: "Propósito", cardTitle: true, render: (k2) => k2.purpose_name },
          { key: "granted", header: "Estado", render: (k2) => (k2.granted ? <Badge tone="ok">Otorgado</Badge> : <Badge tone="bad">Baja</Badge>) },
          { key: "evidence_text", header: "Evidencia", render: (k2) => <span className="text-[12.5px]">{k2.evidence_text}</span> },
          { key: "recorded_by", header: "Registró", hideOnMobile: true, render: (k2) => <span className="text-[12.5px]">{k2.recorded_by ?? "—"}</span> },
        ]} orden={{ recorded_at: (k2) => k2.recorded_at }} />}
      {tab === "recompra" && <TablaLocal filas={c.recompra} texto={(p) => p.marca} placeholder="Buscar marca…" vacio="Sin perfil de recompra (hacen falta al menos 3 pedidos entregados de una marca)."
        columnas={[
          { key: "marca", header: "Marca", cardTitle: true, render: (p) => p.marca },
          { key: "orders_count", header: "Pedidos", align: "right", render: (p) => numero(p.orders_count) },
          { key: "median_interval_days", header: "Cada cuántos días", align: "right", render: (p) => (p.median_interval_days !== null ? numero(p.median_interval_days, 0) : "—") },
          { key: "last_order_at", header: "Último", render: (p) => fecha(p.last_order_at) },
          { key: "next_expected_at", header: "Esperado", render: (p) => fecha(p.next_expected_at) },
          { key: "status", header: "Estado", render: (p) => <Badge tone={RECOMPRA[p.status] ?? "neutral"}>{p.status_name}</Badge> },
        ]} orden={{}} />}
    </div>
  );
}

/** Tabla en el navegador con buscador, orden y páginas (las pestañas de la ficha). */
function TablaLocal<T extends { id: string }>({ filas, columnas, texto, placeholder, vacio, orden }: {
  filas: T[]; columnas: Column<T>[]; texto: (x: T) => string; placeholder: string; vacio: string; orden: Record<string, (x: T) => string | number | null>;
}) {
  const [buscar, setBuscar] = useState("");
  const visibles = useMemo(() => { const q = sinTildes(buscar.trim()); return filas.filter((x) => !q || sinTildes(texto(x)).includes(q)); }, [filas, buscar, texto]);
  const ord = useOrdenLocal(visibles, orden);
  const pagina = usePaginaLocal(ord.filas, `${buscar}|${ord.orden.sort}`);
  return <DataTable {...ord.orden} rowKey={(x) => x.id} columns={columnas} rows={pagina.filas} pagination={pagina.props} empty={vacio} search={{ value: buscar, onChange: setBuscar, placeholder }} />;
}

export default function Page() {
  return <Suspense><Ficha360 /></Suspense>;
}
