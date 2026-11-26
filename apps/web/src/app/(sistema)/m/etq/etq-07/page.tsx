"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, MessageCircle } from "lucide-react";
import { Alert, Button, Checkbox, DataTable, DetailList, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, kg, porcentaje } from "@/lib/formato";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { Avance, ESTADO_CONTACTO, ESTADO_LOTE, ESTADO_RETIRO, RIESGO, Seccion, Tabla, useAlAbrir, useDatos, useOpcionesEtq, type Num } from "@/modulos/etq/comunes";
import { opcionesDe } from "@/modulos/pro/tipos";

type Contacto = { id: string; customer_id: string | null; lot_id: string; qty: Num; weight_kg: Num; status: string; contacted_at: string | null; contact_notes: string | null; recovered_kg: Num;
  customer_name: string | null; phone: string | null; lot_code: string; document_number: string | null; order_number: string | null; updated_by_name: string | null };
type Retiro = { id: string; number: string; reason: string; risk_class: string; include_descendants: boolean; initiated_at: string; contacts_listed_at: string | null; authority_notified_at: string | null;
  status: string; closing_summary: string | null; closed_at: string | null; initiated_by_name: string | null; closed_by_name: string | null; whatsapp_template: string | null;
  lots: { lot_id: string; code: string; qc_status: string; product_name: string; is_descendant: boolean; remaining_qty: Num; previous_status: string }[];
  contacts: Contacto[]; progress: { contacts: number; done: number; sold_kg: Num; recovered_kg: Num; recovery_pct: Num; listing_minutes: Num } };
type Aviso = { template: string; phone: string | null; text: string; whatsapp_url: string | null };

