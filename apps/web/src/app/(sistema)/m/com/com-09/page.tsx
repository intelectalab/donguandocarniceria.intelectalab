"use client";

import { useState } from "react";
import { AlarmClock, CalendarCheck, CalendarDays, Wallet } from "lucide-react";
import { Badge, Button, DataTable, Input, Modal, PageHeader, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Barras, CifraLink, FiltroSelect, Seccion, qs, useDatos, useOpcionesCom } from "@/modulos/com/comunes";
import { CRUCE, TRAMO, opciones, type Num } from "@/modulos/com/tipos";

type Doc = { id: string; supplier_id: string; label: string; issue_date: string; due_date: string; currency: string; total: Num; paid_amount: Num; balance: Num; balance_pen: Num;
  scheduled_pay_date: string | null; match_status: string; supplier_name: string; bank_account: string | null; overdue_days: number; bucket: string };
type Respuesta = { data: Doc[]; suppliers: { supplier_id: string; supplier_name: string; docs: number; balance: Num; overdue: Num; max_overdue_days: number }[];
  buckets: { bucket: string; label: string; docs: number; amount: Num }[]; total: Num };
type Cifras = { payable: Num; overdue: Num; due_7: Num; scheduled: Num };

/** COM-09 Cuentas por pagar: saldo por proveedor y comprobante, vencimiento, antigüedad y programación de pagos. */
export default function CuentasPorPagar() {
  const { local } = useSesion();
  const op = useOpcionesCom();
  const [tramo, setTramo] = useState("");
  const [prov, setProv] = useState("");
  const [programados, setProgramados] = useState(false);
  const { datos: r, recargar } = useDatos<Respuesta>(`/v1/com/por-pagar${qs({ bucket: tramo, supplier_id: prov, scheduled: programados ? 1 : null, site: local })}`);
  const c = useDatos<Cifras>("/v1/com/cifras/09");
  const [programar, setProgramar] = useState<Doc | null>(null);
  const columnas: Column<Doc>[] = [
    { key: "label", header: "Comprobante", cardTitle: true, render: (d) => <div className="min-w-[150px]"><p className="font-medium">{d.supplier_name}</p><p className="text-[12px] text-muted">{d.label}</p></div> },
    { key: "due_date", header: "Vence", render: (d) => <span>{fecha(d.due_date)}{d.overdue_days > 0 && <span className="block text-[12px] font-semibold text-bad">hace {d.overdue_days} días</span>}</span> },
    { key: "total", header: "Total", align: "right", hideOnMobile: true, render: (d) => d.currency === "PEN" ? soles(d.total) : `${d.currency} ${numero(d.total, 2)}` },
    { key: "balance_pen", header: "Saldo", align: "right", render: (d) => soles(d.balance_pen) },
    { key: "bucket", header: "Antigüedad", render: (d) => <Badge tone={d.bucket === "NOT_DUE" ? "ok" : d.bucket === "D0_30" ? "warn" : "bad"}>{TRAMO[d.bucket] ?? d.bucket}</Badge> },
    { key: "match_status", header: "Cruce", hideOnMobile: true, render: (d) => d.match_status === "OBSERVED" ? <Badge tone="bad">{CRUCE.OBSERVED[0]}: no se paga</Badge> : <span className="text-muted">—</span> },
    { key: "scheduled_pay_date", header: "Pago programado", render: (d) => <Button size="sm" onClick={(e) => { e.stopPropagation(); setProgramar(d); }}>{d.scheduled_pay_date ? fecha(d.scheduled_pay_date) : "Programar"}</Button> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Lo que se debe a los proveedores: saldo por comprobante con su vencimiento y antigüedad. Programa la fecha de pago y paga desde Pagos a proveedores." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Por pagar" valor={c.datos ? soles(c.datos.payable) : undefined} icono={Wallet} onClick={() => setTramo("")} />
        <CifraLink titulo="Vencido" valor={c.datos ? soles(c.datos.overdue) : undefined} icono={AlarmClock} tono={Number(c.datos?.overdue) ? "bad" : "ok"} onClick={() => setTramo("D0_30")} />
        <CifraLink titulo="Vence en 7 días" valor={c.datos ? soles(c.datos.due_7) : undefined} icono={CalendarDays} />
        <CifraLink titulo="Programado" valor={c.datos ? soles(c.datos.scheduled) : undefined} icono={CalendarCheck} onClick={() => setProgramados(true)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Seccion titulo="Antigüedad del saldo"><Barras filas={(r?.buckets ?? []).map((b) => ({ label: b.label, value: b.amount }))} formato={soles} /></Seccion>
        <Seccion titulo="Por proveedor">
          <DataTable rows={(r?.suppliers ?? []).slice(0, 8)} rowKey={(s) => s.supplier_id} onRowClick={(s) => setProv(s.supplier_id)} empty="Sin saldos." columns={[
            { key: "supplier_name", header: "Proveedor", cardTitle: true, render: (s) => s.supplier_name },
            { key: "docs", header: "Comprob.", align: "right", render: (s) => numero(s.docs) },
            { key: "balance", header: "Saldo", align: "right", render: (s) => soles(s.balance) },
            { key: "overdue", header: "Vencido", align: "right", render: (s) => Number(s.overdue) ? <span className="text-bad">{soles(s.overdue)}</span> : "—" },
          ]} />
        </Seccion>
      </div>
      <DataTable rows={r?.data ?? []} rowKey={(d) => d.id} loading={!r} columns={columnas} empty="No hay saldos con esos filtros."
        toolbar={<>
          <FiltroSelect label="Antigüedad" value={tramo} onChange={setTramo} options={opciones(TRAMO)} ancho="sm:w-[200px]" />
          <FiltroSelect label="Proveedor" value={prov} onChange={setProv} ancho="sm:w-[220px]" options={(op?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          <FiltroSelect label="Programación" value={programados ? "1" : ""} onChange={(v) => setProgramados(v === "1")} options={[{ value: "1", label: "Con fecha programada" }]} />
        </>} />
      {programar && <Programar doc={programar} onClose={() => setProgramar(null)} onListo={() => { setProgramar(null); recargar(); c.recargar(); }} />}
    </div>
  );
}

function Programar({ doc, onClose, onListo }: { doc: Doc; onClose: () => void; onListo: () => void }) {
  const [f, setF] = useState(doc.scheduled_pay_date ?? doc.due_date);
  const enviar = async (date: string | null) => {
    try { await api(`/v1/com/por-pagar/${doc.id}/programar`, { method: "POST", body: { date } }); toast.ok(date ? `Pago programado para el ${fecha(date)}` : "Programación quitada"); onListo(); }
    catch (e) { toast.error(mensajeDe(e)); }
  };
  return (
    <Modal open onClose={onClose} title="Programar pago" description={`${doc.supplier_name} · ${doc.label} · ${soles(doc.balance_pen)}`}
      footer={<>{doc.scheduled_pay_date && <Button onClick={() => enviar(null)}>Quitar fecha</Button>}<Button variant="primary" onClick={() => enviar(f)}>Programar</Button></>}>
      <Input type="date" aria-label="Fecha de pago" value={f} onChange={(e) => setF(e.target.value)} />
      {doc.bank_account && <p className="mt-2 text-[12.5px] text-muted">Cuenta del proveedor: {doc.bank_account}</p>}
    </Modal>
  );
}
