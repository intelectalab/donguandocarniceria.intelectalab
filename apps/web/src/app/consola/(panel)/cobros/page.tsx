"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Landmark, Repeat, Scale, XCircle } from "lucide-react";
import { Badge, Button, Cifra, DataTable, Field, Input, Modal, PageHeader, Select, Tabs, toast, type Column, type Tone } from "@/components/ui";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { erroresDe, mensajeDe } from "@/lib/api";
import { usePagina, type Pagina } from "@/lib/paginas";
import { apiConsola } from "@/lib/consola";
import { fecha, fechaHora, soles } from "@/lib/formato";

type Cobro = {
  id: string; tenant_short: string; invoice_number: string; gateway: string; gateway_ref: string; amount: number; status: string; status_name: string;
  origin_name: string; error: string | null; tarjeta: string | null; raw_event: unknown; created_at: string; confirmed_at: string | null; settlement_reference: string | null;
  attempt_no: number;
};
type Cifras = { aprobados: number; aprobado: number; rechazados: number; por_conciliar: number; por_conciliar_monto: number; avisos_repetidos: number };
type Dia = { dia: string; cobros: number; bruto: number; ids: string[] };
type Evento = { id: number; gateway: string; event_id: string; type: string; signature_ok: boolean; payload: unknown; result: string; received_at: string };
type Abono = { id: string; gateway: string; reference: string; settled_on: string; gross: number; amount: number; fee: number; created_by_name: string };
type Datos = Pagina<Cobro> & { cifras: Cifras; por_dia: Dia[]; empresas: { id: string; short: string }[] };
type Seleccion = { ids: string[]; bruto: number };

const TONO: Record<string, Tone> = { APPROVED: "ok", DECLINED: "bad", PENDING: "neutral" };

