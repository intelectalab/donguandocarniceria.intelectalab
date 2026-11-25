"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Inbox, UserPlus, Users, Wifi } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, DataTable, Field, FiltroSelect, Input, Modal, PageHeader, Select, confirmAction, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { useOrdenLocal, usePaginaLocal } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/mae/Dialogo";
import { sinTildes } from "@/modulos/mae/tipos";

type Opcion = { value: string; label: string };
type Turno = { weekday: number; from: string; to: string };
type Miembro = {
  id: string; user_id: string; name: string; email: string; member_role: "AGENT" | "SUPERVISOR"; role_name: string; active: boolean; user_status: string;
  estado: "ONLINE" | "AWAY" | "OFFLINE"; estado_name: string; turnos: Turno[]; turnos_texto: string; en_turno: boolean; abiertos: number; tope: number;
};
type Canal = {
  id: string; kind: string; kind_name: string; display_name: string; number: string; brand_id: string; brand_name: string; status: string;
  assignment_mode: string; assignment_name: string; siguiente: string | null; en_cola: number; miembros: Miembro[];
};
type Respuesta = {
  data: Canal[]; cifras: { vendedoras: number; en_linea: number; en_turno: number; abiertos: number; capacidad: number; en_cola: number };
  tope: number; horario: string; candidatos: (Opcion & { rol: string; marcas: string[]; marcas_texto: string })[]; asignacion: Opcion[]; puede: boolean;
};

const ESTADO: Record<string, [string, Tone]> = { ONLINE: ["En línea", "ok"], AWAY: ["Ausente", "warn"], OFFLINE: ["Desconectada", "neutral"] };
const DIAS = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/**
 * CRM-08 Equipos y turnos: miembros por número (vendedora o supervisora), turnos por día, tope de chats abiertos y modo
 * de asignación. Solo reciben chats las vendedoras en turno, en línea y bajo su tope.
 */
