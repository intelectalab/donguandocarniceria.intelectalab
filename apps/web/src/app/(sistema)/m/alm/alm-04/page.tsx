"use client";

import { useState } from "react";
import { CalendarDays, CheckCircle2, ClipboardCheck, Plus, Thermometer, Trash2, XCircle } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, Field, IconButton, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import Link from "next/link";
import { BuscaVariante, Cant, CifraLink, FiltroSelect, accion, num, opcionesAlmacen, qs, useAlAbrir, useDatos, useOpciones } from "@/modulos/alm/comunes";
import { ASPECTO, CONTROL, ORIGEN_RECEPCION, RECEPCION, etiqueta, type Num, type Opciones, type Variante } from "@/modulos/alm/tipos";

type Fila = { id: string; number: string; status: string; source_type: string; received_at: string | null; supplier_doc: string | null; vehicle_temp_c: Num;
  warehouse_code: string; warehouse_name: string; supplier_name: string | null; lines: number; rejected_lines: number; received_by_name: string | null };
type Cifras = { month: number; drafts: number; observed_pct: number; observed: number; lines: number; max_chilled: number; max_frozen: number };
/** Almacenes que reciben mercadería de afuera. */
const RECIBEN = ["QUARANTINE", "COLD_ROOM", "FREEZER", "MAIN"];
/** Proveedores que entregan producto (no servicios). */
const ENTREGAN = ["RELATED_FARM", "PRODUCER", "SLAUGHTERHOUSE", "PACKAGING", "INPUTS"];
type Linea = { id: string; variant_id: string; sku: string; variant_name: string; sale_mode: string; storage: string | null; requires_lot: boolean; qty: Num; weight_kg: Num;
  unit_cost: Num; expiry_date: string | null; production_date: string | null; product_temp_c: Num; appearance: string; qc_result: string; qc_notes: string | null;
  lot_code: string | null; lot_id: string | null; issue: { code: string; message: string } | null };
type Recepcion = Fila & { warehouse_id: string; supplier_id: string | null; void_reason: string | null; confirmed_at: string | null; confirmed_by_name: string | null; lines: Linea[] };

