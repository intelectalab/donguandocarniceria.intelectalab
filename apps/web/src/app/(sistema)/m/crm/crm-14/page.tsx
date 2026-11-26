"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ClipboardCheck, ListChecks, Search, Users } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Field, FiltroFecha, FiltroSelect, Modal, PageHeader, Select, Textarea, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { Hilo, RedEtiqueta, type Ficha as FichaChat } from "@/modulos/crm/conversacion";

type Opcion = { value: string; label: string };
type Fila = {
  id: string; contacto: string; celular: string | null; canal: string; kind: string; marca: string | null; vendedora: string | null; user_id: string; cerrada: string; motivo: string;
  resultado: string | null; resultado_name: string; nota: string | null; reviso: string | null; reviewed_at: string | null;
};
type Semana = Pagina<Fila> & {
  semana: string; desde: string; hasta: string; semanas: Opcion[];
  cifras: { vendedoras: number; a_revisar: number; revisadas: number; observadas: number; incidentes: number; universo: number };
  por_vendedora: { id: string; nombre: string; universo: number; muestra: number; revisadas: number }[];
  reglas: { pct: number; min: number }; opciones: { resultados: Opcion[]; vendedoras: Opcion[] }; puede: boolean;
};

const RESULTADO: Record<string, Tone> = { OK: "ok", OBSERVED: "warn", INCIDENT: "bad" };

/**
 * CRM-14 Revisión por muestreo: cada lunes, una muestra de las conversaciones cerradas sin pedido de cada vendedora en la
 * semana anterior. La supervisora lee el chat y registra el resultado; si no es «sin observaciones», con nota.
 */
