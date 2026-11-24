"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Copy, Inbox, RotateCcw, ShieldAlert, Timer, TriangleAlert } from "lucide-react";
import { Alert, Button, Cifra, DataTable, DetailList, Input, Modal, PageHeader, Select, StatusBadge, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { nombreModulo } from "@/modulos/int/tipos";

const FILTRO = "!min-h-9 h-9 py-1.5 text-[13px]";
type Evento = {
  id: string; received_at: string; connector_id: string | null; connector_name: string | null; endpoint_name: string | null; event_key: string | null;
  owner_module: string | null; module_name: string; duplicates: number; attempts: number; processed_at: string | null; segundos: number | null;
  status: string; status_name: string; http_status: number | null; last_error: string | null; result: string | null;
};
type Ficha = Evento & {
  headers: Record<string, string>; body: string | null; ack_ms: number | null; failed_at: string | null; last_duplicate_at: string | null;
  max_intentos: number; ack_segundos: number; procesador: boolean;
};
type Lista = Pagina<Evento> & {
  cifras: { mes: number; duplicados: number | null; repetidos: number; p95: number | null; fallidos: number; rechazados: number; en_espera: number };
  max_intentos: number; conectores: { id: string; name: string }[]; estados: Record<string, string>;
};

const ESTADOS: Record<string, [string, Tone]> = {
  RECEIVED: ["Recibido", "info"], PROCESSED: ["Procesado", "ok"], FAILED: ["Fallido", "bad"], REJECTED: ["Rechazado", "warn"], IGNORED: ["Ignorado", "neutral"],
};
const META_P95 = 60;
const segundos = (s: number) => (s < 60 ? `${numero(s, s < 10 ? 1 : 0)} s` : `${numero(s / 60, 1)} min`);
/** El cuerpo con sangría si es JSON; si no, tal cual. */
const legible = (b: string | null) => { try { return JSON.stringify(JSON.parse(b ?? ""), null, 2); } catch { return b ?? ""; } };

/**
 * INT-05 Bitácora de webhooks: lo que llegó de cada proveedor, tal cual (el crudo no se modifica). Los repetidos suman al
 * contador y no se procesan dos veces; los fallidos se reprocesan a mano.
 */
function Bitacora() {
  const router = useRouter();
  const params = useSearchParams();
  const abierto = params.get("evento");
  const { can, puede } = useSesion();
  const reprocesa = Boolean(can("int.webhook.reprocess")) && puede("INT", "E");
  const [f, setF] = useState({ status: params.get("status") ?? "", connector: "", endpoint: params.get("endpoint") ?? "", dia: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const pag = usePagina(JSON.stringify(f));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 350);
    return () => clearTimeout(t);
  }, [buscar]);

  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/int/webhooks/eventos?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs]);
  useEffect(() => cargar(), [cargar]);

  const ver = (id: string | null) => router.replace(id ? `/m/int/int-05?evento=${id}` : "/m/int/int-05", { scroll: false });

  const columnas: Column<Evento>[] = [
    { key: "received_at", sortable: true, header: "Recibido", render: (e) => <span className="whitespace-nowrap">{fechaHora(e.received_at)}</span> },
    { key: "connector", sortable: true, header: "Conector", cardTitle: true, render: (e) => <span className="font-semibold text-ink">{e.connector_name ?? "—"}</span> },
    { key: "event_key", sortable: true, header: "Clave", render: (e) => <span className="font-mono text-[12px]" title={e.event_key ?? ""}>{(e.event_key ?? "—").slice(0, 22)}</span> },
    { key: "module", sortable: true, header: "Módulo", hideOnMobile: true, render: (e) => nombreModulo(e.owner_module) },
    { key: "duplicates", sortable: true, header: "Repetidos", align: "right", hideOnMobile: true, render: (e) => e.duplicates },
    { key: "attempts", sortable: true, header: "Intentos", align: "right", hideOnMobile: true, render: (e) => e.attempts },
    { key: "segundos", sortable: true, header: "Proceso", align: "right", hideOnMobile: true, render: (e) => (e.segundos === null ? <span className="text-muted">—</span> : segundos(e.segundos)) },
    { key: "status", sortable: true, header: "Estado", render: (e) => <StatusBadge status={e.status} labels={ESTADOS} /> },
    { key: "last_error", sortable: true, header: "Resultado o error", render: (e) => (
      <span className={`text-[12.5px] ${e.last_error ? "text-bad" : ""}`}>{e.last_error ?? e.result ?? ""}</span>
    ) },
  ];

  const c = lista?.cifras;
  const filtroEndpoint = f.endpoint && lista?.data[0]?.endpoint_name;
  return (
    <div className="grid gap-5">
      <PageHeader description="Cada aviso de un proveedor queda aquí tal como llegó: cabeceras y cuerpo, sin modificar. Los repetidos se cuentan y no se procesan otra vez. Los que fallan se reintentan solos y, si no se resuelven, se reprocesan a mano." />
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Cifra titulo="Recibidos en el mes" valor={numero(c.mes)} icono={Inbox} destacada />
          <Cifra titulo="Repetidos" valor={c.duplicados === null ? "—" : `${numero(c.duplicados, 2)} %`} icono={Copy} detalle={`${numero(c.repetidos)} en 30 días, sin procesar dos veces`} />
          <Cifra titulo="Tiempo de proceso (p95)" valor={c.p95 === null ? "—" : segundos(c.p95)} icono={Timer} tono={c.p95 !== null && c.p95 > META_P95 ? "warn" : "ok"} detalle="Meta: 60 s o menos" />
          <Cifra titulo="Fallidos por reprocesar" valor={numero(c.fallidos)} icono={TriangleAlert} tono={c.fallidos ? "bad" : undefined} detalle={c.fallidos ? "Revisa el error y reprocesa" : "Ninguno"} />
          <Cifra titulo="Rechazados por firma" valor={numero(c.rechazados)} icono={ShieldAlert} tono={c.rechazados ? "warn" : undefined} detalle="No se procesaron" />
        </div>
      )}
      {filtroEndpoint && (
        <Alert tone="info">Solo los de {filtroEndpoint}. <button type="button" className="cursor-pointer font-medium text-primary underline" onClick={() => setF({ ...f, endpoint: "" })}>Ver todos</button></Alert>
      )}
      <DataTable search={{ value: buscar, onChange: (v) => setBuscar(v), placeholder: "Buscar en la clave o el cuerpo…" }}
        toolbar={<>
          <div className="w-full sm:w-[150px]"><Select className={FILTRO} aria-label="Estado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} placeholder="Estado: todos" options={Object.entries(lista?.estados ?? {}).map(([value, label]) => ({ value, label }))} /></div>
          <div className="w-full sm:w-[210px]"><Select className={FILTRO} aria-label="Conector" value={f.connector} onChange={(e) => setF({ ...f, connector: e.target.value })} placeholder="Conector: todos" options={(lista?.conectores ?? []).map((x) => ({ value: x.id, label: x.name }))} /></div>
          <div className="w-full sm:w-[160px]"><Input className={FILTRO} type="date" aria-label="Fecha de recepción" title="Fecha de recepción" value={f.dia} onChange={(e) => setF({ ...f, dia: e.target.value })} /></div>
        </>} {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={(e) => ver(e.id)} empty="No hay webhooks con estos filtros." />
      {abierto && <FichaWebhook id={abierto} reprocesa={reprocesa} onClose={() => ver(null)} onCambio={cargar} />}
    </div>
  );
}

