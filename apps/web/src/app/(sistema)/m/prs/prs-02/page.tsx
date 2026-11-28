"use client";

import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DataTable, Field, IconButton, Input, Modal, PageHeader, Select, toast, confirmAction, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { ErrorCarga, useDatos, useOpciones, type Opciones, type Tipo } from "@/modulos/prs/comunes";

type Mapeo = { id: string; source: string; ref: string | null; note: string | null; etiqueta: string };
type Concepto = {
  id: string; code: string; name: string; parent_id: string | null; is_group: boolean; concept_type: Tipo; behavior: "VARIABLE" | "FIXED" | null; status: string;
  default_cost_center_id: string | null; centro: string | null; mapeos: Mapeo[]; necesita_mapeo: boolean; mapeado: boolean;
};

/** PRS-02 Conceptos presupuestales: árbol con tipo, fijo o variable, y de dónde sale su real (RN-PRS-02 y RN-PRS-06). */
export default function Conceptos() {
  const { datos: op } = useOpciones();
  const { datos, error, cargando, recargar } = useDatos<{ conceptos: Concepto[] }>("/v1/prs/conceptos");
  const [editar, setEditar] = useState<Concepto | "nuevo" | null>(null);
  if (error) return <ErrorCarga error={error} que="Los conceptos los ven quienes tienen acceso a Presupuesto." />;
  const puede = Boolean(op?.puede.conceptos);
  const filas = datos?.conceptos ?? [];
  const sinMapeo = filas.filter((c) => c.necesita_mapeo && !c.mapeado && c.status === "ACTIVE");
  const columnas: Column<Concepto>[] = [
    { key: "name", header: "Concepto", cardTitle: true, render: (c) => (
      <span className={`flex flex-col ${c.is_group ? "" : "pl-4"}`}>
        <span className={c.is_group ? "font-semibold" : "font-medium"}>{c.name}</span>
        <span className="text-[12px] text-muted">{c.code}{c.status !== "ACTIVE" ? " · inactivo" : ""}</span>
      </span>) },
    { key: "tipo", header: "Tipo", render: (c) => op?.tipos[c.concept_type] ?? c.concept_type },
    { key: "behavior", header: "Comportamiento", render: (c) => c.is_group ? "—" : c.behavior === "FIXED" ? <Badge tone="info">Fijo</Badge> : "Variable" },
    { key: "mapeos", header: "De dónde sale el real", render: (c) => c.is_group ? <span className="text-muted">Grupo</span> : c.mapeos.length
      ? <span className="flex flex-wrap gap-1">{c.mapeos.map((m) => <Badge key={m.id}>{m.etiqueta}</Badge>)}</span>
      : c.necesita_mapeo ? <Badge tone="bad">Sin mapeo</Badge> : <span className="text-muted">—</span> },
    { key: "centro", header: "Centro sugerido", hideOnMobile: true, render: (c) => c.centro ?? "—" },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="Árbol de conceptos con su tipo, si es fijo o variable (los fijos se proyectan con su presupuesto) y de dónde sale su real: ventas, costo de ventas, categorías de gasto, personal o cuentas contables."
        actions={puede ? <Button variant="primary" icon={Plus} onClick={() => setEditar("nuevo")}>Nuevo concepto</Button> : undefined} />
      {sinMapeo.length > 0 && (
        <Alert tone="warn" title={`${sinMapeo.length} concepto(s) de costo o gasto sin mapeo`}>
          {sinMapeo.map((c) => `${c.code} ${c.name}`).join(", ")}. Sin mapeo no se calcula su real y una versión que los use no se envía (RN-PRS-02).
        </Alert>)}
      <DataTable rows={filas} columns={columnas} rowKey={(c) => c.id} loading={cargando} onRowClick={(c) => setEditar(c)} empty="Sin conceptos." />
      {editar && op && <Editor op={op} c={editar === "nuevo" ? null : editar} grupos={filas.filter((x) => x.is_group)} puede={puede}
        onClose={() => setEditar(null)} onCambio={recargar} />}
    </div>
  );
}

