"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge, Button, Checkbox, DataTable, Field, Input, PageHeader, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { num, olvidarOpciones, useDatos } from "@/modulos/alm/comunes";
import type { Num } from "@/modulos/alm/tipos";

type Motivo = { id: string; code: string; name: string; requires_photo: boolean; approval_above_pen: Num; counts_as_expired: boolean; status: string; uses: number; approved_cost: Num };

/** ALM-13 Motivos de merma: foto obligatoria, umbral de aprobación y si cuenta como vencido. */
export default function Motivos() {
  const { can, puede } = useSesion();
  const { datos, cargando, error, recargar } = useDatos<{ data: Motivo[] }>("/v1/alm/motivos?todos=1");
  const [editando, setEditando] = useState<Motivo | null | undefined>(undefined);
  const edita = can("alm.waste.approve") && puede("ALM", "E");
  const costos = can("alm.stock.view_cost");

  const columnas: Column<Motivo>[] = [
    { key: "code", header: "Código", render: (m) => <span className="font-mono font-semibold">{m.code}</span> },
    { key: "name", header: "Motivo", cardTitle: true, render: (m) => <span className="font-medium">{m.name}</span> },
    { key: "requires_photo", header: "Foto", render: (m) => m.requires_photo ? <Badge tone="info">Obligatoria</Badge> : <span className="text-muted">Opcional</span> },
    { key: "approval_above_pen", header: "Aprobación sobre", align: "right", render: (m) => soles(m.approval_above_pen) },
    { key: "counts_as_expired", header: "Vencido", render: (m) => m.counts_as_expired ? <Badge tone="warn">Cuenta como vencido</Badge> : <span className="text-muted">No</span> },
    { key: "uses", header: "Usos", align: "right", hideOnMobile: true, render: (m) => numero(m.uses) },
    ...(costos ? [{ key: "approved_cost", header: "Aprobado", align: "right", hideOnMobile: true, render: (m: Motivo) => soles(m.approved_cost) }] as Column<Motivo>[] : []),
    { key: "status", header: "Estado", render: (m) => <StatusBadge status={m.status} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Los motivos con que se registra una merma. Sobre el umbral, la merma la aprueba quien tiene el permiso; los que cuentan como vencido van al indicador de vencidos."
        actions={edita && puede("ALM", "C") && <Button variant="primary" icon={Plus} onClick={() => setEditando(null)}>Nuevo motivo</Button>} />
      <DataTable columns={columnas} rows={datos?.data ?? []} loading={cargando} error={error} onRetry={recargar}
        onRowClick={edita ? setEditando : undefined} empty="No hay motivos." />
      {editando !== undefined && <MotivoForm motivo={editando} onClose={() => setEditando(undefined)} onGuardado={() => { setEditando(undefined); olvidarOpciones(); recargar(); }} />}
    </div>
  );
}

function MotivoForm({ motivo, onClose, onGuardado }: { motivo: Motivo | null; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ code: motivo?.code ?? "", name: motivo?.name ?? "", requires_photo: motivo?.requires_photo ?? false,
    approval_above_pen: motivo?.approval_above_pen?.toString() ?? "0", counts_as_expired: motivo?.counts_as_expired ?? false, status: motivo?.status ?? "ACTIVE" });
  return (
    <Dialogo titulo={motivo ? `Editar ${motivo.name}` : "Nuevo motivo"} boton="Guardar" onClose={onClose}
      enviar={async () => {
        await api(motivo ? `/v1/alm/motivos/${motivo.id}` : "/v1/alm/motivos", { method: motivo ? "PUT" : "POST", body: { ...f, approval_above_pen: num(f.approval_above_pen) } });
        toast.ok("Motivo guardado");
        onGuardado();
      }}>
      {(e) => <>
        <Field label="Código" required error={e.code}><Input value={f.code} onChange={(x) => setF({ ...f, code: x.target.value.toUpperCase() })} maxLength={10} /></Field>
        <Field label="Nombre" required error={e.name}><Input value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} maxLength={80} /></Field>
        <Field label="Aprobación sobre (S/)" required error={e.approval_above_pen} hint="0: toda merma la aprueba quien tiene el permiso">
          <Input inputMode="decimal" value={f.approval_above_pen} onChange={(x) => setF({ ...f, approval_above_pen: x.target.value })} />
        </Field>
        <Field label="Estado" error={e.status}><Select value={f.status} onChange={(x) => setF({ ...f, status: x.target.value })} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} /></Field>
        <Checkbox checked={f.requires_photo} onChange={(v) => setF({ ...f, requires_photo: v })} label="Exige foto" />
        <Checkbox checked={f.counts_as_expired} onChange={(v) => setF({ ...f, counts_as_expired: v })} label="Cuenta como vencido" />
      </>}
    </Dialogo>
  );
}
