"use client";

import { useState, type FormEvent } from "react";
import { FilePlus2 } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Field, Input, Modal, PageHeader, Select, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { ErrorCarga, Estado, FiltroMes, OCULTO, Seccion, Vacio, useDatos, useOpciones } from "@/modulos/per/comunes";
import { ESTADO_PAGO, hoyLima, inicioMes, sumarMeses, type Opciones } from "@/modulos/per/tipos";

type Linea = { concept: string; concepto: string; amount: number | null; descuento: boolean; note: string | null };
type Pago = {
  id: string; number: string; employee_id: string; trabajador: string; payout_type: string; gross_amount: number | null; deductions_amount: number | null; net_amount: number | null;
  status: string; held_reason: string | null; aprobo: string | null; approved_at: string | null; paid_at: string | null; payment_reference: string | null; cuenta: string | null;
  lineas: Linea[]; puede_aprobar: boolean; puede_pagar: boolean; puede_liberar: boolean;
};
type Lista = { periodo: string; nombre: string; cerrado: boolean; cierre: string; data: Pago[];
  resumen: { pagos: number; borrador: number; retenidos: number; aprobados: number; pagados: number; neto: number | null; bruto: number | null } };

const s = (v: number | null) => (v === null ? OCULTO : soles(v));

/** PER-12 Pagos al personal: liquidación por persona y período con comisiones, bonos, jornales, adelantos y multas; aprobación y pago (RN-PER-14 a 17). */
export default function Pagos() {
  const { datos: op } = useOpciones();
  const [mes, setMes] = useState(sumarMeses(inicioMes(hoyLima()), -1));
  const { datos, error, cargando, recargar } = useDatos<Lista>(`/v1/per/pagos?mes=${mes}`);
  const [ver, setVer] = useState<Pago | null>(null);
  const [pagar, setPagar] = useState<Pago | null>(null);
  const [generando, setGenerando] = useState(false);
  if (error) return <ErrorCarga error={error} que="Cada persona ve sus pagos; RR. HH. y Administración ven todos." />;
  const r = datos?.resumen;
  const puedeGenerar = Boolean(op?.permisos.comisiones || op?.permisos.aprueba_pagos);
  async function generar() {
    setGenerando(true);
    try {
      const x = await api<{ creados: number; retenidos: number; ya_tenian: number; sin_monto: number }>("/v1/per/pagos/generar", { method: "POST", body: { mes } });
      toast.ok(`${x.creados} liquidaciones por aprobar y ${x.retenidos} retenidas${x.ya_tenian ? `; ${x.ya_tenian} ya existían` : ""}.`);
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setGenerando(false);
    }
  }
  async function accion(p: Pago, que: "aprobar" | "liberar" | "anular") {
    const textos = {
      aprobar: { title: `Aprobar ${p.number} de ${p.trabajador}`, message: `Neto ${s(p.net_amount)}.`, confirmLabel: "Aprobar" },
      liberar: { title: `Liberar ${p.number}`, message: p.held_reason ?? "", confirmLabel: "Liberar", reason: { label: "Por qué se libera", min: 5 } },
      anular: { title: `Anular ${p.number}`, message: "Los adelantos y multas vuelven a quedar por descontar.", confirmLabel: "Anular", danger: true, reason: { label: "Motivo", min: 5 } },
    }[que];
    const x = await confirmAction(textos);
    if (!x) return;
    try {
      await api(`/v1/per/pagos/${p.id}/${que}`, { method: "POST", body: que === "anular" ? { reason: x.reason } : que === "liberar" ? { note: x.reason } : {} });
      toast.ok(que === "aprobar" ? "Pago aprobado: queda por pagar." : que === "liberar" ? "Pago liberado: queda por aprobar." : "Pago anulado.");
      setVer(null);
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }
  const acciones = (p: Pago) => (
    <span className="flex flex-wrap justify-end gap-1">
      {p.status === "DRAFT" && p.puede_aprobar && <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); accion(p, "aprobar"); }}>Aprobar</Button>}
      {p.status === "HELD" && p.puede_liberar && <Button size="sm" onClick={(e) => { e.stopPropagation(); accion(p, "liberar"); }}>Liberar</Button>}
      {p.status === "APPROVED" && p.puede_pagar && <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); setPagar(p); }}>Pagar</Button>}
    </span>
  );
  const columnas: Column<Pago>[] = [
    { key: "trabajador", header: "Persona", cardTitle: true, render: (p) => <span className="flex flex-col"><span className="font-medium">{p.trabajador}</span><span className="text-[12px] text-muted">{p.number}</span></span> },
    { key: "lineas", header: "Conceptos", hideOnMobile: true, render: (p) => <span className="text-[12.5px]">{p.lineas.map((l) => l.concepto).join(" · ")}</span> },
    { key: "gross_amount", header: "Bruto", align: "right", render: (p) => s(p.gross_amount) },
    { key: "deductions_amount", header: "Descuentos", align: "right", render: (p) => p.deductions_amount ? <span className="text-bad">−{s(p.deductions_amount)}</span> : "—" },
    { key: "net_amount", header: "Neto", align: "right", render: (p) => <span className="font-semibold">{s(p.net_amount)}</span> },
    { key: "status", header: "Estado", render: (p) => <span className="flex flex-col items-end gap-0.5"><Estado s={p.status} labels={ESTADO_PAGO} />{p.paid_at && <span className="text-[11.5px] text-muted">{fecha(p.paid_at)}</span>}</span> },
    { key: "acc", header: "", render: acciones },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="Se liquida cuando el período de comisiones ya cerró. El neto es siempre bruto menos descuentos. Si la persona tiene alertas graves sin atender, el pago queda retenido hasta que se atiendan o se libere con motivo. Quien aprueba es distinto de quien paga."
        actions={puedeGenerar && <Button variant="primary" icon={FilePlus2} loading={generando} disabled={datos ? !datos.cerrado : true} onClick={generar}>Generar liquidaciones</Button>} />
      <div className="flex flex-wrap items-center gap-2">
        <FiltroMes value={mes} onChange={setMes} etiqueta="Período" />
        {datos && (datos.cerrado ? <Badge tone="neutral">Período cerrado</Badge> : <Badge tone="warn">Abierto hasta el {fecha(datos.cierre)}: aún no se liquida</Badge>)}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Neto del período" valor={r ? s(r.neto) : undefined} detalle={r ? `${r.pagos} liquidaciones` : ""} destacada />
        <Cifra titulo="Por aprobar" valor={r ? String(r.borrador) : undefined} tono={r?.borrador ? "warn" : undefined} />
        <Cifra titulo="Retenidos" valor={r ? String(r.retenidos) : undefined} detalle="por alertas graves" tono={r?.retenidos ? "bad" : undefined} />
        <Cifra titulo="Pagados" valor={r ? String(r.pagados) : undefined} detalle={r ? `${r.aprobados} aprobados por pagar` : ""} />
      </div>
      <DataTable rows={datos?.data ?? []} columns={columnas} loading={cargando} onRowClick={setVer} empty={<Vacio>{datos?.cerrado ? "Aún no se generan las liquidaciones de este período." : "El período aún está abierto."}</Vacio>} />
      {ver && (
        <Modal open onClose={() => setVer(null)} title={`${ver.number} · ${ver.trabajador}`} description={datos?.nombre}
          footer={<>{ver.status !== "PAID" && ver.status !== "VOIDED" && op?.permisos.aprueba_pagos && <Button variant="ghost" onClick={() => accion(ver, "anular")}>Anular</Button>}{acciones(ver)}</>}>
          <div className="space-y-3">
            {ver.held_reason && <Alert tone="bad" title="Retenido">{ver.held_reason}</Alert>}
            <Seccion>
              <ul className="space-y-2 text-[13.5px]">
                {ver.lineas.map((l, i) => (
                  <li key={i} className="flex items-start justify-between gap-2">
                    <span className="min-w-0">{l.concepto}{l.note && <span className="block text-[12px] text-muted">{l.note}</span>}</span>
                    <span className={`tabular-nums ${l.descuento ? "text-bad" : ""}`}>{l.descuento ? "−" : ""}{s(l.amount)}</span>
                  </li>
                ))}
                <li className="flex justify-between border-t border-line pt-2 font-semibold"><span>Neto</span><span className="tabular-nums">{s(ver.net_amount)}</span></li>
              </ul>
            </Seccion>
            {ver.aprobo && <p className="text-[12.5px] text-muted">Aprobó {ver.aprobo}{ver.paid_at ? ` · pagado el ${fecha(ver.paid_at)} desde ${ver.cuenta} (${ver.payment_reference})` : ""}</p>}
          </div>
        </Modal>
      )}
      {pagar && op && <Pagar op={op} p={pagar} onClose={() => setPagar(null)} onListo={() => { setPagar(null); setVer(null); recargar(); }} />}
    </div>
  );
}

function Pagar({ op, p, onClose, onListo }: { op: Opciones; p: Pago; onClose: () => void; onListo: () => void }) {
  const [cuenta, setCuenta] = useState(op.cuentas[0]?.id ?? "");
  const [ref, setRef] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await api(`/v1/per/pagos/${p.id}/pagar`, { method: "POST", body: { cash_account_id: cuenta, reference: ref } });
      toast.ok("Pago registrado. Los adelantos y multas quedan descontados.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} size="sm" title={`Pagar ${p.number}`} description={`${p.trabajador} · neto ${s(p.net_amount)}`} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-pagar" loading={guardando}>Registrar pago</Button></>}>
      <form id="f-pagar" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Cuenta de salida" required><Select value={cuenta} onChange={(e) => setCuenta(e.target.value)} options={op.cuentas.map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Número de operación" required><Input value={ref} maxLength={60} onChange={(e) => setRef(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
