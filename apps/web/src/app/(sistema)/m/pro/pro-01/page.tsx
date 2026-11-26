"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Button, DataTable, Field, Input, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, porcentaje } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { num, olvidarOpcionesPro, qs, useDatos, useOpcionesPro } from "@/modulos/pro/comunes";
import { TIPO_LINEA, opciones, type Num, type Opciones } from "@/modulos/pro/tipos";

type Linea = {
  id: string; code: string; name: string; line_type: string; establishment_id: string; establishment_name: string; input_warehouse_id: string; input_warehouse_code: string;
  output_warehouse_id: string; output_warehouse_code: string; cost_center_id: string | null; cost_center_code: string | null; max_waste_pct: Num; status: string;
  notes: string | null; open_orders: number; last_closed: string | null;
};

/** PRO-01 Líneas de producción: por local, con su almacén de insumos y de salida, centro de costo y merma máxima. */
export default function Lineas() {
  const { local, puede } = useSesion();
  const op = useOpcionesPro();
  const { datos, error, recargar } = useDatos<{ data: Linea[] }>(`/v1/pro/lineas${qs({ site: local })}`);
  const [editando, setEditando] = useState<Linea | null | undefined>(undefined);
  const gestiona = Boolean(op?.can.create) && puede("PRO", "C");
  const columnas: Column<Linea>[] = [
    { key: "code", header: "Código", render: (l) => <span className="font-mono font-semibold">{l.code}</span> },
    { key: "name", header: "Línea", cardTitle: true, render: (l) => <div><p className="font-medium">{l.name}</p><p className="text-[12px] text-muted">{TIPO_LINEA[l.line_type] ?? l.line_type}</p></div> },
    { key: "establishment_name", header: "Local" },
    { key: "wh", header: "Insumos → salida", render: (l) => <span className="font-mono text-[12.5px] whitespace-nowrap">{l.input_warehouse_code} → {l.output_warehouse_code}</span> },
    { key: "cost_center_code", header: "Centro de costo", hideOnMobile: true, render: (l) => l.cost_center_code ?? "—" },
    { key: "max_waste_pct", header: "Merma máx.", align: "right", render: (l) => porcentaje(l.max_waste_pct, 1) },
    { key: "open_orders", header: "Órdenes abiertas", align: "right", render: (l) => l.open_orders },
    { key: "last_closed", header: "Último cierre", hideOnMobile: true, render: (l) => fecha(l.last_closed) },
    { key: "status", header: "Estado", render: (l) => <StatusBadge status={l.status} /> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Cada orden se hace en una línea: de su almacén de insumos se consume y a su almacén de salida va lo producido. La merma máxima decide cuándo el cierre pide motivo."
        actions={gestiona && <Button variant="primary" icon={Plus} onClick={() => setEditando(null)}>Nueva línea</Button>} />
      {error && <Alert tone="bad">{error}</Alert>}
      <DataTable rows={datos?.data ?? []} columns={columnas} loading={!datos && !error} empty="No hay líneas en este local." onRowClick={gestiona ? (l) => setEditando(l) : undefined} />
      {editando !== undefined && op && <FormLinea l={editando} op={op} onClose={() => setEditando(undefined)} onGuardado={() => { setEditando(undefined); olvidarOpcionesPro(); recargar(); }} />}
    </div>
  );
}

function FormLinea({ l, op, onClose, onGuardado }: { l: Linea | null; op: Opciones; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({
    establishment_id: l?.establishment_id ?? op.establishments[0]?.id ?? "", code: l?.code ?? "", name: l?.name ?? "", line_type: l?.line_type ?? "SAUSAGE",
    input_warehouse_id: l?.input_warehouse_id ?? "", output_warehouse_id: l?.output_warehouse_id ?? "", cost_center_id: l?.cost_center_id ?? "",
    max_waste_pct: l?.max_waste_pct != null ? String(Number(l.max_waste_pct)) : "5", status: l?.status ?? "ACTIVE", notes: l?.notes ?? "",
  });
  const alm = op.warehouses.filter((w) => w.establishment_id === f.establishment_id).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }));
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialogo titulo={l ? `Editar ${l.code}` : "Nueva línea"} boton="Guardar" onClose={onClose}
      enviar={async () => {
        await api(l ? `/v1/pro/lineas/${l.id}` : "/v1/pro/lineas", { method: l ? "PUT" : "POST", body: { ...f, cost_center_id: f.cost_center_id || null, max_waste_pct: num(f.max_waste_pct), notes: f.notes || null } });
        toast.ok("Línea guardada"); onGuardado();
      }}>
      {(err) => <>
        <Field label="Local" required error={err.establishment_id}><Select value={f.establishment_id} disabled={Boolean(l)} options={op.establishments.map((e) => ({ value: e.id, label: e.short ?? e.name }))} onChange={(e) => set("establishment_id", e.target.value)} /></Field>
        <Field label="Tipo" required error={err.line_type}><Select value={f.line_type} options={opciones(TIPO_LINEA)} onChange={(e) => set("line_type", e.target.value)} /></Field>
        <Field label="Código" required error={err.code}><Input value={f.code} maxLength={40} onChange={(e) => set("code", e.target.value.toUpperCase())} /></Field>
        <Field label="Nombre" required error={err.name}><Input value={f.name} maxLength={80} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Almacén de insumos" required error={err.input_warehouse_id}><Select value={f.input_warehouse_id} placeholder="Elegir" options={alm} onChange={(e) => set("input_warehouse_id", e.target.value)} /></Field>
        <Field label="Almacén de salida" required error={err.output_warehouse_id}><Select value={f.output_warehouse_id} placeholder="Elegir" options={alm} onChange={(e) => set("output_warehouse_id", e.target.value)} /></Field>
        <Field label="Centro de costo" error={err.cost_center_id}><Select value={f.cost_center_id} placeholder="El de producción del local" options={op.cost_centers.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} onChange={(e) => set("cost_center_id", e.target.value)} /></Field>
        <Field label="Merma máxima" required error={err.max_waste_pct}><Input inputMode="decimal" suffix="%" value={f.max_waste_pct} onChange={(e) => set("max_waste_pct", e.target.value)} /></Field>
        <Field label="Estado" error={err.status}><Select value={f.status} options={[{ value: "ACTIVE", label: "Activa" }, { value: "INACTIVE", label: "Inactiva" }]} onChange={(e) => set("status", e.target.value)} /></Field>
        <Field label="Notas" error={err.notes} className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </>}
    </Dialogo>
  );
}
