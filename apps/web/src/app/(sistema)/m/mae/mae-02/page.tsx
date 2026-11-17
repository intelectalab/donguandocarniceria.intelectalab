"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Badge, Button, DataTable, DetailList, Field, Input, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, fechaHora, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Dialogo } from "@/modulos/mae/Dialogo";
import { TrabajadorForm } from "@/modulos/mae/TrabajadorForm";
import { ESTADOS_TRABAJADOR, ESTADOS_USUARIO, NOMBRE_DOC, dias, hoyLima, useDatos, type ResumenTrabajadores, type Trabajador } from "@/modulos/mae/tipos";

type UsuarioFicha = {
  id: string; name: string; email: string; status: string; role: string; rol_nombre: string; marcas: string[] | null; locales: string[] | null; segundo_factor: boolean;
  last_login: string | null; deactivated_reason: string | null; sesiones: number;
};
type Cambio = { campo: string; antes: string | null; despues: string };
type Evento = { id: number; fecha: string; usuario: string | null; rol: string | null; tipo: "alta" | "cambio" | "baja" | "usuario"; detalle: string | null; cambios: Cambio[] };
type Ficha = { trabajador: Trabajador; usuarios: UsuarioFicha[]; historia: Evento[] | null };

/** MAE-02 Ficha del trabajador: datos, usuario vinculado y «Dar de baja» con fecha y motivo. ?id= el trabajador; sin él, alta o elegir uno. */
export default function FichaDelTrabajador() {
  return <Suspense><Pantalla /></Suspense>;
}

// Lee ?id= en el navegador: la página se compila sin él.
function Pantalla() {
  const id = useSearchParams().get("id") ?? "";
  return id ? <Ficha id={id} /> : <SinTrabajador />;
}

function SinTrabajador() {
  const router = useRouter();
  const { puede, can } = useSesion();
  const { datos: r } = useDatos<ResumenTrabajadores>("/v1/mae/trabajadores/resumen");
  const [nuevo, setNuevo] = useState(false);
  const lista = useListado<Trabajador>("/v1/mae/trabajadores", { orden: "full_name", porPagina: 8 });
  const gestiona = can("mae.employee.manage") && puede("MAE", "C");
  const columnas: Column<Trabajador>[] = [
    { key: "full_name", header: "Nombre", sortable: true, cardTitle: true },
    { key: "position", header: "Cargo" },
    { key: "status", header: "Estado", render: (e) => <StatusBadge status={e.status} labels={ESTADOS_TRABAJADOR} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Alta de un trabajador nuevo o elige uno de la lista para ver su ficha."
        actions={<>
          <Button onClick={() => router.push("/m/mae/mae-01")}>Volver a la lista</Button>
          {gestiona && <Button variant="primary" disabled={!r} onClick={() => setNuevo(true)}>Nuevo trabajador</Button>}
        </>} />
      {!gestiona && <Alert tone="info">Puedes ver las fichas; dar de alta, editar o dar de baja exige el permiso de gestionar trabajadores.</Alert>}
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(e) => router.push(`/m/mae/mae-02?id=${e.id}`)}
        search={{ ...lista.tabla.search, placeholder: "Buscar trabajador…" }} />
      {nuevo && r && <TrabajadorForm opciones={r} onClose={() => setNuevo(false)} onGuardado={(nid) => { setNuevo(false); router.push(`/m/mae/mae-02?id=${nid}`); }} />}
    </div>
  );
}