function FichaWebhook({ id, reprocesa, onClose, onCambio }: { id: string; reprocesa: boolean; onClose: () => void; onCambio: () => void }) {
  const [w, setW] = useState<Ficha | null>(null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vivo = true;
    api<Ficha>(`/v1/int/webhooks/eventos/${id}`).then((r) => { if (vivo) { setW(r); setError(""); } }).catch((e) => vivo && setError(mensajeDe(e)));
    return () => { vivo = false; };
  }, [id]);

  async function reprocesar() {
    setEnviando(true);
    try {
      const r = await api<Ficha>(`/v1/int/webhooks/eventos/${id}/reprocesar`, { method: "POST" });
      setW((x) => (x ? { ...x, ...r } : r));
      if (r.status === "PROCESSED") toast.ok("Webhook procesado");
      else toast.error(`Volvió a fallar: ${r.last_error ?? ""}`);
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={w ? `Webhook ${(w.event_key ?? "").slice(0, 24)}` : "Webhook"} size="xl"
      footer={w?.status === "FAILED" && reprocesa ? <Button variant="primary" icon={RotateCcw} loading={enviando} onClick={reprocesar}>Reprocesar</Button> : undefined}>
      {error && <Alert tone="bad">{error}</Alert>}
      {!w && !error && <p className="text-[13.5px] text-muted">Cargando…</p>}
      {w && (
        <div className="grid gap-5">
          {w.status === "FAILED" && !reprocesa && <Alert tone="info">Solo quien tiene el permiso de reprocesar webhooks puede volver a procesarlo.</Alert>}
          {w.status === "FAILED" && reprocesa && !w.procesador && <Alert tone="info">El procesador de {nombreModulo(w.owner_module)} todavía no está instalado: se podrá reprocesar cuando lo esté.</Alert>}
          <DetailList items={[
            { label: "Conector", value: w.connector_name ?? "—" }, { label: "Endpoint", value: w.endpoint_name ?? "—" },
            { label: "Recibido", value: fechaHora(w.received_at) },
            { label: "Respuesta", value: w.http_status ? `HTTP ${w.http_status}${w.ack_ms ? ` en ${w.ack_ms} ms` : ""} (máx. ${w.ack_segundos} s)` : "—" },
            { label: "Procesado", value: w.processed_at ? `${fechaHora(w.processed_at)}${w.segundos !== null ? ` (${segundos(w.segundos)})` : ""}` : "—" },
            { label: "Intentos", value: `${w.attempts} de ${w.max_intentos}` },
            { label: "Repetidos", value: w.duplicates ? `${w.duplicates}${w.last_duplicate_at ? ` · el último ${fechaHora(w.last_duplicate_at)}` : ""}` : "0" },
            { label: "Estado", value: <StatusBadge status={w.status} labels={ESTADOS} /> },
            { label: "Módulo", value: nombreModulo(w.owner_module) },
            { label: "Clave", value: <span className="font-mono text-[12px] break-all">{w.event_key ?? "—"}</span> },
            ...(w.result ? [{ label: "Resultado", value: w.result }] : []),
            ...(w.last_error ? [{ label: "Error", value: <span className="text-bad">{w.last_error}</span> }] : []),
          ]} />
          <section className="grid gap-2">
            <h3 className="text-[14px] font-semibold text-ink">Cabeceras</h3>
            <pre className="max-h-56 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-ink">{JSON.stringify(w.headers, null, 2)}</pre>
          </section>
          <section className="grid gap-2">
            <h3 className="text-[14px] font-semibold text-ink">Cuerpo crudo</h3>
            <pre className="max-h-96 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-ink">{legible(w.body)}</pre>
          </section>
        </div>
      )}
    </Modal>
  );
}

export default function Page() {
  return <Suspense><Bitacora /></Suspense>;
}
