"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, KeyRound, Lock, LogOut, Mail, Unlock, UserCheck, UserX } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, PageHeader, Select, StatusBadge, Tabs, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { UsuarioForm } from "@/modulos/seg/UsuarioForm";
import { ESTADOS_DISPOSITIVO, ESTADOS_SESION, ESTADOS_USUARIO, PLATAFORMAS, alcanceDe, clienteDe, tonoEvento, type Acceso, type Ficha, type Opciones, type Usuario } from "@/modulos/seg/tipos";

/** SEG-09 Ficha del usuario: roles, alcance, trabajador, estado, acciones de seguridad y su bitácora de accesos. */
export default function FichaUsuario() {
  return <Suspense><Pantalla /></Suspense>;
}

type Pestana = "alcance" | "sesiones" | "dispositivos" | "bitacora";

function Pantalla() {
  const router = useRouter();
  const id = useSearchParams().get("id");
  if (!id) return <Elegir onElegir={(x) => router.replace(`/m/seg/seg-09?id=${x.id}`)} />;
  // Con la clave, al cambiar de usuario la ficha arranca limpia.
  return <Detalle key={id} id={id} />;
}

function Detalle({ id }: { id: string }) {
  const router = useRouter();
  const { can, me } = useSesion();
  const [u, setU] = useState<Ficha | null>(null);
  const [error, setError] = useState("");
  const [opciones, setOpciones] = useState<Opciones | null>(null);
  const [pestana, setPestana] = useState<Pestana>("alcance");
  const [ocupado, setOcupado] = useState("");
  const [dBusca, setDBusca] = useState("");
  const [dEstado, setDEstado] = useState("");
  const [dPlataforma, setDPlataforma] = useState("");
  const [evento, setEvento] = useState("");
  const [eventos, setEventos] = useState<{ value: string; label: string }[]>([]);
  const accesos = useListado<Acceso>(`/v1/seg/usuarios/${id}/accesos`, { orden: "-at", porPagina: 15, filtros: { event: evento } });
  // Los eventos que tiene este usuario, para el filtro (se piden una vez por usuario).
  useEffect(() => {
    let vigente = true;
    if (id) api<{ eventos: { value: string; label: string }[] }>(`/v1/seg/usuarios/${id}/accesos?per_page=1`).then((r) => vigente && setEventos(r.eventos)).catch(() => {});
    return () => { vigente = false; };
  }, [id]);
  const puedeGestionar = can("seg.user.manage");

  useEffect(() => {
    let vigente = true;
    api<Ficha>(`/v1/seg/usuarios/${id}`).then((f) => vigente && setU(f)).catch((e) => vigente && setError(mensajeDe(e, "No se encontró el usuario.")));
    api<Opciones>("/v1/seg/usuarios/opciones").then((o) => vigente && setOpciones(o)).catch(() => {});
    return () => { vigente = false; };
  }, [id]);

  /** Acción sobre el usuario; con «motivo», lo pide antes. */
  async function accion(clave: string, ruta: string, opciones: { titulo: string; mensaje: string; boton: string; peligro?: boolean; motivo?: boolean; metodo?: "POST" | "DELETE" }) {
    const r = await confirmAction({ title: opciones.titulo, message: opciones.mensaje, confirmLabel: opciones.boton, danger: opciones.peligro,
      reason: opciones.motivo ? { min: 5, label: "Motivo" } : undefined });
    if (!r) return;
    setOcupado(clave);
    try {
      // La ruta es del usuario («/bloquear») o completa («/v1/seg/dispositivos/…»).
      const url = ruta.startsWith("/v1/") ? ruta : `/v1/seg/usuarios/${id}${ruta}`;
      const res = await api<Ficha | { cerradas: number } | { message: string }>(url, { method: opciones.metodo ?? "POST", body: r.reason ? { reason: r.reason } : undefined });
      if ("cerradas" in res) toast.ok(res.cerradas === 1 ? "1 sesión cerrada" : `${res.cerradas} sesiones cerradas`);
      else if ("message" in res && !("id" in res)) toast.ok(res.message);
      else toast.ok(`${opciones.boton}: listo`);
      const f = await api<Ficha>(`/v1/seg/usuarios/${id}`);
      setU(f);
      accesos.recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  const soyYo = u?.id === me.user.id;
  // Sesiones abiertas sin contar la actual: la actual nunca se cierra desde aquí.
  const otrasAbiertas = u ? u.sessions.filter((s) => s.estado === "OPEN" && !s.actual).length : 0;
  const acciones = u && (
    <div className="flex flex-wrap gap-2">
      {u.estado === "LOCKED" && can("seg.user.unlock") && (
        <Button size="sm" variant="primary" icon={Unlock} loading={ocupado === "desbloquear"}
          onClick={() => accion("desbloquear", "/desbloquear", { titulo: `Desbloquear a ${u.name}`, mensaje: "Vuelve a poder iniciar sesión y su contador de intentos queda en cero.", boton: "Desbloquear" })}>Desbloquear</Button>
      )}
      {u.estado === "ACTIVE" && puedeGestionar && !soyYo && (
        <Button size="sm" icon={Lock} loading={ocupado === "bloquear"}
          onClick={() => accion("bloquear", "/bloquear", { titulo: `Bloquear a ${u.name}`, mensaje: "No podrá iniciar sesión hasta que alguien lo desbloquee. Sus sesiones se cierran al instante.", boton: "Bloquear", peligro: true, motivo: true })}>Bloquear</Button>
      )}
      {u.status === "INVITED" && puedeGestionar && (
        <Button size="sm" icon={Mail} loading={ocupado === "reinvitar"}
          onClick={() => accion("reinvitar", "/reinvitar", { titulo: "Reenviar la invitación", mensaje: `Se le manda un código nuevo a ${u.email}; el anterior deja de servir.`, boton: "Reenviar" })}>Reenviar invitación</Button>
      )}
      {u.twofa_enabled && can("seg.user.reset_mfa") && (
        <Button size="sm" icon={KeyRound} loading={ocupado === "mfa"}
          onClick={() => accion("mfa", "/reiniciar-2fa", { titulo: "Reiniciar segundo factor", mensaje: `${u.name} deberá activarlo otra vez en su siguiente ingreso; sus códigos de recuperación dejan de servir.`, boton: "Reiniciar", peligro: true })}>Reiniciar segundo factor</Button>
      )}
      {otrasAbiertas > 0 && can("seg.session.revoke") && (
        <Button size="sm" icon={LogOut} loading={ocupado === "sesiones"}
          onClick={() => accion("sesiones", "/sesiones", soyYo
            ? { titulo: "Cerrar tus otras sesiones", mensaje: "Se cierran las sesiones de tus otros equipos. Esta sesión sigue abierta.", boton: "Cerrar las demás", metodo: "DELETE" }
            : { titulo: `Cerrar las sesiones de ${u.name}`, mensaje: "Tendrá que iniciar sesión de nuevo en todos sus equipos.", boton: "Cerrar sesiones", metodo: "DELETE" })}>
          {soyYo ? "Cerrar las demás sesiones" : "Cerrar sesiones"}
        </Button>
      )}
      {u.status !== "INACTIVE" && puedeGestionar && !soyYo && (
        <Button size="sm" variant="danger" icon={UserX} loading={ocupado === "desactivar"}
          onClick={() => accion("desactivar", "/desactivar", { titulo: `Desactivar a ${u.name}`, mensaje: "Se cierran sus sesiones y se revocan sus celulares. El usuario no se borra: queda inactivo con el motivo.", boton: "Desactivar", peligro: true, motivo: true })}>Desactivar</Button>
      )}
      {u.status === "INACTIVE" && puedeGestionar && (
        <Button size="sm" variant="primary" icon={UserCheck} loading={ocupado === "reactivar"}
          onClick={() => accion("reactivar", "/reactivar", { titulo: `Reactivar a ${u.name}`, mensaje: "Vuelve como invitado: recibe un código por correo para crear una contraseña nueva.", boton: "Reactivar" })}>Reactivar</Button>
      )}
    </div>
  );

  // Mismas columnas que el prototipo: cliente, dispositivo, IP, inicio, última actividad, vence y estado.
  const colSesion: Column<Ficha["sessions"][number]>[] = [
    { key: "client", header: "Cliente", cardTitle: true, render: (s) => clienteDe(s.client) },
    { key: "device", header: "Dispositivo", render: (s) => s.device ?? <span className="text-muted">Sin dato</span> },
    { key: "ip", header: "IP", render: (s) => s.ip ? <span className="font-mono text-[12.5px]">{s.ip}</span> : <span className="text-muted">—</span> },
    { key: "created_at", header: "Inicio", render: (s) => fechaHora(s.created_at) },
    { key: "last_used_at", header: "Última actividad", render: (s) => s.last_used_at ? fechaHora(s.last_used_at) : <span className="text-muted">—</span> },
    { key: "expires_at", header: "Vence", hideOnMobile: true, render: (s) => s.expires_at ? fechaHora(s.expires_at) : <span className="text-muted">No vence</span> },
    { key: "estado", header: "Estado", render: (s) => (
      <div className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={s.estado} labels={ESTADOS_SESION} />{s.actual && <Badge tone="info">Esta sesión</Badge>}
        </span>
        {s.motivo && <p className="mt-0.5 text-[12px] text-muted">{s.motivo}{s.cerrada_en ? ` · ${fechaHora(s.cerrada_en)}` : ""}</p>}
      </div>
    ) },
    { key: "acciones", header: "", align: "right", hideInCard: false, render: (s) => s.estado === "OPEN" && !s.actual && can("seg.session.revoke") ? (
      <Button size="sm" variant="ghost" loading={ocupado === `s-${s.id}`}
        onClick={() => accion(`s-${s.id}`, `/sesiones/${s.id}`, { titulo: "Cerrar esta sesión", mensaje: "Ese equipo tendrá que iniciar sesión de nuevo.", boton: "Cerrar", metodo: "DELETE" })}>Cerrar</Button>
    ) : null },
  ];
  // Mismas columnas, búsqueda y filtros que el prototipo.
  const colDispositivo: Column<Ficha["devices"][number]>[] = [
    { key: "usuario", header: "Usuario", hideOnMobile: true, render: () => u?.name },
    { key: "rol", header: "Rol", hideOnMobile: true, render: () => u?.roles_names ?? "—" },
    { key: "name", header: "Dispositivo", cardTitle: true },
    { key: "platform", header: "Plataforma", render: (d) => PLATAFORMAS[d.platform] ?? d.platform },
    { key: "status", header: "Estado", render: (d) => <StatusBadge status={d.status} labels={ESTADOS_DISPOSITIVO} /> },
    { key: "requested_at", header: "Registrado", hideOnMobile: true, render: (d) => fechaHora(d.requested_at) },
    { key: "approved_by_name", header: "Aprobado por", hideOnMobile: true, render: (d) => d.approved_by_name ? `${d.approved_by_name} · ${fecha(d.approved_at)}` : <span className="text-muted">—</span> },
    { key: "revoke_reason", header: "Motivo de revocación", hideOnMobile: true, render: (d) => d.revoke_reason ?? <span className="text-muted">—</span> },
    { key: "last_seen_at", header: "Último uso", render: (d) => fechaHora(d.last_seen_at) },
    { key: "acciones", header: "", align: "right", render: (d) => can("seg.device.approve") && d.status !== "REVOKED" ? (
      <span className="flex justify-end gap-1.5">
        {d.status === "PENDING" && (
          <Button size="sm" variant="primary" loading={ocupado === `da-${d.id}`}
            onClick={() => accion(`da-${d.id}`, `/v1/seg/dispositivos/${d.id}/aprobar`, { titulo: `Aprobar ${d.name}`, mensaje: "Desde ese dispositivo ya podrá iniciar sesión en la app.", boton: "Aprobar" })}>Aprobar</Button>
        )}
        <Button size="sm" loading={ocupado === `dr-${d.id}`}
          onClick={() => accion(`dr-${d.id}`, `/v1/seg/dispositivos/${d.id}/revocar`, { titulo: `Revocar ${d.name}`, mensaje: "Sus sesiones se cierran en ese momento y ya no podrá iniciar sesión desde él.", boton: "Revocar", peligro: true, motivo: true })}>Revocar</Button>
      </span>
    ) : null },
  ];
  const colAcceso: Column<Acceso>[] = [
    { key: "at", header: "Fecha", sortable: true, cardTitle: true, render: (a) => fechaHora(a.at) },
    { key: "event", header: "Evento", sortable: true, render: (a) => <Badge tone={tonoEvento(a)}>{a.event_name}</Badge> },
    { key: "ip", header: "IP", hideOnMobile: true, render: (a) => <span className="font-mono text-[12.5px]">{a.ip}</span> },
    { key: "device", header: "Dispositivo", hideOnMobile: true },
    { key: "detail", header: "Detalle", render: (a) => a.detail ?? (a.details ? Object.entries(a.details).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ") : <span className="text-muted">—</span>) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Rol, locales y marcas permitidos, trabajador vinculado y estado, con las acciones de seguridad y su bitácora de accesos. Los cambios de rol o alcance rigen en su siguiente petición."
        actions={<Button icon={ArrowLeft} onClick={() => router.push("/m/seg/seg-08")}>Volver a usuarios</Button>} />

      {error && <Alert tone="bad">{error}</Alert>}
      {!u && !error && <div className="h-40 animate-pulse rounded-xl bg-surface-2" />}

      {u && (
        <>
          <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <div className="mb-4 min-w-0">
              <h2 className="font-display text-[20px] font-bold">{u.name}</h2>
              <p className="font-mono text-[13px] text-muted">{u.email}</p>
            </div>
            <DetailList items={[
              { label: "Rol", value: u.roles_names ?? "Sin rol" },
              { label: "Alcance", value: alcanceDe(u) },
              { label: "Trabajador", value: u.employee_name ? `${u.employee_name} · ${u.employee_position}` : "—" },
              { label: "Estado", value: <Estado u={u} /> },
              { label: "Segundo factor", value: u.twofa_enabled ? `Activo desde ${fechaHora(u.mfa_enrolled_at)}` : u.exige_2fa ? "Lo exige su rol y no está activo" : "Su rol no lo exige" },
              { label: "Intentos fallidos seguidos", value: String(u.failed_logins ?? 0) },
              { label: "Último ingreso", value: u.last_login ? fechaHora(u.last_login) : "Nunca" },
              { label: "Sesiones abiertas", value: String(u.sesiones) },
            ]} />
            {acciones && <div className="mt-4 border-t border-line pt-4">{acciones}</div>}
          </section>

          <Tabs<Pestana> value={pestana} onChange={setPestana} tabs={[
            { key: "alcance", label: "Rol y alcance" },
            { key: "sesiones", label: "Sesiones", count: u.sessions.filter((s) => s.estado === "OPEN").length },
            { key: "dispositivos", label: "Dispositivos", count: u.devices.length },
            { key: "bitacora", label: "Bitácora de accesos", count: accesos.tabla.pagination?.total },
          ]} />

          {pestana === "alcance" && (
            <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
              {puedeGestionar ? (
                opciones ? <UsuarioForm key={u.id + u.roles_codes + u.scope_brands + u.scope_sites} usuario={u} opciones={opciones}
                  onGuardado={(f) => { setU(f); accesos.recargar(); }} /> : <div className="h-24 animate-pulse rounded bg-surface-2" />
              ) : (
                <p className="text-[13px] text-muted">Solo quien tiene el permiso de gestionar usuarios cambia roles y alcance.</p>
              )}
            </section>
          )}
          {pestana === "sesiones" && (
            <div className="space-y-2">
              <DataTable rows={u.sessions} rowKey={(s) => s.id} columns={colSesion} empty="Sin sesiones registradas." />
              {u.sessions.some((s) => !s.ip) && (
                <p className="text-[12.5px] text-muted">Primero las abiertas y luego las anteriores. Las que no tienen dispositivo ni IP se abrieron antes de que el sistema empezara a anotarlos.</p>
              )}
            </div>
          )}
          {pestana === "dispositivos" && (
            <DataTable rowKey={(d) => d.id} columns={colDispositivo}
              rows={u.devices.filter((d) => (!dEstado || d.status === dEstado) && (!dPlataforma || d.platform === dPlataforma)
                && (!dBusca.trim() || `${d.name} ${d.fingerprint_hint} ${d.revoke_reason ?? ""}`.toLowerCase().includes(dBusca.trim().toLowerCase())))}
              search={{ value: dBusca, onChange: setDBusca, placeholder: "Buscar…" }}
              empty={u.devices.length ? "No hay dispositivos con estos filtros." : "No registró celulares de la app."}
              toolbar={<>
                <FiltroLocal label="Estado" value={dEstado} onChange={setDEstado} options={Object.entries(ESTADOS_DISPOSITIVO).map(([value, [label]]) => ({ value, label }))} />
                <FiltroLocal label="Plataforma" value={dPlataforma} onChange={setDPlataforma} options={Object.entries(PLATAFORMAS).map(([value, label]) => ({ value, label }))} />
              </>} />
          )}
          {pestana === "bitacora" && (
            <DataTable {...accesos.tabla} columns={colAcceso} search={{ ...accesos.tabla.search, placeholder: "Buscar detalle o IP…" }}
              empty={evento ? "No hay accesos con ese evento." : "Sin accesos registrados."}
              toolbar={<FiltroLocal label="Evento" value={evento} onChange={setEvento} options={eventos} />} />
          )}
        </>
      )}
    </div>
  );
}

function FiltroLocal({ label, value, onChange, options }:
  { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="w-full sm:w-[150px]">
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={`${label}: todos`} options={options}
        className="!min-h-9 h-9 py-1.5 text-[13px]" />
    </div>
  );
}

/** Estado con su etiqueta de color (como la lista) y, si aplica, hasta cuándo y por qué. */
function Estado({ u }: { u: Usuario }) {
  const extra = u.estado === "LOCKED"
    ? [u.locked_until ? `hasta ${fechaHora(u.locked_until)}` : "hasta que lo desbloqueen", u.lock_reason].filter(Boolean).join(" · ")
    : u.status === "INACTIVE" ? [u.deactivated_at ? `desde ${fechaHora(u.deactivated_at)}` : null, u.deactivated_reason].filter(Boolean).join(" · ")
      : u.status === "INVITED" ? `invitado ${u.invited_at ? fechaHora(u.invited_at) : ""} por ${u.invited_by ?? "—"}` : "";
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <StatusBadge status={u.estado} labels={ESTADOS_USUARIO} />
      {extra && <span className="text-[12.5px] text-muted">{extra}</span>}
    </span>
  );
}

/** Sin usuario elegido: una lista corta para llegar a la ficha. */
function Elegir({ onElegir }: { onElegir: (u: Usuario) => void }) {
  const lista = useListado<Usuario>("/v1/seg/usuarios", { orden: "name", porPagina: 10 });
  const columnas: Column<Usuario>[] = [
    { key: "name", header: "Nombre", sortable: true, cardTitle: true },
    { key: "email", header: "Correo", render: (u) => <span className="font-mono text-[12.5px]">{u.email}</span> },
    { key: "roles_names", header: "Rol" },
    { key: "estado", header: "Estado", render: (u) => <StatusBadge status={u.estado} labels={ESTADOS_USUARIO} /> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Elige un usuario para ver su ficha: roles, alcance, estado, sesiones, dispositivos y bitácora de accesos." />
      <DataTable {...lista.tabla} columns={columnas} onRowClick={onElegir} search={{ ...lista.tabla.search, placeholder: "Buscar nombre o correo…" }} empty="No hay usuarios." />
    </div>
  );
}