function Ficha({ id }: { id: string }) {
  const router = useRouter();
  const { puede, can } = useSesion();
  const { datos, error, recargar } = useDatos<Ficha>(`/v1/mae/trabajadores/${id}`);
  const { datos: opciones } = useDatos<ResumenTrabajadores>("/v1/mae/trabajadores/resumen");
  const [dialogo, setDialogo] = useState<"" | "editar" | "baja" | "vincular">("");
  const gestiona = can("mae.employee.manage") && puede("MAE", "E");

  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!datos) return <p className="text-[13px] text-muted">Cargando…</p>;
  const e = datos.trabajador;
  const activo = e.status === "ACTIVE";
  const vigente = datos.usuarios.find((u) => u.status !== "INACTIVE");
  const cerrar = (cambio = false) => { setDialogo(""); if (cambio) recargar(); };

  return (
    <div className="space-y-5">
      <PageHeader description={`${e.position} · ${e.local ?? "—"} · ${NOMBRE_DOC[e.doc_type]} ${e.doc_number}`}
        actions={<>
          <Button onClick={() => router.push("/m/mae/mae-01")}>Lista</Button>
          {gestiona && activo && <>
            <Button onClick={() => setDialogo("editar")} disabled={!opciones}>Editar</Button>
            <Button onClick={() => setDialogo("vincular")}>Vincular usuario</Button>
            <Button variant="danger" onClick={() => setDialogo("baja")}>Dar de baja</Button>
          </>}
        </>} />

      {!activo && <Alert tone="bad"><b>Cesado el {fecha(e.terminated_on)}.</b> Motivo: {e.termination_reason}. Su usuario quedó inactivo y no se le asignan rutas, cajas ni tareas nuevas.</Alert>}

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="mb-3 text-[15px] font-semibold">Datos del trabajador</h2>
          <DetailList items={[
            { label: "Documento", value: `${NOMBRE_DOC[e.doc_type]} ${e.doc_number}` },
            { label: "Nombre", value: e.full_name },
            { label: "Cargo", value: e.position },
            { label: "Local", value: e.local ?? "—" },
            { label: "Centro de costo", value: e.centro_costo ? `${e.centro_costo} · ${e.centro_costo_nombre}` : "—" },
            { label: "Fecha de ingreso", value: fecha(e.hire_date) },
            { label: "Antigüedad", value: `${numero(dias(e.hire_date, e.terminated_on ?? hoyLima()))} días` },
            { label: "Celular", value: e.phone ?? "—" },
            { label: "Correo", value: e.email ?? "—" },
            { label: "Estado", value: activo ? <Badge tone="ok" dot>Activo</Badge> : <Badge tone="bad">Cesado</Badge> },
            ...(e.terminated_on ? [{ label: "Fecha de cese", value: fecha(e.terminated_on) }, { label: "Motivo del cese", value: e.termination_reason ?? "—" }] : []),
          ]} />
        </section>

        <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="mb-3 text-[15px] font-semibold">Usuario vinculado</h2>
          {datos.usuarios.length ? (
            <div className="space-y-4">
              {datos.usuarios.map((u) => (
                <div key={u.id} className="space-y-2 border-b border-line pb-3 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button type="button" onClick={() => router.push(`/m/seg/seg-09?id=${u.id}`)} className="cursor-pointer font-semibold hover:text-primary hover:underline">{u.email}</button>
                    <StatusBadge status={u.status} labels={ESTADOS_USUARIO} />
                  </div>
                  <DetailList items={[
                    { label: "Nombre", value: u.name },
                    { label: "Rol", value: u.rol_nombre },
                    { label: "Marcas", value: alcance(u.marcas, "Todas") },
                    { label: "Locales", value: alcance(u.locales, "Todos") },
                    { label: "Segundo factor", value: u.segundo_factor ? "Activo" : "No" },
                    { label: "Último ingreso", value: u.last_login ? fechaHora(u.last_login) : "Nunca" },
                    ...(u === vigente ? [{ label: "Sesiones abiertas", value: numero(u.sesiones) }] : []),
                    ...(u.deactivated_reason ? [{ label: "Desactivado", value: u.deactivated_reason }] : []),
                  ]} />
                </div>
              ))}
              <p className="text-[12.5px] text-muted">Un trabajador tiene a lo más un usuario vigente.</p>
            </div>
          ) : (
            <p className="text-[13px] text-muted">Sin usuario: este trabajador no ingresa al sistema.</p>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="mb-3 text-[15px] font-semibold">Historia</h2>
        <Historia eventos={datos.historia} />
      </section>

      {dialogo === "editar" && opciones && <TrabajadorForm trabajador={e} opciones={opciones} onClose={() => cerrar()} onGuardado={() => cerrar(true)} />}
      {dialogo === "baja" && <Baja trabajador={e} usuario={vigente} motivos={opciones?.motivos ?? []} onClose={() => cerrar()} onHecho={() => cerrar(true)} />}
      {dialogo === "vincular" && <Vincular trabajador={e} actual={vigente} onClose={() => cerrar()} onHecho={() => cerrar(true)} />}
    </div>
  );
}

/** RN-MAE-02: baja con fecha y motivo; su usuario queda inactivo, se cierran sus sesiones y se revocan sus celulares. */
function Baja({ trabajador, usuario, motivos, onClose, onHecho }: {
  trabajador: Trabajador; usuario?: UsuarioFicha; motivos: string[]; onClose: () => void; onHecho: () => void;
}) {
  const [v, setV] = useState({ date: hoyLima(), reason: motivos[0] ?? "Renuncia voluntaria", detail: "" });
  return (
    <Dialogo titulo={`Dar de baja a ${trabajador.full_name}`} boton="Dar de baja" onClose={onClose}
      aviso={usuario ? `Su usuario ${usuario.email} quedará inactivo, se cerrarán sus sesiones y se revocarán sus celulares.` : "No tiene usuario vinculado."}
      enviar={async () => {
        const r = await api<{ usuarios: number; sesiones: number }>(`/v1/mae/trabajadores/${trabajador.id}/baja`, { method: "POST", body: { ...v, detail: v.detail || null } });
        toast.ok(`${trabajador.full_name} dado de baja${r.usuarios ? `; usuario desactivado y ${r.sesiones} sesión(es) cerrada(s)` : ""}`);
        onHecho();
      }}>
      {(e) => <>
        <Field label="Fecha de cese" required error={e.date}><Input type="date" value={v.date} min={trabajador.hire_date} max={hoyLima()} onChange={(x) => setV({ ...v, date: x.target.value })} /></Field>
        <Field label="Motivo" required error={e.reason}><Select value={v.reason} onChange={(x) => setV({ ...v, reason: x.target.value })} options={motivos.map((m) => ({ value: m, label: m }))} /></Field>
        <Field label="Detalle (opcional)" error={e.detail} className="sm:col-span-2"><Textarea value={v.detail} maxLength={200} onChange={(x) => setV({ ...v, detail: x.target.value })} /></Field>
      </>}
    </Dialogo>
  );
}

/** Marcas o locales del alcance del usuario; null = su rol ve todos. */
function alcance(lista: string[] | null, todas: "Todas" | "Todos") {
  return lista?.length ? lista.join(", ") : todas;
}

/**
 * RN-MAE-13: vincula un usuario libre (vigente y sin otro trabajador activo). Si ya tiene uno vigente, viene elegido
 * y para cambiarlo primero se desactiva en Seguridad.
 */
function Vincular({ trabajador, actual, onClose, onHecho }: { trabajador: Trabajador; actual?: UsuarioFicha; onClose: () => void; onHecho: () => void }) {
  const { datos: libres } = useDatos<{ id: string; name: string; email: string; role: string }[]>(`/v1/mae/trabajadores/${trabajador.id}/usuarios-libres`);
  const [userId, setUserId] = useState(actual?.id ?? "");
  const opciones = (libres ?? []).map((u) => ({ value: u.id, label: `${u.name} · ${u.email} · ${u.role}${u.id === actual?.id ? " (vinculado ahora)" : ""}` }));
  return (
    <Dialogo titulo={`Vincular usuario a ${trabajador.full_name}`} boton="Vincular" onClose={onClose} deshabilitado={!userId || userId === actual?.id}
      aviso={actual ? `Ya está vinculado a ${actual.email}. Un trabajador tiene a lo más un usuario vigente: para vincular otro, primero desactiva ese usuario en Seguridad.`
        : libres && !libres.length ? "No hay usuarios libres. Crea el usuario en Seguridad y vuelve a vincularlo aquí." : undefined}
      enviar={async () => {
        const r = await api<{ email: string }>(`/v1/mae/trabajadores/${trabajador.id}/usuario`, { method: "POST", body: { user_id: userId } });
        toast.ok(`Usuario ${r.email} vinculado`);
        onHecho();
      }}>
      {(e) => (
        <Field label="Usuario" required error={e.user_id} className="sm:col-span-2">
          <Select value={userId} onChange={(x) => setUserId(x.target.value)} placeholder={libres ? "Elige el usuario" : "Cargando…"} options={opciones} />
        </Field>
      )}
    </Dialogo>
  );
}

const TIPO_EVENTO: Record<Evento["tipo"], [string, "ok" | "info" | "bad" | "neutral"]> = {
  alta: ["Alta", "ok"], cambio: ["Cambio", "info"], baja: ["Baja", "bad"], usuario: ["Usuario", "neutral"],
};

/** Historia del trabajador (RN-AUD-09): quién cambió qué y cuándo, en hora de Lima. null = el rol no la ve. */
function Historia({ eventos }: { eventos: Evento[] | null }) {
  if (eventos === null) return <p className="text-[13px] text-muted">Tu rol no ve la historia de los registros.</p>;
  if (!eventos.length) return <p className="text-[13px] text-muted">Sin cambios registrados desde la puesta en marcha.</p>;
  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        {eventos.map((ev) => (
          <li key={ev.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <Badge tone={TIPO_EVENTO[ev.tipo][1]}>{TIPO_EVENTO[ev.tipo][0]}</Badge>
              <span className="font-semibold">{ev.usuario ?? "Sistema"}</span>
              {ev.rol && <span className="text-muted">{ev.rol}</span>}
              <span className="ml-auto text-muted">{fechaHora(ev.fecha)}</span>
            </div>
            {ev.detalle && <p className="mt-1 text-[13px]">{ev.detalle}</p>}
            {ev.cambios.length > 0 && (
              <dl className="mt-1.5 grid grid-cols-[minmax(110px,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
                {ev.cambios.map((c) => (
                  <div key={c.campo} className="contents">
                    <dt className="text-muted">{c.campo}</dt>
                    <dd className="min-w-0 break-words">
                      {c.antes !== null && <><span className="text-muted line-through">{c.antes}</span> → </>}{c.despues}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ol>
      <p className="text-[12px] text-muted">Horas en hora de Lima.</p>
    </div>
  );
}
