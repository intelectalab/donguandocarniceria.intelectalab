"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Clock, Megaphone, Plus, Save } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column, type Tone } from "@/components/ui";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { erroresDe, mensajeDe } from "@/lib/api";
import { usePagina } from "@/lib/paginas";
import { apiConsola } from "@/lib/consola";
import { fechaHora } from "@/lib/formato";

type Aviso = { estado: string; vence: string | null };
type Incidente = {
  id: string; number: string; title: string; severity: string; severity_name: string; component_code: string | null; component_name: string | null;
  status: string; status_name: string; affects_all: boolean; started_at: string; resolved_at: string | null; duracion_min: number;
  public_message: string | null; customers_notified_at: string | null; aviso: Aviso; root_cause: string | null; postmortem: string | null;
  source: string; created_by_name: string; empresas?: number | { id: string; short: string }[]; tickets?: number | { id: string; number: string; subject: string; status: string; tenant_short: string }[];
};
type Detalle = Incidente & { empresas: { id: string; short: string }[]; tickets: { id: string; number: string; subject: string; status: string; tenant_short: string }[];
  linea: { status: string; status_name: string; message: string; public: boolean; author_name: string; at: string }[] };
type Lista = { data: Incidente[]; current_page: number; last_page: number; per_page: number; total: number; severidades: Record<string, string>; estados: Record<string, string>; componentes: { code: string; name: string }[] };

const TONO_SEV: Record<string, Tone> = { SEV1: "bad", SEV2: "bad", SEV3: "warn", SEV4: "neutral" };
const ESTADOS: Record<string, [string, Tone]> = { INVESTIGATING: ["Investigando", "bad"], IDENTIFIED: ["Causa identificada", "warn"], MONITORING: ["En observación", "info"], RESOLVED: ["Resuelto", "ok"] };
const AVISO: Record<string, [string, string]> = {
  PENDIENTE: ["Avisar a los clientes antes de", "text-warn"], VENCIDO: ["Venció el aviso a los clientes", "text-bad"], A_TIEMPO: ["Clientes avisados a tiempo", "text-ok"],
  FUERA_DE_PLAZO: ["Clientes avisados fuera de plazo", "text-bad"], SIN_AVISO: ["Se resolvió sin avisar a los clientes", "text-muted"],
  AVISADO: ["Clientes avisados", "text-ok"], NO_APLICA: ["", ""],
};
const duracion = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
const aIso = (v: string) => (v ? new Date(v).toISOString() : null);

function PlazoAviso({ a }: { a: Aviso }) {
  const [texto, clase] = AVISO[a.estado] ?? ["", ""];
  if (!texto) return null;
  return <span className={`inline-flex items-center gap-1 text-[12px] ${clase}`}><Clock size={12} aria-hidden="true" />{texto}{a.estado === "PENDIENTE" && a.vence ? ` ${fechaHora(a.vence)}` : ""}</span>;
}

/** Incidentes: alta, severidad, componente, empresas afectadas, línea de tiempo, aviso a clientes, causa raíz y post mortem. */
export default function Incidentes() {
  return <Suspense><Contenido /></Suspense>;
}

