"use client";

import { useState } from "react";
import { Banknote, CalendarCheck, Plus, Wallet } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DataTable, DetailList, Field, Input, Modal, PageHeader, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { CifraLink, FiltroSelect, accion, useDatos, useOpcionesCom } from "@/modulos/com/comunes";
import { METODO, PAGO, opciones, type Num, type Opciones } from "@/modulos/com/tipos";

type Fila = { id: string; number: string; paid_at: string; amount: Num; method: string; reference: string | null; status: string; is_detraction: boolean; paid_to_account: string | null;
  supplier_name: string; account_code: string; account_name: string; registered_by_name: string; documents: string | null; entry_number: string | null };
type Detalle = Fila & { reverse_reason: string | null; allocations: { amount: Num; document_id: string; doc_type: string; series: string; number: string; total: Num; balance: Num; issue_date: string }[];
  entries: { id: string; number: string | null; status: string }[] };
type Cifras = { payable: Num; overdue: Num; scheduled: Num; paid_month: Num; payments_month: number };

/** COM-10 Pagos a proveedores: desde una cuenta bancaria o caja, con número de operación, aplicado a uno o varios comprobantes. */
export default function Pagos() {
  const op = useOpcionesCom();
  const [metodo, setMetodo] = useState("");
  const lista = useListado<Fila>("/v1/com/pagos", { orden: "-paid_at", filtros: { method: metodo } });
  const c = useDatos<Cifras>("/v1/com/cifras/10");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const recargar = () => { lista.recargar(); c.recargar(); };
  const columnas: Column<Fila>[] = [
    { key: "number", header: "Pago", sortable: true, render: (f) => <span className="font-mono">{f.number}</span> },
    { key: "supplier_name", header: "Proveedor", cardTitle: true, render: (f) => <div className="min-w-[150px]"><p className="font-medium">{f.supplier_name}</p><p className="text-[12px] text-muted">{f.documents ?? ""}</p></div> },
    { key: "paid_at", header: "Fecha", sortable: true, render: (f) => fecha(f.paid_at) },
    { key: "amount", header: "Importe", sortable: true, align: "right", render: (f) => soles(f.amount) },
    { key: "method", header: "Medio", hideOnMobile: true, render: (f) => <span>{METODO[f.method] ?? f.method}{f.reference && <span className="block text-[12px] text-muted">op. {f.reference}</span>}</span> },
    { key: "account_code", header: "Desde", hideOnMobile: true, render: (f) => f.account_name },
    { key: "status", header: "Estado", render: (f) => <span className="flex flex-wrap gap-1"><StatusBadge status={f.status} labels={PAGO} />{f.is_detraction && <Badge tone="primary">Detracción</Badge>}</span> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Pagos a proveedores desde una cuenta bancaria o una caja, con su número de operación. Un pago se aplica a uno o varios comprobantes del mismo proveedor; los observados en el cruce no se pagan."
        actions={op?.can.payment_record && <Button variant="primary" icon={Plus} onClick={() => setNuevo(true)}>Registrar pago</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Pagado en el mes" valor={c.datos ? soles(c.datos.paid_month) : undefined} detalle={c.datos ? `${numero(c.datos.payments_month)} pagos` : undefined} icono={Banknote} />
        <CifraLink titulo="Por pagar" valor={c.datos ? soles(c.datos.payable) : undefined} icono={Wallet} href="/m/com/com-09" />
        <CifraLink titulo="Vencido" valor={c.datos ? soles(c.datos.overdue) : undefined} icono={Wallet} tono={Number(c.datos?.overdue) ? "bad" : "ok"} href="/m/com/com-09" />
        <CifraLink titulo="Programado" valor={c.datos ? soles(c.datos.scheduled) : undefined} icono={CalendarCheck} href="/m/com/com-09" />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(f) => setAbierto(f.id)} search={{ ...lista.tabla.search, placeholder: "Buscar número, proveedor u operación…" }} empty="No hay pagos con esos filtros."
        toolbar={<FiltroSelect label="Medio" value={metodo} onChange={setMetodo} options={opciones(METODO)} />} />
      {abierto && <FichaPago id={abierto} puede={Boolean(op?.can.payment_record)} onClose={() => setAbierto(null)} onCambio={recargar} />}
      {nuevo && op && <NuevoPago op={op} onClose={() => setNuevo(false)} onGuardado={(id) => { setNuevo(false); recargar(); setAbierto(id); }} />}
    </div>
  );
}

function FichaPago({ id, puede, onClose, onCambio }: { id: string; puede: boolean; onClose: () => void; onCambio: () => void }) {
  const { datos: p, error, recargar } = useDatos<Detalle>(`/v1/com/pagos/${id}`);
  return (
    <Modal open onClose={onClose} size="lg" title={p ? `Pago ${p.number}` : "Pago"} description={p ? `${p.supplier_name} · ${soles(p.amount)}` : undefined}
      footer={p && p.status === "CONFIRMED" && puede && <Button variant="danger" onClick={() => accion({ title: `¿Revertir el pago ${p.number}?`, message: "Los comprobantes vuelven a quedar con saldo.", reason: { min: 5 }, confirmLabel: "Revertir", danger: true },
        (m) => api(`/v1/com/pagos/${p.id}/revertir`, { method: "POST", body: { reason: m } }), "Pago revertido", () => { recargar(); onCambio(); })}>Revertir</Button>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {p && <div className="space-y-5">
        {p.reverse_reason && <Alert tone="warn" title="Revertido">{p.reverse_reason}</Alert>}
        <DetailList items={[
          { label: "Fecha", value: fechaHora(p.paid_at) }, { label: "Desde", value: `${p.account_code} · ${p.account_name}` },
          { label: "Medio", value: `${METODO[p.method] ?? p.method}${p.reference ? ` · op. ${p.reference}` : ""}` }, { label: "A la cuenta", value: p.paid_to_account ?? "—" },
          { label: "Registró", value: p.registered_by_name }, { label: "Asiento", value: p.entries.map((e) => e.number ?? "por aprobar").join(", ") || "—" },
        ]} />
        <DataTable rows={p.allocations} rowKey={(a) => a.document_id} columns={[
          { key: "series", header: "Comprobante", cardTitle: true, render: (a) => `${a.series}-${a.number}` },
          { key: "issue_date", header: "Emisión", render: (a) => fecha(a.issue_date) },
          { key: "total", header: "Total", align: "right", render: (a) => soles(a.total) },
          { key: "amount", header: "Aplicado", align: "right", render: (a) => soles(a.amount) },
          { key: "balance", header: "Saldo", align: "right", render: (a) => soles(a.balance) },
        ]} />
      </div>}
    </Modal>
  );
}

type DocPendiente = { id: string; label: string; due_date: string; balance: Num; match_status: string; overdue_days: number };

function NuevoPago({ op, onClose, onGuardado }: { op: Opciones; onClose: () => void; onGuardado: (id: string) => void }) {
  const [f, setF] = useState({ supplier_id: "", cash_account_id: "", method: "TRANSFER", reference: "", paid_to_account: "", is_detraction: false });
  const docs = useDatos<{ data: DocPendiente[] }>(f.supplier_id ? `/v1/com/por-pagar?supplier_id=${f.supplier_id}` : null);
  const [montos, setMontos] = useState<Record<string, string>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const prov = op.suppliers.find((s) => s.id === f.supplier_id);
  const total = Object.values(montos).reduce((a, m) => a + Number(m.replace(",", ".") || 0), 0);
  async function guardar() {
    setGuardando(true); setError(""); setErrores({});
    try {
      const r = await api<{ id: string; number: string }>("/v1/com/pagos", { method: "POST", body: { ...f, reference: f.reference || null, paid_to_account: f.paid_to_account || prov?.bank_account || null,
        allocations: Object.entries(montos).filter(([, m]) => Number(m.replace(",", ".")) > 0).map(([document_id, m]) => ({ document_id, amount: Number(m.replace(",", ".")) })) } });
      toast.ok(`Pago ${r.number} registrado`); onGuardado(r.id);
    } catch (e) { const c = erroresDe(e); setErrores(c); if (!Object.keys(c).length) setError(mensajeDe(e)); } finally { setGuardando(false); }
  }
  return (
    <Modal open onClose={onClose} size="lg" dismissable={!guardando} title="Registrar pago a proveedor"
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" loading={guardando} disabled={total <= 0} onClick={guardar}>Pagar {soles(total)}</Button></>}>
      <div className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        {errores.allocations && <Alert tone="bad">{errores.allocations}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Proveedor" required error={errores.supplier_id}><Select value={f.supplier_id} placeholder="Elegir" onChange={(x) => { setF({ ...f, supplier_id: x.target.value }); setMontos({}); }}
            options={op.suppliers.map((s) => ({ value: s.id, label: `${s.name}${s.can_order ? "" : " (bloqueado por SUNAT)"}`, disabled: !s.can_order }))} /></Field>
          <Field label="Desde la cuenta" required error={errores.cash_account_id}><Select value={f.cash_account_id} placeholder="Elegir" onChange={(x) => setF({ ...f, cash_account_id: x.target.value })} options={op.cash_accounts.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Field>
          <Field label="Medio" error={errores.method}><Select value={f.method} onChange={(x) => setF({ ...f, method: x.target.value })} options={op.methods.map((m) => ({ value: m, label: METODO[m] ?? m }))} /></Field>
          <Field label="Número de operación" error={errores.reference}><Input value={f.reference} maxLength={60} onChange={(x) => setF({ ...f, reference: x.target.value })} /></Field>
          <Field label="A la cuenta del proveedor" error={errores.paid_to_account} hint={prov?.bank_account ? `Registrada: ${prov.bank_account}` : "Sin cuenta registrada"}><Input value={f.paid_to_account} placeholder={prov?.bank_account ?? ""} maxLength={60} onChange={(x) => setF({ ...f, paid_to_account: x.target.value })} /></Field>
          <div className="self-end"><Checkbox checked={f.is_detraction} onChange={(v) => setF({ ...f, is_detraction: v })} label="Es depósito de detracción" /></div>
        </div>
        {f.supplier_id && <DataTable rows={docs.datos?.data ?? []} rowKey={(d) => d.id} loading={docs.cargando} empty="Este proveedor no tiene comprobantes por pagar." columns={[
          { key: "label", header: "Comprobante", cardTitle: true, render: (d) => <span>{d.label}{d.match_status === "OBSERVED" && <Badge tone="bad">Observado</Badge>}</span> },
          { key: "due_date", header: "Vence", render: (d) => <span className={d.overdue_days > 0 ? "text-bad" : ""}>{fecha(d.due_date)}</span> },
          { key: "balance", header: "Saldo", align: "right", render: (d) => soles(d.balance) },
          { key: "id", header: "A pagar", render: (d) => <div className="flex items-center gap-1"><Input aria-label={`Pagar ${d.label}`} inputMode="decimal" className="w-28" value={montos[d.id] ?? ""} disabled={d.match_status === "OBSERVED"}
            onChange={(x) => setMontos({ ...montos, [d.id]: x.target.value })} /><Button size="sm" disabled={d.match_status === "OBSERVED"} onClick={() => setMontos({ ...montos, [d.id]: String(d.balance) })}>Todo</Button></div> },
        ]} />}
      </div>
    </Modal>
  );
}
