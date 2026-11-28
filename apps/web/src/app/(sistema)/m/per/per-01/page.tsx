"use client";

import { useState, type FormEvent } from "react";
import { Pencil, Plus } from "lucide-react";
import { Alert, Button, Cifra, DataTable, Field, FiltroSelect, Input, Modal, PageHeader, Select, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { ErrorCarga, Estado, Vacio, useDatos, useOpciones } from "@/modulos/per/comunes";
import { ACTIVO, AREAS, FORMAS, type Opciones } from "@/modulos/per/tipos";

type Puesto = {
  id: string; code: string; name: string; area: string; area_nombre: string; establishment_id: string | null; local: string; functions: string[];
  default_role: string | null; pay_scheme: string; forma: string; status: string; trabajadores: number;
};

/** PER-01 Puestos y funciones: área, local, funciones, rol del sistema sugerido y forma de pago habitual. */
export default function Puestos() {
  const { datos: op } = useOpciones();
  const { datos, error, cargando, recargar } = useDatos<{ data: Puesto[] }>("/v1/per/puestos");
  const [area, setArea] = useState("");
  const [editar, setEditar] = useState<Puesto | "nuevo" | null>(null);
  if (error) return <ErrorCarga error={error} que="Los puestos los administra RR. HH." />;
  const gestiona = Boolean(op?.permisos.gestiona);
  const filas = (datos?.data ?? []).filter((p) => !area || p.area === area);
  const activos = (datos?.data ?? []).filter((p) => p.status === "ACTIVE");
  const columnas: Column<Puesto>[] = [
    { key: "name", header: "Puesto", cardTitle: true, render: (p) => <span className="flex flex-col"><span className="font-medium">{p.name}</span><span className="text-[12px] text-muted">{p.code}</span></span> },
    { key: "area", header: "Área", render: (p) => p.area_nombre },
    { key: "local", header: "Local", render: (p) => p.local },
    { key: "functions", header: "Funciones", hideOnMobile: true, render: (p) => <span className="line-clamp-2 text-[12.5px] text-muted">{p.functions.join(" · ") || "—"}</span> },
    { key: "default_role", header: "Rol sugerido", hideOnMobile: true, render: (p) => op?.roles.find((r) => r.code === p.default_role)?.name ?? p.default_role ?? "—" },
    { key: "forma", header: "Forma de pago", render: (p) => p.forma },
    { key: "trabajadores", header: "Personas", align: "right", render: (p) => p.trabajadores },
    { key: "status", header: "Estado", render: (p) => <Estado s={p.status} labels={ACTIVO} /> },
    ...(gestiona ? [{ key: "acc", header: "", render: (p: Puesto) => <Button size="sm" variant="ghost" icon={Pencil} onClick={(e) => { e.stopPropagation(); setEditar(p); }}>Editar</Button> }] : []),
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="Cada trabajador tiene un puesto con su área y local. El rol sugerido es el que se le propone al crearle usuario; la forma de pago es la habitual del puesto."
        actions={gestiona && <Button variant="primary" icon={Plus} onClick={() => setEditar("nuevo")}>Puesto</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Puestos activos" valor={datos ? String(activos.length) : undefined} destacada />
        <Cifra titulo="Personas con puesto" valor={datos ? String(activos.reduce((s, p) => s + p.trabajadores, 0)) : undefined} />
        <Cifra titulo="Áreas" valor={datos ? String(new Set(activos.map((p) => p.area)).size) : undefined} />
        <Cifra titulo="Sin personas" valor={datos ? String(activos.filter((p) => !p.trabajadores).length) : undefined} detalle="puestos activos vacíos" />
      </div>
      <div className="flex flex-wrap gap-2">
        <FiltroSelect etiqueta="Área" value={area} onChange={setArea} todos="todas" options={Object.entries(AREAS).map(([value, label]) => ({ value, label }))} />
      </div>
      <DataTable rows={filas} columns={columnas} loading={cargando} empty={<Vacio>No hay puestos en esta área.</Vacio>} onRowClick={gestiona ? (p) => setEditar(p) : undefined} />
      {editar && op && <Formulario op={op} puesto={editar === "nuevo" ? null : editar} onClose={() => setEditar(null)} onListo={() => { setEditar(null); recargar(); }} />}
    </div>
  );
}

function Formulario({ op, puesto, onClose, onListo }: { op: Opciones; puesto: Puesto | null; onClose: () => void; onListo: () => void }) {
  const [v, setV] = useState({
    code: puesto?.code ?? "", name: puesto?.name ?? "", area: puesto?.area ?? "SALES", establishment_id: puesto?.establishment_id ?? "",
    functions: (puesto?.functions ?? []).join("\n"), default_role: puesto?.default_role ?? "", pay_scheme: puesto?.pay_scheme ?? "MONTHLY", status: puesto?.status ?? "ACTIVE",
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const pon = (k: keyof typeof v, x: string) => setV((y) => ({ ...y, [k]: x }));
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      const body = { ...v, establishment_id: v.establishment_id || null, default_role: v.default_role || null, functions: v.functions.split("\n").map((f) => f.trim()).filter(Boolean) };
      await api(puesto ? `/v1/per/puestos/${puesto.id}` : "/v1/per/puestos", { method: puesto ? "PUT" : "POST", body });
      toast.ok(puesto ? "Puesto actualizado." : "Puesto creado.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={puesto ? `Editar ${puesto.name}` : "Nuevo puesto"} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-puesto" loading={guardando}>Guardar</Button></>}>
      <form id="f-puesto" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Código" required><Input value={v.code} maxLength={20} onChange={(e) => pon("code", e.target.value.toUpperCase())} /></Field>
          <Field label="Área" required><Select value={v.area} onChange={(e) => pon("area", e.target.value)} options={Object.entries(AREAS).map(([value, label]) => ({ value, label }))} /></Field>
        </div>
        <Field label="Nombre del puesto" required><Input value={v.name} maxLength={120} onChange={(e) => pon("name", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Local"><Select value={v.establishment_id} onChange={(e) => pon("establishment_id", e.target.value)} placeholder="Todos los locales" options={op.locales.map((l) => ({ value: l.id, label: l.short }))} /></Field>
          <Field label="Forma de pago habitual"><Select value={v.pay_scheme} onChange={(e) => pon("pay_scheme", e.target.value)} options={Object.entries(FORMAS).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Rol del sistema sugerido"><Select value={v.default_role} onChange={(e) => pon("default_role", e.target.value)} placeholder="Sin rol sugerido" options={op.roles.map((r) => ({ value: r.code, label: r.name }))} /></Field>
          <Field label="Estado"><Select value={v.status} onChange={(e) => pon("status", e.target.value)} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} /></Field>
        </div>
        <Field label="Funciones" hint="Una por línea."><Textarea rows={5} value={v.functions} onChange={(e) => pon("functions", e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