/** ETQ-07 Seguimiento del retiro: por cliente, su pedido, comprobante, kg, el aviso de WhatsApp, el resultado y los kg recuperados; se cierra con todos contactados (RN-ETQ-08). */
export default function Seguimiento() {
  const op = useOpcionesEtq();
  const [id, setId] = useState("");
  useAlAbrir((p) => setId(p.get("id") ?? ""));
  const abiertos = useDatos<{ data: { id: string; number: string; reason: string }[] }>(id ? null : "/v1/etq/retiros?status=OPEN&per_page=50").datos?.data ?? [];
  const { datos: r, error, recargar } = useDatos<Retiro>(id ? `/v1/etq/retiros/${id}` : null);
  const [contacto, setContacto] = useState<Contacto | null>(null);
  const [aviso, setAviso] = useState<{ c: Contacto; a: Aviso } | null>(null);
  const [cerrar, setCerrar] = useState(false);
  const abierto = r?.status === "OPEN";
  const registra = abierto && (op?.can.start_recall || op?.can.close_recall);
  const verAviso = async (c: Contacto) => { try { setAviso({ c, a: await api<Aviso>(`/v1/etq/contactos/${c.id}/aviso`) }); } catch (e) { toast.error(mensajeDe(e)); } };
  const columnas: Column<Contacto>[] = [
    { key: "customer_name", header: "Cliente", cardTitle: true, render: (c) => <div><p className="font-medium">{c.customer_name ?? "Sin identificar"}</p><p className="text-[12px] text-muted">{c.phone ?? "Sin teléfono"}</p></div> },
    { key: "document_number", header: "Compra", render: (c) => <div><p>{c.document_number ?? "—"}</p><p className="text-[12px] text-muted">{c.order_number ? `Pedido ${c.order_number}` : ""}</p></div> },
    { key: "lot_code", header: "Lote", hideOnMobile: true, render: (c) => <span className="font-mono text-[12.5px]">{c.lot_code}</span> },
    { key: "weight_kg", header: "Kg", align: "right", render: (c) => <span>{kg(c.weight_kg)}{c.recovered_kg !== null && <span className="block text-[12px] text-ok">{kg(c.recovered_kg)} recup.</span>}</span> },
    { key: "status", header: "Resultado", render: (c) => <div><StatusBadge status={c.status} labels={ESTADO_CONTACTO} />{c.contact_notes && <p className="mt-0.5 max-w-[240px] text-[12px] text-muted line-clamp-2">{c.contact_notes}</p>}</div> },
    { key: "acc", header: "", render: (c) => <span className="flex flex-wrap gap-1">
      {c.phone && <Button size="sm" variant="ghost" icon={MessageCircle} onClick={(e) => { e.stopPropagation(); void verAviso(c); }}>Aviso</Button>}
      {registra && <Button size="sm" onClick={(e) => { e.stopPropagation(); setContacto(c); }}>Resultado</Button>}
    </span> },
  ];
  if (!id) return (
    <div className="space-y-5">
      <PageHeader description="Elige el retiro que vas a seguir." />
      <Seccion titulo="Retiros en curso">
        {abiertos.length ? <ul className="space-y-2">{abiertos.map((x) => <li key={x.id}><button type="button" onClick={() => setId(x.id)} className="w-full rounded-lg border border-line px-3 py-2 text-left hover:bg-surface-2">
          <span className="font-mono font-semibold">{x.number}</span><span className="block text-[13px] text-muted line-clamp-1">{x.reason}</span></button></li>)}</ul>
          : <p className="text-[13px] text-muted">No hay retiros en curso. <Link href="/m/etq/etq-05" className="text-primary hover:underline">Ver todos</Link></p>}
      </Seccion>
    </div>
  );
  return (
    <div className="space-y-5">
      <PageHeader description={r ? `${r.number} · ${RIESGO[r.risk_class] ?? r.risk_class}` : "Retiro"}
        actions={r && abierto && op?.can.close_recall && <Button variant="primary" icon={CheckCircle2} onClick={() => setCerrar(true)}>Cerrar retiro</Button>} />
      {error && <Alert tone="bad">{error}</Alert>}
      {r && <>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <Seccion titulo="Retiro">
            <p className="mb-3 text-[14px]">{r.reason}</p>
            <DetailList items={[
              { label: "Estado", value: <StatusBadge status={r.status} labels={ESTADO_RETIRO} /> }, { label: "Iniciado", value: `${fechaHora(r.initiated_at)}${r.initiated_by_name ? ` · ${r.initiated_by_name}` : ""}` },
              { label: "Lista de clientes", value: r.contacts_listed_at ? `${fechaHora(r.contacts_listed_at)} (${r.progress.listing_minutes ?? "—"} min)` : "—" },
              { label: "Aviso a la autoridad", value: r.authority_notified_at ? fechaHora(r.authority_notified_at) : "Pendiente" },
              ...(r.closed_at ? [{ label: "Cerrado", value: `${fechaHora(r.closed_at)}${r.closed_by_name ? ` · ${r.closed_by_name}` : ""}` }, { label: "Resumen", value: r.closing_summary ?? "—" }] : []),
            ]} />
          </Seccion>
          <Seccion titulo="Avance">
            <div className="space-y-3">
              <Avance hechos={r.progress.done} total={r.progress.contacts} />
              <p className="text-[13px]">Recuperado {kg(r.progress.recovered_kg)} de {kg(r.progress.sold_kg)} vendidos ({porcentaje(r.progress.recovery_pct, 1)}).</p>
              <Tabla cabeza={["Lote", "Producto", "Estado", "Stock"]} filas={r.lots.map((l) => [<Link key="l" href={`/m/etq/etq-04?lot=${l.lot_id}`} className="font-mono text-primary hover:underline">{l.code}</Link>,
                `${l.product_name}${l.is_descendant ? " (derivado)" : ""}`, <StatusBadge key="s" status={l.qc_status} labels={ESTADO_LOTE} />, String(l.remaining_qty ?? "—")])} />
            </div>
          </Seccion>
        </div>
        <DataTable rows={r.contacts} columns={columnas} empty="Ningún cliente recibió estos lotes." />
      </>}
      {contacto && <Resultado c={contacto} onClose={() => setContacto(null)} onListo={() => { setContacto(null); recargar(); }} />}
      {aviso && <Modal open onClose={() => setAviso(null)} title={`Aviso a ${aviso.c.customer_name ?? "cliente"}`}
        footer={<><Button variant="ghost" onClick={() => setAviso(null)}>Cerrar</Button>{aviso.a.whatsapp_url && <Button variant="primary" icon={MessageCircle} onClick={() => window.open(aviso.a.whatsapp_url ?? "", "_blank", "noopener")}>Abrir WhatsApp</Button>}</>}>
        <div className="space-y-3">
          <p className="rounded-xl bg-surface-2 p-3 text-[14px] whitespace-pre-line">{aviso.a.text}</p>
          <p className="text-[12.5px] text-muted">Se abre WhatsApp con el mensaje listo para {aviso.a.phone}. Después registra el resultado del contacto.</p>
        </div>
      </Modal>}
      {cerrar && r && <Cierre r={r} onClose={() => setCerrar(false)} onListo={() => { setCerrar(false); recargar(); }} />}
    </div>
  );
}

