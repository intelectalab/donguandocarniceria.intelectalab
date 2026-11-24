"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, ListChecks, Play, TriangleAlert } from "lucide-react";
import { Badge, Button, Cifra, DataTable, FiltroFecha, FiltroSelect, PageHeader, StatusBadge, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { nombreModulo } from "@/modulos/int/tipos";

type Corrida = {
  id: string; job: string; job_name: string; connector_id: string; connector_name: string | null; environment: string | null; started_at: string; finished_at: string;
  status: string; status_name: string; items_ok: number; items_failed: number; detail: string; triggered_by: string;
};
type Ejecutable = { job: string; job_name: string; connector_id: string; connector_name: string; owner_module: string | null; prueba: boolean; motivo: "DESACTIVADO" | "MODULO_APAGADO" | "NO_INSTALADO" | null };
type Lista = Pagina<Corrida> & {
  cifras: { semana: number; fallidas: number; parciales: number; ultima: string | null };
  procesos: { code: string; name: string }[]; estados: Record<string, string>; ejecutables: Ejecutable[];
};

const ESTADOS: Record<string, [string, Tone]> = { COMPLETED: ["Completada", "ok"], PARTIAL: ["Parcial", "warn"], FAILED: ["Fallida", "bad"] };

/** Segundos entre inicio y fin, en palabras cortas. */
function duracion(a: string, b: string) {
  const s = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/**
 * INT-08 Corridas programadas: las importaciones y sincronizaciones con su inicio, fin, ítems correctos y fallidos.
 * «Ejecutar ahora» corre el proceso en el momento; los que todavía no están instalados lo dicen.
 */
export default function Corridas() {
  const { can, puede } = useSesion();
  const ejecuta = Boolean(can("int.connector.manage")) && puede("INT", "E");
  const [f, setF] = useState({ job: "", status: "", dia: "" });
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [corriendo, setCorriendo] = useState("");
  const pag = usePagina(JSON.stringify(f));

  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/int/corridas?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs]);
  useEffect(() => cargar(), [cargar]);

  async function ejecutar(e: Ejecutable) {
    const clave = `${e.job}|${e.connector_id}`;
    setCorriendo(clave);
    try {
      const r = await api<Corrida>("/v1/int/corridas", { method: "POST", body: { job: e.job, connector_id: e.connector_id } });
      const texto = `${r.job_name}: ${r.detail}`;
      if (r.status === "FAILED") toast.error(texto);
      else toast.ok(texto);
      cargar();
    } catch (x) {
      toast.error(mensajeDe(x));
    } finally {
      setCorriendo("");
    }
  }

  const columnas: Column<Corrida>[] = [
    { key: "started_at", sortable: true, header: "Inicio", render: (r) => <span className="whitespace-nowrap">{fechaHora(r.started_at)}</span> },
    { key: "finished_at", sortable: true, header: "Fin", hideOnMobile: true, render: (r) => <span className="whitespace-nowrap" title={`Duró ${duracion(r.started_at, r.finished_at)}`}>{fechaHora(r.finished_at)}</span> },
    { key: "job", sortable: true, header: "Proceso", cardTitle: true, render: (r) => <span className="font-semibold text-ink">{r.job_name}</span> },
    { key: "connector", sortable: true, header: "Conector", render: (r) => (
      <span className="inline-flex flex-wrap items-center gap-1.5">{r.connector_name ?? "—"}{r.environment === "SANDBOX" && <Badge tone="info">Prueba</Badge>}</span>
    ) },
    { key: "items_ok", sortable: true, header: "Correctos", align: "right", render: (r) => numero(r.items_ok) },
    { key: "items_failed", sortable: true, header: "Fallidos", align: "right", render: (r) => (r.items_failed ? <span className="font-semibold text-bad">{numero(r.items_failed)}</span> : "0") },
    { key: "status", sortable: true, header: "Resultado", render: (r) => <StatusBadge status={r.status} labels={ESTADOS} /> },
    { key: "detail", header: "Detalle", render: (r) => <span className={`text-[12.5px] ${r.status === "FAILED" ? "text-bad" : ""}`}>{r.detail}</span> },
    { key: "triggered_by", sortable: true, header: "Origen", hideOnMobile: true, render: (r) => <span className="text-[12.5px]">{r.triggered_by}</span> },
  ];

  const c = lista?.cifras;
  const procesos = [...new Map((lista?.ejecutables ?? []).map((e) => [e.job, e.job_name])).entries()];
  return (
    <div className="grid gap-5">
      <PageHeader description="Las importaciones y sincronizaciones con los proveedores: el tipo de cambio de SUNAT, el gasto de anuncios, el catálogo y el stock de la tienda web, los lotes de la granja y el estado de los comprobantes. Cada corrida queda con su inicio, fin, ítems correctos y fallidos." />
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Corridas en 7 días" valor={numero(c.semana)} icono={ListChecks} destacada />
          <Cifra titulo="Fallidas" valor={numero(c.fallidas)} icono={AlertTriangle} tono={c.fallidas ? "bad" : "ok"} detalle="En los mismos 7 días" />
          <Cifra titulo="Parciales" valor={numero(c.parciales)} icono={TriangleAlert} tono={c.parciales ? "warn" : undefined} detalle="Con ítems que no pasaron" />
          <Cifra titulo="Última corrida" valor={c.ultima ? fecha(c.ultima) : "—"} detalle={c.ultima ? `a las ${fechaHora(c.ultima).split(", ")[1] ?? ""}` : undefined} icono={CalendarClock} />
        </div>
      )}

      {ejecuta && lista && (
        <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
          <div>
            <h2 className="text-[14px] font-semibold text-ink">Ejecutar ahora</h2>
            <p className="text-[12.5px] text-muted">Corre el proceso en el momento. Los que todavía no están instalados se pueden probar con un conector de prueba.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {procesos.map(([job, nombre]) => {
              const todos = lista.ejecutables.filter((e) => e.job === job);
              const listos = todos.filter((e) => !e.motivo);
              const noInstalados = todos.filter((e) => e.motivo === "NO_INSTALADO");
              const otros = todos.filter((e) => e.motivo && e.motivo !== "NO_INSTALADO");
              return (
                <div key={job} className="grid content-start gap-2 rounded-lg border border-line p-3">
                  <p className="text-[13px] font-semibold text-ink">{nombre}</p>
                  {listos.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {listos.map((e) => {
                        const clave = `${e.job}|${e.connector_id}`;
                        return (
                          <Button key={clave} size="sm" icon={Play} disabled={Boolean(corriendo)} loading={corriendo === clave} title={`Ejecutar con ${e.connector_name}`} onClick={() => ejecutar(e)}>
                            {e.connector_name}{e.prueba ? " (prueba)" : ""}
                          </Button>
                        );
                      })}
                    </div>
                  )}
                  {noInstalados.length > 0 && (
                    <p className="text-[12px] text-muted">
                      {noInstalados.map((e) => e.connector_name).join(", ")}: todavía no está instalado; lo trae {nombreModulo(noInstalados[0].owner_module)} cuando se construya.
                    </p>
                  )}
                  {otros.map((e) => (
                    <p key={e.connector_id} className="text-[12px] text-muted">
                      {e.connector_name}: {e.motivo === "DESACTIVADO" ? "conector desactivado" : `el módulo ${nombreModulo(e.owner_module)} está apagado`}.
                    </p>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        toolbar={<>
          <FiltroSelect etiqueta="Proceso" ancho={210} value={f.job} onChange={(v) => setF({ ...f, job: v })} options={(lista?.procesos ?? []).map((p) => ({ value: p.code, label: p.name }))} />
          <FiltroSelect etiqueta="Resultado" ancho={160} value={f.status} onChange={(v) => setF({ ...f, status: v })} options={Object.entries(lista?.estados ?? {}).map(([value, label]) => ({ value, label }))} />
          <FiltroFecha etiqueta="Fecha" value={f.dia} onChange={(v) => setF({ ...f, dia: v })} />
        </>}
        empty="No hay corridas con estos filtros." />
    </div>
  );
}