function Editor({ op, c, grupos, puede, onClose, onCambio }: { op: Opciones; c: Concepto | null; grupos: Concepto[]; puede: boolean; onClose: () => void; onCambio: () => void }) {
  const [v, setV] = useState({
    code: c?.code ?? "", name: c?.name ?? "", parent_id: c?.parent_id ?? (c?.is_group ? "" : grupos[0]?.id ?? ""), is_group: c?.is_group ?? false,
    concept_type: c?.concept_type ?? "EXPENSE", behavior: c?.behavior ?? "VARIABLE", default_cost_center_id: c?.default_cost_center_id ?? "", status: c?.status ?? "ACTIVE",
  });
  const [mapeos, setMapeos] = useState<Mapeo[]>(c?.mapeos ?? []);
  const [m, setM] = useState({ source: "EXPENSE_CATEGORY", ref: "", note: "" });
  const [guardando, setGuardando] = useState(false);
  const pon = (k: keyof typeof v, x: string | boolean) => setV({ ...v, [k]: x });
  const tipo = v.is_group ? v.concept_type : grupos.find((g) => g.id === v.parent_id)?.concept_type ?? v.concept_type;
  const fuentes = Object.entries(op.fuentes).filter(([k]) => tipo === "INCOME" ? ["SALES", "ACCOUNT"].includes(k) : tipo === "COST_OF_SALES" ? k !== "SALES" : !["SALES", "COST_OF_SALES"].includes(k));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await api(c ? `/v1/prs/conceptos/${c.id}` : "/v1/prs/conceptos", { method: c ? "PUT" : "POST", body: {
        ...v, parent_id: v.is_group ? null : v.parent_id || null, behavior: v.is_group ? null : v.behavior, default_cost_center_id: v.default_cost_center_id || null } });
      toast.ok(c ? "Concepto guardado" : "Concepto creado");
      onCambio();
      onClose();
    } catch (x) {
      toast.error(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  async function mapear() {
    if (!c) return;
    try {
      const r = await api<{ id: string; source: string; ref: string | null; note: string | null }>(`/v1/prs/conceptos/${c.id}/mapeos`, { method: "POST", body: { source: m.source, ref: m.ref || null, note: m.note || null } });
      const etiqueta = m.source === "EXPENSE_CATEGORY" ? `GAS · ${op.categorias.find((x) => x.id === m.ref)?.name ?? ""}` : m.source === "PAYROLL" ? `PER · ${op.personal[m.ref]}` : m.source === "ACCOUNT" ? `CNT · cuenta ${m.ref}` : op.fuentes[m.source];
      setMapeos([...mapeos, { ...r, etiqueta }]);
      setM({ ...m, ref: "", note: "" });
      toast.ok("Mapeo agregado");
      onCambio();
    } catch (x) {
      toast.error(mensajeDe(x));
    }
  }
  async function quitar(x: Mapeo) {
    if (!(await confirmAction({ title: `¿Quitar ${x.etiqueta}?`, message: "Desde ahora ese real ya no entra en este concepto.", confirmLabel: "Quitar", danger: true }))) return;
    try {
      await api(`/v1/prs/mapeos/${x.id}`, { method: "DELETE" });
      setMapeos(mapeos.filter((y) => y.id !== x.id));
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }
  return (
    <Modal open onClose={onClose} title={c ? `${c.code} · ${c.name}` : "Nuevo concepto"} dismissable={!guardando} size="lg"
      footer={puede ? <><Button onClick={onClose}>Cerrar</Button><Button variant="primary" type="submit" form="f-prs-concepto" loading={guardando}>Guardar</Button></> : <Button onClick={onClose}>Cerrar</Button>}>
      <form id="f-prs-concepto" onSubmit={guardar} className="space-y-3">
        <fieldset disabled={!puede} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Código" required><Input value={v.code} maxLength={20} onChange={(e) => pon("code", e.target.value.toUpperCase())} /></Field>
            <Field label="Estado"><Select value={v.status} onChange={(e) => pon("status", e.target.value)} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} /></Field>
          </div>
          <Field label="Nombre" required><Input value={v.name} maxLength={120} onChange={(e) => pon("name", e.target.value)} /></Field>
          {!c && <Checkbox label="Es un grupo (agrupa conceptos de detalle)" checked={v.is_group} onChange={(x) => pon("is_group", x)} />}
          {v.is_group
            ? <Field label="Tipo"><Select value={v.concept_type} onChange={(e) => pon("concept_type", e.target.value)} options={Object.entries(op.tipos).map(([k, x]) => ({ value: k, label: x }))} /></Field>
            : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Grupo" required><Select value={v.parent_id} onChange={(e) => pon("parent_id", e.target.value)} options={grupos.map((g) => ({ value: g.id, label: `${g.code} · ${g.name}` }))} /></Field>
                <Field label="Comportamiento" hint="Fijo: la proyección usa su presupuesto (RN-PRS-08)."><Select value={v.behavior ?? "VARIABLE"} onChange={(e) => pon("behavior", e.target.value)}
                  options={[{ value: "VARIABLE", label: "Variable" }, { value: "FIXED", label: "Fijo" }]} /></Field>
              </div>}
          {!v.is_group && <Field label="Centro de costo sugerido"><Select value={v.default_cost_center_id} placeholder="Ninguno" onChange={(e) => pon("default_cost_center_id", e.target.value)}
            options={op.centros.map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }))} /></Field>}
        </fieldset>
      </form>
      {c && !c.is_group && (
        <div className="mt-5 space-y-3 border-t border-line pt-4">
          <h2 className="text-[14px] font-semibold">De dónde sale el real</h2>
          {mapeos.length ? (
            <ul className="space-y-1.5">
              {mapeos.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[13px]">
                  <span>{x.etiqueta}{x.note && <span className="block text-[12px] text-muted">{x.note}</span>}</span>
                  {puede && <IconButton icon={Trash2} label="Quitar mapeo" onClick={() => quitar(x)} />}
                </li>))}
            </ul>) : <Alert tone="warn">Sin mapeo: su real no se calcula{c.necesita_mapeo ? " y una versión que lo use no se envía (RN-PRS-02)" : ""}.</Alert>}
          {puede && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field label="Fuente"><Select value={m.source} onChange={(e) => setM({ ...m, source: e.target.value, ref: "" })} options={fuentes.map(([k, x]) => ({ value: k, label: x }))} /></Field>
              {m.source === "EXPENSE_CATEGORY" && <Field label="Categoría de gasto"><Select value={m.ref} placeholder="Elige" onChange={(e) => setM({ ...m, ref: e.target.value })}
                options={op.categorias.map((x) => ({ value: x.id, label: x.name }))} /></Field>}
              {m.source === "PAYROLL" && <Field label="Costo de personal"><Select value={m.ref} placeholder="Elige" onChange={(e) => setM({ ...m, ref: e.target.value })}
                options={Object.entries(op.personal).map(([k, x]) => ({ value: k, label: x }))} /></Field>}
              {m.source === "ACCOUNT" && <Field label="Cuenta contable (PCGE)"><Input value={m.ref} inputMode="numeric" maxLength={8} placeholder="6321" onChange={(e) => setM({ ...m, ref: e.target.value.replace(/\D/g, "") })} /></Field>}
              {["SALES", "COST_OF_SALES"].includes(m.source) && <div />}
              <Button onClick={mapear} icon={Plus}>Agregar</Button>
            </div>)}
          <p className="text-[12px] text-muted">Cada fuente cuenta una sola vez (RN-PRS-06). Las cuentas contables aportan cuando la contabilidad (CNT) esté instalada.</p>
        </div>)}
    </Modal>
  );
}