function Resultado({ c, onClose, onListo }: { c: Contacto; onClose: () => void; onListo: () => void }) {
  const [f, setF] = useState({ status: c.status === "PENDING" ? "CONTACTED" : c.status, contact_notes: c.contact_notes ?? "", recovered_kg: c.recovered_kg === null ? "" : String(c.recovered_kg) });
  return (
    <Dialogo titulo={c.customer_name ?? "Contacto"} boton="Guardar" onClose={onClose}
      enviar={async () => { await api(`/v1/etq/contactos/${c.id}`, { method: "PUT", body: { status: f.status, contact_notes: f.contact_notes || null, recovered_kg: f.recovered_kg === "" ? null : Number(f.recovered_kg) } }); toast.ok("Contacto registrado"); onListo(); }}>
      {(err) => <>
        <p className="text-[13px] text-muted sm:col-span-2">Compró {kg(c.weight_kg)} del lote {c.lot_code}{c.document_number ? ` (${c.document_number})` : ""}.</p>
        <Field label="Resultado" required error={err.status}><Select value={f.status} options={opcionesDe(ESTADO_CONTACTO)} onChange={(e) => setF((x) => ({ ...x, status: e.target.value }))} /></Field>
        <Field label="Kg recuperados" required={f.status === "RECOVERED"} error={err.recovered_kg}><Input type="number" inputMode="decimal" step="0.001" min="0" suffix="kg" value={f.recovered_kg} onChange={(e) => setF((x) => ({ ...x, recovered_kg: e.target.value }))} /></Field>
        <Field label="Notas" error={err.contact_notes} className="sm:col-span-2"><Textarea rows={3} value={f.contact_notes} onChange={(e) => setF((x) => ({ ...x, contact_notes: e.target.value }))} /></Field>
      </>}
    </Dialogo>
  );
}

function Cierre({ r, onClose, onListo }: { r: Retiro; onClose: () => void; onListo: () => void }) {
  const [f, setF] = useState({ closing_summary: "", authority_notified: !!r.authority_notified_at });
  const pendientes = r.progress.contacts - r.progress.done;
  return (
    <Dialogo titulo={`Cerrar ${r.number}`} boton="Cerrar retiro" onClose={onClose} aviso={pendientes ? `Quedan ${pendientes} cliente(s) sin resultado: no se puede cerrar todavía.` : undefined}
      enviar={async () => { await api(`/v1/etq/retiros/${r.id}/cerrar`, { method: "POST", body: f }); toast.ok("Retiro cerrado"); onListo(); }}>
      {(err) => <>
        <Field label="Resumen" required error={err.closing_summary} className="sm:col-span-2" hint="Qué se recuperó, qué se destruyó y la causa"><Textarea rows={4} value={f.closing_summary} onChange={(e) => setF((x) => ({ ...x, closing_summary: e.target.value }))} /></Field>
        <div className="sm:col-span-2"><Checkbox checked={f.authority_notified} onChange={(v) => setF((x) => ({ ...x, authority_notified: v }))} label="Se avisó a la autoridad sanitaria" /></div>
      </>}
    </Dialogo>
  );
}