function Contenido() {
  const yo = useUsuarioConsola();
  const router = useRouter();
  const abierto = useSearchParams().get("incidente");
  const [f, setF] = useState({ status: "ABIERTOS", severity: "" });
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [nuevo, setNuevo] = useState(false);
  const pag = usePagina(JSON.stringify(f));

  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    apiConsola<Lista>(`/incidentes?${q}&${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs]);
  useEffect(() => cargar(), [cargar]);
  const ver = (id: string | null) => router.replace(id ? `/consola/incidentes?incidente=${id}` : "/consola/incidentes", { scroll: false });

  const columnas: Column<Incidente>[] = [
    { key: "title", header: "Incidente", cardTitle: true, render: (i) => (
      <div><p className="font-semibold text-ink">{i.title}</p><p className="text-[12.5px] text-muted">{i.number}{i.component_name ? ` · ${i.component_name}` : ""}{i.source === "AUTO" ? " · abierto por la lectura de salud" : ""}</p></div>
    ) },
    { key: "severity", header: "Severidad", render: (i) => <Badge tone={TONO_SEV[i.severity]}>{i.severity_name}</Badge> },
    { key: "status", header: "Estado", render: (i) => <div className="grid gap-0.5"><StatusBadge status={i.status} labels={ESTADOS} /><PlazoAviso a={i.aviso} /></div> },
    { key: "empresas", header: "Afecta a", hideOnMobile: true, render: (i) => (i.affects_all ? "Todas las empresas" : `${i.empresas} empresa(s)`) },
    { key: "started_at", header: "Inicio y duración", hideOnMobile: true, render: (i) => <div><p>{fechaHora(i.started_at)}</p><p className="text-[12px] text-muted">{duracion(i.duracion_min)}</p></div> },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="Un SEV1 o SEV2 se avisa a las empresas afectadas dentro del plazo (30 minutos): el mensaje público les llega como anuncio en su sistema y a sus administradores en la campana. Se resuelve con hora de cierre y causa raíz."
        actions={yo.puede["incident.manage"] ? <Button variant="primary" icon={Plus} onClick={() => setNuevo(true)}>Nuevo incidente</Button> : undefined} />
      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <Select aria-label="Estado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} placeholder="Todos"
          options={[{ value: "ABIERTOS", label: "Abiertos" }, ...Object.entries(ESTADOS).map(([value, [label]]) => ({ value, label }))]} />
        <Select aria-label="Severidad" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })} placeholder="Toda severidad"
          options={Object.entries(lista?.severidades ?? {}).map(([value, label]) => ({ value, label }))} />
      </div>
      <DataTable columns={columnas} rows={lista?.data ?? []} loading={!lista && !error} error={error} onRetry={cargar} onRowClick={(i) => ver(i.id)} pagination={pag.props(lista)}
        empty="No hay incidentes con estos filtros." />
      {nuevo && lista && <FormIncidente lista={lista} onClose={() => setNuevo(false)} onListo={(i) => { setNuevo(false); cargar(); ver(i.id); }} />}
      {abierto && lista && <DetalleIncidente key={abierto} id={abierto} lista={lista} onClose={() => ver(null)} onCambio={cargar} />}
    </div>
  );
}

function FormIncidente({ lista, actual, onClose, onListo }: { lista: Lista; actual?: Detalle; onClose: () => void; onListo: (i: Detalle) => void }) {
  const [empresas, setEmpresas] = useState<{ id: string; short: string }[]>([]);
  const [f, setF] = useState({
    title: actual?.title ?? "", severity: actual?.severity ?? "SEV3", component_code: actual?.component_code ?? "", affects_all: actual?.affects_all ?? true,
    tenants: actual?.empresas.map((e) => e.id) ?? [] as string[], message: "",
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    apiConsola<{ empresas: { id: string; short: string }[] }>("/accesos/opciones").then((r) => setEmpresas(r.empresas)).catch(() => undefined);
  }, []);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const body = { ...f, component_code: f.component_code || null, tenants: f.affects_all ? [] : f.tenants };
      const r = await apiConsola<Detalle>(actual ? `/incidentes/${actual.id}` : "/incidentes", { method: actual ? "PUT" : "POST", body });
      toast.ok(actual ? "Incidente actualizado" : `Incidente ${r.number} abierto`);
      onListo(r);
    } catch (err) {
      setErrores(erroresDe(err));
      toast.error(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!guardando} title={actual ? `Editar ${actual.number}` : "Nuevo incidente"}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" type="submit" form="f-incidente" icon={Save} loading={guardando}>Guardar</Button></>}>
      <form id="f-incidente" onSubmit={guardar} className="grid gap-4">
        <Field label="Título" required error={errores.title}><Input value={f.title} maxLength={150} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Severidad" required error={errores.severity}>
            <Select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })} options={Object.entries(lista.severidades).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Componente" error={errores.component_code}>
            <Select value={f.component_code} onChange={(e) => setF({ ...f, component_code: e.target.value })} placeholder="Ninguno en particular"
              options={lista.componentes.map((c) => ({ value: c.code, label: c.name }))} />
          </Field>
        </div>
        <Checkbox checked={f.affects_all} onChange={(v) => setF({ ...f, affects_all: v })} label="Afecta a todas las empresas" />
        {!f.affects_all && (
          <Field label="Empresas afectadas" error={errores.tenants}>
            <div className="grid max-h-48 grid-cols-2 gap-x-3 gap-y-1.5 overflow-y-auto rounded-lg border border-line p-2.5">
              {empresas.map((t) => <Checkbox key={t.id} checked={f.tenants.includes(t.id)} label={t.short}
                onChange={(v) => setF({ ...f, tenants: v ? [...f.tenants, t.id] : f.tenants.filter((x) => x !== t.id) })} />)}
            </div>
          </Field>
        )}
        {!actual && <Field label="Primera nota (interna)"><Textarea rows={2} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>}
      </form>
    </Modal>
  );
}

function DetalleIncidente({ id, lista, onClose, onCambio }: { id: string; lista: Lista; onClose: () => void; onCambio: () => void }) {
  const yo = useUsuarioConsola();
  const puede = Boolean(yo.puede["incident.manage"]);
  const [i, setI] = useState<Detalle | null>(null);
  const [editar, setEditar] = useState(false);
  const [u, setU] = useState({ status: "", message: "", public: false });
  const [r, setR] = useState({ resolved_at: "", root_cause: "", postmortem: "", message: "" });
  const [pm, setPm] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    apiConsola<Detalle>(`/incidentes/${id}`).then((x) => { setI(x); setU((v) => ({ ...v, status: x.status === "RESOLVED" ? "MONITORING" : x.status })); })
      .catch((e) => toast.error(mensajeDe(e)));
  }, [id]);

  async function enviar(ruta: string, body: object, aviso: string, metodo: "POST" | "PUT" = "POST") {
    setEnviando(true);
    try {
      const x = await apiConsola<Detalle>(`/incidentes/${id}/${ruta}`, { method: metodo, body });
      setI(x);
      setErrores({});
      toast.ok(aviso);
      onCambio();
      return true;
    } catch (err) {
      setErrores(erroresDe(err));
      toast.error(mensajeDe(err));
      return false;
    } finally {
      setEnviando(false);
    }
  }

  const abierto = i && i.status !== "RESOLVED";
  return (
    <Modal open onClose={onClose} size="xl" title={i ? `${i.number} · ${i.title}` : "Incidente"}
      description={i ? <span className="inline-flex flex-wrap items-center gap-2"><Badge tone={TONO_SEV[i.severity]}>{i.severity_name}</Badge>
        <StatusBadge status={i.status} labels={ESTADOS} /><PlazoAviso a={i.aviso} /></span> : undefined}>
      {!i ? <p className="text-muted">Cargando…</p> : (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="grid content-start gap-5">
            {abierto && puede && (
              <form className="grid gap-3 rounded-xl border border-line p-3.5" onSubmit={async (e) => {
                e.preventDefault();
                if (await enviar("actualizaciones", u, u.public ? "Actualización publicada a los clientes" : "Nota agregada")) setU({ ...u, message: "", public: false });
              }}>
                <p className="text-[13.5px] font-semibold text-ink">Agregar a la línea de tiempo</p>
                <Field label="Estado"><Select value={u.status} onChange={(e) => setU({ ...u, status: e.target.value })}
                  options={Object.entries(lista.estados).filter(([k]) => k !== "RESOLVED").map(([value, label]) => ({ value, label }))} /></Field>
                <Field label="Mensaje" error={errores.message}><Textarea rows={3} value={u.message} onChange={(e) => setU({ ...u, message: e.target.value })} /></Field>
                <Checkbox checked={u.public} onChange={(v) => setU({ ...u, public: v })} label="Mensaje público: lo ven las empresas afectadas en su sistema" />
                <Button type="submit" variant="primary" icon={Megaphone} loading={enviando} className="justify-self-start">{u.public ? "Publicar" : "Agregar nota"}</Button>
              </form>
            )}
            {abierto && puede && (
              <form className="grid gap-3 rounded-xl border border-line p-3.5" onSubmit={(e) => {
                e.preventDefault();
                enviar("resolver", { ...r, resolved_at: aIso(r.resolved_at), postmortem: r.postmortem || null, message: r.message || null }, "Incidente resuelto");
              }}>
                <p className="text-[13.5px] font-semibold text-ink">Resolver</p>
                <Field label="Hora de cierre" hint="Vacío: ahora." error={errores.resolved_at}><Input type="datetime-local" value={r.resolved_at} onChange={(e) => setR({ ...r, resolved_at: e.target.value })} /></Field>
                <Field label="Causa raíz" required error={errores.root_cause}><Textarea rows={2} value={r.root_cause} onChange={(e) => setR({ ...r, root_cause: e.target.value })} /></Field>
                <Field label="Mensaje de cierre para los clientes" hint="Solo si ya se les avisó."><Textarea rows={2} value={r.message} onChange={(e) => setR({ ...r, message: e.target.value })} /></Field>
                <Field label="Post mortem"><Textarea rows={3} value={r.postmortem} onChange={(e) => setR({ ...r, postmortem: e.target.value })} /></Field>
                <Button type="submit" icon={CheckCircle2} loading={enviando} className="justify-self-start">Resolver</Button>
              </form>
            )}
            {!abierto && (
              <div className="grid gap-2 rounded-xl border border-line p-3.5 text-[13.5px]">
                <p><span className="text-muted">Causa raíz: </span>{i.root_cause}</p>
                <p className="text-muted">Post mortem</p>
                {puede ? (
                  <>
                    <Textarea rows={5} value={pm ?? i.postmortem ?? ""} onChange={(e) => setPm(e.target.value)} />
                    <Button size="sm" icon={Save} disabled={enviando || pm === null} className="justify-self-start"
                      onClick={() => enviar("postmortem", { postmortem: pm }, "Post mortem guardado", "PUT").then((ok) => ok && setPm(null))}>Guardar post mortem</Button>
                  </>
                ) : <p className="whitespace-pre-wrap">{i.postmortem ?? "Sin post mortem todavía."}</p>}
              </div>
            )}
            <div className="grid gap-1.5">
              <p className="text-[13px] font-semibold text-ink">Línea de tiempo</p>
              <ol className="grid gap-1.5">
                {i.linea.map((l, k) => (
                  <li key={k} className="grid gap-0.5 rounded-lg border border-line px-3 py-2 text-[12.5px]">
                    <span className="flex flex-wrap items-center gap-2"><StatusBadge status={l.status} labels={ESTADOS} />{l.public && <Badge tone="info">Público</Badge>}
                      <span className="text-muted">{l.author_name} · {fechaHora(l.at)}</span></span>
                    <span className="whitespace-pre-wrap text-ink">{l.message}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <aside className="grid content-start gap-4 text-[13px]">
            <dl className="grid gap-1.5">
              <div><dt className="text-muted">Componente</dt><dd className="text-ink">{i.component_name ?? "—"}</dd></div>
              <div><dt className="text-muted">Inicio</dt><dd className="text-ink">{fechaHora(i.started_at)}</dd></div>
              <div><dt className="text-muted">Duración</dt><dd className="text-ink">{duracion(i.duracion_min)}{i.resolved_at ? ` · cerró ${fechaHora(i.resolved_at)}` : ""}</dd></div>
              <div><dt className="text-muted">Afecta a</dt><dd className="text-ink">{i.affects_all ? "Todas las empresas" : i.empresas.map((e) => e.short).join(", ") || "Ninguna elegida"}</dd></div>
              <div><dt className="text-muted">Abierto por</dt><dd className="text-ink">{i.created_by_name}</dd></div>
            </dl>
            {i.public_message && <Alert tone="info" title="Último mensaje público">{i.public_message}</Alert>}
            <div className="grid gap-1">
              <p className="font-semibold text-ink">Tickets vinculados ({i.tickets.length})</p>
              {i.tickets.length === 0 ? <p className="text-muted">Se vinculan desde la bandeja de tickets.</p>
                : i.tickets.map((t) => <p key={t.id} className="text-ink">{t.number} · {t.tenant_short} · {t.subject}</p>)}
            </div>
            {abierto && puede && <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setEditar(true)}>Editar datos del incidente</Button>}
          </aside>
          {editar && <FormIncidente lista={lista} actual={i} onClose={() => setEditar(false)} onListo={(x) => { setEditar(false); setI(x); onCambio(); }} />}
        </div>
      )}
    </Modal>
  );
}
