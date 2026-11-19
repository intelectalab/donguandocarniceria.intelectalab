"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound, Lock, Mail, Pencil, Plus, ShieldOff, Unlock, UserX } from "lucide-react";
import { Badge, Button, DataTable, Field, IconButton, Input, Modal, PageHeader, Select, StatusBadge, confirmAction, toast, type Column } from "@/components/ui";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { erroresDe, mensajeDe } from "@/lib/api";
import { apiConsola } from "@/lib/consola";
import { fechaHora } from "@/lib/formato";

type Usuario = {
  id: string; email: string; full_name: string; role: string; role_name: string; status: string; status_name: string;
  twofa_enabled_at: string | null; last_login_at: string | null; disabled_reason: string | null; sesiones: number;
};
type Respuesta = { data: Usuario[]; roles: { code: string; name: string }[]; dominio: string };

const ESTADOS: Record<string, [string, "ok" | "warn" | "bad" | "neutral"]> = {
  ACTIVE: ["Activo", "ok"], INVITED: ["Invitado", "warn"], LOCKED: ["Bloqueado", "bad"], DISABLED: ["De baja", "neutral"],
};

/** OPS-12 Usuarios de plataforma: alta, rol, segundo factor obligatorio (RN-OPS-01), bloqueo y baja del personal de Intelectalab. */
export default function UsuariosPlataforma() {
  const yo = useUsuarioConsola();
  const puede = yo.puede["users.manage"];
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");
  const [editando, setEditando] = useState<Usuario | "nuevo" | null>(null);

  const cargar = useCallback(() => {
    apiConsola<Respuesta>("/usuarios").then((d) => { setDatos(d); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function estado(u: Usuario, status: "ACTIVE" | "LOCKED" | "DISABLED") {
    const titulo = { ACTIVE: `¿Reactivar a ${u.full_name}?`, LOCKED: `¿Bloquear a ${u.full_name}?`, DISABLED: `¿Dar de baja a ${u.full_name}?` }[status];
    const r = await confirmAction({ title: titulo, message: status === "ACTIVE" ? undefined : "Se cierran sus sesiones abiertas de la consola.",
      confirmLabel: { ACTIVE: "Reactivar", LOCKED: "Bloquear", DISABLED: "Dar de baja" }[status], danger: status !== "ACTIVE", reason: { min: 5 } });
    if (!r) return;
    try {
      await apiConsola(`/usuarios/${u.id}/estado`, { method: "POST", body: { status, reason: r.reason } });
      toast.ok({ ACTIVE: "Usuario reactivado", LOCKED: "Usuario bloqueado", DISABLED: "Usuario dado de baja" }[status]);
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  async function reiniciar(u: Usuario) {
    const r = await confirmAction({ title: `¿Reiniciar el segundo factor de ${u.full_name}?`, danger: true, confirmLabel: "Reiniciar",
      message: "Vuelve a invitado, se cierran sus sesiones y le llega un código nuevo para crear su contraseña y configurar su app.", reason: { min: 5 } });
    if (!r) return;
    try {
      await apiConsola(`/usuarios/${u.id}/reiniciar-2fa`, { method: "POST", body: { reason: r.reason } });
      toast.ok("Segundo factor reiniciado: le llegó un código nuevo");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  async function reenviar(u: Usuario) {
    try {
      await apiConsola(`/usuarios/${u.id}/reenviar`, { method: "POST" });
      toast.ok(`Se envió un código nuevo a ${u.email}`);
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const columnas: Column<Usuario>[] = [
    { key: "full_name", header: "Usuario", render: (u) => (
      <div className="min-w-0">
        <p className="font-semibold text-ink">{u.full_name}{u.id === yo.id && <span className="ml-1.5 text-[12px] font-normal text-muted">(tú)</span>}</p>
        <p className="text-[12.5px] text-muted">{u.email}</p>
      </div>
    ) },
    { key: "role_name", header: "Rol" },
    { key: "status", header: "Estado", render: (u) => (
      <div className="grid gap-0.5">
        <StatusBadge status={u.status} labels={ESTADOS} />
        {u.disabled_reason && <span className="text-[12px] text-muted">{u.disabled_reason}</span>}
      </div>
    ) },
    { key: "twofa", header: "Segundo factor", render: (u) => u.twofa_enabled_at ? <Badge tone="ok">Configurado</Badge> : <Badge tone="warn">Pendiente</Badge> },
    { key: "last_login_at", header: "Último ingreso", hideOnMobile: true, render: (u) => u.last_login_at ? fechaHora(u.last_login_at) : "Nunca" },
    { key: "sesiones", header: "Sesiones abiertas", align: "right", hideOnMobile: true },
    ...(puede ? [{ key: "acciones", header: "Acciones", align: "right" as const, hideInCard: false, render: (u: Usuario) => u.id === yo.id ? <span className="text-[12px] text-muted">—</span> : (
      <div className="flex justify-end gap-0.5">
        <IconButton icon={Pencil} label="Editar nombre o rol" onClick={() => setEditando(u)} />
        {u.status === "INVITED" && <IconButton icon={Mail} label="Reenviar invitación" onClick={() => reenviar(u)} />}
        {u.status === "ACTIVE" && <IconButton icon={Lock} label="Bloquear" onClick={() => estado(u, "LOCKED")} />}
        {(u.status === "LOCKED" || u.status === "DISABLED") && u.twofa_enabled_at && <IconButton icon={Unlock} label="Reactivar" onClick={() => estado(u, "ACTIVE")} />}
        {u.status !== "DISABLED" && u.twofa_enabled_at && <IconButton icon={ShieldOff} label="Reiniciar segundo factor" onClick={() => reiniciar(u)} />}
        {u.status !== "DISABLED" && <IconButton icon={UserX} label="Dar de baja" onClick={() => estado(u, "DISABLED")} />}
      </div>
    ) }] : []),
  ];

  return (
    <div className="grid gap-5">
      <h1 className="font-display text-[22px] font-bold text-ink">Usuarios de plataforma</h1>
      <PageHeader code="OPS-12"
        description="Personal de Intelectalab en la consola. Cada cuenta se activa con su contraseña y el segundo factor obligatorio; el rol define lo que hace (administrador, cobranza, soporte, ingeniería o solo consulta)."
        actions={puede ? <Button variant="primary" icon={Plus} onClick={() => setEditando("nuevo")}>Nuevo usuario</Button> : undefined} />
      {!puede && datos && (
        <p className="flex items-center gap-2 text-[13px] text-muted"><KeyRound size={14} /> Solo un administrador de plataforma crea o cambia cuentas. Tú puedes consultarlas.</p>
      )}
      <DataTable columns={columnas} rows={datos?.data ?? []} loading={!datos && !error} error={error} onRetry={cargar} empty="Aún no hay usuarios de plataforma." />
      {editando && datos && (
        <FormularioUsuario usuario={editando === "nuevo" ? null : editando} roles={datos.roles} dominio={datos.dominio}
          onClose={() => setEditando(null)} onGuardado={() => { setEditando(null); cargar(); }} />
      )}
    </div>
  );
}

function FormularioUsuario({ usuario, roles, dominio, onClose, onGuardado }: {
  usuario: Usuario | null; roles: { code: string; name: string }[]; dominio: string; onClose: () => void; onGuardado: () => void;
}) {
  const [email, setEmail] = useState(usuario?.email ?? "");
  const [nombre, setNombre] = useState(usuario?.full_name ?? "");
  const [rol, setRol] = useState(usuario?.role ?? "SUPPORT_L1");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setErrores({});
    setGeneral("");
    setGuardando(true);
    try {
      if (usuario) await apiConsola(`/usuarios/${usuario.id}`, { method: "PUT", body: { full_name: nombre, role: rol } });
      else await apiConsola("/usuarios", { method: "POST", body: { email, full_name: nombre, role: rol } });
      toast.ok(usuario ? "Usuario actualizado" : `Usuario creado: le llegó a ${email} el código para activar su cuenta`);
      onGuardado();
    } catch (err) {
      const porCampo = erroresDe(err);
      setErrores(porCampo);
      if (!Object.keys(porCampo).length) setGeneral(mensajeDe(err));
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!guardando} title={usuario ? `Editar a ${usuario.full_name}` : "Nuevo usuario de plataforma"}
      description={usuario ? "El correo no cambia: para otra persona, crea otra cuenta." : "Queda como invitado hasta que active su cuenta con el código que le llega por correo."}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" type="submit" form="f-usuario-plataforma" loading={guardando}>Guardar</Button></>}>
      <form id="f-usuario-plataforma" onSubmit={guardar} className="grid gap-4">
        <Field label="Correo" required error={errores.email} hint={`Del dominio ${dominio}`}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={Boolean(usuario)} placeholder={`nombre@${dominio}`} autoComplete="off" />
        </Field>
        <Field label="Nombre completo" required error={errores.full_name}>
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Rol" required error={errores.role} hint="Administrador: todo. Cobranza: planes, cobros y suspender por pago. Soporte 1 y 2: tickets y accesos. Ingeniería: salud e incidentes.">
          <Select value={rol} onChange={(e) => setRol(e.target.value)} options={roles.map((r) => ({ value: r.code, label: r.name }))} />
        </Field>
        {general && <p role="alert" className="rounded-lg border border-bad/25 bg-bad-soft px-3 py-2 text-[13px] text-bad">{general}</p>}
      </form>
    </Modal>
  );
}
