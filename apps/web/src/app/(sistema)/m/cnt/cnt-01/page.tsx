"use client";

import { useMemo, useState } from "react";
import { BookOpen, FolderTree, Layers, Plus, Target } from "lucide-react";
import { Badge, Button, Checkbox, DataTable, Field, Input, PageHeader, Select, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { numero } from "@/lib/formato";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { CifraLink, FiltroSelect, NATURALEZA, olvidarOpcionesCnt, opciones, useDatos, useOpcionesCnt, type OpcionesCnt } from "@/modulos/cnt/comunes";

type Cuenta = {
  id: string; code: string; name: string; parent_code: string | null; level: number; acc_type: string; nature: string; postable: boolean; requires_cost_center: boolean;
  requires_third_party: boolean; requires_brand: boolean; dest_debit_code: string | null; dest_credit_code: string | null; status: string; has_moves: boolean;
};
type Respuesta = { data: Cuenta[]; types: Record<string, string> };
type Cifras = { accounts: number; postable: number; with_cost_center: number; inactive: number };

/** CNT-01 Plan de cuentas: árbol PCGE de la empresa con lo que exige cada cuenta y su amarre de destino. */
export default function PlanDeCuentas() {
  const op = useOpcionesCnt();
  const [tipo, setTipo] = useState("");
  const [detalle, setDetalle] = useState("");
  const [buscar, setBuscar] = useState("");
  const { datos: r, recargar } = useDatos<Respuesta>("/v1/cnt/cuentas");
  const c = useDatos<Cifras>("/v1/cnt/cifras/01");
  const [editar, setEditar] = useState<Cuenta | "nueva" | null>(null);
  const filas = useMemo(() => {
    const q = buscar.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return (r?.data ?? []).filter((a) => (!tipo || a.acc_type === tipo) && (!detalle || String(a.postable) === detalle)
      && (!q || a.code.startsWith(q) || a.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q)));
  }, [r, tipo, detalle, buscar]);
  const tipos = r?.types ?? op?.types ?? {};
  const columnas: Column<Cuenta>[] = [
    { key: "code", header: "Cuenta", cardTitle: true, render: (a) => (
      <div className="min-w-[220px]" style={{ paddingLeft: `${Math.max(0, a.level - 1) * 14}px` }}>
        <p className={a.postable ? "" : "font-semibold"}><span className="tabular-nums text-muted">{a.code}</span> {a.name}</p>
      </div>) },
    { key: "acc_type", header: "Tipo", hideOnMobile: true, render: (a) => tipos[a.acc_type] ?? a.acc_type },
    { key: "nature", header: "Naturaleza", hideOnMobile: true, render: (a) => NATURALEZA[a.nature] ?? a.nature },
    { key: "postable", header: "Movimientos", render: (a) => a.postable ? <Badge tone="ok">Recibe</Badge> : <span className="text-muted">Agrupa</span> },
    { key: "exige", header: "Exige", render: (a) => {
      const x = [a.requires_cost_center && "Centro de costo", a.requires_third_party && "Tercero", a.requires_brand && "Marca"].filter(Boolean);
      return x.length ? <span className="text-[12.5px]">{x.join(" · ")}</span> : <span className="text-muted">—</span>;
    } },
    { key: "dest", header: "Destino", hideOnMobile: true, render: (a) => a.dest_debit_code ? <span className="tabular-nums text-[12.5px]">{a.dest_debit_code} / {a.dest_credit_code}</span> : <span className="text-muted">—</span> },
    { key: "status", header: "Estado", render: (a) => a.status === "ACTIVE" ? <span className="text-muted">Activa</span> : <Badge tone="neutral">Inactiva</Badge> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="El plan contable de la empresa. Las cuentas que agrupan no reciben movimientos; las de detalle dicen si exigen centro de costo, tercero o marca y a qué cuentas de destino se amarran."
        actions={op?.can.accounts && <Button variant="primary" icon={Plus} onClick={() => setEditar("nueva")}>Nueva cuenta</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Cuentas" valor={c.datos ? numero(c.datos.accounts) : undefined} icono={FolderTree} onClick={() => { setDetalle(""); setTipo(""); }} />
        <CifraLink titulo="Reciben movimientos" valor={c.datos ? numero(c.datos.postable) : undefined} icono={BookOpen} onClick={() => setDetalle("true")} />
        <CifraLink titulo="Exigen centro de costo" valor={c.datos ? numero(c.datos.with_cost_center) : undefined} icono={Target} />
        <CifraLink titulo="Inactivas" valor={c.datos ? numero(c.datos.inactive) : undefined} icono={Layers} />
      </div>
      <DataTable rows={filas} rowKey={(a) => a.id} loading={!r} columns={columnas} onRowClick={op?.can.accounts ? (a) => setEditar(a) : undefined}
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar código o nombre…" }} empty="No hay cuentas con esos filtros."
        toolbar={<>
          <FiltroSelect label="Tipo" value={tipo} onChange={setTipo} options={opciones(tipos)} />
          <FiltroSelect label="Movimientos" value={detalle} onChange={setDetalle} options={[{ value: "true", label: "Reciben movimientos" }, { value: "false", label: "Solo agrupan" }]} />
        </>} />
      {editar && op && <FormCuenta op={op} cuenta={editar === "nueva" ? null : editar} tipos={tipos} onClose={() => setEditar(null)}
        onGuardado={() => { setEditar(null); recargar(); c.recargar(); olvidarOpcionesCnt(); }} />}
    </div>
  );
}

function FormCuenta({ op, cuenta, tipos, onClose, onGuardado }: { op: OpcionesCnt; cuenta: Cuenta | null; tipos: Record<string, string>; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({
    code: cuenta?.code ?? "", name: cuenta?.name ?? "", acc_type: cuenta?.acc_type ?? "EXPENSE", nature: cuenta?.nature ?? "DEBIT", postable: cuenta?.postable ?? true,
    requires_cost_center: cuenta?.requires_cost_center ?? false, requires_third_party: cuenta?.requires_third_party ?? false, requires_brand: cuenta?.requires_brand ?? false,
    dest_debit_code: cuenta?.dest_debit_code ?? "", dest_credit_code: cuenta?.dest_credit_code ?? "", status: cuenta?.status ?? "ACTIVE",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const destinos = op.accounts.map((a) => ({ value: a.code, label: `${a.code} · ${a.name}` }));
  return (
    <Dialogo titulo={cuenta ? `Cuenta ${cuenta.code}` : "Nueva cuenta"} boton="Guardar" onClose={onClose}
      aviso={cuenta?.has_moves ? "La cuenta ya tiene movimientos: sigue recibiéndolos. Para dividirla crea subcuentas nuevas y desactiva esta." : undefined}
      enviar={async () => {
        const body = { ...f, dest_debit_code: f.dest_debit_code || null, dest_credit_code: f.dest_credit_code || null };
        await api(cuenta ? `/v1/cnt/cuentas/${cuenta.id}` : "/v1/cnt/cuentas", { method: cuenta ? "PUT" : "POST", body });
        toast.ok(cuenta ? "Cuenta guardada" : `Cuenta ${f.code} creada`); onGuardado();
      }}>
      {(e) => <>
        <Field label="Código" required error={e.code} hint="De 2 a 10 dígitos; la cuenta madre debe existir"><Input value={f.code} inputMode="numeric" maxLength={10} disabled={!!cuenta} onChange={set("code")} /></Field>
        <Field label="Nombre" required error={e.name}><Input value={f.name} maxLength={200} onChange={set("name")} /></Field>
        <Field label="Tipo" error={e.acc_type}><Select value={f.acc_type} onChange={set("acc_type")} options={opciones(tipos)} /></Field>
        <Field label="Naturaleza" error={e.nature}><Select value={f.nature} onChange={set("nature")} options={opciones(NATURALEZA)} /></Field>
        <Field label="Destino al debe" error={e.dest_debit_code} hint="Amarre a clase 9"><Select value={f.dest_debit_code} placeholder="Sin destino" onChange={set("dest_debit_code")} options={destinos} /></Field>
        <Field label="Destino al haber" error={e.dest_credit_code} hint="Normalmente 79"><Select value={f.dest_credit_code} placeholder="Sin destino" onChange={set("dest_credit_code")} options={destinos} /></Field>
        <div className="grid gap-2 sm:col-span-2">
          <Checkbox checked={f.postable} onChange={(v) => setF({ ...f, postable: v })} label="Recibe movimientos (cuenta de detalle)" disabled={cuenta?.has_moves} />
          <Checkbox checked={f.requires_cost_center} onChange={(v) => setF({ ...f, requires_cost_center: v })} label="Exige centro de costo" />
          <Checkbox checked={f.requires_third_party} onChange={(v) => setF({ ...f, requires_third_party: v })} label="Exige tercero (proveedor, cliente o trabajador)" />
          <Checkbox checked={f.requires_brand} onChange={(v) => setF({ ...f, requires_brand: v })} label="Exige marca" />
          {cuenta && <Checkbox checked={f.status === "ACTIVE"} onChange={(v) => setF({ ...f, status: v ? "ACTIVE" : "INACTIVE" })} label="Activa" />}
        </div>
      </>}
    </Dialogo>
  );
}
