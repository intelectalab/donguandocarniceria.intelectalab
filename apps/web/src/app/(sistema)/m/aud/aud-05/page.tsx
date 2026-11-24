"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban, Check, Download, FileDown, Hourglass, Plus, ShieldAlert, XCircle } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, DataTable, DetailList, Field, FiltroSelect, Input, Modal, PageHeader, Select, StatusBadge, Tabs, Textarea, confirmAction, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { Dialogo } from "@/modulos/mae/Dialogo";

type Opcion = { value: string; label: string };
type Reporte = Opcion & { personal: boolean; filtros: ("desde" | "hasta" | "marca" | "optin")[] };
type Exportacion = {
  id: string; number: string; requested_at: string; requested_by: string; report: string; report_name: string; rows_count: number; contains_personal_data: boolean;
  reason: string; status: string; status_name: string; approved_by: string | null; approved_at: string | null; link_expires_at: string | null; mia: boolean; descargas: number;
  puede_aprobar: boolean; puede_descargar: boolean; tiene_archivo: boolean;
};
type Ficha = Exportacion & {
  filtros_texto: string; downloads: { at: string; by: string }[]; watermark: string; file_name: string; format: string; requested_role: string;
  reject_reason: string | null; rejected_by: string | null; rejected_at: string | null;
};
type Lista = Pagina<Exportacion> & {
  cifras: { por_aprobar: number; personales_mes: number; mias: number; rechazadas: number }; alcance: "mine" | "pending" | "all";
  puede: { solicitar: boolean; aprobar: boolean; todas: boolean; datos_personales: boolean }; umbral: number; horas: number;
  estados: Record<string, string>; reportes: Reporte[]; marcas: Opcion[];
};

const ESTADOS: Record<string, [string, Tone]> = { PENDING_APPROVAL: ["Por aprobar", "warn"], READY: ["Lista", "ok"], REJECTED: ["Rechazada", "bad"], EXPIRED: ["Enlace vencido", "neutral"] };

/** Pide el enlace firmado y descarga el archivo. */
async function descargar(x: Pick<Exportacion, "id">) {
  try {
    const r = await api<{ url: string }>(`/v1/aud/exportaciones/${x.id}/enlace`, { method: "POST" });
    window.location.href = r.url;
  } catch (e) {
    toast.error(mensajeDe(e));
  }
}

/**
 * AUD-05 Exportaciones: se solicitan con un motivo; las que traen datos personales necesitan la aprobación de otra
 * persona. El archivo lleva marca de agua y se descarga con un enlace que vence.
 */
