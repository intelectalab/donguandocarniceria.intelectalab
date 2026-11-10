"use client";

import { useEffect, useState } from "react";
import { CalendarX, Camera, CheckCircle2, ClipboardCheck, Percent, Plus, Trash2, XCircle } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api, apiImagen, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora, kg, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Barras, BuscaVariante, Cant, CifraLink, FiltroSelect, accion, num, opcionesAlmacen, qs, useAlAbrir, useDatos, useOpciones, varianteDe } from "@/modulos/alm/comunes";
import { LoteSelect } from "@/modulos/alm/Transferencia";
import { MERMA, type Disponible, type Num, type Opciones, type Variante } from "@/modulos/alm/tipos";

type Fila = { id: string; number: string; status: string; qty: Num; weight_kg: Num; estimated_cost: Num; actual_cost: Num; requested_at: string; requested_by: string;
  has_photo: boolean; reason_name: string; reason_code: string; approval_above_pen: Num; above_threshold: boolean; sku: string; variant_name: string; sale_mode: string;
  warehouse_code: string; lot_code: string | null; requested_by_name: string | null };
type Merma = Fila & { notes: string | null; warehouse_name: string; approved_by_name: string | null; approved_at: string | null; reject_reason: string | null; requires_photo: boolean };
type Cifras = { pending: number; pending_value: Num; month: number; month_value: Num; waste_pct: number; expired_value: Num; by_reason: { label: string; value: Num; n: number }[] };
type Prellenado = { wh: string; variant: string; lot: string };

/** ALM-09 Mermas: registro con motivo, cantidad, peso, foto y costo estimado; aprobación sobre el umbral. */
export default function Mermas() {
  const { marca, local, puede } = useSesion();
  const op = useOpciones();
  const [estado, setEstado] = useState("PENDING");
  const [motivo, setMotivo] = useState("");
  const lista = useListado<Fila>("/v1/alm/mermas", { orden: "-requested_at", filtros: { status: estado, reason_id: motivo, site: local, brand: marca } });
  const [abierta, setAbierta] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const [prellenado, setPrellenado] = useState<Prellenado | null>(null);
  const costos = useSesion().can("alm.stock.view_cost");
  const c = useDatos<Cifras>(`/v1/alm/cifras/09${qs({ site: local, brand: marca })}`).datos;
  useAlAbrir((p) => {
    if (p.get("nuevo") && puede("ALM", "C")) { setPrellenado({ wh: p.get("wh") ?? "", variant: p.get("variant") ?? "", lot: p.get("lot") ?? "" }); setNueva(true); }
    if (p.get("id")) setAbierta(p.get("id"));
  });

  const columnas: Column<Fila>[] = [
    { key: "number", header: "Número", sortable: true, cardTitle: true, render: (m) => <span className="font-mono font-semibold">{m.number}</span> },
    { key: "requested_at", header: "Fecha", sortable: true, render: (m) => <span className="whitespace-nowrap">{fechaHora(m.requested_at)}</span> },
    { key: "sku", header: "Producto", render: (m) => <div className="min-w-[160px]"><p>{m.variant_name}</p><p className="font-mono text-[12px] text-muted">{m.sku}{m.lot_code ? ` · ${m.lot_code}` : ""} · {m.warehouse_code}</p></div> },
    { key: "reason_name", header: "Motivo", render: (m) => m.reason_name },
    { key: "has_photo", header: "Foto", align: "center", hideOnMobile: true, render: (m) => m.has_photo ? <Camera size={15} className="inline text-muted" aria-label="Con foto" /> : <span className="text-muted">—</span> },
    { key: "qty", header: "Cantidad", align: "right", render: (m) => <Cant v={m.qty} modo={m.sale_mode} /> },
    ...(costos ? [{ key: "estimated_cost", header: "Costo", sortable: true, align: "right", render: (m: Fila) => <div><p>{soles(m.actual_cost ?? m.estimated_cost)}</p>{m.above_threshold && <Badge tone="warn">Sobre umbral</Badge>}</div> }] as Column<Fila>[] : []),
    { key: "requested_by_name", header: "Registró", hideOnMobile: true, render: (m) => m.requested_by_name ?? "—" },
    { key: "status", header: "Estado", sortable: true, render: (m) => <StatusBadge status={m.status} labels={MERMA} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Producto que se pierde: vencido, malogrado, roto o por corte. Sale del stock cuando se aprueba; sobre el umbral del motivo la aprueba quien tiene el permiso, y nunca quien la pidió."
        actions={puede("ALM", "C") && <Button variant="primary" icon={Plus} disabled={!op} onClick={() => setNueva(true)}>Registrar merma</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink titulo="Por aprobar" valor={c ? numero(c.pending) : undefined} detalle={c && costos ? soles(c.pending_value) : "Pendientes"} icono={ClipboardCheck}
          tono={c?.pending ? "warn" : undefined} onClick={() => setEstado("PENDING")} />
        <CifraLink titulo="Mermas del mes" valor={c ? (costos ? soles(c.month_value) : numero(c.month)) : undefined} detalle={c ? `${c.month} aprobadas` : undefined} icono={Trash2}
          onClick={() => setEstado("APPROVED")} />
        <CifraLink titulo="Mermas sobre costo de venta" valor={c ? `${numero(c.waste_pct, 2)} %` : undefined} detalle="KPI-ALM-02 del mes" icono={Percent} href="/m/alm/alm-11?tab=indicadores" />
        <CifraLink titulo="Vencidos del mes" valor={c ? (costos ? soles(c.expired_value) : "—") : undefined} detalle="KPI-ALM-03" icono={CalendarX} tono={c && Number(c.expired_value) > 0 ? "bad" : undefined} />
      </div>
      {c && c.by_reason.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="mb-3 text-[14px] font-semibold">Mermas aprobadas del mes por motivo</h2>
          <Barras filas={c.by_reason.map((x) => ({ label: `${x.label} (${x.n})`, value: costos ? x.value : x.n }))} formato={(v) => (costos ? soles(v) : numero(v))} />
        </section>
      )}
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(m) => setAbierta(m.id)}
        search={{ ...lista.tabla.search, placeholder: "Buscar número, SKU, lote o motivo…" }} empty="No hay mermas con esos filtros."
        toolbar={<>
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={Object.entries(MERMA).map(([value, [label]]) => ({ value, label }))} />
          <FiltroSelect label="Motivo" value={motivo} onChange={setMotivo} options={(op?.waste_reasons ?? []).map((r) => ({ value: r.id, label: r.name }))} ancho="sm:w-[200px]" />
        </>} />
      {abierta && <Ficha id={abierta} onClose={() => setAbierta(null)} onCambio={lista.recargar} />}
      {nueva && op && <Nueva op={op} prellenado={prellenado} onClose={() => { setNueva(false); setPrellenado(null); }} onCreada={(id) => { setNueva(false); lista.recargar(); setAbierta(id); }} />}
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
          { label: m.status === "REJECTED" ? "Rechazó" : "Aprobó", value: m.approved_by_name ? `${m.approved_by_name} · ${fechaHora(m.approved_at)}` : "—" },
          ...(m.notes ? [{ label: "Notas", value: m.notes }] : []),
          ...(m.reject_reason ? [{ label: "Motivo del rechazo", value: m.reject_reason }] : []),
        ]} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {foto && <img src={foto} alt={`Foto de la merma ${m.number}`} className="max-h-80 rounded-xl border border-line object-contain" />}
      </div>}
    </Modal>
  );
}

