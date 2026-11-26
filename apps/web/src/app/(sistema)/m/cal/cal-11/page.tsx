"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Alert, Button, DataTable, DetailList, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { FiltroSelect, opcionesDe, opcionesEt, useAlAbrir, useDatos, useOpcionesCal } from "@/modulos/cal/comunes";
import { ESTADO_RECLAMO, RESOLUCION, TIPO_RECLAMO, type Opciones } from "@/modulos/cal/tipos";

type Fila = { id: string; number: string; claim_type: string; status: string; received_at: string; channel: string | null; resolution: string | null; resolved_at: string | null;
  description: string; customer_name: string; product_name: string; lot_code: string | null; order_number: string | null; nc_number: string | null };
type Detalle = Fila & { nonconformity_id: string | null; nc_status: string | null; document_number: string | null; credit_note_number: string | null; resolution_notes: string | null;
  resolved_by_name: string | null; photo_url: string | null; credit_notes: { id: string; full_number: string; issue_date: string; total: string }[] };

const CANAL: Record<string, string> = { WHATSAPP: "WhatsApp", PHONE: "Teléfono", STORE: "En tienda", WEB: "Web", EMAIL: "Correo" };

/** CAL-11 Reclamos de calidad: un reclamo por producto en mal estado, cuerpo extraño o temperatura con lote abre una no conformidad (RN-CAL-11); se resuelve con su compensación (RN-CAL-12). */
export default function Reclamos() {
  const { local, puede } = useSesion();
  const op = useOpcionesCal();
  const [estado, setEstado] = useState("");
  const [tipo, setTipo] = useState("");
  const lista = useListado<Fila>("/v1/cal/reclamos", { orden: "-received_at", filtros: { status: estado, claim_type: tipo, site: local } });
  const [ver, setVer] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  useAlAbrir((p) => setVer(p.get("id")));
  const columnas: Column<Fila>[] = [
    { key: "number", header: "Número", sortable: true, render: (c) => <span className="font-mono font-semibold whitespace-nowrap">{c.number}</span> },
    { key: "description", header: "Reclamo", cardTitle: true, render: (c) => <div className="min-w-[220px]"><p className="line-clamp-2">{c.description}</p>
      <p className="text-[12px] text-muted">{TIPO_RECLAMO[c.claim_type] ?? c.claim_type} · {c.product_name}{c.lot_code ? ` · lote ${c.lot_code}` : ""}</p></div> },
    { key: "customer_name", header: "Cliente", render: (c) => <div><p>{c.customer_name}</p>{c.order_number && <p className="text-[12px] text-muted">Pedido {c.order_number}</p>}</div> },
    { key: "received_at", header: "Recibido", sortable: true, render: (c) => fecha(c.received_at) },
    { key: "nc_number", header: "No conformidad", hideOnMobile: true, render: (c) => c.nc_number ?? "—" },
    { key: "resolution", header: "Resolución", hideOnMobile: true, render: (c) => (c.resolution ? RESOLUCION[c.resolution] : "—") },
    { key: "status", header: "Estado", render: (c) => <StatusBadge status={c.status} labels={ESTADO_RECLAMO} /> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Registra el reclamo con el cliente y el producto. Si es por mal estado, cuerpo extraño o temperatura y se conoce el lote, se abre una no conformidad al momento."
        actions={(op?.can.record || op?.can.claim) && puede("CAL", "C") && <Button variant="primary" icon={Plus} onClick={() => setNuevo(true)}>Nuevo reclamo</Button>} />
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(c) => setVer(c.id)} search={{ ...lista.tabla.search, placeholder: "Buscar número, cliente, producto, lote o pedido…" }}
        empty="No hay reclamos con estos filtros."
        toolbar={<><FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opcionesEt(ESTADO_RECLAMO)} /><FiltroSelect label="Tipo" value={tipo} onChange={setTipo} options={opcionesDe(TIPO_RECLAMO)} ancho="sm:w-[190px]" /></>} />
      {nuevo && op && <NuevoReclamo op={op} onClose={() => setNuevo(false)} onCreado={(id) => { setNuevo(false); lista.recargar(); setVer(id); }} />}
      {ver && op && <FichaReclamo id={ver} op={op} onClose={() => setVer(null)} onCambio={lista.recargar} />}
    </div>
  );
}