export default function Muestreo() {
  const { can } = useSesion();
  const permitido = Boolean(can("crm.review.perform") || can("crm.alert.review"));
  const [f, setF] = useState({ semana: "", vendedora: "", resultado: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [s, setS] = useState<Semana | null>(null);
  const [error, setError] = useState("");
  const [abierta, setAbierta] = useState<Fila | null>(null);
  const pag = usePagina(JSON.stringify(f));
  const [buscarVendedora, setBuscarVendedora] = useState("");
  const tarjetas = useMemo(() => {
    const t = buscarVendedora.trim().toLowerCase();
    return (s?.por_vendedora ?? []).filter((v) => t.length < 2 || v.nombre.toLowerCase().includes(t));
  }, [s, buscarVendedora]);

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    if (!permitido) return;
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Semana>(`/v1/crm/muestreo?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setS(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs, permitido]);
  useEffect(() => cargar(), [cargar]);

  if (!permitido) return <Alert tone="warn">La revisión por muestreo la hace la supervisora de ventas.</Alert>;
  const c = s?.cifras;
  const columnas: Column<Fila>[] = [
    { key: "contacto", sortable: true, header: "Contacto", cardTitle: true, render: (x) => <div><p className="font-semibold text-ink">{x.contacto}</p>{x.celular && <p className="font-mono text-[12px] text-muted">{x.celular}</p>}</div> },
    { key: "vendedora", sortable: true, header: "Vendedora", render: (x) => <span className="text-[12.5px]">{x.vendedora}</span> },
    { key: "canal", sortable: true, header: "Número", hideOnMobile: true, render: (x) => <RedEtiqueta kind={x.kind} nombre={x.canal.replace(/^[^·]+·\s*/, "")} /> },
    { key: "cerrada", sortable: true, header: "Cerrada", render: (x) => <div className="whitespace-nowrap text-[12.5px]">{fechaHora(x.cerrada)}<p className="text-[11.5px] text-muted">{x.motivo}</p></div> },
    { key: "resultado_name", sortable: true, header: "Resultado", render: (x) => x.resultado ? <Badge tone={RESULTADO[x.resultado] ?? "neutral"}>{x.resultado_name}</Badge> : <Badge tone="neutral">Pendiente</Badge> },
    { key: "nota", header: "Nota", hideOnMobile: true, render: (x) => <span className="line-clamp-2 max-w-[280px] text-[12.5px] text-muted">{x.nota ?? "—"}</span> },
  ];
  return (
    <div className="grid gap-5">
      <PageHeader description={`Cada lunes se revisa el ${s?.reglas.pct ?? 10} % (mínimo ${s?.reglas.min ?? 3}) de las conversaciones que cada vendedora cerró sin pedido en la semana anterior. La muestra sale siempre igual para la misma semana; cada conversación se revisa una vez.`} />
      {/* Las 10 últimas semanas en la lista; una más antigua se busca por fecha (se toma el lunes de esa semana). */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-[420px]"><FiltroSelect etiqueta="Semana" ancho={420} vacio={s ? s.semanas.find((x) => x.value === s.semana)?.label ?? s.semana : "Semana"} value={f.semana || (s?.semana ?? "")} onChange={(v) => setF({ ...f, semana: v })} options={s?.semanas ?? []} /></div>
        <FiltroFecha etiqueta="Otra semana" visible value="" max={new Date().toISOString().slice(0, 10)} onChange={(v) => v && setF({ ...f, semana: v })} />
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      {c && s && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cifra titulo="Vendedoras en la muestra" valor={numero(c.vendedoras)} icono={Users} destacada detalle={`${numero(c.universo)} cerradas sin pedido`} />
            <Cifra titulo="Conversaciones a revisar" valor={numero(c.a_revisar)} icono={ListChecks} />
            <Cifra titulo="Revisadas" valor={`${c.revisadas} de ${c.a_revisar}`} icono={ClipboardCheck} tono={c.a_revisar && c.revisadas === c.a_revisar ? "ok" : undefined} />
            <Cifra titulo="Observadas o incidentes" valor={numero(c.observadas)} icono={AlertTriangle} tono={c.incidentes ? "bad" : c.observadas ? "warn" : undefined} detalle={`${c.incidentes} incidentes`} />
          </div>
          {s.por_vendedora.length > 0 && (
            <div className="grid gap-2">
              {s.por_vendedora.length > 6 && (
                <label className="relative w-full sm:w-[280px]">
                  <span className="sr-only">Buscar vendedora</span>
                  <Search size={15} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
                  <input type="search" value={buscarVendedora} onChange={(e) => setBuscarVendedora(e.target.value)} placeholder={`Buscar entre ${s.por_vendedora.length} vendedoras…`}
                    className="h-9 w-full rounded-[9px] border border-line bg-bg pr-3 pl-9 text-[13.5px] text-ink outline-none focus:border-primary focus:shadow-[0_0_0_3px_var(--primary-soft)]" />
                </label>
              )}
              {/* Una sola fila que se desplaza de lado cuando hay muchas vendedoras. */}
              <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2">
              {tarjetas.length === 0 && <p className="py-2 text-[13px] text-muted">Ninguna vendedora coincide.</p>}
              {tarjetas.map((v) => (
                <button key={v.id} type="button" onClick={() => setF({ ...f, vendedora: f.vendedora === v.id ? "" : v.id })}
                  className={`shrink-0 cursor-pointer snap-start whitespace-nowrap rounded-lg border px-3 py-2 text-left text-[12.5px] shadow-card ${f.vendedora === v.id ? "border-primary bg-surface" : "border-line bg-surface hover:bg-surface-2"}`}>
                  <b className="text-ink">{v.nombre}</b><span className="block text-muted">{v.muestra} de {v.universo} cerradas · {v.revisadas} revisadas</span>
                </button>
              ))}
              </div>
            </div>
          )}
        </>
      )}
      <DataTable {...pag.orden} columns={columnas} rows={s?.data ?? []} pagination={pag.props(s)} loading={!s && !error} error={error} onRetry={cargar}
        onRowClick={setAbierta} empty="No hubo conversaciones cerradas sin pedido en esa semana." search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar contacto, celular o vendedora…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Vendedora" todos="todas" ancho={190} value={f.vendedora} onChange={(v) => setF({ ...f, vendedora: v })} options={s?.opciones.vendedoras ?? []} />
          <FiltroSelect etiqueta="Resultado" ancho={190} value={f.resultado} onChange={(v) => setF({ ...f, resultado: v })} options={[{ value: "PENDING", label: "Pendiente" }, ...(s?.opciones.resultados ?? [])]} />
        </>} />
      {abierta && s && <Revisar fila={abierta} semana={s} onClose={() => setAbierta(null)} onListo={() => { setAbierta(null); cargar(); }} />}
    </div>
  );
}

function Revisar({ fila, semana, onClose, onListo }: { fila: Fila; semana: Semana; onClose: () => void; onListo: () => void }) {
  const [chat, setChat] = useState<FichaChat | null>(null);
  const [d, setD] = useState({ resultado: "OK", nota: "" });
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    let vivo = true;
    api<FichaChat>(`/v1/crm/conversaciones/${fila.id}`).then((x) => vivo && setChat(x)).catch(() => undefined);
    return () => { vivo = false; };
  }, [fila.id]);
  async function guardar() {
    setEnviando(true);
    try {
      await api(`/v1/crm/muestreo/${fila.id}`, { method: "POST", body: { semana: semana.semana, resultado: d.resultado, nota: d.nota || null } });
      toast.ok("Revisión registrada");
      onListo();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }
  const falta = d.resultado !== "OK" && d.nota.trim().length < 5;
  return (
    <Modal open onClose={onClose} size="lg" title={`Revisión · ${fila.contacto}`} description={`${fila.vendedora} · ${fila.canal} · cerrada ${fechaHora(fila.cerrada)} (${fila.motivo})`}
      footer={!fila.resultado && semana.puede ? <><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={enviando} disabled={falta} onClick={guardar}>Registrar revisión</Button></> : undefined}>
      <div className="grid gap-4">
        {chat ? <Hilo c={chat} onMensaje={() => undefined} /> : <p className="text-[13px] text-muted">Cargando la conversación…</p>}
        <Link href={`/m/crm/crm-02?id=${fila.id}`} className="w-fit text-[12.5px] font-semibold text-primary hover:underline">Abrir el chat completo</Link>
        {fila.resultado ? (
          <Alert tone={fila.resultado === "OK" ? "ok" : fila.resultado === "INCIDENT" ? "bad" : "warn"}>
            {fila.resultado_name} · revisó {fila.reviso} el {fechaHora(fila.reviewed_at)}{fila.nota ? `: ${fila.nota}` : ""}
          </Alert>
        ) : semana.puede ? (
          <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
            <Field label="Resultado" required><Select value={d.resultado} onChange={(e) => setD({ ...d, resultado: e.target.value })} options={semana.opciones.resultados} /></Field>
            <Field label="Nota" required={d.resultado !== "OK"} hint={d.resultado === "OK" ? "Opcional." : "Qué se observó y qué se le dirá a la vendedora."}>
              <Textarea rows={3} maxLength={2000} value={d.nota} onChange={(e) => setD({ ...d, nota: e.target.value })} />
            </Field>
          </div>
        ) : <Alert tone="info">Pendiente de revisión por la supervisora.</Alert>}
      </div>
    </Modal>
  );
}
