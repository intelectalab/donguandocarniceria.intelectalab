"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { SinPermiso, Vacio, useDatos, useOpciones, usePermisosGas } from "@/modulos/gas/comunes";
import { lista } from "@/modulos/gas/tipos";

type Cat = {
  id: string; code: string; name: string; category_group: string; grupo: string; default_area: string; area: string; delivery_cost_type: string | null;
  costo_reparto: string | null; default_cost_center_id: string; centro: string | null; default_doc_type: string; documento: string; requires_vehicle: boolean;
  requires_gallons: boolean; requires_employee: boolean; requires_supplier: boolean; requires_campaign: boolean; status: string; gastos: number;
};

/** GAS-05 Categorías: grupo, área por defecto, tipo de costo de reparto y lo que exige cada una (RN-GAS-03). */
export default function Categorias() {
  const p = usePermisosGas();
  const { datos, error, cargando, recargar } = useDatos<Cat[]>("/v1/gas/categorias");
  const [editar, setEditar] = useState<Cat | "nueva" | null>(null);
  const [q, setQ] = useState("");
  if (cargando) return <Vacio>Cargando…</Vacio>;
  if (error) return error.includes("permiso") ? <SinPermiso que="Tu rol no ve las categorías de gasto." /> : <Alert tone="bad">{error}</Alert>;
  const filas = (datos ?? []).filter((c) => `${c.code} ${c.name} ${c.grupo}`.toLowerCase().includes(q.toLowerCase()));
  const exige = (c: Cat) => [c.requires_vehicle && "vehículo", c.requires_gallons && "galones", c.requires_employee && "repartidor", c.requires_supplier && "proveedor", c.requires_campaign && "campaña"].filter(Boolean).join(", ");
  const columnas: Column<Cat>[] = [
    { key: "name", header: "Categoría", cardTitle: true, render: (c) => <span className="flex flex-col"><span className="font-medium">{c.name}</span><span className="text-[12px] text-muted">{c.code}</span></span> },
    { key: "grupo", header: "Grupo" },
    { key: "area", header: "Área", hideOnMobile: true },
    { key: "costo_reparto", header: "Costo de reparto", render: (c) => c.costo_reparto ? <Badge tone="info">{c.costo_reparto}</Badge> : "—" },
    { key: "exige", header: "Exige", hideOnMobile: true, render: (c) => exige(c) || "—" },
    { key: "documento", header: "Comprobante habitual", hideOnMobile: true },
    { key: "centro", header: "Centro por defecto", hideOnMobile: true, render: (c) => c.centro ?? "—" },
    { key: "status", header: "Estado", render: (c) => <StatusBadge status={c.status} /> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="La categoría dice qué pide el registro (vehículo, galones, repartidor, proveedor, campaña) y, si es de reparto, a qué costo de Delivery va al aprobarse."
        actions={p.config && <Button variant="primary" icon={Plus} onClick={() => setEditar("nueva")}>Categoría</Button>} />
      {!p.config && <Alert tone="info">Tu rol ve las categorías; las cambia administración.</Alert>}
      <DataTable rows={filas} columns={columnas} search={{ value: q, onChange: setQ, placeholder: "Buscar categoría" }} onRowClick={p.config ? (c) => setEditar(c) : undefined} empty="No hay categorías." />
      {editar && <Formulario c={editar === "nueva" ? null : editar} onClose={() => setEditar(null)} onListo={() => { setEditar(null); recargar(); }} />}
    </div>
  );
}

function Formulario({ c, onClose, onListo }: { c: Cat | null; onClose: () => void; onListo: () => void }) {
  const { datos: op } = useOpciones();
  const [v, setV] = useState({
    code: c?.code ?? "", name: c?.name ?? "", category_group: c?.category_group ?? "", default_area: c?.default_area ?? "", delivery_cost_type: c?.delivery_cost_type ?? "",
    default_cost_center_id: c?.default_cost_center_id ?? "", default_doc_type: c?.default_doc_type ?? "RECEIPT", requires_vehicle: c?.requires_vehicle ?? false,
    requires_gallons: c?.requires_gallons ?? false, requires_employee: c?.requires_employee ?? false, requires_supplier: c?.requires_supplier ?? false,
    requires_campaign: c?.requires_campaign ?? false, status: c?.status ?? "ACTIVE",
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const pon = (k: keyof typeof v, x: string | boolean) => setV((y) => ({ ...y, [k]: x }));
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await api(c ? `/v1/gas/categorias/${c.id}` : "/v1/gas/categorias", { method: c ? "PUT" : "POST", body: { ...v, delivery_cost_type: v.delivery_cost_type || null } });
      toast.ok("Categoría guardada.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={c ? `Categoría ${c.name}` : "Nueva categoría"} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-cat" loading={guardando}>Guardar</Button></>}>
      {!op ? <Vacio>Cargando…</Vacio> : (
        <form id="f-cat" className="space-y-3" onSubmit={guardar}>
          {error && <Alert tone="bad">{error}</Alert>}
          {c && c.gastos > 0 && <Alert tone="info">Tiene {c.gastos} gastos registrados: los cambios valen para los nuevos.</Alert>}
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
            <Field label="Código" required><Input value={v.code} maxLength={40} onChange={(e) => pon("code", e.target.value.toUpperCase())} /></Field>
            <Field label="Nombre" required><Input value={v.name} maxLength={80} onChange={(e) => pon("name", e.target.value)} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Grupo" required><Select value={v.category_group} onChange={(e) => pon("category_group", e.target.value)} placeholder="Elige" options={lista(op.grupos)} /></Field>
            <Field label="Área por defecto" required><Select value={v.default_area} onChange={(e) => pon("default_area", e.target.value)} placeholder="Elige" options={lista(op.areas)} /></Field>
          </div>
          {v.category_group === "DELIVERY" && (
            <Field label="Tipo de costo de reparto" required hint="Al aprobarse, el gasto entra a Delivery como este costo, sin IGV.">
              <Select value={v.delivery_cost_type} onChange={(e) => pon("delivery_cost_type", e.target.value)} placeholder="Elige" options={lista(op.costos_reparto)} />
            </Field>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Centro de costo por defecto" required><Select value={v.default_cost_center_id} onChange={(e) => pon("default_cost_center_id", e.target.value)} placeholder="Elige" options={op.centros.map((x) => ({ value: x.id, label: `${x.name} (${x.code})` }))} /></Field>
            <Field label="Comprobante habitual" required><Select value={v.default_doc_type} onChange={(e) => pon("default_doc_type", e.target.value)} options={lista(op.documentos)} /></Field>
          </div>
          <fieldset className="space-y-2 rounded-lg border border-line p-3">
            <legend className="px-1 text-[12.5px] font-semibold text-ink">Qué exige al registrar</legend>
            <Checkbox checked={v.requires_vehicle} onChange={(x) => pon("requires_vehicle", x)} label="Vehículo" />
            <Checkbox checked={v.requires_gallons} onChange={(x) => pon("requires_gallons", x)} label="Galones del vale (combustible)" />
            <Checkbox checked={v.requires_employee} onChange={(x) => pon("requires_employee", x)} label="Repartidor o trabajador" />
            <Checkbox checked={v.requires_supplier} onChange={(x) => pon("requires_supplier", x)} label="Proveedor" />
            <Checkbox checked={v.requires_campaign} onChange={(x) => pon("requires_campaign", x)} label="Campaña de publicidad" />
          </fieldset>
          <Field label="Estado"><Select value={v.status} onChange={(e) => pon("status", e.target.value)} options={[{ value: "ACTIVE", label: "Activa" }, { value: "INACTIVE", label: "Inactiva" }]} /></Field>
        </form>
      )}
    </Modal>
  );
}