/** ALM-04 Recepción: origen, proveedor, temperatura del vehículo y líneas con control de calidad. Al confirmar crea los lotes. */
export default function Recepciones() {
  const { local, puede, can } = useSesion();
  const [estado, setEstado] = useState("");
  const [origen, setOrigen] = useState("");
  const lista = useListado<Fila>("/v1/alm/recepciones", { orden: "-received_at", filtros: { status: estado, source_type: origen, site: local } });
  const op = useOpciones();
  const [abierta, setAbierta] = useState<string | null>(null);
  useAlAbrir((p) => { setAbierta(p.get("id")); if (p.get("estado")) setEstado(p.get("estado")!); });
  const c = useDatos<Cifras>(`/v1/alm/cifras/04${qs({ site: local })}`).datos;
  const [form, setForm] = useState<Recepcion | null | undefined>(undefined);
  const puedeCrear = can("alm.receipt.create") && puede("ALM", "C");

  const columnas: Column<Fila>[] = [
    { key: "number", header: "Número", sortable: true, cardTitle: true, render: (r) => <span className="font-mono font-semibold">{r.number}</span> },
    { key: "received_at", header: "Fecha", sortable: true, render: (r) => fechaHora(r.received_at) },
    { key: "source_type", header: "Origen", render: (r) => <div><p>{etiqueta(ORIGEN_RECEPCION, r.source_type)}</p>{r.supplier_name && <p className="text-[12px] text-muted">{r.supplier_name}</p>}</div> },
    { key: "supplier_doc", header: "Comprobante", hideOnMobile: true, render: (r) => r.supplier_doc ?? "—" },
    { key: "warehouse_code", header: "Almacén", hideOnMobile: true, render: (r) => <span className="font-mono" title={r.warehouse_name}>{r.warehouse_code}</span> },
    { key: "vehicle_temp_c", header: "T° vehículo", align: "right", hideOnMobile: true, render: (r) => r.vehicle_temp_c !== null ? `${numero(r.vehicle_temp_c, 1)} °C` : "—" },
    { key: "received_by_name", header: "Recibió", hideOnMobile: true, render: (r) => r.received_by_name ?? "—" },
    { key: "lines", header: "Líneas", align: "right", render: (r) => <span>{r.lines}{r.rejected_lines > 0 && <span className="text-bad"> · {r.rejected_lines} rechazadas</span>}</span> },
    { key: "status", header: "Estado", sortable: true, render: (r) => <StatusBadge status={r.status} labels={RECEPCION} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Lo que llega de proveedores, granjas o producción. Cada línea pasa un control mínimo; al confirmar se crean los lotes en cuarentena o liberados y entra el stock."
        actions={puedeCrear && <Button variant="primary" icon={Plus} onClick={() => setForm(null)} disabled={!op}>Nueva recepción</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink titulo="Recepciones del mes" valor={c ? numero(c.month) : undefined} detalle="Confirmadas" icono={CalendarDays} />
        <CifraLink titulo="Por confirmar" valor={c ? numero(c.drafts) : undefined} detalle="Borradores" tono={c?.drafts ? "warn" : undefined} onClick={() => setEstado("DRAFT")} />
        <CifraLink titulo="Líneas observadas o rechazadas" valor={c ? `${numero(c.observed_pct, 1)} %` : undefined} detalle={c ? `${c.observed} de ${c.lines} · KPI-ALM-06` : undefined}
          icono={ClipboardCheck} href="/m/alm/alm-11?tab=indicadores" />
        <CifraLink titulo="Límites de temperatura" valor={c ? `${numero(c.max_chilled, 1)} / ${numero(c.max_frozen, 1)} °C` : undefined} detalle="Refrigerado / congelado" icono={Thermometer} />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(r) => setAbierta(r.id)}
        search={{ ...lista.tabla.search, placeholder: "Buscar número, proveedor o comprobante…" }} empty="No hay recepciones."
        toolbar={<>
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={Object.entries(RECEPCION).map(([value, [label]]) => ({ value, label }))} />
          <FiltroSelect label="Origen" value={origen} onChange={setOrigen} options={ORIGEN_RECEPCION} />
        </>} />
      {abierta && <Ficha id={abierta} onClose={() => setAbierta(null)} onCambio={lista.recargar} onEditar={(r) => { setAbierta(null); setForm(r); }} />}
      {form !== undefined && op && (
        <Formulario recepcion={form} op={op} onClose={() => setForm(undefined)}
          onGuardado={(id) => { setForm(undefined); lista.recargar(); setAbierta(id); }} />
      )}
    </div>
  );
}

function Ficha({ id, onClose, onCambio, onEditar }: { id: string; onClose: () => void; onCambio: () => void; onEditar: (r: Recepcion) => void }) {
  const { can } = useSesion();
  const { datos: r, error, recargar } = useDatos<Recepcion>(`/v1/alm/recepciones/${id}`);
  const editable = r?.status === "DRAFT" && can("alm.receipt.create");
  const hecho = () => { recargar(); onCambio(); };
  const conProblema = r?.lines.filter((l) => l.issue) ?? [];
  return (
    <Modal open onClose={onClose} size="xl" title={r ? `Recepción ${r.number}` : "Recepción"}
      footer={editable && r && <>
        <Button icon={XCircle} variant="ghost" onClick={() => accion({ title: `¿Anular ${r.number}?`, danger: true, confirmLabel: "Anular", reason: { min: 5 } },
          (m) => api(`/v1/alm/recepciones/${r.id}/anular`, { method: "POST", body: { reason: m } }), "Recepción anulada", hecho)}>Anular</Button>
        <Button onClick={() => onEditar(r)}>Editar</Button>
        <Button variant="primary" icon={CheckCircle2} onClick={() => accion({ title: `¿Confirmar ${r.number}?`, message: "Entra el stock y se crean los lotes. Ya no se podrá editar.", confirmLabel: "Confirmar" },
          () => api(`/v1/alm/recepciones/${r.id}/confirmar`, { method: "POST" }), "Recepción confirmada", hecho)}>Confirmar</Button>
      </>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {r && <div className="space-y-4">
        <DetailList items={[
          { label: "Estado", value: <StatusBadge status={r.status} labels={RECEPCION} /> },
          { label: "Origen", value: etiqueta(ORIGEN_RECEPCION, r.source_type) },
          { label: "Proveedor", value: r.supplier_name },
          { label: "Comprobante", value: r.supplier_doc },
          { label: "Almacén", value: `${r.warehouse_code} · ${r.warehouse_name}` },
          { label: "Temperatura del vehículo", value: r.vehicle_temp_c !== null ? `${r.vehicle_temp_c} °C` : "—" },
          { label: "Recibido", value: `${fechaHora(r.received_at)} · ${r.received_by_name ?? "—"}` },
          ...(r.confirmed_at ? [{ label: "Confirmado", value: `${fechaHora(r.confirmed_at)} · ${r.confirmed_by_name ?? "—"}` }] : []),
          ...(r.void_reason ? [{ label: "Motivo de anulación", value: r.void_reason }] : []),
        ]} />
        {r.status === "DRAFT" && conProblema.length > 0 && (
          <Alert tone="warn" title="Hay líneas que no pasan el control">
            {conProblema.map((l) => <p key={l.id}>{l.sku}: {l.issue!.message}</p>)}
          </Alert>
        )}
        <DataTable rows={r.lines} columns={[
          { key: "sku", header: "Producto", cardTitle: true, render: (l) => <div className="min-w-[160px]"><p>{l.variant_name}</p><p className="font-mono text-[12px] text-muted">{l.sku}</p></div> },
          { key: "lot_code", header: "Lote creado", render: (l) => l.lot_id ? <Link href={`/m/alm/alm-06?lote=${l.lot_id}`} className="font-mono text-primary hover:underline">{l.lot_code}</Link> : "—" },
          { key: "qty", header: "Cantidad", align: "right", render: (l) => <Cant v={l.qty} modo={l.sale_mode} /> },
          { key: "unit_cost", header: "Costo", align: "right", render: (l) => soles(l.unit_cost) },
          { key: "expiry_date", header: "Vence", render: (l) => fecha(l.expiry_date) },
          { key: "product_temp_c", header: "T°", align: "right", render: (l) => l.product_temp_c !== null ? `${l.product_temp_c} °C` : "—" },
          { key: "appearance", header: "Aspecto", render: (l) => etiqueta(ASPECTO, l.appearance) },
          { key: "qc_result", header: "Control", render: (l) => <div className="flex flex-wrap gap-1"><StatusBadge status={l.qc_result} labels={CONTROL} />{l.issue && <Badge tone="warn">{l.issue.code}</Badge>}</div> },
          { key: "qc_notes", header: "Nota", render: (l) => l.qc_notes ?? "—" },
        ]} />
      </div>}
    </Modal>
  );
}

type LineaForm = { key: number; variante: Variante | null; qty: string; weight_kg: string; unit_cost: string; expiry_date: string; production_date: string;
  product_temp_c: string; appearance: string; qc_result: string; qc_notes: string };
let llave = 0;
const lineaVacia = (): LineaForm => ({ key: ++llave, variante: null, qty: "", weight_kg: "", unit_cost: "", expiry_date: "", production_date: "", product_temp_c: "", appearance: "OK", qc_result: "PASS", qc_notes: "" });

function Formulario({ recepcion, op, onClose, onGuardado }: { recepcion: Recepcion | null; op: Opciones; onClose: () => void; onGuardado: (id: string) => void }) {
  const [cab, setCab] = useState({
    warehouse_id: recepcion?.warehouse_id ?? "", source_type: recepcion?.source_type ?? "PURCHASE", supplier_id: recepcion?.supplier_id ?? "",
    supplier_doc: recepcion?.supplier_doc ?? "", vehicle_temp_c: recepcion?.vehicle_temp_c?.toString() ?? "",
  });
  const [lineas, setLineas] = useState<LineaForm[]>(recepcion ? recepcion.lines.map((l) => ({
    key: ++llave, variante: { id: l.variant_id, sku: l.sku, name: l.variant_name, sale_mode: l.sale_mode, requires_lot: l.requires_lot, storage: l.storage } as Variante,
    qty: String(l.qty ?? ""), weight_kg: l.weight_kg?.toString() ?? "", unit_cost: l.unit_cost?.toString() ?? "", expiry_date: l.expiry_date?.slice(0, 10) ?? "",
    production_date: l.production_date?.slice(0, 10) ?? "", product_temp_c: l.product_temp_c?.toString() ?? "", appearance: l.appearance, qc_result: l.qc_result, qc_notes: l.qc_notes ?? "",
  })) : [lineaVacia()]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const setL = (i: number, k: keyof LineaForm, v: unknown) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const granja = op.suppliers.find((s) => s.supplier_type === "RELATED_FARM");
  const elegirOrigen = (v: string) => setCab((c) => ({ ...c, source_type: v, supplier_id: v === "FARM" && granja ? granja.id : c.supplier_id }));
  const revisiones = lineas.map((l) => revisar(l, op));
  const listas = lineas.some((l) => l.variante) && revisiones.every((x, i) => !lineas[i].variante || x === null);

  async function guardar(confirmar = false) {
    setGuardando(true); setError(""); setErrores({});
    try {
      const body = {
        ...cab, supplier_id: cab.supplier_id || null, supplier_doc: cab.supplier_doc || null, vehicle_temp_c: num(cab.vehicle_temp_c),
        lines: lineas.filter((l) => l.variante).map((l) => ({
          variant_id: l.variante!.id, qty: num(l.qty), weight_kg: num(l.weight_kg), unit_cost: num(l.unit_cost), expiry_date: l.expiry_date || null,
          production_date: l.production_date || null, product_temp_c: num(l.product_temp_c), appearance: l.appearance, qc_result: l.qc_result, qc_notes: l.qc_notes || null,
        })),
      };
      const r = await api<{ id: string }>(recepcion ? `/v1/alm/recepciones/${recepcion.id}` : "/v1/alm/recepciones", { method: recepcion ? "PUT" : "POST", body });
      const id = r.id ?? recepcion!.id;
      if (confirmar) {
        try {
          await api(`/v1/alm/recepciones/${id}/confirmar`, { method: "POST" });
          toast.ok("Recepción confirmada: entró el stock y se crearon los lotes");
        } catch (e) {
          toast.error(`Quedó como borrador: ${mensajeDe(e)}`);
        }
      } else {
        toast.ok("Recepción guardada como borrador");
      }
      onGuardado(id);
    } catch (e) {
      const c = erroresDe(e);
      setErrores(c);
      setError(Object.keys(c).length ? "Revisa los datos marcados." : mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!guardando} size="xl" title={recepcion ? `Editar ${recepcion.number}` : "Nueva recepción"}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button loading={guardando} onClick={() => guardar(false)}>Guardar borrador</Button>
        <Button variant="primary" icon={CheckCircle2} loading={guardando} disabled={!listas} onClick={() => guardar(true)}>Guardar y confirmar</Button></>}>
      <div className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Almacén" required error={errores.warehouse_id}><Select value={cab.warehouse_id} onChange={(e) => setCab({ ...cab, warehouse_id: e.target.value })} placeholder="Elegir" options={opcionesAlmacen(op, (w) => RECIBEN.includes(w.wh_type))} /></Field>
          <Field label="Origen" required error={errores.source_type}><Select value={cab.source_type} onChange={(e) => elegirOrigen(e.target.value)} options={ORIGEN_RECEPCION} /></Field>
          <Field label="Proveedor o granja" error={errores.supplier_id}><Select value={cab.supplier_id} onChange={(e) => setCab({ ...cab, supplier_id: e.target.value })} placeholder="Ninguno" searchable options={op.suppliers.filter((s) => !s.supplier_type || ENTREGAN.includes(s.supplier_type)).map((s) => ({ value: s.id, label: s.trade_name }))} /></Field>
          <Field label="Comprobante del proveedor" error={errores.supplier_doc}><Input value={cab.supplier_doc} onChange={(e) => setCab({ ...cab, supplier_doc: e.target.value })} placeholder="F001-123" /></Field>
          <Field label="Temperatura del vehículo (°C)" error={errores.vehicle_temp_c} hint={`Refrigerado hasta ${op.params.alm_max_temp_chilled_c} °C · congelado hasta ${op.params.alm_max_temp_frozen_c} °C`}>
            <Input inputMode="decimal" value={cab.vehicle_temp_c} onChange={(e) => setCab({ ...cab, vehicle_temp_c: e.target.value })} />
          </Field>
        </div>
        {errores.lines && <p className="text-[13px] text-bad">{errores.lines}</p>}
        <div className="space-y-3">
          {lineas.map((l, i) => (
            <fieldset key={l.key} className="rounded-xl border border-line p-3">
              <div className="mb-3 flex items-center gap-2">
                <p className="text-[13px] font-semibold">Línea {i + 1}</p>
                {l.variante && (revisiones[i] ? <Badge tone="bad">{revisiones[i]![0]}</Badge> : <Badge tone="ok">OK</Badge>)}
                <span className="flex-1" />
                {lineas.length > 1 && <IconButton icon={Trash2} label="Quitar línea" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} />}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2"><Field label="Producto" required error={errores[`lines.${i}.variant_id`]}><BuscaVariante value={l.variante} onChange={(v) => setL(i, "variante", v)} /></Field></div>
                <Field label={`Cantidad (${l.variante?.sale_mode === "KG" ? "kg" : "und"})`} required error={errores[`lines.${i}.qty`]}><Input inputMode="decimal" value={l.qty} onChange={(e) => setL(i, "qty", e.target.value)} /></Field>
                <Field label="Peso (kg)" required={Boolean(l.variante && l.variante.sale_mode !== "UNIT")} error={errores[`lines.${i}.weight_kg`]}><Input inputMode="decimal" value={l.weight_kg} onChange={(e) => setL(i, "weight_kg", e.target.value)} /></Field>
                <Field label="Costo unitario (S/)" error={errores[`lines.${i}.unit_cost`]}><Input inputMode="decimal" value={l.unit_cost} onChange={(e) => setL(i, "unit_cost", e.target.value)} /></Field>
                <Field label="Producción" error={errores[`lines.${i}.production_date`]}><Input type="date" value={l.production_date} onChange={(e) => setL(i, "production_date", e.target.value)} /></Field>
                <Field label="Vencimiento" required={l.variante?.requires_lot} error={errores[`lines.${i}.expiry_date`]}><Input type="date" value={l.expiry_date} onChange={(e) => setL(i, "expiry_date", e.target.value)} /></Field>
                <Field label="T° del producto (°C)" error={errores[`lines.${i}.product_temp_c`]}><Input inputMode="decimal" value={l.product_temp_c} onChange={(e) => setL(i, "product_temp_c", e.target.value)} /></Field>
                <Field label="Aspecto"><Select value={l.appearance} onChange={(e) => setL(i, "appearance", e.target.value)} options={ASPECTO} /></Field>
                <Field label="Resultado del control"><Select value={l.qc_result} onChange={(e) => setL(i, "qc_result", e.target.value)} options={Object.entries(CONTROL).map(([value, [label]]) => ({ value, label }))} /></Field>
                <div className="sm:col-span-2"><Field label="Observación" required={l.qc_result === "FAIL"} hint={l.qc_result === "FAIL" ? "Di por qué se rechaza" : undefined}><Textarea rows={1} value={l.qc_notes} onChange={(e) => setL(i, "qc_notes", e.target.value)} /></Field></div>
              </div>
            </fieldset>
          ))}
          <Button icon={Plus} size="sm" onClick={() => setLineas((ls) => [...ls, lineaVacia()])}>Agregar línea</Button>
        </div>
        {lineas.some((l) => l.variante) && (listas
          ? <Alert tone="ok">Todas las líneas están controladas. Al confirmar, las aprobadas crean su lote en cuarentena y entra el stock.</Alert>
          : <Alert tone="warn" title="Antes de confirmar">{revisiones.map((x, i) => x && lineas[i].variante && <p key={lineas[i].key}>Línea {i + 1}: {x[1]}</p>)}</Alert>)}
      </div>
    </Modal>
  );
}

/** Control de la línea en vivo; la misma regla que aplica la API al confirmar (RecepcionService::revisarLinea). */
function revisar(l: LineaForm, op: Opciones): [string, string] | null {
  const v = l.variante;
  if (!v) return ["RN-ALM-05", "Elige el producto."];
  const n = v.name;
  if (!((num(l.qty) ?? 0) > 0)) return ["RN-ALM-05", `La cantidad de ${n} debe ser mayor que cero.`];
  if (!l.qc_result || l.qc_result === "PENDING") return ["RN-ALM-05", `Marca la línea de ${n} como aprobada o rechazada.`];
  if (l.qc_result === "FAIL") return l.qc_notes.trim() ? null : ["RN-ALM-06", `La línea rechazada de ${n} exige una nota con el motivo.`];
  const t = num(l.product_temp_c);
  const max = v.storage === "CHILLED" ? op.params.alm_max_temp_chilled_c : v.storage === "FROZEN" ? op.params.alm_max_temp_frozen_c : null;
  if (max !== null && t === null) return ["RN-ALM-06", `Registra la temperatura de ${n} (máximo ${max} °C).`];
  if (max !== null && t !== null && t > max) return ["RN-ALM-06", `${n} llegó a ${t} °C y el máximo es ${max} °C: recházala con nota.`];
  if (l.appearance === "REJECTED") return ["RN-ALM-06", `${n} tiene aspecto rechazado: no se puede aprobar.`];
  if (v.sale_mode !== "UNIT" && !((num(l.weight_kg) ?? 0) > 0)) return ["RN-ALM-05", `Registra el peso recibido de ${n}.`];
  if (v.requires_lot && !l.expiry_date && !v.shelf_life_days) return ["RN-ALM-05", `Registra el vencimiento de ${n}.`];
  return null;
}