function Exportaciones() {
  const router = useRouter();
  const params = useSearchParams();
  const [scope, setScope] = useState<"mine" | "pending" | "all">((params.get("scope") as "pending") ?? "mine");
  const [f, setF] = useState({ status: "", report: "" });
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [nueva, setNueva] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const pag = usePagina(JSON.stringify({ ...f, scope }));

  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries({ ...f, scope }).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/aud/exportaciones?${q}&${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, scope, pag.qs]);
  useEffect(() => cargar(), [cargar]);

  async function aprobar(x: Exportacion) {
    const ok = await confirmAction({ title: `¿Aprobar ${x.number}?`, confirmLabel: "Aprobar",
      message: `${x.requested_by} podrá descargar «${x.report_name}» (${numero(x.rows_count)} filas${x.contains_personal_data ? " con datos personales" : ""}) durante ${lista?.horas ?? 24} horas. Motivo: ${x.reason}` });
    if (!ok) return;
    try {
      await api(`/v1/aud/exportaciones/${x.id}/aprobar`, { method: "POST" });
      toast.ok(`${x.number} aprobada`);
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const columnas: Column<Exportacion>[] = [
    { key: "number", sortable: true, header: "N.º", cardTitle: true, render: (x) => <span className="font-mono font-semibold text-ink">{x.number}</span> },
    { key: "requested_at", sortable: true, header: "Solicitada", render: (x) => <span className="whitespace-nowrap">{fechaHora(x.requested_at)}</span> },
    { key: "requested_by", sortable: true, header: "Solicitante", render: (x) => x.requested_by },
    { key: "report_name", sortable: true, header: "Reporte", render: (x) => <span className="text-[12.5px]">{x.report_name}</span> },
    { key: "rows_count", sortable: true, header: "Filas", align: "right", render: (x) => numero(x.rows_count) },
    { key: "personales", header: "Datos personales", render: (x) => (x.contains_personal_data ? <Badge tone="warn">Sí</Badge> : <span className="text-muted">No</span>) },
    { key: "reason", header: "Motivo", hideOnMobile: true, render: (x) => <span className="text-[12.5px]">{x.reason}</span> },
    { key: "status", sortable: true, header: "Estado", render: (x) => <StatusBadge status={x.status} labels={ESTADOS} /> },
    { key: "acciones", header: "", align: "right", render: (x) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {x.puede_aprobar && <Button size="sm" variant="primary" icon={Check} onClick={() => aprobar(x)}>Aprobar</Button>}
        {x.puede_descargar && <Button size="sm" icon={Download} onClick={() => descargar(x)}>Descargar</Button>}
      </div>
    ) },
  ];

  const c = lista?.cifras;
  const pestanas = [{ key: "mine" as const, label: "Mis exportaciones" },
    ...(lista?.puede.aprobar ? [{ key: "pending" as const, label: "Por aprobar", count: c?.por_aprobar }] : []),
    ...(lista?.puede.todas ? [{ key: "all" as const, label: "Todas" }] : [])];
  return (
    <div className="grid gap-5">
      <PageHeader description={`Pide una exportación con su motivo. Las que traen datos personales necesitan la aprobación de otra persona si pasan de ${numero(lista?.umbral ?? 500)} filas o si no tienes el permiso de exportar datos personales. El archivo lleva una marca de agua con tu nombre y el enlace dura ${lista?.horas ?? 24} horas.`}
        actions={lista?.puede.solicitar ? <Button variant="primary" icon={Plus} onClick={() => setNueva(true)}>Solicitar exportación</Button> : undefined} />
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Por aprobar" valor={numero(c.por_aprobar)} icono={Hourglass} destacada tono={c.por_aprobar ? "warn" : undefined} />
          <Cifra titulo="Con datos personales" valor={numero(c.personales_mes)} icono={ShieldAlert} detalle="Listas este mes" />
          <Cifra titulo="Mis exportaciones" valor={numero(c.mias)} icono={FileDown} />
          <Cifra titulo="Rechazadas" valor={numero(c.rechazadas)} icono={XCircle} />
        </div>
      )}
      {pestanas.length > 1 && (
        <Tabs value={scope} onChange={(s) => { setScope(s); router.replace(`/m/aud/aud-05${s === "mine" ? "" : `?scope=${s}`}`, { scroll: false }); }} tabs={pestanas} />
      )}
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={(x) => setAbierta(x.id)} empty={scope === "mine" ? "No has solicitado exportaciones." : scope === "pending" ? "Nada pendiente de aprobar." : "No hay exportaciones."}
        toolbar={<>
          <FiltroSelect etiqueta="Estado" ancho={170} value={f.status} onChange={(v) => setF({ ...f, status: v })} options={Object.entries(lista?.estados ?? {}).map(([value, label]) => ({ value, label }))} />
          <FiltroSelect etiqueta="Reporte" ancho={240} value={f.report} onChange={(v) => setF({ ...f, report: v })} options={lista?.reportes ?? []} />
        </>} />
      {nueva && lista && <Solicitar lista={lista} onClose={() => setNueva(false)} onListo={() => { setNueva(false); setScope("mine"); cargar(); }} />}
      {abierta && <FichaExportacion id={abierta} horas={lista?.horas ?? 24} onClose={() => setAbierta(null)} onCambio={() => { setAbierta(null); cargar(); }} />}
    </div>
  );
}

function Solicitar({ lista, onClose, onListo }: { lista: Lista; onClose: () => void; onListo: () => void }) {
  const [d, setD] = useState({ report: "", desde: "", hasta: "", marca: "", optin: false, reason: "" });
  const rep = lista.reportes.find((r) => r.value === d.report);
  const usa = (k: Reporte["filtros"][number]) => Boolean(rep?.filtros.includes(k));
  return (
    <Dialogo titulo="Solicitar exportación" boton="Solicitar" onClose={onClose}
      aviso={rep?.personal ? `Trae datos personales: ${lista.puede.datos_personales ? `si pasa de ${numero(lista.umbral)} filas necesitará la aprobación de otra persona` : "necesitará la aprobación de otra persona"}.` : undefined}
      enviar={async () => {
        const body: Record<string, unknown> = { report: d.report, reason: d.reason };
        if (usa("desde")) Object.assign(body, { desde: d.desde || undefined, hasta: d.hasta || undefined });
        if (usa("marca") && d.marca) body.marca = d.marca;
        if (usa("optin")) body.optin = d.optin;
        const x = await api<Exportacion>("/v1/aud/exportaciones", { method: "POST", body });
        toast.ok(x.status === "READY" ? `${x.number} lista para descargar` : `${x.number} enviada a aprobación`);
        onListo();
      }}>
      {(errores) => (
        <>
          <Field label="Reporte" required error={errores.report} className="sm:col-span-2">
            <Select value={d.report} onChange={(e) => setD({ ...d, report: e.target.value })} placeholder="Elige el reporte"
              options={lista.reportes.map((r) => ({ value: r.value, label: r.personal ? `${r.label} · datos personales` : r.label }))} />
          </Field>
          {usa("desde") && (
            <>
              <Field label="Desde" error={errores.desde} hint="Vacío: desde el 1 de este mes."><Input type="date" value={d.desde} onChange={(e) => setD({ ...d, desde: e.target.value })} /></Field>
              <Field label="Hasta" error={errores.hasta} hint="Vacío: hasta hoy."><Input type="date" value={d.hasta} onChange={(e) => setD({ ...d, hasta: e.target.value })} /></Field>
            </>
          )}
          {usa("marca") && (
            <Field label="Marca" className="sm:col-span-2"><Select value={d.marca} onChange={(e) => setD({ ...d, marca: e.target.value })} placeholder="Todas las marcas" options={lista.marcas} /></Field>
          )}
          {usa("optin") && <div className="sm:col-span-2"><Checkbox checked={d.optin} onChange={(v) => setD({ ...d, optin: v })} label="Solo clientes que aceptan publicidad" /></div>}
          <Field label="Motivo" required error={errores.reason} hint="Para qué la necesitas (al menos 10 caracteres). Queda en la exportación y en el archivo." className="sm:col-span-2">
            <Textarea rows={3} maxLength={300} value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} />
          </Field>
        </>
      )}
    </Dialogo>
  );
}

