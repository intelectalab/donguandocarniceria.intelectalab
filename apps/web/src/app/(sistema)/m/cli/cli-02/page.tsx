"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, FileCheck, Link2, MapPin, Pencil, ShoppingBag, Wallet } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, DetailList, PageHeader, StatusBadge, Tabs, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { BuscarCliente } from "@/modulos/cli/BuscarCliente";
import { ClienteForm } from "@/modulos/cli/ClienteForm";
import { TablaDirecciones } from "@/modulos/cli/TablaDirecciones";
import { CANALES, ESTADOS_CLIENTE, TIPOS_CLIENTE, celular, etiqueta, type FichaCliente } from "@/modulos/cli/tipos";

type Pestana = "pedidos" | "comprobantes" | "direcciones" | "cobrar";
type Pedido = { id: string; number: string; created_at: string; channel: string; status: string; brand_name: string | null; total: number; paid_amount: number | null };
type Comprobante = { id: string; full_number: string; doc_type: string; issue_date: string; brand_name: string | null; total: number; balance: number; due_date: string | null; sunat_status: string | null };

/** CLI-02 Ficha del cliente: datos, documento, consentimiento, saldo, cuentas por cobrar, pedidos por marca y canal, direcciones y alertas. ?id= el cliente. */
export default function FichaDelCliente({ searchParams }: PageProps<"/m/cli/cli-02">) {
  const params = use(searchParams);
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const { can } = useSesion();
  const [ficha, setFicha] = useState<{ id: string; datos: FichaCliente } | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [pestana, setPestana] = useState<Pestana>("pedidos");
  const [editando, setEditando] = useState(false);

  useEffect(() => {
    if (!id) return;
    let vigente = true;
    api<FichaCliente>(`/v1/cli/clientes/${id}`)
      .then((f) => { if (vigente) { setFicha({ id, datos: f }); setError(""); } })
      .catch((e) => vigente && setError(mensajeDe(e)));
    return () => { vigente = false; };
  }, [id, version]);

  const recargar = () => setVersion((n) => n + 1);
  const c = ficha?.id === id ? ficha.datos : null;
  const fusionado = Boolean(c?.merged_into_id);
  const puedeEditar = can("cli.customer.manage") && !fusionado;

  async function bloquear() {
    if (!c) return;
    if (c.status === "BLOCKED") {
      const r = await confirmAction({ title: `¿Desbloquear a ${c.nombre}?`, message: `Bloqueado por: ${c.blocked_reason}.`, confirmLabel: "Desbloquear", reason: { label: "Nota", optional: true } });
      if (!r) return;
      await enviar(`/v1/cli/clientes/${c.id}/desbloquear`, { nota: r.reason || null }, "Cliente desbloqueado");
    } else {
      const r = await confirmAction({ title: `¿Bloquear a ${c.nombre}?`, message: "No se le confirman pedidos nuevos hasta desbloquearlo (RN-CLI-09).",
        confirmLabel: "Bloquear", danger: true, reason: { label: "Motivo (fraude, deuda, maltrato…)", min: 5 } });
      if (!r) return;
      await enviar(`/v1/cli/clientes/${c.id}/bloquear`, { motivo: r.reason }, "Cliente bloqueado");
    }
  }

  async function consentimiento() {
    if (!c) return;
    const acepta = !c.marketing_opt_in;
    const r = await confirmAction({ title: acepta ? "Registrar que acepta promociones" : "Registrar que no quiere promociones",
      message: "Queda la constancia con fecha y usuario (Ley 29733).", confirmLabel: "Registrar", reason: { label: "Constancia (qué dijo y por dónde)", optional: true } });
    if (!r) return;
    await enviar(`/v1/cli/clientes/${c.id}/consentimiento`, { acepta, canal: "WHATSAPP", evidencia: r.reason || null }, "Consentimiento registrado");
  }

  async function enviar(ruta: string, body: object, ok: string) {
    try {
      await api(ruta, { method: "POST", body });
      toast.ok(ok);
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  if (!id) {
    return (
      <div className="space-y-5">
        <PageHeader description="Elige un cliente para ver su ficha." />
        <BuscarCliente onElegir={(x) => router.push(`/m/cli/cli-02?id=${x}`)} placeholder="Celular, nombre o documento del cliente…" />
        <p className="text-[13px] text-muted">También puedes abrirlo desde la <Link href="/m/cli/cli-01" className="font-medium text-primary hover:underline">lista de clientes</Link>.</p>
      </div>
    );
  }
  if (error) return <Alert tone="bad" title="No se pudo abrir el cliente">{error}</Alert>;
  if (!c) return <p className="text-[13px] text-muted">Cargando…</p>;

  const cobrar = c.cifras.por_cobrar;
  return (
    <div className="space-y-5">
      <PageHeader description={<>
        <span className="font-semibold text-ink">{c.nombre}</span> · {celular(c.phone)}
      </>}
        actions={<>
          <BuscarCliente onElegir={(x) => router.push(`/m/cli/cli-02?id=${x}`)} />
          {puedeEditar && <Button variant="primary" icon={Pencil} onClick={() => setEditando(true)}>Editar</Button>}
        </>} />

      <div className="flex flex-wrap gap-2">
        {!fusionado && <Button size="sm" icon={FileCheck} onClick={() => router.push(`/m/cli/cli-04?id=${c.id}`)}>Validar documento</Button>}
        {puedeEditar && <Button size="sm" icon={MapPin} onClick={() => router.push(`/m/cli/cli-06?cliente=${c.id}`)}>Nueva dirección</Button>}
        {puedeEditar && <Button size="sm" icon={Link2} onClick={() => router.push(`/m/cli/cli-07?cliente=${c.id}`)}>Enviar enlace de ubicación</Button>}
        {can("cli.customer.block") && !fusionado && (
          <Button size="sm" variant={c.status === "BLOCKED" ? "secondary" : "danger"} icon={Ban} onClick={bloquear}>{c.status === "BLOCKED" ? "Desbloquear" : "Bloquear"}</Button>
        )}
      </div>

      {fusionado && c.fusionado_en && (
        <Alert tone="info" title="Cliente fusionado">
          Se fusionó en <Link className="font-medium underline" href={`/m/cli/cli-02?id=${c.fusionado_en.id}`}>{c.fusionado_en.trade_name || c.fusionado_en.full_name}</Link> el {fechaHora(c.merged_at)}. No puede volver a activarse (RN-CLI-08).
        </Alert>
      )}
      {c.status === "BLOCKED" && <Alert tone="bad" title="Bloqueado">{c.blocked_reason}. No se le confirman pedidos nuevos (RN-CLI-09). Bloqueó {c.blocked_by ?? "—"} el {fechaHora(c.blocked_at)}.</Alert>}
      {c.duplicados.length > 0 && (
        <Alert tone="warn" title="Posible duplicado">
          {c.duplicados.map((d, i) => (
            <span key={d.id}>{i > 0 && " · "}{d.motivo} con <Link className="font-medium underline" href={`/m/cli/cli-11?a=${d.otro_id}&b=${c.id}`}>{d.otro_nombre}</Link></span>
          ))}. Revísalo en <Link className="underline" href="/m/cli/cli-10">Duplicados</Link> o fusiónalos.
        </Alert>
      )}
      {!fusionado && c.direcciones.length === 0 && (
        <Alert tone="warn" title="Sin dirección con pin">El primer delivery exige pin y referencia (RN-CLI-02). Envíale el enlace de ubicación para que la marque desde su celular.</Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Pedidos" icono={ShoppingBag} destacada valor={numero(c.cifras.pedidos)} detalle={`${numero(c.cifras.entregados)} entregados`} />
        <Cifra titulo="Compras entregadas" icono={ShoppingBag} valor={soles(c.cifras.compras)} detalle={c.cifras.ticket ? `Ticket ${soles(c.cifras.ticket)}` : ""} />
        <Cifra titulo="Saldo a favor" icono={Wallet} valor={soles(c.cifras.saldo)} tono={c.cifras.saldo > 0 ? "ok" : undefined} detalle="Para su próxima compra" />
        <Cifra titulo="Por cobrar" icono={Wallet} valor={soles(cobrar.total)} tono={cobrar.total > 0 ? "warn" : undefined}
          detalle={`${cobrar.comprobantes.length} comprobante(s) · ${cobrar.pedidos.length} pedido(s)`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="mb-3 text-[14px] font-semibold">Datos del cliente</h2>
          <DetailList items={[
            { label: "Nombre o razón social", value: c.full_name },
            ...(c.trade_name ? [{ label: "Nombre comercial", value: c.trade_name }] : []),
            { label: "Tipo", value: etiqueta(TIPOS_CLIENTE, c.customer_type) },
            {
              label: "Documento", value: c.doc_type === "NONE" || !c.doc_number ? "Sin documento" : (
                <span className="flex flex-wrap items-center gap-1.5"><span className="font-mono">{c.doc_type} {c.doc_number}</span>
                  {c.doc_validated_at ? <Badge tone="ok">{c.doc_validation_source}</Badge> : <Badge tone="warn">Sin validar</Badge>}</span>
              ),
            },
            { label: "Validado", value: c.doc_validated_at ? `${fechaHora(c.doc_validated_at)}${c.doc_validation_state ? ` · ${c.doc_validation_state}` : ""}` : "No" },
            ...(c.fiscal_address ? [{ label: "Dirección fiscal", value: c.fiscal_address }] : []),
            { label: "Celular", value: <span className="font-mono">{celular(c.phone)}</span> },
            { label: "Celular alterno", value: <span className="font-mono">{celular(c.phone_alt)}</span> },
            { label: "Correo", value: c.email },
            { label: "Vendedora asignada", value: c.vendedora },
            { label: "Canal de origen", value: etiqueta(CANALES, c.source_channel) + (c.origin_wa_number ? ` · ${c.origin_wa_number}` : "") },
            { label: "Cliente desde", value: fecha(c.first_order_at ?? c.created_at) },
            { label: "Estado", value: fusionado ? <Badge>Fusionado</Badge> : <StatusBadge status={c.status} labels={ESTADOS_CLIENTE} /> },
          ]} />
          {c.notes && <p className="mt-3 text-[12.5px] whitespace-pre-line text-muted">{c.notes}</p>}
        </section>

        <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-[14px] font-semibold">Publicidad (Ley 29733)</h2>
              <div className="mt-1 flex items-center gap-2">
                {c.marketing_opt_in ? <Badge tone="ok">Acepta campañas</Badge> : <Badge>No recibe campañas</Badge>}
                <span className="text-[12px] text-muted">{c.marketing_opt_in_at ? `Registrado ${fechaHora(c.marketing_opt_in_at)}` : "Sin registro de fecha"}</span>
              </div>
            </div>
            {puedeEditar && <Button size="sm" onClick={consentimiento}>{c.marketing_opt_in ? "Registrar baja" : "Registrar alta"}</Button>}
          </div>
          <p className="mb-3 text-[12.5px] text-muted">Sin consentimiento no recibe campañas; el aviso y la confirmación de su pedido sí se envían (RN-CLI-13).</p>
          {c.consentimientos.length > 0 && (
            <ol className="space-y-2 border-l border-line pl-3">
              {c.consentimientos.map((x) => (
                <li key={x.id} className="text-[13px]">
                  <div className="text-[12px] text-muted">{fechaHora(x.recorded_at)} · {etiqueta(CANALES, x.channel)}{x.recorded_by ? ` · ${x.recorded_by}` : ""}</div>
                  <div>{x.granted ? "Alta" : "Baja"} · {x.evidence_text}</div>
                </li>
              ))}
            </ol>
          )}
          <h3 className="mt-4 mb-2 text-[13px] font-semibold">Pedidos por marca y canal</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Barras filas={c.por_marca.map((m) => ({ k: m.nombre, n: m.n }))} />
            <Barras filas={c.por_canal.map((m) => ({ k: etiqueta(CANALES, m.canal), n: m.n }))} />
          </div>
        </section>
      </div>

      <Tabs value={pestana} onChange={setPestana} tabs={[
        { key: "pedidos", label: "Pedidos", count: c.cifras.pedidos },
        { key: "comprobantes", label: "Comprobantes" },
        { key: "direcciones", label: "Direcciones", count: c.direcciones.length },
        { key: "cobrar", label: "Por cobrar", count: cobrar.comprobantes.length + cobrar.pedidos.length },
      ]} />
      {pestana === "pedidos" && <Pedidos id={c.id} />}
      {pestana === "comprobantes" && <Comprobantes id={c.id} />}
      {pestana === "direcciones" && <TablaDirecciones direcciones={c.direcciones} puedeEditar={puedeEditar} onCambio={recargar} />}
      {pestana === "cobrar" && (
        <DataTable rowKey={(r) => r.k} rows={[
          ...cobrar.comprobantes.map((d) => ({ k: d.full_number, fecha: d.issue_date, vence: d.due_date, saldo: d.balance })),
          ...cobrar.pedidos.map((o) => ({ k: `Pedido ${o.number}`, fecha: o.delivery_date, vence: null, saldo: o.saldo })),
        ]} empty="Sin cuentas por cobrar." columns={[
          { key: "k", header: "Documento", cardTitle: true },
          { key: "fecha", header: "Fecha", render: (r) => fecha(r.fecha) },
          { key: "vence", header: "Vence", render: (r) => fecha(r.vence) },
          { key: "saldo", header: "Saldo", align: "right", render: (r) => soles(r.saldo) },
        ]} />
      )}

      {editando && <ClienteForm cliente={c} onClose={() => setEditando(false)} onGuardado={() => { setEditando(false); recargar(); }} />}
    </div>
  );
}

function Pedidos({ id }: { id: string }) {
  const lista = useListado<Pedido>(`/v1/cli/clientes/${id}/pedidos`, { orden: "-created_at", porPagina: 10 });
  const columnas: Column<Pedido>[] = [
    { key: "number", header: "Pedido", sortable: true, cardTitle: true, render: (o) => <span className="font-mono">{o.number}</span> },
    { key: "created_at", header: "Fecha", sortable: true, render: (o) => fecha(o.created_at) },
    { key: "brand_name", header: "Marca", render: (o) => o.brand_name ?? "—" },
    { key: "channel", header: "Canal", hideOnMobile: true, render: (o) => etiqueta(CANALES, o.channel) },
    { key: "total", header: "Total", align: "right", sortable: true, render: (o) => soles(o.total) },
    { key: "paid_amount", header: "Pagado", align: "right", hideOnMobile: true, render: (o) => soles(o.paid_amount ?? 0) },
    { key: "status", header: "Estado", sortable: true, render: (o) => <StatusBadge status={o.status} /> },
  ];
  return <DataTable {...lista.tabla} columns={columnas} search={{ ...lista.tabla.search, placeholder: "Número de pedido…" }} empty="Sin pedidos." />;
}

function Comprobantes({ id }: { id: string }) {
  const lista = useListado<Comprobante>(`/v1/cli/clientes/${id}/comprobantes`, { orden: "-issue_date", porPagina: 10 });
  const columnas: Column<Comprobante>[] = [
    { key: "full_number", header: "Comprobante", cardTitle: true, render: (d) => <span className="font-mono">{d.full_number}</span> },
    { key: "issue_date", header: "Fecha", sortable: true, render: (d) => fecha(d.issue_date) },
    { key: "brand_name", header: "Marca", hideOnMobile: true, render: (d) => d.brand_name ?? "—" },
    { key: "total", header: "Total", align: "right", sortable: true, render: (d) => soles(d.total) },
    { key: "balance", header: "Saldo", align: "right", sortable: true, render: (d) => d.balance > 0 ? <Badge tone="warn">{soles(d.balance)}</Badge> : soles(0) },
    { key: "due_date", header: "Vence", hideOnMobile: true, render: (d) => fecha(d.due_date) },
    { key: "sunat_status", header: "SUNAT", hideOnMobile: true, render: (d) => <StatusBadge status={d.sunat_status} /> },
  ];
  return <DataTable {...lista.tabla} columns={columnas} search={{ ...lista.tabla.search, placeholder: "Número de comprobante…" }} empty="Sin comprobantes." />;
}

/** Barras horizontales simples (pedidos por marca o canal). */
function Barras({ filas }: { filas: { k: string; n: number }[] }) {
  if (!filas.length) return <p className="text-[12.5px] text-muted">Sin pedidos.</p>;
  const max = Math.max(...filas.map((f) => f.n));
  return (
    <ul className="space-y-1.5">
      {filas.map((f) => (
        <li key={f.k} className="text-[12.5px]">
          <div className="flex justify-between gap-2"><span className="truncate">{f.k}</span><span className="tabular-nums text-muted">{numero(f.n)}</span></div>
          <div className="mt-0.5 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${(f.n / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