/** Cobros y conciliación: intentos con su resultado y referencia de la pasarela, avisos crudos y abonos. */
export default function Cobros() {
  const yo = useUsuarioConsola();
  const puede = Boolean(yo.puede["billing.manage"]);
  const [tab, setTab] = useState<"cobros" | "eventos" | "abonos">("cobros");
  const [f, setF] = useState({ status: "", conciliado: "", tenant: "" });
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState("");
  const [marcados, setMarcados] = useState<string[]>([]);
  const [conciliar, setConciliar] = useState<Seleccion | null>(null);
  const [crudo, setCrudo] = useState<unknown>(null);
  const [eventos, setEventos] = useState<Pagina<Evento> | null>(null);
  const [abonos, setAbonos] = useState<Pagina<Abono> | null>(null);
  const pag = usePagina(JSON.stringify(f));
  const pagEventos = usePagina();
  const pagAbonos = usePagina();

  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    apiConsola<Datos>(`/cobros?${q}&${pag.qs}`).then((r) => { setDatos(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs]);
  useEffect(() => cargar(), [cargar]);
  // Los avisos y los abonos se piden al abrir su pestaña, cada uno con su paginación.
  useEffect(() => {
    if (tab === "eventos") apiConsola<Pagina<Evento>>(`/cobros/eventos?${pagEventos.qs}`).then(setEventos).catch((e) => setError(mensajeDe(e)));
    if (tab === "abonos") apiConsola<Pagina<Abono>>(`/cobros/abonos?${pagAbonos.qs}`).then(setAbonos).catch((e) => setError(mensajeDe(e)));
  }, [tab, pagEventos.qs, pagAbonos.qs]);

  const columnas: Column<Cobro>[] = [
    { key: "created_at", header: "Fecha", hideOnMobile: true, render: (c) => <span className="whitespace-nowrap text-[12.5px]">{fechaHora(c.created_at)}</span> },
    { key: "tenant_short", header: "Empresa", render: (c) => c.tenant_short },
    { key: "invoice_number", header: "Comprobante", cardTitle: true, render: (c) => <span className="font-mono text-[12.5px] font-semibold text-ink">{c.invoice_number}</span> },
    { key: "attempt_no", header: "Intento", align: "right", hideOnMobile: true, render: (c) => c.attempt_no },
    { key: "origin_name", header: "Origen", hideOnMobile: true, render: (c) => c.origin_name },
    { key: "amount", header: "Monto", align: "right", render: (c) => soles(c.amount) },
    { key: "status", header: "Resultado", render: (c) => <Badge tone={TONO[c.status]} dot>{c.status_name}</Badge> },
    { key: "error", header: "Motivo", render: (c) => (c.error ? <span className="text-[12.5px] text-bad">{c.error}</span> : <span className="text-muted">—</span>) },
    { key: "gateway_ref", header: "Pasarela y referencia", hideOnMobile: true, render: (c) => (
      <div className="text-[12.5px]"><p>{c.gateway === "FAKE" ? "Pasarela de prueba" : c.gateway} · {c.tarjeta ?? "—"}</p><p className="font-mono text-muted">{c.gateway_ref}</p>
        {c.raw_event ? <button type="button" className="cursor-pointer text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setCrudo(c.raw_event); }}>Ver aviso</button> : null}</div>
    ) },
    { key: "settlement_reference", header: "Conciliado", render: (c) => (c.status !== "APPROVED" ? <span className="text-muted">—</span>
      : c.settlement_reference ? <div className="grid gap-0.5"><Badge tone="ok">Sí</Badge><span className="text-[12px] text-muted">Abono {c.settlement_reference}</span></div>
      : <Badge tone="warn">Pendiente</Badge>) },
  ];
  const elegidos = (datos?.data ?? []).filter((c) => marcados.includes(c.id));
  const k = datos?.cifras;

  return (
    <div className="grid gap-5">
      <PageHeader description="Cada cobro va a la pasarela con el medio de pago guardado de la empresa (solo su token). El resultado llega por el aviso firmado de la pasarela: uno repetido o sin firma válida no tiene efecto. Los cobros aprobados se concilian con el abono de la pasarela; la diferencia es la comisión." />
      {k && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Cobros aprobados" valor={String(k.aprobados)} detalle={soles(k.aprobado)} icono={CheckCircle2} destacada />
          <Cifra titulo="Rechazados" valor={String(k.rechazados)} tono={k.rechazados ? "warn" : undefined} icono={XCircle} />
          <Cifra titulo="Por conciliar" valor={String(k.por_conciliar)} detalle={soles(k.por_conciliar_monto)} tono={k.por_conciliar ? "warn" : "ok"} icono={Scale} />
          <Cifra titulo="Avisos repetidos descartados" valor={String(k.avisos_repetidos)} detalle="No cobraron dos veces" icono={Repeat} />
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "cobros", label: "Cobros" }, { key: "eventos", label: "Avisos de la pasarela" }, { key: "abonos", label: "Abonos" }]} />
      {tab === "cobros" && (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:max-w-3xl">
            <Select aria-label="Empresa" value={f.tenant} onChange={(e) => setF({ ...f, tenant: e.target.value })} placeholder="Todas las empresas"
              options={(datos?.empresas ?? []).map((t) => ({ value: t.id, label: t.short }))} />
            <Select aria-label="Resultado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} placeholder="Todo resultado"
              options={[{ value: "APPROVED", label: "Aprobados" }, { value: "DECLINED", label: "Rechazados" }, { value: "PENDING", label: "Esperando a la pasarela" }]} />
            <Select aria-label="Conciliación" value={f.conciliado} onChange={(e) => setF({ ...f, conciliado: e.target.value })} placeholder="Conciliados o no"
              options={[{ value: "0", label: "Aprobados sin conciliar" }, { value: "1", label: "Conciliados" }]} />
          </div>
          <DataTable columns={columnas} rows={datos?.data ?? []} loading={!datos && !error} error={error} onRetry={cargar} empty="No hay cobros con estos filtros." pagination={pag.props(datos)}
            selection={puede ? { selected: marcados, onChange: setMarcados, canSelect: (c) => c.status === "APPROVED" && !c.settlement_reference,
              actions: <Button size="sm" variant="primary" icon={Landmark} onClick={() => setConciliar({ ids: elegidos.map((c) => c.id), bruto: elegidos.reduce((s, c) => s + c.amount, 0) })}>Conciliar con un abono</Button> } : undefined} />
          {(datos?.por_dia.length ?? 0) > 0 && (
            <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
              <div>
                <h2 className="text-[14.5px] font-semibold text-ink">Conciliación con el abono de la pasarela</h2>
                <p className="text-[13px] text-muted">Los cobros aprobados que todavía no se concilian, por el día en que se cobraron. La pasarela suele abonarlos juntos; la comisión se ve al registrar el abono.</p>
              </div>
              <DataTable rows={datos?.por_dia ?? []} rowKey={(d) => d.dia} empty="" columns={[
                { key: "dia", header: "Cobrado el", cardTitle: true, render: (d) => fecha(d.dia) },
                { key: "cobros", header: "Cobros", align: "right", render: (d) => d.cobros },
                { key: "bruto", header: "Bruto", align: "right", render: (d) => soles(d.bruto) },
                { key: "estado", header: "Estado", render: () => <Badge tone="warn">Pendiente</Badge> },
                ...(puede ? [{ key: "accion", header: "", align: "right" as const, render: (d: Dia) => (
                  <Button size="sm" icon={Landmark} onClick={() => setConciliar({ ids: d.ids, bruto: d.bruto })}>Conciliar abono</Button>
                ) }] : []),
              ]} />
            </section>
          )}
        </>
      )}
      {tab === "eventos" && (
        <DataTable rows={eventos?.data ?? []} rowKey={(e) => String(e.id)} loading={!eventos} empty="Todavía no llegaron avisos." pagination={pagEventos.props(eventos)} columns={[
          { key: "signature_ok", header: "Firma", render: (e) => <Badge tone={e.signature_ok ? "ok" : "bad"}>{e.signature_ok ? "Válida" : "Inválida"}</Badge> },
          { key: "result", header: "Resultado", cardTitle: true, render: (e) => <span className="text-ink">{e.result}</span> },
          { key: "received_at", header: "Llegó", hideOnMobile: true, render: (e) => <div className="text-[12.5px]"><p>{fechaHora(e.received_at)}</p><p className="text-muted">{e.event_id}</p></div> },
          { key: "ver", header: "", align: "right", render: (e) => <button type="button" className="cursor-pointer text-[12.5px] text-primary hover:underline" onClick={() => setCrudo(e.payload)}>Ver aviso</button> },
        ]} />
      )}
      {tab === "abonos" && (
        <DataTable rows={abonos?.data ?? []} loading={!abonos} empty="Todavía no hay abonos conciliados." pagination={pagAbonos.props(abonos)} columns={[
          { key: "reference", header: "Abono", cardTitle: true, render: (a) => <div><p className="font-semibold text-ink">{a.reference}</p><p className="text-[12.5px] text-muted">{fecha(a.settled_on)}</p></div> },
          { key: "gross", header: "Cobrado", align: "right", render: (a) => soles(a.gross) },
          { key: "amount", header: "Abonado", align: "right", render: (a) => soles(a.amount) },
          { key: "fee", header: "Comisión", align: "right", render: (a) => soles(a.fee) },
        ]} />
      )}
      {conciliar && <Conciliar sel={conciliar} onClose={() => setConciliar(null)} onListo={() => { setConciliar(null); setMarcados([]); cargar(); }} />}
      {crudo !== null && (
        <Modal open onClose={() => setCrudo(null)} title="Aviso de la pasarela" placement="center">
          <pre className="max-h-[60vh] overflow-auto rounded-lg bg-surface-2 p-3 text-[12px] text-ink">{JSON.stringify(crudo, null, 2)}</pre>
        </Modal>
      )}
    </div>
  );
}

