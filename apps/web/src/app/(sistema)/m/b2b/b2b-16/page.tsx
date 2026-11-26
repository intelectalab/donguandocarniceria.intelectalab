"use client";

import { useState } from "react";
import { Camera, Plus, X } from "lucide-react";
import { Badge, Button, DataTable, Field, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, fechaHora } from "@/lib/formato";
import { Sub, opciones, useDatos } from "@/modulos/canales/comunes";
import { DetalleReclamo } from "@/modulos/b2b/Reclamos";
import { ESTADO_RECLAMO, TIPO_RECLAMO, type Reclamo } from "@/modulos/b2b/tipos";

type Resp = { data: Reclamo[]; orders: { id: string; number: string; delivery_date: string }[]; documents: { id: string; full_number: string; issue_date: string }[] };

/** B2B-16 Portal · Reclamos: reclamar por calidad, peso, atraso o facturación, con fotos, y seguir la respuesta. */
export default function MisReclamos() {
  const r = useDatos<Resp>("/v1/b2b/portal/reclamos");
  const [nuevo, setNuevo] = useState(false);
  const [ver, setVer] = useState<Reclamo | null>(null);
  const columnas: Column<Reclamo>[] = [
    { key: "number", header: "Reclamo", cardTitle: true, render: (c) => <div><p className="font-mono font-semibold">{c.number}</p><Sub>{c.type_label}</Sub></div> },
    { key: "description", header: "Detalle", render: (c) => <span className="line-clamp-2 max-w-[320px]">{c.description}</span> },
    { key: "opened_at", header: "Enviado", render: (c) => <div>{fechaHora(c.opened_at)}<Sub>{c.order_number ?? ""}</Sub></div> },
    { key: "status", header: "Estado", render: (c) => <div><StatusBadge status={c.status} labels={ESTADO_RECLAMO} />{c.response && c.status !== "RESOLVED" && <Sub>Tiene respuesta</Sub>}</div> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Cuéntanos qué pasó con tu pedido. Respondemos en 48 horas. Para calidad o peso, adjunta una foto."
        actions={<Button variant="primary" icon={Plus} disabled={!r.datos} onClick={() => setNuevo(true)}>Nuevo reclamo</Button>} />
      <DataTable columns={columnas} rows={r.datos?.data ?? []} loading={r.cargando} error={r.error} onRetry={r.recargar} empty="No tienes reclamos." onRowClick={setVer} />
      {ver && <Modal open onClose={() => setVer(null)} size="lg" title={`Reclamo ${ver.number}`}><DetalleReclamo c={ver} base="/v1/b2b/portal/reclamos" /></Modal>}
      {nuevo && r.datos && <NuevoReclamo d={r.datos} onClose={() => setNuevo(false)} onHecho={() => { setNuevo(false); r.recargar(); }} />}
    </div>
  );
}

function NuevoReclamo({ d, onClose, onHecho }: { d: Resp; onClose: () => void; onHecho: () => void }) {
  const [f, setF] = useState({ claim_type: "QUALITY", description: "", order_id: "", document_id: "" });
  const [fotos, setFotos] = useState<File[]>([]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const pideFoto = ["QUALITY", "WEIGHT"].includes(f.claim_type);
  async function enviar() {
    setEnviando(true); setErrores({});
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => v && fd.append(k, v));
    fotos.forEach((x) => fd.append("photos[]", x));
    try { await api("/v1/b2b/portal/reclamos", { method: "POST", body: fd }); toast.ok("Reclamo enviado. Te respondemos en 48 horas."); onHecho(); }
    catch (e) { const x = erroresDe(e); setErrores(x); if (!Object.keys(x).length) toast.error(mensajeDe(e)); } finally { setEnviando(false); }
  }
  return (
    <Modal open onClose={onClose} title="Nuevo reclamo" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={enviando} onClick={enviar}>Enviar reclamo</Button></>}>
      <div className="grid gap-4">
        <Field label="¿Qué pasó?" required error={errores.claim_type}><Select value={f.claim_type} onChange={(e) => setF({ ...f, claim_type: e.target.value })} options={opciones(TIPO_RECLAMO)} /></Field>
        <Field label="Pedido" error={errores.order_id}><Select value={f.order_id} onChange={(e) => setF({ ...f, order_id: e.target.value })} placeholder="Elige el pedido" options={d.orders.map((o) => ({ value: o.id, label: `${o.number} · entrega ${fecha(o.delivery_date)}` }))} /></Field>
        {f.claim_type === "BILLING" && <Field label="Comprobante" error={errores.document_id}><Select value={f.document_id} onChange={(e) => setF({ ...f, document_id: e.target.value })} placeholder="Elige el comprobante" options={d.documents.map((x) => ({ value: x.id, label: `${x.full_number} · ${fecha(x.issue_date)}` }))} /></Field>}
        <Field label="Cuéntanos" required error={errores.description}><Textarea rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Dos caldos llegaron con el envase roto" /></Field>
        <Field label={`Fotos${pideFoto ? " (al menos una)" : ""}`} error={errores.photos ?? errores["photos.0"]} hint="Hasta 4 fotos de 2 MB, en JPG, PNG o WEBP.">
          <div className="flex flex-wrap items-center gap-2">
            {fotos.map((x, i) => <Badge key={i} tone="neutral">{x.name}<button type="button" aria-label={`Quitar ${x.name}`} className="ml-1 cursor-pointer" onClick={() => setFotos(fotos.filter((_, j) => j !== i))}><X size={12} /></button></Badge>)}
            {fotos.length < 4 && <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] hover:border-primary"><Camera size={15} />Agregar foto
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ""; if (x) setFotos([...fotos, x]); }} /></label>}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