function FichaExportacion({ id, horas, onClose, onCambio }: { id: string; horas: number; onClose: () => void; onCambio: () => void }) {
  const [x, setX] = useState<Ficha | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let vivo = true;
    api<Ficha>(`/v1/aud/exportaciones/${id}`).then((r) => vivo && setX(r)).catch((e) => vivo && setError(mensajeDe(e)));
    return () => { vivo = false; };
  }, [id]);

  async function resolver(aprobar: boolean) {
    if (!x) return;
    const r = await confirmAction(aprobar
      ? { title: `¿Aprobar ${x.number}?`, confirmLabel: "Aprobar", message: `${x.requested_by} podrá descargarla durante ${horas} horas.` }
      : { title: `¿Rechazar ${x.number}?`, confirmLabel: "Rechazar", danger: true, message: "Se avisa a quien la pidió con tu motivo.", reason: { min: 10, label: "Motivo del rechazo" } });
    if (!r) return;
    try {
      await api(`/v1/aud/exportaciones/${x.id}/${aprobar ? "aprobar" : "rechazar"}`, { method: "POST", body: aprobar ? undefined : { reason: r.reason } });
      toast.ok(aprobar ? `${x.number} aprobada` : `${x.number} rechazada`);
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={x ? `Exportación ${x.number}` : "Exportación"}
      footer={x ? (
        <>
          {x.puede_aprobar && <Button variant="ghost" icon={Ban} onClick={() => resolver(false)}>Rechazar</Button>}
          {x.puede_aprobar && <Button variant="primary" icon={Check} onClick={() => resolver(true)}>Aprobar</Button>}
          {x.puede_descargar && <Button variant="primary" icon={Download} onClick={() => descargar(x)}>Descargar</Button>}
        </>
      ) : undefined}>
      {error && <Alert tone="bad">{error}</Alert>}
      {x && (
        <div className="grid gap-4">
          {x.status === "PENDING_APPROVAL" && x.mia && <Alert tone="info">Quien solicita no aprueba su propia exportación: espera la aprobación de gerencia o de administración del sistema.</Alert>}
          {x.status === "READY" && !x.tiene_archivo && <Alert tone="info">Es de los datos de demostración y no tiene archivo guardado: solicítala de nuevo para descargarla.</Alert>}
          <DetailList items={[
            { label: "Reporte", value: x.report_name }, { label: "Filtros", value: x.filtros_texto },
            { label: "Filas", value: numero(x.rows_count) }, { label: "Datos personales", value: x.contains_personal_data ? <Badge tone="warn">Sí</Badge> : "No" },
            { label: "Motivo", value: x.reason }, { label: "Estado", value: <StatusBadge status={x.status} labels={ESTADOS} /> },
            { label: "Solicitante", value: `${x.requested_by} · ${fechaHora(x.requested_at)}` },
            { label: "Aprobada por", value: x.approved_by ? `${x.approved_by} · ${fechaHora(x.approved_at!)}` : "—" },
            ...(x.reject_reason ? [{ label: "Rechazo", value: `${x.rejected_by ?? ""}: ${x.reject_reason}` }] : []),
            { label: "Enlace hasta", value: x.link_expires_at ? fechaHora(x.link_expires_at) : "—" },
            { label: "Archivo", value: <span className="font-mono text-[12px]">{x.file_name}</span> },
            { label: "Marca de agua", value: x.watermark },
            { label: "Descargas", value: x.downloads.length ? x.downloads.map((d) => `${d.by} · ${fechaHora(d.at)}`).join("; ") : "Ninguna" },
          ]} />
        </div>
      )}
    </Modal>
  );
}

export default function Page() {
  return <Suspense><Exportaciones /></Suspense>;
}