function Conciliar({ sel, onClose, onListo }: { sel: Seleccion; onClose: () => void; onListo: () => void }) {
  const bruto = Math.round(sel.bruto * 100) / 100;
  const [f, setF] = useState({ reference: "", settled_on: new Date().toISOString().slice(0, 10), amount: String(bruto) });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await apiConsola("/cobros/conciliar", { method: "POST", body: { ...f, amount: Number(f.amount), payments: sel.ids } });
      toast.ok("Abono conciliado");
      onListo();
    } catch (err) {
      setErrores(erroresDe(err));
      toast.error(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  const comision = Math.max(0, Math.round((bruto - Number(f.amount || 0)) * 100) / 100);
  return (
    <Modal open onClose={onClose} dismissable={!guardando} placement="center" title={`Conciliar ${sel.ids.length} ${sel.ids.length === 1 ? "cobro" : "cobros"}`}
      description={`Cobrado: ${soles(bruto)}`}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" type="submit" form="f-abono" loading={guardando}>Conciliar</Button></>}>
      <form id="f-abono" onSubmit={guardar} className="grid gap-4">
        <Field label="Referencia del abono" required error={errores.reference}><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fecha del abono" required error={errores.settled_on}><Input type="date" value={f.settled_on} onChange={(e) => setF({ ...f, settled_on: e.target.value })} /></Field>
          <Field label="Monto abonado" required error={errores.amount} hint={`Comisión: ${soles(comision)}`}>
            <Input type="number" step="0.01" min={0.01} max={bruto} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
