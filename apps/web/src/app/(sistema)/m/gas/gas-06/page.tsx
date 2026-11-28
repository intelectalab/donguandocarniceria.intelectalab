"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Alert, Button, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { soles } from "@/lib/formato";
import { SinPermiso, Vacio, useDatos, useOpciones, usePermisosGas } from "@/modulos/gas/comunes";
import { NIVELES } from "@/modulos/gas/tipos";

type Regla = {
  id: string; min_amount: number; max_amount: number | null; level: number; nivel: string; category_id: string | null; categoria: string | null;
  establishment_id: string | null; local: string | null; status: string; note: string | null;
};

/** GAS-06 Reglas de aprobación: montos por nivel; una regla de categoría o de local manda sobre la general (RN-GAS-07). */
export default function Reglas() {
  const p = usePermisosGas();
  const { datos, error, cargando, recargar } = useDatos<Regla[]>("/v1/gas/reglas");
  const [editar, setEditar] = useState<Regla | "nueva" | null>(null);
  if (cargando) return <Vacio>Cargando…</Vacio>;
  if (error) return error.includes("permiso") ? <SinPermiso que="Tu rol no ve las reglas de aprobación." /> : <Alert tone="bad">{error}</Alert>;
  const columnas: Column<Regla>[] = [
    { key: "rango", header: "Monto en soles", cardTitle: true, render: (r) => <span className="font-medium">{soles(r.min_amount)} {r.max_amount !== null ? `a ${soles(r.max_amount)}` : "o más"}</span> },
    { key: "level", header: "Aprueba", render: (r) => NIVELES[r.level] },
    { key: "alcance", header: "Para", render: (r) => [r.categoria, r.local].filter(Boolean).join(" · ") || "Todos los gastos" },
    { key: "note", header: "Nota", hideOnMobile: true, render: (r) => r.note ?? "—" },
    { key: "status", header: "Estado", render: (r) => <StatusBadge status={r.status} /> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="El nivel sale del monto en soles. Una regla para una categoría o un local manda sobre la general. Las reglas activas del mismo alcance no se cruzan."
        actions={p.config && <Button variant="primary" icon={Plus} onClick={() => setEditar("nueva")}>Regla</Button>} />
      {!p.config && <Alert tone="info">Tu rol ve las reglas; las cambia administración.</Alert>}
      <DataTable rows={datos ?? []} columns={columnas} onRowClick={p.config ? (r) => setEditar(r) : undefined} empty="Sin reglas: se usan los topes de S/ 300 y S/ 2000." />
      {editar && <Formulario r={editar === "nueva" ? null : editar} onClose={() => setEditar(null)} onListo={() => { setEditar(null); recargar(); }} />}
    </div>
  );
}

function Formulario({ r, onClose, onListo }: { r: Regla | null; onClose: () => void; onListo: () => void }) {
  const { datos: op } = useOpciones();
  const [v, setV] = useState({ min_amount: String(r?.min_amount ?? "0"), max_amount: r?.max_amount !== null && r?.max_amount !== undefined ? String(r.max_amount) : "",
    level: String(r?.level ?? 1), category_id: r?.category_id ?? "", establishment_id: r?.establishment_id ?? "", note: r?.note ?? "", status: r?.status ?? "ACTIVE" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const pon = (k: keyof typeof v, x: string) => setV((y) => ({ ...y, [k]: x }));
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await api(r ? `/v1/gas/reglas/${r.id}` : "/v1/gas/reglas", { method: r ? "PUT" : "POST", body: { ...v, level: Number(v.level), max_amount: v.max_amount === "" ? null : v.max_amount,
        category_id: v.category_id || null, establishment_id: v.establishment_id || null } });
      toast.ok("Regla guardada.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={r ? "Regla de aprobación" : "Nueva regla"} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-regla" loading={guardando}>Guardar</Button></>}>
      {!op ? <Vacio>Cargando…</Vacio> : (
        <form id="f-regla" className="space-y-3" onSubmit={guardar}>
          {error && <Alert tone="bad">{error}</Alert>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Desde (S/)" required><Input inputMode="decimal" value={v.min_amount} onChange={(e) => pon("min_amount", e.target.value)} /></Field>
            <Field label="Hasta (S/)" hint="Vacío: sin tope"><Input inputMode="decimal" value={v.max_amount} onChange={(e) => pon("max_amount", e.target.value)} /></Field>
          </div>
          <Field label="Aprueba" required><Select value={v.level} onChange={(e) => pon("level", e.target.value)} options={[1, 2, 3].map((n) => ({ value: String(n), label: NIVELES[n] }))} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Solo para la categoría"><Select value={v.category_id} onChange={(e) => pon("category_id", e.target.value)} placeholder="Todas" options={op.categorias.map((c) => ({ value: c.id, label: c.name }))} /></Field>
            <Field label="Solo para el local"><Select value={v.establishment_id} onChange={(e) => pon("establishment_id", e.target.value)} placeholder="Todos" options={op.locales.map((l) => ({ value: l.id, label: l.name }))} /></Field>
          </div>
          <Field label="Nota"><Textarea rows={2} maxLength={255} value={v.note} onChange={(e) => pon("note", e.target.value)} /></Field>
          <Field label="Estado"><Select value={v.status} onChange={(e) => pon("status", e.target.value)} options={[{ value: "ACTIVE", label: "Activa" }, { value: "INACTIVE", label: "Inactiva" }]} /></Field>
        </form>
      )}
    </Modal>
  );
}
