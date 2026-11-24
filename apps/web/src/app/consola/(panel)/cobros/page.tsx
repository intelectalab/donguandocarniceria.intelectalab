"use client";

import { useCallback, useEffect, useState } from "react";
import { Landmark } from "lucide-react";
import { Badge, Button, DataTable, Field, Input, Modal, PageHeader, Select, Tabs, toast, type Column, type Tone } from "@/components/ui";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { erroresDe, mensajeDe } from "@/lib/api";
import { apiConsola } from "@/lib/consola";
import { fecha, fechaHora, soles } from "@/lib/formato";

type Cobro = {
  id: string; tenant_short: string; invoice_number: string; gateway: string; gateway_ref: string; amount: number; status: string; status_name: string;
  origin_name: string; error: string | null; tarjeta: string | null; raw_event: unknown; created_at: string; confirmed_at: string | null; settlement_reference: string | null;
};
type Evento = { id: number; gateway: string; event_id: string; type: string; signature_ok: boolean; payload: unknown; result: string; received_at: string };
type Abono = { id: string; gateway: string; reference: string; settled_on: string; gross: number; amount: number; fee: number; created_by_name: string };
type Datos = { data: Cobro[]; eventos: Evento[]; abonos: Abono[] };

const TONO: Record<string, Tone> = { APPROVED: "ok", DECLINED: "bad", PENDING: "neutral" };

