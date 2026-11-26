"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Badge, Button, DataTable, Field, Input, PageHeader, Select, StatusBadge, Switch, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { FiltroSelect, Sub, opciones, qs, useAlAbrir, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { ESTADO_CUENTA, ROL_PORTAL, type Acceso, type Opciones } from "@/modulos/b2b/tipos";

/** B2B-11 Accesos al portal: usuarios de cada cliente con su rol, invitación y desactivación. */
export default function Accesos() {
  const op = useOpcionesDe<Opciones>("/v1/b2b/opciones");
  const [cliente, setCliente] = useState("");
  useAlAbrir((p) => setCliente(p.get("cliente") ?? ""));
  const r = useDatos<{ data: Acceso[] }>(`/v1/b2b/accesos${qs({ customer_id: cliente })}`);
  const [invitar, setInvitar] = useState(false);
  const gestiona = Boolean(op?.can["b2b.portal.manage_users"]);

  async function activar(a: Acceso, v: boolean) {
    try { await api(`/v1/b2b/accesos/${a.id}/activo`, { method: "POST", body: { active: v } }); toast.ok(v ? "Acceso activado" : "Acceso desactivado"); r.recargar(); } catch (e) { toast.error(mensajeDe(e)); }
  }

  const columnas: Column<Acceso>[] = [
    { key: "name", header: "Usuario", cardTitle: true, render: (a) => <div><p className="font-medium">{a.name}</p><Sub>{a.email}</Sub></div> },
    { key: "customer_name", header: "Empresa", render: (a) => a.customer_name },
    { key: "portal_role", header: "Rol", render: (a) => <div><Badge tone={a.portal_role === "OWNER" ? "info" : "neutral"}>{ROL_PORTAL[a.portal_role]}</Badge>
      <Sub>{[a.can_order && "pide", a.can_view_statement && "ve el estado de cuenta"].filter(Boolean).join(" · ")}</Sub></div> },
    { key: "last_login", header: "Último ingreso", render: (a) => a.last_login ? fechaHora(a.last_login) : <span className="text-muted">Nunca</span> },
    { key: "status", header: "Estado", render: (a) => <StatusBadge status={a.status} labels={ESTADO_CUENTA} /> },
    { key: "active", header: "Activo", render: (a) => <Switch checked={a.status !== "DISABLED"} disabled={!gestiona} label={`Acceso de ${a.name}`} onChange={(v) => activar(a, v)} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Cada usuario del portal ve solo los pedidos, comprobantes y reclamos de su empresa. El dueño puede invitar a compradores y a contabilidad desde el propio portal."
        actions={gestiona && <Button variant="primary" icon={UserPlus} disabled={!op} onClick={() => setInvitar(true)}>Invitar usuario</Button>} />
      <DataTable columns={columnas} rows={r.datos?.data ?? []} loading={r.cargando} error={r.error} onRetry={r.recargar} empty="No hay usuarios del portal."
        toolbar={<FiltroSelect label="Cliente" value={cliente} onChange={setCliente} ancho="sm:w-[280px]" options={(op?.customers ?? []).filter((c) => c.has_credit).map((c) => ({ value: c.id, label: c.full_name }))} />} />
      {invitar && op && <Invitar op={op} cliente={cliente} onClose={() => setInvitar(false)} onHecho={() => { setInvitar(false); r.recargar(); }} />}
    </div>
  );
}

function Invitar({ op, cliente, onClose, onHecho }: { op: Opciones; cliente: string; onClose: () => void; onHecho: () => void }) {
  const [f, setF] = useState({ customer_id: cliente, name: "", email: "", portal_role: "OWNER" });
  return (
    <Dialogo titulo="Invitar al portal" boton="Enviar invitación" onClose={onClose} aviso="Recibe un correo para crear su contraseña. El primer usuario de la empresa queda como dueño."
      enviar={async () => { await api("/v1/b2b/accesos", { method: "POST", body: f }); toast.ok("Invitación enviada"); onHecho(); }}>
      {(e) => <>
        <Field label="Empresa" required error={e.customer_id} className="sm:col-span-2"><Select value={f.customer_id} onChange={(x) => setF({ ...f, customer_id: x.target.value })} placeholder="Elige el cliente"
          options={op.customers.filter((c) => c.has_credit).map((c) => ({ value: c.id, label: c.full_name }))} /></Field>
        <Field label="Nombre" required error={e.name}><Input value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} /></Field>
        <Field label="Correo" required error={e.email}><Input type="email" value={f.email} onChange={(x) => setF({ ...f, email: x.target.value })} /></Field>
        <Field label="Rol" required error={e.portal_role}><Select value={f.portal_role} onChange={(x) => setF({ ...f, portal_role: x.target.value })} options={opciones(ROL_PORTAL)} /></Field>
      </>}
    </Dialogo>
  );
}
