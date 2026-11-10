"use client";

import { useState } from "react";
import { CheckCircle2, Lock, Plus, ScanLine, XCircle } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DataTable, DetailList, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Cant, FiltroSelect, accion, num, opcionesAlmacen, useDatos, useOpciones } from "@/modulos/alm/comunes";
import { CONTEO, TIPO_CONTEO, etiqueta, type Num, type Opciones } from "@/modulos/alm/tipos";

type Fila = { id: string; number: string; status: string; count_type: string; blind: boolean; counted_at: string | null; approved_at: string | null; created_at: string;
  warehouse_code: string; warehouse_name: string; counted_by_name: string | null; approved_by_name: string | null; lines: number; counted_lines: number; diff_lines: number };
type LineaC = { id: string; variant_id: string; sku: string; variant_name: string; sale_mode: string; barcode: string | null; lot_code: string | null; expiry_date: string | null;
  system_qty: Num; counted_qty: Num; diff_qty: Num; system_weight_kg: Num; counted_weight_kg: Num };
type Conteo = Omit<Fila, "lines"> & { counted_by: string | null; notes: string | null; hidden_system: boolean; lines: LineaC[] };

/** ALM-08 Conteos: conteo ciego desde el celular, comparación con el sistema y aprobación con ajuste (otra persona aprueba). */
export default function Conteos() {
  const { local, puede } = useSesion();
  const op = useOpciones();
  const [estado, setEstado] = useState("");
  const lista = useListado<Fila>("/v1/alm/conteos", { orden: "-created_at", filtros: { status: estado, site: local } });
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);

  const columnas: Column<Fila>[] = [
    { key: "number", header: "Número", sortable: true, cardTitle: true, render: (c) => <span className="font-mono font-semibold">{c.number}</span> },
    { key: "created_at", header: "Creado", sortable: true, render: (c) => fecha(c.created_at) },
    { key: "warehouse_code", header: "Almacén", render: (c) => <span title={c.warehouse_name} className="font-mono">{c.warehouse_code}</span> },
    { key: "count_type", header: "Tipo", hideOnMobile: true, render: (c) => <span>{etiqueta(TIPO_CONTEO, c.count_type)}{c.blind && <Badge tone="info">Ciego</Badge>}</span> },
    { key: "counted_lines", header: "Avance", align: "right", render: (c) => `${c.counted_lines} / ${c.lines}` },
    { key: "diff_lines", header: "Con diferencia", align: "right", hideOnMobile: true, render: (c) => c.diff_lines ? <span className="text-warn">{c.diff_lines}</span> : "—" },
    { key: "status", header: "Estado", sortable: true, render: (c) => <StatusBadge status={c.status} labels={CONTEO} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Quien cuenta no ve lo que dice el sistema (conteo ciego). Al cerrar se compara, y una persona distinta aprueba el ajuste."
        actions={puede("ALM", "C") && <Button variant="primary" icon={Plus} disabled={!op} onClick={() => setNuevo(true)}>Nuevo conteo</Button>} />
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(c) => setAbierto(c.id)}
        search={{ ...lista.tabla.search, placeholder: "Buscar número o almacén…" }} empty="No hay conteos."
        toolbar={<FiltroSelect label="Estado" value={estado} onChange={setEstado} options={Object.entries(CONTEO).map(([value, [label]]) => ({ value, label }))} />} />
      {abierto && <Ficha id={abierto} onClose={() => setAbierto(null)} onCambio={lista.recargar} />}
      {nuevo && op && <Nuevo op={op} onClose={() => setNuevo(false)} onCreado={(id) => { setNuevo(false); lista.recargar(); setAbierto(id); }} />}
    </div>
  );
}

function Nuevo({ op, onClose, onCreado }: { op: Opciones; onClose: () => void; onCreado: (id: string) => void }) {
  const [almacen, setAlmacen] = useState("");
  const [tipo, setTipo] = useState("CYCLE");
  const [ciego, setCiego] = useState(true);
  const [notas, setNotas] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  async function enviar() {
    setGuardando(true); setError("");
    try {
      const c = await api<{ id: string }>("/v1/alm/conteos", { method: "POST", body: { warehouse_id: almacen, count_type: tipo, blind: ciego, notes: notas || null } });
      toast.ok("Conteo creado");
      onCreado(c.id);
    } catch (e) { setError(mensajeDe(e)); } finally { setGuardando(false); }
  }
  return (
    <Modal open onClose={onClose} placement="center" size="sm" title="Nuevo conteo" dismissable={!guardando}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" loading={guardando} disabled={!almacen} onClick={enviar}>Crear</Button></>}>
      <div className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Almacén" required><Select value={almacen} onChange={(e) => setAlmacen(e.target.value)} placeholder="Elegir" options={opcionesAlmacen(op, (w) => w.wh_type !== "TRANSIT")} /></Field>
        <Field label="Tipo"><Select value={tipo} onChange={(e) => setTipo(e.target.value)} options={TIPO_CONTEO} /></Field>
        <Checkbox checked={ciego} onChange={setCiego} label="Conteo ciego" hint="Quien cuenta no ve la cantidad del sistema" />
        <Field label="Notas"><Textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} /></Field>
        <p className="text-[12px] text-muted">Se cuentan todos los saldos del almacén al momento de crear el conteo.</p>
      </div>
    </Modal>
  );
}

