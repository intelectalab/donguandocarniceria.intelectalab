"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock, Scale, Truck, Wallet } from "lucide-react";
import { Alert, Button, DataTable, Input, PageHeader, StatusBadge, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, kg, numero, porcentaje, soles } from "@/lib/formato";
import { CONCILIACION, CifraLink, Seccion, accion, mesActual, nombreMes, useDatos, useOpcionesGrj, type Num } from "@/modulos/grj/comunes";

type Conciliacion = {
  period: string; dispatches: number; sent_kg: number; received_kg: number; sent_value: number; received_value: number; difference_kg: number; difference_value: number; tolerance_pct: number;
  rows: { key: string; name: string; sent_kg: number; received_kg: number; sent_value: number; received_value: number; lines: number; difference_kg: number; difference_value: number }[];
  issues: { type: string; dispatch_id: string; number: string; detail: string }[];
  reconciliation: { id: string; status: string; notes: string | null; agreed_at: string | null; agreed_by_name: string | null; closed_at: string | null; closed_by_name: string | null } | null;
  history: { id: string; period: string; status: string; sent_kg: Num; received_kg: Num; difference_kg: Num; difference_value: Num }[];
};
const PROBLEMA: Record<string, string> = { PENDING: "Por recibir", DISPUTED: "En disputa", ERROR: "Con error", NO_REASON: "Diferencia sin motivo" };

/** GRJ-05 Conciliación mensual: kg y valor enviados frente a recibidos por producto, diferencias pendientes y acuerdo con la granja. */
export default function Conciliacion() {
  const op = useOpcionesGrj();
  const [mes, setMes] = useState(mesActual());
  const { datos: c, error, recargar } = useDatos<Conciliacion>(`/v1/grj/conciliacion?month=${mes}`);
  const [nota, setNota] = useState("");
  const estado = c?.reconciliation?.status ?? "OPEN";
  const pct = c && c.sent_kg ? (c.difference_kg / c.sent_kg) * 100 : null;
  return (
    <div className="space-y-5">
      <PageHeader description={`Lo que mandó la granja frente a lo que recibimos en ${nombreMes(mes)}. Se acuerda con la granja y la contadora la cierra; sin esa conciliación no se cierra el mes contable.`}
        actions={<div className="w-[170px]"><Input type="month" aria-label="Mes" value={mes} onChange={(e) => setMes(e.target.value)} /></div>} />
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Envíos del mes" valor={c ? numero(c.dispatches) : undefined} icono={Truck} href="/m/grj/grj-03" />
        <CifraLink titulo="Kg enviados / recibidos" valor={c ? kg(c.received_kg) : undefined} detalle={c ? `de ${kg(c.sent_kg)} enviados` : undefined} icono={Scale} />
        <CifraLink titulo="Diferencia de peso" valor={c ? kg(c.difference_kg) : undefined} detalle={pct !== null ? porcentaje(pct, 2) : undefined} icono={Scale} tono={pct !== null && Math.abs(pct) > (c?.tolerance_pct ?? 1) ? "warn" : "ok"} />
        <CifraLink titulo="Diferencia de valor" valor={c ? soles(c.difference_value) : undefined} icono={Wallet} tono={c && Math.abs(c.difference_value) > 0 ? "warn" : undefined} />
      </div>
      {c && <>
        <Seccion titulo="Por producto" acciones={<StatusBadge status={estado} labels={CONCILIACION} />}>
          <DataTable rows={c.rows} rowKey={(r) => r.key} empty="Sin envíos en el mes." columns={[
            { key: "name", header: "Producto", cardTitle: true, render: (r) => r.name },
            { key: "lines", header: "Líneas", align: "right", render: (r) => numero(r.lines) },
            { key: "sent_kg", header: "Enviado", align: "right", render: (r) => kg(r.sent_kg) },
            { key: "received_kg", header: "Recibido", align: "right", render: (r) => kg(r.received_kg) },
            { key: "difference_kg", header: "Diferencia", align: "right", render: (r) => <span className={r.difference_kg ? "text-warn" : ""}>{kg(r.difference_kg)}</span> },
            { key: "difference_value", header: "Valor", align: "right", render: (r) => soles(r.difference_value) },
          ]} />
        </Seccion>
        {c.issues.length > 0 && <Alert tone="warn" title="Pendiente antes de cerrar">
          <ul className="mt-1 space-y-1">{c.issues.map((i, k) => <li key={k}><Link className="text-primary underline" href={`/m/grj/grj-04?envio=${i.dispatch_id}`}>{i.number}</Link> · {PROBLEMA[i.type] ?? i.type}{i.detail ? `: ${i.detail}` : ""}</li>)}</ul>
        </Alert>}
        {c.reconciliation?.agreed_at && <Alert tone="info" title="Acordado con la granja">{fechaHora(c.reconciliation.agreed_at)} · {c.reconciliation.agreed_by_name}{c.reconciliation.notes ? ` · ${c.reconciliation.notes}` : ""}</Alert>}
        {c.reconciliation?.closed_at && <Alert tone="ok" title="Conciliación cerrada">{fechaHora(c.reconciliation.closed_at)} · {c.reconciliation.closed_by_name}</Alert>}
        {estado !== "CLOSED" && <Seccion titulo="Acuerdo y cierre">
          {op?.can.agree && estado === "OPEN" && <div className="space-y-2">
            <Textarea rows={2} value={nota} maxLength={500} placeholder="Qué se acordó con la granja sobre las diferencias del mes" onChange={(e) => setNota(e.target.value)} />
            <Button disabled={nota.trim().length < 5} onClick={async () => { try { await api("/v1/grj/conciliacion/acordar", { method: "POST", body: { month: mes, note: nota } }); toast.ok("Acuerdo registrado"); setNota(""); recargar(); } catch (e) { toast.error(mensajeDe(e)); } }}>Registrar acuerdo</Button>
          </div>}
          {op?.can.close && <div className="mt-3"><Button variant="primary" icon={Lock} disabled={c.issues.length > 0} onClick={() => accion({ title: `¿Cerrar la conciliación de ${nombreMes(mes)}?`, message: "Queda como respaldo del cierre contable del mes.", confirmLabel: "Cerrar" },
            () => api("/v1/grj/conciliacion/cerrar", { method: "POST", body: { month: mes } }), "Conciliación cerrada", recargar)}>Cerrar conciliación</Button>
            {c.issues.length > 0 && <p className="mt-1 text-[12.5px] text-muted">Se cierra cuando no queden envíos por recibir, en disputa o sin motivo.</p>}</div>}
        </Seccion>}
        <Seccion titulo="Meses anteriores">
          <DataTable rows={c.history} rowKey={(h) => h.id} empty="Sin historial." onRowClick={(h) => setMes(h.period.slice(0, 7))} columns={[
            { key: "period", header: "Mes", cardTitle: true, render: (h) => nombreMes(h.period) },
            { key: "sent_kg", header: "Enviado", align: "right", render: (h) => kg(h.sent_kg) },
            { key: "difference_kg", header: "Diferencia", align: "right", render: (h) => kg(h.difference_kg) },
            { key: "difference_value", header: "Valor", align: "right", render: (h) => soles(h.difference_value) },
            { key: "status", header: "Estado", render: (h) => <StatusBadge status={h.status} labels={CONCILIACION} /> },
          ]} />
        </Seccion>
      </>}
    </div>
  );
}
