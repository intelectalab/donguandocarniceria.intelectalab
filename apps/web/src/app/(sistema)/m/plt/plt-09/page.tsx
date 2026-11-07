"use client";

import { useEffect, useState } from "react";
import { History, Lock, LockOpen } from "lucide-react";
import { Badge, Button, Cifra, DataTable, DetailList, Modal, PageHeader, Select, StatusBadge, confirmAction, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, porcentaje } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import type { Empresa } from "@/modulos/plt/tipos";

type Mes = {
  id: string | null; period: string; nombre: string; status: "OPEN" | "CLOSED"; closed_at: string | null; closed_by: string | null;
  en_curso: boolean; meta: string; a_tiempo: boolean | null; reaperturas: number;
};
type Resumen = {
  cerrados: number; total: number; a_tiempo: number; a_tiempo_pct: number | null; dia_cierre: number;
  pendiente: { nombre: string; meta: string; vencido: boolean } | null; cnt_encendido: boolean;
};
type Evento = { id: string; period: string; action: "OPEN" | "CLOSE" | "REOPEN"; reason: string; acted_by_name: string; acted_at: string };

const ESTADOS: Record<string, [string, Tone]> = { OPEN: ["Abierto", "ok"], CLOSED: ["Cerrado", "neutral"] };
const ACCIONES: Record<Evento["action"], [string, Tone]> = { OPEN: ["Apertura", "neutral"], CLOSE: ["Cierre", "info"], REOPEN: ["Reapertura", "warn"] };
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (period: string) => `${MESES[Number(period.slice(5, 7)) - 1]} de ${period.slice(0, 4)}`;
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** PLT-09 Períodos: los meses de cada empresa, cerrarlos en orden, reabrirlos con motivo y su historial. */
export default function Periodos() {
  const { can } = useSesion();
  const empresas = useListado<Empresa>("/v1/plt/empresas", { porPagina: 100, orden: "legal_name" }).filas;
  const [elegida, setElegida] = useState("");
  const empresa = elegida || empresas[0]?.id || "";
  const [datos, setDatos] = useState<{ clave: string; meses: Mes[]; resumen: Resumen } | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [accion, setAccion] = useState("");
  const [viendo, setViendo] = useState<Mes | null>(null);
  const [ocupado, setOcupado] = useState("");
  const historial = useListado<Evento>("/v1/plt/periodos/historial", { porPagina: 10, filtros: { company_id: empresa, action: accion } });
  const puedeCerrar = can("plt.period.close");
  const puedeReabrir = can("plt.period.reopen");
  const clave = `${empresa}#${version}`;

  useEffect(() => {
    if (!empresa) return;
    let vigente = true;
    api<{ meses: Mes[]; resumen: Resumen }>(`/v1/plt/periodos?company_id=${empresa}`)
      .then((r) => { if (vigente) { setDatos({ clave, ...r }); setError(""); } })
      .catch((err) => vigente && setError(mensajeDe(err)));
    return () => { vigente = false; };
  }, [empresa, clave]);

  const recargar = () => { setVersion((v) => v + 1); historial.recargar(); };
  const meses = datos?.meses ?? [];
  const resumen = datos?.resumen;
  const anio = meses.at(-1)?.period.slice(0, 4);
  // Solo se ofrece lo que las reglas permiten: cerrar el siguiente mes en orden y reabrir el último cerrado.
  const siguiente = meses.find((m) => m.status === "OPEN" && !m.en_curso)?.period;
  const ultimoCerrado = meses.findLast((m) => m.status === "CLOSED")?.period;

  async function cerrar(m: Mes) {
    const r = await confirmAction({
      title: `Cerrar ${m.nombre}`,
      message: "Al cerrar, ningún módulo podrá registrar documentos con fecha de este mes. Se puede reabrir después, con motivo.",
      confirmLabel: "Cerrar período",
      reason: { label: "Nota del cierre", optional: true },
    });
    if (!r) return;
    setOcupado(m.period);
    try {
      await api("/v1/plt/periodos/cerrar", { method: "POST", body: { company_id: empresa, period: m.period, note: r.reason || null } });
      toast.ok(`${mayuscula(m.nombre)} cerrado`);
      recargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  async function reabrir(m: Mes) {
    if (!m.id) return;
    const r = await confirmAction({
      title: `Reabrir ${m.nombre}`,
      message: "Se podrán volver a registrar documentos con fecha de este mes. El motivo queda en el historial.",
      confirmLabel: "Reabrir", danger: true,
      reason: { label: "Motivo", min: 10 },
    });
    if (!r) return;
    setOcupado(m.period);
    try {
      await api(`/v1/plt/periodos/${m.id}/reabrir`, { method: "POST", body: { reason: r.reason } });
      toast.ok(`${mayuscula(m.nombre)} reabierto`);
      recargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  const columnas: Column<Evento>[] = [
    { key: "period", header: "Período", sortable: true, cardTitle: true, render: (e) => mayuscula(nombreMes(e.period)) },
    { key: "action", header: "Acción", sortable: true, render: (e) => <Badge tone={ACCIONES[e.action][1]}>{ACCIONES[e.action][0]}</Badge> },
    { key: "acted_by_name", header: "Por" },
    { key: "acted_at", header: "Fecha", sortable: true, render: (e) => fechaHora(e.acted_at) },
    { key: "reason", header: "Motivo", render: (e) => e.reason || <span className="text-muted">—</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Los meses de cada empresa. Un mes cerrado no admite documentos con esa fecha en ningún módulo. Se cierran en orden, desde que termina el mes; reabrir pide permiso y motivo, y solo se puede si no hay meses posteriores cerrados."
        actions={empresas.length > 1 && (
          <div className="w-full sm:w-[260px]">
            <Select aria-label="Empresa" value={empresa} onChange={(e) => setElegida(e.target.value)}
              options={empresas.map((c) => ({ value: c.id, label: c.trade_name }))} />
          </div>
        )} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Cerrados" valor={resumen ? numero(resumen.cerrados) : undefined} detalle={resumen ? `de ${resumen.total} meses` : ""} />
        <Cifra titulo="Cerrados a tiempo" valor={resumen ? (resumen.a_tiempo_pct === null ? "—" : porcentaje(resumen.a_tiempo_pct)) : undefined}
          detalle={resumen ? `${resumen.a_tiempo} de ${resumen.cerrados} hasta el día ${resumen.dia_cierre} del mes siguiente` : ""}
          tono={resumen && resumen.a_tiempo_pct !== null ? (resumen.a_tiempo_pct >= 100 ? "ok" : "warn") : undefined} />
        <Cifra titulo="Pendiente de cierre" valor={resumen ? (resumen.pendiente ? mayuscula(resumen.pendiente.nombre) : "Ninguno") : undefined}
          detalle={resumen?.pendiente ? (resumen.pendiente.vencido ? `Vencido: se debía cerrar hasta el ${fecha(resumen.pendiente.meta)}` : `Cerrar hasta el ${fecha(resumen.pendiente.meta)}`) : resumen ? "Todo al día" : ""}
          tono={resumen?.pendiente?.vencido ? "warn" : undefined} />
        <Cifra titulo="Contabilidad" valor={resumen ? (resumen.cnt_encendido ? "Encendida" : "Apagada") : undefined}
          detalle={resumen ? (resumen.cnt_encendido ? "Su cierre contable usa estos mismos meses" : "Al encenderla, su cierre usa estos meses") : ""} />
      </div>

      <section className="rounded-xl border border-line bg-surface shadow-card">
        <h2 className="border-b border-line px-4 py-3 text-[14px] font-semibold">
          Calendario {anio}{empresas.length > 1 && ` · ${empresas.find((c) => c.id === empresa)?.legal_name ?? ""}`}
        </h2>
        {error ? (
          <p role="alert" className="px-4 py-8 text-center text-[13.5px] text-bad">{error}</p>
        ) : (
          <ul className={`grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4 ${datos && datos.clave !== clave ? "opacity-60 transition-opacity" : ""}`}>
            {!datos && [1, 2, 3, 4].map((n) => <li key={n} className="h-28 animate-pulse rounded-xl bg-surface-2" />)}
            {meses.map((m) => {
              const pendiente = m.status === "OPEN" && !m.en_curso;
              return (
                <li key={m.period} className={`grid content-start gap-1.5 rounded-xl border p-3 ${pendiente ? "border-warn/40" : "border-line"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <b className="text-[14px]">{mayuscula(m.nombre)}</b>
                    <StatusBadge status={m.status} labels={ESTADOS} />
                  </div>
                  <p className="text-[12.5px] text-muted">
                    {m.status === "CLOSED" ? `Cerrado el ${fecha(m.closed_at)}${m.closed_by ? ` · ${m.closed_by}` : ""}`
                      : pendiente ? `${m.period === siguiente ? "Pendiente de cierre" : `Se cierra después de ${nombreMes(siguiente ?? m.period).split(" de ")[0]}`} · cerrar hasta el ${fecha(m.meta)}`
                      : "Mes en curso: se cierra desde el mes siguiente"}
                  </p>
                  {(m.a_tiempo !== null || m.reaperturas > 0) && (
                    <div className="flex flex-wrap gap-1.5">
                      {m.a_tiempo === true && <Badge tone="ok">A tiempo</Badge>}
                      {m.a_tiempo === false && <Badge tone="warn">Fuera de plazo</Badge>}
                      {m.reaperturas > 0 && <Badge tone="info">{m.reaperturas === 1 ? "1 reapertura" : `${m.reaperturas} reaperturas`}</Badge>}
                    </div>
                  )}
                  <div className="mt-1 flex flex-wrap gap-2">
                    {m.period === siguiente && puedeCerrar && (
                      <Button size="sm" variant="primary" icon={Lock} disabled={Boolean(ocupado)} loading={ocupado === m.period} onClick={() => cerrar(m)}>Cerrar</Button>
                    )}
                    {m.period === ultimoCerrado && puedeReabrir && (
                      <Button size="sm" icon={LockOpen} disabled={Boolean(ocupado)} loading={ocupado === m.period} onClick={() => reabrir(m)}>Reabrir</Button>
                    )}
                    {m.id && <Button size="sm" variant="ghost" icon={History} onClick={() => setViendo(m)}>Historial</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-[14px] font-semibold">Historial de todos los períodos</h2>
        <DataTable {...historial.tabla} columns={columnas}
          search={{ ...historial.tabla.search, placeholder: "Buscar motivo o persona…" }}
          empty="Todavía no hay aperturas, cierres ni reaperturas."
          toolbar={
            <div className="w-full sm:w-[160px]">
              <Select aria-label="Acción" value={accion} onChange={(e) => setAccion(e.target.value)} placeholder="Acción: todas"
                options={[{ value: "OPEN", label: "Aperturas" }, { value: "CLOSE", label: "Cierres" }, { value: "REOPEN", label: "Reaperturas" }]}
                className="!min-h-9 h-9 py-1.5 text-[13px]" />
            </div>
          } />
      </section>

      {viendo && <HistorialMes mes={viendo} empresa={empresa} onClose={() => setViendo(null)} />}
    </div>
  );
}

/** Ficha de un mes: estado, cierre y línea de tiempo de aperturas, cierres y reaperturas. */
function HistorialMes({ mes, empresa, onClose }: { mes: Mes; empresa: string; onClose: () => void }) {
  const [eventos, setEventos] = useState<Evento[] | null>(null);

  useEffect(() => {
    let vigente = true;
    api<{ data: Evento[] }>(`/v1/plt/periodos/historial?company_id=${empresa}&period_id=${mes.id}&sort=acted_at&per_page=100`)
      .then((r) => vigente && setEventos(r.data)).catch(() => vigente && setEventos([]));
    return () => { vigente = false; };
  }, [mes, empresa]);

  return (
    <Modal open onClose={onClose} title={`Historial · ${mes.nombre}`} footer={<Button onClick={onClose}>Cerrar</Button>}>
      <DetailList items={[
        { label: "Estado", value: <StatusBadge status={mes.status} labels={ESTADOS} /> },
        { label: "Cerrado", value: mes.closed_at ? `${fechaHora(mes.closed_at)}${mes.closed_by ? ` · ${mes.closed_by}` : ""}` : "—" },
        { label: "A tiempo", value: mes.a_tiempo === null ? "—" : mes.a_tiempo ? "Sí" : "No" },
        { label: "Fecha límite de cierre", value: fecha(mes.meta) },
      ]} />
      <section className="mt-6 border-t border-line pt-4">
        <h3 className="mb-3 text-[14px] font-semibold">Movimientos</h3>
        {eventos === null ? (
          <p className="text-[13px] text-muted">Cargando…</p>
        ) : eventos.length ? (
          <ol className="relative space-y-4 border-l border-line pl-5">
            {eventos.map((e) => (
              <li key={e.id} className="relative">
                <span aria-hidden="true" className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface bg-primary" />
                <p className="text-[13.5px] font-semibold">{ACCIONES[e.action][0]}</p>
                <p className="text-[12px] text-muted">{fechaHora(e.acted_at)} · {e.acted_by_name}</p>
                {e.reason && <p className="mt-0.5 text-[13px]">{e.reason}</p>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[13px] text-muted">Sin movimientos.</p>
        )}
      </section>
    </Modal>
  );
}