/** Cobros y conciliación: intentos con su resultado y referencia de la pasarela, avisos crudos y abonos. */
export default function Cobros() {
  const yo = useUsuarioConsola();
  const puede = Boolean(yo.puede["billing.manage"]);
  const [tab, setTab] = useState<"cobros" | "eventos" | "abonos">("cobros");
  const [f, setF] = useState({ status: "", conciliado: "" });
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState("");
  const [marcados, setMarcados] = useState<string[]>([]);
  const [conciliar, setConciliar] = useState(false);
  const [crudo, setCrudo] = useState<unknown>(null);

  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    apiConsola<Datos>(`/cobros?${q}`).then((r) => { setDatos(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f]);
  useEffect(() => cargar(), [cargar]);

  const columnas: Column<Cobro>[] = [
    { key: "invoice_number", header: "Comprobante", cardTitle: true, render: (c) => <div><p className="font-semibold text-ink">{c.invoice_number}</p><p className="text-[12.5px] text-muted">{c.tenant_short}</p></div> },
    { key: "amount", header: "Monto", align: "right", render: (c) => soles(c.amount) },
    { key: "status", header: "Resultado", render: (c) => (
      <div className="grid gap-0.5"><Badge tone={TONO[c.status]} dot>{c.status_name}</Badge>{c.error && <span className="text-[12px] text-bad">{c.error}</span>}
        {c.settlement_reference && <span className="text-[12px] text-muted">Abono {c.settlement_reference}</span>}</div>
    ) },
    { key: "gateway_ref", header: "Pasarela", hideOnMobile: true, render: (c) => (
      <div className="text-[12.5px]"><p>{c.gateway === "FAKE" ? "Pasarela de prueba" : c.gateway} · {c.tarjeta ?? "—"}</p><p className="text-muted">{c.gateway_ref}</p>
        {c.raw_event ? <button type="button" className="cursor-pointer text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setCrudo(c.raw_event); }}>Ver aviso</button> : null}</div>
    ) },
    { key: "created_at", header: "Cuándo", hideOnMobile: true, render: (c) => <div className="text-[12.5px]"><p>{fechaHora(c.created_at)}</p><p className="text-muted">{c.origin_name}</p></div> },
  ];
  const elegidos = (datos?.data ?? []).filter((c) => marcados.includes(c.id));

  return (
    <div className="grid gap-5">
      <PageHeader description="Cada cobro va a la pasarela con el medio de pago guardado de la empresa (solo su token). El resultado llega por el aviso firmado de la pasarela: uno repetido o sin firma válida no tiene efecto. Los cobros aprobados se concilian con el abono de la pasarela; la diferencia es la comisión." />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "cobros", label: "Cobros" }, { key: "eventos", label: "Avisos de la pasarela" }, { key: "abonos", label: "Abonos" }]} />
      {tab === "cobros" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
            <Select aria-label="Resultado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} placeholder="Todo resultado"
              options={[{ value: "APPROVED", label: "Aprobados" }, { value: "DECLINED", label: "Rechazados" }, { value: "PENDING", label: "Esperando a la pasarela" }]} />
            <Select aria-label="Conciliación" value={f.conciliado} onChange={(e) => setF({ ...f, conciliado: e.target.value })} placeholder="Conciliados o no"
              options={[{ value: "0", label: "Aprobados sin conciliar" }, { value: "1", label: "Conciliados" }]} />
          </div>
          <DataTable columns={columnas} rows={datos?.data ?? []} loading={!datos && !error} error={error} onRetry={cargar} empty="No hay cobros con estos filtros."
            selection={puede ? { selected: marcados, onChange: setMarcados, canSelect: (c) => c.status === "APPROVED" && !c.settlement_reference,
              actions: <Button size="sm" variant="primary" icon={Landmark} onClick={() => setConciliar(true)}>Conciliar con un abono</Button> } : undefined} />
        </>
      )}
      {tab === "eventos" && (
        <div className="grid gap-1.5">
          {(datos?.eventos ?? []).length === 0 && <p className="text-[13px] text-muted">Todavía no llegaron avisos.</p>}
          {(datos?.eventos ?? []).map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px]">
              <Badge tone={e.signature_ok ? "ok" : "bad"}>{e.signature_ok ? "Firma válida" : "Firma inválida"}</Badge>
              <span className="text-ink">{e.result}</span><span className="text-muted">{e.event_id} · {fechaHora(e.received_at)}</span>
              <button type="button" className="cursor-pointer text-primary hover:underline" onClick={() => setCrudo(e.payload)}>Ver aviso</button>
            </div>
          ))}
        </div>
      )}
      {tab === "abonos" && (
        <div className="grid gap-1.5">
          {(datos?.abonos ?? []).length === 0 && <p className="text-[13px] text-muted">Todavía no hay abonos conciliados.</p>}
          {(datos?.abonos ?? []).map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-[13px]">
              <span className="font-semibold text-ink">{a.reference}</span><span>{fecha(a.settled_on)}</span>
              <span>Cobrado {soles(a.gross)}</span><span>Abonado {soles(a.amount)}</span><span className="text-muted">Comisión {soles(a.fee)}</span>
            </div>
          ))}
        </div>
      )}
      {conciliar && <Conciliar cobros={elegidos} onClose={() => setConciliar(false)} onListo={() => { setConciliar(false); setMarcados([]); cargar(); }} />}
      {crudo !== null && (
        <Modal open onClose={() => setCrudo(null)} title="Aviso de la pasarela" placement="center">
          <pre className="max-h-[60vh] overflow-auto rounded-lg bg-surface-2 p-3 text-[12px] text-ink">{JSON.stringify(crudo, null, 2)}</pre>
        </Modal>
      )}
    </div>
  );
}

function Conciliar({ cobros, onClose, onListo }: { cobros: Cobro[]; onClose: () => void; onListo: () => void }) {
  const bruto = Math.round(cobros.reduce((s, c) => s + c.amount, 0) * 100) / 100;
  const [f, setF] = useState({ reference: "", settled_on: new Date().toISOString().slice(0, 10), amount: String(bruto) });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await apiConsola("/cobros/conciliar", { method: "POST", body: { ...f, amount: Number(f.amount), payments: cobros.map((c) => c.id) } });
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
    <Modal open onClose={onClose} dismissable={!guardando} placement="center" title={`Conciliar ${cobros.length} cobro(s)`}
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