function NuevoReclamo({ op, onClose, onCreado }: { op: Opciones; onClose: () => void; onCreado: (id: string) => void }) {
  const [f, setF] = useState({ claim_type: "SPOILED", description: "", customer_id: "", lot_id: "", product_id: "", channel: "WHATSAPP", received_at: "", photo_url: "" });
  const lotes = useDatos<{ data: { id: string; code: string; product_name: string }[] }>("/v1/etq/lotes?per_page=200").datos?.data ?? [];
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const abreNC = ["SPOILED", "FOREIGN_BODY", "TEMPERATURE"].includes(f.claim_type) && !!f.lot_id;
  return (
    <Dialogo titulo="Nuevo reclamo" boton="Registrar" onClose={onClose} aviso={abreNC ? "Con este tipo y el lote indicado se abrirá una no conformidad mayor." : undefined}
      enviar={async () => {
        const r = await api<{ id: string; number: string }>("/v1/cal/reclamos", { method: "POST", body: { claim_type: f.claim_type, description: f.description, customer_id: f.customer_id || null,
          lot_id: f.lot_id || null, product_id: f.product_id || null, channel: f.channel || null, received_at: f.received_at || null, photo_url: f.photo_url || null } });
        toast.ok(`Reclamo ${r.number} registrado`); onCreado(r.id);
      }}>
      {(err) => <>
        <Field label="Cliente" required error={err.customer_id} className="sm:col-span-2"><Select value={f.customer_id} searchable placeholder="Buscar cliente"
          options={op.customers.map((c) => ({ value: c.id, label: c.doc_number ? `${c.name} · ${c.doc_number}` : c.phone ? `${c.name} · ${c.phone}` : c.name }))} onChange={(e) => set("customer_id", e.target.value)} /></Field>
        <Field label="Tipo" required error={err.claim_type}><Select value={f.claim_type} options={opcionesDe(TIPO_RECLAMO)} onChange={(e) => set("claim_type", e.target.value)} /></Field>
        <Field label="Canal" error={err.channel}><Select value={f.channel} options={opcionesDe(CANAL)} onChange={(e) => set("channel", e.target.value)} /></Field>
        <Field label="Lote" error={err.lot_id} hint="Si el cliente lo tiene en la etiqueta"><Select value={f.lot_id} searchable placeholder="Sin lote"
          options={lotes.map((l) => ({ value: l.id, label: `${l.code} · ${l.product_name}` }))}
          onChange={(e) => set("lot_id", e.target.value)} /></Field>
        <Field label="Producto" required={!f.lot_id} error={err.product_id} hint={f.lot_id ? "Vacío: el producto del lote" : undefined}><Select value={f.product_id} searchable placeholder="Elegir" options={op.products.map((p) => ({ value: p.id, label: p.name }))} onChange={(e) => set("product_id", e.target.value)} /></Field>
        <Field label="Qué pasó" required error={err.description} className="sm:col-span-2"><Textarea rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field label="Recibido" error={err.received_at} hint="Vacío: ahora"><Input type="datetime-local" value={f.received_at} onChange={(e) => set("received_at", e.target.value)} /></Field>
        <Field label="Foto" error={err.photo_url} hint="Ruta de la foto enviada por el cliente"><Input value={f.photo_url} onChange={(e) => set("photo_url", e.target.value)} /></Field>
      </>}
    </Dialogo>
  );
}