export default function EquiposYTurnos() {
  const { can, marca } = useSesion();
  const permitido = Boolean(can("crm.channel.manage") || can("crm.conversation.view_all"));
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");
  const [canalId, setCanalId] = useState("");
  const [f, setF] = useState({ buscar: "", rol: "", estado: "", turno: "", activos: "si" });
  const [editar, setEditar] = useState<Miembro | null>(null);
  const [agregar, setAgregar] = useState(false);

  const cargar = useCallback(() => {
    if (!permitido) return;
    api<Respuesta>(`/v1/crm/equipos${marca !== "ALL" ? `?marca=${marca}` : ""}`).then((r) => { setDatos(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [permitido, marca]);
  useEffect(() => cargar(), [cargar]);

  const canal = datos?.data.find((c) => c.id === canalId) ?? datos?.data[0] ?? null;
  const visibles = useMemo(() => {
    const q = sinTildes(f.buscar.trim());
    return (canal?.miembros ?? []).filter((m) => (!q || sinTildes(`${m.name} ${m.email}`).includes(q)) && (!f.rol || m.member_role === f.rol)
      && (!f.estado || m.estado === f.estado) && (!f.turno || String(m.en_turno) === f.turno) && (f.activos !== "si" || m.active));
  }, [canal, f]);
  const ord = useOrdenLocal(visibles, { name: (m) => m.name, role: (m) => m.role_name, estado: (m) => m.estado_name, turnos: (m) => m.turnos_texto, abiertos: (m) => m.abiertos });
  const pagina = usePaginaLocal(ord.filas, `${canal?.id}|${JSON.stringify(f)}|${ord.orden.sort}`);

  if (!permitido) return <Alert tone="warn">Tu rol no consulta los equipos y turnos.</Alert>;

  async function cambiarModo(modo: string) {
    if (!canal) return;
    try {
      await api(`/v1/crm/canales/${canal.id}/asignacion`, { method: "PUT", body: { assignment_mode: modo } });
      toast.ok("Modo de asignación guardado");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  async function activar(m: Miembro, activo: boolean) {
    if (!activo) {
      const ok = await confirmAction({ title: `¿Quitar a ${m.name} de ${canal?.display_name}?`, confirmLabel: "Quitar", danger: true,
        message: "Deja de recibir chats de este número. No se borra: su historial de chats sigue y se puede volver a activar." });
      if (!ok) return;
    }
    try {
      await api(`/v1/crm/miembros/${m.id}`, { method: "PUT", body: { active: activo } });
      toast.ok(activo ? `${m.name} vuelve a atender` : `${m.name} quitada del número`);
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const puede = Boolean(datos?.puede);
  const columnas: Column<Miembro>[] = [
    { key: "name", sortable: true, header: "Miembro", cardTitle: true, render: (m) => (
      <div className={`min-w-0 ${m.active ? "" : "opacity-60"}`}><p className="font-semibold text-ink">{m.name}</p><p className="text-[12px] text-muted">{m.email}</p></div>
    ) },
    { key: "role", sortable: true, header: "Rol", render: (m) => <span className="text-[12.5px]">{m.role_name}</span> },
    { key: "estado", sortable: true, header: "Estado", render: (m) => <Badge tone={ESTADO[m.estado][1]} dot>{m.estado_name}</Badge> },
    { key: "turnos", sortable: true, header: "Turnos", render: (m) => <span className="text-[12.5px]">{m.turnos_texto}</span> },
    { key: "en_turno", header: "En turno ahora", render: (m) => (m.en_turno ? <Badge tone="ok">Sí</Badge> : <span className="text-muted">No</span>) },
    { key: "abiertos", sortable: true, header: "Abiertos / tope", align: "right", render: (m) => (
      <span className={`tabular-nums ${m.member_role === "AGENT" && m.abiertos >= m.tope ? "font-semibold text-bad" : ""}`}>{m.member_role === "AGENT" ? `${m.abiertos} / ${m.tope}` : numero(m.abiertos)}</span>
    ) },
    { key: "active", header: "Activo", hideOnMobile: true, render: (m) => (m.active ? <Badge tone="ok">Sí</Badge> : <Badge tone="neutral">No</Badge>) },
    ...(puede ? [{ key: "acciones", header: "", align: "right" as const, render: (m: Miembro) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {m.active ? <Button size="sm" variant="ghost" onClick={() => activar(m, false)}>Quitar</Button> : <Button size="sm" variant="ghost" onClick={() => activar(m, true)}>Activar</Button>}
      </div>
    ) }] : []),
  ];

  const c = datos?.cifras;
  return (
    <div className="grid gap-5">
      <PageHeader description={`Quién atiende cada número, en qué turno y cuántos chats abiertos puede tener. Un chat nuevo va a una vendedora del número que esté en turno, en línea y bajo su tope; si nadie cumple, queda en cola. Sin turnos propios vale el horario de atención (${datos?.horario ?? "lun-sáb 08:00-20:00, dom 09:00-14:00"}).${puede ? " Haz clic en una persona para cambiar sus turnos o su tope." : ""}`} />
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Vendedoras" valor={numero(c.vendedoras)} icono={Users} destacada detalle="Activas en algún número" />
          <Cifra titulo="En línea ahora" valor={numero(c.en_linea)} icono={Wifi} tono={c.en_linea ? "ok" : "warn"} detalle={`${c.en_turno} en turno`} />
          <Cifra titulo="Chats abiertos" valor={`${numero(c.abiertos)} / ${numero(c.capacidad)}`} icono={Clock} detalle="Abiertos y capacidad de las vendedoras" />
          <Cifra titulo="En cola" valor={numero(c.en_cola)} icono={Inbox} tono={c.en_cola ? "warn" : "ok"} detalle={c.en_cola ? "Sin vendedora asignada" : "Todos asignados"} />
        </div>
      )}
      <Alert tone="info">Por confirmar con la gerencia: cuántas vendedoras atienden a la vez y de qué marcas. Mientras tanto, el tope es de {datos?.tope ?? 25} chats por vendedora y los turnos van de 08:00 a 20:00.</Alert>
      {error && <Alert tone="bad">{error}</Alert>}

      {canal && datos && (
        <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
          <div className="grid gap-3 md:grid-cols-[minmax(0,320px)_minmax(0,240px)_1fr] md:items-end">
            <Field label="Número o cuenta">
              <Select value={canal.id} onChange={(e) => setCanalId(e.target.value)}
                options={datos.data.map((x) => ({ value: x.id, label: `${x.kind_name} · ${x.display_name}${x.kind === "WHATSAPP" ? ` · ${x.number}` : ""}` }))} />
            </Field>
            <Field label="Asignación de chats">
              <Select value={canal.assignment_mode} disabled={!puede} onChange={(e) => cambiarModo(e.target.value)} options={datos.asignacion} />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-2 md:pb-1">
              <p className="text-[13px] text-muted">
                Próximo chat iría a: <b className="text-ink">{canal.assignment_mode === "MANUAL" ? "nadie (asignación manual)" : canal.siguiente ?? "la cola (nadie disponible)"}</b>
                {canal.en_cola > 0 && <> · <span className="text-warn">{canal.en_cola} en cola</span></>}
              </p>
              {puede && <Button icon={UserPlus} onClick={() => setAgregar(true)}>Agregar miembro</Button>}
            </div>
          </div>
          <p className="text-[12px] text-muted">{canal.brand_name} · {canal.status === "ACTIVE" ? "activo" : "no recibe chats nuevos (no está activo)"}</p>
        </section>
      )}

      <DataTable {...ord.orden} columns={columnas} rows={pagina.filas} pagination={pagina.props} loading={!datos && !error} onRowClick={puede ? setEditar : undefined}
        empty={canal?.miembros.length ? "Nadie coincide con estos filtros." : "Este número aún no tiene miembros."}
        search={{ value: f.buscar, onChange: (v) => setF({ ...f, buscar: v }), placeholder: "Buscar persona…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Rol" ancho={160} value={f.rol} onChange={(v) => setF({ ...f, rol: v })} options={[{ value: "AGENT", label: "Vendedora" }, { value: "SUPERVISOR", label: "Supervisora" }]} />
          <FiltroSelect etiqueta="Estado" ancho={170} value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={Object.entries(ESTADO).map(([value, [label]]) => ({ value, label }))} />
          <FiltroSelect etiqueta="En turno" ancho={150} value={f.turno} onChange={(v) => setF({ ...f, turno: v })} options={[{ value: "true", label: "En turno" }, { value: "false", label: "Fuera de turno" }]} />
          <FiltroSelect etiqueta="Miembros" vacio="Activos e inactivos" ancho={180} value={f.activos} onChange={(v) => setF({ ...f, activos: v })} options={[{ value: "si", label: "Solo activos" }]} />
        </>} />

      {editar && canal && <EditarMiembro m={editar} canal={canal} onClose={() => setEditar(null)} onListo={() => { setEditar(null); cargar(); }} />}
      {agregar && canal && datos && <AgregarMiembro canal={canal} datos={datos} onClose={() => setAgregar(false)} onListo={() => { setAgregar(false); cargar(); }} />}
    </div>
  );
}

function EditarMiembro({ m, canal, onClose, onListo }: { m: Miembro; canal: Canal; onClose: () => void; onListo: () => void }) {
  const inicial = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => {
    const t = m.turnos.find((x) => x.weekday === d);
    return [d, { activo: Boolean(t), from: t?.from ?? "08:00", to: t?.to ?? "20:00" }];
  })) as Record<number, { activo: boolean; from: string; to: string }>;
  const [dias, setDias] = useState(inicial);
  const [tope, setTope] = useState(String(m.tope));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const ninguno = Object.values(dias).every((x) => !x.activo);

  async function guardar() {
    setGuardando(true); setError("");
    try {
      const turnos = Object.entries(dias).filter(([, x]) => x.activo).map(([d, x]) => ({ weekday: Number(d), from: x.from, to: x.to }));
      await api(`/v1/crm/miembros/${m.id}/turnos`, { method: "PUT", body: { turnos } });
      if (Number(tope) !== m.tope) await api(`/v1/crm/miembros/${m.id}`, { method: "PUT", body: { max_open_conversations: Number(tope) } });
      toast.ok("Turnos guardados");
      onListo();
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Turnos · ${m.name}`} description={`${m.role_name} · ${canal.display_name}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</Button></>}>
      <div className="grid gap-4">
        {error && <Alert tone="bad">{error}</Alert>}
        {m.member_role === "AGENT" && (
          <Field label="Tope de chats abiertos" hint="Al llegar al tope deja de recibir chats nuevos hasta cerrar alguno.">
            <Input type="number" min={1} max={100} value={tope} onChange={(e) => setTope(e.target.value)} />
          </Field>
        )}
        <div className="grid gap-2">
          <p className="text-[13px] font-semibold text-ink">Turnos de la semana (hora de Lima)</p>
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <div key={d} className="grid grid-cols-[120px_1fr_1fr] items-center gap-2">
              <Checkbox checked={dias[d].activo} onChange={(v) => setDias({ ...dias, [d]: { ...dias[d], activo: v } })} label={DIAS[d]} />
              <Input type="time" aria-label={`${DIAS[d]} desde`} disabled={!dias[d].activo} value={dias[d].from} onChange={(e) => setDias({ ...dias, [d]: { ...dias[d], from: e.target.value } })} />
              <Input type="time" aria-label={`${DIAS[d]} hasta`} disabled={!dias[d].activo} value={dias[d].to} onChange={(e) => setDias({ ...dias, [d]: { ...dias[d], to: e.target.value } })} />
            </div>
          ))}
          {ninguno && <p className="text-[12px] text-muted">Sin días marcados vale el horario de atención de la marca.</p>}
        </div>
      </div>
    </Modal>
  );
}

function AgregarMiembro({ canal, datos, onClose, onListo }: { canal: Canal; datos: Respuesta; onClose: () => void; onListo: () => void }) {
  const ya = new Set(canal.miembros.map((m) => m.user_id));
  const opciones = datos.candidatos.filter((x) => !ya.has(x.value)).map((x) => ({
    value: x.value, label: `${x.label} · ${x.rol} · ${x.marcas_texto}${x.rol === "Vendedora" && x.marcas.length && !x.marcas.includes(canal.brand_id) ? " (no atiende esta marca)" : ""}`,
  }));
  const [d, setD] = useState({ user_id: "", tope: String(datos.tope) });
  return (
    <Dialogo titulo={`Agregar miembro · ${canal.display_name}`} boton="Agregar" onClose={onClose}
      aviso="Solo vendedoras de la marca del número y supervisoras de ventas atienden chats."
      enviar={async () => {
        await api(`/v1/crm/canales/${canal.id}/miembros`, { method: "POST", body: { user_id: d.user_id, max_open_conversations: Number(d.tope) } });
        toast.ok("Miembro agregado");
        onListo();
      }}>
      {(errores) => (
        <>
          <Field label="Persona" required error={errores.user_id} className="sm:col-span-2">
            <Select value={d.user_id} onChange={(e) => setD({ ...d, user_id: e.target.value })} placeholder="Elige la persona" options={opciones} />
          </Field>
          <Field label="Tope de chats abiertos" error={errores.max_open_conversations} hint="Solo cuenta para las vendedoras.">
            <Input type="number" min={1} max={100} value={d.tope} onChange={(e) => setD({ ...d, tope: e.target.value })} />
          </Field>
        </>
      )}
    </Dialogo>
  );
}
