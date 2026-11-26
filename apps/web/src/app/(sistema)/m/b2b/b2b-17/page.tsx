"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, Input, PageHeader, Select, StatusBadge, Switch, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { Sub, useDatos } from "@/modulos/canales/comunes";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { ESTADO_CUENTA, ROL_PORTAL, type Acceso } from "@/modulos/b2b/tipos";

/** B2B-17 Portal · Usuarios de mi empresa: el dueño invita a compradores y a contabilidad, y los desactiva. */
export default function MisUsuarios() {
  const r = useDatos<{ data: Acceso[]; is_owner: boolean }>("/v1/b2b/portal/usuarios");
  const [invitar, setInvitar] = useState(false);
  const duenio = Boolean(r.datos?.is_owner);
  async function activar(a: Acceso, v: boolean) {
    try { await api(`/v1/b2b/portal/usuarios/${a.id}/activo`, { method: "POST", body: { active: v } }); toast.ok(v ? "Usuario activado" : "Usuario desactivado"); r.recargar(); } catch (e) { toast.error(mensajeDe(e)); }
  }
  const columnas: Column<Acceso>[] = [
    { key: "name", header: "Usuario", cardTitle: true, render: (a) => <div><p className="font-medium">{a.name}</p><Sub>{a.email}</Sub></div> },
    { key: "portal_role", header: "Rol", render: (a) => <div><Badge tone={a.portal_role === "OWNER" ? "info" : "neutral"}>{ROL_PORTAL[a.portal_role]}</Badge><Sub>{a.can_order ? "Hace pedidos" : "Solo consulta"}</Sub></div> },
    { key: "last_login", header: "Último ingreso", render: (a) => a.last_login ? fechaHora(a.last_login) : <span className="text-muted">Nunca</span> },
    { key: "status", header: "Estado", render: (a) => <StatusBadge status={a.status} labels={ESTADO_CUENTA} /> },
    { key: "active", header: "Activo", render: (a) => a.portal_role === "OWNER" ? null : <Switch checked={a.status !== "DISABLED"} disabled={!duenio} label={`Acceso de ${a.name}`} onChange={(v) => activar(a, v)} /> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Las personas de tu empresa que usan el portal. Compradores hacen pedidos; contabilidad ve comprobantes y estado de cuenta."
        actions={duenio && <Button variant="primary" icon={UserPlus} onClick={() => setInvitar(true)}>Invitar</Button>} />
      {r.datos && !duenio && <Alert tone="info">Solo el dueño de la cuenta invita o desactiva usuarios.</Alert>}
      <DataTable columns={columnas} rows={r.datos?.data ?? []} loading={r.cargando} error={r.error} empty="Sin usuarios." />
      {invitar && <Invitar onClose={() => setInvitar(false)} onHecho={() => { setInvitar(false); r.recargar(); }} />}
    </div>
  );
}

function Invitar({ onClose, onHecho }: { onClose: () => void; onHecho: () => void }) {
  const [f, setF] = useState({ name: "", email: "", portal_role: "BUYER" });
  return (
    <Dialogo titulo="Invitar a alguien de tu empresa" boton="Enviar invitación" onClose={onClose} aviso="Le llega un correo para crear su contraseña."
      enviar={async () => { await api("/v1/b2b/portal/usuarios", { method: "POST", body: f }); toast.ok("Invitación enviada"); onHecho(); }}>
      {(e) => <>
        <Field label="Nombre" required error={e.name}><Input value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} /></Field>
        <Field label="Correo" required error={e.email}><Input type="email" value={f.email} onChange={(x) => setF({ ...f, email: x.target.value })} /></Field>
        <Field label="Rol" required error={e.portal_role}><Select value={f.portal_role} onChange={(x) => setF({ ...f, portal_role: x.target.value })}
          options={[{ value: "BUYER", label: "Comprador: hace pedidos" }, { value: "ACCOUNTING", label: "Contabilidad: comprobantes y estado de cuenta" }]} /></Field>
      </>}
    </Dialogo>
  );
}
