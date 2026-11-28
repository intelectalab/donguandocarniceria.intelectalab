"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Alert, Button, Cifra, DataTable, Field, FiltroSelect, Input, Modal, PageHeader, Select, Textarea, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { ErrorCarga, Estado, OCULTO, Vacio, useDatos, useOpciones } from "@/modulos/per/comunes";
import { ESTADO_ADELANTO, hoyLima, inicioMes, nombreMes, sumarMeses, type Opciones } from "@/modulos/per/tipos";

type Adelanto = {
  id: string; number: string; employee_id: string; trabajador: string; requested_on: string; amount: number | null; max_amount: number | null; reason: string; status: string;
  pidio: string | null; aprobo: string | null; approved_at: string | null; decision_note: string | null; deduct_period: string; paid_at: string | null; payment_reference: string | null;
  cuenta: string | null; puede_decidir: boolean; puede_pagar: boolean;
};
type Lista = { data: Adelanto[]; ve_sueldos: boolean; resumen: { por_aprobar: number; por_pagar: number; abiertos: number; monto_abierto: number | null; tope_pct: number } };

/** PER-09 Adelantos: solicitud, aprobación por otra persona, pago y período de descuento (RN-PER-09: tope % de la remuneración, uno abierto por persona). */
export default function Adelantos() {
  const { datos: op } = useOpciones();
  const [estado, setEstado] = useState("");
  const { datos, error, cargando, recargar } = useDatos<Lista>(`/v1/per/adelantos${estado ? `?estado=${estado}` : ""}`);
  const [pedir, setPedir] = useState(false);
  const [pagar, setPagar] = useState<Adelanto | null>(null);
  if (error) return <ErrorCarga error={error} que="Cada persona ve sus adelantos; RR. HH. y Gerencia ven todos." />;
  const r = datos?.resumen;
  async function decidir(a: Adelanto, aprobar: boolean) {
    const x = await confirmAction({ title: `${aprobar ? "Aprobar" : "Rechazar"} ${a.number} de ${a.trabajador}`, message: a.amount !== null ? `${soles(a.amount)} · se descuenta en ${nombreMes(a.deduct_period)}.` : undefined,
      confirmLabel: aprobar ? "Aprobar" : "Rechazar", danger: !aprobar, reason: { label: "Nota", optional: aprobar, min: aprobar ? 0 : 5 } });
    if (!x) return;
    try {
      await api(`/v1/per/adelantos/${a.id}/decidir`, { method: "POST", body: { aprobar, note: x.reason || null } });
      toast.ok(aprobar ? "Adelanto aprobado: queda por pagar." : "Adelanto rechazado.");
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }
  async function anular(a: Adelanto) {
    const x = await confirmAction({ title: `Anular ${a.number}`, confirmLabel: "Anular", danger: true });
    if (!x) return;
    try {
      await api(`/v1/per/adelantos/${a.id}/anular`, { method: "POST" });
      toast.ok("Adelanto anulado.");
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }
  const columnas: Column<Adelanto>[] = [
    { key: "number", header: "Adelanto", cardTitle: true, render: (a) => <span className="flex flex-col"><span className="font-medium">{a.trabajador}</span><span className="text-[12px] text-muted">{a.number} · {fecha(a.requested_on)}</span></span> },
    { key: "amount", header: "Monto", align: "right", render: (a) => a.amount === null ? OCULTO : <span className="flex flex-col items-end"><span className="tabular-nums">{soles(a.amount)}</span>{a.max_amount !== null && <span className="text-[11.5px] text-muted">tope {soles(a.max_amount)}</span>}</span> },
    { key: "reason", header: "Motivo", hideOnMobile: true, render: (a) => <span className="text-[12.5px]">{a.reason}{a.decision_note && <span className="block text-muted">Nota: {a.decision_note}</span>}</span> },
    { key: "deduct_period", header: "Se descuenta", render: (a) => nombreMes(a.deduct_period) },
    { key: "aprobo", header: "Aprobó / pagó", hideOnMobile: true, render: (a) => <span className="flex flex-col text-[12.5px]"><span>{a.aprobo ?? "—"}</span>{a.paid_at && <span className="text-muted">{fecha(a.paid_at)} · {a.cuenta} {a.payment_reference}</span>}</span> },
    { key: "status", header: "Estado", render: (a) => <Estado s={a.status} labels={ESTADO_ADELANTO} /> },
    { key: "acc", header: "", render: (a) => (
      <span className="flex flex-wrap justify-end gap-1">
        {a.status === "REQUESTED" && a.puede_decidir && <><Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); decidir(a, true); }}>Aprobar</Button><Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); decidir(a, false); }}>Rechazar</Button></>}
        {a.status === "APPROVED" && a.puede_pagar && <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); setPagar(a); }}>Pagar</Button>}
        {["REQUESTED", "APPROVED"].includes(a.status) && (a.employee_id === op?.yo || op?.permisos.gestiona) && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); anular(a); }}>Anular</Button>}
      </span>
    ) },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description={`El adelanto no puede pasar del ${r?.tope_pct ?? op?.parametros.adelanto_pct ?? 30} % de la remuneración mensual y cada persona tiene uno abierto a la vez. Lo aprueba alguien distinto de quien lo pide; se descuenta en el pago del período elegido.`}
        actions={<Button variant="primary" icon={Plus} onClick={() => setPedir(true)}>Pedir adelanto</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Por aprobar" valor={r ? String(r.por_aprobar) : undefined} tono={r?.por_aprobar ? "warn" : undefined} destacada />
        <Cifra titulo="Por pagar" valor={r ? String(r.por_pagar) : undefined} detalle="aprobados" />
        <Cifra titulo="Abiertos" valor={r ? String(r.abiertos) : undefined} detalle="aún no descontados" />
        <Cifra titulo="Monto abierto" valor={r ? (r.monto_abierto === null ? OCULTO : soles(r.monto_abierto)) : undefined} />
      </div>
      <div className="flex flex-wrap gap-2">
        <FiltroSelect etiqueta="Estado" value={estado} onChange={setEstado} options={Object.entries(ESTADO_ADELANTO).map(([value, [label]]) => ({ value, label }))} />
      </div>
      <DataTable rows={datos?.data ?? []} columns={columnas} loading={cargando} empty={<Vacio>Sin adelantos.</Vacio>} />
      {pedir && op && <Pedir op={op} onClose={() => setPedir(false)} onListo={() => { setPedir(false); recargar(); }} />}
      {pagar && op && <Pagar op={op} a={pagar} onClose={() => setPagar(null)} onListo={() => { setPagar(null); recargar(); }} />}
    </div>
  );
}

