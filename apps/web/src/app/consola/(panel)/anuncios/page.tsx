"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, Megaphone, Pencil, Plus, Save, Send } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DataTable, DetailList, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea, confirmAction, toast, type Column, type Tone } from "@/components/ui";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { erroresDe, mensajeDe } from "@/lib/api";
import { usePagina } from "@/lib/paginas";
import { apiConsola } from "@/lib/consola";
import { fechaHora } from "@/lib/formato";

type Anuncio = {
  id: string; title: string; body: string; kind: string; kind_name: string; audience: string; audience_name: string; audience_plans: string[]; audience_tenants: string[];
  starts_at: string; ends_at: string | null; maintenance_starts_at: string | null; maintenance_ends_at: string | null; status: string; status_name: string;
  published_at: string | null; incident_id: string | null; incident_number: string | null; created_by_name: string; created_at: string;
};
type Lista = { data: Anuncio[]; current_page: number; last_page: number; per_page: number; total: number; planes: { code: string; name: string }[]; empresas: { id: string; short: string }[]; aviso_horas: number; tipos: Record<string, string> };

const ESTADOS: Record<string, [string, Tone]> = { DRAFT: ["Borrador", "neutral"], SCHEDULED: ["Programado", "info"], ACTIVE: ["Publicado", "ok"], ENDED: ["Terminado", "neutral"], CANCELLED: ["Cancelado", "neutral"] };
const TONO_TIPO: Record<string, Tone> = { INFO: "info", MAINTENANCE: "warn", INCIDENT: "bad", FEATURE: "primary" };
// Para los campos de fecha y hora del navegador (hora local) y de vuelta a ISO.
const local = (v: string | null) => (v ? new Date(new Date(v).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const aIso = (v: string) => (v ? new Date(v).toISOString() : null);

/** Anuncios: redactar, programar y publicar avisos para todas las empresas, por plan o para empresas elegidas. */
export default function Anuncios() {
  const yo = useUsuarioConsola();
  const puede = Boolean(yo.puede["announce.manage"]);
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [editando, setEditando] = useState<Anuncio | "nuevo" | null>(null);
  const [f, setF] = useState({ kind: "", status: "" });
  const [visto, setVisto] = useState<Anuncio | null>(null);
  const pag = usePagina(JSON.stringify(f));

  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    apiConsola<Lista>(`/anuncios?${q}&${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs]);
  useEffect(() => cargar(), [cargar]);

  async function accion(a: Anuncio, ruta: "publicar" | "cancelar") {
    if (ruta === "cancelar" && !(await confirmAction({ title: `¿Cancelar «${a.title}»?`, confirmLabel: "Cancelar anuncio", danger: true, message: "Deja de verse en las empresas." }))) return;
    try {
      const r = await apiConsola<Anuncio>(`/anuncios/${a.id}/${ruta}`, { method: "POST" });
      toast.ok(ruta === "cancelar" ? "Anuncio cancelado" : r.status === "SCHEDULED" ? "Anuncio programado" : "Anuncio publicado");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const columnas: Column<Anuncio>[] = [
    { key: "title", sortable: true, header: "Anuncio", cardTitle: true, render: (a) => (
      <div><p className="font-semibold text-ink">{a.title}</p><p className="line-clamp-2 text-[12.5px] text-muted">{a.body}</p></div>
    ) },
    { key: "kind", sortable: true, header: "Tipo", render: (a) => <Badge tone={TONO_TIPO[a.kind]}>{a.kind_name}{a.incident_number ? ` · ${a.incident_number}` : ""}</Badge> },
    { key: "audience", sortable: true, header: "Para", hideOnMobile: true, render: (a) => (
      <span>{a.audience === "PLANS" ? `Plan ${a.audience_plans.map((p) => lista?.planes.find((x) => x.code === p)?.name ?? p).join(", ")}`
        : a.audience === "TENANTS" ? `${a.audience_tenants.length} ${a.audience_tenants.length === 1 ? "empresa" : "empresas"}` : a.audience_name}</span>
    ) },
    { key: "starts_at", sortable: true, header: "Se ve", hideOnMobile: true, render: (a) => (
      <div className="text-[12.5px]"><p>Desde {fechaHora(a.starts_at)}</p>{a.ends_at && <p className="text-muted">Hasta {fechaHora(a.ends_at)}</p>}
        {a.maintenance_starts_at && <p className="text-warn">Mantenimiento {fechaHora(a.maintenance_starts_at)}</p>}</div>
    ) },
    { key: "status", header: "Estado", render: (a) => <StatusBadge status={a.status} labels={ESTADOS} /> },
    ...(puede ? [{ key: "acciones", header: "", align: "right" as const, render: (a: Anuncio) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {a.status === "DRAFT" && <Button size="sm" variant="primary" icon={Send} onClick={() => accion(a, "publicar")}>Publicar</Button>}
        {!["CANCELLED", "ENDED"].includes(a.status) && a.kind !== "INCIDENT" && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditando(a)}>Editar</Button>}
        {!["CANCELLED", "ENDED"].includes(a.status) && <Button size="sm" variant="ghost" icon={Ban} onClick={() => accion(a, "cancelar")}>Cancelar</Button>}
      </div>
    ) }] : []),
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description={`Las empresas ven solo los anuncios dirigidos a ellas, como una franja en su sistema mientras dure la ventana. Un mantenimiento se anuncia con al menos ${lista?.aviso_horas ?? 48} horas de anticipación. Los de incidentes se publican desde el incidente.`}
        actions={puede ? <Button variant="primary" icon={Plus} onClick={() => setEditando("nuevo")}>Nuevo anuncio</Button> : undefined} />
      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <Select aria-label="Estado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} placeholder="Todos los estados"
          options={Object.entries(ESTADOS).map(([value, [label]]) => ({ value, label }))} />
        <Select aria-label="Tipo" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} placeholder="Todos los tipos"
          options={Object.entries(lista?.tipos ?? {}).map(([value, label]) => ({ value, label }))} />
      </div>
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} loading={!lista && !error} error={error} onRetry={cargar} pagination={pag.props(lista)} onRowClick={setVisto}
        empty={<span className="inline-flex items-center gap-2"><Megaphone size={16} aria-hidden="true" />Todavía no hay anuncios.</span>} />
      {visto && lista && (
        <Modal open onClose={() => setVisto(null)} size="lg" title={visto.title} description={<StatusBadge status={visto.status} labels={ESTADOS} />}>
          <div className="grid gap-5">
            <DetailList items={[
              { label: "Tipo", value: visto.kind_name },
              { label: "Para", value: visto.audience === "PLANS" ? `Plan ${visto.audience_plans.map((p) => lista.planes.find((x) => x.code === p)?.name ?? p).join(", ")}`
                : visto.audience === "TENANTS" ? visto.audience_tenants.map((id) => lista.empresas.find((x) => x.id === id)?.short ?? "Empresa").join(", ") : "Todas las empresas" },
              { label: "Desde", value: fechaHora(visto.starts_at) },
              { label: "Hasta", value: visto.ends_at ? fechaHora(visto.ends_at) : "Sin fecha de fin" },
              { label: "Publicado", value: visto.published_at ? fechaHora(visto.published_at) : "Todavía no" },
              { label: "Redactado por", value: visto.created_by_name },
              ...(visto.maintenance_starts_at ? [{ label: "Mantenimiento", value: `${fechaHora(visto.maintenance_starts_at)}${visto.maintenance_ends_at ? ` a ${fechaHora(visto.maintenance_ends_at)}` : ""}` }] : []),
            ]} />
            <div className="grid gap-2">
              <p className="text-[13px] font-semibold text-ink">Así lo ve la empresa</p>
              <Alert tone={visto.kind === "MAINTENANCE" ? "warn" : visto.kind === "INCIDENT" ? "bad" : "info"} title={visto.title}>{visto.body}</Alert>
            </div>
          </div>
        </Modal>
      )}
      {editando && lista && <FormAnuncio lista={lista} actual={editando === "nuevo" ? undefined : editando} onClose={() => setEditando(null)} onListo={() => { setEditando(null); cargar(); }} />}
    </div>
  );
}

function FormAnuncio({ lista, actual, onClose, onListo }: { lista: Lista; actual?: Anuncio; onClose: () => void; onListo: () => void }) {
  const [f, setF] = useState({
    title: actual?.title ?? "", body: actual?.body ?? "", kind: actual?.kind ?? "INFO", audience: actual?.audience ?? "ALL",
    audience_plans: actual?.audience_plans ?? [] as string[], audience_tenants: actual?.audience_tenants ?? [] as string[],
    starts_at: local(actual?.starts_at ?? null), ends_at: local(actual?.ends_at ?? null),
    maintenance_starts_at: local(actual?.maintenance_starts_at ?? null), maintenance_ends_at: local(actual?.maintenance_ends_at ?? null),
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const alternar = (k: "audience_plans" | "audience_tenants", v: string, si: boolean) => setF({ ...f, [k]: si ? [...f[k], v] : f[k].filter((x) => x !== v) });

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await apiConsola(actual ? `/anuncios/${actual.id}` : "/anuncios", { method: actual ? "PUT" : "POST", body: {
        ...f, starts_at: aIso(f.starts_at), ends_at: aIso(f.ends_at), maintenance_starts_at: aIso(f.maintenance_starts_at), maintenance_ends_at: aIso(f.maintenance_ends_at),
      } });
      toast.ok(actual ? "Anuncio guardado" : "Borrador guardado: publícalo cuando esté listo");
      onListo();
    } catch (err) {
      setErrores(erroresDe(err));
      toast.error(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!guardando} title={actual ? "Editar anuncio" : "Nuevo anuncio"}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" type="submit" form="f-anuncio" icon={Save} loading={guardando}>Guardar</Button></>}>
      <form id="f-anuncio" onSubmit={guardar} className="grid gap-4">
        <Field label="Título" required error={errores.title}><Input value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Texto" required error={errores.body}><Textarea rows={3} maxLength={2000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo" required error={errores.kind}>
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}
              options={[{ value: "INFO", label: "Información" }, { value: "FEATURE", label: "Novedad" }, { value: "MAINTENANCE", label: "Mantenimiento" }]} />
          </Field>
          <Field label="Para" required error={errores.audience}>
            <Select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}
              options={[{ value: "ALL", label: "Todas las empresas" }, { value: "PLANS", label: "Por plan" }, { value: "TENANTS", label: "Empresas elegidas" }]} />
          </Field>
        </div>
        {f.audience === "PLANS" && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">{lista.planes.map((p) => <Checkbox key={p.code} checked={f.audience_plans.includes(p.code)} label={p.name} onChange={(v) => alternar("audience_plans", p.code, v)} />)}</div>
        )}
        {f.audience === "TENANTS" && (
          <div className="grid max-h-44 grid-cols-2 gap-x-3 gap-y-1.5 overflow-y-auto rounded-lg border border-line p-2.5">
            {lista.empresas.map((t) => <Checkbox key={t.id} checked={f.audience_tenants.includes(t.id)} label={t.short} onChange={(v) => alternar("audience_tenants", t.id, v)} />)}
          </div>
        )}
        {f.kind === "MAINTENANCE" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Inicio del mantenimiento" required error={errores.maintenance_starts_at} hint={`Al menos ${lista.aviso_horas} h después de que el anuncio se vea.`}>
              <Input type="datetime-local" value={f.maintenance_starts_at} onChange={(e) => setF({ ...f, maintenance_starts_at: e.target.value })} />
            </Field>
            <Field label="Fin del mantenimiento" required error={errores.maintenance_ends_at}>
              <Input type="datetime-local" value={f.maintenance_ends_at} onChange={(e) => setF({ ...f, maintenance_ends_at: e.target.value })} />
            </Field>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Se ve desde" hint="Vacío: desde que se publica." error={errores.starts_at}>
            <Input type="datetime-local" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} />
          </Field>
          <Field label="Se ve hasta" hint={f.kind === "MAINTENANCE" ? "Vacío: hasta que termina el mantenimiento." : "Vacío: hasta cancelarlo."} error={errores.ends_at}>
            <Input type="datetime-local" value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
