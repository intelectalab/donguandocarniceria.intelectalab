"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Eye, FileLock2, Mic } from "lucide-react";
import { Alert, Badge, Cifra, DataTable, DetailList, FiltroFecha, FiltroSelect, Modal, PageHeader, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { fechaHoraSeg } from "@/modulos/aud/comunes";

type Opcion = { value: string; label: string };
type Acceso = {
  id: string; at: string; user_id: string | null; user_name: string; rol: string | null; event: string; event_name: string; ip: string; device: string;
  detalle: string | null; entity: string | null; entity_id: string | null;
};
type Lista = Pagina<Acceso> & {
  por_tipo: { event: string; event_name: string; n: number }[]; por_usuario: { user_id: string | null; usuario: string; n: number }[];
  eventos: Opcion[]; usuarios: Opcion[];
};

const ICONO: Record<string, typeof Eye> = { SENSITIVE_VIEW: Eye, EXPORT_DOWNLOADED: Download, FILE_DOWNLOADED: FileLock2, RECORDING_PLAYED: Mic };
const TITULO: Record<string, string> = { FILE_DOWNLOADED: "Descargas de archivos sensibles", RECORDING_PLAYED: "Grabaciones reproducidas", EXPORT_DOWNLOADED: "Exportaciones con datos personales", SENSITIVE_VIEW: "Vistas de datos sensibles" };
const REGISTRO: Record<string, string> = { data_exports: "Exportación", file_attachments: "Archivo adjunto", users: "Usuario" };

/**
 * AUD-04 Accesos a datos sensibles (Ley 29733): descargas de archivos confidenciales, grabaciones reproducidas,
 * exportaciones descargadas y vistas sin enmascarar, por persona y fecha.
 */
export default function AccesosSensibles() {
  const { can } = useSesion();
  const permitido = Boolean(can("aud.access_log.view"));
  const [f, setF] = useState({ evento: "", usuario: "", desde: "", hasta: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState<Acceso | null>(null);
  const pag = usePagina(JSON.stringify(f));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);

  const cargar = useCallback(() => {
    if (!permitido) return;
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/aud/sensibles?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs, permitido]);
  useEffect(() => cargar(), [cargar]);

  if (!permitido) return <Alert tone="warn">Tu rol no consulta los accesos a datos sensibles.</Alert>;

  const columnas: Column<Acceso>[] = [
    { key: "at", sortable: true, header: "Fecha y hora (Lima)", render: (x) => <span className="whitespace-nowrap tabular-nums">{fechaHoraSeg(x.at)}</span> },
    { key: "user_name", sortable: true, header: "Usuario", cardTitle: true, render: (x) => (
      <div className="min-w-0"><p className="font-semibold text-ink">{x.user_name}</p>{x.rol && <p className="text-[12px] text-muted">{x.rol}</p>}</div>
    ) },
    { key: "event", sortable: true, header: "Tipo", render: (x) => <Badge tone="warn" dot>{x.event_name}</Badge> },
    { key: "detalle", header: "Qué", render: (x) => <span className="text-[12.5px]">{x.detalle ?? "—"}</span> },
    { key: "ip", sortable: true, header: "IP", hideOnMobile: true, render: (x) => <span className="font-mono text-[12px]">{x.ip}</span> },
  ];
  const max = Math.max(1, ...(lista?.por_usuario ?? []).map((u) => u.n));

  return (
    <div className="grid gap-5">
      <PageHeader description="Quién vio o se llevó datos sensibles: descargas de archivos confidenciales, exportaciones descargadas, grabaciones reproducidas y vistas de datos personales sin enmascarar, con la persona, la fecha y la IP (Ley 29733 de Protección de Datos Personales)." />
      {lista && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {lista.por_tipo.map((t, i) => (
            <Cifra key={t.event} titulo={TITULO[t.event] ?? t.event_name} valor={numero(t.n)} icono={ICONO[t.event] ?? Eye} destacada={i === 0}
              detalle={f.desde || f.hasta || f.usuario || f.buscar ? "En el filtro" : "Desde la puesta en marcha"} />
          ))}
        </div>
      )}
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
          onRowClick={setAbierto} empty="No hay accesos a datos sensibles con estos filtros."
          search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar persona, archivo o IP…" }}
          toolbar={<>
            <FiltroSelect etiqueta="Tipo" ancho={220} value={f.evento} onChange={(v) => setF({ ...f, evento: v })} options={lista?.eventos ?? []} />
            <FiltroSelect etiqueta="Usuario" ancho={200} value={f.usuario} onChange={(v) => setF({ ...f, usuario: v })} options={lista?.usuarios ?? []} />
            <FiltroFecha etiqueta="Desde" visible value={f.desde} max={f.hasta || undefined} onChange={(v) => setF({ ...f, desde: v })} />
            <FiltroFecha etiqueta="Hasta" visible value={f.hasta} min={f.desde || undefined} onChange={(v) => setF({ ...f, hasta: v })} />
          </>} />
        <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
          <div>
            <h2 className="text-[14px] font-semibold text-ink">Por usuario</h2>
            <p className="text-[12px] text-muted">Quién accede más a datos sensibles. Más de 3 se marca para revisar.</p>
          </div>
          {lista && lista.por_usuario.length === 0 && <p className="text-[13px] text-muted">Nadie en este filtro.</p>}
          <ul className="grid gap-2">
            {(lista?.por_usuario ?? []).map((u) => (
              <li key={u.user_id ?? u.usuario}>
                <button type="button" onClick={() => setF({ ...f, usuario: u.user_id ?? "" })} title={`Ver solo los de ${u.usuario}`}
                  className="grid w-full cursor-pointer grid-cols-[minmax(0,140px)_1fr_32px] items-center gap-2 text-left text-[12.5px] hover:opacity-80">
                  <span className="truncate text-ink">{u.usuario}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-surface-2"><span className={`block h-full rounded-full ${u.n > 3 ? "bg-warn" : "bg-primary"}`} style={{ width: `${(u.n / max) * 100}%` }} /></span>
                  <span className="text-right text-ink tabular-nums">{u.n}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {abierto && (
        <Modal open onClose={() => setAbierto(null)} title={abierto.event_name}>
          <DetailList items={[
            { label: "Fecha y hora", value: `${fechaHoraSeg(abierto.at)} (hora de Lima)` },
            { label: "Usuario", value: abierto.rol ? `${abierto.user_name} · ${abierto.rol}` : abierto.user_name },
            { label: "IP", value: <span className="font-mono">{abierto.ip}</span> },
            { label: "Dispositivo", value: abierto.device },
            { label: "Registro", value: abierto.entity ? (REGISTRO[abierto.entity] ?? abierto.entity) : "—" },
            { label: "Detalle", value: abierto.detalle ?? "—" },
          ]} />
        </Modal>
      )}
    </div>
  );
}