function Pedir({ op, onClose, onListo }: { op: Opciones; onClose: () => void; onListo: () => void }) {
  const mes = inicioMes(hoyLima());
  const [v, setV] = useState({ employee_id: "", amount: "", reason: "", deduct_period: mes });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const pon = (k: keyof typeof v, x: string) => setV((y) => ({ ...y, [k]: x }));
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await api("/v1/per/adelantos", { method: "POST", body: { ...v, employee_id: v.employee_id || null, amount: Number(v.amount) } });
      toast.ok("Adelanto pedido: queda por aprobar.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Pedir adelanto" dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-adel" loading={guardando}>Pedir</Button></>}>
      <form id="f-adel" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        {op.permisos.gestiona && <Field label="Trabajador"><Select value={v.employee_id} onChange={(e) => pon("employee_id", e.target.value)} placeholder="Yo" options={op.trabajadores.map((t) => ({ value: t.id, label: t.full_name }))} /></Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monto (S/)" required><Input inputMode="decimal" value={v.amount} onChange={(e) => pon("amount", e.target.value.replace(",", "."))} /></Field>
          <Field label="Se descuenta en" required><Select value={v.deduct_period} onChange={(e) => pon("deduct_period", e.target.value)} options={[0, 1, 2].map((n) => { const m = sumarMeses(mes, n); return { value: m, label: nombreMes(m) }; })} /></Field>
        </div>
        <Field label="Motivo" required><Textarea value={v.reason} maxLength={500} onChange={(e) => pon("reason", e.target.value)} /></Field>
        <p className="text-[12.5px] text-muted">Tope: {op.parametros.adelanto_pct} % de tu remuneración mensual.</p>
      </form>
    </Modal>
  );
}

function Pagar({ op, a, onClose, onListo }: { op: Opciones; a: Adelanto; onClose: () => void; onListo: () => void }) {
  const [cuenta, setCuenta] = useState(op.cuentas[0]?.id ?? "");
  const [ref, setRef] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await api(`/v1/per/adelantos/${a.id}/pagar`, { method: "POST", body: { cash_account_id: cuenta, reference: ref } });
      toast.ok("Adelanto pagado. Se descontará en el pago del período.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} size="sm" title={`Pagar ${a.number}`} description={`${a.trabajador}${a.amount !== null ? ` · ${soles(a.amount)}` : ""}`} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-pagar-ad" loading={guardando}>Registrar pago</Button></>}>
      <form id="f-pagar-ad" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Cuenta de salida" required><Select value={cuenta} onChange={(e) => setCuenta(e.target.value)} options={op.cuentas.map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Número de operación" required><Input value={ref} maxLength={60} onChange={(e) => setRef(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
