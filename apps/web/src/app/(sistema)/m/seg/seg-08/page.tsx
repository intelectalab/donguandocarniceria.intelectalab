"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Lock, ShieldCheck, UserPlus, UserX, Users } from "lucide-react";
import { Badge, Button, Cifra, DataTable, Modal, PageHeader, Select, StatusBadge, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fechaHora, numero, porcentaje } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { UsuarioForm } from "@/modulos/seg/UsuarioForm";
import { ESTADOS_USUARIO, alcanceDe, type Opciones, type Resumen, type Usuario } from "@/modulos/seg/tipos";

/** SEG-08 Usuarios: rol, alcance, estado, segundo factor y último ingreso de cada persona; alta e invitación por correo. */
export default function Usuarios() {
  const router = useRouter();
  const { can } = useSesion();
  const [rol, setRol] = useState("");
  const [local, setLocal] = useState("");
  const [marca, setMarca] = useState("");
  const [estado, setEstado] = useState("");
  const lista = useListado<Usuario>("/v1/seg/usuarios", { orden: "name", filtros: { role: rol, establishment_id: local, brand_id: marca, status: estado } });
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [opciones, setOpciones] = useState<Opciones | null>(null);
  const [invitando, setInvitando] = useState(false);
  const [version, setVersion] = useState(0);
  const puedeGestionar = can("seg.user.manage");

  useEffect(() => {
    let vigente = true;
    api<Resumen>("/v1/seg/usuarios/resumen").then((r) => vigente && setResumen(r)).catch(() => {});
    api<Opciones>("/v1/seg/usuarios/opciones").then((o) => vigente && setOpciones(o)).catch(() => {});
    return () => { vigente = false; };
  }, [version]);

  const recargar = () => { lista.recargar(); setVersion((n) => n + 1); };
  const r = resumen;

  const columnas: Column<Usuario>[] = [
    { key: "name", header: "Nombre", sortable: true, cardTitle: true, render: (u) => (
      <div className="min-w-0">
        <p className="font-semibold">{u.name}</p>
        <p className="truncate font-mono text-[12px] text-muted">{u.email}</p>
      </div>
    ) },
    { key: "roles_names", header: "Rol", sortable: true, render: (u) => u.roles_names ?? <span className="text-muted">Sin rol</span> },
    { key: "alcance", header: "Alcance", hideOnMobile: true, render: (u) => <span className="text-[13px]">{alcanceDe(u)}</span> },
    { key: "estado", header: "Estado", sortable: true, render: (u) => <StatusBadge status={u.estado} labels={ESTADOS_USUARIO} /> },
    { key: "mfa", header: "Segundo factor", hideOnMobile: true, render: (u) => u.twofa_enabled ? <Badge tone="ok">Activo</Badge>
      : u.exige_2fa ? <Badge tone="warn">Falta</Badge> : <span className="text-[12.5px] text-muted">No exige</span> },
    { key: "last_login", header: "Último ingreso", sortable: true, hideOnMobile: true, render: (u) => u.last_login ? fechaHora(u.last_login) : <span className="text-muted">Nunca</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Rol, alcance, estado, segundo factor y último ingreso de cada persona. Los usuarios no se borran: se desactivan, y eso cierra su acceso al instante."
        actions={puedeGestionar && <Button variant="primary" icon={UserPlus} onClick={() => setInvitando(true)} disabled={!opciones}>Invitar usuario</Button>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Cifra titulo="Activos" valor={r ? numero(r.activos) : undefined} detalle={r ? `${numero(r.total)} en total` : undefined} icono={Users} destacada />
        <Cifra titulo="Bloqueados" valor={r ? numero(r.bloqueados) : undefined} detalle={r?.bloqueados ? "Revisa la ficha para desbloquear" : "Ninguno"} icono={Lock} tono={r?.bloqueados ? "bad" : "ok"} />
        <Cifra titulo="Inactivos" valor={r ? numero(r.inactivos) : undefined} detalle={r ? `${numero(r.invitados)} invitado${r.invitados === 1 ? "" : "s"} sin contraseña` : undefined} icono={UserX} />
        <Cifra titulo="Cobertura del segundo factor" valor={r ? porcentaje(r.cobertura_2fa) : undefined} icono={ShieldCheck}
          detalle={r ? `${numero(r.con_2fa)} de ${numero(r.exigen_2fa)} que lo exigen` : undefined} tono={r && r.cobertura_2fa < 100 ? "warn" : "ok"} />
        <Cifra titulo="Sin uso" valor={r ? numero(r.sin_uso) : undefined} detalle={r ? `activos sin ingresar en ${r.dias_sin_uso} días` : undefined} icono={Clock} tono={r?.sin_uso ? "warn" : "ok"} />
      </div>

      <DataTable {...lista.tabla} columns={columnas}
        search={{ ...lista.tabla.search, placeholder: "Buscar nombre, correo o rol…" }}
        onRowClick={(u) => router.push(`/m/seg/seg-09?id=${u.id}`)}
        empty="No hay usuarios con esos filtros."
        toolbar={<>
          <Filtro label="Rol" value={rol} onChange={setRol} options={(opciones?.roles ?? []).map((x) => ({ value: x.code, label: x.name }))} />
          <Filtro label="Local" value={local} onChange={setLocal} options={(opciones?.establishments ?? []).map((x) => ({ value: x.id, label: x.short }))} />
          <Filtro label="Marca" value={marca} onChange={setMarca} options={(opciones?.brands ?? []).map((x) => ({ value: x.id, label: x.name }))} />
          <Filtro label="Estado" value={estado} onChange={setEstado} options={Object.entries(ESTADOS_USUARIO).map(([value, [label]]) => ({ value, label }))} />
        </>} />

      {invitando && opciones && (
        <Modal open onClose={() => setInvitando(false)} size="lg" title="Invitar usuario"
          description="Recibe por correo un código para crear su contraseña. Hasta entonces queda como invitado.">
          <UsuarioForm usuario={null} opciones={opciones} onCancelar={() => setInvitando(false)}
            onGuardado={(u) => { setInvitando(false); recargar(); router.push(`/m/seg/seg-09?id=${u.id}`); }} />
        </Modal>
      )}
    </div>
  );
}

function Filtro({ label, value, onChange, options }:
  { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="w-full sm:w-[160px]">
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={`${label}: todos`} options={options}
        className="!min-h-9 h-9 py-1.5 text-[13px]" />
    </div>
  );
}
