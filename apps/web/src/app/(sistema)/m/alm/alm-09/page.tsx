"use client";

import { useEffect, useState } from "react";
import { Camera, CheckCircle2, Plus, XCircle } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api, apiImagen, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora, kg, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { BuscaVariante, Cant, FiltroSelect, accion, opcionesAlmacen, useDatos, useOpciones } from "@/modulos/alm/comunes";
import { LoteSelect } from "@/modulos/alm/Transferencia";
import { MERMA, type Num, type Opciones, type Variante } from "@/modulos/alm/tipos";

type Fila = { id: string; number: string; status: string; qty: Num; weight_kg: Num; estimated_cost: Num; actual_cost: Num; requested_at: string; requested_by: string;
  has_photo: boolean; reason_name: string; reason_code: string; approval_above_pen: Num; above_threshold: boolean; sku: string; variant_name: string; sale_mode: string;
  warehouse_code: string; lot_code: string | null; requested_by_name: string | null };
type Merma = Fila & { notes: string | null; warehouse_name: string; approved_by_name: string | null; approved_at: string | null; rejected_reason?: string | null; requires_photo: boolean };

/** ALM-09 Mermas: registro con motivo, cantidad, peso, foto y costo estimado; aprobación sobre el umbral. */
export default function Mermas() {
  const { marca, local, puede } = useSesion();
  const op = useOpciones();
  const [estado, setEstado] = useState("PENDING");
  const [motivo, setMotivo] = useState("");
  const lista = useListado<Fila>("/v1/alm/mermas", { orden: "-requested_at", filtros: { status: estado, reason_id: motivo, site: local, brand: marca } });
  const [abierta, setAbierta] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const costos = useSesion().can("alm.stock.view_cost");

  const columnas: Column<Fila>[] = [
    { key: "number", header: "Número", sortable: true, cardTitle: true, render: (m) => <span className="font-mono font-semibold">{m.number}</span> },
    { key: "requested_at", header: "Fecha", sortable: true, render: (m) => <div><p>{fechaHora(m.requested_at)}</p><p className="text-[12px] text-muted">{m.requested_by_name}</p></div> },
    { key: "sku", header: "Producto", render: (m) => <div className="min-w-[160px]"><p>{m.variant_name}</p><p className="font-mono text-[12px] text-muted">{m.sku}{m.lot_code ? ` · ${m.lot_code}` : ""} · {m.warehouse_code}</p></div> },
    { key: "reason_name", header: "Motivo", render: (m) => <span className="flex flex-wrap items-center gap-1">{m.reason_name}{m.has_photo && <Camera size={13} className="text-muted" aria-label="Con foto" />}</span> },
    { key: "qty", header: "Cantidad", align: "right", render: (m) => <Cant v={m.qty} modo={m.sale_mode} /> },
    ...(costos ? [{ key: "estimated_cost", header: "Costo", sortable: true, align: "right", render: (m: Fila) => <div><p>{soles(m.actual_cost ?? m.estimated_cost)}</p>{m.above_threshold && <Badge tone="warn">Sobre umbral</Badge>}</div> }] as Column<Fila>[] : []),
    { key: "status", header: "Estado", sortable: true, render: (m) => <StatusBadge status={m.status} labels={MERMA} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Producto que se pierde: vencido, malogrado, roto o por corte. Sale del stock cuando se aprueba; sobre el umbral del motivo la aprueba quien tiene el permiso, y nunca quien la pidió."
        actions={puede("ALM", "C") && <Button variant="primary" icon={Plus} disabled={!op} onClick={() => setNueva(true)}>Registrar merma</Button>} />
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(m) => setAbierta(m.id)}
        search={{ ...lista.tabla.search, placeholder: "Buscar número, SKU, lote o motivo…" }} empty="No hay mermas con esos filtros."
        toolbar={<>
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={Object.entries(MERMA).map(([value, [label]]) => ({ value, label }))} />
          <FiltroSelect label="Motivo" value={motivo} onChange={setMotivo} options={(op?.waste_reasons ?? []).map((r) => ({ value: r.id, label: r.name }))} ancho="sm:w-[200px]" />
        </>} />
      {abierta && <Ficha id={abierta} onClose={() => setAbierta(null)} onCambio={lista.recargar} />}
      {nueva && op && <Nueva op={op} onClose={() => setNueva(false)} onCreada={(id) => { setNueva(false); lista.recargar(); setAbierta(id); }} />}
    </div>
  );
}