function Ficha({ id, onClose, onCambio }: { id: string; onClose: () => void; onCambio: () => void }) {
  const { me, can, puede } = useSesion();
  const { datos: c, error, recargar } = useDatos<Conteo>(`/v1/alm/conteos/${id}`);
  const [codigo, setCodigo] = useState("");
  const [foco, setFoco] = useState<string | null>(null);
  const hecho = () => { recargar(); onCambio(); };
  const abierto = c?.status === "OPEN" && puede("ALM", "E");
  const yoConte = c?.counted_by === me.user.id;
  const puedeAprobar = c?.status === "COUNTED" && can("alm.count.approve") && !yoConte;

  async function guardarLinea(l: LineaC, valor: string, peso?: string) {
    try {
      await api(`/v1/alm/conteos/lineas/${l.id}`, { method: "PUT", body: { counted_qty: num(valor), counted_weight_kg: peso !== undefined ? num(peso) : l.counted_weight_kg } });
      recargar();
    } catch (e) { toast.error(mensajeDe(e)); }
  }
  function escanear() {
    const l = c?.lines.find((x) => x.barcode && x.barcode === codigo.trim()) ?? c?.lines.find((x) => x.sku.toLowerCase() === codigo.trim().toLowerCase());
    if (!l) { toast.error("Ese código no está en este conteo."); return; }
    setFoco(l.id); setCodigo("");
    const el = document.querySelector<HTMLInputElement>(`input[data-linea="${l.id}"]`);
    el?.focus(); el?.select();
  }

  const columnas: Column<LineaC>[] = [
    { key: "sku", header: "Producto", cardTitle: true, render: (l) => <div className={`min-w-[160px] ${foco === l.id ? "text-primary" : ""}`}><p>{l.variant_name}</p><p className="font-mono text-[12px] text-muted">{l.sku}{l.lot_code ? ` · ${l.lot_code}` : ""}</p></div> },
    ...(c?.hidden_system ? [] : [{ key: "system_qty", header: "Sistema", align: "right", render: (l: LineaC) => <Cant v={l.system_qty} modo={l.sale_mode} /> }] as Column<LineaC>[]),
    {
      key: "counted_qty", header: "Contado", align: "right", render: (l) => abierto ? (
        <Input data-linea={l.id} inputMode="decimal" defaultValue={l.counted_qty?.toString() ?? ""} aria-label={`Contado de ${l.sku}`}
          className="!h-9 w-28 text-right" onBlur={(e) => { if (e.target.value !== (l.counted_qty?.toString() ?? "")) guardarLinea(l, e.target.value); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      ) : l.counted_qty !== null ? <Cant v={l.counted_qty} modo={l.sale_mode} /> : "—",
    },
    ...(c?.hidden_system ? [] : [{ key: "diff_qty", header: "Diferencia", align: "right", render: (l: LineaC) => l.diff_qty === null ? "—"
      : <span className={Number(l.diff_qty) === 0 ? "text-muted" : Number(l.diff_qty) < 0 ? "text-bad" : "text-ok"}><Cant v={l.diff_qty} modo={l.sale_mode} signo /></span> }] as Column<LineaC>[]),
  ];

  return (
    <Modal open onClose={onClose} size="xl" title={c ? `Conteo ${c.number}` : "Conteo"}
      footer={c && <>
        {["OPEN", "COUNTED"].includes(c.status) && puede("ALM", "E") && <Button variant="ghost" icon={XCircle} onClick={() => accion({ title: `¿Cancelar ${c.number}?`, danger: true, confirmLabel: "Cancelar conteo", reason: { min: 5 } },
          (m) => api(`/v1/alm/conteos/${c.id}/cancelar`, { method: "POST", body: { reason: m } }), "Conteo cancelado", hecho)}>Cancelar</Button>}
        {abierto && <Button variant="primary" icon={Lock} onClick={() => accion({ title: "¿Cerrar el conteo?", message: "Ya no se podrá cambiar lo contado. Luego otra persona lo aprueba.", confirmLabel: "Cerrar" },
          () => api(`/v1/alm/conteos/${c.id}/cerrar`, { method: "POST" }), "Conteo cerrado", hecho)}>Cerrar conteo</Button>}
        {puedeAprobar && <Button variant="primary" icon={CheckCircle2} onClick={() => accion({ title: `¿Aprobar ${c.number}?`, message: `Se registran los ajustes de ${c.diff_lines} línea(s) con diferencia.`, confirmLabel: "Aprobar y ajustar" },
          () => api(`/v1/alm/conteos/${c.id}/aprobar`, { method: "POST" }), "Conteo aprobado y ajustado", hecho)}>Aprobar</Button>}
      </>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {c && <div className="space-y-4">
        <DetailList items={[
          { label: "Estado", value: <StatusBadge status={c.status} labels={CONTEO} /> },
          { label: "Almacén", value: `${c.warehouse_code} · ${c.warehouse_name}` },
          { label: "Tipo", value: `${etiqueta(TIPO_CONTEO, c.count_type)}${c.blind ? " · ciego" : ""}` },
          { label: "Contó", value: c.counted_by_name ? `${c.counted_by_name} · ${fechaHora(c.counted_at)}` : "—" },
          { label: "Aprobó", value: c.approved_by_name ? `${c.approved_by_name} · ${fechaHora(c.approved_at)}` : "—" },
          ...(c.notes ? [{ label: "Notas", value: c.notes }] : []),
        ]} />
        {c.status === "COUNTED" && yoConte && can("alm.count.approve") && <Alert tone="info">Tú contaste este conteo: lo aprueba otra persona.</Alert>}
        {abierto && (
          <form onSubmit={(e) => { e.preventDefault(); escanear(); }} className="flex gap-2">
            <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Escanea o escribe el código de barras o SKU" aria-label="Código" className="flex-1" />
            <Button type="submit" icon={ScanLine}>Buscar</Button>
          </form>
        )}
        <DataTable rows={c.lines} columns={columnas} />
      </div>}
    </Modal>
  );
}