function Nueva({ op, prellenado, onClose, onCreada }: { op: Opciones; prellenado: Prellenado | null; onClose: () => void; onCreada: (id: string) => void }) {
  const { can } = useSesion();
  const [almacen, setAlmacen] = useState(prellenado?.wh ?? "");
  const [variante, setVariante] = useState<Variante | null>(null);
  const [lote, setLote] = useState(prellenado?.lot ?? "");
  useEffect(() => {
    if (!prellenado?.variant) return;
    let vigente = true;
    varianteDe(prellenado.variant).then((v) => vigente && setVariante(v)).catch(() => undefined);
    return () => { vigente = false; };
  }, [prellenado?.variant]);
  const saldos = useDatos<{ data: Disponible[] }>(variante && almacen ? `/v1/alm/disponibles?variant_id=${variante.id}&warehouse_id=${almacen}&todos=1` : null).datos?.data;
  const [motivo, setMotivo] = useState("");
  const [qty, setQty] = useState("");
  const [peso, setPeso] = useState("");
  const [notas, setNotas] = useState("");
  const [foto, setFoto] = useState<File | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const elegido = op.waste_reasons.find((r) => r.id === motivo);
  const saldo = saldos?.find((x) => (x.lot_id ?? "") === lote) ?? (lote ? undefined : saldos?.[0]);
  const costoUnit = saldo?.avg_cost !== undefined && saldo?.avg_cost !== null ? Number(saldo.avg_cost) : variante?.std_cost !== null && variante?.std_cost !== undefined ? Number(variante.std_cost) : null;
  const estimado = costoUnit !== null && num(qty) ? Math.round(costoUnit * (num(qty) ?? 0) * 100) / 100 : null;
  const sobreUmbral = estimado !== null && elegido && elegido.approval_above_pen !== null && estimado > Number(elegido.approval_above_pen);
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
        {saldo && <p className="text-[12.5px] text-muted sm:col-span-2">En el almacén: <Cant v={saldo.qty ?? 0} modo={variante?.sale_mode} />{saldo.lot_code ? ` del lote ${saldo.lot_code}` : ""}.</p>}
        {can("alm.stock.view_cost") && estimado !== null && (
          <div className="sm:col-span-2">
            <Alert tone={sobreUmbral ? "warn" : "info"} title={`Costo estimado: ${soles(estimado)}`}>
              {sobreUmbral ? `Supera el umbral del motivo (${soles(elegido!.approval_above_pen)}): la aprueba quien tiene el permiso de mermas.` : "Queda por aprobar; la aprueba otra persona, nunca quien la registra."}
            </Alert>
          </div>
        )}
        <div className="sm:col-span-2"><Field label="Notas" error={errores.notes}><Textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={500} /></Field></div>
      </div>
    </Modal>
  );
}