function FichaReclamo({ id, op, onClose, onCambio }: { id: string; op: Opciones; onClose: () => void; onCambio: () => void }) {
  const { datos: c, error, recargar } = useDatos<Detalle>(`/v1/cal/reclamos/${id}`);
  const [f, setF] = useState({ status: "RESOLVED", resolution: "", credit_note_id: "", resolution_notes: "" });
  const [enviando, setEnviando] = useState(false);
  const cerrado = c && ["RESOLVED", "REJECTED"].includes(c.status);
  const resolver = async () => {
    setEnviando(true);
    try {
      await api(`/v1/cal/reclamos/${id}/resolver`, { method: "POST", body: { status: f.status, resolution: f.status === "RESOLVED" ? f.resolution || null : null,
        credit_note_id: f.resolution === "CREDIT_NOTE" ? f.credit_note_id || null : null, resolution_notes: f.resolution_notes || null } });
      toast.ok(f.status === "INVESTIGATING" ? "Reclamo en investigación" : "Reclamo cerrado"); recargar(); onCambio();
    } catch (e) { toast.error(mensajeDe(e)); } finally { setEnviando(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={c ? `Reclamo ${c.number}` : "Reclamo"}
      footer={c && !cerrado && op.can.claim ? <><Button variant="ghost" onClick={onClose}>Cerrar</Button><Button variant="primary" loading={enviando} onClick={resolver}>Guardar resolución</Button></> : undefined}>
      {error && <Alert tone="bad">{error}</Alert>}
      {c && <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2"><StatusBadge status={c.status} labels={ESTADO_RECLAMO} /><span className="text-[13px] text-muted">{TIPO_RECLAMO[c.claim_type]}</span></div>
        <p className="text-[14px]">{c.description}</p>
        <DetailList items={[
          { label: "Cliente", value: c.customer_name }, { label: "Recibido", value: `${fechaHora(c.received_at)}${c.channel ? ` · ${CANAL[c.channel] ?? c.channel}` : ""}` },
          { label: "Producto", value: c.product_name }, { label: "Lote", value: c.lot_code ?? "—" },
          { label: "Pedido", value: c.order_number ?? "—" }, { label: "Comprobante", value: c.document_number ?? "—" },
          { label: "No conformidad", value: c.nc_number ? <Link href={`/m/cal/cal-08?id=${c.nonconformity_id}`} className="text-primary hover:underline">{c.nc_number}</Link> : "—" },
          { label: "Foto", value: c.photo_url ?? "—" },
          ...(cerrado ? [{ label: "Resolución", value: c.resolution ? RESOLUCION[c.resolution] : "No procede" }, { label: "Nota de crédito", value: c.credit_note_number ?? "—" },
            { label: "Cerrado", value: `${fechaHora(c.resolved_at)}${c.resolved_by_name ? ` · ${c.resolved_by_name}` : ""}` }, { label: "Notas", value: c.resolution_notes ?? "—" }] : []),
        ]} />
        {!cerrado && !op.can.claim && <Alert tone="info">Resolver el reclamo lo hace Calidad o la supervisora de ventas.</Alert>}
        {!cerrado && op.can.claim && <div className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-2">
          <Field label="Decisión"><Select value={f.status} options={[{ value: "RESOLVED", label: "Resolver" }, { value: "INVESTIGATING", label: "Seguir investigando" }, { value: "REJECTED", label: "No procede" }]}
            onChange={(e) => setF((x) => ({ ...x, status: e.target.value }))} /></Field>
          {f.status === "RESOLVED" && <Field label="Compensación" required><Select value={f.resolution} placeholder="Elegir" options={opcionesDe(RESOLUCION)} onChange={(e) => setF((x) => ({ ...x, resolution: e.target.value }))} /></Field>}
          {f.status === "RESOLVED" && f.resolution === "CREDIT_NOTE" && <Field label="Nota de crédito" required className="sm:col-span-2"
            hint={c.credit_notes.length ? undefined : "El cliente no tiene notas de crédito emitidas. Emítela primero en Facturación."}>
            <Select value={f.credit_note_id} placeholder="Elegir" options={c.credit_notes.map((n) => ({ value: n.id, label: `${n.full_number} · ${fecha(n.issue_date)} · ${soles(n.total)}` }))}
              onChange={(e) => setF((x) => ({ ...x, credit_note_id: e.target.value }))} /></Field>}
          <Field label="Notas" required={f.status === "REJECTED"} className="sm:col-span-2"><Textarea rows={2} value={f.resolution_notes} onChange={(e) => setF((x) => ({ ...x, resolution_notes: e.target.value }))} /></Field>
        </div>}
      </div>}
    </Modal>
  );
}
