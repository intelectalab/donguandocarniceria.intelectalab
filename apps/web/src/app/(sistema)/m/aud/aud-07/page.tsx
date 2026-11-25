"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, Eraser, ListChecks, PlayCircle, TriangleAlert } from "lucide-react";
import { Alert, Button, Cifra, DataTable, DetailList, FiltroFecha, FiltroSelect, Modal, PageHeader, StatusBadge, confirmAction, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";

type Opcion = { value: string; label: string };
type Corrida = {
  id: string; number: string; category: string; category_name: string; cutoff_date: string; archived_rows: number; purged_rows: number;
  archivo: string | null; archive_sha256: string | null; status: string; status_name: string; started_at: string; finished_at: string; segundos: number; run_by: string; error: string | null;
};
type Lista = Pagina<Corrida> & {
  cifras: { corridas: number; depuradas: number; archivadas: number; fallidas: number; pendiente: number };
  categorias: Opcion[]; estados: Opcion[]; puede: boolean;
};

const ESTADOS: Record<string, [string, Tone]> = { COMPLETED: ["Completada", "ok"], FAILED: ["Falló", "bad"] };

/**
 * AUD-07 Corridas de depuración: cada corrida de archivo y depuración con su categoría, fecha de corte, filas archivadas
 * y depuradas, archivo generado y resultado. Solo se agregan filas.
 */
export default function CorridasDeDepuracion() {
  const { can } = useSesion();
  const permitido = Boolean(can("aud.retention.manage") || can("aud.change_log.view"));
  const [f, setF] = useState({ categoria: "", estado: "", desde: "", hasta: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [abierta, setAbierta] = useState<Corrida | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const pag = usePagina(JSON.stringify(f));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);

  const cargar = useCallback(() => {
    if (!permitido) return;
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/aud/depuraciones?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs, permitido]);
  useEffect(() => cargar(), [cargar]);

  if (!permitido) return <Alert tone="warn">Tu rol no consulta las corridas de depuración.</Alert>;

  async function ejecutarVencidas() {
    const c = lista?.cifras;
    if (!c?.pendiente) {
      toast.info("No hay filas vencidas para depurar");
      return;
    }
    const ok = await confirmAction({ title: "¿Ejecutar todas las vencidas?", confirmLabel: "Ejecutar", danger: true,
      message: `Se depurarán ${numero(c.pendiente)} fila(s) vencidas según las políticas de retención; las categorías que lo piden se archivan antes, comprimidas y cifradas. No se puede deshacer.` });
    if (!ok) return;
    setCorriendo(true);
    try {
      const r = await api<{ data: Corrida[] }>("/v1/aud/depuraciones", { method: "POST" });
      const fallidas = r.data.filter((x) => x.status === "FAILED").length;
      if (fallidas) toast.error(`${fallidas} corrida(s) fallaron; en esas no se borró nada`);
      else toast.ok(r.data.length ? `${r.data.length} corrida(s) ejecutadas` : "No había filas vencidas");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setCorriendo(false);
    }
  }

  const columnas: Column<Corrida>[] = [
    { key: "number", sortable: true, header: "N.º", cardTitle: true, render: (x) => <span className="whitespace-nowrap font-mono font-semibold text-ink">{x.number}</span> },
    { key: "started_at", sortable: true, header: "Inicio", render: (x) => <span className="whitespace-nowrap">{fechaHora(x.started_at)}</span> },
    { key: "category", sortable: true, header: "Categoría", render: (x) => x.category_name },
    { key: "cutoff_date", sortable: true, header: "Corte", render: (x) => <span className="whitespace-nowrap tabular-nums">{fecha(x.cutoff_date)}</span> },
    { key: "archived_rows", sortable: true, header: "Archivadas", align: "right", render: (x) => numero(x.archived_rows) },
    { key: "purged_rows", sortable: true, header: "Depuradas", align: "right", render: (x) => numero(x.purged_rows) },
    { key: "archivo", header: "Archivo", hideOnMobile: true, render: (x) => (x.archivo ? <span className="break-all font-mono text-[11.5px]">{x.archivo}</span> : <span className="text-muted">—</span>) },
    { key: "run_by", sortable: true, header: "Ejecutó", hideOnMobile: true, render: (x) => <span className="text-[12.5px]">{x.run_by}</span> },
    { key: "status", sortable: true, header: "Resultado", render: (x) => <StatusBadge status={x.status} labels={ESTADOS} /> },
  ];

  const c = lista?.cifras;
  return (
    <div className="grid gap-5">
      <PageHeader description="Cada corrida de archivo y depuración, con su categoría, la fecha de corte, cuántas filas se archivaron y depuraron, el archivo generado y el resultado. Corre sola el primer día de cada mes; si una falla, no se borra nada y queda el motivo. Las corridas no se modifican ni se borran."
        actions={lista?.puede ? <Button variant="primary" icon={PlayCircle} disabled={corriendo} onClick={ejecutarVencidas}>{corriendo ? "Ejecutando…" : "Ejecutar todas las vencidas"}</Button> : undefined} />
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Corridas" valor={numero(c.corridas)} icono={ListChecks} destacada detalle={c.fallidas ? `${numero(c.fallidas)} fallaron` : (f.categoria || f.estado || f.desde || f.hasta || f.buscar ? "En el filtro" : "Todas completas")} />
          <Cifra titulo="Filas depuradas" valor={numero(c.depuradas)} icono={Eraser} />
          <Cifra titulo="Filas archivadas" valor={numero(c.archivadas)} icono={Archive} detalle="Comprimidas y cifradas" />
          <Cifra titulo="Pendiente de depurar" valor={numero(c.pendiente)} icono={TriangleAlert} tono={c.pendiente ? "warn" : "ok"} detalle={c.pendiente ? "Vencidas hoy" : "Nada vencido"} />
        </div>
      )}
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={setAbierta} empty="No hay corridas con estos filtros."
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar número o categoría…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Categoría" ancho={220} value={f.categoria} onChange={(v) => setF({ ...f, categoria: v })} options={lista?.categorias ?? []} />
          <FiltroSelect etiqueta="Resultado" ancho={170} value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={lista?.estados ?? []} />
          <FiltroFecha etiqueta="Desde" visible value={f.desde} max={f.hasta || undefined} onChange={(v) => setF({ ...f, desde: v })} />
          <FiltroFecha etiqueta="Hasta" visible value={f.hasta} min={f.desde || undefined} onChange={(v) => setF({ ...f, hasta: v })} />
        </>} />
      {abierta && (
        <Modal open onClose={() => setAbierta(null)} title={`Corrida ${abierta.number}`}>
          <div className="grid gap-4">
            {abierta.error && <Alert tone="bad">Falló y no se borró nada: {abierta.error}</Alert>}
            <DetailList items={[
              { label: "Categoría", value: abierta.category_name },
              { label: "Resultado", value: <StatusBadge status={abierta.status} labels={ESTADOS} /> },
              { label: "Fecha de corte", value: `Lo anterior al ${fecha(abierta.cutoff_date)}` },
              { label: "Filas depuradas", value: numero(abierta.purged_rows) },
              { label: "Filas archivadas", value: numero(abierta.archived_rows) },
              { label: "Archivo", value: abierta.archivo ? <span className="break-all font-mono text-[12px]">{abierta.archivo}</span> : "Sin archivo (la política no archiva o no había filas)" },
              { label: "Huella del archivo", value: abierta.archive_sha256 ? <span className="break-all font-mono text-[11.5px]">{abierta.archive_sha256}</span> : "—" },
              { label: "Inicio", value: fechaHora(abierta.started_at) },
              { label: "Duración", value: abierta.segundos < 60 ? `${abierta.segundos} s` : `${Math.round(abierta.segundos / 60)} min` },
              { label: "Ejecutó", value: abierta.run_by },
            ]} />
          </div>
        </Modal>
      )}
    </div>
  );
}