function Ficha({ id, onClose, onCambio }: { id: string; onClose: () => void; onCambio: () => void }) {
  const { me, can, puede } = useSesion();
  const { datos: m, error, recargar } = useDatos<Merma>(`/v1/alm/mermas/${id}`);
  const [foto, setFoto] = useState<string | null>(null);
  useEffect(() => {
    if (!m?.has_photo) return;
    let url: string | null = null;
    apiImagen(`/v1/alm/mermas/${m.id}/foto`).then((u) => { url = u; setFoto(u); });
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [m?.id, m?.has_photo]);
  const hecho = () => { recargar(); onCambio(); };
  const mia = m?.requested_by === me.user.id;
  const permiso = m && (!m.above_threshold || can("alm.waste.approve"));
  const decide = m?.status === "PENDING" && puede("ALM", "E") && !mia && permiso;
  return (
    <Modal open onClose={onClose} size="lg" title={m ? `Merma ${m.number}` : "Merma"}
      footer={decide && m && <>
        <Button variant="ghost" icon={XCircle} onClick={() => accion({ title: `¿Rechazar ${m.number}?`, danger: true, confirmLabel: "Rechazar", reason: { min: 5 } },
          (r) => api(`/v1/alm/mermas/${m.id}/rechazar`, { method: "POST", body: { reason: r } }), "Merma rechazada", hecho)}>Rechazar</Button>
        <Button variant="primary" icon={CheckCircle2} onClick={() => accion({ title: `¿Aprobar ${m.number}?`, message: "Sale del stock en este momento.", confirmLabel: "Aprobar" },
          () => api(`/v1/alm/mermas/${m.id}/aprobar`, { method: "POST" }), "Merma aprobada", hecho)}>Aprobar</Button>
      </>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {m && <div className="space-y-4">
        {m.status === "PENDING" && mia && <Alert tone="info">Tú la registraste: la aprueba otra persona.</Alert>}
        {m.status === "PENDING" && !mia && !permiso && <Alert tone="info">Supera el umbral del motivo ({soles(m.approval_above_pen)}): la aprueba quien tiene el permiso de mermas.</Alert>}
        <DetailList items={[
          { label: "Estado", value: <StatusBadge status={m.status} labels={MERMA} /> },
          { label: "Motivo", value: m.reason_name },
          { label: "Producto", value: `${m.sku} · ${m.variant_name}` },
          { label: "Almacén y lote", value: `${m.warehouse_code}${m.lot_code ? ` · ${m.lot_code}` : ""}` },
          { label: "Cantidad", value: <Cant v={m.qty} modo={m.sale_mode} /> },
          { label: "Peso", value: m.weight_kg !== null ? kg(m.weight_kg) : "—" },
          ...(m.estimated_cost !== null ? [{ label: "Costo estimado", value: soles(m.estimated_cost) }] : []),
          ...(m.actual_cost !== null ? [{ label: "Costo real", value: soles(m.actual_cost) }] : []),
          { label: "Registró", value: `${m.requested_by_name ?? "—"} · ${fechaHora(m.requested_at)}` },
          { label: "Aprobó", value: m.approved_by_name ? `${m.approved_by_name} · ${fechaHora(m.approved_at)}` : "—" },
          ...(m.notes ? [{ label: "Notas", value: m.notes }] : []),
        ]} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {foto && <img src={foto} alt={`Foto de la merma ${m.number}`} className="max-h-80 rounded-xl border border-line object-contain" />}
      </div>}
    </Modal>
  );
}

function Nueva({ op, onClose, onCreada }: { op: Opciones; onClose: () => void; onCreada: (id: string) => void }) {
  const [almacen, setAlmacen] = useState("");
  const [variante, setVariante] = useState<Variante | null>(null);
  const [lote, setLote] = useState("");
  const [motivo, setMotivo] = useState("");
  const [qty, setQty] = useState("");
  const [peso, setPeso] = useState("");
  const [notas, setNotas] = useState("");
  const [foto, setFoto] = useState<File | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const elegido = op.waste_reasons.find((r) => r.id === motivo);
  async function enviar() {
    setGuardando(true); setError(""); setErrores({});
    const f = new FormData();
    const datos: Record<string, string> = { warehouse_id: almacen, variant_id: variante?.id ?? "", lot_id: lote, reason_id: motivo, qty: qty.replace(",", "."), weight_kg: peso.replace(",", "."), notes: notas };
    for (const [k, v] of Object.entries(datos)) if (v) f.append(k, v);
    if (foto) f.append("photo", foto);
    try {
      const m = await api<{ id: string }>("/v1/alm/mermas", { method: "POST", body: f });
      toast.ok("Merma registrada: queda por aprobar");
      onCreada(m.id);
    } catch (e) {
      const c = erroresDe(e); setErrores(c); setError(Object.keys(c).length ? "Revisa los datos marcados." : mensajeDe(e));
    } finally { setGuardando(false); }
  }
  return (
    <Modal open onClose={onClose} size="md" title="Registrar merma" dismissable={!guardando}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" loading={guardando} onClick={enviar}>Registrar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {error && <div className="sm:col-span-2"><Alert tone="bad">{error}</Alert></div>}
        <Field label="Almacén" required error={errores.warehouse_id}><Select value={almacen} onChange={(e) => { setAlmacen(e.target.value); setLote(""); }} placeholder="Elegir" options={opcionesAlmacen(op, (w) => w.wh_type !== "TRANSIT")} /></Field>
        <Field label="Motivo" required error={errores.reason_id}><Select value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Elegir" options={op.waste_reasons.map((r) => ({ value: r.id, label: r.name }))} /></Field>
        <div className="sm:col-span-2"><Field label="Producto" required error={errores.variant_id}><BuscaVariante value={variante} onChange={(v) => { setVariante(v); setLote(""); }} /></Field></div>
        <LoteSelect variante={variante} almacen={almacen} value={lote} onChange={setLote} todos />
        <Field label={`Cantidad (${variante?.sale_mode === "KG" ? "kg" : "und"})`} required error={errores.qty}><Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Peso (kg)" error={errores.weight_kg}><Input inputMode="decimal" value={peso} onChange={(e) => setPeso(e.target.value)} /></Field>
        <Field label="Foto" required={elegido?.requires_photo} error={errores.photo} hint={(elegido?.requires_photo ? "Este motivo exige foto. " : "") + "PNG, JPG o WEBP de hasta 1 MB"}>
          <Input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
        </Field>
        <div className="sm:col-span-2"><Field label="Notas" error={errores.notes}><Textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={500} /></Field></div>
      </div>
    </Modal>
  );
}
