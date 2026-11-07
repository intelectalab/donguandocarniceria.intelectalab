"use client";

import { useEffect, useState } from "react";
import { Blocks, CheckCircle2, Cpu, PhoneCall, Power, PowerOff, Undo2 } from "lucide-react";
import {
  Badge, Button, Cifra, DataTable, DetailList, Field, Modal, PageHeader, Select, Textarea, confirmAction, toast, type Column,
} from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { sinCodigos } from "@/modulos/plt/tipos";
import { fechaHora, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";

type Modulo = {
  code: string; name: string; description: string; is_core: boolean; plataforma: boolean; enabled: boolean;
  depends_on: string[]; uses: string[]; dependientes: string[];
  changed_at: string | null; changed_by: string | null; reason: string | null;
};
type Paso = { no: number; code: string; nombre: string; descripcion: string; done: boolean; done_at: string | null; done_by_name: string | null; notes: string | null };
type Respuesta = {
  modulos: Modulo[];
  resumen: { total: number; encendidos: number; apagados: string[]; nucleo: string[] };
  tel: Paso[];
  responsables: { id: string; name: string }[];
};

/** PLT-12 Módulos: qué módulos usa la empresa, con lo que cada uno necesita, y la lista de activación de Telefonía. */
export default function Modulos() {
  const { can, recargar: recargarSesion } = useSesion();
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [estado, setEstado] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [viendo, setViendo] = useState<Modulo | null>(null);
  const [paso, setPaso] = useState<Paso | null>(null);
  const [ocupado, setOcupado] = useState("");
  const puede = can("plt.module.toggle");

  useEffect(() => {
    let vigente = true;
    api<Respuesta>("/v1/plt/modulos").then((r) => { if (vigente) { setDatos(r); setError(""); } }).catch((err) => vigente && setError(mensajeDe(err)));
    return () => { vigente = false; };
  }, [version]);

  const recargar = () => setVersion((v) => v + 1);
  const mods = datos?.modulos ?? [];
  const porCodigo = new Map(mods.map((m) => [m.code, m]));
  const encendido = (c: string) => porCodigo.get(c)?.enabled ?? false;
  const r = datos?.resumen;
  const tel = porCodigo.get("TEL");
  const pendientesTel = (datos?.tel ?? []).filter((p) => p.code !== "SWITCH_ON" && !p.done);

  const q = busqueda.trim().toLowerCase();
  const filas = mods.filter((m) => (!estado || (estado === "ON") === m.enabled)
    && (!q || `${m.code} ${m.name} ${m.description}`.toLowerCase().includes(q)));

  /** Por qué no se puede cambiar (o null): núcleo, de la plataforma, dependencias o la lista de TEL. */
  function bloqueo(m: Modulo): string | null {
    if (m.is_core) return "Es parte del núcleo: siempre está encendido.";
    if (m.plataforma) return "Lo maneja Intelectalab.";
    if (m.enabled) {
      const dep = m.dependientes.filter(encendido);
      return dep.length ? `Primero apaga ${dep.join(", ")}, que lo necesita${dep.length > 1 ? "n" : ""}.` : null;
    }
    const faltan = m.depends_on.filter((c) => !encendido(c));
    if (faltan.length) return `Primero enciende ${faltan.join(", ")}.`;
    if (m.code === "TEL" && pendientesTel.length) return "Completa la lista de activación de Telefonía.";
    return null;
  }

  async function cambiar(m: Modulo) {
    const on = !m.enabled;
    const res = await confirmAction({
      title: `${on ? "Encender" : "Apagar"} ${m.code} · ${m.name}`,
      message: on
        ? `Aparecen sus pantallas, botones e indicadores, y sus permisos vuelven a valer.${m.uses.length ? ` Aprovecha también, si están encendidos: ${m.uses.join(", ")}.` : ""}`
        : "Se ocultan sus pantallas, botones e indicadores, y sus permisos dejan de valer. Lo ya registrado se conserva.",
      confirmLabel: on ? "Encender" : "Apagar", danger: !on,
      reason: { label: "Motivo", min: 10 },
    });
    if (!res) return;
    setOcupado(m.code);
    try {
      await api(`/v1/plt/modulos/${m.code}`, { method: "PUT", body: { enabled: on, reason: res.reason } });
      toast.ok(`${m.name} ${on ? "encendido" : "apagado"}`);
      recargar();
      void recargarSesion(); // el menú y los permisos cambian con el módulo
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  async function deshacer(p: Paso) {
    const ok = await confirmAction({ title: `Deshacer «${p.nombre}»`, message: "El paso vuelve a quedar pendiente.", confirmLabel: "Deshacer" });
    if (!ok) return;
    try {
      await api(`/v1/plt/modulos/tel/pasos/${p.code}`, { method: "DELETE" });
      toast.ok("Paso reabierto");
      recargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    }
  }

  const columnas: Column<Modulo>[] = [
    { key: "code", header: "Código", render: (m) => <span className="font-mono font-semibold">{m.code}</span> },
    { key: "name", header: "Módulo", cardTitle: true, render: (m) => (
      <div className="min-w-[180px]">
        <p className="font-medium">{m.name}</p>
        {m.description && <p className="line-clamp-1 text-[12px] text-muted" title={m.description}>{m.description}</p>}
      </div>
    ) },
    { key: "depends_on", header: "Necesita", hideOnMobile: true, render: (m) => m.depends_on.length
      ? <span className="font-mono text-[12.5px]">{m.depends_on.map((c) => <span key={c} className={encendido(c) ? "" : "text-bad"}>{c} </span>)}</span>
      : <span className="text-muted">{m.is_core ? "—" : "Solo el núcleo"}</span> },
    { key: "dependientes", header: "Dependen de él", hideOnMobile: true, render: (m) => {
      const on = m.dependientes.filter(encendido);
      return on.length ? <span className="font-mono text-[12.5px]">{on.join(", ")}</span> : <span className="text-muted">—</span>;
    } },
    { key: "status", header: "Estado", render: (m) => m.is_core ? <Badge tone="info">Núcleo</Badge>
      : m.plataforma ? <Badge tone="neutral">Plataforma</Badge> : m.enabled ? <Badge tone="ok" dot>Encendido</Badge> : <Badge tone="warn" dot>Apagado</Badge> },
    { key: "reason", header: "Motivo", hideOnMobile: true, render: (m) => m.reason
      ? <span className="line-clamp-2 block max-w-[260px] text-[12.5px]" title={m.reason}>{m.reason}</span> : <span className="text-muted">—</span> },
    ...(puede ? [{ key: "accion", header: "", hideInCard: false, render: (m: Modulo) => {
      if (m.is_core || m.plataforma) return null;
      const motivo = bloqueo(m);
      return (
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Button size="sm" variant={m.enabled ? "ghost" : "primary"} icon={m.enabled ? PowerOff : Power} disabled={Boolean(motivo) || Boolean(ocupado)}
            loading={ocupado === m.code} title={motivo ?? undefined} onClick={() => cambiar(m)}>{m.enabled ? "Apagar" : "Encender"}</Button>
        </span>
      );
    } }] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Los módulos que usa la empresa. Uno apagado oculta sus pantallas, botones e indicadores, y sus permisos no valen; lo registrado se conserva. Para encender un módulo deben estar encendidos los que necesita, y no se apaga si otro encendido lo necesita. Los del núcleo siempre están encendidos." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Módulos" valor={r ? numero(r.total) : undefined} detalle="En el catálogo" icono={Blocks} destacada />
        <Cifra titulo="Encendidos" valor={r ? numero(r.encendidos) : undefined} detalle="" icono={Power} tono="ok" />
        <Cifra titulo="Apagados" valor={r ? numero(r.apagados.length) : undefined} detalle={r?.apagados.join(", ") ?? ""} icono={PowerOff}
          tono={r?.apagados.length ? "warn" : undefined} />
        <Cifra titulo="Núcleo" valor={r ? numero(r.nucleo.length) : undefined} detalle={r?.nucleo.join(", ") ?? ""} icono={Cpu} />
      </div>

      {datos && tel && (
        <section className="rounded-xl border border-line bg-surface shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span aria-hidden="true" className="grid size-9 place-items-center rounded-[10px] bg-primary-soft text-primary"><PhoneCall size={18} /></span>
              <div>
                <h2 className="text-[14px] font-semibold">Telefonía: lista de activación</h2>
                <p className="text-[12.5px] text-muted">Solo se enciende con los pasos 1 a 5 hechos. Necesita {tel.depends_on.join(", ")}.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {tel.enabled ? <Badge tone="ok" dot>Encendido</Badge> : <Badge tone="warn" dot>Incluido y apagado</Badge>}
              <Badge tone={pendientesTel.length ? "warn" : "ok"}>{datos.tel.filter((p) => p.done).length} de {datos.tel.length} pasos</Badge>
            </div>
          </div>
          <ol className="divide-y divide-line">
            {datos.tel.map((p) => (
              <li key={p.code} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 px-4 py-3 sm:grid-cols-[28px_minmax(0,1fr)_auto] sm:items-start">
                <span className={`grid size-7 place-items-center rounded-full text-[12px] font-semibold ${p.done ? "bg-ok-soft text-ok" : "bg-surface-2 text-muted"}`}>
                  {p.done ? <CheckCircle2 size={15} aria-label="Hecho" /> : p.no}
                </span>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold">{p.nombre}</p>
                  <p className="text-[12.5px] text-muted">{p.descripcion}</p>
                  {p.done && p.code !== "SWITCH_ON" && (
                    <p className="mt-1 text-[12.5px]">Hecho el {fechaHora(p.done_at)}{p.done_by_name ? ` · ${p.done_by_name}` : ""}{p.notes ? ` · ${sinCodigos(p.notes)}` : ""}</p>
                  )}
                  {!p.done && p.notes && <p className="mt-1 text-[12.5px] text-warn">{sinCodigos(p.notes)}</p>}
                </div>
                <div className="col-start-2 sm:col-start-auto">
                  {p.code === "SWITCH_ON" ? (
                    p.done ? <Badge tone="ok">Encendido</Badge> : <span className="text-[12px] text-muted">Al encender</span>
                  ) : puede && (p.done
                    ? <Button size="sm" variant="ghost" icon={Undo2} disabled={tel.enabled} title={tel.enabled ? "Con Telefonía encendida la lista no se deshace" : undefined}
                        onClick={() => deshacer(p)}>Deshacer</Button>
                    : <Button size="sm" onClick={() => setPaso(p)}>Marcar hecho</Button>)}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <DataTable columns={columnas} rows={filas} rowKey={(m) => m.code} loading={!datos && !error} error={error || undefined} onRetry={recargar}
        search={{ value: busqueda, onChange: setBusqueda, placeholder: "Buscar módulo…" }}
        onRowClick={setViendo}
        empty="Ningún módulo coincide."
        toolbar={
          <div className="w-full sm:w-[160px]">
            <Select aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)} placeholder="Estado: todos"
              options={[{ value: "ON", label: "Encendidos" }, { value: "OFF", label: "Apagados" }]} className="!min-h-9 h-9 py-1.5 text-[13px]" />
          </div>
        } />

      {viendo && <FichaModulo m={viendo} encendido={encendido} onClose={() => setViendo(null)} />}
      {paso && datos && (
        <MarcarPaso paso={paso} responsables={datos.responsables} onClose={() => setPaso(null)} onHecho={() => { setPaso(null); recargar(); }} />
      )}
    </div>
  );
}

function FichaModulo({ m, encendido, onClose }: { m: Modulo; encendido: (c: string) => boolean; onClose: () => void }) {
  const [eventos, setEventos] = useState<{ event_name: string; payload: string | { reason?: string }; occurred_at: string }[] | null>(null);

  useEffect(() => {
    let vigente = true;
    api<typeof eventos>(`/v1/plt/modulos/${m.code}/eventos`).then((r) => vigente && setEventos(r ?? [])).catch(() => vigente && setEventos([]));
    return () => { vigente = false; };
  }, [m.code]);

  const lista = (cs: string[]) => cs.length ? cs.map((c) => `${c}${encendido(c) ? "" : " (apagado)"}`).join(", ") : "—";
  return (
    <Modal open onClose={onClose} title={`${m.code} · ${m.name}`} description={m.description} footer={<Button onClick={onClose}>Cerrar</Button>}>
      <DetailList items={[
        { label: "Núcleo", value: m.is_core ? "Sí, siempre encendido" : "No" },
        { label: "Estado", value: m.plataforma ? <Badge tone="neutral">Lo maneja Intelectalab</Badge>
          : m.enabled ? <Badge tone="ok" dot>Encendido</Badge> : <Badge tone="warn" dot>Apagado</Badge> },
        { label: "Necesita", value: m.is_core ? "—" : m.depends_on.length ? lista(m.depends_on) : "Solo el núcleo" },
        { label: "Usa si están encendidos", value: lista(m.uses) },
        { label: "Dependen de él", value: lista(m.dependientes) },
        { label: "Último cambio", value: m.changed_at ? `${fechaHora(m.changed_at)}${m.changed_by ? ` · ${m.changed_by}` : ""}` : "—" },
        { label: "Motivo", value: m.reason ?? "—" },
      ]} />
      <section className="mt-6 border-t border-line pt-4">
        <h3 className="mb-2 text-[14px] font-semibold">Encendidos y apagados</h3>
        {eventos === null ? <p className="text-[13px] text-muted">Cargando…</p> : eventos.length ? (
          <ul className="divide-y divide-line text-[13px]">
            {eventos.map((e, i) => {
              const p = typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload;
              return (
                <li key={i} className="py-2">
                  <b>{e.event_name === "module.enabled" ? "Encendido" : "Apagado"}</b> · {fechaHora(e.occurred_at)}
                  {p?.reason && <p className="text-[12.5px] text-muted">{p.reason}</p>}
                </li>
              );
            })}
          </ul>
        ) : <p className="text-[13px] text-muted">Sin cambios registrados desde la puesta en marcha.</p>}
      </section>
    </Modal>
  );
}

function MarcarPaso({ paso, responsables, onClose, onHecho }:
  { paso: Paso; responsables: { id: string; name: string }[]; onClose: () => void; onHecho: () => void }) {
  const { me } = useSesion();
  const [responsable, setResponsable] = useState(me.user.id);
  const [evidencia, setEvidencia] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    setError("");
    try {
      await api(`/v1/plt/modulos/tel/pasos/${paso.code}`, { method: "POST", body: { notes: evidencia, done_by: responsable || null } });
      toast.ok("Paso registrado");
      onHecho();
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!guardando} size="sm" placement="center" title={`Paso ${paso.no}: ${paso.nombre}`}
      footer={<>
        <Button onClick={onClose} disabled={guardando}>Cancelar</Button>
        <Button variant="primary" loading={guardando} disabled={!evidencia.trim()} onClick={guardar}>Marcar hecho</Button>
      </>}>
      <div className="grid gap-4">
        <p className="text-[13px] text-muted">{paso.descripcion}</p>
        {error && <p role="alert" className="text-[13px] text-bad">{error}</p>}
        <Field label="Responsable" required>
          <Select value={responsable} onChange={(e) => setResponsable(e.target.value)} options={responsables.map((u) => ({ value: u.id, label: u.name }))} />
        </Field>
        <Field label="Evidencia" required hint="Documento, constancia o prueba realizada.">
          <Textarea value={evidencia} onChange={(e) => setEvidencia(e.target.value)} rows={3} />
        </Field>
      </div>
    </Modal>
  );
}
